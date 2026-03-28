import { WebSocket } from 'ws'
import { type Card, type CardFrontmatter, type CardDisplaySettings, type SubmitFormMessage } from '../shared/types'
import { CardStateError, type AuthContext } from '../sdk/types'
import { readConfig } from '../shared/config'
import type { StandaloneContext } from './context'
import {
  broadcast,
  broadcastCardContentToEditingClients,
  broadcastLogsUpdatedToEditingClients,
  buildInitMessage,
  sendCardContent,
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
      const card = ctx.cards.find(f => f.id === cardId)
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

      ctx.currentEditingCardId = cardId
      setClientEditingCard(ctx, ws, cardId)
      await ctx.sdk.setActiveCard(cardId, boardId)
      await sendCardContent(ctx, ws, card)
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
      ctx.currentEditingCardId = null
      setClientEditingCard(ctx, ws, null)
      await ctx.sdk.clearActiveCard(ctx.currentBoardId)
      cleanupTempFile(ctx)
      break

    case 'openSettings': {
      const settings = ctx.sdk.getSettings()
      settings.showBuildWithAI = false
      settings.markdownEditorMode = false
      ws.send(JSON.stringify({ type: 'showSettings', settings }))
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
      try {
        const logs = await ctx.sdk.listLogs(msg.cardId as string, ctx.currentBoardId)
        ws.send(JSON.stringify({ type: 'logsUpdated', cardId: msg.cardId, logs }))
      } catch {
        ws.send(JSON.stringify({ type: 'logsUpdated', cardId: msg.cardId, logs: [] }))
      }
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
  }
}
