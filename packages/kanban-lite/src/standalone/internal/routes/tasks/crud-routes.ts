import * as fs from 'fs'
import type { Card, CreateCardPayload, Priority } from '../../../../shared/types'
import type { CardStateCursor } from '../../../../sdk/plugins'
import { buildChecklistReadModel, coerceChecklistSeedTasks, type ChecklistSeedTaskInput } from '../../../../sdk/modules/checklist'
import { sanitizeCard, AuthError } from '../../../../sdk/types'
import { authErrorToHttpStatus, extractAuthContext, getCardStateErrorLike } from '../../../authUtils'
import { broadcast, broadcastCardContentToEditingClients, broadcastCommentStreamStart, broadcastCommentChunk, broadcastCommentStreamDone, broadcastLogsUpdatedToEditingClients, buildInitMessage, loadCards } from '../../../broadcastService'
import { getListCardsOptions, getSubmitErrorStatus, parseSubmitData } from '../../../cardHelpers'
import {
  doAddAttachment,
  doAddComment,
  doAddChecklistItem,
  doAddLog,
  doCheckChecklistItem,
  doClearLogs,
  doCreateCard,
  doDeleteChecklistItem,
  doDeleteCard,
  doDeleteComment,
  doEditChecklistItem,
  doMoveCard,
  doPermanentDeleteCard,
  doRemoveAttachment,
  doSubmitForm,
  doUncheckChecklistItem,
  doUpdateCard,
  doUpdateComment,
  type CreateCardData,
} from '../../../mutationService'
import { MIME_TYPES, jsonError, jsonOk, readBody } from '../../../httpUtils'
import {
  buildCardReadModel,
  buildCardReadModels,
  buildCardStateMutationModel,
  getContentType,
  sendNoContent,
  type StandaloneRequestContext,
} from '../../common'

const REST_CARD_READ_OPTIONS = { rethrowCardStateErrors: true } as const
const REST_CARD_LIST_READ_OPTIONS = REST_CARD_READ_OPTIONS
const REST_CARD_DETAIL_READ_OPTIONS = { ...REST_CARD_READ_OPTIONS, includeResolvedForms: true } as const


export async function handleTaskCrudRoutes(request: StandaloneRequestContext): Promise<boolean> {
  const { ctx, route, req, res, url } = request
  const { sdk } = ctx
  const runWithRequestAuth = <T>(fn: () => Promise<T>): Promise<T> => sdk.runWithAuth(extractAuthContext(req), fn)
  const getRequestScopedCard = (cardId: string, boardId = ctx.currentBoardId) => runWithRequestAuth(() => sdk.getCard(cardId, boardId))
  const getErrorMessage = (err: unknown): string => err instanceof Error ? err.message : String(err)
  const parseChecklistIndex = (value: string): number => {
    const index = Number.parseInt(value, 10)
    if (!Number.isInteger(index) || index < 0) {
      throw new Error('Checklist index must be a non-negative integer')
    }
    return index
  }
  const handleKnownError = (err: unknown): void => {
    if (err instanceof AuthError) {
      jsonError(res, authErrorToHttpStatus(err), err.message)
      return
    }
    const cardStateErr = getCardStateErrorLike(err)
    if (cardStateErr) {
      jsonError(res, 400, cardStateErr.message)
      return
    }
    const message = getErrorMessage(err)
    if (message.includes('Card not found')) {
      jsonError(res, 404, 'Task not found')
      return
    }
    jsonError(res, 400, message)
  }

  let params = route('GET', '/api/tasks')
  if (params) {
    try {
      const taskCards = await runWithRequestAuth(() => sdk.listCards(undefined, undefined, getListCardsOptions(url.searchParams)))
      jsonOk(res, await buildCardReadModels(taskCards, url.searchParams, ctx, runWithRequestAuth, REST_CARD_LIST_READ_OPTIONS))
    } catch (err) {
      handleKnownError(err)
    }
    return true
  }

  params = route('GET', '/api/tasks/active')
  if (params) {
    try {
      const card = await runWithRequestAuth(() => sdk.getActiveCard())
      jsonOk(res, card ? await buildCardReadModel(card, ctx, runWithRequestAuth, REST_CARD_DETAIL_READ_OPTIONS) : null)
    } catch (err) {
      handleKnownError(err)
    }
    return true
  }

  params = route('POST', '/api/tasks')
  if (params) {
    try {
      const body = await readBody(req)
      const data: CreateCardData = {
        content: (body.content as string) || '',
        status: (body.status as string) || 'backlog',
        priority: (body.priority as Priority) || 'medium',
        assignee: (body.assignee as string) || null,
        dueDate: (body.dueDate as string) || null,
        labels: (body.labels as string[]) || [],
        tasks: coerceChecklistSeedTasks(body.tasks as ChecklistSeedTaskInput[] | undefined),
        metadata: body.metadata as Record<string, unknown> | undefined,
        actions: body.actions as string[] | Record<string, string> | undefined,
        forms: body.forms as CreateCardPayload['forms'],
        formData: body.formData as CreateCardPayload['formData'],
      }
      if (!data.content) {
        jsonError(res, 400, 'content is required')
        return true
      }
      const card = await runWithRequestAuth(() => doCreateCard(ctx, data))
      jsonOk(res, sanitizeCard(card), 201)
    } catch (err) {
      handleKnownError(err)
    }
    return true
  }

  params = route('GET', '/api/tasks/:id/checklist')
  if (params) {
    try {
      const card = await getRequestScopedCard(params.id)
      if (!card) {
        jsonError(res, 404, 'Task not found')
      } else {
        jsonOk(res, buildChecklistReadModel(card))
      }
    } catch (err) {
      handleKnownError(err)
    }
    return true
  }

  params = route('POST', '/api/tasks/:id/checklist')
  if (params) {
    try {
      const { id } = params
      const body = await readBody(req)
      if (typeof body.title !== 'string' || body.title.trim().length === 0) {
        jsonError(res, 400, 'title is required')
        return true
      }
      if (typeof body.expectedToken !== 'string' || body.expectedToken.trim().length === 0) {
        jsonError(res, 400, 'expectedToken is required')
        return true
      }
      const card = await runWithRequestAuth(() => doAddChecklistItem(
        ctx,
        id,
        body.title as string,
        typeof body.description === 'string' ? body.description : '',
        body.expectedToken as string,
      ))
      if (!card) {
        jsonError(res, 404, 'Task not found')
      } else {
        jsonOk(res, buildChecklistReadModel(card))
      }
    } catch (err) {
      handleKnownError(err)
    }
    return true
  }

  params = route('PUT', '/api/tasks/:id/checklist/:index')
  if (params) {
    try {
      const { id, index } = params
      const body = await readBody(req)
      if (typeof body.title !== 'string' || body.title.trim().length === 0) {
        jsonError(res, 400, 'title is required')
        return true
      }
      const card = await runWithRequestAuth(() => doEditChecklistItem(
        ctx,
        id,
        parseChecklistIndex(index),
        body.title as string,
        typeof body.description === 'string' ? body.description : '',
        typeof body.modifiedAt === 'string' ? body.modifiedAt : undefined,
      ))
      if (!card) {
        jsonError(res, 404, 'Task not found')
      } else {
        jsonOk(res, buildChecklistReadModel(card))
      }
    } catch (err) {
      handleKnownError(err)
    }
    return true
  }

  params = route('DELETE', '/api/tasks/:id/checklist/:index')
  if (params) {
    try {
      const { id, index } = params
      const body = await readBody(req)
      const card = await runWithRequestAuth(() => doDeleteChecklistItem(
        ctx,
        id,
        parseChecklistIndex(index),
        typeof body.modifiedAt === 'string' ? body.modifiedAt : undefined,
      ))
      if (!card) {
        jsonError(res, 404, 'Task not found')
      } else {
        jsonOk(res, buildChecklistReadModel(card))
      }
    } catch (err) {
      handleKnownError(err)
    }
    return true
  }

  params = route('POST', '/api/tasks/:id/checklist/:index/check')
  if (params) {
    try {
      const { id, index } = params
      const body = await readBody(req)
      const card = await runWithRequestAuth(() => doCheckChecklistItem(
        ctx,
        id,
        parseChecklistIndex(index),
        typeof body.modifiedAt === 'string' ? body.modifiedAt : undefined,
      ))
      if (!card) {
        jsonError(res, 404, 'Task not found')
      } else {
        jsonOk(res, buildChecklistReadModel(card))
      }
    } catch (err) {
      handleKnownError(err)
    }
    return true
  }

  params = route('POST', '/api/tasks/:id/checklist/:index/uncheck')
  if (params) {
    try {
      const { id, index } = params
      const body = await readBody(req)
      const card = await runWithRequestAuth(() => doUncheckChecklistItem(
        ctx,
        id,
        parseChecklistIndex(index),
        typeof body.modifiedAt === 'string' ? body.modifiedAt : undefined,
      ))
      if (!card) {
        jsonError(res, 404, 'Task not found')
      } else {
        jsonOk(res, buildChecklistReadModel(card))
      }
    } catch (err) {
      handleKnownError(err)
    }
    return true
  }

  params = route('GET', '/api/tasks/:id')
  if (params) {
    try {
      const taskParams = params
      const card = await getRequestScopedCard(taskParams.id)
      if (!card) {
        jsonError(res, 404, 'Task not found')
      } else {
        jsonOk(res, await buildCardReadModel(card, ctx, runWithRequestAuth, REST_CARD_DETAIL_READ_OPTIONS))
      }
    } catch (err) {
      handleKnownError(err)
    }
    return true
  }

  params = route('POST', '/api/tasks/:id/open')
  if (params) {
    try {
      const card = await getRequestScopedCard(params.id)
      if (!card) {
        jsonError(res, 404, 'Task not found')
        return true
      }
      const unread = await runWithRequestAuth(() => sdk.markCardOpened(card.id, card.boardId))
      jsonOk(res, await buildCardStateMutationModel(ctx, unread, runWithRequestAuth))
    } catch (err) {
      handleKnownError(err)
    }
    return true
  }

  params = route('POST', '/api/tasks/:id/read')
  if (params) {
    try {
      const card = await getRequestScopedCard(params.id)
      if (!card) {
        jsonError(res, 404, 'Task not found')
        return true
      }
      const body = await readBody(req)
      const readThrough = body.readThrough as CardStateCursor | undefined
      const unread = await runWithRequestAuth(() => sdk.markCardRead(card.id, card.boardId, readThrough))
      jsonOk(res, await buildCardStateMutationModel(ctx, unread, runWithRequestAuth))
    } catch (err) {
      handleKnownError(err)
    }
    return true
  }

  params = route('PUT', '/api/tasks/:id')
  if (params) {
    try {
      const { id } = params
      const body = await readBody(req)
      const card = await runWithRequestAuth(() => doUpdateCard(ctx, id, body as Partial<Card>))
      if (!card) {
        jsonError(res, 404, 'Task not found')
      } else {
        jsonOk(res, sanitizeCard(card))
      }
    } catch (err) {
      if (err instanceof AuthError) {
        jsonError(res, authErrorToHttpStatus(err), err.message)
      } else {
        jsonError(res, 400, String(err))
      }
    }
    return true
  }

  params = route('POST', '/api/tasks/:id/forms/:formId/submit')
  if (params) {
    try {
      const { id, formId } = params
      const body = await readBody(req)
      const result = await runWithRequestAuth(() => doSubmitForm(ctx, {
        cardId: id,
        formId,
        data: parseSubmitData(body.data),
      }))
      jsonOk(res, result)
    } catch (err) {
      jsonError(res, getSubmitErrorStatus(err), String(err))
    }
    return true
  }

  params = route('PATCH', '/api/tasks/:id/move')
  if (params) {
    try {
      const { id } = params
      const body = await readBody(req)
      const newStatus = body.status as string
      const position = body.position as number ?? 0
      if (!newStatus) {
        jsonError(res, 400, 'status is required')
        return true
      }
      const card = await runWithRequestAuth(() => doMoveCard(ctx, id, newStatus, position))
      if (!card) {
        jsonError(res, 404, 'Task not found')
      } else {
        jsonOk(res, sanitizeCard(card))
      }
    } catch (err) {
      if (err instanceof AuthError) {
        jsonError(res, authErrorToHttpStatus(err), err.message)
      } else {
        jsonError(res, 400, String(err))
      }
    }
    return true
  }

  params = route('POST', '/api/tasks/:id/actions/:action')
  if (params) {
    try {
      const { id, action } = params
      await runWithRequestAuth(() => sdk.triggerAction(id, action, undefined))
      await loadCards(ctx)
      broadcast(ctx, buildInitMessage(ctx))
      const updatedCard = ctx.cards.find(card => card.id === id)
      if (updatedCard) {
        await broadcastCardContentToEditingClients(ctx, updatedCard)
      }
      sendNoContent(res)
    } catch (err) {
      const message = String(err)
      jsonError(res, message.includes('Card not found') ? 404 : 400, message)
    }
    return true
  }

  params = route('DELETE', '/api/tasks/:id/permanent')
  if (params) {
    try {
      const { id } = params
      const deleted = await runWithRequestAuth(() => doPermanentDeleteCard(ctx, id))
      if (!deleted) {
        jsonError(res, 404, 'Task not found')
      } else {
        jsonOk(res, { deleted: true, permanent: true })
      }
    } catch (err) {
      if (err instanceof AuthError) {
        jsonError(res, authErrorToHttpStatus(err), err.message)
      } else {
        jsonError(res, 400, String(err))
      }
    }
    return true
  }

  params = route('DELETE', '/api/tasks/:id')
  if (params) {
    try {
      const { id } = params
      const deleted = await runWithRequestAuth(() => doDeleteCard(ctx, id))
      if (!deleted) {
        jsonError(res, 404, 'Task not found')
      } else {
        jsonOk(res, { deleted: true })
      }
    } catch (err) {
      if (err instanceof AuthError) {
        jsonError(res, authErrorToHttpStatus(err), err.message)
      } else {
        jsonError(res, 400, String(err))
      }
    }
    return true
  }



  return false
}
