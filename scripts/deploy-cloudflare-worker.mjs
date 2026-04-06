#!/usr/bin/env node

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')
const packageRoot = path.join(repoRoot, 'packages', 'kanban-lite')
const workerEntrypoint = path.join(packageRoot, 'src', 'worker', 'index.ts')
const standaloneAssetsDir = path.join(packageRoot, 'dist', 'standalone-webview')
const defaultCompatibilityDate = '2026-04-05'

function printHelp() {
  console.log(`Usage:
  node scripts/deploy-cloudflare-worker.mjs --name <worker-name> --config <path> [options]

Options:
  --name <name>                  Cloudflare Worker name
  --config <path>                Path to the .kanban.json file to embed
  --plugin <package>             Plugin package to statically bundle (repeatable)
  --kanban-dir <path>            Logical kanban dir for the Worker runtime (default: .kanban)
  --compatibility-date <date>    Wrangler compatibility date (default: ${defaultCompatibilityDate})
  --skip-build                   Skip pnpm run build:worker
  --dry-run                      Print generated paths and wrangler command without deploying
  --help                         Show this help
`)
}

function fail(message) {
  console.error(message)
  process.exit(1)
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

function parseArgs(argv) {
  const args = {
    plugins: [],
    kanbanDir: '.kanban',
    compatibilityDate: defaultCompatibilityDate,
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
      args.name = argv[++i]
      continue
    }
    if (arg === '--config') {
      args.configPath = argv[++i]
      continue
    }
    if (arg === '--kanban-dir') {
      args.kanbanDir = argv[++i]
      continue
    }
    if (arg === '--compatibility-date') {
      args.compatibilityDate = argv[++i]
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

function createGeneratedWorker(tempDir, options) {
  const entryImport = toImportSpecifier(tempDir, workerEntrypoint)
  const importLines = [`import { createCloudflareWorkerFetchHandler } from ${JSON.stringify(entryImport)}`]
  const registryEntries = []

  options.plugins.forEach((pluginName, index) => {
    const source = resolvePluginSource(pluginName)
    const specifier = path.isAbsolute(source) ? toImportSpecifier(tempDir, source) : source
    const variableName = `pluginModule${index}`
    importLines.push(`import * as ${variableName} from ${JSON.stringify(specifier)}`)
    registryEntries.push(`  ${JSON.stringify(pluginName)}: ${variableName}`)
  })

  const generatedEntry = `${importLines.join('\n')}

const embeddedConfig = ${JSON.stringify(options.config, null, 2)}
const moduleRegistry = {
${registryEntries.join(',\n')}
}

export default {
  fetch: createCloudflareWorkerFetchHandler({
    kanbanDir: ${JSON.stringify(options.kanbanDir)},
    config: embeddedConfig,
    moduleRegistry,
  }),
}
`

  const entryPath = path.join(tempDir, 'worker-entry.mjs')
  fs.writeFileSync(entryPath, generatedEntry, 'utf8')
  return entryPath
}

function createGeneratedWranglerConfig(tempDir, options) {
  const config = `name = ${JSON.stringify(options.name)}
compatibility_date = ${JSON.stringify(options.compatibilityDate)}

[assets]
directory = ${JSON.stringify(standaloneAssetsDir)}
binding = "ASSETS"
`
  const configPath = path.join(tempDir, 'wrangler.toml')
  fs.writeFileSync(configPath, config, 'utf8')
  return configPath
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }

  if (!options.name) fail('Missing required --name')
  if (!options.configPath) fail('Missing required --config')

  const configPath = path.resolve(process.cwd(), options.configPath)
  if (!fs.existsSync(configPath)) {
    fail(`Config file not found: ${configPath}`)
  }

  const embeddedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-lite-cloudflare-'))
  const entryPath = createGeneratedWorker(tempDir, { ...options, config: embeddedConfig })
  const wranglerConfigPath = createGeneratedWranglerConfig(tempDir, options)

  if (!options.skipBuild) {
    run('pnpm', ['run', 'build:worker'], packageRoot)
  }

  const wranglerArgs = ['wrangler', 'deploy', entryPath, '--config', wranglerConfigPath]

  if (options.dryRun) {
    console.log(`Generated worker entry: ${entryPath}`)
    console.log(`Generated wrangler config: ${wranglerConfigPath}`)
    console.log(`Plugins: ${options.plugins.length > 0 ? options.plugins.join(', ') : '(none)'}`)
    console.log(`\n$ npx ${wranglerArgs.join(' ')}`)
    return
  }

  run('npx', wranglerArgs, packageRoot)
}

main()
