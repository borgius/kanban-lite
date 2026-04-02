import { afterEach, describe, expect, it, vi } from 'vitest'
import * as vscode from 'vscode'
import type { Card } from '../shared/types'

const runWithAuth = vi.fn(async (_auth: unknown, fn: () => Promise<unknown>) => fn())
const listCards = vi.fn<( ) => Promise<Card[]>>(async () => [])

vi.mock('vscode', () => {
  class RelativePattern {
    readonly base: string
    readonly pattern: string

    constructor(base: string, pattern: string) {
      this.base = base
      this.pattern = pattern
    }
  }

  const createWatcher = () => ({
    onDidChange: vi.fn(),
    onDidCreate: vi.fn(),
    onDidDelete: vi.fn(),
    dispose: vi.fn(),
  })

  return {
    RelativePattern,
    workspace: {
      workspaceFolders: undefined,
      createFileSystemWatcher: vi.fn(createWatcher),
    },
    commands: {
      executeCommand: vi.fn(),
    },
  }
})

vi.mock('../sdk/KanbanSDK', () => ({
  KanbanSDK: class MockKanbanSDK {
    getStorageStatus = vi.fn(() => ({ watchGlob: null }))
    listCards = listCards
    runWithAuth = runWithAuth
  },
}))

vi.mock('./auth', () => ({
  resolveExtensionAuthContext: vi.fn(async () => ({ token: 'sidebar-token', transport: 'extension' })),
}))

import { resolveExtensionAuthContext } from './auth'
import { SidebarViewProvider } from './SidebarViewProvider'

function setWorkspaceFolders(workspaceFolders: typeof vscode.workspace.workspaceFolders): void {
  Object.defineProperty(vscode.workspace, 'workspaceFolders', {
    value: workspaceFolders,
    configurable: true,
  })
}

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    version: 1,
    id: 'card-1',
    status: 'todo',
    priority: 'medium',
    assignee: null,
    dueDate: null,
    created: '2026-03-24T00:00:00.000Z',
    modified: '2026-03-24T00:00:00.000Z',
    completedAt: null,
    labels: [],
    attachments: [],
    comments: [],
    order: 'a0',
    content: '# Visible card',
    filePath: '/tmp/card-1.md',
    ...overrides,
  }
}

afterEach(() => {
  setWorkspaceFolders(undefined)
  listCards.mockReset()
  runWithAuth.mockClear()
  vi.clearAllMocks()
})

describe('SidebarViewProvider auth-scoped loading', () => {
  it('loads summary cards through the extension auth context', async () => {
    listCards.mockResolvedValueOnce([makeCard({ id: 'visible-card', content: '# Visible card' })])
    const context = { secrets: { get: vi.fn() } }
    setWorkspaceFolders([{ uri: { fsPath: '/tmp/workspace' } }] as never)
    const provider = new SidebarViewProvider({ fsPath: '/tmp/extension' } as never, context as never) as unknown as {
      _cards: Array<{ id: string; title: string }>
      _loadCards(): Promise<void>
    }

    await provider._loadCards()

    expect(resolveExtensionAuthContext).toHaveBeenCalledWith(context)
    expect(runWithAuth).toHaveBeenCalledWith(
      { token: 'sidebar-token', transport: 'extension' },
      expect.any(Function),
    )
    expect(listCards).toHaveBeenCalledTimes(1)
    expect(provider._cards).toEqual([
      expect.objectContaining({
        id: 'visible-card',
        title: 'Visible card',
      }),
    ])
  })
})
