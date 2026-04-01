import { WebSocket } from 'ws'
import {
  createEmptyPluginSettingsPayload,
  type Card,
  type CardDisplaySettings,
  type CardFrontmatter,
  type PluginSettingsInstallTransportResult,
  type PluginSettingsPayload,
  type PluginSettingsProviderTransport,
  type PluginSettingsResultMessage,
  type PluginSettingsTransportAction,
  type SubmitFormMessage,
} from '../shared/types'
import type { PluginCapabilityNamespace } from '../shared/config'
import { DEFAULT_PLUGIN_SETTINGS_REDACTION, PluginSettingsOperationError, createPluginSettingsErrorPayload } from '../sdk/KanbanSDK'
import { CardStateError, type AuthContext } from '../sdk/types'
import { readConfig } from '../shared/config'
import type { StandaloneContext } from './context'
import { getAuthErrorLike } from './authUtils'
import {
  broadcast,
  broadcastCardContentToEditingClients,
  broadcastLogsUpdatedToEditingClients,
  buildInitMessage,
  sendCardContent,
  sendCardStates,
  sendLogsUpdated,
  sendInitMessage,
  loadCards,
  setClientEditingCard,
} from './broadcastService'
import { parseSubmitData } from './cardHelpers'
import {
  doCreateCard,
  doMoveCard,
  doUpdateCard,
  doDeleteCard,
  doPermanentDeleteCard,
  doPurgeDeletedCards,
  doAddColumn,
  doEditColumn,
  doRemoveColumn,
  doCleanupColumn,
  doSaveSettings,
  doRemoveAttachment,
  doAddComment,
  doUpdateComment,
  doDeleteComment,
  doAddLog,
  doClearLogs,
  doSubmitForm,
  type CreateCardData,
} from './mutationService'
import { cleanupTempFile } from './watcherSetup'

type RunWithScopedAuth = <T>(fn: () => Promise<T>) => Promise<T>

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
  settings.showBuildWithAI = false
  settings.markdownEditorMode = false

  try {
    ws.send(JSON.stringify({
      type: 'showSettings',
      settings,
      pluginSettings: await getPluginSettingsPayload(ctx, runWithScopedAuth),
    }))
  } catch (error) {
    ws.send(JSON.stringify({
      type: 'showSettings',
      settings,
      pluginSettings: buildEmptyPluginSettingsPayload(),
    }))
    sendPluginSettingsResult(ws, {
      type: 'pluginSettingsResult',
      action: 'read',
      error: toPluginSettingsErrorPayload('read', error),
    })
  }
}

export async function handleMessage(ctx: StandaloneContext, ws: WebSocket, message: unknown, authContext: AuthContext): Promise<void> {
  const msg = message as Record<string, unknown>
  const runWithScopedAuth = <T>(fn: () => Promise<T>): Promise<T> => ctx.sdk.runWithAuth(authContext, fn)
  switch (msg.type) {
    case 'ready':
      ctx.migrating = true
      try {
        await loadCards(ctx)
        await sendInitMessage(ctx, ws)
      } finally {
        ctx.migrating = false
      }
      break

    case 'createCard':
      await runWithScopedAuth(() => doCreateCard(ctx, msg.data as CreateCardData))
      break

    case 'moveCard':
      await runWithScopedAuth(() => doMoveCard(ctx, msg.cardId as string, msg.newStatus as string, msg.newOrder as number))
      break

    case 'deleteCard':
      await runWithScopedAuth(() => doDeleteCard(ctx, msg.cardId as string))
      break

    case 'permanentDeleteCard':
      await runWithScopedAuth(() => doPermanentDeleteCard(ctx, msg.cardId as string))
      break

    case 'restoreCard': {
      const restoreId = msg.cardId as string
      const defaultStatus = ctx.sdk.getSettings().defaultStatus
      await runWithScopedAuth(() => doUpdateCard(ctx, restoreId, { status: defaultStatus }))
      break
    }

    case 'purgeDeletedCards':
      await runWithScopedAuth(() => doPurgeDeletedCards(ctx))
      break

    case 'updateCard':
      await runWithScopedAuth(() => doUpdateCard(ctx, msg.cardId as string, msg.updates as Partial<Card>))
      break

    case 'bulkUpdateCard':
      await runWithScopedAuth(() => doUpdateCard(ctx, msg.cardId as string, msg.updates as Partial<Card>))
      break

    case 'openCard': {
      const cardId = msg.cardId as string
      const card = await runWithScopedAuth(() => ctx.sdk.getCard(cardId, ctx.currentBoardId))
      if (!card) break
      const boardId = card.boardId ?? ctx.currentBoardId

      // Clean up any temp file from a previously-opened card
      if (ctx.tempFileCardId && ctx.tempFileCardId !== cardId) {
        cleanupTempFile(ctx)
      }

      try {
        await runWithScopedAuth(() => ctx.sdk.markCardOpened(cardId, boardId))
      } catch (err) {
        if (!(err instanceof CardStateError)) {
          throw err
        }
      }

      await runWithScopedAuth(() => ctx.sdk.setActiveCard(cardId, boardId))
      ctx.currentEditingCardId = cardId
      setClientEditingCard(ctx, ws, cardId)
      await sendCardStates(ctx, ws, [cardId], authContext)
      await sendCardContent(ctx, ws, card, authContext)
      break
    }

    case 'saveCardContent': {
      const cardId = msg.cardId as string
      const newContent = msg.content as string
      const fm = msg.frontmatter as CardFrontmatter
      await runWithScopedAuth(() => doUpdateCard(ctx, cardId, {
        content: newContent,
        status: fm.status,
        priority: fm.priority,
        assignee: fm.assignee,
        dueDate: fm.dueDate,
        labels: fm.labels,
        attachments: fm.attachments,
        metadata: fm.metadata,
        actions: fm.actions,
        forms: fm.forms,
        formData: fm.formData,
      }))
      break
    }

    case 'submitForm': {
      const { cardId, formId, callbackKey, boardId } = msg as unknown as SubmitFormMessage
      try {
        const result = await runWithScopedAuth(() => doSubmitForm(ctx, {
          cardId,
          formId,
          data: parseSubmitData((msg as unknown as SubmitFormMessage).data),
          boardId,
        }))
        const updatedCard = ctx.cards.find(candidate => candidate.id === cardId)
        if (updatedCard) {
          await broadcastCardContentToEditingClients(ctx, updatedCard)
        }
        ws.send(JSON.stringify({ type: 'submitFormResult', callbackKey, result }))
      } catch (err) {
        ws.send(JSON.stringify({ type: 'submitFormResult', callbackKey, error: String(err) }))
      }
      break
    }

    case 'closeCard':
      {
        const closingCardId = ctx.clientEditingCardIds.get(ws) ?? null
        if (closingCardId) {
          const closingCard = await runWithScopedAuth(() => ctx.sdk.getCard(closingCardId, ctx.currentBoardId))
          if (closingCard) {
            await runWithScopedAuth(() => ctx.sdk.clearActiveCard(closingCard.boardId ?? ctx.currentBoardId))
          }
        }
      }
      ctx.currentEditingCardId = null
      setClientEditingCard(ctx, ws, null)
      cleanupTempFile(ctx)
      break

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

    case 'removeAttachment': {
      const cardId = msg.cardId as string
      const card = await runWithScopedAuth(() => doRemoveAttachment(ctx, cardId, msg.attachment as string))
      if (card) {
        await broadcastCardContentToEditingClients(ctx, card)
      }
      break
    }

    case 'addComment': {
      const comment = await runWithScopedAuth(() => doAddComment(ctx, msg.cardId as string, msg.author as string, msg.content as string))
      if (!comment) break
      const card = ctx.cards.find(f => f.id === msg.cardId)
      if (card) {
        await broadcastCardContentToEditingClients(ctx, card)
      }
      break
    }

    case 'updateComment': {
      const comment = await runWithScopedAuth(() => doUpdateComment(ctx, msg.cardId as string, msg.commentId as string, msg.content as string))
      if (!comment) break
      const card = ctx.cards.find(f => f.id === msg.cardId)
      if (card) {
        await broadcastCardContentToEditingClients(ctx, card)
      }
      break
    }

    case 'deleteComment': {
      await runWithScopedAuth(() => doDeleteComment(ctx, msg.cardId as string, msg.commentId as string))
      const card = ctx.cards.find(f => f.id === msg.cardId)
      if (card) {
        await broadcastCardContentToEditingClients(ctx, card)
      }
      break
    }

    case 'addLog': {
      const entry = await runWithScopedAuth(() => doAddLog(
        ctx,
        msg.cardId as string,
        msg.text as string,
        msg.source as string | undefined,
        msg.object as Record<string, unknown> | undefined,
        msg.timestamp as string | undefined,
      ))
      if (entry) {
        await broadcastLogsUpdatedToEditingClients(ctx, msg.cardId as string)
      }
      break
    }

    case 'clearLogs': {
      await runWithScopedAuth(() => doClearLogs(ctx, msg.cardId as string))
      await broadcastLogsUpdatedToEditingClients(ctx, msg.cardId as string, [])
      break
    }

    case 'getLogs': {
      await sendLogsUpdated(ctx, ws, msg.cardId as string, authContext)
      break
    }

    case 'addBoardLog': {
      try {
        const entry = await runWithScopedAuth(() => ctx.sdk.addBoardLog(
          msg.text as string,
          {
            source: msg.source as string | undefined,
            object: msg.object as Record<string, unknown> | undefined,
            timestamp: msg.timestamp as string | undefined,
          },
          ctx.currentBoardId || undefined,
        ))
        const logs = await ctx.sdk.listBoardLogs(ctx.currentBoardId || undefined)
        ws.send(JSON.stringify({ type: 'boardLogsUpdated', boardId: ctx.currentBoardId, logs }))
        broadcast(ctx, buildInitMessage(ctx))
        void entry
      } catch { /* ignore */ }
      break
    }

    case 'clearBoardLogs': {
      await runWithScopedAuth(() => ctx.sdk.clearBoardLogs(ctx.currentBoardId || undefined))
      ws.send(JSON.stringify({ type: 'boardLogsUpdated', boardId: ctx.currentBoardId, logs: [] }))
      broadcast(ctx, buildInitMessage(ctx))
      break
    }

    case 'getBoardLogs': {
      try {
        const logs = await ctx.sdk.listBoardLogs(ctx.currentBoardId || undefined)
        ws.send(JSON.stringify({ type: 'boardLogsUpdated', boardId: ctx.currentBoardId, logs }))
      } catch {
        ws.send(JSON.stringify({ type: 'boardLogsUpdated', boardId: ctx.currentBoardId, logs: [] }))
      }
      break
    }

    case 'transferCard': {
      const cardId = msg.cardId as string
      const toBoard = msg.toBoard as string
      const targetStatus = msg.targetStatus as string
      ctx.migrating = true
      try {
        await runWithScopedAuth(() => ctx.sdk.transferCard(cardId, ctx.currentBoardId || readConfig(ctx.workspaceRoot).defaultBoard, toBoard, targetStatus))
        await loadCards(ctx)
        broadcast(ctx, buildInitMessage(ctx))
      } catch (err) {
        console.error('Failed to transfer card:', err)
      } finally {
        ctx.migrating = false
      }
      break
    }

    case 'switchBoard':
      ctx.currentBoardId = msg.boardId as string
      ctx.migrating = true
      try {
        await loadCards(ctx)
        broadcast(ctx, buildInitMessage(ctx))
      } finally {
        ctx.migrating = false
      }
      break

    case 'createBoard': {
      const boardName = msg.name as string
      try {
        const createdBoard = await runWithScopedAuth(() => ctx.sdk.createBoard('', boardName))
        ctx.currentBoardId = createdBoard.id
        ctx.migrating = true
        try {
          await loadCards(ctx)
          broadcast(ctx, buildInitMessage(ctx))
        } finally {
          ctx.migrating = false
        }
      } catch (err) {
        console.error('Failed to create board:', err)
      }
      break
    }

    case 'setLabel': {
      await runWithScopedAuth(() => ctx.sdk.setLabel(msg.name as string, msg.definition as { color: string; group?: string }))
      broadcast(ctx, { type: 'labelsUpdated', labels: ctx.sdk.getLabels() })
      broadcast(ctx, buildInitMessage(ctx))
      break
    }

    case 'renameLabel': {
      await runWithScopedAuth(() => ctx.sdk.renameLabel(msg.oldName as string, msg.newName as string))
      await loadCards(ctx)
      broadcast(ctx, { type: 'labelsUpdated', labels: ctx.sdk.getLabels() })
      broadcast(ctx, buildInitMessage(ctx))
      break
    }

    case 'deleteLabel': {
      await runWithScopedAuth(() => ctx.sdk.deleteLabel(msg.name as string))
      await loadCards(ctx)
      broadcast(ctx, { type: 'labelsUpdated', labels: ctx.sdk.getLabels() })
      broadcast(ctx, buildInitMessage(ctx))
      break
    }

    case 'triggerAction': {
      const { cardId, action, callbackKey } = msg as { cardId: string; action: string; callbackKey: string }
      try {
        await runWithScopedAuth(() => ctx.sdk.triggerAction(cardId, action, undefined))
        await loadCards(ctx)
        broadcast(ctx, buildInitMessage(ctx))
        const updatedCard = ctx.cards.find(card => card.id === cardId)
        if (updatedCard) {
          await broadcastCardContentToEditingClients(ctx, updatedCard)
          await broadcastLogsUpdatedToEditingClients(ctx, cardId)
        }
        ws.send(JSON.stringify({ type: 'actionResult', callbackKey }))
      } catch (err) {
        ws.send(JSON.stringify({ type: 'actionResult', callbackKey, error: String(err) }))
      }
      break
    }

    case 'triggerBoardAction': {
      const { boardId, actionKey, callbackKey } = msg as { boardId: string; actionKey: string; callbackKey: string }
      try {
        await runWithScopedAuth(() => ctx.sdk.triggerBoardAction(boardId, actionKey))
        ws.send(JSON.stringify({ type: 'boardActionResult', callbackKey }))
      } catch (err) {
        ws.send(JSON.stringify({ type: 'boardActionResult', callbackKey, error: String(err) }))
      }
      break
    }

    // VSCode-specific actions — no-ops in standalone (openFile handled via REST)
    case 'openFile':
    case 'focusMenuBar':
    case 'startWithAI':
    case 'addAttachment':
    case 'openAttachment':
      break

    case 'getCardStates': {
      const cardIds = Array.isArray(msg.cardIds) ? (msg.cardIds as string[]) : []
      await sendCardStates(ctx, ws, cardIds, authContext)
      break
    }
  }
}
