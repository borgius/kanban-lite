import type { KanbanColumn, CreateCardPayload, Priority, Card } from '../../../shared/types'
import { readConfig } from '../../../shared/config'
import type { CardStateCursor } from '../../../sdk/plugins'
import { sanitizeCard, AuthError } from '../../../sdk/types'
import { buildInitMessage, broadcast, loadCards } from '../../broadcastService'
import { getListCardsOptions, getSubmitErrorStatus, parseSubmitData } from '../../cardHelpers'
import { doSubmitForm } from '../../mutationService'
import { authErrorToHttpStatus, extractAuthContext, getAuthErrorLike, getCardStateErrorLike } from '../../authUtils'
import { jsonError, jsonOk, readBody } from '../../httpUtils'
import {
  buildCardReadModel,
  buildCardReadModels,
  buildCardStateMutationModel,
  type StandaloneRequestContext,
  sendNoContent,
} from '../common'

const REST_CARD_READ_OPTIONS = { rethrowCardStateErrors: true } as const

export async function handleBoardRoutes(request: StandaloneRequestContext): Promise<boolean> {
  const { ctx, route, req, res, url } = request
  const { sdk, workspaceRoot } = ctx
  const runWithRequestAuth = <T>(fn: () => Promise<T>): Promise<T> => sdk.runWithAuth(extractAuthContext(req), fn)
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
    jsonError(res, 400, String(err))
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
      const card = await runWithRequestAuth(() => sdk.transferCard(
        id,
        fromBoard,
        boardId,
        body.targetStatus as string | undefined,
      ))
      jsonOk(res, sanitizeCard(card))
    } catch (err) {
      jsonError(res, 400, String(err))
    }
    return true
  }

  params = route('GET', '/api/boards/:boardId/tasks')
  if (params) {
    try {
      const boardColumns = sdk.listColumns(params.boardId)
      const tasks = await sdk.listCards(
        boardColumns.map(column => column.id),
        params.boardId,
        getListCardsOptions(url.searchParams),
      )
      jsonOk(res, await buildCardReadModels(tasks, url.searchParams, ctx, runWithRequestAuth, REST_CARD_READ_OPTIONS))
    } catch (err) {
      handleKnownError(err)
    }
    return true
  }

  params = route('GET', '/api/boards/:boardId/tasks/active')
  if (params) {
    try {
      const card = await sdk.getActiveCard(params.boardId)
      jsonOk(res, card ? await buildCardReadModel(card, ctx, runWithRequestAuth, REST_CARD_READ_OPTIONS) : null)
    } catch (err) {
      handleKnownError(err)
    }
    return true
  }

  params = route('POST', '/api/boards/:boardId/tasks')
  if (params) {
    try {
      const body = await readBody(req)
      const content = (body.content as string) || ''
      if (!content) {
        jsonError(res, 400, 'content is required')
        return true
      }
      const { boardId } = params
      const card = await runWithRequestAuth(() => sdk.createCard({
        content,
        status: (body.status as string) || 'backlog',
        priority: (body.priority as Priority) || 'medium',
        assignee: (body.assignee as string) || null,
        dueDate: (body.dueDate as string) || null,
        labels: (body.labels as string[]) || [],
        metadata: body.metadata as Record<string, unknown> | undefined,
        actions: body.actions as string[] | Record<string, string> | undefined,
        forms: body.forms as CreateCardPayload['forms'],
        formData: body.formData as CreateCardPayload['formData'],
        boardId,
      }))
      jsonOk(res, sanitizeCard(card), 201)
    } catch (err) {
      handleKnownError(err)
    }
    return true
  }

  params = route('GET', '/api/boards/:boardId/tasks/:id')
  if (params) {
    try {
      const card = await sdk.getCard(params.id, params.boardId)
      if (!card) {
        jsonError(res, 404, 'Task not found')
      } else {
        jsonOk(res, await buildCardReadModel(card, ctx, runWithRequestAuth, REST_CARD_READ_OPTIONS))
      }
    } catch (err) {
      handleKnownError(err)
    }
    return true
  }

  params = route('POST', '/api/boards/:boardId/tasks/:id/open')
  if (params) {
    try {
      const { boardId, id } = params
      const card = await sdk.getCard(id, boardId)
      if (!card) {
        jsonError(res, 404, 'Task not found')
        return true
      }
      const unread = await runWithRequestAuth(() => sdk.markCardOpened(card.id, boardId))
      jsonOk(res, await buildCardStateMutationModel(ctx, unread, runWithRequestAuth))
    } catch (err) {
      handleKnownError(err)
    }
    return true
  }

  params = route('POST', '/api/boards/:boardId/tasks/:id/read')
  if (params) {
    try {
      const { boardId, id } = params
      const card = await sdk.getCard(id, boardId)
      if (!card) {
        jsonError(res, 404, 'Task not found')
        return true
      }
      const body = await readBody(req)
      const readThrough = body.readThrough as CardStateCursor | undefined
      const unread = await runWithRequestAuth(() => sdk.markCardRead(card.id, boardId, readThrough))
      jsonOk(res, await buildCardStateMutationModel(ctx, unread, runWithRequestAuth))
    } catch (err) {
      handleKnownError(err)
    }
    return true
  }

  params = route('PUT', '/api/boards/:boardId/tasks/:id')
  if (params) {
    try {
      const body = await readBody(req)
      const { id, boardId } = params
      const card = await runWithRequestAuth(() => sdk.updateCard(id, body as Partial<Card>, boardId))
      jsonOk(res, sanitizeCard(card))
    } catch (err) {
      if (err instanceof AuthError) {
        jsonError(res, authErrorToHttpStatus(err), err.message)
      } else {
        jsonError(res, 400, String(err))
      }
    }
    return true
  }

  params = route('POST', '/api/boards/:boardId/tasks/:id/forms/:formId/submit')
  if (params) {
    try {
      const { id, formId, boardId } = params
      const body = await readBody(req)
      const result = await runWithRequestAuth(() => doSubmitForm(ctx, {
        cardId: id,
        formId,
        data: parseSubmitData(body.data),
        boardId,
      }))
      jsonOk(res, result)
    } catch (err) {
      jsonError(res, getSubmitErrorStatus(err), String(err))
    }
    return true
  }

  params = route('PATCH', '/api/boards/:boardId/tasks/:id/move')
  if (params) {
    try {
      const body = await readBody(req)
      const newStatus = body.status as string
      const position = body.position as number ?? 0
      if (!newStatus) {
        jsonError(res, 400, 'status is required')
        return true
      }
      const { id, boardId } = params
      const card = await runWithRequestAuth(() => sdk.moveCard(id, newStatus, position, boardId))
      jsonOk(res, sanitizeCard(card))
    } catch (err) {
      if (err instanceof AuthError) {
        jsonError(res, authErrorToHttpStatus(err), err.message)
      } else {
        jsonError(res, 400, String(err))
      }
    }
    return true
  }

  params = route('POST', '/api/boards/:boardId/tasks/:id/actions/:action')
  if (params) {
    try {
      const { id, action, boardId } = params
      await runWithRequestAuth(() => sdk.triggerAction(id, action, boardId))
      sendNoContent(res)
    } catch (err) {
      const message = String(err)
      jsonError(res, message.includes('Card not found') ? 404 : 400, message)
    }
    return true
  }

  params = route('DELETE', '/api/boards/:boardId/tasks/:id/permanent')
  if (params) {
    try {
      const { id, boardId } = params
      await runWithRequestAuth(() => sdk.permanentlyDeleteCard(id, boardId))
      await loadCards(ctx)
      broadcast(ctx, buildInitMessage(ctx))
      jsonOk(res, { deleted: true, permanent: true })
    } catch (err) {
      if (err instanceof AuthError) {
        jsonError(res, authErrorToHttpStatus(err), err.message)
      } else {
        jsonError(res, 400, String(err))
      }
    }
    return true
  }

  params = route('DELETE', '/api/boards/:boardId/tasks/:id')
  if (params) {
    try {
      const { id, boardId } = params
      await runWithRequestAuth(() => sdk.deleteCard(id, boardId))
      await loadCards(ctx)
      broadcast(ctx, buildInitMessage(ctx))
      jsonOk(res, { deleted: true })
    } catch (err) {
      if (err instanceof AuthError) {
        jsonError(res, authErrorToHttpStatus(err), err.message)
      } else {
        jsonError(res, 400, String(err))
      }
    }
    return true
  }

  params = route('GET', '/api/boards/:boardId/columns')
  if (params) {
    try {
      jsonOk(res, sdk.listColumns(params.boardId))
    } catch (err) {
      jsonError(res, 400, String(err))
    }
    return true
  }

  params = route('GET', '/api/boards/:boardId/logs')
  if (params) {
    jsonOk(res, await sdk.listBoardLogs(params.boardId))
    return true
  }

  params = route('POST', '/api/boards/:boardId/logs')
  if (params) {
    try {
      const body = await readBody(req)
      const text = body.text as string
      if (!text) {
        jsonError(res, 400, 'text is required')
        return true
      }
      const { boardId } = params
      const entry = await runWithRequestAuth(() => sdk.addBoardLog(text, {
        source: body.source as string | undefined,
        object: body.object as Record<string, unknown> | undefined,
        timestamp: body.timestamp as string | undefined,
      }, boardId))
      broadcast(ctx, buildInitMessage(ctx))
      jsonOk(res, entry, 201)
    } catch (err) {
      jsonError(res, 400, String(err))
    }
    return true
  }

  params = route('DELETE', '/api/boards/:boardId/logs')
  if (params) {
    const { boardId } = params
    await runWithRequestAuth(() => sdk.clearBoardLogs(boardId))
    broadcast(ctx, buildInitMessage(ctx))
    jsonOk(res, { cleared: true })
    return true
  }

  return false
}
