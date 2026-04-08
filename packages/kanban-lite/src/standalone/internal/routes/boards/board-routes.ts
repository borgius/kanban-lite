import type { KanbanColumn, CreateCardPayload, Priority, Card } from '../../../../shared/types'
import { readConfig } from '../../../../shared/config'
import type { CardStateCursor } from '../../../../sdk/plugins'
import { buildChecklistReadModel, coerceChecklistSeedTasks, type ChecklistSeedTaskInput } from '../../../../sdk/modules/checklist'
import { sanitizeCard, AuthError } from '../../../../sdk/types'
import { buildInitMessage, broadcast, loadCards } from '../../../broadcastService'
import { getListCardsOptions, getSubmitErrorStatus, parseSubmitData } from '../../../cardHelpers'
import {
  doAddChecklistItem,
  doCheckChecklistItem,
  doDeleteChecklistItem,
  doEditChecklistItem,
  doSubmitForm,
  doUncheckChecklistItem,
} from '../../../mutationService'
import { authErrorToHttpStatus, extractAuthContext, getAuthErrorLike, getCardStateErrorLike } from '../../../authUtils'
import { jsonError, jsonOk, readBody } from '../../../httpUtils'
import {
  buildCardReadModel,
  buildCardReadModels,
  buildCardStateMutationModel,
  type StandaloneRequestContext,
  sendNoContent,
} from '../../common'

const REST_CARD_READ_OPTIONS = { rethrowCardStateErrors: true } as const
const REST_CARD_LIST_READ_OPTIONS = REST_CARD_READ_OPTIONS
const REST_CARD_DETAIL_READ_OPTIONS = { ...REST_CARD_READ_OPTIONS, includeResolvedForms: true } as const
export async function handleBoardCrudRoutes(request: StandaloneRequestContext): Promise<boolean> {
  const { ctx, route, req, res, url } = request
  const { sdk, workspaceRoot } = ctx
  const runWithRequestAuth = <T>(fn: () => Promise<T>): Promise<T> => sdk.runWithAuth(extractAuthContext(req), fn)
  const getRequestScopedCard = (cardId: string, boardId?: string) => runWithRequestAuth(() => sdk.getCard(cardId, boardId))
  const getErrorMessage = (err: unknown): string => err instanceof Error ? err.message : String(err)
  const parseChecklistIndex = (value: string): number => {
    const index = Number.parseInt(value, 10)
    if (!Number.isInteger(index) || index < 0) {
      throw new Error('Checklist index must be a non-negative integer')
    }
    return index
  }
  const handleKnownError = (err: unknown): void => {
    const authErr = getAuthErrorLike(err)
    if (authErr) {
      jsonError(res, authErrorToHttpStatus(authErr), authErr.message)
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

  let params = route('GET', '/api/boards')
  if (params) {
    jsonOk(res, sdk.listBoards())
    return true
  }

  params = route('POST', '/api/boards')
  if (params) {
    try {
      const body = await readBody(req)
      const id = body.id as string
      const name = body.name as string
      if (!id) {
        jsonError(res, 400, 'id is required')
        return true
      }
      if (!name) {
        jsonError(res, 400, 'name is required')
        return true
      }
      const board = await runWithRequestAuth(() => sdk.createBoard(id, name, {
        description: body.description as string | undefined,
        columns: body.columns as KanbanColumn[] | undefined,
      }))
      jsonOk(res, board, 201)
    } catch (err) {
      const authErr = getAuthErrorLike(err)
      if (authErr) {
        jsonError(res, authErrorToHttpStatus(authErr), authErr.message)
      } else {
        jsonError(res, 400, String(err))
      }
    }
    return true
  }

  params = route('GET', '/api/boards/:boardId')
  if (params) {
    try {
      jsonOk(res, sdk.getBoard(params.boardId))
    } catch (err) {
      jsonError(res, 404, String(err))
    }
    return true
  }

  params = route('PUT', '/api/boards/:boardId')
  if (params) {
    try {
      const body = await readBody(req)
      const { boardId } = params
      jsonOk(res, await runWithRequestAuth(() => sdk.updateBoard(boardId, body as Record<string, unknown>)))
    } catch (err) {
      const authErr = getAuthErrorLike(err)
      if (authErr) {
        jsonError(res, authErrorToHttpStatus(authErr), authErr.message)
      } else {
        jsonError(res, 400, String(err))
      }
    }
    return true
  }

  params = route('DELETE', '/api/boards/:boardId')
  if (params) {
    try {
      const { boardId } = params
      await runWithRequestAuth(() => sdk.deleteBoard(boardId))
      jsonOk(res, { deleted: true })
    } catch (err) {
      const authErr = getAuthErrorLike(err)
      if (authErr) {
        jsonError(res, authErrorToHttpStatus(authErr), authErr.message)
      } else {
        jsonError(res, 400, String(err))
      }
    }
    return true
  }

  params = route('GET', '/api/boards/:boardId/actions')
  if (params) {
    try {
      jsonOk(res, sdk.getBoardActions(params.boardId))
    } catch (err) {
      jsonError(res, 404, String(err))
    }
    return true
  }

  params = route('POST', '/api/boards/:boardId/actions')
  if (params) {
    try {
      const body = await readBody(req)
      const { boardId } = params
      const actions = body.actions as Record<string, string>
      const existing = sdk.getBoardActions(boardId)
      for (const key of Object.keys(existing)) {
        if (!(key in actions)) await runWithRequestAuth(() => sdk.removeBoardAction(boardId, key))
      }
      for (const [key, title] of Object.entries(actions)) {
        await runWithRequestAuth(() => sdk.addBoardAction(boardId, key, title))
      }
      jsonOk(res, sdk.getBoardActions(boardId))
    } catch (err) {
      if (err instanceof AuthError) {
        jsonError(res, authErrorToHttpStatus(err), err.message)
      } else {
        jsonError(res, 400, String(err))
      }
    }
    return true
  }

  params = route('PUT', '/api/boards/:boardId/actions/:key')
  if (params) {
    try {
      const body = await readBody(req)
      const { boardId, key } = params
      jsonOk(res, await runWithRequestAuth(() => sdk.addBoardAction(boardId, key, body.title as string)))
    } catch (err) {
      if (err instanceof AuthError) {
        jsonError(res, authErrorToHttpStatus(err), err.message)
      } else {
        jsonError(res, 400, String(err))
      }
    }
    return true
  }

  params = route('DELETE', '/api/boards/:boardId/actions/:key')
  if (params) {
    try {
      const { boardId, key } = params
      await runWithRequestAuth(() => sdk.removeBoardAction(boardId, key))
      sendNoContent(res)
    } catch (err) {
      if (err instanceof AuthError) {
        jsonError(res, authErrorToHttpStatus(err), err.message)
      } else {
        jsonError(res, 404, String(err))
      }
    }
    return true
  }

  params = route('POST', '/api/boards/:boardId/actions/:key/trigger')
  if (params) {
    try {
      const { boardId, key } = params
      await runWithRequestAuth(() => sdk.triggerBoardAction(boardId, key))
      sendNoContent(res)
    } catch (err) {
      jsonError(res, 404, String(err))
    }
    return true
  }

  params = route('POST', '/api/boards/:boardId/tasks/:id/transfer')
  if (params) {
    try {
      const body = await readBody(req)
      const config = readConfig(workspaceRoot)
      const { id, boardId } = params
      const fromBoard = ctx.currentBoardId || config.defaultBoard
      const sourceCard = await getRequestScopedCard(id, fromBoard)
      if (!sourceCard) {
        jsonError(res, 404, 'Task not found')
        return true
      }
      const card = await runWithRequestAuth(() => sdk.transferCard(
        id,
        fromBoard,
        boardId,
        body.targetStatus as string | undefined,
      ))
      jsonOk(res, sanitizeCard(card))
    } catch (err) {
      handleKnownError(err)
    }
    return true
  }
  return false
}
