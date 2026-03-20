import type { KanbanColumn, CreateCardPayload, Priority, Card } from '../../../shared/types'
import { readConfig } from '../../../shared/config'
import { sanitizeCard, AuthError } from '../../../sdk/types'
import { buildInitMessage, broadcast, loadCards } from '../../broadcastService'
import { getListCardsOptions, getSubmitErrorStatus, parseSubmitData } from '../../cardHelpers'
import { doSubmitForm } from '../../mutationService'
import { authErrorToHttpStatus, extractAuthContext } from '../../authUtils'
import { jsonError, jsonOk, readBody } from '../../httpUtils'
import { applyCommonCardFilters, type StandaloneRequestContext, sendNoContent } from '../common'

export async function handleBoardRoutes(request: StandaloneRequestContext): Promise<boolean> {
  const { ctx, route, req, res, url } = request
  const { sdk, workspaceRoot } = ctx

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
      const board = sdk.createBoard(id, name, {
        description: body.description as string | undefined,
        columns: body.columns as KanbanColumn[] | undefined,
      })
      jsonOk(res, board, 201)
    } catch (err) {
      jsonError(res, 400, String(err))
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
      jsonOk(res, sdk.updateBoard(params.boardId, body as Record<string, unknown>))
    } catch (err) {
      jsonError(res, 400, String(err))
    }
    return true
  }

  params = route('DELETE', '/api/boards/:boardId')
  if (params) {
    try {
      await sdk.deleteBoard(params.boardId, extractAuthContext(req))
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
      const actions = body.actions as Record<string, string>
      const existing = sdk.getBoardActions(params.boardId)
      for (const key of Object.keys(existing)) {
        if (!(key in actions)) sdk.removeBoardAction(params.boardId, key)
      }
      for (const [key, title] of Object.entries(actions)) {
        sdk.addBoardAction(params.boardId, key, title)
      }
      jsonOk(res, sdk.getBoardActions(params.boardId))
    } catch (err) {
      jsonError(res, 400, String(err))
    }
    return true
  }

  params = route('PUT', '/api/boards/:boardId/actions/:key')
  if (params) {
    try {
      const body = await readBody(req)
      jsonOk(res, sdk.addBoardAction(params.boardId, params.key, body.title as string))
    } catch (err) {
      jsonError(res, 400, String(err))
    }
    return true
  }

  params = route('DELETE', '/api/boards/:boardId/actions/:key')
  if (params) {
    try {
      sdk.removeBoardAction(params.boardId, params.key)
      sendNoContent(res)
    } catch (err) {
      jsonError(res, 404, String(err))
    }
    return true
  }

  params = route('POST', '/api/boards/:boardId/actions/:key/trigger')
  if (params) {
    try {
      await sdk.triggerBoardAction(params.boardId, params.key, extractAuthContext(req))
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
      const fromBoard = ctx.currentBoardId || config.defaultBoard
      const card = await sdk.transferCard(
        params.id,
        fromBoard,
        params.boardId,
        body.targetStatus as string | undefined,
        extractAuthContext(req),
      )
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
      jsonOk(res, applyCommonCardFilters(tasks, url.searchParams, ctx))
    } catch (err) {
      jsonError(res, 400, String(err))
    }
    return true
  }

  params = route('GET', '/api/boards/:boardId/tasks/active')
  if (params) {
    try {
      const card = await sdk.getActiveCard(params.boardId)
      jsonOk(res, card ? sanitizeCard(card) : null)
    } catch (err) {
      jsonError(res, 400, String(err))
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
      const card = await sdk.createCard({
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
        boardId: params.boardId,
      }, extractAuthContext(req))
      jsonOk(res, sanitizeCard(card), 201)
    } catch (err) {
      if (err instanceof AuthError) {
        jsonError(res, authErrorToHttpStatus(err), err.message)
      } else {
        jsonError(res, 400, String(err))
      }
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
        jsonOk(res, sanitizeCard(card))
      }
    } catch (err) {
      jsonError(res, 400, String(err))
    }
    return true
  }

  params = route('PUT', '/api/boards/:boardId/tasks/:id')
  if (params) {
    try {
      const body = await readBody(req)
      const card = await sdk.updateCard(params.id, body as Partial<Card>, params.boardId, extractAuthContext(req))
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
      const body = await readBody(req)
      const result = await doSubmitForm(ctx, {
        cardId: params.id,
        formId: params.formId,
        data: parseSubmitData(body.data),
        boardId: params.boardId,
      }, extractAuthContext(req))
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
      const card = await sdk.moveCard(params.id, newStatus, position, params.boardId, extractAuthContext(req))
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
      await sdk.triggerAction(params.id, params.action, params.boardId, extractAuthContext(req))
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
      await sdk.permanentlyDeleteCard(params.id, params.boardId, extractAuthContext(req))
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
      await sdk.deleteCard(params.id, params.boardId, extractAuthContext(req))
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
      const entry = await sdk.addBoardLog(text, {
        source: body.source as string | undefined,
        object: body.object as Record<string, unknown> | undefined,
        timestamp: body.timestamp as string | undefined,
      }, params.boardId, extractAuthContext(req))
      broadcast(ctx, buildInitMessage(ctx))
      jsonOk(res, entry, 201)
    } catch (err) {
      jsonError(res, 400, String(err))
    }
    return true
  }

  params = route('DELETE', '/api/boards/:boardId/logs')
  if (params) {
    await sdk.clearBoardLogs(params.boardId, extractAuthContext(req))
    broadcast(ctx, buildInitMessage(ctx))
    jsonOk(res, { cleared: true })
    return true
  }

  return false
}
