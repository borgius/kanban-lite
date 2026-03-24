import { readConfig } from '../../../shared/config'
import type { CardDisplaySettings } from '../../../shared/types'
import { authErrorToHttpStatus, extractAuthContext, getAuthErrorLike, getAuthStatus } from '../../authUtils'
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
  const runWithRequestAuth = <T>(fn: () => Promise<T>): Promise<T> => sdk.runWithAuth(extractAuthContext(req), fn)

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

  params = route('GET', '/api/health')
  if (params) {
    const config = readConfig(workspaceRoot)
    jsonOk(res, {
      ok: true,
      boardCount: sdk.listBoards().length,
      defaultBoard: config.defaultBoard,
      currentBoard: ctx.currentBoardId ?? config.defaultBoard,
      workspaceRoot,
    })
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
        jsonOk(res, await runWithRequestAuth(() => doAddColumn(ctx, name, color || '#6b7280')), 201)
      }
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

  params = route('PUT', '/api/columns/reorder')
  if (params) {
    try {
      const boardId = url.searchParams.get('boardId') ?? undefined
      const body = await readBody(req)
      const { columnIds } = body as { columnIds: string[] }
      if (!Array.isArray(columnIds)) {
        jsonError(res, 400, 'columnIds must be an array')
      } else {
        const columns = await runWithRequestAuth(() => sdk.reorderColumns(columnIds, boardId))
        broadcast(ctx, buildInitMessage(ctx))
        jsonOk(res, columns)
      }
    } catch (err) {
      const authErr = getAuthErrorLike(err)
      if (authErr) {
        jsonError(res, authErrorToHttpStatus(authErr), authErr.message)
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
        jsonOk(res, { minimizedColumnIds: await runWithRequestAuth(() => sdk.setMinimizedColumns(columnIds, boardId)) })
      }
    } catch (err) {
      const authErr = getAuthErrorLike(err)
      if (authErr) {
        jsonError(res, authErrorToHttpStatus(authErr), authErr.message)
      } else {
        jsonError(res, 500, String(err))
      }
    }
    return true
  }

  params = route('PUT', '/api/columns/:id')
  if (params) {
    try {
      const { id } = params
      const body = await readBody(req)
      const column = await runWithRequestAuth(() => doEditColumn(ctx, id, { name: body.name as string, color: body.color as string }))
      if (!column) {
        jsonError(res, 404, 'Column not found')
      } else {
        jsonOk(res, column)
      }
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

  params = route('DELETE', '/api/columns/:id')
  if (params) {
    try {
      const { id } = params
      const result = await runWithRequestAuth(() => doRemoveColumn(ctx, id))
      if (!result.removed) {
        jsonError(res, 400, result.error || 'Cannot remove column')
      } else {
        jsonOk(res, { deleted: true })
      }
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
      await runWithRequestAuth(() => doSaveSettings(ctx, body as unknown as CardDisplaySettings))
      jsonOk(res, sdk.getSettings())
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

  params = route('GET', '/api/labels')
  if (params) {
    jsonOk(res, sdk.getLabels())
    return true
  }

  params = route('PUT', '/api/labels/:name')
  if (params) {
    try {
      const body = await readBody(req)
      const name = decodeURIComponent(params.name)
      await runWithRequestAuth(() => sdk.setLabel(name, { color: body.color as string, group: body.group as string | undefined }))
      jsonOk(res, sdk.getLabels())
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

  params = route('PATCH', '/api/labels/:name')
  if (params) {
    try {
      const body = await readBody(req)
      const name = decodeURIComponent(params.name)
      const newName = body.newName as string
      if (!newName) {
        jsonError(res, 400, 'newName is required')
        return true
      }
      await runWithRequestAuth(() => sdk.renameLabel(name, newName))
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
      const name = decodeURIComponent(params.name)
      await runWithRequestAuth(() => sdk.deleteLabel(name))
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
    const webhookStatus = sdk.getWebhookStatus()
    jsonOk(res, {
      path: workspaceRoot,
      port: wsConfig.port,
      storageEngine: storageStatus.storageEngine,
      sqlitePath: wsConfig.sqlitePath,
      providers: buildProviderSummary(storageStatus, webhookStatus),
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
    jsonOk(res, {
      type: storageStatus.storageEngine,
      sqlitePath: wsConfig.sqlitePath,
      providers: buildProviderSummary(storageStatus, webhookStatus),
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
