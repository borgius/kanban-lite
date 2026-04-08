import { WebSocket } from 'ws'
import type { SubmitFormMessage, Card, CardFrontmatter } from '../../shared/types'
import { CardStateError } from '../../sdk/types'
import type { AuthContext } from '../../sdk/types'
import type { StandaloneContext } from '../context'
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
} from '../broadcastService'
import { parseSubmitData } from '../cardHelpers'
import {
  doAddChecklistItem,
  doCreateCard,
  doMoveCard,
  doUpdateCard,
  doEditChecklistItem,
  doDeleteChecklistItem,
  doCheckChecklistItem,
  doUncheckChecklistItem,
  doDeleteCard,
  doPermanentDeleteCard,
  doPurgeDeletedCards,
  doSubmitForm,
  type CreateCardData,
} from '../mutationService'
import { cleanupTempFile } from '../watcherSetup'

type RunWithScopedAuth = <T>(fn: () => Promise<T>) => Promise<T>

export async function dispatchCardMessage(
  ctx: StandaloneContext,
  ws: WebSocket,
  msg: Record<string, unknown>,
  runWithScopedAuth: RunWithScopedAuth,
  authContext: AuthContext
): Promise<boolean> {
  const parseChecklistIndex = (value: unknown): number => {
    const index = typeof value === 'number'
      ? value
      : Number.parseInt(String(value), 10)
    if (!Number.isInteger(index) || index < 0) {
      throw new Error('Checklist index must be a non-negative integer')
    }
    return index
  }
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

    case 'addChecklistItem': {
      const updatedCard = await runWithScopedAuth(() => doAddChecklistItem(
        ctx,
        msg.cardId as string,
        msg.title as string,
        typeof msg.description === 'string' ? msg.description : '',
        msg.expectedToken as string,
        typeof msg.boardId === 'string' ? msg.boardId : ctx.currentBoardId,
      ))
      if (updatedCard) {
        await broadcastCardContentToEditingClients(ctx, updatedCard)
      }
      break
    }

    case 'editChecklistItem': {
      const updatedCard = await runWithScopedAuth(() => doEditChecklistItem(
        ctx,
        msg.cardId as string,
        parseChecklistIndex(msg.index),
        msg.title as string,
        typeof msg.description === 'string' ? msg.description : '',
        typeof msg.modifiedAt === 'string' ? msg.modifiedAt : undefined,
        typeof msg.boardId === 'string' ? msg.boardId : ctx.currentBoardId,
      ))
      if (updatedCard) {
        await broadcastCardContentToEditingClients(ctx, updatedCard)
      }
      break
    }

    case 'deleteChecklistItem': {
      const updatedCard = await runWithScopedAuth(() => doDeleteChecklistItem(
        ctx,
        msg.cardId as string,
        parseChecklistIndex(msg.index),
        typeof msg.modifiedAt === 'string' ? msg.modifiedAt : undefined,
        typeof msg.boardId === 'string' ? msg.boardId : ctx.currentBoardId,
      ))
      if (updatedCard) {
        await broadcastCardContentToEditingClients(ctx, updatedCard)
      }
      break
    }

    case 'checkChecklistItem': {
      const updatedCard = await runWithScopedAuth(() => doCheckChecklistItem(
        ctx,
        msg.cardId as string,
        parseChecklistIndex(msg.index),
        typeof msg.modifiedAt === 'string' ? msg.modifiedAt : undefined,
        typeof msg.boardId === 'string' ? msg.boardId : ctx.currentBoardId,
      ))
      if (updatedCard) {
        await broadcastCardContentToEditingClients(ctx, updatedCard)
      }
      break
    }

    case 'uncheckChecklistItem': {
      const updatedCard = await runWithScopedAuth(() => doUncheckChecklistItem(
        ctx,
        msg.cardId as string,
        parseChecklistIndex(msg.index),
        typeof msg.modifiedAt === 'string' ? msg.modifiedAt : undefined,
        typeof msg.boardId === 'string' ? msg.boardId : ctx.currentBoardId,
      ))
      if (updatedCard) {
        await broadcastCardContentToEditingClients(ctx, updatedCard)
      }
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
    default:
      return false
  }
  return true
}
