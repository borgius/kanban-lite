import { WebSocket } from 'ws'
import {
  DEFAULT_SETTINGS_SUPPORT,
  createEmptyPluginSettingsPayload,
  type CardDisplaySettings,
  type PluginSettingsInstallTransportResult,
  type PluginSettingsPayload,
  type PluginSettingsProviderTransport,
  type PluginSettingsResultMessage,
  type PluginSettingsTransportAction,
} from '../../shared/types'
import type { PluginCapabilityNamespace } from '../../shared/config'
import { DEFAULT_PLUGIN_SETTINGS_REDACTION, PluginSettingsOperationError, createPluginSettingsErrorPayload } from '../../sdk/KanbanSDK'
import { CardStateError } from '../../sdk/types'
import { readConfig } from '../../shared/config'
import type { StandaloneContext } from '../context'
import { getAuthErrorLike } from '../authUtils'
import {
  broadcast,
  buildInitMessage,
  sendInitMessage,
  loadCards,
} from '../broadcastService'
import {
  doSaveSettings,
  doAddColumn,
  doEditColumn,
  doRemoveColumn,
  doCleanupColumn,
} from '../mutationService'

type RunWithScopedAuth = <T>(fn: () => Promise<T>) => Promise<T>

const STANDALONE_SETTINGS_SUPPORT = {
  ...DEFAULT_SETTINGS_SUPPORT,
  showBuildWithAI: false,
  markdownEditorMode: false,
}

function buildEmptyPluginSettingsPayload(): PluginSettingsPayload {
  return createEmptyPluginSettingsPayload(DEFAULT_PLUGIN_SETTINGS_REDACTION)
}

async function getPluginSettingsPayload(
  ctx: StandaloneContext,
  runWithScopedAuth?: RunWithScopedAuth,
): Promise<PluginSettingsPayload> {
  if (!runWithScopedAuth) {
    return await ctx.sdk.listPluginSettings()
  }
  return await runWithScopedAuth(() => ctx.sdk.listPluginSettings())
}

async function getPluginSettingsMutationPayload(
  ctx: StandaloneContext,
  runWithScopedAuth: RunWithScopedAuth,
): Promise<PluginSettingsPayload> {
  try {
    return await getPluginSettingsPayload(ctx, runWithScopedAuth)
  } catch (error) {
    if (getAuthErrorLike(error)) {
      return buildEmptyPluginSettingsPayload()
    }
    throw error
  }
}

async function getPluginSettingsProvider(
  ctx: StandaloneContext,
  runWithScopedAuth: RunWithScopedAuth,
  capability: PluginCapabilityNamespace,
  providerId: string,
) {
  return await runWithScopedAuth(() => ctx.sdk.getPluginSettings(capability, providerId))
}

function toPluginSettingsProviderTransport(
  provider: Awaited<ReturnType<StandaloneContext['sdk']['getPluginSettings']>>,
): PluginSettingsProviderTransport | null {
  return provider ? { ...provider } : null
}

function toPluginSettingsInstallTransportResult(
  result: Awaited<ReturnType<StandaloneContext['sdk']['installPluginSettingsPackage']>>,
): PluginSettingsInstallTransportResult {
  return {
    packageName: result.packageName,
    scope: result.scope,
    command: result.command,
    stdout: result.stdout,
    stderr: result.stderr,
    message: result.message,
    redaction: result.redaction,
  }
}

function toPluginSettingsErrorPayload(
  action: PluginSettingsTransportAction,
  error: unknown,
  capability?: PluginCapabilityNamespace,
  providerId?: string,
) {
  if (error instanceof PluginSettingsOperationError) {
    return error.payload
  }

  const fallback = {
    read: {
      code: 'plugin-settings-read-failed',
      message: 'Unable to read plugin settings.',
    },
    select: {
      code: 'plugin-settings-select-failed',
      message: 'Unable to persist the selected plugin provider.',
    },
    updateOptions: {
      code: 'plugin-settings-update-failed',
      message: 'Unable to persist plugin options.',
    },
    install: {
      code: 'plugin-settings-install-failed',
      message: 'Unable to install plugin package. In-product installs disable lifecycle scripts; install the package manually if it requires lifecycle scripts.',
    },
  } satisfies Record<PluginSettingsTransportAction, { code: string; message: string }>

  return createPluginSettingsErrorPayload({
    code: fallback[action].code,
    message: fallback[action].message,
    capability,
    providerId,
    redaction: DEFAULT_PLUGIN_SETTINGS_REDACTION,
  })
}

function shouldClearPluginSettingsMutationState(error: unknown): boolean {
  return getAuthErrorLike(error) !== null
}

function toPluginSettingsMutationErrorResult(
  action: Exclude<PluginSettingsTransportAction, 'read'>,
  error: unknown,
  capability?: PluginCapabilityNamespace,
  providerId?: string,
): PluginSettingsResultMessage {
  return {
    type: 'pluginSettingsResult',
    action,
    ...(shouldClearPluginSettingsMutationState(error)
      ? {
          pluginSettings: buildEmptyPluginSettingsPayload(),
          provider: null,
        }
      : {}),
    error: toPluginSettingsErrorPayload(action, error, capability, providerId),
  }
}

function sendPluginSettingsResult(ws: WebSocket, result: PluginSettingsResultMessage): void {
  ws.send(JSON.stringify(result))
}

async function sendSettingsBridgePayload(
  ctx: StandaloneContext,
  ws: WebSocket,
  runWithScopedAuth: RunWithScopedAuth,
): Promise<void> {
  const settings = ctx.sdk.getSettings()

  try {
    ws.send(JSON.stringify({
      type: 'showSettings',
      settings,
      settingsSupport: STANDALONE_SETTINGS_SUPPORT,
      pluginSettings: await getPluginSettingsPayload(ctx, runWithScopedAuth),
    }))
  } catch (error) {
    ws.send(JSON.stringify({
      type: 'showSettings',
      settings,
      settingsSupport: STANDALONE_SETTINGS_SUPPORT,
      pluginSettings: buildEmptyPluginSettingsPayload(),
    }))
    sendPluginSettingsResult(ws, {
      type: 'pluginSettingsResult',
      action: 'read',
      error: toPluginSettingsErrorPayload('read', error),
    })
  }
}

export async function dispatchSettingsMessage(
  ctx: StandaloneContext,
  ws: WebSocket,
  msg: Record<string, unknown>,
  runWithScopedAuth: RunWithScopedAuth
): Promise<boolean> {
    switch (msg.type) {
    case 'openSettings': {
      await sendSettingsBridgePayload(ctx, ws, runWithScopedAuth)
      break
    }

    case 'loadPluginSettings': {
      try {
        sendPluginSettingsResult(ws, {
          type: 'pluginSettingsResult',
          action: 'read',
          pluginSettings: await getPluginSettingsPayload(ctx, runWithScopedAuth),
        })
      } catch (error) {
        sendPluginSettingsResult(ws, {
          type: 'pluginSettingsResult',
          action: 'read',
          pluginSettings: buildEmptyPluginSettingsPayload(),
          provider: null,
          error: toPluginSettingsErrorPayload('read', error),
        })
      }
      break
    }

    case 'readPluginSettings': {
      const capability = msg.capability as PluginCapabilityNamespace
      const providerId = msg.providerId as string
      try {
        sendPluginSettingsResult(ws, {
          type: 'pluginSettingsResult',
          action: 'read',
          pluginSettings: await getPluginSettingsPayload(ctx, runWithScopedAuth),
          provider: toPluginSettingsProviderTransport(await getPluginSettingsProvider(ctx, runWithScopedAuth, capability, providerId)),
        })
      } catch (error) {
        sendPluginSettingsResult(ws, {
          type: 'pluginSettingsResult',
          action: 'read',
          pluginSettings: buildEmptyPluginSettingsPayload(),
          provider: null,
          error: toPluginSettingsErrorPayload('read', error, capability, providerId),
        })
      }
      break
    }

    case 'selectPluginSettingsProvider': {
      const capability = msg.capability as PluginCapabilityNamespace
      const providerId = msg.providerId as string
      try {
        const provider = await runWithScopedAuth(() =>
          ctx.sdk.selectPluginSettingsProvider(capability, providerId),
        )
        sendPluginSettingsResult(ws, {
          type: 'pluginSettingsResult',
          action: 'select',
          pluginSettings: await getPluginSettingsMutationPayload(ctx, runWithScopedAuth),
          provider: toPluginSettingsProviderTransport(provider),
        })
      } catch (error) {
        sendPluginSettingsResult(ws, toPluginSettingsMutationErrorResult('select', error, capability, providerId))
      }
      break
    }

    case 'updatePluginSettingsOptions': {
      const capability = msg.capability as PluginCapabilityNamespace
      const providerId = msg.providerId as string
      try {
        const provider = await runWithScopedAuth(() =>
          ctx.sdk.updatePluginSettingsOptions(capability, providerId, (msg.options ?? {}) as Record<string, unknown>),
        )
        sendPluginSettingsResult(ws, {
          type: 'pluginSettingsResult',
          action: 'updateOptions',
          pluginSettings: await getPluginSettingsMutationPayload(ctx, runWithScopedAuth),
          provider: toPluginSettingsProviderTransport(provider),
        })
      } catch (error) {
        sendPluginSettingsResult(ws, toPluginSettingsMutationErrorResult('updateOptions', error, capability, providerId))
      }
      break
    }

    case 'installPluginSettingsPackage': {
      try {
        const install = await runWithScopedAuth(() => ctx.sdk.installPluginSettingsPackage({
          packageName: msg.packageName,
          scope: msg.scope,
        }))
        sendPluginSettingsResult(ws, {
          type: 'pluginSettingsResult',
          action: 'install',
          pluginSettings: await getPluginSettingsMutationPayload(ctx, runWithScopedAuth),
          provider: null,
          install: toPluginSettingsInstallTransportResult(install),
        })
      } catch (error) {
        sendPluginSettingsResult(ws, toPluginSettingsMutationErrorResult('install', error))
      }
      break
    }

    case 'saveSettings':
      await runWithScopedAuth(() => doSaveSettings(ctx, msg.settings as CardDisplaySettings))
      break

    case 'addColumn': {
      const col = msg.column as { name: string; color: string }
      await runWithScopedAuth(() => doAddColumn(ctx, col.name, col.color))
      break
    }

    case 'editColumn':
      await runWithScopedAuth(() => doEditColumn(ctx, msg.columnId as string, msg.updates as { name: string; color: string }))
      break

    case 'removeColumn':
      await runWithScopedAuth(() => doRemoveColumn(ctx, msg.columnId as string))
      break

    case 'cleanupColumn':
      await runWithScopedAuth(() => doCleanupColumn(ctx, msg.columnId as string))
      break

    case 'reorderColumns': {
      const columnIds = msg.columnIds as string[]
      const boardId = msg.boardId as string | undefined
      if (Array.isArray(columnIds)) {
        await runWithScopedAuth(() => ctx.sdk.reorderColumns(columnIds, boardId))
        broadcast(ctx, buildInitMessage(ctx))
      }
      break
    }

    case 'setMinimizedColumns': {
      const columnIds = msg.columnIds as string[]
      const boardId = msg.boardId as string | undefined
      await runWithScopedAuth(() => ctx.sdk.setMinimizedColumns(Array.isArray(columnIds) ? columnIds : [], boardId))
      break
    }
      default:
        return false
    }
    return true
}
