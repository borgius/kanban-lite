import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => {
  const registeredCommands = new Map<string, (...args: unknown[]) => Promise<unknown> | unknown>()
  const sidebarReloadState = vi.fn(async () => undefined)
  const sidebarSetBoardOpen = vi.fn()
  const registerWebviewViewProvider = vi.fn(() => ({ dispose: vi.fn() }))
  const registerCommand = vi.fn((id: string, callback: (...args: unknown[]) => Promise<unknown> | unknown) => {
    registeredCommands.set(id, callback)
    return { dispose: vi.fn() }
  })
  const showInputBox = vi.fn()
  const showInformationMessage = vi.fn()

  return {
    registeredCommands,
    sidebarReloadState,
    sidebarSetBoardOpen,
    registerWebviewViewProvider,
    registerCommand,
    showInputBox,
    showInformationMessage,
  }
})

vi.mock('vscode', () => ({
  window: {
    activeTextEditor: undefined,
    registerWebviewViewProvider: mockState.registerWebviewViewProvider,
    registerWebviewPanelSerializer: undefined,
    showInputBox: mockState.showInputBox,
    showInformationMessage: mockState.showInformationMessage,
  },
  workspace: {
    workspaceFolders: undefined,
  },
  commands: {
    registerCommand: mockState.registerCommand,
    executeCommand: vi.fn(),
  },
}))

vi.mock('./SidebarViewProvider', () => ({
  SidebarViewProvider: class MockSidebarViewProvider {
    static readonly viewType = 'kanban-lite.boardView'

    reloadState = mockState.sidebarReloadState
    setBoardOpen = mockState.sidebarSetBoardOpen
  },
}))

vi.mock('./KanbanPanel', () => ({
  KanbanPanel: class MockKanbanPanel {
    static readonly viewType = 'kanban-lite.panel'
    static currentPanel:
      | {
        reloadState: ReturnType<typeof vi.fn>
        onDispose: ReturnType<typeof vi.fn>
        refresh: ReturnType<typeof vi.fn>
      }
      | undefined
  },
}))

vi.mock('../standalone/server', () => ({
  startServer: vi.fn(),
}))

import { KanbanPanel } from './KanbanPanel'
import { activate } from './index'

function createContext() {
  return {
    extensionUri: { fsPath: '/tmp/extension' },
    extensionPath: '/tmp/extension',
    subscriptions: [],
    secrets: {
      store: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    },
  }
}

beforeEach(() => {
  mockState.registeredCommands.clear()
  mockState.registerWebviewViewProvider.mockClear()
  mockState.registerCommand.mockClear()
  mockState.showInputBox.mockReset()
  mockState.showInformationMessage.mockClear()
  mockState.sidebarReloadState.mockClear()
  mockState.sidebarSetBoardOpen.mockClear()
  KanbanPanel.currentPanel = {
    reloadState: vi.fn(async () => undefined),
    onDispose: vi.fn(),
    refresh: vi.fn(),
  }
})

describe('extension auth token commands', () => {
  it('refreshes both the panel and sidebar when saving a new auth token', async () => {
    const context = createContext()
    mockState.showInputBox.mockResolvedValueOnce('secret-token')

    activate(context as never)
    await mockState.registeredCommands.get('kanban-lite.setAuthToken')?.()

    expect(context.secrets.store).toHaveBeenCalledWith('kanban-lite.authToken', 'secret-token')
    expect(mockState.sidebarReloadState).toHaveBeenCalledTimes(1)
    expect(KanbanPanel.currentPanel?.reloadState).toHaveBeenCalledTimes(1)
    expect(mockState.showInformationMessage).toHaveBeenCalledWith('Kanban auth token saved securely in VS Code.')
  })

  it('refreshes the sidebar even when no panel is open while clearing the auth token', async () => {
    const context = createContext()
    KanbanPanel.currentPanel = undefined

    activate(context as never)
    await mockState.registeredCommands.get('kanban-lite.clearAuthToken')?.()

    expect(context.secrets.delete).toHaveBeenCalledWith('kanban-lite.authToken')
    expect(mockState.sidebarReloadState).toHaveBeenCalledTimes(1)
    expect(mockState.showInformationMessage).toHaveBeenCalledWith('Kanban auth token cleared from VS Code secure storage.')
  })
})