import * as fs from 'fs'
import type { Card, CreateCardPayload, Priority } from '../../../shared/types'
import type { CardStateCursor } from '../../../sdk/plugins'
import { buildChecklistReadModel } from '../../../sdk/modules/checklist'
import { sanitizeCard, AuthError } from '../../../sdk/types'
import { authErrorToHttpStatus, extractAuthContext, getCardStateErrorLike } from '../../authUtils'
import { broadcast, broadcastCardContentToEditingClients, broadcastCommentStreamStart, broadcastCommentChunk, broadcastCommentStreamDone, broadcastLogsUpdatedToEditingClients, buildInitMessage, loadCards } from '../../broadcastService'
import { getListCardsOptions, getSubmitErrorStatus, parseSubmitData } from '../../cardHelpers'
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

const REST_CARD_READ_OPTIONS = { rethrowCardStateErrors: true } as const

export async function handleTaskRoutes(request: StandaloneRequestContext): Promise<boolean> {
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
      jsonOk(res, await buildCardReadModels(taskCards, url.searchParams, ctx, runWithRequestAuth, REST_CARD_READ_OPTIONS))
    } catch (err) {
      handleKnownError(err)
    }
    return true
  }

  params = route('GET', '/api/tasks/active')
  if (params) {
    try {
      const card = await runWithRequestAuth(() => sdk.getActiveCard())
      jsonOk(res, card ? await buildCardReadModel(card, ctx, runWithRequestAuth, REST_CARD_READ_OPTIONS) : null)
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
        tasks: body.tasks as string[] | undefined,
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
      if (typeof body.text !== 'string' || body.text.trim().length === 0) {
        jsonError(res, 400, 'text is required')
        return true
      }
      if (typeof body.expectedToken !== 'string' || body.expectedToken.trim().length === 0) {
        jsonError(res, 400, 'expectedToken is required')
        return true
      }
      const card = await runWithRequestAuth(() => doAddChecklistItem(ctx, id, body.text as string, body.expectedToken as string))
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
      if (typeof body.text !== 'string' || body.text.trim().length === 0) {
        jsonError(res, 400, 'text is required')
        return true
      }
      const card = await runWithRequestAuth(() => doEditChecklistItem(
        ctx,
        id,
        parseChecklistIndex(index),
        body.text as string,
        typeof body.expectedRaw === 'string' ? body.expectedRaw : undefined,
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
        typeof body.expectedRaw === 'string' ? body.expectedRaw : undefined,
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
        typeof body.expectedRaw === 'string' ? body.expectedRaw : undefined,
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
        typeof body.expectedRaw === 'string' ? body.expectedRaw : undefined,
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
        jsonOk(res, await buildCardReadModel(card, ctx, runWithRequestAuth, REST_CARD_READ_OPTIONS))
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
