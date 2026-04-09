import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

const preparedScenarioRoots = new Set<string>()
const originalCwd = process.cwd()
const repoRootDir = fileURLToPath(new URL('../../../../..', import.meta.url))
const packageRootDir = fileURLToPath(new URL('../../..', import.meta.url))
const expectedWaveOneScenarios = [
  { name: 'core-workflow', templateDirName: 'workspace-template', port: 4173 },
  { name: 'comments-checklist', templateDirName: 'comments-checklist', port: 4174 },
  { name: 'attachments-forms', templateDirName: 'attachments-forms', port: 4175 },
  { name: 'auth-visibility', templateDirName: 'auth-visibility', port: 4176 },
  { name: 'plugin-options', templateDirName: 'plugin-options', port: 4177 },
  { name: 'card-drawer', templateDirName: 'card-drawer', port: 4178 },
] as const

async function loadFixtureModule(): Promise<typeof import('../../../e2e/fixture')> {
  return import('../../../e2e/fixture')
}

function trackScenarioWorkspace(workspaceDir: string): void {
  preparedScenarioRoots.add(path.dirname(workspaceDir))
}

afterEach(() => {
  process.chdir(originalCwd)
  vi.resetModules()

  for (const scenarioRoot of preparedScenarioRoots) {
    fs.rmSync(scenarioRoot, { recursive: true, force: true })
  }
  preparedScenarioRoots.clear()
})

describe('Playwright standalone scenario bootstrap', () => {
  it('resolves the same repo-rooted core scenario paths regardless of the current working directory', async () => {
    process.chdir(repoRootDir)
    vi.resetModules()
    const fromRepoRoot = await loadFixtureModule()
    const repoScenario = fromRepoRoot.resolveStandaloneE2EScenario()

    process.chdir(packageRootDir)
    vi.resetModules()
    const fromPackageRoot = await loadFixtureModule()
    const packageScenario = fromPackageRoot.resolveStandaloneE2EScenario()

    expect(packageScenario.templateDir).toBe(repoScenario.templateDir)
    expect(packageScenario.scenarioRootDir).toBe(repoScenario.scenarioRootDir)
    expect(packageScenario.workspaceDir).toBe(repoScenario.workspaceDir)
    expect(packageScenario.templateDir).toContain(path.join('packages', 'kanban-lite', 'e2e', 'fixtures', 'workspace-template'))
  })

  it('advertises the wave-1 scenario registry with explicit template, workspace, and server inputs', async () => {
    const {
      resolveStandaloneE2EScenario,
      standaloneE2EScenarioNames,
    } = await loadFixtureModule()

    expect(standaloneE2EScenarioNames).toEqual(expectedWaveOneScenarios.map((scenario) => scenario.name))

    const baseUrls = new Set<string>()

    for (const expectedScenario of expectedWaveOneScenarios) {
      const resolved = resolveStandaloneE2EScenario(expectedScenario.name)

      expect(resolved.name).toBe(expectedScenario.name)
      expect(resolved.templateDir).toContain(path.join('e2e', 'fixtures', expectedScenario.templateDirName))
      expect(resolved.workspaceDir).toContain(path.join('tmp', 'e2e', 'scenarios', expectedScenario.name, 'workspace'))
      expect(resolved.kanbanDir).toBe(path.join(resolved.workspaceDir, '.kanban'))
      expect(resolved.configPath).toBe(path.join(resolved.workspaceDir, '.kanban.json'))
      expect(resolved.baseURL).toBe(`http://127.0.0.1:${expectedScenario.port}`)
      expect(resolved.healthURL).toBe(`http://127.0.0.1:${expectedScenario.port}/api/health`)
      expect(resolved.startupArguments).toEqual([
        '--config',
        resolved.configPath,
        '--dir',
        resolved.kanbanDir,
        '--port',
        String(expectedScenario.port),
        '--no-browser',
      ])

      baseUrls.add(resolved.baseURL)
    }

    expect(baseUrls.size).toBe(expectedWaveOneScenarios.length)
  })

  it('re-copies a clean workspace for the chosen scenario on every preparation run', async () => {
    const {
      DEFAULT_STANDALONE_E2E_SCENARIO,
      prepareStandaloneE2EWorkspace,
    } = await loadFixtureModule()

    const firstPreparation = prepareStandaloneE2EWorkspace(DEFAULT_STANDALONE_E2E_SCENARIO)
    trackScenarioWorkspace(firstPreparation.workspaceDir)

    const scratchFile = path.join(firstPreparation.workspaceDir, 'scratch.txt')
    fs.writeFileSync(scratchFile, 'mutated during a prior scenario run', 'utf8')
    expect(fs.existsSync(scratchFile)).toBe(true)

    const secondPreparation = prepareStandaloneE2EWorkspace(DEFAULT_STANDALONE_E2E_SCENARIO)
    trackScenarioWorkspace(secondPreparation.workspaceDir)

    expect(secondPreparation.workspaceDir).toBe(firstPreparation.workspaceDir)
    expect(fs.existsSync(scratchFile)).toBe(false)
    expect(fs.existsSync(secondPreparation.configPath)).toBe(true)
    expect(fs.existsSync(secondPreparation.kanbanDir)).toBe(true)
  })

  it('prepares every declared scenario with a resolvable fixture directory and config matching the bootstrap contract', async () => {
    const { prepareStandaloneE2EWorkspace, standaloneE2EScenarioNames } = await loadFixtureModule()

    for (const scenarioName of standaloneE2EScenarioNames) {
      const prepared = prepareStandaloneE2EWorkspace(scenarioName)
      trackScenarioWorkspace(prepared.workspaceDir)

      const parsedConfig = JSON.parse(fs.readFileSync(prepared.configPath, 'utf8')) as {
        kanbanDirectory?: unknown
        port?: unknown
      }

      expect(fs.existsSync(prepared.templateDir)).toBe(true)
      expect(fs.existsSync(prepared.workspaceDir)).toBe(true)
      expect(fs.existsSync(prepared.kanbanDir)).toBe(true)
      expect(parsedConfig.kanbanDirectory).toBe('.kanban')
      expect(parsedConfig.port).toBe(prepared.port)
    }
  })

  it('accepts an explicit core scenario override and otherwise falls back to the default scenario', async () => {
    const {
      DEFAULT_STANDALONE_E2E_SCENARIO,
      readStandaloneE2EScenarioNameFromArgs,
    } = await loadFixtureModule()

    expect(readStandaloneE2EScenarioNameFromArgs(['--scenario', DEFAULT_STANDALONE_E2E_SCENARIO])).toBe(DEFAULT_STANDALONE_E2E_SCENARIO)
    expect(readStandaloneE2EScenarioNameFromArgs(['--scenario', 'plugin-options'])).toBe('plugin-options')
    expect(readStandaloneE2EScenarioNameFromArgs([], undefined)).toBe(DEFAULT_STANDALONE_E2E_SCENARIO)
    expect(() => readStandaloneE2EScenarioNameFromArgs(['--scenario', 'unknown-scenario'])).toThrow(/Unknown Playwright E2E scenario/)
  })
})
