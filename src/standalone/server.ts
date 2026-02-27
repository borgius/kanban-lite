import * as http from 'http'
import * as fs from 'fs'
import * as path from 'path'
import { WebSocketServer, WebSocket } from 'ws'
import chokidar from 'chokidar'
import { generateSlug, type Comment, type Feature, type Priority, type KanbanColumn, type FeatureFrontmatter, type CardDisplaySettings, type CardSortOption } from '../shared/types'
import { KanbanSDK } from '../sdk/KanbanSDK'
import { serializeFeature } from '../sdk/parser'
import { readConfig } from '../shared/config'
import { sanitizeFeature } from '../sdk/types'
import { fireWebhooks, loadWebhooks, createWebhook, deleteWebhook, updateWebhook } from './webhooks'
import { matchesMetaFilter } from '../sdk/metaUtils'

interface CreateFeatureData {
  status: string
  priority: Priority
  content: string
  assignee: string | null
  dueDate: string | null
  labels: string[]
  metadata?: Record<string, any>
  actions?: string[]
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json'
}


export function startServer(featuresDir: string, port: number, webviewDir?: string): http.Server {
  const absoluteFeaturesDir = path.resolve(featuresDir)
  let features: Feature[] = []
  let migrating = false
  let currentEditingFeatureId: string | null = null
  let lastWrittenContent = ''
  let currentBoardId: string | undefined

  // Resolve webview static files directory
  const resolvedWebviewDir = webviewDir || path.join(__dirname, 'standalone-webview')

  // Derive workspace root from features directory
  const workspaceRoot = path.dirname(absoluteFeaturesDir)
  const sdk = new KanbanSDK(absoluteFeaturesDir, {
    onEvent: (event, data) => fireWebhooks(workspaceRoot, event, data)
  })

  // --- Helpers ---

  const VALID_SORTS: CardSortOption[] = ['created:asc', 'created:desc', 'modified:asc', 'modified:desc']

  function applySortParam<T extends { created: string; modified: string }>(result: T[], sortParam: string | null): T[] {
    if (!sortParam || !VALID_SORTS.includes(sortParam as CardSortOption)) return result
    const [field, dir] = sortParam.split(':')
    return [...result].sort((a, b) => {
      const aVal = field === 'created' ? a.created : a.modified
      const bVal = field === 'created' ? b.created : b.modified
      return dir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
    })
  }

  function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf-8')
          resolve(text ? JSON.parse(text) : {})
        } catch (err) {
          reject(err)
        }
      })
      req.on('error', reject)
    })
  }

  function matchRoute(
    expectedMethod: string,
    actualMethod: string,
    pathname: string,
    pattern: string
  ): Record<string, string> | null {
    if (expectedMethod !== actualMethod) return null
    const patternParts = pattern.split('/')
    const pathParts = pathname.split('/')
    if (patternParts.length !== pathParts.length) return null
    const params: Record<string, string> = {}
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(':')) {
        params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i])
      } else if (patternParts[i] !== pathParts[i]) {
        return null
      }
    }
    return params
  }

  function jsonOk(res: http.ServerResponse, data: unknown, status = 200): void {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    })
    res.end(JSON.stringify({ ok: true, data }))
  }

  function jsonError(res: http.ServerResponse, status: number, error: string): void {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    })
    res.end(JSON.stringify({ ok: false, error }))
  }

  // --- HTML template ---
  const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="/style.css" rel="stylesheet">
  <title>Kanban Board</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/index.js"></script>
</body>
</html>`

  // --- Feature loading ---

  async function loadFeatures(): Promise<void> {
    features = await sdk.listCards(sdk.listColumns(currentBoardId).map(c => c.id), currentBoardId)
  }

  // --- Message building & broadcast ---

  function buildInitMessage(): unknown {
    const config = readConfig(workspaceRoot)
    const settings = sdk.getSettings()
    settings.showBuildWithAI = false
    settings.markdownEditorMode = false
    return {
      type: 'init',
      features,
      columns: sdk.listColumns(currentBoardId),
      settings,
      boards: sdk.listBoards(),
      currentBoard: currentBoardId || config.defaultBoard,
      workspace: {
        projectPath: workspaceRoot,
        featuresDirectory: config.featuresDirectory,
        port: config.port,
        configVersion: config.version
      },
      labels: sdk.getLabels()
    }
  }

  function broadcast(message: unknown): void {
    const json = JSON.stringify(message)
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(json)
      }
    }
  }

  // --- Mutation functions ---
  // Shared by both WebSocket handlers and REST API routes.

  async function doCreateFeature(data: CreateFeatureData): Promise<Feature> {
    migrating = true
    try {
      const feature = await sdk.createCard({
        content: data.content,
        status: data.status,
        priority: data.priority,
        assignee: data.assignee,
        dueDate: data.dueDate,
        labels: data.labels,
        metadata: data.metadata,
        actions: data.actions,
        boardId: currentBoardId,
      })
      await loadFeatures()
      broadcast(buildInitMessage())
      return feature
    } finally {
      migrating = false
    }
  }

  async function doMoveFeature(featureId: string, newStatus: string, newOrder: number): Promise<Feature | null> {
    const feature = features.find(f => f.id === featureId)
    if (!feature) return null

    migrating = true
    try {
      const updated = await sdk.moveCard(featureId, newStatus, newOrder, currentBoardId)
      await loadFeatures()
      broadcast(buildInitMessage())
      return updated
    } finally {
      migrating = false
    }
  }

  async function doUpdateFeature(featureId: string, updates: Partial<Feature>): Promise<Feature | null> {
    const feature = features.find(f => f.id === featureId)
    if (!feature) return null

    migrating = true
    try {
      const updated = await sdk.updateCard(featureId, updates, currentBoardId)
      lastWrittenContent = serializeFeature(updated)
      await loadFeatures()
      broadcast(buildInitMessage())
      return updated
    } finally {
      migrating = false
    }
  }

  async function doDeleteFeature(featureId: string): Promise<boolean> {
    const feature = features.find(f => f.id === featureId)
    if (!feature) return false

    try {
      await sdk.deleteCard(featureId, currentBoardId)
      await loadFeatures()
      broadcast(buildInitMessage())
      return true
    } catch (err) {
      console.error('Failed to delete feature:', err)
      return false
    }
  }

  async function doPermanentDeleteFeature(featureId: string): Promise<boolean> {
    const feature = features.find(f => f.id === featureId)
    if (!feature) return false

    try {
      await sdk.permanentlyDeleteCard(featureId, currentBoardId)
      await loadFeatures()
      broadcast(buildInitMessage())
      return true
    } catch (err) {
      console.error('Failed to permanently delete feature:', err)
      return false
    }
  }

  async function doPurgeDeletedCards(): Promise<boolean> {
    try {
      await sdk.purgeDeletedCards(currentBoardId)
      await loadFeatures()
      broadcast(buildInitMessage())
      return true
    } catch (err) {
      console.error('Failed to purge deleted cards:', err)
      return false
    }
  }

  function doAddColumn(name: string, color: string): KanbanColumn {
    const existingColumns = sdk.listColumns(currentBoardId)
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    let uniqueId = id
    let counter = 1
    while (existingColumns.some(c => c.id === uniqueId)) {
      uniqueId = `${id}-${counter++}`
    }
    const column: KanbanColumn = { id: uniqueId, name, color }
    sdk.addColumn(column, currentBoardId)
    broadcast(buildInitMessage())
    return column
  }

  function doEditColumn(columnId: string, updates: { name: string; color: string }): KanbanColumn | null {
    try {
      const columns = sdk.updateColumn(columnId, { name: updates.name, color: updates.color }, currentBoardId)
      const updated = columns.find(c => c.id === columnId) ?? null
      broadcast(buildInitMessage())
      return updated
    } catch {
      return null
    }
  }

  async function doRemoveColumn(columnId: string): Promise<{ removed: boolean; error?: string }> {
    try {
      const columns = sdk.listColumns(currentBoardId)
      if (columns.length <= 1) return { removed: false, error: 'Cannot remove last column' }
      const col = columns.find(c => c.id === columnId)
      if (!col) return { removed: false, error: 'Column not found' }
      await sdk.removeColumn(columnId, currentBoardId)
      broadcast(buildInitMessage())
      return { removed: true }
    } catch (err) {
      return { removed: false, error: String(err) }
    }
  }

  async function doCleanupColumn(columnId: string): Promise<boolean> {
    try {
      migrating = true
      await sdk.cleanupColumn(columnId, currentBoardId)
      await loadFeatures()
      broadcast(buildInitMessage())
      return true
    } catch (err) {
      console.error('Failed to cleanup column:', err)
      return false
    } finally {
      migrating = false
    }
  }

  function doSaveSettings(newSettings: CardDisplaySettings): void {
    sdk.updateSettings(newSettings)
    broadcast(buildInitMessage())
  }

  async function doAddAttachment(featureId: string, filename: string, fileData: Buffer): Promise<boolean> {
    const feature = features.find(f => f.id === featureId)
    if (!feature) return false

    // Write file data to the card's directory
    const featureDir = path.dirname(feature.filePath)
    fs.writeFileSync(path.join(featureDir, filename), fileData)

    // Register attachment via SDK (skips copy since file is already in place)
    migrating = true
    try {
      const updated = await sdk.addAttachment(featureId, path.join(featureDir, filename), currentBoardId)
      lastWrittenContent = serializeFeature(updated)
      await loadFeatures()
    } finally {
      migrating = false
    }
    return true
  }

  async function doRemoveAttachment(featureId: string, attachment: string): Promise<Feature | null> {
    const feature = features.find(f => f.id === featureId)
    if (!feature) return null

    migrating = true
    try {
      const updated = await sdk.removeAttachment(featureId, attachment, currentBoardId)
      lastWrittenContent = serializeFeature(updated)
      await loadFeatures()
      broadcast(buildInitMessage())
      return updated
    } finally {
      migrating = false
    }
  }

  // --- Comment mutation functions ---

  async function doAddComment(featureId: string, author: string, content: string): Promise<Comment | null> {
    migrating = true
    try {
      const updated = await sdk.addComment(featureId, author, content, currentBoardId)
      lastWrittenContent = serializeFeature(updated)
      const comment = updated.comments[updated.comments.length - 1]
      await loadFeatures()
      broadcast(buildInitMessage())
      return comment
    } catch {
      return null
    } finally {
      migrating = false
    }
  }

  async function doUpdateComment(featureId: string, commentId: string, content: string): Promise<Comment | null> {
    migrating = true
    try {
      const updated = await sdk.updateComment(featureId, commentId, content, currentBoardId)
      lastWrittenContent = serializeFeature(updated)
      const comment = (updated.comments || []).find(c => c.id === commentId)
      await loadFeatures()
      broadcast(buildInitMessage())
      return comment ?? null
    } catch {
      return null
    } finally {
      migrating = false
    }
  }

  async function doDeleteComment(featureId: string, commentId: string): Promise<boolean> {
    const feature = features.find(f => f.id === featureId)
    if (!feature) return false
    const comment = (feature.comments || []).find(c => c.id === commentId)
    if (!comment) return false

    migrating = true
    try {
      const updated = await sdk.deleteComment(featureId, commentId, currentBoardId)
      lastWrittenContent = serializeFeature(updated)
      await loadFeatures()
      broadcast(buildInitMessage())
      return true
    } catch {
      return false
    } finally {
      migrating = false
    }
  }

  // --- WebSocket message handling ---

  async function handleMessage(ws: WebSocket, message: unknown): Promise<void> {
    const msg = message as Record<string, unknown>
    switch (msg.type) {
      case 'ready':
        migrating = true
        try {
          await loadFeatures()
          ws.send(JSON.stringify(buildInitMessage()))
        } finally {
          migrating = false
        }
        break

      case 'createFeature':
        await doCreateFeature(msg.data as CreateFeatureData)
        break

      case 'moveFeature':
        await doMoveFeature(msg.featureId as string, msg.newStatus as string, msg.newOrder as number)
        break

      case 'deleteFeature':
        await doDeleteFeature(msg.featureId as string)
        break

      case 'permanentDeleteFeature':
        await doPermanentDeleteFeature(msg.featureId as string)
        break

      case 'restoreFeature': {
        const restoreId = msg.featureId as string
        const defaultStatus = sdk.getSettings().defaultStatus
        await doUpdateFeature(restoreId, { status: defaultStatus })
        break
      }

      case 'purgeDeletedCards':
        await doPurgeDeletedCards()
        break

      case 'updateFeature':
        await doUpdateFeature(msg.featureId as string, msg.updates as Partial<Feature>)
        break

      case 'openFeature': {
        const featureId = msg.featureId as string
        const feature = features.find(f => f.id === featureId)
        if (!feature) break

        currentEditingFeatureId = featureId
        const frontmatter: FeatureFrontmatter = {
          version: feature.version ?? 0,
          id: feature.id, status: feature.status, priority: feature.priority,
          assignee: feature.assignee, dueDate: feature.dueDate, created: feature.created,
          modified: feature.modified, completedAt: feature.completedAt,
          labels: feature.labels, attachments: feature.attachments, order: feature.order,
          metadata: feature.metadata, actions: feature.actions
        }
        ws.send(JSON.stringify({ type: 'featureContent', featureId: feature.id, content: feature.content, frontmatter, comments: feature.comments || [] }))
        break
      }

      case 'saveFeatureContent': {
        const featureId = msg.featureId as string
        const newContent = msg.content as string
        const fm = msg.frontmatter as FeatureFrontmatter
        await doUpdateFeature(featureId, {
          content: newContent,
          status: fm.status,
          priority: fm.priority,
          assignee: fm.assignee,
          dueDate: fm.dueDate,
          labels: fm.labels,
          attachments: fm.attachments,
          actions: fm.actions,
        })
        break
      }

      case 'closeFeature':
        currentEditingFeatureId = null
        break

      case 'openSettings': {
        const settings = sdk.getSettings()
        settings.showBuildWithAI = false
        settings.markdownEditorMode = false
        ws.send(JSON.stringify({ type: 'showSettings', settings }))
        break
      }

      case 'saveSettings':
        doSaveSettings(msg.settings as CardDisplaySettings)
        break

      case 'addColumn': {
        const col = msg.column as { name: string; color: string }
        doAddColumn(col.name, col.color)
        break
      }

      case 'editColumn':
        doEditColumn(msg.columnId as string, msg.updates as { name: string; color: string })
        break

      case 'removeColumn':
        await doRemoveColumn(msg.columnId as string)
        break

      case 'cleanupColumn':
        await doCleanupColumn(msg.columnId as string)
        break

      case 'removeAttachment': {
        const featureId = msg.featureId as string
        const feature = await doRemoveAttachment(featureId, msg.attachment as string)
        if (feature && currentEditingFeatureId === featureId) {
          const frontmatter: FeatureFrontmatter = {
            version: feature.version ?? 0,
            id: feature.id, status: feature.status, priority: feature.priority,
            assignee: feature.assignee, dueDate: feature.dueDate, created: feature.created,
            modified: feature.modified, completedAt: feature.completedAt,
            labels: feature.labels, attachments: feature.attachments, order: feature.order,
            actions: feature.actions
          }
          ws.send(JSON.stringify({ type: 'featureContent', featureId: feature.id, content: feature.content, frontmatter, comments: feature.comments || [] }))
        }
        break
      }

      case 'addComment': {
        const comment = await doAddComment(msg.featureId as string, msg.author as string, msg.content as string)
        if (!comment) break
        const feature = features.find(f => f.id === msg.featureId)
        if (feature && currentEditingFeatureId === msg.featureId) {
          const frontmatter: FeatureFrontmatter = {
            version: feature.version ?? 0,
            id: feature.id, status: feature.status, priority: feature.priority,
            assignee: feature.assignee, dueDate: feature.dueDate, created: feature.created,
            modified: feature.modified, completedAt: feature.completedAt,
            labels: feature.labels, attachments: feature.attachments, order: feature.order,
            actions: feature.actions
          }
          ws.send(JSON.stringify({ type: 'featureContent', featureId: feature.id, content: feature.content, frontmatter, comments: feature.comments || [] }))
        }
        break
      }

      case 'updateComment': {
        const comment = await doUpdateComment(msg.featureId as string, msg.commentId as string, msg.content as string)
        if (!comment) break
        const feature = features.find(f => f.id === msg.featureId)
        if (feature && currentEditingFeatureId === msg.featureId) {
          const frontmatter: FeatureFrontmatter = {
            version: feature.version ?? 0,
            id: feature.id, status: feature.status, priority: feature.priority,
            assignee: feature.assignee, dueDate: feature.dueDate, created: feature.created,
            modified: feature.modified, completedAt: feature.completedAt,
            labels: feature.labels, attachments: feature.attachments, order: feature.order,
            actions: feature.actions
          }
          ws.send(JSON.stringify({ type: 'featureContent', featureId: feature.id, content: feature.content, frontmatter, comments: feature.comments || [] }))
        }
        break
      }

      case 'deleteComment': {
        await doDeleteComment(msg.featureId as string, msg.commentId as string)
        const feature = features.find(f => f.id === msg.featureId)
        if (feature && currentEditingFeatureId === msg.featureId) {
          const frontmatter: FeatureFrontmatter = {
            version: feature.version ?? 0,
            id: feature.id, status: feature.status, priority: feature.priority,
            assignee: feature.assignee, dueDate: feature.dueDate, created: feature.created,
            modified: feature.modified, completedAt: feature.completedAt,
            labels: feature.labels, attachments: feature.attachments, order: feature.order,
            actions: feature.actions
          }
          ws.send(JSON.stringify({ type: 'featureContent', featureId: feature.id, content: feature.content, frontmatter, comments: feature.comments || [] }))
        }
        break
      }

      case 'transferCard': {
        const featureId = msg.featureId as string
        const toBoard = msg.toBoard as string
        const targetStatus = msg.targetStatus as string
        migrating = true
        try {
          await sdk.transferCard(featureId, currentBoardId || readConfig(workspaceRoot).defaultBoard, toBoard, targetStatus)
          await loadFeatures()
          broadcast(buildInitMessage())
        } catch (err) {
          console.error('Failed to transfer card:', err)
        } finally {
          migrating = false
        }
        break
      }
      case 'switchBoard':
        currentBoardId = msg.boardId as string
        migrating = true
        try {
          await loadFeatures()
          broadcast(buildInitMessage())
        } finally {
          migrating = false
        }
        break

      case 'createBoard': {
        const boardName = msg.name as string
        const boardId = generateSlug(boardName) || 'board'
        try {
          sdk.createBoard(boardId, boardName)
          currentBoardId = boardId
          migrating = true
          try {
            await loadFeatures()
            broadcast(buildInitMessage())
          } finally {
            migrating = false
          }
        } catch (err) {
          console.error('Failed to create board:', err)
        }
        break
      }

      case 'setLabel': {
        sdk.setLabel(msg.name as string, msg.definition as { color: string; group?: string })
        broadcast({ type: 'labelsUpdated', labels: sdk.getLabels() })
        broadcast(buildInitMessage())
        break
      }

      case 'renameLabel': {
        await sdk.renameLabel(msg.oldName as string, msg.newName as string)
        await loadFeatures()
        broadcast({ type: 'labelsUpdated', labels: sdk.getLabels() })
        broadcast(buildInitMessage())
        break
      }

      case 'deleteLabel': {
        await sdk.deleteLabel(msg.name as string)
        await loadFeatures()
        broadcast({ type: 'labelsUpdated', labels: sdk.getLabels() })
        broadcast(buildInitMessage())
        break
      }

      case 'triggerAction': {
        const { featureId, action, callbackKey } = msg as { featureId: string; action: string; callbackKey: string }
        try {
          await sdk.triggerAction(featureId, action)
          ws.send(JSON.stringify({ type: 'actionResult', callbackKey }))
        } catch (err) {
          ws.send(JSON.stringify({ type: 'actionResult', callbackKey, error: String(err) }))
        }
        break
      }

      // VSCode-specific actions — no-ops in standalone
      case 'openFile':
      case 'focusMenuBar':
      case 'startWithAI':
      case 'addAttachment':
      case 'openAttachment':
        break
    }
  }

  // --- HTTP server ---

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`)
    const { pathname } = url
    const method = req.method || 'GET'

    // CORS preflight
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400'
      })
      res.end()
      return
    }

    // Route helper: match and extract params, then handle
    const route = (expectedMethod: string, pattern: string): Record<string, string> | null =>
      matchRoute(expectedMethod, method, pathname, pattern)

    // ==================== BOARDS API ====================

    let params = route('GET', '/api/boards')
    if (params) {
      return jsonOk(res, sdk.listBoards())
    }

    params = route('POST', '/api/boards')
    if (params) {
      try {
        const body = await readBody(req)
        const id = body.id as string
        const name = body.name as string
        if (!id) return jsonError(res, 400, 'id is required')
        if (!name) return jsonError(res, 400, 'name is required')
        const board = sdk.createBoard(id, name, {
          description: body.description as string | undefined,
          columns: body.columns as KanbanColumn[] | undefined,
        })
        return jsonOk(res, board, 201)
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('GET', '/api/boards/:boardId')
    if (params) {
      try {
        const { boardId } = params
        const board = sdk.getBoard(boardId)
        return jsonOk(res, board)
      } catch (err) {
        return jsonError(res, 404, String(err))
      }
    }

    params = route('PUT', '/api/boards/:boardId')
    if (params) {
      try {
        const { boardId } = params
        const body = await readBody(req)
        const board = sdk.updateBoard(boardId, body as Record<string, unknown>)
        return jsonOk(res, board)
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('DELETE', '/api/boards/:boardId')
    if (params) {
      try {
        const { boardId } = params
        await sdk.deleteBoard(boardId)
        return jsonOk(res, { deleted: true })
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    // Transfer a task between boards
    params = route('POST', '/api/boards/:boardId/tasks/:id/transfer')
    if (params) {
      try {
        const { boardId, id } = params
        const body = await readBody(req)
        const config = readConfig(workspaceRoot)
        const fromBoard = currentBoardId || config.defaultBoard
        const targetStatus = body.targetStatus as string | undefined
        const card = await sdk.transferCard(id, fromBoard, boardId, targetStatus)
        return jsonOk(res, sanitizeFeature(card))
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    // ==================== BOARD-SCOPED TASKS API ====================

    params = route('GET', '/api/boards/:boardId/tasks')
    if (params) {
      try {
        const { boardId } = params
        const boardColumns = sdk.listColumns(boardId)
        const boardTasks = await sdk.listCards(boardColumns.map(c => c.id), boardId)
        let result = boardTasks.map(sanitizeFeature)
        if (url.searchParams.get('includeDeleted') !== 'true') {
          result = result.filter(f => f.status !== 'deleted')
        }
        const status = url.searchParams.get('status')
        if (status) result = result.filter(f => f.status === status)
        const priority = url.searchParams.get('priority')
        if (priority) result = result.filter(f => f.priority === priority)
        const assignee = url.searchParams.get('assignee')
        if (assignee) result = result.filter(f => f.assignee === assignee)
        const label = url.searchParams.get('label')
        if (label) result = result.filter(f => f.labels.includes(label))
        const labelGroup = url.searchParams.get('labelGroup')
        if (labelGroup) {
          const groupLabels = sdk.getLabelsInGroup(labelGroup)
          result = result.filter(f => f.labels.some(l => groupLabels.includes(l)))
        }
        const metaFilter: Record<string, string> = {}
        for (const [param, value] of url.searchParams.entries()) {
          if (param.startsWith('meta.')) metaFilter[param.slice(5)] = value
        }
        if (Object.keys(metaFilter).length > 0)
          result = result.filter(f => matchesMetaFilter(f.metadata, metaFilter))
        result = applySortParam(result, url.searchParams.get('sort'))
        return jsonOk(res, result)
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('POST', '/api/boards/:boardId/tasks')
    if (params) {
      try {
        const { boardId } = params
        const body = await readBody(req)
        const content = (body.content as string) || ''
        if (!content) return jsonError(res, 400, 'content is required')
        const feature = await sdk.createCard({
          content,
          status: (body.status as string) || 'backlog',
          priority: (body.priority as Priority) || 'medium',
          assignee: (body.assignee as string) || null,
          dueDate: (body.dueDate as string) || null,
          labels: (body.labels as string[]) || [],
          metadata: body.metadata as Record<string, any> | undefined,
          actions: body.actions as string[] | undefined,
          boardId,
        })
        return jsonOk(res, sanitizeFeature(feature), 201)
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('GET', '/api/boards/:boardId/tasks/:id')
    if (params) {
      try {
        const { boardId, id } = params
        const card = await sdk.getCard(id, boardId)
        if (!card) return jsonError(res, 404, 'Task not found')
        return jsonOk(res, sanitizeFeature(card))
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('PUT', '/api/boards/:boardId/tasks/:id')
    if (params) {
      try {
        const { boardId, id } = params
        const body = await readBody(req)
        const feature = await sdk.updateCard(id, body as Partial<Feature>, boardId)
        return jsonOk(res, sanitizeFeature(feature))
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('PATCH', '/api/boards/:boardId/tasks/:id/move')
    if (params) {
      try {
        const { boardId, id } = params
        const body = await readBody(req)
        const newStatus = body.status as string
        const position = body.position as number ?? 0
        if (!newStatus) return jsonError(res, 400, 'status is required')
        const feature = await sdk.moveCard(id, newStatus, position, boardId)
        return jsonOk(res, sanitizeFeature(feature))
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('POST', '/api/boards/:boardId/tasks/:id/actions/:action')
    if (params) {
      try {
        const { boardId, id, action } = params
        await sdk.triggerAction(id, action, boardId)
        res.writeHead(204)
        res.end()
        return
      } catch (err) {
        const msg = String(err)
        if (msg.includes('Card not found')) return jsonError(res, 404, msg)
        return jsonError(res, 400, msg)
      }
    }

    params = route('DELETE', '/api/boards/:boardId/tasks/:id/permanent')
    if (params) {
      try {
        const { boardId, id } = params
        await sdk.permanentlyDeleteCard(id, boardId)
        await loadFeatures()
        broadcast(buildInitMessage())
        return jsonOk(res, { deleted: true, permanent: true })
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('DELETE', '/api/boards/:boardId/tasks/:id')
    if (params) {
      try {
        const { boardId, id } = params
        await sdk.deleteCard(id, boardId)
        await loadFeatures()
        broadcast(buildInitMessage())
        return jsonOk(res, { deleted: true })
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    // ==================== BOARD-SCOPED COLUMNS API ====================

    params = route('GET', '/api/boards/:boardId/columns')
    if (params) {
      try {
        const { boardId } = params
        return jsonOk(res, sdk.listColumns(boardId))
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    // ==================== TASKS API ====================

    params = route('GET', '/api/tasks')
    if (params) {
      await loadFeatures()
      let result = features.map(sanitizeFeature)
      if (url.searchParams.get('includeDeleted') !== 'true') {
        result = result.filter(f => f.status !== 'deleted')
      }
      const status = url.searchParams.get('status')
      if (status) result = result.filter(f => f.status === status)
      const priority = url.searchParams.get('priority')
      if (priority) result = result.filter(f => f.priority === priority)
      const assignee = url.searchParams.get('assignee')
      if (assignee) result = result.filter(f => f.assignee === assignee)
      const label = url.searchParams.get('label')
      if (label) result = result.filter(f => f.labels.includes(label))
      const labelGroup = url.searchParams.get('labelGroup')
      if (labelGroup) {
        const groupLabels = sdk.getLabelsInGroup(labelGroup)
        result = result.filter(f => f.labels.some(l => groupLabels.includes(l)))
      }
      const metaFilter: Record<string, string> = {}
      for (const [param, value] of url.searchParams.entries()) {
        if (param.startsWith('meta.')) metaFilter[param.slice(5)] = value
      }
      if (Object.keys(metaFilter).length > 0)
        result = result.filter(f => matchesMetaFilter(f.metadata, metaFilter))
      result = applySortParam(result, url.searchParams.get('sort'))
      return jsonOk(res, result)
    }

    params = route('POST', '/api/tasks')
    if (params) {
      try {
        const body = await readBody(req)
        const data: CreateFeatureData = {
          content: (body.content as string) || '',
          status: (body.status as string) || 'backlog',
          priority: (body.priority as Priority) || 'medium',
          assignee: (body.assignee as string) || null,
          dueDate: (body.dueDate as string) || null,
          labels: (body.labels as string[]) || [],
          metadata: body.metadata as Record<string, any> | undefined,
          actions: body.actions as string[] | undefined,
        }
        if (!data.content) return jsonError(res, 400, 'content is required')
        const feature = await doCreateFeature(data)
        return jsonOk(res, sanitizeFeature(feature), 201)
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('GET', '/api/tasks/:id')
    if (params) {
      const { id } = params
      const feature = features.find(f => f.id === id)
      if (!feature) return jsonError(res, 404, 'Task not found')
      return jsonOk(res, sanitizeFeature(feature))
    }

    params = route('PUT', '/api/tasks/:id')
    if (params) {
      try {
        const { id } = params
        const body = await readBody(req)
        const feature = await doUpdateFeature(id, body as Partial<Feature>)
        if (!feature) return jsonError(res, 404, 'Task not found')
        return jsonOk(res, sanitizeFeature(feature))
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('PATCH', '/api/tasks/:id/move')
    if (params) {
      try {
        const { id } = params
        const body = await readBody(req)
        const newStatus = body.status as string
        const position = body.position as number ?? 0
        if (!newStatus) return jsonError(res, 400, 'status is required')
        const feature = await doMoveFeature(id, newStatus, position)
        if (!feature) return jsonError(res, 404, 'Task not found')
        return jsonOk(res, sanitizeFeature(feature))
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('POST', '/api/tasks/:id/actions/:action')
    if (params) {
      try {
        const { id, action } = params
        await sdk.triggerAction(id, action)
        res.writeHead(204)
        res.end()
        return
      } catch (err) {
        const msg = String(err)
        if (msg.includes('Card not found')) return jsonError(res, 404, msg)
        return jsonError(res, 400, msg)
      }
    }

    params = route('DELETE', '/api/tasks/:id/permanent')
    if (params) {
      const { id } = params
      const ok = await doPermanentDeleteFeature(id)
      if (!ok) return jsonError(res, 404, 'Task not found')
      return jsonOk(res, { deleted: true, permanent: true })
    }

    params = route('DELETE', '/api/tasks/:id')
    if (params) {
      const { id } = params
      const ok = await doDeleteFeature(id)
      if (!ok) return jsonError(res, 404, 'Task not found')
      return jsonOk(res, { deleted: true })
    }

    // ==================== ATTACHMENTS API ====================

    params = route('POST', '/api/tasks/:id/attachments')
    if (params) {
      try {
        const { id } = params
        const body = await readBody(req)
        const files = body.files as { name: string; data: string }[]
        if (!Array.isArray(files)) return jsonError(res, 400, 'files array is required')
        for (const file of files) {
          const buf = Buffer.from(file.data, 'base64')
          await doAddAttachment(id, file.name, buf)
        }
        broadcast(buildInitMessage())
        const feature = features.find(f => f.id === id)
        if (!feature) return jsonError(res, 404, 'Task not found')
        return jsonOk(res, sanitizeFeature(feature))
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('GET', '/api/tasks/:id/attachments/:filename')
    if (params) {
      const { id, filename: attachName } = params
      const feature = features.find(f => f.id === id)
      if (!feature) return jsonError(res, 404, 'Task not found')
      const featureDir = path.dirname(feature.filePath)
      const attachmentPath = path.resolve(featureDir, attachName)
      if (!attachmentPath.startsWith(absoluteFeaturesDir)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' })
        res.end('Forbidden')
        return
      }
      const ext = path.extname(attachName)
      const contentType = MIME_TYPES[ext] || 'application/octet-stream'
      fs.readFile(attachmentPath, (err, data) => {
        if (err) { res.writeHead(404); res.end('File not found'); return }
        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Disposition': `inline; filename="${attachName}"`,
          'Access-Control-Allow-Origin': '*'
        })
        res.end(data)
      })
      return
    }

    params = route('DELETE', '/api/tasks/:id/attachments/:filename')
    if (params) {
      const { id, filename: attachName } = params
      const feature = await doRemoveAttachment(id, attachName)
      if (!feature) return jsonError(res, 404, 'Task not found')
      return jsonOk(res, sanitizeFeature(feature))
    }

    // ==================== COMMENTS API ====================

    params = route('GET', '/api/tasks/:id/comments')
    if (params) {
      const { id } = params
      const feature = features.find(f => f.id === id)
      if (!feature) return jsonError(res, 404, 'Task not found')
      return jsonOk(res, feature.comments || [])
    }

    params = route('POST', '/api/tasks/:id/comments')
    if (params) {
      try {
        const { id } = params
        const body = await readBody(req)
        const author = body.author as string
        const content = body.content as string
        if (!author) return jsonError(res, 400, 'author is required')
        if (!content) return jsonError(res, 400, 'content is required')
        const comment = await doAddComment(id, author, content)
        if (!comment) return jsonError(res, 404, 'Task not found')
        return jsonOk(res, comment, 201)
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('PUT', '/api/tasks/:id/comments/:commentId')
    if (params) {
      try {
        const { id, commentId } = params
        const body = await readBody(req)
        const content = body.content as string
        if (!content) return jsonError(res, 400, 'content is required')
        const comment = await doUpdateComment(id, commentId, content)
        if (!comment) return jsonError(res, 404, 'Comment not found')
        return jsonOk(res, comment)
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('DELETE', '/api/tasks/:id/comments/:commentId')
    if (params) {
      const { id, commentId } = params
      const ok = await doDeleteComment(id, commentId)
      if (!ok) return jsonError(res, 404, 'Comment not found')
      return jsonOk(res, { deleted: true })
    }

    // ==================== COLUMNS API ====================

    params = route('GET', '/api/columns')
    if (params) {
      return jsonOk(res, sdk.listColumns(currentBoardId))
    }

    params = route('POST', '/api/columns')
    if (params) {
      try {
        const body = await readBody(req)
        const name = body.name as string
        const color = body.color as string
        if (!name) return jsonError(res, 400, 'name is required')
        const column = doAddColumn(name, color || '#6b7280')
        return jsonOk(res, column, 201)
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('PUT', '/api/columns/:id')
    if (params) {
      try {
        const { id } = params
        const body = await readBody(req)
        const column = doEditColumn(id, { name: body.name as string, color: body.color as string })
        if (!column) return jsonError(res, 404, 'Column not found')
        return jsonOk(res, column)
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('DELETE', '/api/columns/:id')
    if (params) {
      const { id } = params
      const result = await doRemoveColumn(id)
      if (!result.removed) return jsonError(res, 400, result.error || 'Cannot remove column')
      return jsonOk(res, { deleted: true })
    }

    // ==================== SETTINGS API ====================

    params = route('GET', '/api/settings')
    if (params) {
      const settings = sdk.getSettings()
      settings.showBuildWithAI = false
      settings.markdownEditorMode = false
      return jsonOk(res, settings)
    }

    params = route('PUT', '/api/settings')
    if (params) {
      try {
        const body = await readBody(req)
        doSaveSettings(body as unknown as CardDisplaySettings)
        return jsonOk(res, sdk.getSettings())
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    // ==================== WEBHOOKS API ====================

    params = route('GET', '/api/webhooks')
    if (params) {
      return jsonOk(res, loadWebhooks(workspaceRoot))
    }

    params = route('POST', '/api/webhooks')
    if (params) {
      try {
        const body = await readBody(req)
        const webhookUrl = body.url as string
        const events = body.events as string[]
        const secret = body.secret as string | undefined
        if (!webhookUrl) return jsonError(res, 400, 'url is required')
        if (!events || !Array.isArray(events) || events.length === 0) {
          return jsonError(res, 400, 'events array is required')
        }
        const webhook = createWebhook(workspaceRoot, { url: webhookUrl, events, secret })
        return jsonOk(res, webhook, 201)
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('PUT', '/api/webhooks/:id')
    if (params) {
      try {
        const { id } = params
        const body = await readBody(req)
        const webhook = updateWebhook(workspaceRoot, id, body as Partial<{ url: string; events: string[]; secret: string; active: boolean }>)
        if (!webhook) return jsonError(res, 404, 'Webhook not found')
        return jsonOk(res, webhook)
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('DELETE', '/api/webhooks/:id')
    if (params) {
      const { id } = params
      const ok = deleteWebhook(workspaceRoot, id)
      if (!ok) return jsonError(res, 404, 'Webhook not found')
      return jsonOk(res, { deleted: true })
    }

    // ==================== LABELS API ====================

    params = route('GET', '/api/labels')
    if (params) {
      return jsonOk(res, sdk.getLabels())
    }

    params = route('PUT', '/api/labels/:name')
    if (params) {
      try {
        const name = decodeURIComponent(params.name)
        const body = await readBody(req)
        sdk.setLabel(name, { color: body.color as string, group: body.group as string | undefined })
        return jsonOk(res, sdk.getLabels())
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('PATCH', '/api/labels/:name')
    if (params) {
      try {
        const name = decodeURIComponent(params.name)
        const body = await readBody(req)
        const newName = body.newName as string
        if (!newName) return jsonError(res, 400, 'newName is required')
        await sdk.renameLabel(name, newName)
        await loadFeatures()
        broadcast({ type: 'labelsUpdated', labels: sdk.getLabels() })
        broadcast(buildInitMessage())
        return jsonOk(res, sdk.getLabels())
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('DELETE', '/api/labels/:name')
    if (params) {
      try {
        const name = decodeURIComponent(params.name)
        await sdk.deleteLabel(name)
        await loadFeatures()
        broadcast({ type: 'labelsUpdated', labels: sdk.getLabels() })
        broadcast(buildInitMessage())
        return jsonOk(res, { success: true })
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    // ==================== WORKSPACE API ====================

    params = route('GET', '/api/workspace')
    if (params) {
      const wsConfig = readConfig(workspaceRoot)
      return jsonOk(res, { path: workspaceRoot, port: wsConfig.port })
    }

    // ==================== LEGACY API (backwards compat) ====================

    if (method === 'POST' && pathname === '/api/upload-attachment') {
      try {
        const body = await readBody(req)
        const featureId = body.featureId as string
        const files = body.files as { name: string; data: string }[]
        if (!featureId || !Array.isArray(files)) return jsonError(res, 400, 'Missing featureId or files')

        for (const file of files) {
          const buf = Buffer.from(file.data, 'base64')
          await doAddAttachment(featureId, file.name, buf)
        }

        broadcast(buildInitMessage())
        const feature = features.find(f => f.id === featureId)
        if (feature && currentEditingFeatureId === featureId) {
          const frontmatter: FeatureFrontmatter = {
            version: feature.version ?? 0,
            id: feature.id, status: feature.status, priority: feature.priority,
            assignee: feature.assignee, dueDate: feature.dueDate, created: feature.created,
            modified: feature.modified, completedAt: feature.completedAt,
            labels: feature.labels, attachments: feature.attachments, order: feature.order,
            metadata: feature.metadata, actions: feature.actions,
          }
          broadcast({ type: 'featureContent', featureId: feature.id, content: feature.content, frontmatter, comments: feature.comments || [] })
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: String(err) }))
      }
      return
    }

    if (method === 'GET' && pathname === '/api/attachment') {
      const featureId = url.searchParams.get('featureId')
      const filename = url.searchParams.get('filename')
      if (!featureId || !filename) {
        res.writeHead(400, { 'Content-Type': 'text/plain' }); res.end('Missing featureId or filename'); return
      }
      const feature = features.find(f => f.id === featureId)
      if (!feature) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Feature not found'); return }
      const featureDir = path.dirname(feature.filePath)
      const attachmentPath = path.resolve(featureDir, filename)
      if (!attachmentPath.startsWith(absoluteFeaturesDir)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' }); res.end('Forbidden'); return
      }
      const ext = path.extname(filename)
      const contentType = MIME_TYPES[ext] || 'application/octet-stream'
      fs.readFile(attachmentPath, (err, data) => {
        if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('File not found'); return }
        res.writeHead(200, { 'Content-Type': contentType, 'Content-Disposition': `inline; filename="${filename}"` })
        res.end(data)
      })
      return
    }

    // Catch-all for unmatched /api/* routes
    if (pathname.startsWith('/api/')) {
      return jsonError(res, 404, 'Not found')
    }

    // ==================== STATIC FILES ====================

    const filePath = path.join(resolvedWebviewDir, pathname === '/' ? 'index.html' : pathname)

    if (!path.extname(filePath)) {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(indexHtml)
      return
    }

    const ext = path.extname(filePath)
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(indexHtml)
        return
      }
      res.writeHead(200, { 'Content-Type': contentType })
      res.end(data)
    })
  })

  // --- WebSocket server ---

  const wss = new WebSocketServer({ server, path: '/ws' })

  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString())
        handleMessage(ws, message)
      } catch (err) {
        console.error('Failed to handle message:', err)
      }
    })
  })

  // --- File watcher ---

  let debounceTimer: ReturnType<typeof setTimeout> | undefined

  fs.mkdirSync(absoluteFeaturesDir, { recursive: true })

  const watcher = chokidar.watch(absoluteFeaturesDir, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 100 }
  })

  const handleFileChange = (changedPath?: string) => {
    if (changedPath && !changedPath.endsWith('.md')) return
    if (migrating) return
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(async () => {
      if (migrating) return
      migrating = true
      try {
        await loadFeatures()
        broadcast(buildInitMessage())
      } finally {
        migrating = false
      }

      if (currentEditingFeatureId && changedPath) {
        const editingFeature = features.find(f => f.id === currentEditingFeatureId)
        if (editingFeature && editingFeature.filePath === changedPath) {
          const currentContent = serializeFeature(editingFeature)
          if (currentContent !== lastWrittenContent) {
            const frontmatter: FeatureFrontmatter = {
              version: editingFeature.version ?? 0,
              id: editingFeature.id, status: editingFeature.status, priority: editingFeature.priority,
              assignee: editingFeature.assignee, dueDate: editingFeature.dueDate, created: editingFeature.created,
              modified: editingFeature.modified, completedAt: editingFeature.completedAt,
              labels: editingFeature.labels, attachments: editingFeature.attachments, order: editingFeature.order,
              metadata: editingFeature.metadata, actions: editingFeature.actions,
            }
            broadcast({ type: 'featureContent', featureId: editingFeature.id, content: editingFeature.content, frontmatter, comments: editingFeature.comments || [] })
          }
        }
      }
    }, 100)
  }

  watcher.on('change', handleFileChange)
  watcher.on('add', handleFileChange)
  watcher.on('unlink', handleFileChange)

  server.on('close', () => {
    watcher.close()
    wss.close()
  })

  server.listen(port, () => {
    console.log(`Kanban board running at http://localhost:${port}`)
    console.log(`API available at http://localhost:${port}/api`)
    console.log(`Features directory: ${absoluteFeaturesDir}`)
  })

  return server
}
