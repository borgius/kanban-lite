import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFile } from 'node:child_process'
import type { ExecFileException } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Card } from '../shared/types'
import type { KanbanSDK } from '../sdk/KanbanSDK'
import { AuthError } from '../sdk/types'
import { cmdActive, cmdAdd, cmdColumns, cmdEdit, cmdForm, cmdLabels, cmdList, parseArgs, showHelp } from './index'

const execFileAsync = promisify(execFile)
const WORKSPACE_ROOT = path.resolve(__dirname, '../../../..')
const PACKAGE_ROOT = path.resolve(__dirname, '../..')
const TSX_CLI_PATH = path.join(WORKSPACE_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const CLI_ENTRYPOINT = path.join(__dirname, 'index.ts')

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, '')
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
      getLabelsInGroup: vi.fn().mockReturnValue([]),
    } as unknown as Pick<KanbanSDK, 'listCards' | 'getLabelsInGroup'>
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

  it('documents the new list search flags in help text', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    showHelp()

    const helpText = logSpy.mock.calls.map(call => call.join(' ')).join('\n')
    expect(helpText).toContain('--search <text>')
    expect(helpText).toContain('--fuzzy')
    expect(helpText).toContain('--meta key=value')
    expect(helpText).toContain('--config <path>')
    expect(helpText).toContain('form submit <id> <form>')
    expect(helpText).toContain("--forms '<json|@file>'")
    expect(helpText).toContain("--form-data '<json|@file>'")
    expect(helpText).toContain("--data '<json|@file>'")
  })
})

describe('CLI active command', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('prints the active card as JSON when requested', async () => {
    const sdk = {
      getActiveCard: vi.fn().mockResolvedValue(makeCard({ id: 'active-1' })),
    } as unknown as Pick<KanbanSDK, 'getActiveCard'>
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await cmdActive(sdk as KanbanSDK, { json: true })

    expect(sdk.getActiveCard).toHaveBeenCalledWith(undefined)
    expect(JSON.parse(logSpy.mock.calls[0][0] as string)).toEqual(makeCard({ id: 'active-1' }))
  })

  it('prints a friendly message when no active card exists', async () => {
    const sdk = {
      getActiveCard: vi.fn().mockResolvedValue(null),
    } as unknown as Pick<KanbanSDK, 'getActiveCard'>
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await cmdActive(sdk as KanbanSDK, {})

    expect(logSpy.mock.calls[0][0]).toContain('No active card')
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
    } as unknown as Pick<KanbanSDK, 'createCard'>
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
    } as unknown as Pick<KanbanSDK, 'getCard' | 'updateCard'>
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
    } as unknown as Pick<KanbanSDK, 'getCard' | 'submitForm'>
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
    } as unknown as Pick<KanbanSDK, 'getCard' | 'submitForm'>
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
    } as unknown as Pick<KanbanSDK, 'getCard' | 'submitForm'>

    await expect(cmdForm(sdk as KanbanSDK, ['submit', 'card-submit', 'bug-report'], {
      data: JSON.stringify({ severity: 'nope' }),
    })).rejects.toThrow('Invalid form submission for bug-report')
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
      expect(stripAnsi(result.stderr)).toContain('Error: Authentication required. Set KANBAN_LITE_TOKEN environment variable.')
    } finally {
      cleanup()
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

  it('routes "webhooks list" through kl-webhooks-plugin cliPlugin (exits 0, no "Unknown command")', async () => {
    const result = await runCliCommand(['webhooks', 'list', '--config', configPath])
    expect(result.exitCode).toBe(0)
    expect(stripAnsi(result.stdout + result.stderr)).not.toMatch(/unknown command/i)
  })

  it('routes "wh list" through kl-webhooks-plugin cliPlugin (exits 0, no "Unknown command")', async () => {
    const result = await runCliCommand(['wh', 'list', '--config', configPath])
    expect(result.exitCode).toBe(0)
    expect(stripAnsi(result.stdout + result.stderr)).not.toMatch(/unknown command/i)
  })

  it('routes "webhook list" through kl-webhooks-plugin cliPlugin (exits 0, no "Unknown command")', async () => {
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

