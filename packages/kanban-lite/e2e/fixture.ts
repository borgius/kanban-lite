import * as fs from 'node:fs'
import * as path from 'node:path'
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { test as base, expect } from '@playwright/test'

const fixtureDir = __dirname
const kanbanLitePackageDir = path.resolve(fixtureDir, '..')
const standaloneEntrypoint = path.join(kanbanLitePackageDir, 'dist', 'standalone.js')
const scenariosRootDir = path.join(path.resolve(kanbanLitePackageDir, '../..'), 'tmp', 'e2e', 'scenarios')
const fixtureTemplatesDir = path.join(fixtureDir, 'fixtures')
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const pipedStdio: ['ignore', 'pipe', 'pipe'] = ['ignore', 'pipe', 'pipe']

type PipedChildProcess = ChildProcessByStdio<null, Readable, Readable>

const standaloneScenarioDefinitions = {
  'core-workflow': {
    templateDir: path.join(fixtureTemplatesDir, 'workspace-template'),
    port: 4173,
  },
  'comments-checklist': {
    templateDir: path.join(fixtureTemplatesDir, 'comments-checklist'),
    port: 4174,
  },
  'attachments-forms': {
    templateDir: path.join(fixtureTemplatesDir, 'attachments-forms'),
    port: 4175,
  },
  'auth-visibility': {
    templateDir: path.join(fixtureTemplatesDir, 'auth-visibility'),
    port: 4176,
    healthPath: '/auth/login',
  },
  'plugin-options': {
    templateDir: path.join(fixtureTemplatesDir, 'plugin-options'),
    port: 4177,
  },
} as const

export type StandaloneE2EScenarioName = keyof typeof standaloneScenarioDefinitions

export type StandaloneE2EScenario = {
  name: StandaloneE2EScenarioName
  templateDir: string
  scenarioRootDir: string
  workspaceDir: string
  kanbanDir: string
  configPath: string
  port: number
  baseURL: string
  healthURL: string
  startupArguments: readonly string[]
}

type StartedStandaloneE2EServer = {
  scenario: StandaloneE2EScenario
  stop: () => Promise<void>
}

type SpawnErrorMonitor = {
  promise: Promise<never>
  dispose: () => void
}

export const repoRoot = path.resolve(kanbanLitePackageDir, '../..')
export const DEFAULT_STANDALONE_E2E_SCENARIO: StandaloneE2EScenarioName = 'core-workflow'
export const standaloneE2EScenarioNames = Object.keys(standaloneScenarioDefinitions) as StandaloneE2EScenarioName[]

const defaultScenario = resolveStandaloneE2EScenario(DEFAULT_STANDALONE_E2E_SCENARIO)

export const fixtureTemplateDir = defaultScenario.templateDir
export const standaloneE2EWorkspaceDir = defaultScenario.workspaceDir
export const standaloneE2EKanbanDir = defaultScenario.kanbanDir

let standaloneBuildPromise: Promise<void> | null = null

function buildUnknownScenarioMessage(name: string): string {
  return `Unknown Playwright E2E scenario "${name}". Expected one of: ${standaloneE2EScenarioNames.join(', ')}`
}

function captureProcessLogs(child: PipedChildProcess): () => string {
  const output: string[] = []

  const append = (chunk: Buffer | string): void => {
    const text = chunk.toString().trim()
    if (!text) return
    output.push(text)
    if (output.length > 80) output.splice(0, output.length - 80)
  }

  child.stdout.on('data', append)
  child.stderr.on('data', append)

  return () => output.join('\n')
}

function readPreparedScenarioConfig(scenario: StandaloneE2EScenario): { kanbanDirectory: string; port: number } {
  if (!fs.existsSync(scenario.configPath)) {
    throw new Error(`Missing copied Playwright scenario config for "${scenario.name}" at ${scenario.configPath}`)
  }

  let parsedConfig: unknown

  try {
    parsedConfig = JSON.parse(fs.readFileSync(scenario.configPath, 'utf8'))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid Playwright scenario config for "${scenario.name}": ${message}`)
  }

  if (!parsedConfig || typeof parsedConfig !== 'object' || Array.isArray(parsedConfig)) {
    throw new Error(`Playwright scenario config for "${scenario.name}" must parse to an object`)
  }

  const config = parsedConfig as { kanbanDirectory?: unknown; port?: unknown }

  if (config.kanbanDirectory !== '.kanban') {
    throw new Error(
      `Playwright scenario "${scenario.name}" must use kanbanDirectory ".kanban" (received ${JSON.stringify(config.kanbanDirectory)})`,
    )
  }

  if (!Number.isInteger(config.port) || config.port !== scenario.port) {
    throw new Error(
      `Playwright scenario "${scenario.name}" must declare port ${scenario.port} in .kanban.json (received ${JSON.stringify(config.port)})`,
    )
  }

  return {
    kanbanDirectory: config.kanbanDirectory,
    port: config.port,
  }
}

function validatePreparedStandaloneE2EWorkspace(scenario: StandaloneE2EScenario): void {
  const config = readPreparedScenarioConfig(scenario)
  const resolvedKanbanDir = path.resolve(scenario.workspaceDir, config.kanbanDirectory)

  if (resolvedKanbanDir !== scenario.kanbanDir) {
    throw new Error(
      `Playwright scenario "${scenario.name}" resolved kanban directory ${resolvedKanbanDir}, expected ${scenario.kanbanDir}`,
    )
  }

  if (!fs.existsSync(scenario.kanbanDir)) {
    throw new Error(`Missing copied kanban directory for Playwright scenario "${scenario.name}" at ${scenario.kanbanDir}`)
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function createSpawnErrorMonitor(child: PipedChildProcess, label: string): SpawnErrorMonitor {
  let active = true
  let rejectPromise: (error: Error) => void = () => undefined

  const onError = (error: Error): void => {
    if (!active) return
    active = false
    child.off('error', onError)
    rejectPromise(new Error(`Failed to spawn ${label}: ${error.message}`))
  }

  const promise = new Promise<never>((_, reject) => {
    rejectPromise = reject
  })

  child.once('error', onError)

  return {
    promise,
    dispose: () => {
      active = false
      child.off('error', onError)
    },
  }
}

function waitForExit(child: PipedChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve()

  return new Promise((resolve) => {
    const onClose = (): void => {
      clearTimeout(timer)
      resolve()
    }

    const timer = setTimeout(() => {
      child.off('close', onClose)
      resolve()
    }, timeoutMs)

    child.once('close', onClose)
  })
}

async function stopChildProcess(child: PipedChildProcess): Promise<void> {
  if (child.exitCode !== null) return

  child.kill('SIGTERM')
  await waitForExit(child, 10_000)

  if (child.exitCode === null) {
    child.kill('SIGKILL')
    await waitForExit(child, 5_000)
  }
}

function runCommand(command: string, args: readonly string[], cwd: string, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child: PipedChildProcess = spawn(command, [...args], {
      cwd,
      env: process.env,
      stdio: pipedStdio,
    })
    const readLogs = captureProcessLogs(child)

    child.once('error', (error: Error) => {
      reject(new Error(`Failed to ${label}: ${error.message}`))
    })

    child.once('close', (code: number | null, signal: NodeJS.Signals | null) => {
      if (code === 0) {
        resolve()
        return
      }

      const suffix = readLogs()
      reject(
        new Error(
          `Failed to ${label} (exit code: ${code ?? 'null'}, signal: ${signal ?? 'none'}).${suffix ? `\n${suffix}` : ''}`,
        ),
      )
    })
  })
}

async function ensureStandaloneBuild(): Promise<void> {
  standaloneBuildPromise ??= runCommand(
    pnpmCommand,
    ['--filter', 'kanban-lite', 'run', 'build:standalone'],
    repoRoot,
    'build the standalone bundle for Playwright E2E',
  ).catch((error) => {
    standaloneBuildPromise = null
    throw error
  })

  await standaloneBuildPromise
}

async function waitForScenarioHealth(
  scenario: StandaloneE2EScenario,
  child: PipedChildProcess,
  readLogs: () => string,
): Promise<void> {
  const deadline = Date.now() + 120_000
  let lastError = 'server did not answer the health check yet'

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `Standalone server for scenario "${scenario.name}" exited before it became healthy.${readLogs() ? `\n${readLogs()}` : ''}`,
      )
    }

    try {
      const response = await fetch(scenario.healthURL)
      if (response.ok) return
      lastError = `health check returned HTTP ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }

    await delay(250)
  }

  throw new Error(
    `Timed out waiting for scenario "${scenario.name}" to become healthy (${lastError}).${readLogs() ? `\n${readLogs()}` : ''}`,
  )
}

async function startStandaloneE2EServer(scenarioName: StandaloneE2EScenarioName): Promise<StartedStandaloneE2EServer> {
  const scenario = prepareStandaloneE2EWorkspace(scenarioName)

  await ensureStandaloneBuild()

  const child: PipedChildProcess = spawn(process.execPath, [standaloneEntrypoint, ...scenario.startupArguments], {
    cwd: kanbanLitePackageDir,
    env: process.env,
    stdio: pipedStdio,
  })
  const readLogs = captureProcessLogs(child)
  const spawnErrorMonitor = createSpawnErrorMonitor(child, `standalone server for scenario "${scenario.name}"`)

  try {
    await Promise.race([waitForScenarioHealth(scenario, child, readLogs), spawnErrorMonitor.promise])
  } catch (error) {
    await stopChildProcess(child)
    throw error
  } finally {
    spawnErrorMonitor.dispose()
  }

  return {
    scenario,
    stop: async () => {
      await stopChildProcess(child)
    },
  }
}

export function resolveStandaloneE2EScenarioName(name?: string): StandaloneE2EScenarioName {
  if (!name) return DEFAULT_STANDALONE_E2E_SCENARIO

  if ((standaloneE2EScenarioNames as string[]).includes(name)) {
    return name as StandaloneE2EScenarioName
  }

  throw new Error(buildUnknownScenarioMessage(name))
}

export function readStandaloneE2EScenarioNameFromArgs(
  args: readonly string[],
  fallback?: string,
): StandaloneE2EScenarioName {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg !== '--scenario' && arg !== '-s') continue

    const scenarioName = args[index + 1]
    if (!scenarioName) {
      throw new Error('Missing scenario name after --scenario/-s')
    }

    return resolveStandaloneE2EScenarioName(scenarioName)
  }

  return resolveStandaloneE2EScenarioName(fallback)
}

export function resolveStandaloneE2EScenario(
  scenarioName: StandaloneE2EScenarioName = DEFAULT_STANDALONE_E2E_SCENARIO,
): StandaloneE2EScenario {
  const definition = standaloneScenarioDefinitions[scenarioName]
  if (!definition) {
    throw new Error(buildUnknownScenarioMessage(scenarioName))
  }

  const scenarioRootDir = path.join(scenariosRootDir, scenarioName)
  const workspaceDir = path.join(scenarioRootDir, 'workspace')
  const kanbanDir = path.join(workspaceDir, '.kanban')
  const configPath = path.join(workspaceDir, '.kanban.json')
  const baseURL = `http://127.0.0.1:${definition.port}`
  const healthPath = 'healthPath' in definition ? definition.healthPath : '/api/health'

  return {
    name: scenarioName,
    templateDir: definition.templateDir,
    scenarioRootDir,
    workspaceDir,
    kanbanDir,
    configPath,
    port: definition.port,
    baseURL,
    healthURL: `${baseURL}${healthPath}`,
    startupArguments: [
      '--config',
      configPath,
      '--dir',
      kanbanDir,
      '--port',
      String(definition.port),
      '--no-browser',
    ],
  }
}

export function prepareStandaloneE2EWorkspace(
  scenarioName: StandaloneE2EScenarioName = DEFAULT_STANDALONE_E2E_SCENARIO,
): StandaloneE2EScenario {
  const scenario = resolveStandaloneE2EScenario(scenarioName)

  if (!fs.existsSync(scenario.templateDir)) {
    throw new Error(
      `Missing fixture template for Playwright scenario "${scenario.name}" at ${scenario.templateDir}`,
    )
  }

  fs.rmSync(scenario.scenarioRootDir, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(scenario.workspaceDir), { recursive: true })
  fs.cpSync(scenario.templateDir, scenario.workspaceDir, { recursive: true })
  validatePreparedStandaloneE2EWorkspace(scenario)

  return scenario
}

export function describeStandaloneScenario(
  title: string,
  scenarioName: StandaloneE2EScenarioName,
  callback: (scenario: StandaloneE2EScenario) => void,
): void {
  const scenario = resolveStandaloneE2EScenario(scenarioName)

  base.describe(title, () => {
    let startedServer: StartedStandaloneE2EServer | null = null

    base.use({ baseURL: scenario.baseURL })

    base.beforeAll(async () => {
      startedServer = await startStandaloneE2EServer(scenarioName)
    })

    base.afterAll(async () => {
      if (!startedServer) return
      await startedServer.stop()
    })

    callback(scenario)
  })
}

export const test = base
export { expect }
