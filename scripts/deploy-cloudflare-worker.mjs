#!/usr/bin/env node

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const require = createRequire(import.meta.url)
const repoRoot = path.resolve(__dirname, '..')
const packageRoot = path.join(repoRoot, 'packages', 'kanban-lite')
const sdkDistEntrypoint = path.join(packageRoot, 'dist', 'sdk', 'index.cjs')
const workerEntrypoint = path.join(packageRoot, 'src', 'worker', 'index.ts')
const workerQueueEntrypoint = path.join(packageRoot, 'src', 'worker', 'queue.ts')
const workerSdkEntrypoint = path.join(packageRoot, 'src', 'sdk', 'index.ts')
const standaloneAssetsDir = path.join(packageRoot, 'dist', 'standalone-webview')
const defaultCompatibilityDate = '2026-04-05'
const defaultCompatibilityFlags = ['nodejs_compat']
const firstPartyStorageProviderIds = new Set(['sqlite', 'mysql', 'postgresql', 'mongodb', 'redis', 'cloudflare'])
const storageProviderPackages = new Map([
  ['sqlite', 'kl-plugin-storage-sqlite'],
  ['mysql', 'kl-plugin-storage-mysql'],
  ['postgresql', 'kl-plugin-storage-postgresql'],
  ['mongodb', 'kl-plugin-storage-mongodb'],
  ['redis', 'kl-plugin-storage-redis'],
  ['cloudflare', 'kl-plugin-cloudflare'],
])
const authProviderPackages = new Map([
  ['noop', 'kl-plugin-auth'],
  ['rbac', 'kl-plugin-rbac'],
  ['local', 'kl-plugin-rbac'],
  ['kl-plugin-auth', 'kl-plugin-rbac'],
  ['kl-plugin-rbac', 'kl-plugin-rbac'],
  ['openauth', 'kl-plugin-openauth'],
  ['kl-plugin-openauth', 'kl-plugin-openauth'],
  ['cloudflare', 'kl-plugin-cloudflare'],
])
const webhookProviderPackages = new Map([
  ['webhooks', 'kl-plugin-webhook'],
])
const callbackProviderPackages = new Map([
  ['callbacks', 'kl-plugin-callback'],
])
// First-party plugins that are bundled by default for Cloudflare Workers.
// Capability-specific packages such as kl-plugin-cloudflare and kl-plugin-webhook are
// added by collectRequiredWorkerPluginPackages so disabled providers stay unbundled.
// kl-plugin-storage-sqlite is excluded because it has a static top-level import of the native
// better-sqlite3 addon which cannot be bundled for the Workers runtime.
const allInternalPluginPackages = [
  'kl-plugin-auth',
  'kl-plugin-auth-visibility',
  'kl-plugin-rbac',
  'kl-plugin-openauth',
  'kl-plugin-callback',
  'kl-plugin-attachment-s3',
  'kl-plugin-storage-mysql',
  'kl-plugin-storage-postgresql',
  'kl-plugin-storage-mongodb',
  'kl-plugin-storage-redis',
]
const nodeConsole = globalThis.console
const nodeProcess = globalThis.process

import { printHelp, parseArgs, runDeployInteractive } from './lib/deploy-prompts.mjs'
import { ensureD1Database, findD1DatabaseByName, ensureR2Bucket, ensureQueue } from './lib/cloudflare-resources.mjs'
import {
  renderKanbanWorkerDurableObjectClassSource,
  renderKanbanWorkerDurableObjectConfigBlocks,
} from './lib/cloudflare-worker-durable-objects.mjs'

function fail(message) {
  nodeConsole.error(message)
  nodeProcess.exit(1)
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status ?? 'unknown'}): ${command} ${args.join(' ')}`)
  }
}

function resolveRealPath(targetPath) {
  try {
    return fs.realpathSync.native(targetPath)
  } catch {
    return path.resolve(targetPath)
  }
}

function toImportSpecifier(fromDir, targetPath) {
  const relative = path.relative(
    resolveRealPath(fromDir),
    resolveRealPath(targetPath),
  ).split(path.sep).join('/')
  return relative.startsWith('.') ? relative : `./${relative}`
}



function resolvePluginSource(packageName) {
  const localSource = path.join(repoRoot, 'packages', packageName, 'src', 'index.ts')
  if (fs.existsSync(localSource)) return localSource
  return packageName
}

function isPathLikeRequest(request) {
  return request.startsWith('./')
    || request.startsWith('../')
    || request.startsWith('/')
    || request.startsWith('file:')
}

function resolveCallbackModuleSource(request, configPath) {
  if (request.startsWith('file:')) {
    return fileURLToPath(request)
  }

  if (path.isAbsolute(request)) {
    return request
  }

  if (isPathLikeRequest(request)) {
    return path.resolve(path.dirname(configPath), request)
  }

  return resolvePluginSource(request)
}

function normalizeBuildErrorMessage(error) {
  if (error instanceof Error && Array.isArray(error.errors) && error.errors.length > 0) {
    return error.errors
      .map((entry) => entry.text || entry.detail || JSON.stringify(entry))
      .join('; ')
  }

  return error instanceof Error ? error.message : String(error)
}

function normalizeCustomDomain(domain) {
  if (typeof domain !== 'string') {
    return null
  }

  const normalized = domain.trim().toLowerCase()
  if (!normalized) {
    return null
  }

  if (normalized.includes('://') || normalized.includes('/') || normalized.includes('*')) {
    throw new Error(`Custom domains must be concrete hostnames without schemes, wildcards, or paths. Received: ${domain}`)
  }

  if (!/^[a-z0-9.-]+$/.test(normalized)) {
    throw new Error(`Custom domains may contain only letters, numbers, dots, and hyphens. Received: ${domain}`)
  }

  return normalized
}

function normalizeCustomDomainList(customDomains) {
  const normalizedDomains = []
  const seen = new Set()

  for (const candidate of customDomains ?? []) {
    const normalized = normalizeCustomDomain(candidate)
    if (!normalized || seen.has(normalized)) {
      continue
    }
    seen.add(normalized)
    normalizedDomains.push(normalized)
  }

  return normalizedDomains
}

function inferCustomDomainZoneName(customDomains) {
  const normalizedDomains = normalizeCustomDomainList(customDomains)
  if (normalizedDomains.length === 0) {
    return null
  }

  const inferredZones = new Set(
    normalizedDomains.map((domain) => {
      const parts = domain.split('.').filter(Boolean)
      if (parts.length < 2) {
        throw new Error(`Custom domains must contain at least a zone and top-level domain. Received: ${domain}`)
      }
      return parts.length === 2 ? parts.join('.') : parts.slice(1).join('.')
    }),
  )

  if (inferredZones.size > 1) {
    throw new Error('Multiple custom domains resolved to different zone names. Pass --custom-domain-zone <zone> to disambiguate the target Cloudflare zone.')
  }

  return [...inferredZones][0] ?? null
}

function resolveCustomDomainZoneName(customDomains, customDomainZoneName) {
  const normalizedDomains = normalizeCustomDomainList(customDomains)
  if (normalizedDomains.length === 0) {
    return null
  }

  const zoneName = normalizeCustomDomain(customDomainZoneName) ?? inferCustomDomainZoneName(normalizedDomains)
  if (!zoneName) {
    return null
  }

  for (const domain of normalizedDomains) {
    if (domain !== zoneName && !domain.endsWith(`.${zoneName}`)) {
      throw new Error(`Custom domain '${domain}' does not belong to the configured zone '${zoneName}'.`)
    }
  }

  return zoneName
}

async function loadCloudflareWorkerSdk() {
  if (nodeProcess.env.VITEST) {
    return import('../packages/kanban-lite/src/sdk/index.ts')
  }

  if (!fs.existsSync(sdkDistEntrypoint)) {
    throw new Error(`Built SDK entrypoint not found: ${sdkDistEntrypoint}. Run the deploy script without --skip-build, or build the SDK first.`)
  }

  return require(sdkDistEntrypoint)
}

/**
 * Builds the shared Cloudflare Worker bootstrap envelope used by deploy tooling.
 */
export async function buildCloudflareWorkerBootstrap(options) {
  const sdk = await loadCloudflareWorkerSdk()
  return sdk.createCloudflareWorkerBootstrap(options)
}

function createBootstrapInput(options) {
  const bindingHandles = { ...(options.configStorageBindingHandles ?? {}) }
  const revisionBinding = typeof options.configStorageRevisionBinding === 'string'
    ? options.configStorageRevisionBinding.trim()
    : ''

  if (Object.keys(bindingHandles).length === 0 && !revisionBinding) {
    return { config: options.config }
  }

  return {
    config: options.config,
    topology: {
      configStorage: {
        ...(Object.keys(bindingHandles).length > 0 ? { bindingHandles } : {}),
        ...(revisionBinding ? { revisionSource: { kind: 'binding', binding: revisionBinding } } : {}),
      },
    },
  }
}

function getCapabilityProvider(config, capability) {
  const plugins = config && typeof config === 'object' && !Array.isArray(config) && config.plugins && typeof config.plugins === 'object' && !Array.isArray(config.plugins)
    ? config.plugins
    : null
  const selection = plugins && plugins[capability] && typeof plugins[capability] === 'object' && !Array.isArray(plugins[capability])
    ? plugins[capability]
    : null
  return typeof selection?.provider === 'string' && selection.provider.trim()
    ? selection.provider.trim()
    : null
}

function normalizeProviderId(provider) {
  if (provider === 'markdown' || provider === 'builtin') {
    return 'localfs'
  }
  return provider
}

function getLegacyAuthProvider(config, capability) {
  const auth = config && typeof config === 'object' && !Array.isArray(config) && config.auth && typeof config.auth === 'object' && !Array.isArray(config.auth)
    ? config.auth
    : null
  const selection = auth && auth[capability] && typeof auth[capability] === 'object' && !Array.isArray(auth[capability])
    ? auth[capability]
    : null
  return typeof selection?.provider === 'string' && selection.provider.trim()
    ? normalizeProviderId(selection.provider.trim())
    : null
}

function getLegacyWebhookProvider(config) {
  const webhookPlugin = config && typeof config === 'object' && !Array.isArray(config) && config.webhookPlugin && typeof config.webhookPlugin === 'object' && !Array.isArray(config.webhookPlugin)
    ? config.webhookPlugin
    : null
  const selection = webhookPlugin && webhookPlugin['webhook.delivery'] && typeof webhookPlugin['webhook.delivery'] === 'object' && !Array.isArray(webhookPlugin['webhook.delivery'])
    ? webhookPlugin['webhook.delivery']
    : null
  return typeof selection?.provider === 'string' && selection.provider.trim()
    ? normalizeProviderId(selection.provider.trim())
    : null
}

function inferCardStorageProvider(config) {
  const configured = getCapabilityProvider(config, 'card.storage')
  if (configured) {
    return normalizeProviderId(configured)
  }
  return config?.storageEngine === 'sqlite' ? 'sqlite' : 'localfs'
}

function inferAttachmentStorageProvider(config) {
  const configured = getCapabilityProvider(config, 'attachment.storage')
  const cardStorageProvider = inferCardStorageProvider(config)
  if (!configured) {
    return cardStorageProvider
  }

  const normalizedConfigured = normalizeProviderId(configured)
  return normalizedConfigured === cardStorageProvider || (normalizedConfigured === 'localfs' && cardStorageProvider !== 'localfs')
    ? cardStorageProvider
    : normalizedConfigured
}

function inferConfigStorageProvider(config) {
  const configured = getCapabilityProvider(config, 'config.storage')
  if (configured) {
    return normalizeProviderId(configured)
  }

  const derived = inferCardStorageProvider(config)
  return firstPartyStorageProviderIds.has(derived)
    ? derived
    : 'localfs'
}

function inferCardStateProvider(config) {
  const configured = getCapabilityProvider(config, 'card.state')
  if (configured) {
    return normalizeProviderId(configured)
  }
  return inferCardStorageProvider(config)
}

function inferAuthIdentityProvider(config) {
  return normalizeProviderId(
    getCapabilityProvider(config, 'auth.identity')
      ?? getLegacyAuthProvider(config, 'auth.identity')
      ?? 'noop',
  )
}

function inferAuthPolicyProvider(config) {
  return normalizeProviderId(
    getCapabilityProvider(config, 'auth.policy')
      ?? getLegacyAuthProvider(config, 'auth.policy')
      ?? 'noop',
  )
}

function inferAuthVisibilityProvider(config) {
  return normalizeProviderId(
    getCapabilityProvider(config, 'auth.visibility')
      ?? getLegacyAuthProvider(config, 'auth.visibility')
      ?? 'none',
  )
}

function inferWebhookDeliveryProvider(config) {
  return normalizeProviderId(
    getCapabilityProvider(config, 'webhook.delivery')
      ?? getLegacyWebhookProvider(config)
      ?? 'webhooks',
  )
}

function inferCallbackRuntimeProvider(config) {
  return normalizeProviderId(
    getCapabilityProvider(config, 'callback.runtime')
      ?? 'none',
  )
}

function resolveProviderPackage(providerId, packageMap) {
  if (!providerId || providerId === 'localfs' || providerId === 'none') {
    return null
  }
  return packageMap.get(providerId) ?? providerId
}

function collectRequiredWorkerPluginPackages(config) {
  const packages = new Set()

  const add = (packageName) => {
    if (packageName) {
      packages.add(packageName)
    }
  }

  add(resolveProviderPackage(inferCardStorageProvider(config), storageProviderPackages))
  add(resolveProviderPackage(inferAttachmentStorageProvider(config), storageProviderPackages))
  add(resolveProviderPackage(inferConfigStorageProvider(config), storageProviderPackages))
  add(resolveProviderPackage(inferCardStateProvider(config), storageProviderPackages))
  add(resolveProviderPackage(inferAuthIdentityProvider(config), authProviderPackages))
  add(resolveProviderPackage(inferAuthPolicyProvider(config), authProviderPackages))
  add(resolveProviderPackage(inferAuthVisibilityProvider(config), authProviderPackages))
  add(resolveProviderPackage(inferWebhookDeliveryProvider(config), webhookProviderPackages))
  add(resolveProviderPackage(inferCallbackRuntimeProvider(config), callbackProviderPackages))

  return [...packages]
}

export async function buildCloudflareCallbackModuleBundlePlan(options) {
  const sdk = await loadCloudflareWorkerSdk()
  const entries = sdk.collectCloudflareCallbackModuleRegistryEntries(options.config)

  return {
    entries: entries.map((entry) => ({
      module: entry.module,
      handlers: [...entry.handlers],
      source: resolveCallbackModuleSource(entry.module, options.configPath),
    })),
  }
}

export async function buildCloudflareCallbackQueueConsumerConfig(options) {
  const sdk = await loadCloudflareWorkerSdk()
  if (!sdk.hasCloudflareCallbackModuleHandlers(options.config)) {
    return null
  }

  const queue = typeof options.callbackQueue === 'string' ? options.callbackQueue.trim() : ''
  if (!queue) {
    throw new Error(
      'Enabled callback.runtime module handlers require --callback-queue <name> so deploy tooling can emit an explicit Cloudflare queue consumer config.',
    )
  }

  const defaults = sdk.CLOUDFLARE_CALLBACK_QUEUE_CONSUMER_DEFAULTS
  return {
    queue,
    maxBatchSize: options.callbackMaxBatchSize ?? defaults.maxBatchSize,
    maxBatchTimeout: options.callbackMaxBatchTimeout ?? defaults.maxBatchTimeout,
    maxRetries: options.callbackMaxRetries ?? defaults.maxRetries,
    deadLetterQueue: typeof options.callbackDeadLetterQueue === 'string' && options.callbackDeadLetterQueue.trim()
      ? options.callbackDeadLetterQueue.trim()
      : defaults.deadLetterQueue,
  }
}

export async function validateCloudflareCallbackModuleBundlePlan(tempDir, entries) {
  if (entries.length === 0) {
    return
  }

  const { build } = await import('esbuild')
  const validationEntryPath = path.join(tempDir, 'callback-module-validation.mjs')
  const validationBundlePath = path.join(tempDir, 'callback-module-validation.bundle.mjs')
  const validationImports = []
  const validationChecks = []

  entries.forEach((entry, moduleIndex) => {
    const specifier = path.isAbsolute(entry.source)
      ? toImportSpecifier(tempDir, entry.source)
      : entry.source

    entry.handlers.forEach((handlerName, handlerIndex) => {
      const alias = `callbackHandler_${moduleIndex}_${handlerIndex}`
      validationImports.push(
        `import { ${handlerName} as ${alias} } from ${JSON.stringify(specifier)}`,
      )
      validationChecks.push(
        `if (typeof ${alias} !== 'function') throw new Error(${JSON.stringify(`Configured callback.runtime module '${entry.module}' does not export the callable named handler '${handlerName}'.`)})`,
      )
    })
  })

  const validationSource = `${validationImports.join('\n')}

${validationChecks.join('\n')}

export default true
`

  fs.writeFileSync(validationEntryPath, validationSource, 'utf8')

  try {
    await build({
      absWorkingDir: repoRoot,
      entryPoints: [validationEntryPath],
      bundle: true,
      format: 'esm',
      platform: 'browser',
      outfile: validationBundlePath,
      write: true,
      logLevel: 'silent',
    })
    await import(`${pathToFileURL(validationBundlePath).href}?t=${Date.now()}`)
  } catch (error) {
    throw new Error(`Cloudflare callback module validation failed: ${normalizeBuildErrorMessage(error)}`)
  }
}

function addRegistryImport(importLines, registryEntries, tempDir, request, source, index) {
  const specifier = path.isAbsolute(source) ? toImportSpecifier(tempDir, source) : source
  const variableName = `moduleRegistryEntry${index}`
  importLines.push(`import * as ${variableName} from ${JSON.stringify(specifier)}`)
  registryEntries.push(`  ${JSON.stringify(request)}: ${variableName}`)
}

export async function createGeneratedWorker(tempDir, options) {
  const entryImport = toImportSpecifier(tempDir, workerEntrypoint)
  const queueEntryImport = toImportSpecifier(tempDir, workerQueueEntrypoint)
  const sdkEntryImport = toImportSpecifier(tempDir, workerSdkEntrypoint)
  const callbackModulePlan = await buildCloudflareCallbackModuleBundlePlan(options)
  const hasCallbackQueueConsumer = (await buildCloudflareCallbackQueueConsumerConfig(options)) !== null
  await validateCloudflareCallbackModuleBundlePlan(tempDir, callbackModulePlan.entries)

  const importLines = [
    'import { DurableObject } from "cloudflare:workers"',
    `import { createCloudflareWorkerFetchHandler } from ${JSON.stringify(entryImport)}`,
  ]
  if (hasCallbackQueueConsumer) {
    importLines.push(`import { createCloudflareWorkerQueueHandler } from ${JSON.stringify(queueEntryImport)}`)
    importLines.push(`import * as sdkRuntimeModule from ${JSON.stringify(sdkEntryImport)}`)
  }
  const registryEntries = []
  let registryImportIndex = 0
  const pluginNames = [...new Set([
    ...allInternalPluginPackages,
    ...collectRequiredWorkerPluginPackages(options.config),
    ...options.plugins,
  ])]

  pluginNames.forEach((pluginName, index) => {
    const source = resolvePluginSource(pluginName)
    addRegistryImport(importLines, registryEntries, tempDir, pluginName, source, registryImportIndex + index)
  })

  registryImportIndex += pluginNames.length

  callbackModulePlan.entries.forEach((entry, index) => {
    if (pluginNames.includes(entry.module)) {
      return
    }
    addRegistryImport(importLines, registryEntries, tempDir, entry.module, entry.source, registryImportIndex + index)
  })

  const embeddedBootstrap = await buildCloudflareWorkerBootstrap(createBootstrapInput(options))
  const workerExports = [
    `  fetch: createCloudflareWorkerFetchHandler({\n    kanbanDir: ${JSON.stringify(options.kanbanDir)},\n    bootstrap: embeddedBootstrap,\n    moduleRegistry,\n  })`,
  ]

  if (hasCallbackQueueConsumer) {
    workerExports.push(
      `  queue: createCloudflareWorkerQueueHandler({\n    kanbanDir: ${JSON.stringify(options.kanbanDir)},\n    bootstrap: embeddedBootstrap,\n    moduleRegistry,\n    sdkModule: sdkRuntimeModule,\n  })`,
    )
  }

  const generatedEntry = `${importLines.join('\n')}

${renderKanbanWorkerDurableObjectClassSource()}
const embeddedBootstrap = ${JSON.stringify(embeddedBootstrap, null, 2)}
const moduleRegistry = {
${registryEntries.join(',\n')}
}

export default {
${workerExports.join(',\n')}
}
`

  const entryPath = path.join(tempDir, 'worker-entry.mjs')
  fs.writeFileSync(entryPath, generatedEntry, 'utf8')
  return entryPath
}

function renderD1BindingBlocks(bindings) {
  if (!bindings || Object.keys(bindings).length === 0) return ''
  return Object.entries(bindings)
    .map(([binding, { name, id }]) => `
[[d1_databases]]
binding = ${JSON.stringify(binding)}
database_name = ${JSON.stringify(name)}
database_id = ${JSON.stringify(id)}
`)
    .join('')
}

function renderR2BindingBlocks(bindings) {
  if (!bindings || Object.keys(bindings).length === 0) return ''
  return Object.entries(bindings)
    .map(([binding, name]) => `
[[r2_buckets]]
binding = ${JSON.stringify(binding)}
bucket_name = ${JSON.stringify(name)}
`)
    .join('')
}

function renderQueueProducerBlocks(producers) {
  if (!producers || Object.keys(producers).length === 0) return ''
  return Object.entries(producers)
    .map(([binding, queue]) => `
[[queues.producers]]
binding = ${JSON.stringify(binding)}
queue = ${JSON.stringify(queue)}
`)
    .join('')
}

function renderQueueConsumerConfigBlock(queueConsumer) {
  if (!queueConsumer) {
    return ''
  }

  const lines = [
    '',
    '[[queues.consumers]]',
    `queue = ${JSON.stringify(queueConsumer.queue)}`,
    `max_batch_size = ${queueConsumer.maxBatchSize}`,
    `max_batch_timeout = ${queueConsumer.maxBatchTimeout}`,
    `max_retries = ${queueConsumer.maxRetries}`,
  ]

  if (queueConsumer.deadLetterQueue) {
    lines.push(`dead_letter_queue = ${JSON.stringify(queueConsumer.deadLetterQueue)}`)
  }

  return `${lines.join('\n')}\n`
}

function renderCustomDomainRouteBlocks(customDomains, customDomainZoneName) {
  const normalizedDomains = normalizeCustomDomainList(customDomains)
  if (normalizedDomains.length === 0) {
    return ''
  }

  const zoneName = resolveCustomDomainZoneName(normalizedDomains, customDomainZoneName)

  return normalizedDomains
    .map((domain) => `
[[routes]]
pattern = ${JSON.stringify(domain)}
custom_domain = true
zone_name = ${JSON.stringify(zoneName)}
`)
    .join('')
}

export async function createGeneratedWranglerConfig(tempDir, options) {
  const queueConsumer = await buildCloudflareCallbackQueueConsumerConfig(options)
  const config = `name = ${JSON.stringify(options.name)}
compatibility_date = ${JSON.stringify(options.compatibilityDate)}
compatibility_flags = ${JSON.stringify(defaultCompatibilityFlags)}
workers_dev = true

[assets]
directory = ${JSON.stringify(standaloneAssetsDir)}
binding = "ASSETS"
${renderCustomDomainRouteBlocks(options.customDomains, options.customDomainZoneName)}${renderD1BindingBlocks(options.resolvedD1Bindings)}${renderR2BindingBlocks(options.resolvedR2Bindings)}${renderQueueProducerBlocks(options.resolvedQueueProducers)}${renderQueueConsumerConfigBlock(queueConsumer)}${renderKanbanWorkerDurableObjectConfigBlocks()}`
  const configPath = path.join(tempDir, 'wrangler.toml')
  fs.writeFileSync(configPath, config, 'utf8')
  return configPath
}

async function main() {
  let options = parseArgs(nodeProcess.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }

  // Interactive mode when required args are missing
  if (!options.name || !options.configPath) {
    options = await runDeployInteractive(options)
  }

  if (!options.name) fail('Missing required --name')
  if (!options.configPath) fail('Missing required --config')
  options.customDomains = normalizeCustomDomainList(options.customDomains)
  options.customDomainZoneName = resolveCustomDomainZoneName(options.customDomains, options.customDomainZoneName) ?? undefined

  const configPath = path.resolve(nodeProcess.cwd(), options.configPath)
  if (!fs.existsSync(configPath)) {
    fail(`Config file not found: ${configPath}`)
  }

  if (!options.skipBuild) {
    run('pnpm', ['run', 'build:sdk'], packageRoot)
    run('pnpm', ['run', 'build:worker'], packageRoot)
  }

  const embeddedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'))

  // Resolve D1/R2/Queue resources, optionally creating them via wrangler
  const resolvedD1Bindings = {}
  const resolvedR2Bindings = { ...options.r2Bindings }
  const resolvedQueueProducers = { ...options.queueProducers }

  for (const [binding, dbName] of Object.entries(options.d1Bindings ?? {})) {
    if (options.createResources) {
      resolvedD1Bindings[binding] = ensureD1Database(dbName)
    } else {
      const existing = findD1DatabaseByName(dbName)
      if (!existing) fail(`D1 database not found: ${dbName}. Pass --create-resources to auto-create it.`)
      resolvedD1Bindings[binding] = { id: existing.uuid, name: existing.name ?? dbName }
    }
  }

  if (options.createResources) {
    for (const bucketName of Object.values(options.r2Bindings ?? {})) {
      ensureR2Bucket(bucketName)
    }
    for (const queueName of Object.values(options.queueProducers ?? {})) {
      ensureQueue(queueName)
    }
    const callbacksBinding = options.configStorageBindingHandles?.callbacks
    if (options.callbackQueue && callbacksBinding) {
      ensureQueue(options.callbackQueue)
      resolvedQueueProducers[callbacksBinding] ??= options.callbackQueue
    }
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-lite-cloudflare-'))
  const callbackQueueConsumer = await buildCloudflareCallbackQueueConsumerConfig({
    ...options,
    config: embeddedConfig,
  })
  const entryPath = await createGeneratedWorker(tempDir, {
    ...options,
    config: embeddedConfig,
    configPath,
  })
  const wranglerConfigPath = await createGeneratedWranglerConfig(tempDir, {
    ...options,
    config: embeddedConfig,
    resolvedD1Bindings,
    resolvedR2Bindings,
    resolvedQueueProducers,
  })

  const wranglerArgs = ['wrangler', 'deploy', entryPath, '--config', wranglerConfigPath]

  if (options.dryRun) {
    nodeConsole.log(`Generated worker entry: ${entryPath}`)
    nodeConsole.log(`Generated wrangler config: ${wranglerConfigPath}`)
    nodeConsole.log(fs.readFileSync(wranglerConfigPath, 'utf8'))
    nodeConsole.log(`Plugins: ${options.plugins.length > 0 ? options.plugins.join(', ') : '(none)'}`)
    nodeConsole.log(`Custom domains: ${options.customDomains.length > 0 ? options.customDomains.join(', ') : '(none)'}`)
    nodeConsole.log(`Custom domain zone: ${options.customDomainZoneName ?? '(auto)'}`)
    nodeConsole.log(`Callback queue consumer: ${callbackQueueConsumer ? JSON.stringify(callbackQueueConsumer) : '(disabled)'}`)
    nodeConsole.log(`\n$ npx ${wranglerArgs.join(' ')}`)
    return
  }

  run('npx', wranglerArgs, packageRoot)
}

if (nodeProcess.argv[1] && path.resolve(nodeProcess.argv[1]) === __filename) {
  main().catch((error) => {
    fail(error instanceof Error ? error.message : String(error))
  })
}
