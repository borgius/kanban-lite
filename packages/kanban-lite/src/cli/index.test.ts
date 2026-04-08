import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFile } from 'node:child_process'
import type { ExecFileException } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Card, CardTask } from '../shared/types'
import { KanbanSDK, PluginSettingsOperationError, createPluginSettingsErrorPayload } from '../sdk/KanbanSDK'
import { AuthError } from '../sdk/types'
import { cmdActive, cmdAdd, cmdChecklist, cmdColumns, cmdEdit, cmdForm, cmdLabels, cmdList, cmdPluginSettings, parseArgs, showHelp } from './index'

const execFileAsync = promisify(execFile)
const WORKSPACE_ROOT = path.resolve(__dirname, '../../../..')
const PACKAGE_ROOT = path.resolve(__dirname, '../..')
const TSX_CLI_PATH = path.join(WORKSPACE_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const CLI_ENTRYPOINT = path.join(__dirname, 'index.ts')
const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_PATTERN, '')
}

function createCliAuthWorkspace(): { workspaceDir: string; configPath: string; cleanup: () => void } {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-cli-auth-'))
  fs.mkdirSync(path.join(workspaceDir, '.kanban'), { recursive: true })
  const configPath = path.join(workspaceDir, '.kanban.json')
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      version: 2,
      defaultBoard: 'default',
      kanbanDirectory: '.kanban',
      boards: {
        default: {
          name: 'Default',
          columns: [],
          nextCardId: 1,
          defaultStatus: 'backlog',
          defaultPriority: 'medium',
        },
      },
      auth: {
        'auth.identity': { provider: 'rbac' },
        'auth.policy': { provider: 'rbac' },
      },
    }, null, 2) + '\n',
    'utf-8',
  )
  return {
    workspaceDir,
    configPath,
    cleanup: () => fs.rmSync(workspaceDir, { recursive: true, force: true }),
  }
}

function createCliWorkspace(config: Record<string, unknown>): { workspaceDir: string; configPath: string; cleanup: () => void } {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-cli-plugin-'))
  fs.mkdirSync(path.join(workspaceDir, '.kanban'), { recursive: true })
  const configPath = path.join(workspaceDir, '.kanban.json')
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      version: 2,
      defaultBoard: 'default',
      kanbanDirectory: '.kanban',
      boards: {
        default: {
          name: 'Default',
          columns: [{ id: 'backlog', name: 'Backlog' }],
          nextCardId: 1,
          defaultStatus: 'backlog',
          defaultPriority: 'medium',
        },
      },
      ...config,
    }, null, 2) + '\n',
    'utf-8',
  )
  return {
    workspaceDir,
    configPath,
    cleanup: () => fs.rmSync(workspaceDir, { recursive: true, force: true }),
  }
}

function installTempCliPlugin(packageName: string, entrySource: string): () => void {
  const packageDir = path.join(WORKSPACE_ROOT, 'node_modules', packageName)
  fs.mkdirSync(packageDir, { recursive: true })
  fs.writeFileSync(
    path.join(packageDir, 'package.json'),
    JSON.stringify({ name: packageName, main: 'index.js' }, null, 2),
    'utf-8',
  )
  fs.writeFileSync(path.join(packageDir, 'index.js'), entrySource, 'utf-8')
  return () => fs.rmSync(packageDir, { recursive: true, force: true })
}

function createCliSdkProbePackageSource(packageName: string, command: string): string {
  return [
    "const fs = require('node:fs')",
    `const packageName = ${JSON.stringify(packageName)}`,
    `const command = ${JSON.stringify(command)}`,
    'module.exports.authIdentityPlugin = {',
    '  manifest: { id: packageName, provides: [\'auth.identity\'] },',
    '  async resolveIdentity() { return null },',
    '}',
    'module.exports.cliPlugin = {',
    '  manifest: { id: packageName },',
    '  command,',
    '  async run(subArgs, flags, context) {',
    '    const runWithCliAuthResult = typeof context.runWithCliAuth === "function"',
    '      ? await context.runWithCliAuth(() => Promise.resolve("ok"))',
    '      : null',
    '    const payload = {',
    '      subArgs,',
    '      hasSdk: !!context.sdk,',
    '      hasGetConfigSnapshot: typeof context.sdk?.getConfigSnapshot === "function",',
    '      hasGetBoard: typeof context.sdk?.getBoard === "function",',
    '      hasGetExtension: typeof context.sdk?.getExtension === "function",',
    '      hasWorkspaceRootGetter: typeof context.sdk?.workspaceRoot === "string",',
    '      snapshotDefaultBoard: context.sdk?.getConfigSnapshot?.().defaultBoard ?? null,',
    '      defaultBoardName: context.sdk?.getBoard?.("default")?.name ?? null,',
    '      runWithCliAuthResult,',
    '      workspaceRoot: context.workspaceRoot,',
    '      flagCount: Object.keys(flags || {}).length,',
    '    }',
    '    if (process.env.KANBAN_SDK_PROBE_OUTPUT) {',
    '      fs.writeFileSync(process.env.KANBAN_SDK_PROBE_OUTPUT, JSON.stringify(payload, null, 2))',
    '    }',
    '  },',
    '}',
  ].join('\n')
}

function createCliTokenAuthPackageSource(packageName: string, expectedToken: string): string {
  return [
    `const packageName = ${JSON.stringify(packageName)}`,
    `const expectedToken = ${JSON.stringify(expectedToken)}`,
    'module.exports.authIdentityPlugin = {',
    '  manifest: { id: packageName, provides: [\'auth.identity\'] },',
    '  async resolveIdentity(context) {',
    '    if (!context || context.token !== expectedToken) return null',
    '    return { subject: "cli-token-user", roles: ["admin"] }',
    '  },',
    '}',
    'module.exports.authPolicyPlugin = {',
    '  manifest: { id: packageName, provides: [\'auth.policy\'] },',
    '  async checkPolicy(identity) {',
    '    return identity',
    '      ? { allowed: true, actor: identity.subject }',
    '      : { allowed: false, reason: "auth.identity.missing" }',
    '  },',
    '}',
  ].join('\n')
}

function createCliEventsPluginPackageSource(packageName: string): string {
  return [
    `const packageName = ${JSON.stringify(packageName)}`,
    'module.exports.cardStoragePlugin = {',
    '  manifest: { id: packageName, provides: [\'card.storage\'] },',
    '  createEngine(kanbanDir) {',
    '    return {',
    '      type: "markdown",',
    '      kanbanDir,',
    '      async init() {},',
    '      close() {},',
    '      async migrate() {},',
    '      async ensureBoardDirs() {},',
    '      async deleteBoardData() {},',
    '      async scanCards() { return [] },',
    '      async writeCard() {},',
    '      async moveCard() { return "" },',
    '      async renameCard() { return "" },',
    '      async deleteCard() {},',
    '      getCardDir() { return kanbanDir },',
    '      async copyAttachment() {},',
    '    }',
    '  },',
    '}',
    'module.exports.attachmentStoragePlugin = {',
    '  manifest: { id: packageName, provides: [\'attachment.storage\'] },',
    '  getCardDir(card) { return card?.filePath || null },',
    '  async copyAttachment() {},',
    '}',
    'module.exports.cardStateProvider = {',
    '  manifest: { id: packageName, provides: [\'card.state\'] },',
    '  async getCardState() { return null },',
    '  async setCardState(input) { return { ...input, updatedAt: input.updatedAt || "2026-03-24T00:00:00.000Z" } },',
    '  async getUnreadCursor() { return null },',
    '  async markUnreadReadThrough(input) {',
    '    return {',
    '      actorId: input.actorId,',
    '      boardId: input.boardId,',
    '      cardId: input.cardId,',
    '      domain: "unread",',
    '      value: input.cursor,',
    '      updatedAt: input.cursor.updatedAt || "2026-03-24T00:00:00.000Z"',
    '    }',
    '  },',
    '}',
    'module.exports.sdkExtensionPlugin = {',
    '  manifest: { id: packageName, provides: [\'sdk.extensions\'] },',
    '  events: [',
    '    { event: "workflow.run", phase: "before", label: "Workflow run" },',
    '    { event: "workflow.completed", phase: "after", label: "Workflow completed", apiAfter: true },',
    '  ],',
    '  extensions: {},',
    '}',
  ].join('\n')
}

async function createCliCardStateWorkspace(): Promise<{ workspaceDir: string; configPath: string; cardId: string; cleanup: () => void }> {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-cli-card-state-'))
  fs.mkdirSync(path.join(workspaceDir, '.kanban'), { recursive: true })
  const configPath = path.join(workspaceDir, '.kanban.json')
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      version: 2,
      defaultBoard: 'default',
      kanbanDirectory: '.kanban',
      boards: {
        default: {
          name: 'Default',
          columns: [
            { id: 'backlog', name: 'Backlog' },
            { id: 'todo', name: 'Todo' },
            { id: 'done', name: 'Done' },
          ],
          nextCardId: 1,
          defaultStatus: 'backlog',
          defaultPriority: 'medium',
        },
      },
    }, null, 2) + '\n',
    'utf-8',
  )

  const sdk = new KanbanSDK(path.join(workspaceDir, '.kanban'))
  await sdk.init()
  const card = await sdk.createCard({ content: '# Card state fixture', status: 'todo' })
  await sdk.addLog(card.id, 'Unread activity from CLI fixture')
  sdk.close()

  return {
    workspaceDir,
    configPath,
    cardId: card.id,
    cleanup: () => fs.rmSync(workspaceDir, { recursive: true, force: true }),
  }
}

async function createCliProtectedWorkspaceWithCard(
  authConfig: Record<string, unknown>,
): Promise<{ workspaceDir: string; configPath: string; cardId: string; cleanup: () => void }> {
  const workspace = createCliWorkspace({})
  const sdk = new KanbanSDK(path.join(workspace.workspaceDir, '.kanban'))
  await sdk.init()
  const card = await sdk.createCard({ content: '# Protected card', status: 'backlog' })
  sdk.close()

  const currentConfig = JSON.parse(fs.readFileSync(workspace.configPath, 'utf-8')) as Record<string, unknown>
  fs.writeFileSync(
    workspace.configPath,
    JSON.stringify({
      ...currentConfig,
      auth: authConfig,
    }, null, 2) + '\n',
    'utf-8',
  )

  return {
    ...workspace,
    cardId: card.id,
  }
}

function makeCliCardContent(opts: {
  id: string
  title: string
  labels: string[]
  order: string
}): string {
  const { id, title, labels, order } = opts
  return `---
id: "${id}"
status: "backlog"
priority: "medium"
assignee: null
dueDate: null
created: "2026-03-31T00:00:00.000Z"
modified: "2026-03-31T00:00:00.000Z"
completedAt: null
labels: [${labels.map((label) => `"${label}"`).join(', ')}]
attachments: []
order: "${order}"
---
# ${title}

Visibility fixture.
`
}

function writeCliCardFile(kanbanDir: string, filename: string, content: string, status = 'backlog'): string {
  const targetDir = path.join(kanbanDir, 'boards', 'default', status)
  fs.mkdirSync(targetDir, { recursive: true })
  const filePath = path.join(targetDir, filename)
  fs.writeFileSync(filePath, content, 'utf-8')
  return filePath
}

function createCliVisibilityScopedAuthIdentityPluginSource(packageName: string): string {
  return [
    `const packageName = ${JSON.stringify(packageName)}`,
    'module.exports.authIdentityPlugin = {',
    '  manifest: { id: packageName, provides: [\'auth.identity\'] },',
    '  async resolveIdentity(context) {',
    '    const rawToken = context && typeof context.token === "string" ? context.token : ""',
    '    const token = rawToken.startsWith("Bearer ") ? rawToken.slice(7) : rawToken',
    '    if (token === "reader-token") return { subject: "alice", roles: ["reader"] }',
    '    if (token === "writer-token") return { subject: "casey", roles: ["writer"] }',
    '    return null',
    '  },',
    '}',
  ].join('\n')
}

async function createCliVisibilityWorkspace(packageName: string): Promise<{
  workspaceDir: string
  configPath: string
  publicCardId: string
  privateCardId: string
  cleanup: () => void
}> {
  const workspace = createCliWorkspace({})
  const kanbanDir = path.join(workspace.workspaceDir, '.kanban')
  const publicCardId = 'public-card'
  const privateCardId = 'private-card'
  const hiddenAttachmentPath = path.join(workspace.workspaceDir, 'hidden-attachment.txt')

  writeCliCardFile(
    kanbanDir,
    `${publicCardId}.md`,
    makeCliCardContent({
      id: publicCardId,
      title: 'Public card',
      labels: ['public'],
      order: 'a0',
    }),
  )
  writeCliCardFile(
    kanbanDir,
    `${privateCardId}.md`,
    makeCliCardContent({
      id: privateCardId,
      title: 'Private card',
      labels: ['private'],
      order: 'a1',
    }),
  )

  fs.writeFileSync(hiddenAttachmentPath, 'hidden attachment', 'utf-8')
  fs.writeFileSync(
    path.join(kanbanDir, '.active-card.json'),
    JSON.stringify({
      cardId: privateCardId,
      boardId: 'default',
      updatedAt: '2026-03-31T00:00:00.000Z',
    }),
    'utf-8',
  )

  const sdk = new KanbanSDK(kanbanDir)
  await sdk.init()
  try {
    await sdk.addComment(privateCardId, 'seed-user', 'Hidden comment')
    await sdk.addLog(privateCardId, 'Hidden log')
    await sdk.addAttachment(privateCardId, hiddenAttachmentPath)
  } finally {
    sdk.close()
  }

  const currentConfig = JSON.parse(fs.readFileSync(workspace.configPath, 'utf-8')) as Record<string, unknown>
  fs.writeFileSync(
    workspace.configPath,
    JSON.stringify({
      ...currentConfig,
      plugins: {
        'auth.identity': { provider: packageName },
        'auth.policy': { provider: 'noop' },
        'auth.visibility': {
          provider: 'kl-plugin-auth-visibility',
          options: {
            rules: [
              { roles: ['writer'], labels: ['public', 'private'] },
              { roles: ['reader'], labels: ['public'] },
            ],
          },
        },
      },
    }, null, 2) + '\n',
    'utf-8',
  )

  return {
    ...workspace,
    publicCardId,
    privateCardId,
  }
}

async function runCliCommand(args: string[], envOverrides: Record<string, string | undefined> = {}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const env = { ...process.env }
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) delete env[key]
    else env[key] = value
  }

  try {
    const result = await execFileAsync(
      process.execPath,
      [TSX_CLI_PATH, CLI_ENTRYPOINT, ...args],
      { cwd: PACKAGE_ROOT, env, timeout: 15_000 },
    )
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    const err = error as ExecFileException & { stdout?: string; stderr?: string }
    return {
      exitCode: typeof err.code === 'number' ? err.code : 1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
    }
  }
}

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 'card-1',
    content: '# Card 1\n\nBody',
    status: 'backlog',
    priority: 'medium',
    assignee: null,
    dueDate: null,
    labels: [],
    attachments: [],
    comments: [],
    created: '2026-03-18T00:00:00.000Z',
    modified: '2026-03-18T00:00:00.000Z',
    completedAt: null,
    filePath: '/tmp/card-1.md',
    boardId: 'default',
    order: 'a0',
    metadata: { sprint: 'Q1' },
    actions: [],
    version: 1,
    ...overrides,
  }
}

function makeChecklistTask(title: string, overrides: Partial<CardTask> = {}): CardTask {
  return {
    title,
    description: '',
    checked: false,
    createdAt: '2026-03-18T00:00:00.000Z',
    modifiedAt: '2026-03-18T00:00:00.000Z',
    createdBy: 'test-user',
    modifiedBy: 'test-user',
    ...overrides,
  }
}

function mockProcessExit(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
    throw new Error(`process.exit:${code ?? 0}`)
  }) as typeof process.exit)
}

describe('CLI list command', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('parses --search and --fuzzy while preserving repeatable --meta filters', () => {
    const parsed = parseArgs([
      'node',
      'kl',
      'list',
      '--search',
      'backnd',
      '--fuzzy',
      '--meta',
      'sprint=Q1',
      '--meta',
      'links.jira=PROJ-123',
    ])

    expect(parsed.command).toBe('list')
    expect(parsed.flags.search).toBe('backnd')
    expect(parsed.flags.fuzzy).toBe(true)
    expect(parsed.flags.meta).toEqual(['sprint=Q1', 'links.jira=PROJ-123'])
  })

  it('parses --config for workspace root overrides', () => {
    const parsed = parseArgs([
      'node',
      'kl',
      'list',
      '--config',
      '/tmp/demo/.kanban.json',
    ])

    expect(parsed.command).toBe('list')
    expect(parsed.flags.config).toBe('/tmp/demo/.kanban.json')
  })

  it('delegates search and fuzzy matching to sdk.listCards while preserving JSON output', async () => {
    const sdk = {
      listCards: vi.fn().mockResolvedValue([makeCard()]),
      runWithAuth: vi.fn((ctx: unknown, fn: () => Promise<unknown>) => fn()),
      getLabelsInGroup: vi.fn().mockReturnValue([]),
      getConfigSnapshot: vi.fn().mockReturnValue({
        defaultBoard: 'default',
        boards: {
          default: {
            title: ['sprint'],
          },
        },
      }),
    } as unknown as Pick<KanbanSDK, 'listCards' | 'runWithAuth' | 'getLabelsInGroup' | 'getConfigSnapshot'>
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await cmdList(sdk as KanbanSDK, {
      search: 'backnd',
      fuzzy: true,
      meta: ['sprint=Q1', 'links.jira=PROJ-123'],
      json: true,
    })

    expect(sdk.listCards).toHaveBeenCalledWith(undefined, undefined, {
      metaFilter: { sprint: 'Q1', 'links.jira': 'PROJ-123' },
      searchQuery: 'backnd',
      fuzzy: true,
      sort: undefined,
    })
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(JSON.parse(logSpy.mock.calls[0][0] as string)).toEqual([makeCard()])
  })

  it('renders prefixed display titles in human-readable list output', async () => {
    const sdk = {
      listCards: vi.fn().mockResolvedValue([makeCard({ metadata: { sprint: 'Q1' }, content: '# Ship release' })]),
      runWithAuth: vi.fn((ctx: unknown, fn: () => Promise<unknown>) => fn()),
      getLabelsInGroup: vi.fn().mockReturnValue([]),
      getConfigSnapshot: vi.fn().mockReturnValue({
        defaultBoard: 'default',
        boards: {
          default: {
            title: ['sprint'],
          },
        },
      }),
    } as unknown as Pick<KanbanSDK, 'listCards' | 'runWithAuth' | 'getLabelsInGroup' | 'getConfigSnapshot'>
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await cmdList(sdk as KanbanSDK, {})

    const output = logSpy.mock.calls.map(call => call.join(' ')).join('\n')
    expect(output).toContain('Q1 Ship release')
  })

  it('documents the new list search flags in help text', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    showHelp()

    const helpText = logSpy.mock.calls.map(call => call.join(' ')).join('\n')
    expect(helpText).toContain('--search <text>')
    expect(helpText).toContain('--fuzzy')
    expect(helpText).toContain('--meta key=value')
    expect(helpText).toContain('--config <path>')
    expect(helpText).toContain('--token <value>')
    expect(helpText).toContain('events')
    expect(helpText).toContain('--type <phase>')
    expect(helpText).toContain('--mask <pattern>')
    expect(helpText).toContain('plugin-settings list')
    expect(helpText).toContain('plugin-settings show <capability> <provider>')
    expect(helpText).toContain('plugin-settings select <capability> <provider>')
    expect(helpText).toContain('plugin-settings update-options <capability> <provider>')
    expect(helpText).toContain('plugin-settings install <packageName> --scope <workspace|global>')
    expect(helpText).toContain('form submit <id> <form>')
    expect(helpText).toContain('checklist list <id>')
    expect(helpText).toContain('checklist add <id> --title <title> --expected-token <token>')
    expect(helpText).toContain('checklist check <id> <index> --modified-at <iso>')
    expect(helpText).toContain("--forms '<json|@file>'")
    expect(helpText).toContain("--form-data '<json|@file>'")
    expect(helpText).toContain("--data '<json|@file>'")
  })
})

describe('CLI events command', () => {
  it('lists built-in and plugin-declared events with phase/mask filtering', async () => {
    const packageName = `kanban-cli-events-${Date.now()}`
    const cleanupPlugin = installTempCliPlugin(
      packageName,
      createCliEventsPluginPackageSource(packageName),
    )
    const { configPath, cleanup } = createCliWorkspace({
      plugins: {
        'card.storage': { provider: packageName },
      },
    })

    try {
      const allResult = await runCliCommand(['events', '--json', '--config', configPath])
      expect(allResult.exitCode).toBe(0)
      const allEvents = JSON.parse(allResult.stdout)
      expect(allEvents).toEqual(expect.arrayContaining([
        expect.objectContaining({ event: 'task.created', phase: 'after', source: 'core' }),
        expect.objectContaining({ event: 'workflow.completed', phase: 'after', source: 'plugin', pluginIds: [packageName] }),
      ]))

      const filteredResult = await runCliCommand(['events', '--json', '--type', 'before', '--mask', 'workflow.*', '--config', configPath])
      expect(filteredResult.exitCode).toBe(0)
      expect(JSON.parse(filteredResult.stdout)).toEqual([
        expect.objectContaining({ event: 'workflow.run', phase: 'before', source: 'plugin', pluginIds: [packageName] }),
      ])
    } finally {
      cleanup()
      cleanupPlugin()
    }
  })
})

describe('CLI active command', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('prints the active card as JSON when requested', async () => {
    const sdk = {
      getActiveCard: vi.fn().mockResolvedValue(makeCard({ id: 'active-1' })),
      runWithAuth: vi.fn((ctx: unknown, fn: () => Promise<unknown>) => fn()),
      getConfigSnapshot: vi.fn().mockReturnValue({
        defaultBoard: 'default',
        boards: {
          default: {
            title: ['sprint'],
          },
        },
      }),
    } as unknown as Pick<KanbanSDK, 'getActiveCard' | 'runWithAuth' | 'getConfigSnapshot'>
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await cmdActive(sdk as KanbanSDK, { json: true })

    expect(sdk.getActiveCard).toHaveBeenCalledWith(undefined)
    expect(JSON.parse(logSpy.mock.calls[0][0] as string)).toEqual(makeCard({ id: 'active-1' }))
  })

  it('prints a friendly message when no active card exists', async () => {
    const sdk = {
      getActiveCard: vi.fn().mockResolvedValue(null),
      runWithAuth: vi.fn((ctx: unknown, fn: () => Promise<unknown>) => fn()),
      getConfigSnapshot: vi.fn().mockReturnValue({
        defaultBoard: 'default',
        boards: {
          default: {},
        },
      }),
    } as unknown as Pick<KanbanSDK, 'getActiveCard' | 'runWithAuth' | 'getConfigSnapshot'>
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await cmdActive(sdk as KanbanSDK, {})

    expect(logSpy.mock.calls[0][0]).toContain('No active card')
  })

  it('renders prefixed display titles in active-card detail output', async () => {
    const sdk = {
      getActiveCard: vi.fn().mockResolvedValue(makeCard({ id: 'active-2', content: '# Fix release', metadata: { sprint: 'Q2' } })),
      runWithAuth: vi.fn((ctx: unknown, fn: () => Promise<unknown>) => fn()),
      getConfigSnapshot: vi.fn().mockReturnValue({
        defaultBoard: 'default',
        boards: {
          default: {
            title: ['sprint'],
          },
        },
      }),
    } as unknown as Pick<KanbanSDK, 'getActiveCard' | 'runWithAuth' | 'getConfigSnapshot'>
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await cmdActive(sdk as KanbanSDK, {})

    expect(logSpy.mock.calls[0][0]).toContain('Q2 Fix release')
  })
})

describe('CLI form-aware card commands', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates a card with forms and form data in a single createCard call', async () => {
    const card = makeCard({
      id: 'card-create',
      forms: [{ name: 'bug-report' }],
      formData: { 'bug-report': { severity: 'high' } },
    })
    const sdk = {
      createCard: vi.fn().mockResolvedValue(card),
      runWithAuth: vi.fn((ctx: unknown, fn: () => Promise<unknown>) => fn()),
    } as unknown as Pick<KanbanSDK, 'createCard' | 'runWithAuth'>
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await cmdAdd(sdk as KanbanSDK, {
      title: 'Bug card',
      forms: JSON.stringify([{ name: 'bug-report' }]),
      'form-data': JSON.stringify({ 'bug-report': { severity: 'high' } }),
      json: true,
    })

    expect(sdk.createCard).toHaveBeenCalledWith({
      content: '# Bug card',
      status: undefined,
      priority: 'medium',
      assignee: null,
      dueDate: null,
      labels: [],
      metadata: undefined,
      actions: undefined,
      boardId: undefined,
      forms: [{ name: 'bug-report' }],
      formData: { 'bug-report': { severity: 'high' } },
    })
    expect(JSON.parse(logSpy.mock.calls[0][0] as string)).toEqual(card)
  })

  it('updates forms and form data on an existing card', async () => {
    const sdk = {
      getCard: vi.fn().mockResolvedValue(makeCard({ id: 'card-edit' })),
      updateCard: vi.fn().mockResolvedValue(makeCard({
        id: 'card-edit',
        forms: [{ schema: { type: 'object', title: 'Checklist' } }],
        formData: { checklist: { approved: true } },
      })),
      runWithAuth: vi.fn((ctx: unknown, fn: () => Promise<unknown>) => fn()),
    } as unknown as Pick<KanbanSDK, 'getCard' | 'updateCard' | 'runWithAuth'>
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await cmdEdit(sdk as KanbanSDK, ['card-edit'], {
      forms: JSON.stringify([{ schema: { type: 'object', title: 'Checklist' } }]),
      'form-data': JSON.stringify({ checklist: { approved: true } }),
    })

    expect(sdk.updateCard).toHaveBeenCalledWith('card-edit', {
      forms: [{ schema: { type: 'object', title: 'Checklist' } }],
      formData: { checklist: { approved: true } },
    }, undefined)
    expect(logSpy.mock.calls[0][0]).toContain('Updated: card-edit')
  })

  it('submits a named card form using a JSON payload', async () => {
    const sdk = {
      getCard: vi.fn().mockResolvedValue(makeCard({ id: 'card-submit' })),
      submitForm: vi.fn().mockResolvedValue({
        boardId: 'default',
        card: { ...makeCard({ id: 'card-submit' }), filePath: undefined },
        form: {
          id: 'bug-report',
          name: 'Bug Report',
          description: '',
          label: 'Bug Report',
          schema: { type: 'object' },
          initialData: { severity: 'medium' },
          fromConfig: true,
        },
        data: { severity: 'high' },
      }),
      runWithAuth: vi.fn((ctx: unknown, fn: () => Promise<unknown>) => fn()),
    } as unknown as Pick<KanbanSDK, 'getCard' | 'submitForm' | 'runWithAuth'>
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await cmdForm(sdk as KanbanSDK, ['submit', 'card-submit', 'bug-report'], {
      data: JSON.stringify({ severity: 'high' }),
      json: true,
    })

    expect(sdk.submitForm).toHaveBeenCalledWith({
      cardId: 'card-submit',
      formId: 'bug-report',
      data: { severity: 'high' },
      boardId: undefined,
    })
    expect(JSON.parse(logSpy.mock.calls[0][0] as string)).toMatchObject({
      form: { id: 'bug-report' },
      data: { severity: 'high' },
    })
  })

  it('supports @file JSON payloads for form submission ergonomics', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-cli-form-'))
    const payloadPath = path.join(tempDir, 'payload.json')
    fs.writeFileSync(payloadPath, JSON.stringify({ severity: 'critical' }), 'utf-8')

    const sdk = {
      getCard: vi.fn().mockResolvedValue(makeCard({ id: 'card-submit' })),
      submitForm: vi.fn().mockResolvedValue({
        boardId: 'default',
        card: { ...makeCard({ id: 'card-submit' }), filePath: undefined },
        form: {
          id: 'bug-report',
          name: 'Bug Report',
          description: '',
          label: 'Bug Report',
          schema: { type: 'object' },
          initialData: { severity: 'medium' },
          fromConfig: true,
        },
        data: { severity: 'critical' },
      }),
      runWithAuth: vi.fn((ctx: unknown, fn: () => Promise<unknown>) => fn()),
    } as unknown as Pick<KanbanSDK, 'getCard' | 'submitForm' | 'runWithAuth'>
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      await cmdForm(sdk as KanbanSDK, ['submit', 'card-submit', 'bug-report'], {
        data: `@${payloadPath}`,
        json: true,
      })
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }

    expect(sdk.submitForm).toHaveBeenCalledWith({
      cardId: 'card-submit',
      formId: 'bug-report',
      data: { severity: 'critical' },
      boardId: undefined,
    })
    expect(JSON.parse(logSpy.mock.calls[0][0] as string)).toMatchObject({
      data: { severity: 'critical' },
    })
  })

  it('fails fast when --forms is not valid JSON', async () => {
    const sdk = {
      createCard: vi.fn(),
      updateCard: vi.fn(),
    } as unknown as Pick<KanbanSDK, 'createCard' | 'updateCard'>
    const exitSpy = mockProcessExit()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(cmdAdd(sdk as KanbanSDK, {
      title: 'Bad card',
      forms: '{not-json',
    })).rejects.toThrow('process.exit:1')

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--forms must be valid JSON'))
    expect(sdk.createCard).not.toHaveBeenCalled()
  })

  it('propagates SDK form submission errors', async () => {
    const sdk = {
      getCard: vi.fn().mockResolvedValue(makeCard({ id: 'card-submit' })),
      submitForm: vi.fn().mockRejectedValue(new Error('Invalid form submission for bug-report')),
      runWithAuth: vi.fn((ctx: unknown, fn: () => Promise<unknown>) => fn()),
    } as unknown as Pick<KanbanSDK, 'getCard' | 'submitForm' | 'runWithAuth'>

    await expect(cmdForm(sdk as KanbanSDK, ['submit', 'card-submit', 'bug-report'], {
      data: JSON.stringify({ severity: 'nope' }),
    })).rejects.toThrow('Invalid form submission for bug-report')
  })
})

describe('CLI checklist commands', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('lists visible checklist items with the rich checklist read model', async () => {
    const sdk = {
      getCard: vi.fn().mockResolvedValue(makeCard({
        id: 'card-checklist',
        tasks: [
          makeChecklistTask('Draft release notes'),
          makeChecklistTask('Ship fix', { checked: true }),
        ],
        labels: ['tasks'],
      })),
      runWithAuth: vi.fn((ctx: unknown, fn: () => Promise<unknown>) => fn()),
    } as unknown as Pick<KanbanSDK, 'getCard' | 'runWithAuth'>
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await cmdChecklist(sdk as KanbanSDK, ['list', 'card-checklist'], { json: true })

    expect(sdk.getCard).toHaveBeenCalledWith('card-checklist', undefined)
    const payload = JSON.parse(logSpy.mock.calls[0][0] as string)
    expect(payload).toMatchObject({
      cardId: 'card-checklist',
      boardId: 'default',
      summary: {
        total: 2,
        completed: 1,
        incomplete: 1,
      },
      items: [
        {
          index: 0,
          checked: false,
          title: 'Draft release notes',
          description: '',
          createdAt: '2026-03-18T00:00:00.000Z',
          modifiedAt: '2026-03-18T00:00:00.000Z',
          createdBy: 'test-user',
          modifiedBy: 'test-user',
        },
        {
          index: 1,
          checked: true,
          title: 'Ship fix',
          description: '',
          createdAt: '2026-03-18T00:00:00.000Z',
          modifiedAt: '2026-03-18T00:00:00.000Z',
          createdBy: 'test-user',
          modifiedBy: 'test-user',
        },
      ],
    })
    expect(payload.token).toMatch(/^cl1:/)
  })

  it('passes expectedToken through checklist adds and prints the refreshed checklist token', async () => {
    const updated = makeCard({
      id: 'card-checklist',
      tasks: [
        makeChecklistTask('Draft release notes'),
        makeChecklistTask('Review **docs**'),
      ],
      labels: ['tasks', 'in-progress'],
    })
    const sdk = {
      getCard: vi.fn().mockResolvedValue(makeCard({ id: 'card-checklist' })),
      addChecklistItem: vi.fn().mockResolvedValue(updated),
      runWithAuth: vi.fn((ctx: unknown, fn: () => Promise<unknown>) => fn()),
    } as unknown as Pick<KanbanSDK, 'getCard' | 'addChecklistItem' | 'runWithAuth'>
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await cmdChecklist(sdk as KanbanSDK, ['add', 'card-checklist'], {
      title: 'Review **docs**',
      'expected-token': 'cl1:stale-proof',
      json: true,
    })

    expect(sdk.addChecklistItem).toHaveBeenCalledWith('card-checklist', 'Review **docs**', '', 'cl1:stale-proof', undefined)
    const payload = JSON.parse(logSpy.mock.calls[0][0] as string)
    expect(payload).toMatchObject({
      summary: { total: 2, completed: 0, incomplete: 2 },
      items: [
        {
          index: 0,
          checked: false,
          title: 'Draft release notes',
          description: '',
          createdAt: '2026-03-18T00:00:00.000Z',
          modifiedAt: '2026-03-18T00:00:00.000Z',
          createdBy: 'test-user',
          modifiedBy: 'test-user',
        },
        {
          index: 1,
          checked: false,
          title: 'Review **docs**',
          description: '',
          createdAt: '2026-03-18T00:00:00.000Z',
          modifiedAt: '2026-03-18T00:00:00.000Z',
          createdBy: 'test-user',
          modifiedBy: 'test-user',
        },
      ],
    })
    expect(payload.token).toMatch(/^cl1:/)
  })

  it('passes modifiedAt through checklist edits and prints the caller-scoped result', async () => {
    const updated = makeCard({
      id: 'card-checklist',
      tasks: [makeChecklistTask('Updated copy')],
      labels: ['tasks', 'in-progress'],
    })
    const sdk = {
      getCard: vi.fn().mockResolvedValue(makeCard({
        id: 'card-checklist',
        tasks: [makeChecklistTask('Original copy')],
        labels: ['tasks', 'in-progress'],
      })),
      editChecklistItem: vi.fn().mockResolvedValue(updated),
      runWithAuth: vi.fn((ctx: unknown, fn: () => Promise<unknown>) => fn()),
    } as unknown as Pick<KanbanSDK, 'getCard' | 'editChecklistItem' | 'runWithAuth'>
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await cmdChecklist(sdk as KanbanSDK, ['edit', 'card-checklist', '0'], {
      title: 'Updated copy',
      'modified-at': '2026-03-18T00:00:00.000Z',
      json: true,
    })

    expect(sdk.editChecklistItem).toHaveBeenCalledWith('card-checklist', 0, 'Updated copy', '', '2026-03-18T00:00:00.000Z', undefined)
    const payload = JSON.parse(logSpy.mock.calls[0][0] as string)
    expect(payload).toMatchObject({
      cardId: 'card-checklist',
      boardId: 'default',
      summary: {
        total: 1,
        completed: 0,
        incomplete: 1,
      },
      items: [
        {
          index: 0,
          checked: false,
          title: 'Updated copy',
          description: '',
          createdAt: '2026-03-18T00:00:00.000Z',
          modifiedAt: '2026-03-18T00:00:00.000Z',
          createdBy: 'test-user',
          modifiedBy: 'test-user',
        },
      ],
    })
    expect(payload.token).toMatch(/^cl1:/)
  })
})

describe('CLI admin commands pass auth context', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('passes cli auth context when setting a label', async () => {
    const sdk = {
      setLabel: vi.fn().mockResolvedValue(undefined),
      runWithAuth: vi.fn((ctx: unknown, fn: () => Promise<unknown>) => fn()),
    } as unknown as Pick<KanbanSDK, 'setLabel' | 'runWithAuth'>
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await cmdLabels(sdk as KanbanSDK, ['set', 'bug'], { color: '#e11d48' })

    expect((sdk as KanbanSDK).runWithAuth).toHaveBeenCalledWith(
      expect.objectContaining({ transport: 'cli' }),
      expect.any(Function),
    )
    expect(sdk.setLabel).toHaveBeenCalledWith('bug', { color: '#e11d48', group: undefined })
  })

  it('passes cli auth context when adding a column', async () => {
    const sdk = {
      addColumn: vi.fn().mockResolvedValue([{ id: 'col1', name: 'New', color: '#fff' }]),
      runWithAuth: vi.fn((ctx: unknown, fn: () => Promise<unknown>) => fn()),
    } as unknown as Pick<KanbanSDK, 'addColumn' | 'runWithAuth'>
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await cmdColumns(sdk as KanbanSDK, ['add'], { id: 'col1', name: 'New', color: '#fff' })

    expect((sdk as KanbanSDK).runWithAuth).toHaveBeenCalledWith(
      expect.objectContaining({ transport: 'cli' }),
      expect.any(Function),
    )
    expect(sdk.addColumn).toHaveBeenCalledWith(
      { id: 'col1', name: 'New', color: '#fff' },
      undefined,
    )
  })
})

describe('CLI admin commands propagate AuthError (denial mapping)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('cmdLabels set propagates AuthError when SDK denies the action', async () => {
    const sdk = {
      setLabel: vi.fn().mockRejectedValue(
        new AuthError('auth.policy.denied', 'Action "label.set" denied', undefined),
      ),
      runWithAuth: vi.fn((ctx: unknown, fn: () => Promise<unknown>) => fn()),
    } as unknown as Pick<KanbanSDK, 'setLabel' | 'runWithAuth'>

    await expect(
      cmdLabels(sdk as KanbanSDK, ['set', 'bug'], { color: '#e11d48' }),
    ).rejects.toBeInstanceOf(AuthError)
  })

  it('cmdColumns add propagates AuthError when SDK denies the action', async () => {
    const sdk = {
      addColumn: vi.fn().mockRejectedValue(
        new AuthError('auth.policy.denied', 'Action "column.create" denied', undefined),
      ),
      runWithAuth: vi.fn((ctx: unknown, fn: () => Promise<unknown>) => fn()),
    } as unknown as Pick<KanbanSDK, 'addColumn' | 'runWithAuth'>

    await expect(
      cmdColumns(sdk as KanbanSDK, ['add'], { id: 'col1', name: 'New', color: '#fff' }),
    ).rejects.toBeInstanceOf(AuthError)
  })
})

describe('CLI denial UX regression', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('prints token guidance for auth.identity.missing and exits 1', async () => {
    const { configPath, cleanup } = createCliAuthWorkspace()

    try {
      const result = await runCliCommand([
        'boards',
        'add',
        '--id',
        'ops',
        '--name',
        'Ops',
        '--config',
        configPath,
      ], {
        KANBAN_LITE_TOKEN: undefined,
        KANBAN_TOKEN: undefined,
      })

      expect(result.exitCode).toBe(1)
      expect(stripAnsi(result.stdout)).toBe('')
      expect(stripAnsi(result.stderr)).toContain('Error: Authentication required. Set KANBAN_LITE_TOKEN or pass --token <value>.')
    } finally {
      cleanup()
    }
  })

})

describe('CLI token input regressions', () => {
  it('passes the environment token through comment mutations', async () => {
    const expectedToken = 'kl-env-comment-token'
    const packageName = `kanban-cli-token-auth-${Date.now()}-env`
    const cleanupPlugin = installTempCliPlugin(
      packageName,
      createCliTokenAuthPackageSource(packageName, expectedToken),
    )
    const { cardId, configPath, cleanup } = await createCliProtectedWorkspaceWithCard({
      'auth.identity': { provider: packageName },
      'auth.policy': { provider: packageName },
    })

    try {
      const result = await runCliCommand([
        'comment',
        'add',
        cardId,
        '--author',
        'user',
        '--body',
        'comment via env',
        '--config',
        configPath,
      ], {
        KANBAN_LITE_TOKEN: expectedToken,
        KANBAN_TOKEN: undefined,
      })

      expect(result.exitCode).toBe(0)
      expect(stripAnsi(result.stderr)).toBe('')
      expect(stripAnsi(result.stdout)).toContain('Added comment')

      const showResult = await runCliCommand([
        'show',
        cardId,
        '--json',
        '--config',
        configPath,
      ], {
        KANBAN_LITE_TOKEN: expectedToken,
        KANBAN_TOKEN: undefined,
      })

      expect(showResult.exitCode).toBe(0)
      expect(JSON.parse(showResult.stdout)).toMatchObject({
        comments: [expect.objectContaining({ author: 'user', content: 'comment via env' })],
      })
    } finally {
      cleanup()
      cleanupPlugin()
    }
  })

  it('accepts --token for authenticated CLI mutations when env vars are absent', async () => {
    const expectedToken = 'kl-flag-comment-token'
    const packageName = `kanban-cli-token-auth-${Date.now()}-flag`
    const cleanupPlugin = installTempCliPlugin(
      packageName,
      createCliTokenAuthPackageSource(packageName, expectedToken),
    )
    const { cardId, configPath, cleanup } = await createCliProtectedWorkspaceWithCard({
      'auth.identity': { provider: packageName },
      'auth.policy': { provider: packageName },
    })

    try {
      const status = await runCliCommand([
        'auth',
        'status',
        '--token',
        expectedToken,
        '--config',
        configPath,
      ], {
        KANBAN_LITE_TOKEN: undefined,
        KANBAN_TOKEN: undefined,
      })

      expect(status.exitCode).toBe(0)
      expect(stripAnsi(status.stdout)).toContain('Token present:     yes')
      expect(stripAnsi(status.stdout)).toContain('Token source:      flag')

      const result = await runCliCommand([
        'comment',
        'add',
        cardId,
        '--author',
        'user',
        '--body',
        'comment via flag',
        '--token',
        expectedToken,
        '--config',
        configPath,
      ], {
        KANBAN_LITE_TOKEN: undefined,
        KANBAN_TOKEN: undefined,
      })

      expect(result.exitCode).toBe(0)
      expect(stripAnsi(result.stderr)).toBe('')
      expect(stripAnsi(result.stdout)).toContain('Added comment')

      const showResult = await runCliCommand([
        'show',
        cardId,
        '--json',
        '--config',
        configPath,
      ], {
        KANBAN_LITE_TOKEN: undefined,
        KANBAN_TOKEN: undefined,
      })

      expect(showResult.exitCode).toBe(0)
      expect(JSON.parse(showResult.stdout)).toMatchObject({
        comments: [expect.objectContaining({ author: 'user', content: 'comment via flag' })],
      })
    } finally {
      cleanup()
      cleanupPlugin()
    }
  })
})

describe('CLI card-state commands', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exposes backend/default-actor status and side-effect-free unread summaries via card-state status', async () => {
    const { configPath, cardId, cleanup } = await createCliCardStateWorkspace()

    try {
      const providerStatus = await runCliCommand(['card-state', 'status', '--json', '--config', configPath])
      expect(providerStatus.exitCode).toBe(0)
      expect(JSON.parse(providerStatus.stdout)).toMatchObject({
        provider: 'localfs',
        active: true,
        backend: 'builtin',
        availability: 'available',
        defaultActorAvailable: true,
        defaultActor: {
          id: 'default-user',
          source: 'default',
          mode: 'auth-absent-only',
        },
      })

      const activeBefore = await runCliCommand(['active', '--json', '--config', configPath])
      expect(activeBefore.exitCode).toBe(0)
      expect(JSON.parse(activeBefore.stdout)).toBeNull()

      const cardStatus = await runCliCommand(['card-state', 'status', cardId, '--json', '--config', configPath])
      expect(cardStatus.exitCode).toBe(0)
      expect(JSON.parse(cardStatus.stdout)).toMatchObject({
        cardId,
        boardId: 'default',
        cardState: {
          unread: {
            actorId: 'default-user',
            boardId: 'default',
            cardId,
            unread: true,
            readThrough: null,
          },
          open: null,
        },
      })

      const activeAfter = await runCliCommand(['active', '--json', '--config', configPath])
      expect(activeAfter.exitCode).toBe(0)
      expect(JSON.parse(activeAfter.stdout)).toBeNull()
    } finally {
      cleanup()
    }
  })

  it('keeps active-card state untouched while explicit read/open commands mutate unread through card-state APIs', async () => {
    const { configPath, cardId, cleanup } = await createCliCardStateWorkspace()

    try {
      const readResult = await runCliCommand(['card-state', 'read', cardId, '--json', '--config', configPath])
      expect(readResult.exitCode).toBe(0)
      expect(JSON.parse(readResult.stdout)).toMatchObject({
        unread: {
          actorId: 'default-user',
          boardId: 'default',
          cardId,
          unread: false,
        },
        cardState: {
          open: null,
        },
      })

      const activeAfterRead = await runCliCommand(['active', '--json', '--config', configPath])
      expect(activeAfterRead.exitCode).toBe(0)
      expect(JSON.parse(activeAfterRead.stdout)).toBeNull()

      const sdk = new KanbanSDK(path.join(path.dirname(configPath), '.kanban'))
      await sdk.addLog(cardId, 'Second unread activity from CLI fixture')
      sdk.close()

      const openResult = await runCliCommand(['card-state', 'open', cardId, '--json', '--config', configPath])
      expect(openResult.exitCode).toBe(0)
      const openJson = JSON.parse(openResult.stdout)
      expect(openJson).toMatchObject({
        unread: {
          actorId: 'default-user',
          boardId: 'default',
          cardId,
          unread: false,
        },
        cardState: {
          open: {
            actorId: 'default-user',
            boardId: 'default',
            cardId,
            domain: 'open',
            value: {
              openedAt: expect.any(String),
              readThrough: openJson.unread.latestActivity,
            },
          },
        },
      })

      const activeAfterOpen = await runCliCommand(['active', '--json', '--config', configPath])
      expect(activeAfterOpen.exitCode).toBe(0)
      expect(JSON.parse(activeAfterOpen.stdout)).toBeNull()
    } finally {
      cleanup()
    }
  })

  it('preserves identity-unavailable parity across card-state status/open/read failures', async () => {
    const { configPath, cleanup } = createCliAuthWorkspace()

    try {
      const commands = [
        ['card-state', 'status', 'missing-card'],
        ['card-state', 'open', 'missing-card'],
        ['card-state', 'read', 'missing-card'],
      ]

      for (const args of commands) {
        const result = await runCliCommand([...args, '--json', '--config', configPath], {
          KANBAN_LITE_TOKEN: undefined,
          KANBAN_TOKEN: undefined,
        })

        expect(result.exitCode).toBe(1)
        expect(stripAnsi(result.stdout)).toBe('')
        expect(JSON.parse(result.stderr)).toEqual({
          code: 'ERR_CARD_STATE_IDENTITY_UNAVAILABLE',
          availability: 'identity-unavailable',
          message: 'card.state requires a resolved actor from the configured auth.identity provider',
        })
      }
    } finally {
      cleanup()
    }
  })
})

describe('CLI auth visibility parity', () => {
  it('uses CLI auth scope for list, active, and show reads while preserving multiple-match UX for visible cards', async () => {
    const packageName = `kanban-cli-auth-visibility-${Date.now()}-reads`
    const cleanupPlugin = installTempCliPlugin(
      packageName,
      createCliVisibilityScopedAuthIdentityPluginSource(packageName),
    )
    const { configPath, cleanup, publicCardId } = await createCliVisibilityWorkspace(packageName)

    try {
      const readerList = await runCliCommand(['list', '--json', '--config', configPath], {
        KANBAN_LITE_TOKEN: 'reader-token',
        KANBAN_TOKEN: undefined,
      })
      expect(readerList.exitCode).toBe(0)
      expect((JSON.parse(readerList.stdout) as Array<{ id: string }>).map((card) => card.id)).toEqual([publicCardId])

      const readerActive = await runCliCommand(['active', '--json', '--config', configPath], {
        KANBAN_LITE_TOKEN: 'reader-token',
        KANBAN_TOKEN: undefined,
      })
      expect(readerActive.exitCode).toBe(0)
      expect(JSON.parse(readerActive.stdout)).toBeNull()

      const readerShow = await runCliCommand(['show', 'card', '--json', '--config', configPath], {
        KANBAN_LITE_TOKEN: 'reader-token',
        KANBAN_TOKEN: undefined,
      })
      expect(readerShow.exitCode).toBe(0)
      expect(JSON.parse(readerShow.stdout)).toMatchObject({ id: publicCardId })

      const writerShow = await runCliCommand(['show', 'card', '--config', configPath], {
        KANBAN_LITE_TOKEN: 'writer-token',
        KANBAN_TOKEN: undefined,
      })
      expect(writerShow.exitCode).toBe(1)
      expect(stripAnsi(writerShow.stderr)).toContain('Multiple cards match "card":')
    } finally {
      cleanup()
      cleanupPlugin()
    }
  })

  it('uses CLI auth scope for card-targeted list handlers and mutation preflight resolution', async () => {
    const packageName = `kanban-cli-auth-visibility-${Date.now()}-targets`
    const cleanupPlugin = installTempCliPlugin(
      packageName,
      createCliVisibilityScopedAuthIdentityPluginSource(packageName),
    )
    const { configPath, cleanup, publicCardId, privateCardId } = await createCliVisibilityWorkspace(packageName)

    try {
      for (const args of [
        ['attach', 'list', privateCardId],
        ['comment', 'list', privateCardId],
        ['log', 'list', privateCardId],
      ]) {
        const result = await runCliCommand([...args, '--json', '--config', configPath], {
          KANBAN_LITE_TOKEN: 'reader-token',
          KANBAN_TOKEN: undefined,
        })
        expect(result.exitCode).toBe(1)
        expect(stripAnsi(result.stderr)).toContain(`Card not found: ${privateCardId}`)
      }

      const addComment = await runCliCommand([
        'comment',
        'add',
        'card',
        '--author',
        'reader',
        '--body',
        'partial visible comment',
        '--config',
        configPath,
      ], {
        KANBAN_LITE_TOKEN: 'reader-token',
        KANBAN_TOKEN: undefined,
      })
      expect(addComment.exitCode).toBe(0)
      expect(stripAnsi(addComment.stdout)).toContain(`Added comment c1 to card ${publicCardId}`)

      const publicShow = await runCliCommand(['show', publicCardId, '--json', '--config', configPath], {
        KANBAN_LITE_TOKEN: 'reader-token',
        KANBAN_TOKEN: undefined,
      })
      expect(publicShow.exitCode).toBe(0)
      expect(JSON.parse(publicShow.stdout)).toMatchObject({
        id: publicCardId,
        comments: [expect.objectContaining({ author: 'reader', content: 'partial visible comment' })],
      })
    } finally {
      cleanup()
      cleanupPlugin()
    }
  })
})

describe('Webhook CLI routing — plugin-owned dispatch', () => {
  let workspaceDir: string
  let configPath: string

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-wh-route-'))
    fs.mkdirSync(path.join(workspaceDir, '.kanban'), { recursive: true })
    configPath = path.join(workspaceDir, '.kanban.json')
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        version: 2,
        defaultBoard: 'default',
        kanbanDirectory: '.kanban',
        boards: {
          default: {
            name: 'Default',
            columns: [{ id: 'backlog', name: 'Backlog' }],
            nextCardId: 1,
            defaultStatus: 'backlog',
            defaultPriority: 'medium',
          },
        },
      }, null, 2) + '\n',
      'utf-8',
    )
  })

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('routes "webhooks list" through kl-plugin-webhook cliPlugin (exits 0, no "Unknown command")', async () => {
    const result = await runCliCommand(['webhooks', 'list', '--config', configPath])
    expect(result.exitCode).toBe(0)
    expect(stripAnsi(result.stdout + result.stderr)).not.toMatch(/unknown command/i)
  })

  it('routes "wh list" through kl-plugin-webhook cliPlugin (exits 0, no "Unknown command")', async () => {
    const result = await runCliCommand(['wh', 'list', '--config', configPath])
    expect(result.exitCode).toBe(0)
    expect(stripAnsi(result.stdout + result.stderr)).not.toMatch(/unknown command/i)
  })

  it('routes "webhook list" through kl-plugin-webhook cliPlugin (exits 0, no "Unknown command")', async () => {
    const result = await runCliCommand(['webhook', 'list', '--config', configPath])
    expect(result.exitCode).toBe(0)
    expect(stripAnsi(result.stdout + result.stderr)).not.toMatch(/unknown command/i)
  })

  it('preserves JSON output for the alias path', async () => {
    const result = await runCliCommand(['wh', 'list', '--json', '--config', configPath])
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual([])
  })
})

describe('CLI plugin context SDK injection regressions', () => {
  it('passes the full public SDK to standard CLI plugin commands', async () => {
    const packageName = `kanban-cli-sdk-probe-${Date.now()}-standard`
    const cleanupPlugin = installTempCliPlugin(
      packageName,
      createCliSdkProbePackageSource(packageName, 'sdk-probe'),
    )
    const { workspaceDir, configPath, cleanup } = createCliWorkspace({
      auth: {
        'auth.identity': { provider: packageName },
      },
    })
    const markerPath = path.join(workspaceDir, 'sdk-probe-standard.json')

    try {
      const result = await runCliCommand(['sdk-probe', '--config', configPath], {
        KANBAN_SDK_PROBE_OUTPUT: markerPath,
      })

      expect(result.exitCode).toBe(0)
      const payload = JSON.parse(fs.readFileSync(markerPath, 'utf-8')) as Record<string, unknown>
      expect(payload).toMatchObject({
        subArgs: [],
        hasSdk: true,
        hasGetConfigSnapshot: true,
        hasGetBoard: true,
        hasGetExtension: true,
        hasWorkspaceRootGetter: true,
        snapshotDefaultBoard: 'default',
        defaultBoardName: 'Default',
        runWithCliAuthResult: 'ok',
        workspaceRoot: workspaceDir,
      })
    } finally {
      cleanup()
      cleanupPlugin()
    }
  })

  it('passes the full public SDK through the auth special-case CLI path', async () => {
    const packageName = `kanban-cli-sdk-probe-${Date.now()}-auth`
    const cleanupPlugin = installTempCliPlugin(
      packageName,
      createCliSdkProbePackageSource(packageName, 'auth'),
    )
    const { workspaceDir, configPath, cleanup } = createCliWorkspace({
      auth: {
        'auth.identity': { provider: packageName },
      },
    })
    const markerPath = path.join(workspaceDir, 'sdk-probe-auth.json')

    try {
      const result = await runCliCommand(['auth', 'inspect', '--config', configPath], {
        KANBAN_SDK_PROBE_OUTPUT: markerPath,
      })

      expect(result.exitCode).toBe(0)
      const payload = JSON.parse(fs.readFileSync(markerPath, 'utf-8')) as Record<string, unknown>
      expect(payload).toMatchObject({
        subArgs: ['inspect'],
        hasSdk: true,
        hasGetConfigSnapshot: true,
        hasGetBoard: true,
        hasGetExtension: true,
        hasWorkspaceRootGetter: true,
        snapshotDefaultBoard: 'default',
        defaultBoardName: 'Default',
        runWithCliAuthResult: 'ok',
        workspaceRoot: workspaceDir,
      })
    } finally {
      cleanup()
      cleanupPlugin()
    }
  })
})

describe('CLI plugin-settings commands', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps list/show output redacted in both JSON and human-readable flows', async () => {
    const { configPath, cleanup } = createCliWorkspace({
      auth: {
        'auth.identity': {
          provider: 'local',
          options: {
            apiToken: 'inventory-local-token',
            users: [{ username: 'alice', password: 'super-secret-password', role: 'admin' }],
          },
        },
        'auth.policy': { provider: 'local' },
      },
    })

    try {
      const authEnv = {
        KANBAN_LITE_TOKEN: 'inventory-local-token',
        KANBAN_TOKEN: undefined,
      }

      const listResult = await runCliCommand(['plugin-settings', 'list', '--json', '--config', configPath], authEnv)
      expect(listResult.exitCode).toBe(0)
      const listJson = JSON.parse(listResult.stdout)
      expect(listJson).toMatchObject({
        redaction: expect.objectContaining({ maskedValue: '••••••' }),
        capabilities: expect.arrayContaining([
          expect.objectContaining({
            capability: 'auth.identity',
            selected: expect.objectContaining({ providerId: 'local' }),
            providers: expect.arrayContaining([
              expect.objectContaining({
                providerId: 'local',
                packageName: 'kl-plugin-auth',
                isSelected: true,
              }),
            ]),
          }),
        ]),
      })
      expect(listResult.stdout).not.toContain('inventory-local-token')
      expect(listResult.stdout).not.toContain('super-secret-password')

      const listHumanResult = await runCliCommand(['plugin-settings', 'list', '--config', configPath], authEnv)
      expect(listHumanResult.exitCode).toBe(0)
      expect(stripAnsi(listHumanResult.stdout)).toContain('auth.identity')
      expect(stripAnsi(listHumanResult.stdout)).toContain('local')
      expect(listHumanResult.stdout).not.toContain('inventory-local-token')
      expect(listHumanResult.stdout).not.toContain('super-secret-password')

      const showJsonResult = await runCliCommand(['plugin-settings', 'show', 'auth.identity', 'local', '--json', '--config', configPath], authEnv)
      expect(showJsonResult.exitCode).toBe(0)
      expect(JSON.parse(showJsonResult.stdout)).toMatchObject({
        capability: 'auth.identity',
        providerId: 'local',
        selected: expect.objectContaining({ providerId: 'local' }),
        options: {
          values: {
            apiToken: '••••••',
            users: [{ username: 'alice', password: '••••••', role: 'admin' }],
          },
          redactedPaths: expect.arrayContaining(['apiToken', 'users[0].password']),
        },
      })
      expect(showJsonResult.stdout).not.toContain('inventory-local-token')
      expect(showJsonResult.stdout).not.toContain('super-secret-password')

      const showHumanResult = await runCliCommand(['plugin-settings', 'show', 'auth.identity', 'local', '--config', configPath], authEnv)
      expect(showHumanResult.exitCode).toBe(0)
      expect(stripAnsi(showHumanResult.stdout)).toContain('Capability:')
      expect(stripAnsi(showHumanResult.stdout)).toContain('••••••')
      expect(showHumanResult.stdout).not.toContain('inventory-local-token')
      expect(showHumanResult.stdout).not.toContain('super-secret-password')
    } finally {
      cleanup()
    }
  }, 20_000)

  it('routes plugin-settings list/show through CLI auth and prints token guidance for denied reads', async () => {
    const { configPath, cleanup } = createCliWorkspace({
      auth: {
        'auth.identity': {
          provider: 'local',
          options: {
            apiToken: 'inventory-local-token',
          },
        },
        'auth.policy': { provider: 'local' },
      },
    })

    try {
      for (const args of [
        ['plugin-settings', 'list', '--config', configPath],
        ['plugin-settings', 'show', 'auth.identity', 'local', '--config', configPath],
      ]) {
        const result = await runCliCommand(args, {
          KANBAN_LITE_TOKEN: undefined,
          KANBAN_TOKEN: undefined,
        })

        expect(result.exitCode).toBe(1)
        expect(stripAnsi(result.stdout)).toBe('')
        expect(stripAnsi(result.stderr)).toContain('Error: Authentication required. Set KANBAN_LITE_TOKEN or pass --token <value>.')
      }
    } finally {
      cleanup()
    }
  }, 20_000)

  it('persists provider selection and provider options via the SDK-backed flow', async () => {
    const { configPath, cleanup } = createCliWorkspace({
      plugins: {
        'card.storage': { provider: 'sqlite', options: { sqlitePath: '.kanban/custom.db' } },
        'attachment.storage': { provider: 'localfs' },
      },
      auth: {
        'auth.identity': { provider: 'noop' },
        'auth.policy': { provider: 'noop' },
      },
    })

    try {
      const selectResult = await runCliCommand([
        'plugin-settings',
        'select',
        'card.storage',
        'markdown',
        '--json',
        '--config',
        configPath,
      ])

      expect(selectResult.exitCode).toBe(0)
      expect(JSON.parse(selectResult.stdout)).toMatchObject({
        capability: 'card.storage',
        providerId: 'localfs',
        selected: {
          capability: 'card.storage',
          providerId: 'localfs',
          source: 'config',
        },
      })

      const updateResult = await runCliCommand([
        'plugin-settings',
        'update-options',
        'auth.identity',
        'local',
        '--options',
        JSON.stringify({
          apiToken: 'updated-local-token',
          users: [{ username: 'alice', password: '$2b$12$new-hash', role: 'manager' }],
        }),
        '--json',
        '--config',
        configPath,
      ])

      expect(updateResult.exitCode).toBe(0)
      expect(JSON.parse(updateResult.stdout)).toMatchObject({
        capability: 'auth.identity',
        providerId: 'local',
        selected: {
          capability: 'auth.identity',
          providerId: 'noop',
          source: 'legacy',
        },
        options: {
          values: {
            apiToken: '••••••',
            users: [{ username: 'alice', password: '••••••', role: 'manager' }],
          },
        },
      })

      const persistedConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
        plugins: Record<string, { provider: string; options?: Record<string, unknown> }>
        auth: Record<string, { provider: string; options?: Record<string, unknown> }>
      }
      expect(persistedConfig.plugins['card.storage']).toEqual({ provider: 'localfs' })
      expect(persistedConfig.plugins['attachment.storage']).toBeUndefined()
      expect(persistedConfig.auth['auth.identity']).toEqual({ provider: 'noop' })
      expect(persistedConfig).not.toHaveProperty('pluginOptions')
    } finally {
      cleanup()
    }
  }, 20_000)

  it('exposes config.storage read, select, and cached update flows via the generic plugin-settings commands', async () => {
    const { configPath, cleanup } = createCliWorkspace({
      plugins: {
        'card.storage': { provider: 'sqlite', options: { sqlitePath: '.kanban/cards.db' } },
        'config.storage': { provider: 'localfs' },
      },
      auth: {
        'auth.identity': { provider: 'noop' },
        'auth.policy': { provider: 'noop' },
      },
    })

    try {
      const showResult = await runCliCommand([
        'plugin-settings',
        'show',
        'config.storage',
        'localfs',
        '--json',
        '--config',
        configPath,
      ])

      expect(showResult.exitCode).toBe(0)
      expect(JSON.parse(showResult.stdout)).toMatchObject({
        capability: 'config.storage',
        providerId: 'localfs',
        selected: {
          capability: 'config.storage',
          providerId: 'localfs',
          source: 'config',
          resolution: {
            configured: { provider: 'localfs' },
            effective: { provider: 'localfs' },
            mode: 'explicit',
            failure: null,
          },
        },
      })

      const selectResult = await runCliCommand([
        'plugin-settings',
        'select',
        'config.storage',
        'markdown',
        '--json',
        '--config',
        configPath,
      ])

      expect(selectResult.exitCode).toBe(0)
      expect(JSON.parse(selectResult.stdout)).toMatchObject({
        capability: 'config.storage',
        providerId: 'localfs',
        selected: {
          capability: 'config.storage',
          providerId: 'localfs',
          source: 'config',
          resolution: {
            configured: { provider: 'localfs' },
            effective: { provider: 'localfs' },
            mode: 'explicit',
            failure: null,
          },
        },
      })

      const updateResult = await runCliCommand([
        'plugin-settings',
        'update-options',
        'config.storage',
        'localfs',
        '--options',
        JSON.stringify({ rootDir: '.kanban/config' }),
        '--json',
        '--config',
        configPath,
      ])

      expect(updateResult.exitCode).toBe(0)
      expect(JSON.parse(updateResult.stdout)).toMatchObject({
        capability: 'config.storage',
        providerId: 'localfs',
        selected: {
          capability: 'config.storage',
          providerId: 'localfs',
          source: 'config',
          resolution: {
            configured: {
              provider: 'localfs',
              options: { rootDir: '.kanban/config' },
            },
            effective: {
              provider: 'localfs',
              options: { rootDir: '.kanban/config' },
            },
            mode: 'explicit',
            failure: null,
          },
        },
      })

      const persistedConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
        plugins: Record<string, { provider: string; options?: Record<string, unknown> }>
      }

      expect(persistedConfig.plugins['config.storage']).toEqual({
        provider: 'localfs',
        options: { rootDir: '.kanban/config' },
      })
    } finally {
      cleanup()
    }
  }, 20_000)

  it('rejects raw npm flags for guarded plugin installs before delegating to the SDK installer', async () => {
    const sdk = {
      installPluginSettingsPackage: vi.fn(),
      runWithAuth: vi.fn((ctx: unknown, fn: () => Promise<unknown>) => fn()),
    } as unknown as Pick<KanbanSDK, 'installPluginSettingsPackage' | 'runWithAuth'>
    const exitSpy = mockProcessExit()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(cmdPluginSettings(sdk as KanbanSDK, ['install', 'kl-plugin-auth'], {
      scope: 'workspace',
      'save-dev': true,
    })).rejects.toThrow('process.exit:1')

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('plugin-settings install accepts only --scope'))
    expect(sdk.installPluginSettingsPackage).not.toHaveBeenCalled()
  })

  it('surfaces sanitized install failures instead of raw subprocess diagnostics', async () => {
    const sdk = {
      installPluginSettingsPackage: vi.fn().mockRejectedValue(
        new PluginSettingsOperationError(createPluginSettingsErrorPayload({
          code: 'plugin-settings-install-failed',
          message: 'Unable to install plugin package. In-product installs disable lifecycle scripts; install the package manually if it requires lifecycle scripts.',
          details: {
            packageName: 'kl-plugin-auth',
            scope: 'workspace',
            exitCode: 1,
            stderr: 'Authorization: Bearer [REDACTED]\npassword=[REDACTED]',
            manualInstall: {
              command: 'npm',
              args: ['install', 'kl-plugin-auth'],
              cwd: '/tmp/demo',
              shell: false,
            },
          },
        })),
      ),
      runWithAuth: vi.fn((ctx: unknown, fn: () => Promise<unknown>) => fn()),
    } as unknown as Pick<KanbanSDK, 'installPluginSettingsPackage' | 'runWithAuth'>
    const exitSpy = mockProcessExit()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(cmdPluginSettings(sdk as KanbanSDK, ['install', 'kl-plugin-auth'], {
      scope: 'workspace',
      json: true,
    })).rejects.toThrow('process.exit:1')

    expect(exitSpy).toHaveBeenCalledWith(1)
    const serializedError = errorSpy.mock.calls.map(call => call.join(' ')).join('\n')
    expect(serializedError).toContain('[REDACTED]')
    expect(serializedError).toContain('install the package manually')
    expect(serializedError).not.toContain('npm_super_secret_token')
    expect(serializedError).not.toContain('super-secret-password')
  })

  it.each(['get', 'read', 'options', 'update'])('rejects undocumented plugin-settings alias verb "%s"', async alias => {
    const exitSpy = mockProcessExit()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(cmdPluginSettings({} as KanbanSDK, [alias], {})).rejects.toThrow('process.exit:1')

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(errorSpy).toHaveBeenLastCalledWith('Usage: kl plugin-settings <list|show|select|update-options|install>')
  })

  it.each(['plugin', 'plugins'])('rejects removed top-level plugin-settings alias "%s"', async alias => {
    const result = await runCliCommand([alias, 'list'])

    expect(result.exitCode).toBe(1)
    expect(stripAnsi(result.stderr)).toContain(`Unknown command: ${alias}`)
    expect(stripAnsi(result.stdout)).toContain('plugin-settings list')
  })
})

