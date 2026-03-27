import * as fs from 'fs'
import type { Card, CreateCardPayload, Priority } from '../../../shared/types'
import type { CardStateCursor } from '../../../sdk/plugins'
import { sanitizeCard, AuthError } from '../../../sdk/types'
import { authErrorToHttpStatus, extractAuthContext, getCardStateErrorLike } from '../../authUtils'
import { broadcast, broadcastCardContentToEditingClients, broadcastCommentStreamStart, broadcastCommentChunk, broadcastCommentStreamDone, broadcastLogsUpdatedToEditingClients, buildInitMessage, loadCards } from '../../broadcastService'
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
import {
  buildCardReadModel,
  buildCardReadModels,
  buildCardStateMutationModel,
  getContentType,
  sendNoContent,
  type StandaloneRequestContext,
} from '../common'

export async function handleTaskRoutes(request: StandaloneRequestContext): Promise<boolean> {
  const { ctx, route, req, res, url } = request
  const { sdk } = ctx
  const runWithRequestAuth = <T>(fn: () => Promise<T>): Promise<T> => sdk.runWithAuth(extractAuthContext(req), fn)
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
    jsonError(res, 400, String(err))
  }

  let params = route('GET', '/api/tasks')
  if (params) {
    try {
      const taskCards = await sdk.listCards(undefined, undefined, getListCardsOptions(url.searchParams))
      jsonOk(res, await buildCardReadModels(taskCards, url.searchParams, ctx))
    } catch (err) {
      handleKnownError(err)
    }
    return true
  }

  params = route('GET', '/api/tasks/active')
  if (params) {
    try {
      const card = await sdk.getActiveCard()
      jsonOk(res, card ? await buildCardReadModel(card, ctx) : null)
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

  params = route('GET', '/api/tasks/:id')
  if (params) {
    try {
      const taskParams = params
      const card = ctx.cards.find(item => item.id === taskParams.id)
      if (!card) {
        jsonError(res, 404, 'Task not found')
      } else {
        jsonOk(res, await buildCardReadModel(card, ctx))
      }
    } catch (err) {
      handleKnownError(err)
    }
    return true
  }

  params = route('POST', '/api/tasks/:id/open')
  if (params) {
    try {
      const card = await sdk.getCard(params.id, ctx.currentBoardId)
      if (!card) {
        jsonError(res, 404, 'Task not found')
        return true
      }
      const unread = await runWithRequestAuth(() => sdk.markCardOpened(card.id, card.boardId))
      jsonOk(res, await buildCardStateMutationModel(ctx, unread))
    } catch (err) {
      handleKnownError(err)
    }
    return true
  }

  params = route('POST', '/api/tasks/:id/read')
  if (params) {
    try {
      const card = await sdk.getCard(params.id, ctx.currentBoardId)
      if (!card) {
        jsonError(res, 404, 'Task not found')
        return true
      }
      const body = await readBody(req)
      const readThrough = body.readThrough as CardStateCursor | undefined
      const unread = await runWithRequestAuth(() => sdk.markCardRead(card.id, card.boardId, readThrough))
      jsonOk(res, await buildCardStateMutationModel(ctx, unread))
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
      await runWithRequestAuth(async () => {
        for (const file of files) {
          const buffer = Buffer.from(file.data, 'base64')
          await doAddAttachment(ctx, taskParams.id, file.name, buffer)
        }
      })
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
      const { id, filename } = params
      const card = await runWithRequestAuth(() => doRemoveAttachment(ctx, id, filename))
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
      const { id } = params
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
      const comment = await runWithRequestAuth(() => doAddComment(ctx, id, author, content))
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

  params = route('POST', '/api/tasks/:id/comments/stream')
  if (params) {
    const { id } = params
    const author = (url.searchParams.get('author') ?? (req.headers['x-comment-author'] as string | undefined) ?? '').trim()
    if (!author) {
      jsonError(res, 400, 'author query param is required')
      return true
    }
    let commentId: string | undefined
    try {
      // Convert the Node.js IncomingMessage readable into an AsyncIterable<string>
      async function* requestTextStream(): AsyncIterable<string> {
        const decoder = new TextDecoder('utf-8')
        for await (const chunk of req as unknown as AsyncIterable<Buffer>) {
          yield decoder.decode(chunk as Buffer, { stream: true })
        }
      }
      const card = await runWithRequestAuth(() =>
        ctx.sdk.streamComment(id, author, requestTextStream(), {
          boardId: url.searchParams.get('boardId') ?? undefined,
          onStart: (cid, commentAuthor, created) => {
            commentId = cid
            broadcastCommentStreamStart(ctx, id, cid, commentAuthor, created)
          },
          onChunk: (cid, chunk) => {
            broadcastCommentChunk(ctx, id, cid, chunk)
          },
        })
      )
      if (!card) {
        jsonError(res, 404, 'Task not found')
        return true
      }
      await loadCards(ctx)
      broadcast(ctx, buildInitMessage(ctx))
      if (commentId) broadcastCommentStreamDone(ctx, id, commentId)
      const comment = card.comments?.find(c => c.id === commentId)
      jsonOk(res, comment ?? null, 201)
    } catch (err) {
      handleKnownError(err)
    }
    return true
  }

  params = route('PUT', '/api/tasks/:id/comments/:commentId')
  if (params) {
    try {
      const { id, commentId } = params
      const body = await readBody(req)
      const content = body.content as string
      if (!content) {
        jsonError(res, 400, 'content is required')
        return true
      }
      const comment = await runWithRequestAuth(() => doUpdateComment(ctx, id, commentId, content))
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
      const { id, commentId } = params
      const deleted = await runWithRequestAuth(() => doDeleteComment(ctx, id, commentId))
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
      const { id } = params
      const body = await readBody(req)
      const text = body.text as string
      if (!text) {
        jsonError(res, 400, 'text is required')
        return true
      }
      const entry = await runWithRequestAuth(() => doAddLog(
        ctx,
        id,
        text,
        body.source as string | undefined,
        body.object as Record<string, unknown> | undefined,
        body.timestamp as string | undefined,
      ))
      if (!entry) {
        jsonError(res, 404, 'Task not found')
      } else {
        await broadcastLogsUpdatedToEditingClients(ctx, id)
        jsonOk(res, entry, 201)
      }
    } catch (err) {
      jsonError(res, 400, String(err))
    }
    return true
  }

  params = route('DELETE', '/api/tasks/:id/logs')
  if (params) {
    const cleared = await runWithRequestAuth(() => doClearLogs(ctx, params.id))
    if (!cleared) {
      jsonError(res, 404, 'Task not found')
    } else {
      await broadcastLogsUpdatedToEditingClients(ctx, params.id, [])
      jsonOk(res, { cleared: true })
    }
    return true
  }

  return false
}
