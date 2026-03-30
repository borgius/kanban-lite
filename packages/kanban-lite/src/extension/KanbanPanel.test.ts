import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, configToSettings } from '../shared/config'
import type {
  PluginSettingsInstallTransportResult,
  PluginSettingsPayload,
  PluginSettingsProviderTransport,
  PluginSettingsResultMessage,
  PluginSettingsTransportAction,
  ShowSettingsMessage,
  WebviewMessage,
} from '../shared/types'
import { PluginSettingsOperationError, createPluginSettingsErrorPayload } from '../sdk/KanbanSDK'

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
      fs: { stat: vi.fn() },
      openTextDocument: vi.fn(),
    },
    window: {
      showTextDocument: vi.fn(),
      showOpenDialog: vi.fn(),
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

function createSdkStub() {
  return {
    getSettings: vi.fn(() => ({
      ...configToSettings(DEFAULT_CONFIG),
      showLabels: false,
      markdownEditorMode: true,
    })),
    listPluginSettings: vi.fn(() => pluginSettingsPayload),
    getPluginSettings: vi.fn(() => providerTransport),
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
  it('includes shared plugin settings alongside display settings when opening settings', async () => {
    const { harness, sdk } = createSubject()

    await harness.dispatch({ type: 'openSettings' })

    expect(sdk.getSettings).toHaveBeenCalledTimes(1)
    expect(sdk.listPluginSettings).toHaveBeenCalledTimes(1)
    expect(harness.postMessage).toHaveBeenCalledWith({
      type: 'showSettings',
      settings: sdk.getSettings.mock.results[0]?.value,
      pluginSettings: pluginSettingsPayload,
    } satisfies ShowSettingsMessage)
  })

  it('routes plugin-settings requests through the shared transport contract', async () => {
    const { harness, panel, sdk } = createSubject()

    const cases = [
      {
        message: { type: 'readPluginSettings', capability: 'auth.identity', providerId: 'local' } satisfies Extract<WebviewMessage, { type: 'readPluginSettings' }>,
        expectedAction: 'read' satisfies PluginSettingsTransportAction,
        assertSdkCall: () => {
          expect(sdk.getPluginSettings).toHaveBeenCalledWith('auth.identity', 'local')
          expect(panel._runWithAuth).not.toHaveBeenCalled()
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
          expect(panel._runWithAuth).toHaveBeenCalledTimes(1)
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
          expect(panel._runWithAuth).toHaveBeenCalledTimes(1)
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
          expect(panel._runWithAuth).toHaveBeenCalledTimes(1)
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
    expect(JSON.stringify(result)).not.toContain('npm_super_secret_token')
    expect(JSON.stringify(result)).not.toContain('super-secret-password')
  })
})
