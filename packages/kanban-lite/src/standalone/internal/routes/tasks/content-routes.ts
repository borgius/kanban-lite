import * as fs from 'fs'
import type { Card } from '../../../../shared/types'
import { sanitizeCard, AuthError } from '../../../../sdk/types'
import { authErrorToHttpStatus, extractAuthContext, getCardStateErrorLike } from '../../../authUtils'
import { broadcast, broadcastCardContentToEditingClients, broadcastCommentStreamStart, broadcastCommentChunk, broadcastCommentStreamDone, broadcastLogsUpdatedToEditingClients, buildInitMessage, loadCards } from '../../../broadcastService'
import {
  doAddAttachment,
  doAddComment,
  doAddLog,
  doClearLogs,
  doDeleteComment,
  doRemoveAttachment,
  doUpdateComment,
} from '../../../mutationService'
import { MIME_TYPES, jsonError, jsonOk, readBody } from '../../../httpUtils'
import {
  buildCardReadModel,
  getContentType,
  sendNoContent,
  type StandaloneRequestContext,
} from '../../common'

export async function handleTaskContentRoutes(request: StandaloneRequestContext): Promise<boolean> {
  const { ctx, route, req, res, url } = request
  const { sdk } = ctx
  let params
  const runWithRequestAuth = <T>(fn: () => Promise<T>): Promise<T> => sdk.runWithAuth(extractAuthContext(req), fn)
  const getRequestScopedCard = (cardId: string, boardId = ctx.currentBoardId) => runWithRequestAuth(() => sdk.getCard(cardId, boardId))
  const getErrorMessage = (err: unknown): string => err instanceof Error ? err.message : String(err)
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
      const card = await runWithRequestAuth(async () => {
        for (const file of files) {
          const buffer = Buffer.from(file.data, 'base64')
          const added = await doAddAttachment(ctx, taskParams.id, file.name, buffer)
          if (!added) return null
        }
        return sdk.getCard(taskParams.id, ctx.currentBoardId)
      })
      if (!card) {
        jsonError(res, 404, 'Task not found')
      } else {
        broadcast(ctx, buildInitMessage(ctx))
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
    try {
      const card = await getRequestScopedCard(taskParams.id)
      if (!card) {
        jsonError(res, 404, 'Task not found')
        return true
      }
      const attachment = await sdk.getAttachmentData(taskParams.id, taskParams.filename, ctx.currentBoardId)
      if (!attachment) {
        jsonError(res, 404, 'Attachment not found')
        return true
      }
      const disposition = url.searchParams.get('download') === '1' ? 'attachment' : 'inline'
      res.writeHead(200, {
        'Content-Type': attachment.contentType ?? getContentType(taskParams.filename, MIME_TYPES),
        'Content-Disposition': `${disposition}; filename="${taskParams.filename}"`,
        'Access-Control-Allow-Origin': '*',
      })
      res.end(Buffer.from(attachment.data))
    } catch (err) {
      handleKnownError(err)
    }
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
    try {
      jsonOk(res, await runWithRequestAuth(() => sdk.listComments(taskParams.id, ctx.currentBoardId)))
    } catch (err) {
      handleKnownError(err)
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
      const { id } = params
      jsonOk(res, await runWithRequestAuth(() => sdk.listLogs(id, ctx.currentBoardId)))
    } catch (err) {
      handleKnownError(err)
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
    const { id } = params
    const cleared = await runWithRequestAuth(() => doClearLogs(ctx, id))
    if (!cleared) {
      jsonError(res, 404, 'Task not found')
    } else {
      await broadcastLogsUpdatedToEditingClients(ctx, id, [])
      jsonOk(res, { cleared: true })
    }
    return true
  }

  return false
}
