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
const nodeConsole = globalThis.console
const nodeProcess = globalThis.process

function printHelp() {
  nodeConsole.log(`Usage:
  node scripts/deploy-cloudflare-worker.mjs --name <worker-name> --config <path> [options]

Options:
  --name <name>                  Cloudflare Worker name
  --config <path>                Path to the .kanban.json file to embed
  --plugin <package>             Plugin package to statically bundle (repeatable)
  --kanban-dir <path>            Logical kanban dir for the Worker runtime (default: .kanban)
  --config-storage-binding <logical=binding>
                                 Bootstrap-owned Worker binding handle (repeatable)
  --config-revision-binding <binding>
                                 Worker binding that exposes the current config revision
  --callback-queue <name>        Queue name for enabled callback.runtime module handlers
  --callback-max-batch-size <n>  Queue consumer max batch size (default: 1)
  --callback-max-batch-timeout <n>
                                 Queue consumer max batch timeout seconds (default: 0)
  --callback-max-retries <n>     Queue consumer max retries (default: 3)
  --callback-dead-letter-queue <name>
                                 Optional dead-letter queue name for callback delivery
  --compatibility-date <date>    Wrangler compatibility date (default: ${defaultCompatibilityDate})
  --skip-build                   Skip pnpm run build:worker
  --dry-run                      Print generated paths and wrangler command without deploying
  --help                         Show this help
`)
}

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

function toImportSpecifier(fromDir, targetPath) {
  const relative = path.relative(fromDir, targetPath).split(path.sep).join('/')
  return relative.startsWith('.') ? relative : `./${relative}`
}

function parseIntegerOption(value, flag, minimum = 0) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum) {
    fail(`${flag} must be an integer greater than or equal to ${minimum}`)
  }
  return parsed
}

function parseBindingHandleOption(value, flag) {
  const separatorIndex = typeof value === 'string' ? value.indexOf('=') : -1
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    fail(`${flag} must use the format <logical-handle>=<binding-name>`)
  }

  const handleName = value.slice(0, separatorIndex).trim()
  const bindingName = value.slice(separatorIndex + 1).trim()
  if (!handleName || !bindingName) {
    fail(`${flag} must use the format <logical-handle>=<binding-name>`)
  }

  return { handleName, bindingName }
}

function parseArgs(argv) {
  const args = {
    plugins: [],
    kanbanDir: '.kanban',
    compatibilityDate: defaultCompatibilityDate,
    configStorageBindingHandles: {},
    configStorageRevisionBinding: undefined,
    callbackQueue: undefined,
    callbackMaxBatchSize: undefined,
    callbackMaxBatchTimeout: undefined,
    callbackMaxRetries: undefined,
    callbackDeadLetterQueue: undefined,
    dryRun: false,
    skipBuild: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help') {
      args.help = true
      continue
    }
    if (arg === '--dry-run') {
      args.dryRun = true
      continue
    }
    if (arg === '--skip-build') {
      args.skipBuild = true
      continue
    }
    if (arg === '--plugin') {
      const value = argv[++i]
      if (!value) fail('Missing value for --plugin')
      args.plugins.push(value)
      continue
    }
    if (arg === '--name') {
      const value = argv[++i]
      if (!value) fail('Missing value for --name')
      args.name = value
      continue
    }
    if (arg === '--config') {
      const value = argv[++i]
      if (!value) fail('Missing value for --config')
      args.configPath = value
      continue
    }
    if (arg === '--kanban-dir') {
      const value = argv[++i]
      if (!value) fail('Missing value for --kanban-dir')
      args.kanbanDir = value
      continue
    }
    if (arg === '--config-storage-binding') {
      const value = argv[++i]
      if (!value) fail('Missing value for --config-storage-binding')
      const { handleName, bindingName } = parseBindingHandleOption(value, '--config-storage-binding')
      args.configStorageBindingHandles[handleName] = bindingName
      continue
    }
    if (arg === '--config-revision-binding') {
      const value = argv[++i]
      if (!value) fail('Missing value for --config-revision-binding')
      args.configStorageRevisionBinding = value
      continue
    }
    if (arg === '--callback-queue') {
      const value = argv[++i]
      if (!value) fail('Missing value for --callback-queue')
      args.callbackQueue = value
      continue
    }
    if (arg === '--callback-max-batch-size') {
      const value = argv[++i]
      if (!value) fail('Missing value for --callback-max-batch-size')
      args.callbackMaxBatchSize = parseIntegerOption(value, '--callback-max-batch-size', 1)
      continue
    }
    if (arg === '--callback-max-batch-timeout') {
      const value = argv[++i]
      if (!value) fail('Missing value for --callback-max-batch-timeout')
      args.callbackMaxBatchTimeout = parseIntegerOption(value, '--callback-max-batch-timeout', 0)
      continue
    }
    if (arg === '--callback-max-retries') {
      const value = argv[++i]
      if (!value) fail('Missing value for --callback-max-retries')
      args.callbackMaxRetries = parseIntegerOption(value, '--callback-max-retries', 0)
      continue
    }
    if (arg === '--callback-dead-letter-queue') {
      const value = argv[++i]
      if (!value) fail('Missing value for --callback-dead-letter-queue')
      args.callbackDeadLetterQueue = value
      continue
    }
    if (arg === '--compatibility-date') {
      const value = argv[++i]
      if (!value) fail('Missing value for --compatibility-date')
      args.compatibilityDate = value
      continue
    }
    fail(`Unknown argument: ${arg}`)
  }

  return args
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

function requiresBundledCloudflareProvider(config) {
  return getCapabilityProvider(config, 'config.storage') === 'cloudflare'
    || getCapabilityProvider(config, 'callback.runtime') === 'cloudflare'
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

  const importLines = [`import { createCloudflareWorkerFetchHandler } from ${JSON.stringify(entryImport)}`]
  if (hasCallbackQueueConsumer) {
    importLines.push(`import { createCloudflareWorkerQueueHandler } from ${JSON.stringify(queueEntryImport)}`)
    importLines.push(`import * as sdkRuntimeModule from ${JSON.stringify(sdkEntryImport)}`)
  }
  const registryEntries = []
  let registryImportIndex = 0
  const pluginNames = [...options.plugins]

  if (requiresBundledCloudflareProvider(options.config) && !pluginNames.includes('kl-plugin-cloudflare')) {
    pluginNames.unshift('kl-plugin-cloudflare')
  }

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

export async function createGeneratedWranglerConfig(tempDir, options) {
  const queueConsumer = await buildCloudflareCallbackQueueConsumerConfig(options)
  const config = `name = ${JSON.stringify(options.name)}
compatibility_date = ${JSON.stringify(options.compatibilityDate)}
compatibility_flags = ${JSON.stringify(defaultCompatibilityFlags)}

[assets]
directory = ${JSON.stringify(standaloneAssetsDir)}
binding = "ASSETS"
${renderQueueConsumerConfigBlock(queueConsumer)}`
  const configPath = path.join(tempDir, 'wrangler.toml')
  fs.writeFileSync(configPath, config, 'utf8')
  return configPath
}

async function main() {
  const options = parseArgs(nodeProcess.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }

  if (!options.name) fail('Missing required --name')
  if (!options.configPath) fail('Missing required --config')

  const configPath = path.resolve(nodeProcess.cwd(), options.configPath)
  if (!fs.existsSync(configPath)) {
    fail(`Config file not found: ${configPath}`)
  }

  if (!options.skipBuild) {
    run('pnpm', ['run', 'build:sdk'], packageRoot)
    run('pnpm', ['run', 'build:worker'], packageRoot)
  }

  const embeddedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'))
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
  })

  const wranglerArgs = ['wrangler', 'deploy', entryPath, '--config', wranglerConfigPath]

  if (options.dryRun) {
    nodeConsole.log(`Generated worker entry: ${entryPath}`)
    nodeConsole.log(`Generated wrangler config: ${wranglerConfigPath}`)
    nodeConsole.log(`Plugins: ${options.plugins.length > 0 ? options.plugins.join(', ') : '(none)'}`)
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
