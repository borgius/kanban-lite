import { readConfig } from '../../../shared/config'
import { authErrorToHttpStatus, extractAuthContext, getAuthErrorLike, getAuthStatus } from '../../authUtils'
import { broadcast, broadcastCardContentToEditingClients, buildInitMessage, getClientsEditingCard } from '../../broadcastService'
import { doAddAttachment } from '../../mutationService'
import { MIME_TYPES, jsonError, jsonOk, readBody } from '../../httpUtils'
import type { StandaloneRequestContext } from '../common'
import { buildProviderSummary, getContentType } from '../common'

export async function handleSystemStorageRoutes(request: StandaloneRequestContext): Promise<boolean> {
  const { ctx, route, req, res, url, pathname } = request
  const { sdk, workspaceRoot } = ctx
  const runWithRequestAuth = <T>(fn: () => Promise<T>): Promise<T> => sdk.runWithAuth(extractAuthContext(req), fn)
  const getRequestScopedCard = (cardId: string, boardId = ctx.currentBoardId) => runWithRequestAuth(() => sdk.getCard(cardId, boardId))

  let params = route('GET', '/api/workspace')
  if (params) {
    const wsConfig = readConfig(workspaceRoot)
    const storageStatus = sdk.getStorageStatus()
    const webhookStatus = sdk.getWebhookStatus()
    const cardStateStatus = sdk.getCardStateStatus()
    jsonOk(res, {
      path: workspaceRoot,
      port: wsConfig.port,
      storageEngine: storageStatus.storageEngine,
      sqlitePath: wsConfig.sqlitePath,
      providers: buildProviderSummary(storageStatus, webhookStatus),
      configStorage: storageStatus.configStorage,
      cardState: cardStateStatus,
      isFileBacked: storageStatus.isFileBacked,
      watchGlob: storageStatus.watchGlob,
      auth: getAuthStatus(sdk, req),
      webhook: webhookStatus,
    })
    return true
  }

  params = route('GET', '/api/auth')
  if (params) {
    jsonOk(res, getAuthStatus(sdk, req))
    return true
  }

  params = route('GET', '/api/storage')
  if (params) {
    const wsConfig = readConfig(workspaceRoot)
    const storageStatus = sdk.getStorageStatus()
    const webhookStatus = sdk.getWebhookStatus()
    const cardStateStatus = sdk.getCardStateStatus()
    jsonOk(res, {
      type: storageStatus.storageEngine,
      sqlitePath: wsConfig.sqlitePath,
      providers: buildProviderSummary(storageStatus, webhookStatus),
      configStorage: storageStatus.configStorage,
      cardState: cardStateStatus,
      isFileBacked: storageStatus.isFileBacked,
      watchGlob: storageStatus.watchGlob,
    })
    return true
  }

  params = route('POST', '/api/storage/migrate-to-sqlite')
  if (params) {
    try {
      const body = await readBody(req)
      const dbPath = typeof body.sqlitePath === 'string' ? body.sqlitePath : undefined
      const count = await runWithRequestAuth(() => sdk.migrateToSqlite(dbPath))
      jsonOk(res, { ok: true, count, storageEngine: 'sqlite' })
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

  params = route('POST', '/api/storage/migrate-to-markdown')
  if (params) {
    try {
      const count = await runWithRequestAuth(() => sdk.migrateToMarkdown())
      jsonOk(res, { ok: true, count, storageEngine: 'markdown' })
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

  if (request.method === 'POST' && pathname === '/api/upload-attachment') {
    try {
      const body = await readBody(req)
      const cardId = body.cardId as string
      const files = body.files as { name: string; data: string }[]
      if (!cardId || !Array.isArray(files)) {
        jsonError(res, 400, 'Missing cardId or files')
        return true
      }
      const card = await runWithRequestAuth(async () => {
        for (const file of files) {
          const added = await doAddAttachment(ctx, cardId, file.name, Buffer.from(file.data, 'base64'))
          if (!added) return null
        }
        return sdk.getCard(cardId, ctx.currentBoardId)
      })
      if (!card) {
        jsonError(res, 404, 'Card not found')
        return true
      }
      broadcast(ctx, buildInitMessage(ctx))
      if (getClientsEditingCard(ctx, cardId).length > 0) {
        await broadcastCardContentToEditingClients(ctx, card)
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    } catch (err) {
      const authErr = getAuthErrorLike(err)
      if (authErr) {
        jsonError(res, authErrorToHttpStatus(authErr), authErr.message)
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: String(err) }))
      }
    }
    return true
  }

  if (request.method === 'GET' && pathname === '/api/attachment') {
    const cardId = url.searchParams.get('cardId')
    const filename = url.searchParams.get('filename')
    if (!cardId || !filename) {
      res.writeHead(400, { 'Content-Type': 'text/plain' })
      res.end('Missing cardId or filename')
      return true
    }
    try {
      const card = await getRequestScopedCard(cardId)
      if (!card) {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('Card not found')
        return true
      }
      const attachment = await sdk.getAttachmentData(cardId, filename, ctx.currentBoardId)
      if (!attachment) {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('Attachment not found')
        return true
      }
      const disposition = url.searchParams.get('download') === '1' ? 'attachment' : 'inline'
      res.writeHead(200, {
        'Content-Type': attachment.contentType ?? getContentType(filename, MIME_TYPES),
        'Content-Disposition': `${disposition}; filename="${filename}"`,
      })
      res.end(Buffer.from(attachment.data))
    } catch (err) {
      const authErr = getAuthErrorLike(err)
      if (authErr) {
        jsonError(res, authErrorToHttpStatus(authErr), authErr.message)
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end(String(err))
      }
    }
    return true
  }

  return false
}
