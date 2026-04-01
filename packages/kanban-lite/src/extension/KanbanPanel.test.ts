import * as vscode from 'vscode'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, configToSettings } from '../shared/config'
import type {
  Card,
  PluginSettingsInstallTransportResult,
  PluginSettingsPayload,
  PluginSettingsProviderTransport,
  PluginSettingsResultMessage,
  PluginSettingsTransportAction,
  ShowSettingsMessage,
  WebviewMessage,
} from '../shared/types'
import { PluginSettingsOperationError, createPluginSettingsErrorPayload } from '../sdk/KanbanSDK'
import { AuthError } from '../sdk/types'

vi.mock('vscode', () => {
  class Disposable {
    private readonly callback: (() => void) | undefined

    constructor(callback?: () => void) {
      this.callback = callback
    }

    dispose(): void {
      this.callback?.()
    }
  }

  return {
    Disposable,
    Uri: {
      joinPath: (...parts: Array<{ fsPath?: string } | string>) => ({
        fsPath: parts
          .map((part) => typeof part === 'string' ? part : (part.fsPath ?? ''))
          .filter(Boolean)
          .join('/'),
      }),
      file: (fsPath: string) => ({ fsPath }),
    },
    workspace: {
      workspaceFolders: [],
      fs: {
        stat: vi.fn(),
        readFile: vi.fn(),
        writeFile: vi.fn(),
      },
      openTextDocument: vi.fn(),
      getConfiguration: vi.fn(() => ({
        get: vi.fn(() => false),
      })),
    },
    window: {
      showTextDocument: vi.fn(),
      showOpenDialog: vi.fn(),
      showSaveDialog: vi.fn(),
      showInformationMessage: vi.fn(),
      showWarningMessage: vi.fn(),
      activeTextEditor: undefined,
    },
    commands: {
      executeCommand: vi.fn(),
    },
    env: {
      openExternal: vi.fn(),
    },
    ViewColumn: {
      One: 1,
      Beside: 2,
    },
  }
})

vi.mock('./auth', () => ({
  getExtensionAuthStatus: vi.fn(),
  resolveExtensionAuthContext: vi.fn(async () => ({ type: 'none' })),
}))

vi.mock('./cardStateUi', () => ({
  decorateCardsForWebview: vi.fn(async (_sdk, _runWithAuth, cards) => cards),
  formatCardStateWarning: vi.fn(() => undefined),
  performExplicitCardOpen: vi.fn(async () => null),
}))

import { KanbanPanel } from './KanbanPanel'
import { performExplicitCardOpen } from './cardStateUi'

const redaction = {
  maskedValue: '••••••',
  writeOnly: true as const,
  targets: ['read', 'list', 'error'] as const,
}

const pluginSettingsPayload: PluginSettingsPayload = {
  redaction,
  capabilities: [
    {
      capability: 'auth.identity',
      selected: {
        capability: 'auth.identity',
        providerId: 'local',
        source: 'legacy',
      },
      providers: [
        {
          capability: 'auth.identity',
          providerId: 'local',
          packageName: 'kl-plugin-auth',
          discoverySource: 'workspace',
          isSelected: true,
          optionsSchema: {
            schema: {
              type: 'object',
              properties: {
                apiToken: { type: 'string' },
              },
            },
            secrets: [{ path: 'apiToken', redaction }],
          },
        },
      ],
    },
  ],
}

const providerTransport: PluginSettingsProviderTransport = {
  capability: 'auth.identity',
  providerId: 'local',
  packageName: 'kl-plugin-auth',
  discoverySource: 'workspace',
  selected: {
    capability: 'auth.identity',
    providerId: 'local',
    source: 'legacy',
  },
  optionsSchema: {
    schema: {
      type: 'object',
      properties: {
        apiToken: { type: 'string' },
      },
    },
    secrets: [{ path: 'apiToken', redaction }],
  },
  options: {
    values: { apiToken: '••••••' },
    redactedPaths: ['apiToken'],
    redaction,
  },
}

const installTransport: PluginSettingsInstallTransportResult = {
  packageName: 'kl-plugin-auth',
  scope: 'workspace',
  command: {
    command: 'npm',
    args: ['install', '--ignore-scripts', 'kl-plugin-auth'],
    cwd: '/tmp/workspace',
    shell: false,
  },
  stdout: 'Authorization: Bearer [REDACTED]',
  stderr: 'password=[REDACTED]',
  message: 'Installed plugin package with lifecycle scripts disabled.',
  redaction,
}

type Handler = (message: WebviewMessage) => Promise<void> | void

function createPanelHarness() {
  let handler: Handler | undefined
  const postMessage = vi.fn()

  const webview = {
    options: {},
    html: '',
    cspSource: 'vscode-webview://test',
    asWebviewUri: vi.fn((uri: { fsPath?: string }) => `webview:${uri.fsPath ?? ''}`),
    onDidReceiveMessage: vi.fn((callback: Handler, _thisArg?: unknown, disposables?: Array<{ dispose(): void }>) => {
      handler = callback
      const disposable = { dispose: vi.fn() }
      disposables?.push(disposable)
      return disposable
    }),
    postMessage,
  }

  const panel = {
    webview,
    onDidDispose: vi.fn((_callback: () => void, _thisArg?: unknown, disposables?: Array<{ dispose(): void }>) => {
      const disposable = { dispose: vi.fn() }
      disposables?.push(disposable)
      return disposable
    }),
    dispose: vi.fn(),
    reveal: vi.fn(),
  }

  return {
    panel,
    postMessage,
    async dispatch(message: WebviewMessage) {
      if (!handler) {
        throw new Error('webview handler was not registered')
      }
      await handler(message)
    },
  }
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
    content: '# Card',
    filePath: '/tmp/card-1.md',
    ...overrides,
  }
}

function createSdkStub() {
  return {
    getSettings: vi.fn(() => ({
      ...configToSettings(DEFAULT_CONFIG),
      showLabels: false,
      markdownEditorMode: true,
    })),
    listCards: vi.fn(async () => []),
    getCard: vi.fn(async (cardId: string) => makeCard({ id: cardId })),
    listLogs: vi.fn(async () => []),
    listColumns: vi.fn(() => [...DEFAULT_CONFIG.boards.default.columns]),
    listBoards: vi.fn(() => []),
    getLabels: vi.fn(() => ({})),
    getMinimizedColumns: vi.fn(() => []),
    getStorageStatus: vi.fn(() => ({ watchGlob: null })),
    getLocalCardPath: vi.fn((card: Card) => card.filePath),
    getAttachmentDir: vi.fn(async () => null),
    listPluginSettings: vi.fn(async () => pluginSettingsPayload),
    getPluginSettings: vi.fn(async () => providerTransport),
    selectPluginSettingsProvider: vi.fn(async () => providerTransport),
    updatePluginSettingsOptions: vi.fn(async () => providerTransport),
    installPluginSettingsPackage: vi.fn(async () => installTransport),
  }
}

function createSubject() {
  const harness = createPanelHarness()
  const context = { extensionUri: { fsPath: '/tmp/extension' } }

  KanbanPanel.revive(
    harness.panel as never,
    { fsPath: '/tmp/extension' } as never,
    context as never,
  )

  const panel = KanbanPanel.currentPanel as unknown as {
    _getSDK(): ReturnType<typeof createSdkStub>
    _runWithAuth: ReturnType<typeof vi.fn>
    _cards: Card[]
    reloadState(): Promise<void>
    _sendCardContent(cardId: string): Promise<void>
    _openCardInWebview(cardId: string): Promise<void>
    dispose(): void
  }
  const sdk = createSdkStub()
  panel._getSDK = () => sdk
  panel._runWithAuth = vi.fn(async (_sdk, fn: () => Promise<unknown>) => fn())

  return { harness, panel, sdk }
}

afterEach(() => {
  KanbanPanel.currentPanel?.dispose()
  vi.clearAllMocks()
})

describe('KanbanPanel plugin-settings bridge', () => {
  it('seeds the settings modal with an empty plugin-settings payload before async plugin loading', async () => {
    const { harness, sdk } = createSubject()

    await harness.dispatch({ type: 'openSettings' })

    expect(sdk.getSettings).toHaveBeenCalledTimes(1)
    expect(sdk.listPluginSettings).not.toHaveBeenCalled()
    expect(harness.postMessage).toHaveBeenCalledWith({
      type: 'showSettings',
      settings: sdk.getSettings.mock.results[0]?.value,
      pluginSettings: {
        capabilities: [],
        redaction,
      },
    } satisfies ShowSettingsMessage)
  })

  it('routes plugin-settings requests through the shared transport contract', async () => {
    const { harness, panel, sdk } = createSubject()

    const cases = [
      {
        message: { type: 'loadPluginSettings' } satisfies Extract<WebviewMessage, { type: 'loadPluginSettings' }>,
        expectedAction: 'read' satisfies PluginSettingsTransportAction,
        assertSdkCall: () => {
          expect(sdk.getPluginSettings).not.toHaveBeenCalled()
          expect(panel._runWithAuth).toHaveBeenCalledTimes(1)
        },
        assertMessage: (message: PluginSettingsResultMessage) => {
          expect(message.provider).toBeUndefined()
          expect(message.install).toBeUndefined()
        },
      },
      {
        message: { type: 'readPluginSettings', capability: 'auth.identity', providerId: 'local' } satisfies Extract<WebviewMessage, { type: 'readPluginSettings' }>,
        expectedAction: 'read' satisfies PluginSettingsTransportAction,
        assertSdkCall: () => {
          expect(sdk.getPluginSettings).toHaveBeenCalledWith('auth.identity', 'local')
          expect(panel._runWithAuth).toHaveBeenCalledTimes(2)
        },
        assertMessage: (message: PluginSettingsResultMessage) => {
          expect(message.provider).toEqual(providerTransport)
          expect(message.install).toBeUndefined()
        },
      },
      {
        message: { type: 'selectPluginSettingsProvider', capability: 'auth.identity', providerId: 'local' } satisfies Extract<WebviewMessage, { type: 'selectPluginSettingsProvider' }>,
        expectedAction: 'select' satisfies PluginSettingsTransportAction,
        assertSdkCall: () => {
          expect(sdk.selectPluginSettingsProvider).toHaveBeenCalledWith('auth.identity', 'local')
          expect(panel._runWithAuth).toHaveBeenCalledTimes(2)
        },
        assertMessage: (message: PluginSettingsResultMessage) => {
          expect(message.provider).toEqual(providerTransport)
          expect(message.install).toBeUndefined()
        },
      },
      {
        message: {
          type: 'updatePluginSettingsOptions',
          capability: 'auth.identity',
          providerId: 'local',
          options: { apiToken: '••••••' },
        } satisfies Extract<WebviewMessage, { type: 'updatePluginSettingsOptions' }>,
        expectedAction: 'updateOptions' satisfies PluginSettingsTransportAction,
        assertSdkCall: () => {
          expect(sdk.updatePluginSettingsOptions).toHaveBeenCalledWith('auth.identity', 'local', { apiToken: '••••••' })
          expect(panel._runWithAuth).toHaveBeenCalledTimes(2)
        },
        assertMessage: (message: PluginSettingsResultMessage) => {
          expect(message.provider).toEqual(providerTransport)
          expect(message.install).toBeUndefined()
        },
      },
      {
        message: { type: 'installPluginSettingsPackage', packageName: 'kl-plugin-auth', scope: 'workspace' } satisfies Extract<WebviewMessage, { type: 'installPluginSettingsPackage' }>,
        expectedAction: 'install' satisfies PluginSettingsTransportAction,
        assertSdkCall: () => {
          expect(sdk.installPluginSettingsPackage).toHaveBeenCalledWith({ packageName: 'kl-plugin-auth', scope: 'workspace' })
          expect(panel._runWithAuth).toHaveBeenCalledTimes(2)
        },
        assertMessage: (message: PluginSettingsResultMessage) => {
          expect(message.provider).toBeNull()
          expect(message.install).toEqual(installTransport)
        },
      },
    ] as const

    for (const testCase of cases) {
      harness.postMessage.mockClear()
      panel._runWithAuth.mockClear()
      sdk.getPluginSettings.mockClear()
      sdk.selectPluginSettingsProvider.mockClear()
      sdk.updatePluginSettingsOptions.mockClear()
      sdk.installPluginSettingsPackage.mockClear()
      sdk.listPluginSettings.mockClear()

      await harness.dispatch(testCase.message)

      expect(sdk.listPluginSettings).toHaveBeenCalledTimes(1)
      expect(harness.postMessage).toHaveBeenCalledTimes(1)
      const [result] = harness.postMessage.mock.calls.at(-1) as [PluginSettingsResultMessage]
      expect(result).toMatchObject({
        type: 'pluginSettingsResult',
        action: testCase.expectedAction,
        pluginSettings: pluginSettingsPayload,
      })
      testCase.assertSdkCall()
      testCase.assertMessage(result)
    }
  })

  it('keeps plugin-settings mutation refreshes inside the extension auth scope', async () => {
    const { harness, panel, sdk } = createSubject()
    let authScopeDepth = 0

    panel._runWithAuth = vi.fn(async (_sdk, fn: () => Promise<unknown>) => {
      authScopeDepth += 1
      try {
        return await fn()
      } finally {
        authScopeDepth -= 1
      }
    })

    sdk.listPluginSettings.mockImplementation(async () => {
      if (authScopeDepth === 0) {
        throw new PluginSettingsOperationError(createPluginSettingsErrorPayload({
          code: 'plugin-settings-read-failed',
          message: 'Scoped plugin-settings reads are required.',
        }))
      }
      return pluginSettingsPayload
    })

    const cases = [
      {
        message: { type: 'selectPluginSettingsProvider', capability: 'auth.identity', providerId: 'local' } satisfies Extract<WebviewMessage, { type: 'selectPluginSettingsProvider' }>,
        expectedAction: 'select' satisfies PluginSettingsTransportAction,
      },
      {
        message: {
          type: 'updatePluginSettingsOptions',
          capability: 'auth.identity',
          providerId: 'local',
          options: { apiToken: '••••••' },
        } satisfies Extract<WebviewMessage, { type: 'updatePluginSettingsOptions' }>,
        expectedAction: 'updateOptions' satisfies PluginSettingsTransportAction,
      },
      {
        message: { type: 'installPluginSettingsPackage', packageName: 'kl-plugin-auth', scope: 'workspace' } satisfies Extract<WebviewMessage, { type: 'installPluginSettingsPackage' }>,
        expectedAction: 'install' satisfies PluginSettingsTransportAction,
      },
    ] as const

    for (const testCase of cases) {
      harness.postMessage.mockClear()
      panel._runWithAuth.mockClear()

      await harness.dispatch(testCase.message)

      expect(panel._runWithAuth).toHaveBeenCalledTimes(2)
      expect(harness.postMessage).toHaveBeenCalledTimes(1)

      const [result] = harness.postMessage.mock.calls.at(-1) as [PluginSettingsResultMessage]
      expect(result).toMatchObject({
        type: 'pluginSettingsResult',
        action: testCase.expectedAction,
        pluginSettings: pluginSettingsPayload,
      })
      expect(result.error).toBeUndefined()
    }
  })

  it('preserves successful plugin-settings mutations when the scoped refresh read is denied', async () => {
    const { harness, panel, sdk } = createSubject()
    sdk.listPluginSettings.mockRejectedValue(
      new AuthError('auth.policy.denied', 'Action "plugin-settings.read" denied'),
    )

    const cases = [
      {
        message: { type: 'selectPluginSettingsProvider', capability: 'auth.identity', providerId: 'local' } satisfies Extract<WebviewMessage, { type: 'selectPluginSettingsProvider' }>,
        expectedAction: 'select' satisfies PluginSettingsTransportAction,
        assertMutationCall: () => {
          expect(sdk.selectPluginSettingsProvider).toHaveBeenCalledWith('auth.identity', 'local')
        },
        assertMessage: (message: PluginSettingsResultMessage) => {
          expect(message.provider).toEqual(providerTransport)
          expect(message.install).toBeUndefined()
        },
      },
      {
        message: {
          type: 'updatePluginSettingsOptions',
          capability: 'auth.identity',
          providerId: 'local',
          options: { apiToken: '••••••' },
        } satisfies Extract<WebviewMessage, { type: 'updatePluginSettingsOptions' }>,
        expectedAction: 'updateOptions' satisfies PluginSettingsTransportAction,
        assertMutationCall: () => {
          expect(sdk.updatePluginSettingsOptions).toHaveBeenCalledWith('auth.identity', 'local', { apiToken: '••••••' })
        },
        assertMessage: (message: PluginSettingsResultMessage) => {
          expect(message.provider).toEqual(providerTransport)
          expect(message.install).toBeUndefined()
        },
      },
      {
        message: { type: 'installPluginSettingsPackage', packageName: 'kl-plugin-auth', scope: 'workspace' } satisfies Extract<WebviewMessage, { type: 'installPluginSettingsPackage' }>,
        expectedAction: 'install' satisfies PluginSettingsTransportAction,
        assertMutationCall: () => {
          expect(sdk.installPluginSettingsPackage).toHaveBeenCalledWith({ packageName: 'kl-plugin-auth', scope: 'workspace' })
        },
        assertMessage: (message: PluginSettingsResultMessage) => {
          expect(message.provider).toBeNull()
          expect(message.install).toEqual(installTransport)
        },
      },
    ] as const

    for (const testCase of cases) {
      harness.postMessage.mockClear()
      panel._runWithAuth.mockClear()
      sdk.listPluginSettings.mockClear()
      sdk.selectPluginSettingsProvider.mockClear()
      sdk.updatePluginSettingsOptions.mockClear()
      sdk.installPluginSettingsPackage.mockClear()

      await harness.dispatch(testCase.message)

      expect(panel._runWithAuth).toHaveBeenCalledTimes(2)
      expect(sdk.listPluginSettings).toHaveBeenCalledTimes(1)
      expect(harness.postMessage).toHaveBeenCalledTimes(1)

      const [result] = harness.postMessage.mock.calls.at(-1) as [PluginSettingsResultMessage]
      expect(result).toMatchObject({
        type: 'pluginSettingsResult',
        action: testCase.expectedAction,
        pluginSettings: {
          capabilities: [],
          redaction,
        },
      })
      expect(result.error).toBeUndefined()
      testCase.assertMutationCall()
      testCase.assertMessage(result)
    }
  })

  it('clears plugin-settings payloads when scoped reads are denied', async () => {
    const { harness, panel, sdk } = createSubject()
    const deniedError = new PluginSettingsOperationError(createPluginSettingsErrorPayload({
      code: 'plugin-settings-read-failed',
      message: 'You are not allowed to read plugin settings.',
      capability: 'auth.identity',
      providerId: 'local',
    }))

    panel._runWithAuth.mockRejectedValue(deniedError)

    await harness.dispatch({ type: 'loadPluginSettings' })

    expect(sdk.listPluginSettings).not.toHaveBeenCalled()
    expect(harness.postMessage).toHaveBeenCalledTimes(1)
    expect(harness.postMessage).toHaveBeenCalledWith({
      type: 'pluginSettingsResult',
      action: 'read',
      pluginSettings: {
        capabilities: [],
        redaction,
      },
      provider: null,
      error: deniedError.payload,
    } satisfies PluginSettingsResultMessage)

    harness.postMessage.mockClear()
    sdk.getPluginSettings.mockClear()

    await harness.dispatch({ type: 'readPluginSettings', capability: 'auth.identity', providerId: 'local' })

    expect(sdk.getPluginSettings).not.toHaveBeenCalled()
    expect(harness.postMessage).toHaveBeenCalledTimes(1)
    expect(harness.postMessage).toHaveBeenCalledWith({
      type: 'pluginSettingsResult',
      action: 'read',
      pluginSettings: {
        capabilities: [],
        redaction,
      },
      provider: null,
      error: deniedError.payload,
    } satisfies PluginSettingsResultMessage)
  })

  it('clears stale plugin-settings/provider payloads when plugin-settings mutations are auth-denied', async () => {
    const { harness, panel, sdk } = createSubject()
    const deniedError = new AuthError('auth.policy.denied', 'Action "plugin-settings.update" denied')

    const cases = [
      {
        message: { type: 'selectPluginSettingsProvider', capability: 'auth.identity', providerId: 'local' } satisfies Extract<WebviewMessage, { type: 'selectPluginSettingsProvider' }>,
        expectedAction: 'select' satisfies PluginSettingsTransportAction,
        expectedError: {
          code: 'plugin-settings-select-failed',
          capability: 'auth.identity',
          providerId: 'local',
        },
      },
      {
        message: {
          type: 'updatePluginSettingsOptions',
          capability: 'auth.identity',
          providerId: 'local',
          options: { apiToken: '••••••' },
        } satisfies Extract<WebviewMessage, { type: 'updatePluginSettingsOptions' }>,
        expectedAction: 'updateOptions' satisfies PluginSettingsTransportAction,
        expectedError: {
          code: 'plugin-settings-update-failed',
          capability: 'auth.identity',
          providerId: 'local',
        },
      },
      {
        message: { type: 'installPluginSettingsPackage', packageName: 'kl-plugin-auth', scope: 'workspace' } satisfies Extract<WebviewMessage, { type: 'installPluginSettingsPackage' }>,
        expectedAction: 'install' satisfies PluginSettingsTransportAction,
        expectedError: {
          code: 'plugin-settings-install-failed',
        },
      },
    ] as const

    for (const testCase of cases) {
      harness.postMessage.mockClear()
      panel._runWithAuth.mockReset()
      panel._runWithAuth.mockRejectedValue(deniedError)
      sdk.listPluginSettings.mockClear()

      await harness.dispatch(testCase.message)

      expect(sdk.listPluginSettings).not.toHaveBeenCalled()
      expect(harness.postMessage).toHaveBeenCalledTimes(1)

      const [result] = harness.postMessage.mock.calls.at(-1) as [PluginSettingsResultMessage]
      expect(result).toMatchObject({
        type: 'pluginSettingsResult',
        action: testCase.expectedAction,
        pluginSettings: {
          capabilities: [],
          redaction,
        },
        provider: null,
        error: expect.objectContaining(testCase.expectedError),
      })
      expect(result.install).toBeUndefined()
    }
  })

  it('surfaces sanitized install failures through the shared plugin-settings transport contract', async () => {
    const { harness, sdk } = createSubject()

    sdk.installPluginSettingsPackage.mockRejectedValue(
      new PluginSettingsOperationError(createPluginSettingsErrorPayload({
        code: 'plugin-settings-install-failed',
        message: 'Unable to install plugin package. In-product installs disable lifecycle scripts; install the package manually if it requires lifecycle scripts.',
        details: {
          packageName: 'kl-plugin-auth',
          scope: 'workspace',
          stderr: 'Authorization: Bearer [REDACTED]\npassword=[REDACTED]',
        },
      })),
    )

    await harness.dispatch({ type: 'installPluginSettingsPackage', packageName: 'kl-plugin-auth', scope: 'workspace' })

    expect(sdk.listPluginSettings).not.toHaveBeenCalled()
    expect(harness.postMessage).toHaveBeenCalledTimes(1)

    const [result] = harness.postMessage.mock.calls.at(-1) as [PluginSettingsResultMessage]
    expect(result).toMatchObject({
      type: 'pluginSettingsResult',
      action: 'install',
      error: {
        code: 'plugin-settings-install-failed',
        message: 'Unable to install plugin package. In-product installs disable lifecycle scripts; install the package manually if it requires lifecycle scripts.',
        details: {
          packageName: 'kl-plugin-auth',
          scope: 'workspace',
          stderr: 'Authorization: Bearer [REDACTED]\npassword=[REDACTED]',
        },
      },
    })
    expect(result.pluginSettings).toBeUndefined()
    expect(result.provider).toBeUndefined()
    expect(JSON.stringify(result)).not.toContain('npm_super_secret_token')
    expect(JSON.stringify(result)).not.toContain('super-secret-password')
  })
})

describe('KanbanPanel auth-scoped card flows', () => {
  it('reloads cards through the extension auth context before sending them to the webview', async () => {
    const { panel, sdk } = createSubject()
    const visibleCards = [makeCard({ id: 'visible-card', content: '# Visible card' })]
    sdk.listCards.mockResolvedValueOnce(visibleCards)

    await panel.reloadState()

    expect(panel._runWithAuth).toHaveBeenCalledTimes(1)
    expect(sdk.listCards).toHaveBeenCalledWith(
      DEFAULT_CONFIG.boards.default.columns.map((column) => column.id),
      undefined,
    )
    expect(panel._cards).toEqual(visibleCards)
  })

  it('reads fresh auth-scoped card content instead of sending a stale cached card', async () => {
    const { harness, panel, sdk } = createSubject()
    panel._cards = [makeCard({ id: 'card-live', content: '# Stale card' })]
    const freshCard = makeCard({
      id: 'card-live',
      content: '# Fresh card',
      comments: [{ id: 'c1', author: 'alice', content: 'fresh comment', created: '2026-03-24T00:00:00.000Z', updated: '2026-03-24T00:00:00.000Z' }],
    })
    sdk.getCard.mockResolvedValueOnce(freshCard)
    sdk.listLogs.mockResolvedValueOnce([])
    harness.postMessage.mockClear()

    await panel._sendCardContent('card-live')

    expect(panel._runWithAuth).toHaveBeenCalledTimes(2)
    expect(sdk.getCard).toHaveBeenCalledWith('card-live', undefined)
    expect(sdk.listLogs).toHaveBeenCalledWith('card-live', undefined)
    expect(harness.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'cardContent',
      cardId: 'card-live',
      content: '# Fresh card',
      comments: freshCard.comments,
    }))
  })

  it('does not emit card content when an explicit open resolves to not found', async () => {
    const { harness, panel } = createSubject()
    vi.mocked(performExplicitCardOpen).mockRejectedValueOnce(new Error('Card not found: private-card'))
    harness.postMessage.mockClear()

    await expect(panel._openCardInWebview('private-card')).rejects.toThrow('Card not found: private-card')

    expect(harness.postMessage).not.toHaveBeenCalled()
  })

  it('treats auth-hidden cards as absent for cached openFile and downloadCard helpers', async () => {
    const { harness, panel, sdk } = createSubject()
    const openTextDocument = vi.mocked(vscode.workspace.openTextDocument)
    const showSaveDialog = vi.mocked(vscode.window.showSaveDialog)
    const writeFile = vi.mocked(vscode.workspace.fs.writeFile)

    const cases = [
      { message: { type: 'openFile', cardId: 'private-card' } satisfies Extract<WebviewMessage, { type: 'openFile' }> },
      { message: { type: 'downloadCard', cardId: 'private-card' } satisfies Extract<WebviewMessage, { type: 'downloadCard' }> },
    ] as const

    for (const testCase of cases) {
      panel._cards = [makeCard({ id: 'private-card', content: '# Hidden card', filePath: '/tmp/private-card.md' })]
      panel._runWithAuth.mockClear()
      sdk.getCard.mockClear()
      sdk.getCard.mockResolvedValueOnce(null)
      openTextDocument.mockClear()
      showSaveDialog.mockClear()
      writeFile.mockClear()

      await harness.dispatch(testCase.message)

      expect(panel._runWithAuth).toHaveBeenCalledTimes(1)
      expect(sdk.getCard).toHaveBeenCalledWith('private-card', undefined)
      expect(openTextDocument).not.toHaveBeenCalled()
      expect(showSaveDialog).not.toHaveBeenCalled()
      expect(writeFile).not.toHaveBeenCalled()
      expect(panel._cards).toEqual([])
    }
  })

  it('uses the extension auth wrapper when resolving attachment paths before opening them', async () => {
    const { harness, panel, sdk } = createSubject()
    panel._cards = [makeCard({ id: 'card-1' })]
    sdk.getCard.mockResolvedValueOnce(makeCard({ id: 'card-1' }))
    sdk.getAttachmentDir.mockResolvedValueOnce('/tmp/attachments')
    vi.mocked(vscode.workspace.fs.stat).mockResolvedValue({} as never)
    vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue({ uri: { fsPath: '/tmp/attachments/notes.md' } } as never)
    vi.mocked(vscode.window.showTextDocument).mockResolvedValue({} as never)

    await harness.dispatch({ type: 'openAttachment', cardId: 'card-1', attachment: 'notes.md' })

    expect(panel._runWithAuth).toHaveBeenCalledTimes(2)
    expect(sdk.getCard).toHaveBeenCalledWith('card-1', undefined)
    expect(sdk.getAttachmentDir).toHaveBeenCalledWith('card-1', undefined)
    expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith(vscode.Uri.file('/tmp/attachments/notes.md'))
    expect(vscode.window.showTextDocument).toHaveBeenCalledTimes(1)
  })
})
