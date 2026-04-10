import { readConfig } from '../../../shared/config'
import type { CardDisplaySettings } from '../../../shared/types'
import { authErrorToHttpStatus, extractAuthContext, getAuthErrorLike } from '../../authUtils'
import { broadcast, buildInitMessage, loadCards } from '../../broadcastService'
import {
  doAddColumn,
  doEditColumn,
  doRemoveColumn,
  doSaveSettings,
} from '../../mutationService'
import { MIME_TYPES, jsonError, jsonOk, readBody } from '../../httpUtils'
import type { StandaloneRequestContext } from '../common'
import { getContentType, resolveStaticFilePath, resolveWorkspacePath } from '../common'
import { handlePluginSettingsRoutes } from './system-plugin-settings'
import { handleSystemStorageRoutes } from './system-storage'
import { syncWebviewMessages } from '../webview-sync'

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

  params = route('POST', '/api/webview-sync')
  if (params) {
    try {
      const body = await readBody(req)
      const rawMessages = Array.isArray(body.messages)
        ? body.messages
        : body.message !== undefined
          ? [body.message]
          : []

      if (rawMessages.length === 0) {
        jsonError(res, 400, 'messages must be a non-empty array')
        return true
      }

      const messages = await syncWebviewMessages(ctx, rawMessages, extractAuthContext(req))
      jsonOk(res, { messages })
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

  params = route('GET', '/api/events')
  if (params) {
    const type = url.searchParams.get('type') ?? undefined
    const mask = url.searchParams.get('mask') ?? undefined
    if (type !== undefined && type !== 'before' && type !== 'after' && type !== 'all') {
      jsonError(res, 400, 'type must be one of: before, after, all')
      return true
    }

    jsonOk(res, sdk.listAvailableEvents({
      type: type as 'before' | 'after' | 'all' | undefined,
      mask,
    }))
    return true
  }

  params = route('GET', '/api/card-state/status')
  if (params) {
    jsonOk(res, sdk.getCardStateStatus())
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

  if (await handlePluginSettingsRoutes(request)) {
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

  if (await handleSystemStorageRoutes(request)) {
    return true
  }

  if (pathname === '/api' || pathname.startsWith('/api/')) {
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
