import * as http from 'http'
import * as fs from 'fs'
import * as path from 'path'
import { WebSocketServer, WebSocket } from 'ws'
import chokidar from 'chokidar'
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'
import { getTitleFromContent, generateFeatureFilename } from '../shared/types'
import type { Feature, FeatureStatus, Priority, KanbanColumn, FeatureFrontmatter, CardDisplaySettings } from '../shared/types'
import { parseFeatureFile, serializeFeature } from '../sdk/parser'
import { ensureStatusSubfolders, moveFeatureFile, getFeatureFilePath, getStatusFromPath } from './fileUtils'

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

const DEFAULT_COLUMNS: KanbanColumn[] = [
  { id: 'backlog', name: 'Backlog', color: '#6b7280' },
  { id: 'todo', name: 'To Do', color: '#3b82f6' },
  { id: 'in-progress', name: 'In Progress', color: '#f59e0b' },
  { id: 'review', name: 'Review', color: '#8b5cf6' },
  { id: 'done', name: 'Done', color: '#22c55e' }
]

const DEFAULT_SETTINGS: CardDisplaySettings = {
  showPriorityBadges: true,
  showAssignee: true,
  showDueDate: true,
  showLabels: true,
  showBuildWithAI: false,
  showFileName: false,
  compactMode: false,
  markdownEditorMode: false,
  defaultPriority: 'medium',
  defaultStatus: 'backlog'
}

export function startServer(featuresDir: string, port: number, webviewDir?: string): http.Server {
  const absoluteFeaturesDir = path.resolve(featuresDir)
  let features: Feature[] = []
  let migrating = false
  let currentEditingFeatureId: string | null = null
  let lastWrittenContent = ''

  // Resolve webview static files directory
  const resolvedWebviewDir = webviewDir || path.join(__dirname, 'standalone-webview')

  // --- Settings persistence ---
  const settingsFilePath = path.join(absoluteFeaturesDir, '.kanban-settings.json')
  let currentSettings: CardDisplaySettings = { ...DEFAULT_SETTINGS }

  function loadSettings(): void {
    try {
      if (fs.existsSync(settingsFilePath)) {
        const raw = JSON.parse(fs.readFileSync(settingsFilePath, 'utf-8'))
        currentSettings = { ...DEFAULT_SETTINGS, ...raw }
        currentSettings.showBuildWithAI = false
        currentSettings.markdownEditorMode = false
      }
    } catch {
      currentSettings = { ...DEFAULT_SETTINGS }
    }
  }

  function saveSettingsToFile(settings: CardDisplaySettings): void {
    settings.showBuildWithAI = false
    settings.markdownEditorMode = false
    currentSettings = settings
    try {
      fs.mkdirSync(absoluteFeaturesDir, { recursive: true })
      fs.writeFileSync(settingsFilePath, JSON.stringify(settings, null, 2), 'utf-8')
    } catch (err) {
      console.error('Failed to save settings:', err)
    }
  }

  loadSettings()

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
    ensureStatusSubfolders(absoluteFeaturesDir)

    // Phase 1: Migrate old per-status subfolders
    migrating = true
    try {
      const oldStatusFolders = ['backlog', 'todo', 'in-progress', 'review']
      for (const folder of oldStatusFolders) {
        const subdir = path.join(absoluteFeaturesDir, folder)
        if (!fs.existsSync(subdir)) continue
        try {
          const entries = fs.readdirSync(subdir, { withFileTypes: true })
          for (const entry of entries) {
            if (!entry.isFile() || !entry.name.endsWith('.md')) continue
            const filePath = path.join(subdir, entry.name)
            try {
              const content = fs.readFileSync(filePath, 'utf-8')
              const feature = parseFeatureFile(content, filePath)
              const status = feature?.status || 'backlog'
              moveFeatureFile(filePath, absoluteFeaturesDir, status)
            } catch {
              // skip
            }
          }
          // Remove empty old folders
          const remaining = fs.readdirSync(subdir)
          if (remaining.length === 0) {
            fs.rmdirSync(subdir)
          }
        } catch {
          // skip
        }
      }

      // Move root files with status:done to done/
      const rootEntries = fs.readdirSync(absoluteFeaturesDir, { withFileTypes: true })
      for (const entry of rootEntries) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue
        const filePath = path.join(absoluteFeaturesDir, entry.name)
        try {
          const content = fs.readFileSync(filePath, 'utf-8')
          const feature = parseFeatureFile(content, filePath)
          if (feature?.status === 'done') {
            moveFeatureFile(filePath, absoluteFeaturesDir, 'done')
          }
        } catch {
          // skip
        }
      }
    } finally {
      migrating = false
    }

    // Phase 2: Load features
    const loaded: Feature[] = []

    // Root-level files
    const rootEntries = fs.readdirSync(absoluteFeaturesDir, { withFileTypes: true })
    for (const entry of rootEntries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      const filePath = path.join(absoluteFeaturesDir, entry.name)
      const content = fs.readFileSync(filePath, 'utf-8')
      const feature = parseFeatureFile(content, filePath)
      if (feature) loaded.push(feature)
    }

    // done/ subfolder
    const doneDir = path.join(absoluteFeaturesDir, 'done')
    if (fs.existsSync(doneDir)) {
      const doneEntries = fs.readdirSync(doneDir, { withFileTypes: true })
      for (const entry of doneEntries) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue
        const filePath = path.join(doneDir, entry.name)
        const content = fs.readFileSync(filePath, 'utf-8')
        const feature = parseFeatureFile(content, filePath)
        if (feature) loaded.push(feature)
      }
    }

    // Phase 3: Reconcile done ↔ non-done mismatches
    migrating = true
    try {
      for (const feature of loaded) {
        const pathStatus = getStatusFromPath(feature.filePath, absoluteFeaturesDir)
        const inDoneFolder = pathStatus === 'done'
        const isDoneStatus = feature.status === 'done'

        if (isDoneStatus && !inDoneFolder) {
          try {
            feature.filePath = moveFeatureFile(feature.filePath, absoluteFeaturesDir, 'done')
          } catch { /* retry next load */ }
        } else if (!isDoneStatus && inDoneFolder) {
          try {
            feature.filePath = moveFeatureFile(feature.filePath, absoluteFeaturesDir, feature.status)
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

    features = loaded.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
  }

  // --- Message handling ---

  function buildInitMessage(): unknown {
    return {
      type: 'init',
      features,
      columns: DEFAULT_COLUMNS,
      settings: currentSettings
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

  async function handleMessage(ws: WebSocket, message: unknown): Promise<void> {
    const msg = message as Record<string, unknown>
    switch (msg.type) {
      case 'ready':
        loadFeatures()
        ws.send(JSON.stringify(buildInitMessage()))
        break

      case 'createFeature': {
        const data = msg.data as CreateFeatureData
        fs.mkdirSync(absoluteFeaturesDir, { recursive: true })
        ensureStatusSubfolders(absoluteFeaturesDir)

        const title = getTitleFromContent(data.content)
        const filename = generateFeatureFilename(title)
        const now = new Date().toISOString()
        const featuresInStatus = features
          .filter(f => f.status === data.status)
          .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
        const lastOrder = featuresInStatus.length > 0 ? featuresInStatus[featuresInStatus.length - 1].order : null

        const feature: Feature = {
          id: filename,
          status: data.status,
          priority: data.priority,
          assignee: data.assignee,
          dueDate: data.dueDate,
          created: now,
          modified: now,
          completedAt: data.status === 'done' ? now : null,
          labels: data.labels,
          attachments: [],
          order: generateKeyBetween(lastOrder, null),
          content: data.content,
          filePath: getFeatureFilePath(absoluteFeaturesDir, data.status, filename)
        }

        fs.mkdirSync(path.dirname(feature.filePath), { recursive: true })
        const content = serializeFeature(feature)
        fs.writeFileSync(feature.filePath, content, 'utf-8')

        features.push(feature)
        broadcast(buildInitMessage())
        break
      }

      case 'moveFeature': {
        const featureId = msg.featureId as string
        const newStatus = msg.newStatus as string
        const newOrder = msg.newOrder as number
        const feature = features.find(f => f.id === featureId)
        if (!feature) break

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

        const crossingDoneBoundary = statusChanged && (oldStatus === 'done' || newStatus === 'done')
        if (crossingDoneBoundary) {
          migrating = true
          try {
            feature.filePath = moveFeatureFile(feature.filePath, absoluteFeaturesDir, newStatus)
          } catch {
            // retry next load
          } finally {
            migrating = false
          }
        }

        broadcast(buildInitMessage())
        break
      }

      case 'deleteFeature': {
        const featureId = msg.featureId as string
        const feature = features.find(f => f.id === featureId)
        if (!feature) break

        try {
          fs.unlinkSync(feature.filePath)
          features = features.filter(f => f.id !== featureId)
          broadcast(buildInitMessage())
        } catch (err) {
          console.error('Failed to delete feature:', err)
        }
        break
      }

      case 'updateFeature': {
        const featureId = msg.featureId as string
        const updates = msg.updates as Partial<Feature>
        const feature = features.find(f => f.id === featureId)
        if (!feature) break

        const oldStatus = feature.status
        Object.assign(feature, updates)
        feature.modified = new Date().toISOString()
        if (oldStatus !== feature.status) {
          feature.completedAt = feature.status === 'done' ? new Date().toISOString() : null
        }

        const content = serializeFeature(feature)
        fs.writeFileSync(feature.filePath, content, 'utf-8')

        const crossingDoneBoundary = oldStatus !== feature.status && (oldStatus === 'done' || feature.status === 'done')
        if (crossingDoneBoundary) {
          migrating = true
          try {
            feature.filePath = moveFeatureFile(feature.filePath, absoluteFeaturesDir, feature.status)
          } catch {
            // retry next load
          } finally {
            migrating = false
          }
        }

        broadcast(buildInitMessage())
        break
      }

      case 'openFeature': {
        const featureId = msg.featureId as string
        const feature = features.find(f => f.id === featureId)
        if (!feature) break

        currentEditingFeatureId = featureId

        const frontmatter: FeatureFrontmatter = {
          id: feature.id,
          status: feature.status,
          priority: feature.priority,
          assignee: feature.assignee,
          dueDate: feature.dueDate,
          created: feature.created,
          modified: feature.modified,
          completedAt: feature.completedAt,
          labels: feature.labels,
          attachments: feature.attachments,
          order: feature.order
        }

        ws.send(JSON.stringify({
          type: 'featureContent',
          featureId: feature.id,
          content: feature.content,
          frontmatter
        }))
        break
      }

      case 'saveFeatureContent': {
        const featureId = msg.featureId as string
        const newContent = msg.content as string
        const frontmatter = msg.frontmatter as FeatureFrontmatter
        const feature = features.find(f => f.id === featureId)
        if (!feature) break

        const oldStatus = feature.status

        feature.content = newContent
        feature.status = frontmatter.status
        feature.priority = frontmatter.priority
        feature.assignee = frontmatter.assignee
        feature.dueDate = frontmatter.dueDate
        feature.labels = frontmatter.labels
        feature.attachments = frontmatter.attachments || feature.attachments || []
        feature.modified = new Date().toISOString()
        if (oldStatus !== feature.status) {
          feature.completedAt = feature.status === 'done' ? new Date().toISOString() : null
        }

        const fileContent = serializeFeature(feature)
        lastWrittenContent = fileContent
        fs.writeFileSync(feature.filePath, fileContent, 'utf-8')

        const crossingDoneBoundary = oldStatus !== feature.status && (oldStatus === 'done' || feature.status === 'done')
        if (crossingDoneBoundary) {
          migrating = true
          try {
            feature.filePath = moveFeatureFile(feature.filePath, absoluteFeaturesDir, feature.status)
          } catch {
            // retry next load
          } finally {
            migrating = false
          }
        }

        broadcast(buildInitMessage())
        break
      }

      case 'closeFeature':
        currentEditingFeatureId = null
        break

      case 'openSettings':
        ws.send(JSON.stringify({
          type: 'showSettings',
          settings: currentSettings
        }))
        break

      case 'saveSettings': {
        const newSettings = msg.settings as CardDisplaySettings
        saveSettingsToFile(newSettings)
        broadcast(buildInitMessage())
        break
      }

      case 'removeAttachment': {
        const featureId = msg.featureId as string
        const attachment = msg.attachment as string
        const feature = features.find(f => f.id === featureId)
        if (!feature) break

        feature.attachments = (feature.attachments || []).filter(a => a !== attachment)
        feature.modified = new Date().toISOString()
        const fileContent = serializeFeature(feature)
        lastWrittenContent = fileContent
        fs.writeFileSync(feature.filePath, fileContent, 'utf-8')

        // Send updated feature content back if editing
        if (currentEditingFeatureId === featureId) {
          const frontmatter: FeatureFrontmatter = {
            id: feature.id,
            status: feature.status,
            priority: feature.priority,
            assignee: feature.assignee,
            dueDate: feature.dueDate,
            created: feature.created,
            modified: feature.modified,
            completedAt: feature.completedAt,
            labels: feature.labels,
            attachments: feature.attachments,
            order: feature.order
          }
          ws.send(JSON.stringify({
            type: 'featureContent',
            featureId: feature.id,
            content: feature.content,
            frontmatter
          }))
        }
        broadcast(buildInitMessage())
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

  // Helper: add attachment file to a feature and persist
  function addAttachmentToFeature(featureId: string, filename: string, fileData: Buffer): boolean {
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

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`)

    // --- API: Upload attachment ---
    if (req.method === 'POST' && url.pathname === '/api/upload-attachment') {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
          const featureId = body.featureId as string
          const files = body.files as { name: string; data: string }[]

          if (!featureId || !Array.isArray(files)) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Missing featureId or files' }))
            return
          }

          for (const file of files) {
            const buf = Buffer.from(file.data, 'base64')
            addAttachmentToFeature(featureId, file.name, buf)
          }

          // Broadcast updated state and send feature content
          broadcast(buildInitMessage())
          const feature = features.find(f => f.id === featureId)
          if (feature && currentEditingFeatureId === featureId) {
            const frontmatter: FeatureFrontmatter = {
              id: feature.id,
              status: feature.status,
              priority: feature.priority,
              assignee: feature.assignee,
              dueDate: feature.dueDate,
              created: feature.created,
              modified: feature.modified,
              completedAt: feature.completedAt,
              labels: feature.labels,
              attachments: feature.attachments,
              order: feature.order
            }
            broadcast({
              type: 'featureContent',
              featureId: feature.id,
              content: feature.content,
              frontmatter
            })
          }

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: String(err) }))
        }
      })
      return
    }

    // --- API: Serve attachment file ---
    if (req.method === 'GET' && url.pathname === '/api/attachment') {
      const featureId = url.searchParams.get('featureId')
      const filename = url.searchParams.get('filename')
      if (!featureId || !filename) {
        res.writeHead(400, { 'Content-Type': 'text/plain' })
        res.end('Missing featureId or filename')
        return
      }

      const feature = features.find(f => f.id === featureId)
      if (!feature) {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('Feature not found')
        return
      }

      const featureDir = path.dirname(feature.filePath)
      const attachmentPath = path.resolve(featureDir, filename)
      // Security: ensure the resolved path is within the features directory
      if (!attachmentPath.startsWith(absoluteFeaturesDir)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' })
        res.end('Forbidden')
        return
      }

      const ext = path.extname(filename)
      const contentType = MIME_TYPES[ext] || 'application/octet-stream'

      fs.readFile(attachmentPath, (err, data) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain' })
          res.end('File not found')
          return
        }
        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Disposition': `inline; filename="${filename}"`
        })
        res.end(data)
      })
      return
    }

    let filePath = path.join(resolvedWebviewDir, url.pathname === '/' ? 'index.html' : url.pathname)

    // Serve index.html for any non-file path (SPA fallback)
    if (!path.extname(filePath)) {
      // Serve generated index.html
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(indexHtml)
      return
    }

    // Serve static file
    const ext = path.extname(filePath)
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'

    fs.readFile(filePath, (err, data) => {
      if (err) {
        // Try serving index.html for SPA routes
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

  // Ensure features dir exists before watching
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

      // If the changed file is the currently-edited feature, refresh editor
      if (currentEditingFeatureId && changedPath) {
        const editingFeature = features.find(f => f.id === currentEditingFeatureId)
        if (editingFeature && editingFeature.filePath === changedPath) {
          const currentContent = serializeFeature(editingFeature)
          if (currentContent !== lastWrittenContent) {
            const frontmatter: FeatureFrontmatter = {
              id: editingFeature.id,
              status: editingFeature.status,
              priority: editingFeature.priority,
              assignee: editingFeature.assignee,
              dueDate: editingFeature.dueDate,
              created: editingFeature.created,
              modified: editingFeature.modified,
              completedAt: editingFeature.completedAt,
              labels: editingFeature.labels,
              attachments: editingFeature.attachments,
              order: editingFeature.order
            }
            broadcast({
              type: 'featureContent',
              featureId: editingFeature.id,
              content: editingFeature.content,
              frontmatter
            })
          }
        }
      }
    }, 100)
  }

  watcher.on('change', handleFileChange)
  watcher.on('add', handleFileChange)
  watcher.on('unlink', handleFileChange)

  // Clean up on server close
  server.on('close', () => {
    watcher.close()
    wss.close()
  })

  server.listen(port, () => {
    console.log(`Kanban board running at http://localhost:${port}`)
    console.log(`Features directory: ${absoluteFeaturesDir}`)
  })

  return server
}
