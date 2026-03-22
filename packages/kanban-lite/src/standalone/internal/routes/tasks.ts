import * as fs from 'fs'
import type { Card, CreateCardPayload, Priority } from '../../../shared/types'
import { sanitizeCard, AuthError } from '../../../sdk/types'
import { authErrorToHttpStatus, extractAuthContext } from '../../authUtils'
import { broadcast, buildInitMessage } from '../../broadcastService'
import { getListCardsOptions, getSubmitErrorStatus, parseSubmitData } from '../../cardHelpers'
import {
  doAddAttachment,
  doAddComment,
  doAddLog,
  doClearLogs,
  doCreateCard,
  doDeleteCard,
  doDeleteComment,
  doMoveCard,
  doPermanentDeleteCard,
  doRemoveAttachment,
  doSubmitForm,
  doUpdateCard,
  doUpdateComment,
  type CreateCardData,
} from '../../mutationService'
import { MIME_TYPES, jsonError, jsonOk, readBody } from '../../httpUtils'
import { applyCommonCardFilters, getContentType, sendNoContent, type StandaloneRequestContext } from '../common'

export async function handleTaskRoutes(request: StandaloneRequestContext): Promise<boolean> {
  const { ctx, route, req, res, url } = request
  const { sdk } = ctx

  let params = route('GET', '/api/tasks')
  if (params) {
    const taskCards = await sdk.listCards(undefined, undefined, getListCardsOptions(url.searchParams))
    jsonOk(res, applyCommonCardFilters(taskCards, url.searchParams, ctx))
    return true
  }

  params = route('GET', '/api/tasks/active')
  if (params) {
    try {
      const card = await sdk.getActiveCard()
      jsonOk(res, card ? sanitizeCard(card) : null)
    } catch (err) {
      jsonError(res, 400, String(err))
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
        metadata: body.metadata as Record<string, unknown> | undefined,
        actions: body.actions as string[] | Record<string, string> | undefined,
        forms: body.forms as CreateCardPayload['forms'],
        formData: body.formData as CreateCardPayload['formData'],
      }
      if (!data.content) {
        jsonError(res, 400, 'content is required')
        return true
      }
      const card = await doCreateCard(ctx, data, extractAuthContext(req))
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

  params = route('GET', '/api/tasks/:id')
  if (params) {
    const taskParams = params
    const card = ctx.cards.find(item => item.id === taskParams.id)
    if (!card) {
      jsonError(res, 404, 'Task not found')
    } else {
      jsonOk(res, sanitizeCard(card))
    }
    return true
  }

  params = route('PUT', '/api/tasks/:id')
  if (params) {
    try {
      const body = await readBody(req)
      const card = await doUpdateCard(ctx, params.id, body as Partial<Card>, extractAuthContext(req))
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
      const body = await readBody(req)
      const result = await doSubmitForm(ctx, {
        cardId: params.id,
        formId: params.formId,
        data: parseSubmitData(body.data),
      }, extractAuthContext(req))
      jsonOk(res, result)
    } catch (err) {
      jsonError(res, getSubmitErrorStatus(err), String(err))
    }
    return true
  }

  params = route('PATCH', '/api/tasks/:id/move')
  if (params) {
    try {
      const body = await readBody(req)
      const newStatus = body.status as string
      const position = body.position as number ?? 0
      if (!newStatus) {
        jsonError(res, 400, 'status is required')
        return true
      }
      const card = await doMoveCard(ctx, params.id, newStatus, position, extractAuthContext(req))
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
      await sdk.triggerAction(params.id, params.action, undefined, extractAuthContext(req))
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
      const deleted = await doPermanentDeleteCard(ctx, params.id, extractAuthContext(req))
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
      const deleted = await doDeleteCard(ctx, params.id, extractAuthContext(req))
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

  params = route('POST', '/api/tasks/:id/attachments')
  if (params) {
    const taskParams = params
    try {
      const body = await readBody(req)
      const files = body.files as { name: string; data: string }[]
      if (!Array.isArray(files)) {
        jsonError(res, 400, 'files array is required')
        return true
      }
      const auth = extractAuthContext(req)
      for (const file of files) {
        const buffer = Buffer.from(file.data, 'base64')
        await doAddAttachment(ctx, taskParams.id, file.name, buffer, auth)
      }
      broadcast(ctx, buildInitMessage(ctx))
      const card = ctx.cards.find(item => item.id === taskParams.id)
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

  params = route('GET', '/api/tasks/:id/attachments/:filename')
  if (params) {
    const taskParams = params
    const card = ctx.cards.find(item => item.id === taskParams.id)
    if (!card) {
      jsonError(res, 404, 'Task not found')
      return true
    }
    const attachmentPath = await sdk.materializeAttachment(card, taskParams.filename)
    if (!attachmentPath) {
      jsonError(res, 501, 'Attachment provider does not expose a local file path')
      return true
    }
    const disposition = url.searchParams.get('download') === '1' ? 'attachment' : 'inline'
    fs.readFile(attachmentPath, (err, data) => {
      if (err) {
        res.writeHead(404)
        res.end('File not found')
        return
      }
      res.writeHead(200, {
        'Content-Type': getContentType(taskParams.filename, MIME_TYPES),
        'Content-Disposition': `${disposition}; filename="${taskParams.filename}"`,
        'Access-Control-Allow-Origin': '*',
      })
      res.end(data)
    })
    return true
  }

  params = route('DELETE', '/api/tasks/:id/attachments/:filename')
  if (params) {
    try {
      const card = await doRemoveAttachment(ctx, params.id, params.filename, extractAuthContext(req))
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

  params = route('GET', '/api/tasks/:id/comments')
  if (params) {
    const taskParams = params
    const card = ctx.cards.find(item => item.id === taskParams.id)
    if (!card) {
      jsonError(res, 404, 'Task not found')
    } else {
      jsonOk(res, card.comments || [])
    }
    return true
  }

  params = route('POST', '/api/tasks/:id/comments')
  if (params) {
    try {
      const body = await readBody(req)
      const author = body.author as string
      const content = body.content as string
      if (!author) {
        jsonError(res, 400, 'author is required')
        return true
      }
      if (!content) {
        jsonError(res, 400, 'content is required')
        return true
      }
      const comment = await doAddComment(ctx, params.id, author, content, extractAuthContext(req))
      if (!comment) {
        jsonError(res, 404, 'Task not found')
      } else {
        jsonOk(res, comment, 201)
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

  params = route('PUT', '/api/tasks/:id/comments/:commentId')
  if (params) {
    try {
      const body = await readBody(req)
      const content = body.content as string
      if (!content) {
        jsonError(res, 400, 'content is required')
        return true
      }
      const comment = await doUpdateComment(ctx, params.id, params.commentId, content, extractAuthContext(req))
      if (!comment) {
        jsonError(res, 404, 'Comment not found')
      } else {
        jsonOk(res, comment)
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

  params = route('DELETE', '/api/tasks/:id/comments/:commentId')
  if (params) {
    try {
      const deleted = await doDeleteComment(ctx, params.id, params.commentId, extractAuthContext(req))
      if (!deleted) {
        jsonError(res, 404, 'Comment not found')
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

  params = route('GET', '/api/tasks/:id/logs')
  if (params) {
    try {
      jsonOk(res, await sdk.listLogs(params.id, ctx.currentBoardId))
    } catch {
      jsonError(res, 404, 'Task not found')
    }
    return true
  }

  params = route('POST', '/api/tasks/:id/logs')
  if (params) {
    try {
      const body = await readBody(req)
      const text = body.text as string
      if (!text) {
        jsonError(res, 400, 'text is required')
        return true
      }
      const entry = await doAddLog(
        ctx,
        params.id,
        text,
        body.source as string | undefined,
        body.object as Record<string, unknown> | undefined,
        body.timestamp as string | undefined,
        extractAuthContext(req),
      )
      if (!entry) {
        jsonError(res, 404, 'Task not found')
      } else {
        jsonOk(res, entry, 201)
      }
    } catch (err) {
      jsonError(res, 400, String(err))
    }
    return true
  }

  params = route('DELETE', '/api/tasks/:id/logs')
  if (params) {
    const cleared = await doClearLogs(ctx, params.id, extractAuthContext(req))
    if (!cleared) {
      jsonError(res, 404, 'Task not found')
    } else {
      jsonOk(res, { cleared: true })
    }
    return true
  }

  return false
}
