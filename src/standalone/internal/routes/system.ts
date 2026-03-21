import { readConfig } from '../../../shared/config'
import type { CardDisplaySettings } from '../../../shared/types'
import { AuthError } from '../../../sdk/types'
import { authErrorToHttpStatus, extractAuthContext, getAuthStatus } from '../../authUtils'
import { broadcast, buildInitMessage, loadCards } from '../../broadcastService'
import { buildCardFrontmatter } from '../../cardHelpers'
import {
  doAddAttachment,
  doAddColumn,
  doEditColumn,
  doRemoveColumn,
  doSaveSettings,
} from '../../mutationService'
import { MIME_TYPES, jsonError, jsonOk, readBody } from '../../httpUtils'
import type { StandaloneRequestContext } from '../common'
import { buildProviderSummary, getContentType, resolveStaticFilePath, resolveWorkspacePath } from '../common'

export async function handleSystemRoutes(request: StandaloneRequestContext): Promise<boolean> {
  const { ctx, route, req, res, url, pathname, resolvedWebviewDir, indexHtml } = request
  const { sdk, workspaceRoot } = ctx

  let params = route('GET', '/api/resolve-path')
  if (params) {
    const rawPath = url.searchParams.get('path') ?? ''
    if (!rawPath) {
      jsonError(res, 400, 'path is required')
    } else {
      jsonOk(res, { path: resolveWorkspacePath(rawPath, workspaceRoot) })
    }
    return true
  }

  params = route('GET', '/api/columns')
  if (params) {
    jsonOk(res, sdk.listColumns(ctx.currentBoardId))
    return true
  }

  params = route('POST', '/api/columns')
  if (params) {
    try {
      const body = await readBody(req)
      const name = body.name as string
      const color = body.color as string
      if (!name) {
        jsonError(res, 400, 'name is required')
      } else {
        jsonOk(res, await doAddColumn(ctx, name, color || '#6b7280', extractAuthContext(req)), 201)
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

  params = route('PUT', '/api/columns/reorder')
  if (params) {
    try {
      const boardId = url.searchParams.get('boardId') ?? undefined
      const body = await readBody(req)
      const { columnIds } = body as { columnIds: string[] }
      if (!Array.isArray(columnIds)) {
        jsonError(res, 400, 'columnIds must be an array')
      } else {
        const columns = await sdk.reorderColumns(columnIds, boardId, extractAuthContext(req))
        broadcast(ctx, buildInitMessage(ctx))
        jsonOk(res, columns)
      }
    } catch (err) {
      if (err instanceof AuthError) {
        jsonError(res, authErrorToHttpStatus(err), err.message)
      } else {
        jsonError(res, 500, String(err))
      }
    }
    return true
  }

  params = route('PUT', '/api/columns/minimized')
  if (params) {
    try {
      const boardId = url.searchParams.get('boardId') ?? undefined
      const body = await readBody(req)
      const { columnIds } = body as { columnIds: string[] }
      if (!Array.isArray(columnIds)) {
        jsonError(res, 400, 'columnIds must be an array')
      } else {
        jsonOk(res, { minimizedColumnIds: await sdk.setMinimizedColumns(columnIds, boardId, extractAuthContext(req)) })
      }
    } catch (err) {
      if (err instanceof AuthError) {
        jsonError(res, authErrorToHttpStatus(err), err.message)
      } else {
        jsonError(res, 500, String(err))
      }
    }
    return true
  }

  params = route('PUT', '/api/columns/:id')
  if (params) {
    try {
      const body = await readBody(req)
      const column = await doEditColumn(ctx, params.id, { name: body.name as string, color: body.color as string }, extractAuthContext(req))
      if (!column) {
        jsonError(res, 404, 'Column not found')
      } else {
        jsonOk(res, column)
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

  params = route('DELETE', '/api/columns/:id')
  if (params) {
    try {
      const result = await doRemoveColumn(ctx, params.id, extractAuthContext(req))
      if (!result.removed) {
        jsonError(res, 400, result.error || 'Cannot remove column')
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

  params = route('GET', '/api/settings')
  if (params) {
    const settings = sdk.getSettings()
    settings.showBuildWithAI = false
    settings.markdownEditorMode = false
    jsonOk(res, settings)
    return true
  }

  params = route('PUT', '/api/settings')
  if (params) {
    try {
      const body = await readBody(req)
      await doSaveSettings(ctx, body as unknown as CardDisplaySettings, extractAuthContext(req))
      jsonOk(res, sdk.getSettings())
    } catch (err) {
      if (err instanceof AuthError) {
        jsonError(res, authErrorToHttpStatus(err), err.message)
      } else {
        jsonError(res, 400, String(err))
      }
    }
    return true
  }

  params = route('GET', '/api/webhooks')
  if (params) {
    jsonOk(res, sdk.listWebhooks())
    return true
  }

  params = route('POST', '/api/webhooks')
  if (params) {
    try {
      const body = await readBody(req)
      const webhookUrl = body.url as string
      const events = body.events as string[]
      if (!webhookUrl) {
        jsonError(res, 400, 'url is required')
        return true
      }
      if (!events || !Array.isArray(events) || events.length === 0) {
        jsonError(res, 400, 'events array is required')
        return true
      }
      jsonOk(res, await sdk.createWebhook({ url: webhookUrl, events, secret: body.secret as string | undefined }, extractAuthContext(req)), 201)
    } catch (err) {
      if (err instanceof AuthError) {
        jsonError(res, authErrorToHttpStatus(err), err.message)
      } else {
        jsonError(res, 400, String(err))
      }
    }
    return true
  }

  params = route('PUT', '/api/webhooks/:id')
  if (params) {
    try {
      const body = await readBody(req)
      const webhook = await sdk.updateWebhook(params.id, body as Partial<{ url: string; events: string[]; secret: string; active: boolean }>, extractAuthContext(req))
      if (!webhook) {
        jsonError(res, 404, 'Webhook not found')
      } else {
        jsonOk(res, webhook)
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

  params = route('DELETE', '/api/webhooks/:id')
  if (params) {
    try {
      const ok = await sdk.deleteWebhook(params.id, extractAuthContext(req))
      if (!ok) {
        jsonError(res, 404, 'Webhook not found')
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

  params = route('GET', '/api/labels')
  if (params) {
    jsonOk(res, sdk.getLabels())
    return true
  }

  params = route('PUT', '/api/labels/:name')
  if (params) {
    try {
      const body = await readBody(req)
      await sdk.setLabel(decodeURIComponent(params.name), { color: body.color as string, group: body.group as string | undefined }, extractAuthContext(req))
      jsonOk(res, sdk.getLabels())
    } catch (err) {
      if (err instanceof AuthError) {
        jsonError(res, authErrorToHttpStatus(err), err.message)
      } else {
        jsonError(res, 400, String(err))
      }
    }
    return true
  }

  params = route('PATCH', '/api/labels/:name')
  if (params) {
    try {
      const body = await readBody(req)
      const auth = extractAuthContext(req)
      const name = decodeURIComponent(params.name)
      const newName = body.newName as string
      if (!newName) {
        jsonError(res, 400, 'newName is required')
        return true
      }
      await sdk.renameLabel(name, newName, auth)
      await loadCards(ctx)
      broadcast(ctx, { type: 'labelsUpdated', labels: sdk.getLabels() })
      broadcast(ctx, buildInitMessage(ctx))
      jsonOk(res, sdk.getLabels())
    } catch (err) {
      jsonError(res, 400, String(err))
    }
    return true
  }

  params = route('DELETE', '/api/labels/:name')
  if (params) {
    try {
      await sdk.deleteLabel(decodeURIComponent(params.name), extractAuthContext(req))
      await loadCards(ctx)
      broadcast(ctx, { type: 'labelsUpdated', labels: sdk.getLabels() })
      broadcast(ctx, buildInitMessage(ctx))
      jsonOk(res, { success: true })
    } catch (err) {
      jsonError(res, 400, String(err))
    }
    return true
  }

  params = route('GET', '/api/workspace')
  if (params) {
    const wsConfig = readConfig(workspaceRoot)
    const storageStatus = sdk.getStorageStatus()
    jsonOk(res, {
      path: workspaceRoot,
      port: wsConfig.port,
      storageEngine: storageStatus.storageEngine,
      sqlitePath: wsConfig.sqlitePath,
      providers: buildProviderSummary(storageStatus),
      isFileBacked: storageStatus.isFileBacked,
      watchGlob: storageStatus.watchGlob,
      auth: getAuthStatus(sdk, req),
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
    jsonOk(res, {
      type: storageStatus.storageEngine,
      sqlitePath: wsConfig.sqlitePath,
      providers: buildProviderSummary(storageStatus),
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
      const count = await sdk.migrateToSqlite(dbPath, extractAuthContext(req))
      jsonOk(res, { ok: true, count, storageEngine: 'sqlite' })
    } catch (err) {
      if (err instanceof AuthError) {
        jsonError(res, authErrorToHttpStatus(err), err.message)
      } else {
        jsonError(res, 400, String(err))
      }
    }
    return true
  }

  params = route('POST', '/api/storage/migrate-to-markdown')
  if (params) {
    try {
      const count = await sdk.migrateToMarkdown(extractAuthContext(req))
      jsonOk(res, { ok: true, count, storageEngine: 'markdown' })
    } catch (err) {
      if (err instanceof AuthError) {
        jsonError(res, authErrorToHttpStatus(err), err.message)
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
      for (const file of files) {
        await doAddAttachment(ctx, cardId, file.name, Buffer.from(file.data, 'base64'))
      }
      broadcast(ctx, buildInitMessage(ctx))
      const card = ctx.cards.find(item => item.id === cardId)
      if (card && ctx.currentEditingCardId === cardId) {
        broadcast(ctx, { type: 'cardContent', cardId: card.id, content: card.content, frontmatter: buildCardFrontmatter(card), comments: card.comments || [] })
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: String(err) }))
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
    const card = ctx.cards.find(item => item.id === cardId)
    if (!card) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Card not found')
      return true
    }
    const attachmentPath = await sdk.materializeAttachment(card, filename)
    if (!attachmentPath) {
      res.writeHead(501, { 'Content-Type': 'text/plain' })
      res.end('Attachment provider does not expose a local file path')
      return true
    }
    const disposition = url.searchParams.get('download') === '1' ? 'attachment' : 'inline'
    const contentType = getContentType(filename, MIME_TYPES)
    const fs = await import('fs')
    fs.readFile(attachmentPath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('File not found')
        return
      }
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Disposition': `${disposition}; filename="${filename}"`,
      })
      res.end(data)
    })
    return true
  }

  if (pathname.startsWith('/api/')) {
    jsonError(res, 404, 'Not found')
    return true
  }

  const filePath = resolveStaticFilePath(resolvedWebviewDir, pathname)
  if (!pathHasExtension(filePath)) {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(indexHtml)
    return true
  }

  const fs = await import('fs')
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(indexHtml)
      return
    }
    res.writeHead(200, { 'Content-Type': getContentType(filePath, MIME_TYPES) })
    res.end(data)
  })
  return true
}

function pathHasExtension(filePath: string): boolean {
  return /\.[^./]+$/.test(filePath)
}
