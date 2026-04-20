import { WebSocket } from 'ws'
import type { AuthContext } from '../../sdk/types'
import { readConfig } from '../../shared/config'
import type { BoardMetaFieldDef } from '../../shared/config'
import type { StandaloneContext } from '../context'
import {
  broadcast,
  broadcastCardContentToEditingClients,
  broadcastLogsUpdatedToEditingClients,
  buildInitMessage,
  sendCardStates,
  sendLogsUpdated,
  loadCards,
} from '../broadcastService'
import {
  doAddComment,
  doUpdateComment,
  doDeleteComment,
  doAddLog,
  doClearLogs,
  doRemoveAttachment,
} from '../mutationService'

type RunWithScopedAuth = <T>(fn: () => Promise<T>) => Promise<T>

function normalizeBoardTitleFields(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((field): field is string => typeof field === 'string' && field.trim().length > 0)
}

function normalizeBoardActions(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, title]) => {
      if (key.trim().length === 0) {
        return []
      }

      return [[key, String(title ?? key)]] as const
    })
  )
}

export async function dispatchBoardMessage(
  ctx: StandaloneContext,
  ws: WebSocket,
  msg: Record<string, unknown>,
  runWithScopedAuth: RunWithScopedAuth,
  authContext: AuthContext
): Promise<boolean> {
    switch (msg.type) {
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
      const card = ctx.cards.find(f => f.id === msg.cardId) ?? await runWithScopedAuth(() => ctx.sdk.getCard(msg.cardId as string, ctx.currentBoardId))
      if (card) {
        await broadcastCardContentToEditingClients(ctx, card)
      }
      break
    }

    case 'updateComment': {
      const comment = await runWithScopedAuth(() => doUpdateComment(ctx, msg.cardId as string, msg.commentId as string, msg.content as string))
      if (!comment) break
      const card = ctx.cards.find(f => f.id === msg.cardId) ?? await runWithScopedAuth(() => ctx.sdk.getCard(msg.cardId as string, ctx.currentBoardId))
      if (card) {
        await broadcastCardContentToEditingClients(ctx, card)
      }
      break
    }

    case 'deleteComment': {
      await runWithScopedAuth(() => doDeleteComment(ctx, msg.cardId as string, msg.commentId as string))
      const card = ctx.cards.find(f => f.id === msg.cardId) ?? await runWithScopedAuth(() => ctx.sdk.getCard(msg.cardId as string, ctx.currentBoardId))
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

    case 'updateBoardMeta': {
      const boardId = (msg.boardId as string | undefined) ?? ctx.currentBoardId ?? undefined
      if (boardId) {
        await runWithScopedAuth(() => ctx.sdk.updateBoard(boardId, { metadata: msg.metadata as Record<string, BoardMetaFieldDef> }))
        broadcast(ctx, buildInitMessage(ctx))
      }
      break
    }

    case 'updateBoardTitle': {
      const boardId = (msg.boardId as string | undefined) ?? ctx.currentBoardId ?? undefined
      if (boardId) {
        const updates: Parameters<typeof ctx.sdk.updateBoard>[1] = {
          title: normalizeBoardTitleFields(msg.title),
        }
        if (typeof msg.titleTemplate === 'string') {
          updates.titleTemplate = msg.titleTemplate
        }
        await runWithScopedAuth(() => ctx.sdk.updateBoard(boardId, updates))
        broadcast(ctx, buildInitMessage(ctx))
      }
      break
    }

    case 'updateBoardActions': {
      const boardId = (msg.boardId as string | undefined) ?? ctx.currentBoardId ?? undefined
      if (boardId) {
        const nextActions = normalizeBoardActions(msg.actions)
        const existingActions = ctx.sdk.getBoardActions(boardId)

        for (const key of Object.keys(existingActions)) {
          if (!(key in nextActions)) {
            await runWithScopedAuth(() => ctx.sdk.removeBoardAction(boardId, key))
          }
        }

        for (const [key, title] of Object.entries(nextActions)) {
          await runWithScopedAuth(() => ctx.sdk.addBoardAction(boardId, key, title))
        }

        broadcast(ctx, buildInitMessage(ctx))
      }
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
      default:
        return false
    }
    return true
}
