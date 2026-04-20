/**
 * Interactive deploy prompts and CLI argument parser for deploy-cloudflare-worker.mjs.
 * Contains: printHelp, parseArgs, runDeployInteractive.
 */
import { createInterface } from 'node:readline/promises'
import fs from 'node:fs'
import path from 'node:path'

const nodeConsole = globalThis.console
const nodeProcess = globalThis.process
const defaultCompatibilityDate = '2026-04-05'

function fail(message) {
  nodeConsole.error(message)
  nodeProcess.exit(1)
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
    fail(`${flag} must use the format <name>=<value>`)
  }
  const handleName = value.slice(0, separatorIndex).trim()
  const bindingName = value.slice(separatorIndex + 1).trim()
  if (!handleName || !bindingName) {
    fail(`${flag} must use the format <name>=<value>`)
  }
  return { handleName, bindingName }
}

function parseBooleanEnv(value, fallback = false) {
  if (typeof value !== 'string' || value.trim() === '') return fallback
  return /^(1|true|yes|on)$/i.test(value.trim())
}

function parseIntegerEnv(value) {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : undefined
}

function parseListEnv(value) {
  if (typeof value !== 'string' || value.trim() === '') return []
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

/**
 * Normalize a worker name into a safe slug for resource defaults (D1, R2, Queue).
 * Cloudflare worker names already use [a-z0-9-], so this is mostly a safety net
 * for trimmed input or unexpected casing.
 * @param {unknown} name
 * @returns {string}
 */
function deriveResourceSlug(name) {
  if (typeof name !== 'string') return ''
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
  return slug
}

function inferCustomDomainZoneName(customDomains) {
  const firstDomain = Array.isArray(customDomains) ? customDomains.find((domain) => typeof domain === 'string' && domain.trim()) : ''
  if (!firstDomain) {
    return ''
  }

  const parts = firstDomain.trim().toLowerCase().split('.').filter(Boolean)
  if (parts.length < 2) {
    return ''
  }

  return parts.length === 2 ? parts.join('.') : parts.slice(1).join('.')
}

function readArgsFromEnv() {
  const env = nodeProcess.env
  const pluginNames = [
    ...parseListEnv(env.KANBAN_CF_PLUGIN_NAMES),
    ...parseListEnv(env.KANBAN_CF_PLUGIN_NAME),
  ]
  const customDomains = [
    ...parseListEnv(env.KANBAN_CF_CUSTOM_DOMAINS),
    ...parseListEnv(env.KANBAN_CF_CUSTOM_DOMAIN),
  ]
  const d1Bindings = {}
  const r2Bindings = {}
  const queueProducers = {}
  const configStorageBindingHandles = {}

  if (env.KANBAN_CF_D1_BINDING && env.KANBAN_CF_D1_NAME) {
    d1Bindings[env.KANBAN_CF_D1_BINDING.trim()] = env.KANBAN_CF_D1_NAME.trim()
  }

  if (env.KANBAN_CF_R2_BINDING && env.KANBAN_CF_R2_BUCKET) {
    r2Bindings[env.KANBAN_CF_R2_BINDING.trim()] = env.KANBAN_CF_R2_BUCKET.trim()
  }

  if (env.KANBAN_CF_QUEUE_BINDING && env.KANBAN_CF_QUEUE_NAME) {
    queueProducers[env.KANBAN_CF_QUEUE_BINDING.trim()] = env.KANBAN_CF_QUEUE_NAME.trim()
  }

  const databaseHandleBinding = env.KANBAN_CF_CONFIG_STORAGE_DATABASE_BINDING?.trim() || env.KANBAN_CF_D1_BINDING?.trim()
  const attachmentsHandleBinding = env.KANBAN_CF_CONFIG_STORAGE_ATTACHMENTS_BINDING?.trim() || env.KANBAN_CF_R2_BINDING?.trim()
  const callbacksHandleBinding = env.KANBAN_CF_CONFIG_STORAGE_CALLBACKS_BINDING?.trim() || env.KANBAN_CF_QUEUE_BINDING?.trim()

  if (databaseHandleBinding) configStorageBindingHandles.database = databaseHandleBinding
  if (attachmentsHandleBinding) configStorageBindingHandles.attachments = attachmentsHandleBinding
  if (callbacksHandleBinding) configStorageBindingHandles.callbacks = callbacksHandleBinding

  return {
    plugins: pluginNames,
    kanbanDir: env.KANBAN_CF_KANBAN_DIR?.trim() || '.kanban',
    compatibilityDate: env.KANBAN_CF_COMPATIBILITY_DATE?.trim() || defaultCompatibilityDate,
    configStorageBindingHandles,
    configStorageRevisionBinding: env.KANBAN_CF_CONFIG_REVISION_BINDING?.trim() || undefined,
    d1Bindings,
    r2Bindings,
    queueProducers,
    createResources: parseBooleanEnv(env.KANBAN_CF_CREATE_RESOURCES, false),
    callbackQueue: env.KANBAN_CF_CALLBACK_QUEUE?.trim() || env.KANBAN_CF_QUEUE_NAME?.trim() || undefined,
    callbackMaxBatchSize: parseIntegerEnv(env.KANBAN_CF_CALLBACK_MAX_BATCH_SIZE),
    callbackMaxBatchTimeout: parseIntegerEnv(env.KANBAN_CF_CALLBACK_MAX_BATCH_TIMEOUT),
    callbackMaxRetries: parseIntegerEnv(env.KANBAN_CF_CALLBACK_MAX_RETRIES),
    callbackDeadLetterQueue: env.KANBAN_CF_CALLBACK_DEAD_LETTER_QUEUE?.trim() || undefined,
    dryRun: parseBooleanEnv(env.KANBAN_CF_DRY_RUN, false),
    skipBuild: parseBooleanEnv(env.KANBAN_CF_SKIP_BUILD, false),
    customDomains,
    customDomainZoneName: env.KANBAN_CF_CUSTOM_DOMAIN_ZONE?.trim() || undefined,
    name: env.KANBAN_CF_WORKER_NAME?.trim() || undefined,
    configPath: env.KANBAN_CF_CONFIG_PATH?.trim() || undefined,
  }
}

export function printHelp() {
  nodeConsole.log(`Usage:
  node scripts/deploy-cloudflare-worker.mjs --name <worker-name> --config <path> [options]

Environment defaults can also be loaded with Node's env-file support:
  node --env-file=.env.cloudflare scripts/deploy-cloudflare-worker.mjs

Options:
  --name <name>                  Cloudflare Worker name
  --config <path>                Path to the .kanban.json file to embed
  --plugin <package>             Plugin package to statically bundle (repeatable)
  --kanban-dir <path>            Logical kanban dir for the Worker runtime (default: .kanban)
  --config-storage-binding <logical=binding>
                                 Bootstrap-owned Worker binding handle (repeatable)
  --config-revision-binding <binding>
                                 Worker binding that exposes the current config revision
  --d1 <binding>=<db-name>       D1 database binding declaration (repeatable)
  --r2 <binding>=<bucket-name>   R2 bucket binding declaration (repeatable)
  --queue-producer <binding>=<queue-name>
                                 Queue producer binding declaration (repeatable)
  --custom-domain <hostname>     Attach a Cloudflare Worker custom-domain hostname (repeatable)
  --custom-domain-zone <zone>    Explicit Cloudflare zone name for custom-domain routes
  --create-resources             Auto-create D1/R2/Queue resources via wrangler if they don't exist
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

export function parseArgs(argv) {
  const args = readArgsFromEnv()

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help') { args.help = true; continue }
    if (arg === '--dry-run') { args.dryRun = true; continue }
    if (arg === '--skip-build') { args.skipBuild = true; continue }
    if (arg === '--create-resources') { args.createResources = true; continue }
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
    if (arg === '--d1') {
      const value = argv[++i]
      if (!value) fail('Missing value for --d1')
      const { handleName: binding, bindingName: dbName } = parseBindingHandleOption(value, '--d1')
      args.d1Bindings[binding] = dbName
      continue
    }
    if (arg === '--r2') {
      const value = argv[++i]
      if (!value) fail('Missing value for --r2')
      const { handleName: binding, bindingName: bucketName } = parseBindingHandleOption(value, '--r2')
      args.r2Bindings[binding] = bucketName
      continue
    }
    if (arg === '--queue-producer') {
      const value = argv[++i]
      if (!value) fail('Missing value for --queue-producer')
      const { handleName: binding, bindingName: queueName } = parseBindingHandleOption(value, '--queue-producer')
      args.queueProducers[binding] = queueName
      continue
    }
    if (arg === '--custom-domain') {
      const value = argv[++i]
      if (!value) fail('Missing value for --custom-domain')
      args.customDomains.push(value)
      continue
    }
    if (arg === '--custom-domain-zone') {
      const value = argv[++i]
      if (!value) fail('Missing value for --custom-domain-zone')
      args.customDomainZoneName = value
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

function getCloudflareCapabilities(config) {
  const plugins = (config && typeof config === 'object' && !Array.isArray(config))
    ? (config.plugins ?? {})
    : {}
  return Object.entries(plugins)
    .filter(([, cfg]) => cfg?.provider === 'cloudflare')
    .map(([cap]) => cap)
}

/**
 * Interactively prompts for missing deploy options when required args are absent.
 * Returns a fully-populated options object.
 * @param {object} options - partially-filled options from parseArgs
 * @returns {Promise<object>}
 */
export async function runDeployInteractive(options) {
  const rl = createInterface({ input: nodeProcess.stdin, output: nodeProcess.stdout })
  const ask = async (q, def) => {
    const answer = await rl.question(`  ${q}${def !== undefined ? ` [${def}]` : ''}: `)
    return answer.trim() || (def ?? '')
  }
  const confirm = async (q, defYes = true) => {
    const answer = await rl.question(`  ${q} [${defYes ? 'Y/n' : 'y/N'}]: `)
    if (!answer.trim()) return defYes
    return /^y/i.test(answer.trim())
  }

  try {
    const result = {
      ...options,
      d1Bindings: { ...options.d1Bindings },
      r2Bindings: { ...options.r2Bindings },
      queueProducers: { ...options.queueProducers },
      configStorageBindingHandles: { ...options.configStorageBindingHandles },
      customDomains: [...(options.customDomains ?? [])],
      customDomainZoneName: options.customDomainZoneName,
    }

    nodeConsole.log('\n🚀 Kanban Lite — Cloudflare Worker deploy\n')

    if (!result.name) {
      result.name = await ask('Worker name', 'kanban-lite')
    }
    if (!result.configPath) {
      result.configPath = await ask('Path to .kanban config', '.kanban.cloudflare.json')
    }
    if (result.customDomains.length === 0) {
      result.customDomains = parseListEnv(await ask('Custom domain hostname (optional, comma-separated)', ''))
    }
    if (result.customDomains.length > 0 && !result.customDomainZoneName) {
      const inferredZoneName = inferCustomDomainZoneName(result.customDomains)
      const zoneName = await ask('Custom domain zone name', inferredZoneName)
      result.customDomainZoneName = zoneName || undefined
    }

    // Load config to detect cloudflare capabilities
    if (!result.config && result.configPath) {
      try {
        const absPath = path.resolve(nodeProcess.cwd(), result.configPath)
        result.config = JSON.parse(fs.readFileSync(absPath, 'utf8'))
      } catch { /* validation will surface a proper error later */ }
    }

    const cfCaps = getCloudflareCapabilities(result.config)
    if (cfCaps.length > 0) {
      nodeConsole.log(`\n  Detected Cloudflare providers: ${cfCaps.join(', ')}\n`)
    }

    const needsD1 = cfCaps.some((c) => c === 'card.storage' || c === 'config.storage')
    const needsR2 = cfCaps.includes('attachment.storage')
    const needsQueue = cfCaps.includes('callback.runtime')

    // Derive resource defaults from the worker name so two workers (e.g.
    // `kanban-lite` and `tsf-kanban-lite`) don't silently share the same D1
    // database, R2 bucket, or Queue when the user accepts defaults.
    const resourceSlug = deriveResourceSlug(result.name) || 'kanban-lite'

    if (needsD1 && Object.keys(result.d1Bindings).length === 0) {
      const envVar = await ask('D1 binding name (Worker env var)', 'KANBAN_DB')
      const dbName = await ask('D1 database name', `${resourceSlug}-db`)
      result.d1Bindings[envVar] = dbName
      result.configStorageBindingHandles.database ??= envVar
    }

    if (needsR2 && Object.keys(result.r2Bindings).length === 0) {
      const envVar = await ask('R2 binding name (Worker env var)', 'KANBAN_BUCKET')
      const bucketName = await ask('R2 bucket name', `${resourceSlug}-attachments`)
      result.r2Bindings[envVar] = bucketName
      result.configStorageBindingHandles.attachments ??= envVar
    }

    if (needsQueue) {
      if (!result.callbackQueue) {
        result.callbackQueue = await ask('Callback queue name', `${resourceSlug}-callbacks`)
      }
      if (!result.configStorageBindingHandles.callbacks) {
        const envVar = await ask('Queue binding name (Worker env var)', 'KANBAN_QUEUE')
        result.configStorageBindingHandles.callbacks = envVar
        result.queueProducers[envVar] ??= result.callbackQueue
      }
    }

    const needsResources = needsD1 || needsR2 || needsQueue
    if (needsResources && !result.createResources) {
      result.createResources = await confirm("Auto-create Cloudflare D1/R2/Queue resources if they don't exist?")
    }

    return result
  } finally {
    rl.close()
  }
}
