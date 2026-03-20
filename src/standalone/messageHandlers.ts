import { WebSocket } from 'ws'
import { type Card, type CardFrontmatter, type CardDisplaySettings, type SubmitFormMessage } from '../shared/types'
import { type AuthContext } from '../sdk/types'
import { readConfig } from '../shared/config'
import type { StandaloneContext } from './context'
import { broadcast, buildInitMessage, sendCardContent, loadCards } from './broadcastService'
import { buildCardFrontmatter, parseSubmitData } from './cardHelpers'
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
  switch (msg.type) {
    case 'ready':
      ctx.migrating = true
      try {
        await loadCards(ctx)
        ws.send(JSON.stringify(buildInitMessage(ctx)))
      } finally {
        ctx.migrating = false
      }
      break

    case 'createCard':
      await doCreateCard(ctx, msg.data as CreateCardData, authContext)
      break

    case 'moveCard':
      await doMoveCard(ctx, msg.cardId as string, msg.newStatus as string, msg.newOrder as number, authContext)
      break

    case 'deleteCard':
      await doDeleteCard(ctx, msg.cardId as string, authContext)
      break

    case 'permanentDeleteCard':
      await doPermanentDeleteCard(ctx, msg.cardId as string, authContext)
      break

    case 'restoreCard': {
      const restoreId = msg.cardId as string
      const defaultStatus = ctx.sdk.getSettings().defaultStatus
      await doUpdateCard(ctx, restoreId, { status: defaultStatus }, authContext)
      break
    }

    case 'purgeDeletedCards':
      await doPurgeDeletedCards(ctx, authContext)
      break

    case 'updateCard':
      await doUpdateCard(ctx, msg.cardId as string, msg.updates as Partial<Card>, authContext)
      break

    case 'bulkUpdateCard':
      await doUpdateCard(ctx, msg.cardId as string, msg.updates as Partial<Card>, authContext)
      break

    case 'openCard': {
      const cardId = msg.cardId as string
      const card = ctx.cards.find(f => f.id === cardId)
      if (!card) break

      // Clean up any temp file from a previously-opened card
      if (ctx.tempFileCardId && ctx.tempFileCardId !== cardId) {
        cleanupTempFile(ctx)
      }

      ctx.currentEditingCardId = cardId
      await ctx.sdk.setActiveCard(cardId, ctx.currentBoardId)
      await sendCardContent(ctx, ws, card)
      break
    }

    case 'saveCardContent': {
      const cardId = msg.cardId as string
      const newContent = msg.content as string
      const fm = msg.frontmatter as CardFrontmatter
      await doUpdateCard(ctx, cardId, {
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
      }, authContext)
      break
    }

    case 'submitForm': {
      const { cardId, formId, callbackKey, boardId } = msg as unknown as SubmitFormMessage
      try {
        const result = await doSubmitForm(ctx, {
          cardId,
          formId,
          data: parseSubmitData((msg as unknown as SubmitFormMessage).data),
          boardId,
        }, authContext)
        const updatedCard = ctx.cards.find(candidate => candidate.id === cardId)
        if (updatedCard && ctx.currentEditingCardId === cardId) {
          await sendCardContent(ctx, ws, updatedCard)
        }
        ws.send(JSON.stringify({ type: 'submitFormResult', callbackKey, result }))
      } catch (err) {
        ws.send(JSON.stringify({ type: 'submitFormResult', callbackKey, error: String(err) }))
      }
      break
    }

    case 'closeCard':
      ctx.currentEditingCardId = null
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
      doSaveSettings(ctx, msg.settings as CardDisplaySettings)
      break

    case 'addColumn': {
      const col = msg.column as { name: string; color: string }
      doAddColumn(ctx, col.name, col.color)
      break
    }

    case 'editColumn':
      doEditColumn(ctx, msg.columnId as string, msg.updates as { name: string; color: string })
      break

    case 'removeColumn':
      await doRemoveColumn(ctx, msg.columnId as string, authContext)
      break

    case 'cleanupColumn':
      await doCleanupColumn(ctx, msg.columnId as string, authContext)
      break

    case 'reorderColumns': {
      const columnIds = msg.columnIds as string[]
      const boardId = msg.boardId as string | undefined
      if (Array.isArray(columnIds)) {
        ctx.sdk.reorderColumns(columnIds, boardId)
        broadcast(ctx, buildInitMessage(ctx))
      }
      break
    }

    case 'setMinimizedColumns': {
      const columnIds = msg.columnIds as string[]
      const boardId = msg.boardId as string | undefined
      ctx.sdk.setMinimizedColumns(Array.isArray(columnIds) ? columnIds : [], boardId)
      break
    }

    case 'removeAttachment': {
      const cardId = msg.cardId as string
      const card = await doRemoveAttachment(ctx, cardId, msg.attachment as string, authContext)
      if (card && ctx.currentEditingCardId === cardId) {
        ws.send(JSON.stringify({ type: 'cardContent', cardId: card.id, content: card.content, frontmatter: buildCardFrontmatter(card), comments: card.comments || [] }))
      }
      break
    }

    case 'addComment': {
      const comment = await doAddComment(ctx, msg.cardId as string, msg.author as string, msg.content as string, authContext)
      if (!comment) break
      const card = ctx.cards.find(f => f.id === msg.cardId)
      if (card && ctx.currentEditingCardId === msg.cardId) {
        ws.send(JSON.stringify({ type: 'cardContent', cardId: card.id, content: card.content, frontmatter: buildCardFrontmatter(card), comments: card.comments || [] }))
      }
      break
    }

    case 'updateComment': {
      const comment = await doUpdateComment(ctx, msg.cardId as string, msg.commentId as string, msg.content as string, authContext)
      if (!comment) break
      const card = ctx.cards.find(f => f.id === msg.cardId)
      if (card && ctx.currentEditingCardId === msg.cardId) {
        ws.send(JSON.stringify({ type: 'cardContent', cardId: card.id, content: card.content, frontmatter: buildCardFrontmatter(card), comments: card.comments || [] }))
      }
      break
    }

    case 'deleteComment': {
      await doDeleteComment(ctx, msg.cardId as string, msg.commentId as string, authContext)
      const card = ctx.cards.find(f => f.id === msg.cardId)
      if (card && ctx.currentEditingCardId === msg.cardId) {
        ws.send(JSON.stringify({ type: 'cardContent', cardId: card.id, content: card.content, frontmatter: buildCardFrontmatter(card), comments: card.comments || [] }))
      }
      break
    }

    case 'addLog': {
      const entry = await doAddLog(
        ctx,
        msg.cardId as string,
        msg.text as string,
        msg.source as string | undefined,
        msg.object as Record<string, unknown> | undefined,
        msg.timestamp as string | undefined,
        authContext,
      )
      if (entry && ctx.currentEditingCardId === msg.cardId) {
        try {
          const logs = await ctx.sdk.listLogs(msg.cardId as string, ctx.currentBoardId)
          ws.send(JSON.stringify({ type: 'logsUpdated', cardId: msg.cardId, logs }))
        } catch { /* ignore */ }
      }
      break
    }

    case 'clearLogs': {
      await doClearLogs(ctx, msg.cardId as string, authContext)
      ws.send(JSON.stringify({ type: 'logsUpdated', cardId: msg.cardId, logs: [] }))
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
        const entry = await ctx.sdk.addBoardLog(
          msg.text as string,
          {
            source: msg.source as string | undefined,
            object: msg.object as Record<string, unknown> | undefined,
            timestamp: msg.timestamp as string | undefined,
          },
          ctx.currentBoardId || undefined,
          authContext,
        )
        const logs = await ctx.sdk.listBoardLogs(ctx.currentBoardId || undefined)
        ws.send(JSON.stringify({ type: 'boardLogsUpdated', boardId: ctx.currentBoardId, logs }))
        broadcast(ctx, buildInitMessage(ctx))
        void entry
      } catch { /* ignore */ }
      break
    }

    case 'clearBoardLogs': {
      await ctx.sdk.clearBoardLogs(ctx.currentBoardId || undefined, authContext)
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
        await ctx.sdk.transferCard(cardId, ctx.currentBoardId || readConfig(ctx.workspaceRoot).defaultBoard, toBoard, targetStatus, authContext)
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
        const createdBoard = ctx.sdk.createBoard('', boardName)
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
      ctx.sdk.setLabel(msg.name as string, msg.definition as { color: string; group?: string })
      broadcast(ctx, { type: 'labelsUpdated', labels: ctx.sdk.getLabels() })
      broadcast(ctx, buildInitMessage(ctx))
      break
    }

    case 'renameLabel': {
      await ctx.sdk.renameLabel(msg.oldName as string, msg.newName as string, authContext)
      await loadCards(ctx)
      broadcast(ctx, { type: 'labelsUpdated', labels: ctx.sdk.getLabels() })
      broadcast(ctx, buildInitMessage(ctx))
      break
    }

    case 'deleteLabel': {
      await ctx.sdk.deleteLabel(msg.name as string, authContext)
      await loadCards(ctx)
      broadcast(ctx, { type: 'labelsUpdated', labels: ctx.sdk.getLabels() })
      broadcast(ctx, buildInitMessage(ctx))
      break
    }

    case 'triggerAction': {
      const { cardId, action, callbackKey } = msg as { cardId: string; action: string; callbackKey: string }
      try {
        await ctx.sdk.triggerAction(cardId, action, undefined, authContext)
        ws.send(JSON.stringify({ type: 'actionResult', callbackKey }))
      } catch (err) {
        ws.send(JSON.stringify({ type: 'actionResult', callbackKey, error: String(err) }))
      }
      break
    }

    case 'triggerBoardAction': {
      const { boardId, actionKey, callbackKey } = msg as { boardId: string; actionKey: string; callbackKey: string }
      try {
        await ctx.sdk.triggerBoardAction(boardId, actionKey, authContext)
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
