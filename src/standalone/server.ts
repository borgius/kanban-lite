import * as http from 'http'
import * as fs from 'fs'
import * as path from 'path'
import { WebSocketServer, WebSocket } from 'ws'
import chokidar from 'chokidar'
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'
import { getTitleFromContent, generateFeatureFilename, extractNumericId } from '../shared/types'
import type { Comment, Feature, FeatureStatus, Priority, KanbanColumn, FeatureFrontmatter, CardDisplaySettings } from '../shared/types'
import { readConfig, writeConfig, configToSettings, settingsToConfig, allocateCardId, syncCardIdCounter } from '../shared/config'
import type { KanbanConfig } from '../shared/config'
import { parseFeatureFile, serializeFeature } from '../sdk/parser'
import { ensureStatusSubfolders, moveFeatureFile, renameFeatureFile, getFeatureFilePath, getStatusFromPath } from './fileUtils'
import { fireWebhooks, loadWebhooks, createWebhook, deleteWebhook } from './webhooks'

interface CreateFeatureData {
  status: FeatureStatus
  priority: Priority
  content: string
  assignee: string | null
  dueDate: string | null
  labels: string[]
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

  // Resolve webview static files directory
  const resolvedWebviewDir = webviewDir || path.join(__dirname, 'standalone-webview')

  // Derive workspace root from features directory
  const workspaceRoot = path.dirname(absoluteFeaturesDir)

  function getConfig(): KanbanConfig {
    return readConfig(workspaceRoot)
  }

  function saveConfigFile(config: KanbanConfig): void {
    writeConfig(workspaceRoot, config)
  }

  // --- Helpers ---

  function sanitizeFeature(feature: Feature): Omit<Feature, 'filePath'> {
    const { filePath: _, ...rest } = feature
    return rest
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

  function loadFeatures(): void {
    fs.mkdirSync(absoluteFeaturesDir, { recursive: true })
    ensureStatusSubfolders(absoluteFeaturesDir, getConfig().columns.map(c => c.id))

    // Phase 1: Migrate flat root .md files into their status subfolder
    migrating = true
    try {
      const rootEntries = fs.readdirSync(absoluteFeaturesDir, { withFileTypes: true })
      for (const entry of rootEntries) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue
        const filePath = path.join(absoluteFeaturesDir, entry.name)
        try {
          const content = fs.readFileSync(filePath, 'utf-8')
          const feature = parseFeatureFile(content, filePath)
          if (feature) {
            moveFeatureFile(filePath, absoluteFeaturesDir, feature.status, feature.attachments)
          }
        } catch {
          // skip
        }
      }
    } finally {
      migrating = false
    }

    // Phase 2: Load .md files from ALL subdirectories
    const loaded: Feature[] = []
    const topEntries = fs.readdirSync(absoluteFeaturesDir, { withFileTypes: true })
    for (const entry of topEntries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const subdir = path.join(absoluteFeaturesDir, entry.name)
      try {
        const subEntries = fs.readdirSync(subdir, { withFileTypes: true })
        for (const sub of subEntries) {
          if (!sub.isFile() || !sub.name.endsWith('.md')) continue
          const filePath = path.join(subdir, sub.name)
          const content = fs.readFileSync(filePath, 'utf-8')
          const feature = parseFeatureFile(content, filePath)
          if (feature) loaded.push(feature)
        }
      } catch {
        // skip unreadable directories
      }
    }

    // Phase 3: Reconcile status ↔ folder mismatches
    migrating = true
    try {
      for (const feature of loaded) {
        const pathStatus = getStatusFromPath(feature.filePath, absoluteFeaturesDir)
        if (pathStatus !== null && pathStatus !== feature.status) {
          try {
            feature.filePath = moveFeatureFile(feature.filePath, absoluteFeaturesDir, feature.status, feature.attachments)
          } catch { /* retry next load */ }
        }
      }
    } finally {
      migrating = false
    }

    // Migrate legacy integer order → fractional indices
    const hasLegacyOrder = loaded.some(f => /^\d+$/.test(f.order))
    if (hasLegacyOrder) {
      const byStatus = new Map<string, Feature[]>()
      for (const f of loaded) {
        const list = byStatus.get(f.status) || []
        list.push(f)
        byStatus.set(f.status, list)
      }

      for (const columnFeatures of byStatus.values()) {
        columnFeatures.sort((a, b) => parseInt(a.order) - parseInt(b.order))
        const keys = generateNKeysBetween(null, null, columnFeatures.length)
        for (let i = 0; i < columnFeatures.length; i++) {
          columnFeatures[i].order = keys[i]
          const content = serializeFeature(columnFeatures[i])
          fs.writeFileSync(columnFeatures[i].filePath, content, 'utf-8')
        }
      }
    }

    // Sync ID counter with existing cards
    const numericIds = loaded
      .map(f => parseInt(f.id, 10))
      .filter(n => !Number.isNaN(n))
    if (numericIds.length > 0) {
      syncCardIdCounter(workspaceRoot, numericIds)
    }

    features = loaded.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
  }

  // --- Message building & broadcast ---

  function buildInitMessage(): unknown {
    const config = getConfig()
    const settings = configToSettings(config)
    settings.showBuildWithAI = false
    settings.markdownEditorMode = false
    return {
      type: 'init',
      features,
      columns: config.columns,
      settings
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

  function doCreateFeature(data: CreateFeatureData): Feature {
    fs.mkdirSync(absoluteFeaturesDir, { recursive: true })
    ensureStatusSubfolders(absoluteFeaturesDir, getConfig().columns.map(c => c.id))

    const title = getTitleFromContent(data.content)
    const numericId = allocateCardId(workspaceRoot)
    const filename = generateFeatureFilename(numericId, title)
    const now = new Date().toISOString()
    const featuresInStatus = features
      .filter(f => f.status === data.status)
      .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
    const lastOrder = featuresInStatus.length > 0 ? featuresInStatus[featuresInStatus.length - 1].order : null

    const feature: Feature = {
      id: String(numericId),
      status: data.status,
      priority: data.priority,
      assignee: data.assignee,
      dueDate: data.dueDate,
      created: now,
      modified: now,
      completedAt: data.status === 'done' ? now : null,
      labels: data.labels,
      attachments: [],
      comments: [],
      order: generateKeyBetween(lastOrder, null),
      content: data.content,
      filePath: getFeatureFilePath(absoluteFeaturesDir, data.status, filename)
    }

    fs.mkdirSync(path.dirname(feature.filePath), { recursive: true })
    const content = serializeFeature(feature)
    fs.writeFileSync(feature.filePath, content, 'utf-8')

    features.push(feature)
    broadcast(buildInitMessage())
    fireWebhooks(workspaceRoot, 'task.created', sanitizeFeature(feature))
    return feature
  }

  function doMoveFeature(featureId: string, newStatus: string, newOrder: number): Feature | null {
    const feature = features.find(f => f.id === featureId)
    if (!feature) return null

    const oldStatus = feature.status
    const statusChanged = oldStatus !== newStatus

    feature.status = newStatus as FeatureStatus
    feature.modified = new Date().toISOString()
    if (statusChanged) {
      feature.completedAt = newStatus === 'done' ? new Date().toISOString() : null
    }

    const targetColumnFeatures = features
      .filter(f => f.status === newStatus && f.id !== featureId)
      .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))

    const clampedOrder = Math.max(0, Math.min(newOrder, targetColumnFeatures.length))
    const before = clampedOrder > 0 ? targetColumnFeatures[clampedOrder - 1].order : null
    const after = clampedOrder < targetColumnFeatures.length ? targetColumnFeatures[clampedOrder].order : null
    feature.order = generateKeyBetween(before, after)

    const content = serializeFeature(feature)
    fs.writeFileSync(feature.filePath, content, 'utf-8')

    if (statusChanged) {
      migrating = true
      try {
        feature.filePath = moveFeatureFile(feature.filePath, absoluteFeaturesDir, newStatus, feature.attachments)
      } catch {
        // retry next load
      } finally {
        migrating = false
      }
    }

    broadcast(buildInitMessage())
    fireWebhooks(workspaceRoot, 'task.moved', {
      ...sanitizeFeature(feature),
      previousStatus: oldStatus
    })
    return feature
  }

  function doUpdateFeature(featureId: string, updates: Partial<Feature>): Feature | null {
    const feature = features.find(f => f.id === featureId)
    if (!feature) return null

    const oldStatus = feature.status
    const oldTitle = getTitleFromContent(feature.content)
    const { filePath: _fp, id: _id, ...safeUpdates } = updates
    Object.assign(feature, safeUpdates)
    feature.modified = new Date().toISOString()
    if (oldStatus !== feature.status) {
      feature.completedAt = feature.status === 'done' ? new Date().toISOString() : null
    }

    const content = serializeFeature(feature)
    fs.writeFileSync(feature.filePath, content, 'utf-8')

    // Rename file if title changed (numeric-ID cards only)
    const newTitle = getTitleFromContent(feature.content)
    const numId = extractNumericId(feature.id)
    if (numId !== null && newTitle !== oldTitle) {
      const newFilename = generateFeatureFilename(numId, newTitle)
      migrating = true
      try {
        feature.filePath = renameFeatureFile(feature.filePath, newFilename)
      } catch { /* retry next load */ } finally { migrating = false }
    }

    if (oldStatus !== feature.status) {
      migrating = true
      try {
        feature.filePath = moveFeatureFile(feature.filePath, absoluteFeaturesDir, feature.status, feature.attachments)
      } catch {
        // retry next load
      } finally {
        migrating = false
      }
    }

    broadcast(buildInitMessage())
    fireWebhooks(workspaceRoot, 'task.updated', sanitizeFeature(feature))
    return feature
  }

  function doDeleteFeature(featureId: string): boolean {
    const feature = features.find(f => f.id === featureId)
    if (!feature) return false

    try {
      fs.unlinkSync(feature.filePath)
      const deleted = sanitizeFeature(feature)
      features = features.filter(f => f.id !== featureId)
      broadcast(buildInitMessage())
      fireWebhooks(workspaceRoot, 'task.deleted', deleted)
      return true
    } catch (err) {
      console.error('Failed to delete feature:', err)
      return false
    }
  }

  function doAddColumn(name: string, color: string): KanbanColumn {
    const config = getConfig()
    const columns = config.columns
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    let uniqueId = id
    let counter = 1
    while (columns.some(c => c.id === uniqueId)) {
      uniqueId = `${id}-${counter++}`
    }
    const column: KanbanColumn = { id: uniqueId, name, color }
    columns.push(column)
    saveConfigFile({ ...config, columns })
    broadcast(buildInitMessage())
    fireWebhooks(workspaceRoot, 'column.created', column)
    return column
  }

  function doEditColumn(columnId: string, updates: { name: string; color: string }): KanbanColumn | null {
    const config = getConfig()
    const col = config.columns.find(c => c.id === columnId)
    if (!col) return null
    const columns = config.columns.map(c =>
      c.id === columnId ? { ...c, name: updates.name, color: updates.color } : c
    )
    saveConfigFile({ ...config, columns })
    const updated = columns.find(c => c.id === columnId) ?? col
    broadcast(buildInitMessage())
    fireWebhooks(workspaceRoot, 'column.updated', updated)
    return updated
  }

  function doRemoveColumn(columnId: string): { removed: boolean; error?: string } {
    const hasFeatures = features.some(f => f.status === columnId)
    if (hasFeatures) return { removed: false, error: 'Column has tasks' }
    const config = getConfig()
    const col = config.columns.find(c => c.id === columnId)
    if (!col) return { removed: false, error: 'Column not found' }
    const columns = config.columns.filter(c => c.id !== columnId)
    if (columns.length === 0) return { removed: false, error: 'Cannot remove last column' }
    saveConfigFile({ ...config, columns })
    broadcast(buildInitMessage())
    fireWebhooks(workspaceRoot, 'column.deleted', col)
    return { removed: true }
  }

  function doSaveSettings(newSettings: CardDisplaySettings): void {
    const config = getConfig()
    saveConfigFile(settingsToConfig(config, newSettings))
    broadcast(buildInitMessage())
  }

  function doAddAttachment(featureId: string, filename: string, fileData: Buffer): boolean {
    const feature = features.find(f => f.id === featureId)
    if (!feature) return false

    const featureDir = path.dirname(feature.filePath)
    const destPath = path.join(featureDir, filename)
    fs.writeFileSync(destPath, fileData)

    if (!feature.attachments) feature.attachments = []
    if (!feature.attachments.includes(filename)) {
      feature.attachments.push(filename)
    }
    feature.modified = new Date().toISOString()
    const content = serializeFeature(feature)
    lastWrittenContent = content
    fs.writeFileSync(feature.filePath, content, 'utf-8')
    return true
  }

  function doRemoveAttachment(featureId: string, attachment: string): Feature | null {
    const feature = features.find(f => f.id === featureId)
    if (!feature) return null

    feature.attachments = (feature.attachments || []).filter(a => a !== attachment)
    feature.modified = new Date().toISOString()
    const fileContent = serializeFeature(feature)
    lastWrittenContent = fileContent
    fs.writeFileSync(feature.filePath, fileContent, 'utf-8')

    broadcast(buildInitMessage())
    return feature
  }

  // --- Comment mutation functions ---

  function doAddComment(featureId: string, author: string, content: string): Comment | null {
    const feature = features.find(f => f.id === featureId)
    if (!feature) return null

    if (!feature.comments) feature.comments = []

    const maxId = feature.comments.reduce((max, c) => {
      const num = parseInt(c.id.replace('c', ''), 10)
      return Number.isNaN(num) ? max : Math.max(max, num)
    }, 0)

    const comment: Comment = {
      id: `c${maxId + 1}`,
      author,
      created: new Date().toISOString(),
      content
    }

    feature.comments.push(comment)
    feature.modified = new Date().toISOString()
    const fileContent = serializeFeature(feature)
    lastWrittenContent = fileContent
    fs.writeFileSync(feature.filePath, fileContent, 'utf-8')

    broadcast(buildInitMessage())
    fireWebhooks(workspaceRoot, 'comment.created', { ...comment, cardId: featureId })
    return comment
  }

  function doUpdateComment(featureId: string, commentId: string, content: string): Comment | null {
    const feature = features.find(f => f.id === featureId)
    if (!feature) return null

    const comment = (feature.comments || []).find(c => c.id === commentId)
    if (!comment) return null

    comment.content = content
    feature.modified = new Date().toISOString()
    const fileContent = serializeFeature(feature)
    lastWrittenContent = fileContent
    fs.writeFileSync(feature.filePath, fileContent, 'utf-8')

    broadcast(buildInitMessage())
    fireWebhooks(workspaceRoot, 'comment.updated', { ...comment, cardId: featureId })
    return comment
  }

  function doDeleteComment(featureId: string, commentId: string): boolean {
    const feature = features.find(f => f.id === featureId)
    if (!feature) return false

    const comment = (feature.comments || []).find(c => c.id === commentId)
    if (!comment) return false

    feature.comments = feature.comments.filter(c => c.id !== commentId)
    feature.modified = new Date().toISOString()
    const fileContent = serializeFeature(feature)
    lastWrittenContent = fileContent
    fs.writeFileSync(feature.filePath, fileContent, 'utf-8')

    broadcast(buildInitMessage())
    fireWebhooks(workspaceRoot, 'comment.deleted', { ...comment, cardId: featureId })
    return true
  }

  // --- WebSocket message handling ---

  async function handleMessage(ws: WebSocket, message: unknown): Promise<void> {
    const msg = message as Record<string, unknown>
    switch (msg.type) {
      case 'ready':
        loadFeatures()
        ws.send(JSON.stringify(buildInitMessage()))
        break

      case 'createFeature':
        doCreateFeature(msg.data as CreateFeatureData)
        break

      case 'moveFeature':
        doMoveFeature(msg.featureId as string, msg.newStatus as string, msg.newOrder as number)
        break

      case 'deleteFeature':
        doDeleteFeature(msg.featureId as string)
        break

      case 'updateFeature':
        doUpdateFeature(msg.featureId as string, msg.updates as Partial<Feature>)
        break

      case 'openFeature': {
        const featureId = msg.featureId as string
        const feature = features.find(f => f.id === featureId)
        if (!feature) break

        currentEditingFeatureId = featureId
        const frontmatter: FeatureFrontmatter = {
          id: feature.id, status: feature.status, priority: feature.priority,
          assignee: feature.assignee, dueDate: feature.dueDate, created: feature.created,
          modified: feature.modified, completedAt: feature.completedAt,
          labels: feature.labels, attachments: feature.attachments, order: feature.order
        }
        ws.send(JSON.stringify({ type: 'featureContent', featureId: feature.id, content: feature.content, frontmatter, comments: feature.comments || [] }))
        break
      }

      case 'saveFeatureContent': {
        const featureId = msg.featureId as string
        const newContent = msg.content as string
        const fm = msg.frontmatter as FeatureFrontmatter
        const feature = features.find(f => f.id === featureId)
        if (!feature) break

        const oldStatus = feature.status
        const oldTitle = getTitleFromContent(feature.content)
        feature.content = newContent
        feature.status = fm.status
        feature.priority = fm.priority
        feature.assignee = fm.assignee
        feature.dueDate = fm.dueDate
        feature.labels = fm.labels
        feature.attachments = fm.attachments || feature.attachments || []
        feature.modified = new Date().toISOString()
        if (oldStatus !== feature.status) {
          feature.completedAt = feature.status === 'done' ? new Date().toISOString() : null
        }

        const fileContent = serializeFeature(feature)
        lastWrittenContent = fileContent
        fs.writeFileSync(feature.filePath, fileContent, 'utf-8')

        // Rename file if title changed (numeric-ID cards only)
        const saveNewTitle = getTitleFromContent(feature.content)
        const saveNumId = extractNumericId(feature.id)
        if (saveNumId !== null && saveNewTitle !== oldTitle) {
          const newFilename = generateFeatureFilename(saveNumId, saveNewTitle)
          migrating = true
          try {
            feature.filePath = renameFeatureFile(feature.filePath, newFilename)
          } catch { /* retry next load */ } finally { migrating = false }
        }

        if (oldStatus !== feature.status) {
          migrating = true
          try {
            feature.filePath = moveFeatureFile(feature.filePath, absoluteFeaturesDir, feature.status, feature.attachments)
          } catch { /* retry next load */ } finally { migrating = false }
        }

        broadcast(buildInitMessage())
        fireWebhooks(workspaceRoot, 'task.updated', sanitizeFeature(feature))
        break
      }

      case 'closeFeature':
        currentEditingFeatureId = null
        break

      case 'openSettings': {
        const config = getConfig()
        const settings = configToSettings(config)
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
        doRemoveColumn(msg.columnId as string)
        break

      case 'removeAttachment': {
        const featureId = msg.featureId as string
        const feature = doRemoveAttachment(featureId, msg.attachment as string)
        if (feature && currentEditingFeatureId === featureId) {
          const frontmatter: FeatureFrontmatter = {
            id: feature.id, status: feature.status, priority: feature.priority,
            assignee: feature.assignee, dueDate: feature.dueDate, created: feature.created,
            modified: feature.modified, completedAt: feature.completedAt,
            labels: feature.labels, attachments: feature.attachments, order: feature.order
          }
          ws.send(JSON.stringify({ type: 'featureContent', featureId: feature.id, content: feature.content, frontmatter, comments: feature.comments || [] }))
        }
        break
      }

      case 'addComment': {
        const comment = doAddComment(msg.featureId as string, msg.author as string, msg.content as string)
        if (!comment) break
        const feature = features.find(f => f.id === msg.featureId)
        if (feature && currentEditingFeatureId === msg.featureId) {
          const frontmatter: FeatureFrontmatter = {
            id: feature.id, status: feature.status, priority: feature.priority,
            assignee: feature.assignee, dueDate: feature.dueDate, created: feature.created,
            modified: feature.modified, completedAt: feature.completedAt,
            labels: feature.labels, attachments: feature.attachments, order: feature.order
          }
          ws.send(JSON.stringify({ type: 'featureContent', featureId: feature.id, content: feature.content, frontmatter, comments: feature.comments || [] }))
        }
        break
      }

      case 'updateComment': {
        const comment = doUpdateComment(msg.featureId as string, msg.commentId as string, msg.content as string)
        if (!comment) break
        const feature = features.find(f => f.id === msg.featureId)
        if (feature && currentEditingFeatureId === msg.featureId) {
          const frontmatter: FeatureFrontmatter = {
            id: feature.id, status: feature.status, priority: feature.priority,
            assignee: feature.assignee, dueDate: feature.dueDate, created: feature.created,
            modified: feature.modified, completedAt: feature.completedAt,
            labels: feature.labels, attachments: feature.attachments, order: feature.order
          }
          ws.send(JSON.stringify({ type: 'featureContent', featureId: feature.id, content: feature.content, frontmatter, comments: feature.comments || [] }))
        }
        break
      }

      case 'deleteComment': {
        doDeleteComment(msg.featureId as string, msg.commentId as string)
        const feature = features.find(f => f.id === msg.featureId)
        if (feature && currentEditingFeatureId === msg.featureId) {
          const frontmatter: FeatureFrontmatter = {
            id: feature.id, status: feature.status, priority: feature.priority,
            assignee: feature.assignee, dueDate: feature.dueDate, created: feature.created,
            modified: feature.modified, completedAt: feature.completedAt,
            labels: feature.labels, attachments: feature.attachments, order: feature.order
          }
          ws.send(JSON.stringify({ type: 'featureContent', featureId: feature.id, content: feature.content, frontmatter, comments: feature.comments || [] }))
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

    // ==================== TASKS API ====================

    let params = route('GET', '/api/tasks')
    if (params) {
      loadFeatures()
      let result = features.map(sanitizeFeature)
      const status = url.searchParams.get('status')
      if (status) result = result.filter(f => f.status === status)
      const priority = url.searchParams.get('priority')
      if (priority) result = result.filter(f => f.priority === priority)
      const assignee = url.searchParams.get('assignee')
      if (assignee) result = result.filter(f => f.assignee === assignee)
      const label = url.searchParams.get('label')
      if (label) result = result.filter(f => f.labels.includes(label))
      return jsonOk(res, result)
    }

    params = route('POST', '/api/tasks')
    if (params) {
      try {
        const body = await readBody(req)
        const data: CreateFeatureData = {
          content: (body.content as string) || '',
          status: (body.status as FeatureStatus) || 'backlog',
          priority: (body.priority as Priority) || 'medium',
          assignee: (body.assignee as string) || null,
          dueDate: (body.dueDate as string) || null,
          labels: (body.labels as string[]) || []
        }
        if (!data.content) return jsonError(res, 400, 'content is required')
        const feature = doCreateFeature(data)
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
        const feature = doUpdateFeature(id, body as Partial<Feature>)
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
        const feature = doMoveFeature(id, newStatus, position)
        if (!feature) return jsonError(res, 404, 'Task not found')
        return jsonOk(res, sanitizeFeature(feature))
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('DELETE', '/api/tasks/:id')
    if (params) {
      const { id } = params
      const ok = doDeleteFeature(id)
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
          doAddAttachment(id, file.name, buf)
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
      const feature = doRemoveAttachment(id, attachName)
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
        const comment = doAddComment(id, author, content)
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
        const comment = doUpdateComment(id, commentId, content)
        if (!comment) return jsonError(res, 404, 'Comment not found')
        return jsonOk(res, comment)
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('DELETE', '/api/tasks/:id/comments/:commentId')
    if (params) {
      const { id, commentId } = params
      const ok = doDeleteComment(id, commentId)
      if (!ok) return jsonError(res, 404, 'Comment not found')
      return jsonOk(res, { deleted: true })
    }

    // ==================== COLUMNS API ====================

    params = route('GET', '/api/columns')
    if (params) {
      return jsonOk(res, getConfig().columns)
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
      const result = doRemoveColumn(id)
      if (!result.removed) return jsonError(res, 400, result.error || 'Cannot remove column')
      return jsonOk(res, { deleted: true })
    }

    // ==================== SETTINGS API ====================

    params = route('GET', '/api/settings')
    if (params) {
      const config = getConfig()
      const settings = configToSettings(config)
      settings.showBuildWithAI = false
      settings.markdownEditorMode = false
      return jsonOk(res, settings)
    }

    params = route('PUT', '/api/settings')
    if (params) {
      try {
        const body = await readBody(req)
        doSaveSettings(body as unknown as CardDisplaySettings)
        const config = getConfig()
        return jsonOk(res, configToSettings(config))
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

    params = route('DELETE', '/api/webhooks/:id')
    if (params) {
      const { id } = params
      const ok = deleteWebhook(workspaceRoot, id)
      if (!ok) return jsonError(res, 404, 'Webhook not found')
      return jsonOk(res, { deleted: true })
    }

    // ==================== WORKSPACE API ====================

    params = route('GET', '/api/workspace')
    if (params) {
      return jsonOk(res, { path: workspaceRoot })
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
          doAddAttachment(featureId, file.name, buf)
        }

        broadcast(buildInitMessage())
        const feature = features.find(f => f.id === featureId)
        if (feature && currentEditingFeatureId === featureId) {
          const frontmatter: FeatureFrontmatter = {
            id: feature.id, status: feature.status, priority: feature.priority,
            assignee: feature.assignee, dueDate: feature.dueDate, created: feature.created,
            modified: feature.modified, completedAt: feature.completedAt,
            labels: feature.labels, attachments: feature.attachments, order: feature.order
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
    debounceTimer = setTimeout(() => {
      loadFeatures()
      broadcast(buildInitMessage())

      if (currentEditingFeatureId && changedPath) {
        const editingFeature = features.find(f => f.id === currentEditingFeatureId)
        if (editingFeature && editingFeature.filePath === changedPath) {
          const currentContent = serializeFeature(editingFeature)
          if (currentContent !== lastWrittenContent) {
            const frontmatter: FeatureFrontmatter = {
              id: editingFeature.id, status: editingFeature.status, priority: editingFeature.priority,
              assignee: editingFeature.assignee, dueDate: editingFeature.dueDate, created: editingFeature.created,
              modified: editingFeature.modified, completedAt: editingFeature.completedAt,
              labels: editingFeature.labels, attachments: editingFeature.attachments, order: editingFeature.order
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
