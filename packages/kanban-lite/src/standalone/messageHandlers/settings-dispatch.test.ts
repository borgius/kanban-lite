import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, configToSettings } from '../../shared/config'
import type { PluginSettingsPayload } from '../../shared/types'
import { dispatchSettingsMessage } from './settings-dispatch'

const pluginSettings: PluginSettingsPayload = {
  redaction: {
    maskedValue: '••••••',
    writeOnly: true,
    targets: ['read', 'list', 'error'],
  },
  capabilities: [],
}

describe('dispatchSettingsMessage', () => {
  it('opens settings with stored values and standalone support flags instead of coercing persisted settings', async () => {
    const ws = {
      send: vi.fn(),
    }
    const ctx = {
      sdk: {
        getSettings: vi.fn(() => ({
          ...configToSettings(DEFAULT_CONFIG),
          showBuildWithAI: true,
          markdownEditorMode: true,
          drawerPosition: 'left',
        })),
        listPluginSettings: vi.fn(async () => pluginSettings),
      },
    }
    const runWithScopedAuthMock = vi.fn(async <T,>(fn: () => Promise<T>) => await fn())
    const runWithScopedAuth = runWithScopedAuthMock as unknown as <T>(fn: () => Promise<T>) => Promise<T>

    await dispatchSettingsMessage(
      ctx as never,
      ws as never,
      { type: 'openSettings' },
      runWithScopedAuth,
    )

    expect(runWithScopedAuthMock).toHaveBeenCalledTimes(1)
    expect(ws.send).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(ws.send.mock.calls[0]?.[0]))).toEqual({
      type: 'showSettings',
      settings: {
        ...configToSettings(DEFAULT_CONFIG),
        showBuildWithAI: true,
        markdownEditorMode: true,
        drawerPosition: 'left',
      },
      settingsSupport: {
        showBuildWithAI: false,
        markdownEditorMode: false,
        drawerPosition: true,
      },
      pluginSettings,
    })
  })
})
