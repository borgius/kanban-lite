import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as http from 'http'
import { WebSocket } from 'ws'
import { startServer } from '../server'

// Helper: create a temp directory for features
function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-test-'))
}

// Helper: write a feature markdown file
// Files are stored under boards/default/{status}/ in the multi-board layout
function writeFeatureFile(dir: string, filename: string, content: string, subfolder?: string): string {
  const targetDir = subfolder ? path.join(dir, 'boards', 'default', subfolder) : path.join(dir, 'boards', 'default')
  fs.mkdirSync(targetDir, { recursive: true })
  const filePath = path.join(targetDir, filename)
  fs.writeFileSync(filePath, content, 'utf-8')
  return filePath
}

// Helper: create a standard feature file content
function makeFeatureContent(opts: {
  id: string
  status?: string
  priority?: string
  title?: string
  order?: string
  assignee?: string | null
  dueDate?: string | null
  labels?: string[]
}): string {
  const {
    id,
    status = 'backlog',
    priority = 'medium',
    title = 'Test Feature',
    order = 'a0',
    assignee = null,
    dueDate = null,
    labels = []
  } = opts
  return `---
id: "${id}"
status: "${status}"
priority: "${priority}"
assignee: ${assignee ? `"${assignee}"` : 'null'}
dueDate: ${dueDate ? `"${dueDate}"` : 'null'}
created: "2024-01-01T00:00:00.000Z"
modified: "2024-01-01T00:00:00.000Z"
completedAt: null
labels: [${labels.map(l => `"${l}"`).join(', ')}]
order: "${order}"
---
# ${title}

Description here.`
}

// Helper: connect WebSocket and wait for open
function connectWs(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`)
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
  })
}

// Helper: send a message and wait for a response of a specific type
function sendAndReceive(ws: WebSocket, message: unknown, expectedType: string, timeout = 5000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${expectedType}`)), timeout)

    const handler = (data: Buffer | string) => {
      try {
        const parsed = JSON.parse(data.toString())
        if (parsed.type === expectedType) {
          clearTimeout(timer)
          ws.off('message', handler)
          resolve(parsed)
        }
      } catch {
        // ignore parse errors
      }
    }

    ws.on('message', handler)
    ws.send(JSON.stringify(message))
  })
}

// Helper: wait for a message of a specific type (no send)
function waitForMessage(ws: WebSocket, expectedType: string, timeout = 5000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${expectedType}`)), timeout)

    const handler = (data: Buffer | string) => {
      try {
        const parsed = JSON.parse(data.toString())
        if (parsed.type === expectedType) {
          clearTimeout(timer)
          ws.off('message', handler)
          resolve(parsed)
        }
      } catch {
        // ignore
      }
    }

    ws.on('message', handler)
  })
}

// Helper: fetch HTTP response
function httpGet(url: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = ''
      res.on('data', (chunk) => body += chunk)
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }))
    }).on('error', reject)
  })
}

// Helper: make HTTP request with method, body, and headers
function httpRequest(
  method: string,
  url: string,
  body?: unknown
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const payload = body ? JSON.stringify(body) : undefined
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload).toString() } : {})
        }
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => data += chunk)
        res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: data }))
      }
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

// Helper: find a free port
function getPort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = http.createServer()
    srv.listen(0, () => {
      const port = (srv.address() as { port: number }).port
      srv.close(() => resolve(port))
    })
  })
}

// Helper: wait a bit
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Helper: create a temp webview directory with dummy static files
function createTempWebviewDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-webview-'))
  fs.writeFileSync(path.join(dir, 'index.js'), '// test js', 'utf-8')
  fs.writeFileSync(path.join(dir, 'style.css'), '/* test css */', 'utf-8')
  return dir
}

describe('Standalone Server Integration', () => {
  let server: http.Server
  let tempDir: string
  let webviewDir: string
  let port: number
  let ws: WebSocket

  beforeEach(async () => {
    tempDir = createTempDir()
    webviewDir = createTempWebviewDir()
    port = await getPort()
  })

  afterEach(async () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close()
      await sleep(50)
    }
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    // Clean up temp dirs, config file, and webhooks file
    fs.rmSync(tempDir, { recursive: true, force: true })
    fs.rmSync(webviewDir, { recursive: true, force: true })
    const workspaceRoot = path.dirname(tempDir)
    const configFile = path.join(workspaceRoot, '.kanban.json')
    if (fs.existsSync(configFile)) fs.rmSync(configFile)
    const webhooksFile = path.join(workspaceRoot, '.kanban-webhooks.json')
    if (fs.existsSync(webhooksFile)) fs.rmSync(webhooksFile)
  })

  // ── HTTP Tests ──

  describe('HTTP server', () => {
    it('should serve index.html at root', async () => {
      server = startServer(tempDir, port, webviewDir)
      await sleep(200)

      const res = await httpGet(`http://localhost:${port}/`)
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toBe('text/html')
      expect(res.body).toContain('<div id="root">')
      expect(res.body).toContain('Kanban Board')
    })

    it('should serve static CSS files', async () => {
      server = startServer(tempDir, port, webviewDir)
      await sleep(200)

      const res = await httpGet(`http://localhost:${port}/style.css`)
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toBe('text/css')
    })

    it('should serve static JS files', async () => {
      server = startServer(tempDir, port, webviewDir)
      await sleep(200)

      const res = await httpGet(`http://localhost:${port}/index.js`)
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toBe('text/javascript')
    })

    it('should fall back to index.html for unknown paths', async () => {
      server = startServer(tempDir, port, webviewDir)
      await sleep(200)

      const res = await httpGet(`http://localhost:${port}/some/unknown/route`)
      expect(res.status).toBe(200)
      expect(res.body).toContain('<div id="root">')
    })
  })

  // ── WebSocket: Ready / Init ──

  describe('ready message and init response', () => {
    it('should return features and columns on ready', async () => {
      // Pre-populate a feature file in its status subfolder
      writeFeatureFile(tempDir, 'test-feature.md', makeFeatureContent({
        id: 'test-feature',
        status: 'backlog',
        priority: 'high',
        title: 'Test Feature'
      }), 'backlog')

      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)

      const response = await sendAndReceive(ws, { type: 'ready' }, 'init')

      expect(response.type).toBe('init')
      expect(Array.isArray(response.features)).toBe(true)
      expect(Array.isArray(response.columns)).toBe(true)

      const features = response.features as Array<Record<string, unknown>>
      expect(features.length).toBe(1)
      expect(features[0].id).toBe('test-feature')
      expect(features[0].status).toBe('backlog')
      expect(features[0].priority).toBe('high')

      const columns = response.columns as Array<Record<string, unknown>>
      expect(columns.length).toBe(5)
      expect(columns.map(c => c.id)).toEqual(['backlog', 'todo', 'in-progress', 'review', 'done'])

      expect(response.settings).toBeDefined()
    })

    it('should return empty features for empty directory', async () => {
      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)

      const response = await sendAndReceive(ws, { type: 'ready' }, 'init')
      const features = response.features as Array<unknown>
      expect(features.length).toBe(0)
    })

    it('should load features from done/ subfolder', async () => {
      writeFeatureFile(tempDir, 'done-feature.md', makeFeatureContent({
        id: 'done-feature',
        status: 'done',
        title: 'Done Feature'
      }), 'done')

      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)

      const response = await sendAndReceive(ws, { type: 'ready' }, 'init')
      const features = response.features as Array<Record<string, unknown>>
      expect(features.length).toBe(1)
      expect(features[0].id).toBe('done-feature')
      expect(features[0].status).toBe('done')
    })

    it('should load multiple features sorted by order', async () => {
      writeFeatureFile(tempDir, 'feature-b.md', makeFeatureContent({
        id: 'feature-b',
        order: 'b0'
      }), 'backlog')
      writeFeatureFile(tempDir, 'feature-a.md', makeFeatureContent({
        id: 'feature-a',
        order: 'a0'
      }), 'backlog')

      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)

      const response = await sendAndReceive(ws, { type: 'ready' }, 'init')
      const features = response.features as Array<Record<string, unknown>>
      expect(features.length).toBe(2)
      expect(features[0].id).toBe('feature-a')
      expect(features[1].id).toBe('feature-b')
    })
  })

  // ── Create Feature ──

  describe('createFeature', () => {
    it('should create a feature file on disk', async () => {
      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)

      // Init first
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      // Create feature
      const response = await sendAndReceive(ws, {
        type: 'createFeature',
        data: {
          status: 'todo',
          priority: 'high',
          content: '# My New Feature\n\nSome description',
          assignee: null,
          dueDate: null,
          labels: ['frontend']
        }
      }, 'init')

      const features = response.features as Array<Record<string, unknown>>
      expect(features.length).toBe(1)
      expect(features[0].status).toBe('todo')
      expect(features[0].priority).toBe('high')
      expect(features[0].content).toBe('# My New Feature\n\nSome description')
      expect(features[0].labels).toEqual(['frontend'])

      // Verify file exists on disk in boards/default/todo/ subfolder
      const todoDir = path.join(tempDir, 'boards', 'default', 'todo')
      const files = fs.readdirSync(todoDir).filter(f => f.endsWith('.md'))
      expect(files.length).toBe(1)

      const fileContent = fs.readFileSync(path.join(todoDir, files[0]), 'utf-8')
      expect(fileContent).toContain('status: "todo"')
      expect(fileContent).toContain('priority: "high"')
      expect(fileContent).toContain('# My New Feature')
      expect(fileContent).toContain('labels: ["frontend"]')
    })

    it('should create feature in its status subfolder', async () => {
      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const response = await sendAndReceive(ws, {
        type: 'createFeature',
        data: {
          status: 'done',
          priority: 'low',
          content: '# Completed Thing',
          assignee: null,
          dueDate: null,
          labels: []
        }
      }, 'init')

      const features = response.features as Array<Record<string, unknown>>
      expect(features.length).toBe(1)
      expect(features[0].status).toBe('done')
      expect(features[0].completedAt).toBeTruthy()

      // File should be in boards/default/done/ subfolder
      const doneFiles = fs.readdirSync(path.join(tempDir, 'boards', 'default', 'done')).filter(f => f.endsWith('.md'))
      expect(doneFiles.length).toBe(1)
    })

    it('should assign correct order when creating in a populated column', async () => {
      writeFeatureFile(tempDir, 'existing.md', makeFeatureContent({
        id: 'existing',
        status: 'backlog',
        order: 'a0'
      }), 'backlog')

      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const response = await sendAndReceive(ws, {
        type: 'createFeature',
        data: {
          status: 'backlog',
          priority: 'medium',
          content: '# Second Feature',
          assignee: null,
          dueDate: null,
          labels: []
        }
      }, 'init')

      const features = response.features as Array<Record<string, unknown>>
      const backlogFeatures = features.filter(f => f.status === 'backlog')
      expect(backlogFeatures.length).toBe(2)
      // New feature should come after existing (order > 'a0')
      expect((backlogFeatures[1].order as string) > (backlogFeatures[0].order as string)).toBe(true)
    })

    it('should preserve assignee and dueDate', async () => {
      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const response = await sendAndReceive(ws, {
        type: 'createFeature',
        data: {
          status: 'todo',
          priority: 'high',
          content: '# Assigned Feature',
          assignee: 'john',
          dueDate: '2024-12-31',
          labels: ['urgent', 'backend']
        }
      }, 'init')

      const features = response.features as Array<Record<string, unknown>>
      expect(features[0].assignee).toBe('john')
      expect(features[0].dueDate).toBe('2024-12-31')
      expect(features[0].labels).toEqual(['urgent', 'backend'])
    })
  })

  // ── Move Feature ──

  describe('moveFeature', () => {
    it('should change status and move file to new status folder', async () => {
      writeFeatureFile(tempDir, 'move-me.md', makeFeatureContent({
        id: 'move-me',
        status: 'backlog',
        title: 'Move Me'
      }), 'backlog')

      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const response = await sendAndReceive(ws, {
        type: 'moveFeature',
        featureId: 'move-me',
        newStatus: 'in-progress',
        newOrder: 0
      }, 'init')

      const features = response.features as Array<Record<string, unknown>>
      expect(features[0].status).toBe('in-progress')

      // Verify file was moved to boards/default/in-progress/ subfolder
      expect(fs.existsSync(path.join(tempDir, 'boards', 'default', 'backlog', 'move-me.md'))).toBe(false)
      const fileContent = fs.readFileSync(path.join(tempDir, 'boards', 'default', 'in-progress', 'move-me.md'), 'utf-8')
      expect(fileContent).toContain('status: "in-progress"')
    })

    it('should move file to done/ subfolder when status changes to done', async () => {
      writeFeatureFile(tempDir, 'finish-me.md', makeFeatureContent({
        id: 'finish-me',
        status: 'review',
        title: 'Finish Me'
      }), 'review')

      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const response = await sendAndReceive(ws, {
        type: 'moveFeature',
        featureId: 'finish-me',
        newStatus: 'done',
        newOrder: 0
      }, 'init')

      const features = response.features as Array<Record<string, unknown>>
      expect(features[0].status).toBe('done')
      expect(features[0].completedAt).toBeTruthy()

      // File should now be in boards/default/done/ subfolder
      expect(fs.existsSync(path.join(tempDir, 'boards', 'default', 'review', 'finish-me.md'))).toBe(false)
      expect(fs.existsSync(path.join(tempDir, 'boards', 'default', 'done', 'finish-me.md'))).toBe(true)
    })

    it('should move file from done/ to target status folder', async () => {
      writeFeatureFile(tempDir, 'reopen-me.md', makeFeatureContent({
        id: 'reopen-me',
        status: 'done',
        title: 'Reopen Me'
      }), 'done')

      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const response = await sendAndReceive(ws, {
        type: 'moveFeature',
        featureId: 'reopen-me',
        newStatus: 'todo',
        newOrder: 0
      }, 'init')

      const features = response.features as Array<Record<string, unknown>>
      expect(features[0].status).toBe('todo')
      expect(features[0].completedAt).toBeNull()

      // File should be in boards/default/todo/ subfolder
      expect(fs.existsSync(path.join(tempDir, 'boards', 'default', 'done', 'reopen-me.md'))).toBe(false)
      expect(fs.existsSync(path.join(tempDir, 'boards', 'default', 'todo', 'reopen-me.md'))).toBe(true)
    })

    it('should compute correct fractional order between neighbors', async () => {
      writeFeatureFile(tempDir, 'feat-a.md', makeFeatureContent({
        id: 'feat-a',
        status: 'todo',
        order: 'a0'
      }), 'todo')
      writeFeatureFile(tempDir, 'feat-c.md', makeFeatureContent({
        id: 'feat-c',
        status: 'todo',
        order: 'a2'
      }), 'todo')
      writeFeatureFile(tempDir, 'feat-move.md', makeFeatureContent({
        id: 'feat-move',
        status: 'backlog',
        order: 'a0'
      }), 'backlog')

      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')

      // Move feat-move to todo column between feat-a (position 0) and feat-c (position 1)
      const response = await sendAndReceive(ws, {
        type: 'moveFeature',
        featureId: 'feat-move',
        newStatus: 'todo',
        newOrder: 1
      }, 'init')

      const features = response.features as Array<Record<string, unknown>>
      const todoFeatures = features
        .filter(f => f.status === 'todo')
        .sort((a, b) => (a.order as string) < (b.order as string) ? -1 : 1)

      expect(todoFeatures.length).toBe(3)
      expect(todoFeatures[0].id).toBe('feat-a')
      expect(todoFeatures[1].id).toBe('feat-move')
      expect(todoFeatures[2].id).toBe('feat-c')
      // Verify order is between a0 and a2
      expect((todoFeatures[1].order as string) > (todoFeatures[0].order as string)).toBe(true)
      expect((todoFeatures[1].order as string) < (todoFeatures[2].order as string)).toBe(true)
    })
  })

  // ── Delete Feature ──

  describe('deleteFeature', () => {
    it('should delete feature file from disk', async () => {
      writeFeatureFile(tempDir, 'delete-me.md', makeFeatureContent({
        id: 'delete-me',
        title: 'Delete Me'
      }), 'backlog')

      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const response = await sendAndReceive(ws, {
        type: 'deleteFeature',
        featureId: 'delete-me'
      }, 'init')

      const features = response.features as Array<unknown>
      expect(features.length).toBe(0)

      // File should be removed
      expect(fs.existsSync(path.join(tempDir, 'boards', 'default', 'backlog', 'delete-me.md'))).toBe(false)
    })

    it('should only delete the targeted feature', async () => {
      writeFeatureFile(tempDir, 'keep-me.md', makeFeatureContent({ id: 'keep-me' }), 'backlog')
      writeFeatureFile(tempDir, 'remove-me.md', makeFeatureContent({ id: 'remove-me' }), 'backlog')

      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const response = await sendAndReceive(ws, {
        type: 'deleteFeature',
        featureId: 'remove-me'
      }, 'init')

      const features = response.features as Array<Record<string, unknown>>
      expect(features.length).toBe(1)
      expect(features[0].id).toBe('keep-me')
      expect(fs.existsSync(path.join(tempDir, 'boards', 'default', 'backlog', 'keep-me.md'))).toBe(true)
    })

    it('should handle deleting non-existent feature gracefully', async () => {
      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')

      // This should not crash
      ws.send(JSON.stringify({ type: 'deleteFeature', featureId: 'nonexistent' }))
      await sleep(200)

      // Connection should still be open
      expect(ws.readyState).toBe(WebSocket.OPEN)
    })
  })

  // ── Update Feature ──

  describe('updateFeature', () => {
    it('should update feature properties and persist', async () => {
      writeFeatureFile(tempDir, 'update-me.md', makeFeatureContent({
        id: 'update-me',
        priority: 'low',
        title: 'Update Me'
      }), 'backlog')

      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const response = await sendAndReceive(ws, {
        type: 'updateFeature',
        featureId: 'update-me',
        updates: {
          priority: 'critical',
          assignee: 'alice',
          labels: ['urgent']
        }
      }, 'init')

      const features = response.features as Array<Record<string, unknown>>
      expect(features[0].priority).toBe('critical')
      expect(features[0].assignee).toBe('alice')
      expect(features[0].labels).toEqual(['urgent'])

      // Verify persisted on disk
      const fileContent = fs.readFileSync(path.join(tempDir, 'boards', 'default', 'backlog', 'update-me.md'), 'utf-8')
      expect(fileContent).toContain('priority: "critical"')
      expect(fileContent).toContain('assignee: "alice"')
      expect(fileContent).toContain('labels: ["urgent"]')
    })

    it('should set completedAt when status changes to done', async () => {
      writeFeatureFile(tempDir, 'complete-me.md', makeFeatureContent({
        id: 'complete-me',
        status: 'review'
      }), 'review')

      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const response = await sendAndReceive(ws, {
        type: 'updateFeature',
        featureId: 'complete-me',
        updates: { status: 'done' }
      }, 'init')

      const features = response.features as Array<Record<string, unknown>>
      expect(features[0].completedAt).toBeTruthy()
    })
  })

  // ── Open Feature (inline editor) ──

  describe('openFeature', () => {
    it('should return feature content and frontmatter', async () => {
      writeFeatureFile(tempDir, 'open-me.md', makeFeatureContent({
        id: 'open-me',
        status: 'in-progress',
        priority: 'high',
        title: 'Open Me',
        assignee: 'bob',
        labels: ['backend', 'api']
      }), 'in-progress')

      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const response = await sendAndReceive(ws, {
        type: 'openFeature',
        featureId: 'open-me'
      }, 'featureContent')

      expect(response.type).toBe('featureContent')
      expect(response.featureId).toBe('open-me')
      expect(response.content).toContain('# Open Me')

      const frontmatter = response.frontmatter as Record<string, unknown>
      expect(frontmatter.id).toBe('open-me')
      expect(frontmatter.status).toBe('in-progress')
      expect(frontmatter.priority).toBe('high')
      expect(frontmatter.assignee).toBe('bob')
      expect(frontmatter.labels).toEqual(['backend', 'api'])
    })
  })

  // ── Save Feature Content ──

  describe('saveFeatureContent', () => {
    it('should save updated content and frontmatter to disk', async () => {
      writeFeatureFile(tempDir, 'save-me.md', makeFeatureContent({
        id: 'save-me',
        status: 'backlog',
        priority: 'low',
        title: 'Save Me'
      }), 'backlog')

      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')

      // Open the feature first
      await sendAndReceive(ws, {
        type: 'openFeature',
        featureId: 'save-me'
      }, 'featureContent')

      // Save with updated content
      const response = await sendAndReceive(ws, {
        type: 'saveFeatureContent',
        featureId: 'save-me',
        content: '# Save Me Updated\n\nNew description here.',
        frontmatter: {
          id: 'save-me',
          status: 'in-progress',
          priority: 'high',
          assignee: 'charlie',
          dueDate: '2025-06-01',
          created: '2024-01-01T00:00:00.000Z',
          modified: '2024-01-01T00:00:00.000Z',
          completedAt: null,
          labels: ['updated'],
          order: 'a0'
        }
      }, 'init')

      const features = response.features as Array<Record<string, unknown>>
      const saved = features.find(f => f.id === 'save-me')!
      expect(saved.status).toBe('in-progress')
      expect(saved.priority).toBe('high')
      expect(saved.content).toBe('# Save Me Updated\n\nNew description here.')
      expect(saved.assignee).toBe('charlie')
      expect(saved.labels).toEqual(['updated'])

      // Verify on disk — file moved from boards/default/backlog/ to boards/default/in-progress/
      expect(fs.existsSync(path.join(tempDir, 'boards', 'default', 'backlog', 'save-me.md'))).toBe(false)
      const fileContent = fs.readFileSync(path.join(tempDir, 'boards', 'default', 'in-progress', 'save-me.md'), 'utf-8')
      expect(fileContent).toContain('status: "in-progress"')
      expect(fileContent).toContain('# Save Me Updated')
      expect(fileContent).toContain('assignee: "charlie"')
    })

    it('should move file to done/ when saved with done status', async () => {
      writeFeatureFile(tempDir, 'save-done.md', makeFeatureContent({
        id: 'save-done',
        status: 'review',
        title: 'Save Done'
      }), 'review')

      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')
      await sendAndReceive(ws, {
        type: 'openFeature',
        featureId: 'save-done'
      }, 'featureContent')

      await sendAndReceive(ws, {
        type: 'saveFeatureContent',
        featureId: 'save-done',
        content: '# Save Done\n\nCompleted.',
        frontmatter: {
          id: 'save-done',
          status: 'done',
          priority: 'medium',
          assignee: null,
          dueDate: null,
          created: '2024-01-01T00:00:00.000Z',
          modified: '2024-01-01T00:00:00.000Z',
          completedAt: null,
          labels: [],
          order: 'a0'
        }
      }, 'init')

      expect(fs.existsSync(path.join(tempDir, 'boards', 'default', 'review', 'save-done.md'))).toBe(false)
      expect(fs.existsSync(path.join(tempDir, 'boards', 'default', 'done', 'save-done.md'))).toBe(true)
    })
  })

  // ── Close Feature ──

  describe('closeFeature', () => {
    it('should not crash when closing', async () => {
      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')

      ws.send(JSON.stringify({ type: 'closeFeature' }))
      await sleep(100)

      expect(ws.readyState).toBe(WebSocket.OPEN)
    })
  })

  // ── No-op VSCode messages ──

  describe('VSCode-specific no-op messages', () => {
    it('should handle openFile without crashing', async () => {
      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')
      ws.send(JSON.stringify({ type: 'openFile', featureId: 'test' }))
      await sleep(100)
      expect(ws.readyState).toBe(WebSocket.OPEN)
    })

    it('should handle openSettings without crashing', async () => {
      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')
      ws.send(JSON.stringify({ type: 'openSettings' }))
      await sleep(100)
      expect(ws.readyState).toBe(WebSocket.OPEN)
    })

    it('should handle focusMenuBar without crashing', async () => {
      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')
      ws.send(JSON.stringify({ type: 'focusMenuBar' }))
      await sleep(100)
      expect(ws.readyState).toBe(WebSocket.OPEN)
    })

    it('should handle startWithAI without crashing', async () => {
      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')
      ws.send(JSON.stringify({ type: 'startWithAI', agent: 'claude', permissionMode: 'default' }))
      await sleep(100)
      expect(ws.readyState).toBe(WebSocket.OPEN)
    })
  })

  // ── File Watcher ──

  describe('file watcher', () => {
    it('should broadcast updates when a file is created externally', async () => {
      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')

      // Let chokidar fully initialize before making external changes
      await sleep(1000)

      // Listen for the next init broadcast
      const updatePromise = waitForMessage(ws, 'init', 10000)

      writeFeatureFile(tempDir, 'external-feature.md', makeFeatureContent({
        id: 'external-feature',
        status: 'todo',
        title: 'External Feature'
      }), 'todo')

      const response = await updatePromise
      const features = response.features as Array<Record<string, unknown>>
      const external = features.find(f => f.id === 'external-feature')
      expect(external).toBeDefined()
      expect(external!.status).toBe('todo')
    })

    it('should broadcast updates when a file is modified externally', async () => {
      const filePath = writeFeatureFile(tempDir, 'modify-me.md', makeFeatureContent({
        id: 'modify-me',
        status: 'backlog',
        priority: 'low',
        title: 'Modify Me'
      }), 'backlog')

      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')

      // Let chokidar fully initialize
      await sleep(1000)

      const updatePromise = waitForMessage(ws, 'init', 10000)

      fs.writeFileSync(filePath, makeFeatureContent({
        id: 'modify-me',
        status: 'backlog',
        priority: 'critical',
        title: 'Modified Feature'
      }), 'utf-8')

      const response = await updatePromise
      const features = response.features as Array<Record<string, unknown>>
      const modified = features.find(f => f.id === 'modify-me')
      expect(modified).toBeDefined()
      expect(modified!.priority).toBe('critical')
    })

    it('should broadcast updates when a file is deleted externally', async () => {
      const filePath = writeFeatureFile(tempDir, 'vanish-me.md', makeFeatureContent({
        id: 'vanish-me',
        title: 'Vanish Me'
      }), 'backlog')

      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)

      const initResponse = await sendAndReceive(ws, { type: 'ready' }, 'init')
      expect((initResponse.features as Array<unknown>).length).toBe(1)

      // Let chokidar fully initialize
      await sleep(1000)

      const updatePromise = waitForMessage(ws, 'init', 10000)

      fs.unlinkSync(filePath)

      const response = await updatePromise
      const features = response.features as Array<unknown>
      expect(features.length).toBe(0)
    })
  })

  // ── Multi-client broadcast ──

  describe('multi-client broadcast', () => {
    it('should broadcast to all connected clients', async () => {
      writeFeatureFile(tempDir, 'broadcast-test.md', makeFeatureContent({
        id: 'broadcast-test',
        title: 'Broadcast Test'
      }), 'backlog')

      server = startServer(tempDir, port, webviewDir)
      await sleep(200)

      const ws1 = await connectWs(port)
      const ws2 = await connectWs(port)

      // Init both clients
      await sendAndReceive(ws1, { type: 'ready' }, 'init')
      await sendAndReceive(ws2, { type: 'ready' }, 'init')

      // Client 2 listens for update
      const ws2Update = waitForMessage(ws2, 'init', 3000)

      // Client 1 creates a feature
      ws1.send(JSON.stringify({
        type: 'createFeature',
        data: {
          status: 'backlog',
          priority: 'medium',
          content: '# Broadcast Feature',
          assignee: null,
          dueDate: null,
          labels: []
        }
      }))

      // Client 2 should receive the broadcast
      const response = await ws2Update
      const features = response.features as Array<Record<string, unknown>>
      expect(features.length).toBe(2) // original + new

      ws1.close()
      ws2.close()
      await sleep(50)
    })
  })

  // ── Migration: legacy integer orders ──

  describe('legacy order migration', () => {
    it('should migrate integer order values to fractional indices', async () => {
      writeFeatureFile(tempDir, 'legacy-1.md', makeFeatureContent({
        id: 'legacy-1',
        status: 'backlog',
        order: '0'
      }), 'backlog')
      writeFeatureFile(tempDir, 'legacy-2.md', makeFeatureContent({
        id: 'legacy-2',
        status: 'backlog',
        order: '1'
      }), 'backlog')

      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)

      const response = await sendAndReceive(ws, { type: 'ready' }, 'init')
      const features = response.features as Array<Record<string, unknown>>

      // Orders should no longer be plain integers
      for (const f of features) {
        expect(/^\d+$/.test(f.order as string)).toBe(false)
      }

      // Files on disk should be updated
      const file1 = fs.readFileSync(path.join(tempDir, 'boards', 'default', 'backlog', 'legacy-1.md'), 'utf-8')
      const file2 = fs.readFileSync(path.join(tempDir, 'boards', 'default', 'backlog', 'legacy-2.md'), 'utf-8')
      const orderMatch1 = file1.match(/order: "(.+)"/)
      const orderMatch2 = file2.match(/order: "(.+)"/)
      expect(orderMatch1).toBeTruthy()
      expect(orderMatch2).toBeTruthy()
      expect(/^\d+$/.test(orderMatch1![1])).toBe(false)
      expect(/^\d+$/.test(orderMatch2![1])).toBe(false)
      // First should come before second
      expect(orderMatch1![1] < orderMatch2![1]).toBe(true)
    })
  })

  // ── Migration: reconcile done/non-done ──

  describe('status/folder reconciliation', () => {
    it('should move root file with status:done to done/ subfolder (migration)', async () => {
      // Place a done-status file in root (mismatched — legacy flat layout)
      writeFeatureFile(tempDir, 'misplaced-done.md', makeFeatureContent({
        id: 'misplaced-done',
        status: 'done',
        title: 'Misplaced Done'
      }))

      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')

      // After load, file should have been migrated to boards/default/done/
      expect(fs.existsSync(path.join(tempDir, 'boards', 'default', 'misplaced-done.md'))).toBe(false)
      expect(fs.existsSync(path.join(tempDir, 'boards', 'default', 'done', 'misplaced-done.md'))).toBe(true)
    })

    it('should move mismatched file to correct status subfolder', async () => {
      // Place a backlog-status file in done/ (mismatched)
      writeFeatureFile(tempDir, 'misplaced-active.md', makeFeatureContent({
        id: 'misplaced-active',
        status: 'backlog',
        title: 'Misplaced Active'
      }), 'done')

      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')

      // After load, file should have been moved to boards/default/backlog/
      expect(fs.existsSync(path.join(tempDir, 'boards', 'default', 'done', 'misplaced-active.md'))).toBe(false)
      expect(fs.existsSync(path.join(tempDir, 'boards', 'default', 'backlog', 'misplaced-active.md'))).toBe(true)
    })
  })

  // ── Parsing edge cases ──

  describe('parsing edge cases', () => {
    it('should skip non-markdown files', async () => {
      writeFeatureFile(tempDir, 'not-a-feature.txt', 'just some text', 'backlog')
      writeFeatureFile(tempDir, 'real-feature.md', makeFeatureContent({
        id: 'real-feature',
        title: 'Real Feature'
      }), 'backlog')

      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)

      const response = await sendAndReceive(ws, { type: 'ready' }, 'init')
      const features = response.features as Array<Record<string, unknown>>
      expect(features.length).toBe(1)
      expect(features[0].id).toBe('real-feature')
    })

    it('should skip files without valid frontmatter', async () => {
      writeFeatureFile(tempDir, 'no-frontmatter.md', '# Just a heading\n\nNo frontmatter here.', 'backlog')
      writeFeatureFile(tempDir, 'valid.md', makeFeatureContent({
        id: 'valid',
        title: 'Valid Feature'
      }), 'backlog')

      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)

      const response = await sendAndReceive(ws, { type: 'ready' }, 'init')
      const features = response.features as Array<Record<string, unknown>>
      expect(features.length).toBe(1)
      expect(features[0].id).toBe('valid')
    })

    it('should handle Windows-style line endings', async () => {
      const content = makeFeatureContent({
        id: 'crlf-feature',
        title: 'CRLF Feature'
      }).replace(/\n/g, '\r\n')

      writeFeatureFile(tempDir, 'crlf-feature.md', content, 'backlog')

      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)

      const response = await sendAndReceive(ws, { type: 'ready' }, 'init')
      const features = response.features as Array<Record<string, unknown>>
      expect(features.length).toBe(1)
      expect(features[0].id).toBe('crlf-feature')
    })
  })

  // ── Settings ──

  describe('settings', () => {
    it('should respond to openSettings with showSettings message', async () => {
      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const response = await sendAndReceive(ws, { type: 'openSettings' }, 'showSettings')
      expect(response.type).toBe('showSettings')
      expect(response.settings).toBeDefined()
      const settings = response.settings as Record<string, unknown>
      expect(settings.showPriorityBadges).toBe(true)
      expect(settings.showBuildWithAI).toBe(false)
      expect(settings.markdownEditorMode).toBe(false)
    })

    it('should persist settings to .kanban-settings.json', async () => {
      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const response = await sendAndReceive(ws, {
        type: 'saveSettings',
        settings: {
          showPriorityBadges: true,
          showAssignee: true,
          showDueDate: true,
          showLabels: false,
          showBuildWithAI: false,
          showFileName: false,
          compactMode: true,
          markdownEditorMode: false,
          defaultPriority: 'high',
          defaultStatus: 'todo'
        }
      }, 'init')

      // init broadcast should have updated settings
      const settings = response.settings as Record<string, unknown>
      expect(settings.compactMode).toBe(true)
      expect(settings.showLabels).toBe(false)
      expect(settings.defaultPriority).toBe('high')
      expect(settings.defaultStatus).toBe('todo')

      // Verify file on disk (config is at workspace root, i.e. parent of features dir)
      const configFile = path.join(path.dirname(tempDir), '.kanban.json')
      expect(fs.existsSync(configFile)).toBe(true)
      const persisted = JSON.parse(fs.readFileSync(configFile, 'utf-8'))
      expect(persisted.compactMode).toBe(true)
      expect(persisted.showLabels).toBe(false)
    })

    it('should load persisted settings on server restart', async () => {
      // Write config file at workspace root (parent of features dir)
      fs.mkdirSync(tempDir, { recursive: true })
      fs.writeFileSync(
        path.join(path.dirname(tempDir), '.kanban.json'),
        JSON.stringify({
          showPriorityBadges: false,
          compactMode: true,
          defaultPriority: 'low'
        }),
        'utf-8'
      )

      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)

      const response = await sendAndReceive(ws, { type: 'ready' }, 'init')
      const settings = response.settings as Record<string, unknown>
      expect(settings.showPriorityBadges).toBe(false)
      expect(settings.compactMode).toBe(true)
      expect(settings.defaultPriority).toBe('low')
      // Defaults for unspecified settings
      expect(settings.showAssignee).toBe(true)
      expect(settings.showDueDate).toBe(true)
    })

    it('should broadcast settings to all connected clients', async () => {
      server = startServer(tempDir, port, webviewDir)
      await sleep(200)

      const ws1 = await connectWs(port)
      const ws2 = await connectWs(port)

      await sendAndReceive(ws1, { type: 'ready' }, 'init')
      await sendAndReceive(ws2, { type: 'ready' }, 'init')

      const ws2Update = waitForMessage(ws2, 'init', 3000)

      ws1.send(JSON.stringify({
        type: 'saveSettings',
        settings: {
          showPriorityBadges: true,
          showAssignee: true,
          showDueDate: true,
          showLabels: true,
          showBuildWithAI: false,
          showFileName: true,
          compactMode: true,
          markdownEditorMode: false,
          defaultPriority: 'medium',
          defaultStatus: 'backlog'
        }
      }))

      const response = await ws2Update
      const settings = response.settings as Record<string, unknown>
      expect(settings.compactMode).toBe(true)
      expect(settings.showFileName).toBe(true)

      ws1.close()
      ws2.close()
      await sleep(50)
    })

    it('should force showBuildWithAI=false even if client sends true', async () => {
      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const response = await sendAndReceive(ws, {
        type: 'saveSettings',
        settings: {
          showPriorityBadges: true,
          showAssignee: true,
          showDueDate: true,
          showLabels: true,
          showBuildWithAI: true,
          showFileName: false,
          compactMode: false,
          markdownEditorMode: true,
          defaultPriority: 'medium',
          defaultStatus: 'backlog'
        }
      }, 'init')

      const settings = response.settings as Record<string, unknown>
      expect(settings.showBuildWithAI).toBe(false)
      expect(settings.markdownEditorMode).toBe(false)
    })

    it('should handle corrupt settings file gracefully', async () => {
      fs.mkdirSync(tempDir, { recursive: true })
      fs.writeFileSync(path.join(tempDir, '.kanban-settings.json'), 'not valid json{{{', 'utf-8')

      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)

      const response = await sendAndReceive(ws, { type: 'ready' }, 'init')
      const settings = response.settings as Record<string, unknown>
      // Should fall back to defaults
      expect(settings.showPriorityBadges).toBe(true)
      expect(settings.compactMode).toBe(false)
    })
  })

  // ── REST API: Tasks ──

  describe('REST API — Tasks', () => {
    it('GET /api/tasks should list tasks', async () => {
      writeFeatureFile(tempDir, 'api-task-1.md', makeFeatureContent({
        id: 'api-task-1',
        status: 'backlog',
        title: 'API Task 1'
      }), 'backlog')
      writeFeatureFile(tempDir, 'api-task-2.md', makeFeatureContent({
        id: 'api-task-2',
        status: 'todo',
        title: 'API Task 2'
      }), 'todo')

      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      // Initialize via WS so server loads features
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const res = await httpGet(`http://localhost:${port}/api/tasks`)
      expect(res.status).toBe(200)
      const json = JSON.parse(res.body)
      expect(json.ok).toBe(true)
      expect(json.data.length).toBe(2)
      // Should not include filePath
      expect(json.data[0].filePath).toBeUndefined()
    })

    it('GET /api/tasks should filter by status', async () => {
      writeFeatureFile(tempDir, 'filter-1.md', makeFeatureContent({
        id: 'filter-1',
        status: 'backlog'
      }), 'backlog')
      writeFeatureFile(tempDir, 'filter-2.md', makeFeatureContent({
        id: 'filter-2',
        status: 'todo'
      }), 'todo')

      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const res = await httpGet(`http://localhost:${port}/api/tasks?status=todo`)
      const json = JSON.parse(res.body)
      expect(json.ok).toBe(true)
      expect(json.data.length).toBe(1)
      expect(json.data[0].id).toBe('filter-2')
    })

    it('GET /api/tasks should filter by priority', async () => {
      writeFeatureFile(tempDir, 'pri-high.md', makeFeatureContent({
        id: 'pri-high',
        priority: 'high'
      }), 'backlog')
      writeFeatureFile(tempDir, 'pri-low.md', makeFeatureContent({
        id: 'pri-low',
        priority: 'low'
      }), 'backlog')

      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const res = await httpGet(`http://localhost:${port}/api/tasks?priority=high`)
      const json = JSON.parse(res.body)
      expect(json.ok).toBe(true)
      expect(json.data.length).toBe(1)
      expect(json.data[0].id).toBe('pri-high')
    })

    it('GET /api/tasks should filter by assignee', async () => {
      writeFeatureFile(tempDir, 'assign-alice.md', makeFeatureContent({
        id: 'assign-alice',
        assignee: 'alice'
      }), 'backlog')
      writeFeatureFile(tempDir, 'assign-bob.md', makeFeatureContent({
        id: 'assign-bob',
        assignee: 'bob'
      }), 'backlog')

      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const res = await httpGet(`http://localhost:${port}/api/tasks?assignee=alice`)
      const json = JSON.parse(res.body)
      expect(json.ok).toBe(true)
      expect(json.data.length).toBe(1)
      expect(json.data[0].id).toBe('assign-alice')
    })

    it('GET /api/tasks should filter by label', async () => {
      writeFeatureFile(tempDir, 'label-fe.md', makeFeatureContent({
        id: 'label-fe',
        labels: ['frontend']
      }), 'backlog')
      writeFeatureFile(tempDir, 'label-be.md', makeFeatureContent({
        id: 'label-be',
        labels: ['backend']
      }), 'backlog')

      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const res = await httpGet(`http://localhost:${port}/api/tasks?label=frontend`)
      const json = JSON.parse(res.body)
      expect(json.ok).toBe(true)
      expect(json.data.length).toBe(1)
      expect(json.data[0].id).toBe('label-fe')
    })

    it('GET /api/tasks/:id should return a single task', async () => {
      writeFeatureFile(tempDir, 'single-task.md', makeFeatureContent({
        id: 'single-task',
        status: 'todo',
        priority: 'high',
        title: 'Single Task'
      }), 'todo')

      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const res = await httpGet(`http://localhost:${port}/api/tasks/single-task`)
      const json = JSON.parse(res.body)
      expect(json.ok).toBe(true)
      expect(json.data.id).toBe('single-task')
      expect(json.data.status).toBe('todo')
      expect(json.data.filePath).toBeUndefined()
    })

    it('GET /api/tasks/:id should return 404 for non-existent task', async () => {
      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const res = await httpGet(`http://localhost:${port}/api/tasks/nonexistent`)
      expect(res.status).toBe(404)
      const json = JSON.parse(res.body)
      expect(json.ok).toBe(false)
    })

    it('POST /api/tasks should create a task', async () => {
      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const res = await httpRequest('POST', `http://localhost:${port}/api/tasks`, {
        content: '# API Created Task\n\nDescription.',
        status: 'todo',
        priority: 'high',
        assignee: 'alice',
        labels: ['api']
      })
      expect(res.status).toBe(201)
      const json = JSON.parse(res.body)
      expect(json.ok).toBe(true)
      expect(json.data.status).toBe('todo')
      expect(json.data.priority).toBe('high')
      expect(json.data.assignee).toBe('alice')
      expect(json.data.labels).toEqual(['api'])
      expect(json.data.filePath).toBeUndefined()

      // Verify persisted on disk
      const todoDir = path.join(tempDir, 'boards', 'default', 'todo')
      const files = fs.readdirSync(todoDir).filter(f => f.endsWith('.md'))
      expect(files.length).toBe(1)
    })

    it('PUT /api/tasks/:id should update a task', async () => {
      writeFeatureFile(tempDir, 'update-api.md', makeFeatureContent({
        id: 'update-api',
        status: 'backlog',
        priority: 'low'
      }), 'backlog')

      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const res = await httpRequest('PUT', `http://localhost:${port}/api/tasks/update-api`, {
        priority: 'critical',
        assignee: 'bob'
      })
      expect(res.status).toBe(200)
      const json = JSON.parse(res.body)
      expect(json.ok).toBe(true)
      expect(json.data.priority).toBe('critical')
      expect(json.data.assignee).toBe('bob')
    })

    it('PUT /api/tasks/:id should return 404 for non-existent task', async () => {
      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const res = await httpRequest('PUT', `http://localhost:${port}/api/tasks/nonexistent`, {
        priority: 'high'
      })
      expect(res.status).toBe(404)
    })

    it('PATCH /api/tasks/:id/move should move a task', async () => {
      writeFeatureFile(tempDir, 'move-api.md', makeFeatureContent({
        id: 'move-api',
        status: 'backlog'
      }), 'backlog')

      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const res = await httpRequest('PATCH', `http://localhost:${port}/api/tasks/move-api/move`, {
        status: 'in-progress',
        position: 0
      })
      expect(res.status).toBe(200)
      const json = JSON.parse(res.body)
      expect(json.ok).toBe(true)
      expect(json.data.status).toBe('in-progress')

      // File should be moved
      expect(fs.existsSync(path.join(tempDir, 'boards', 'default', 'backlog', 'move-api.md'))).toBe(false)
      expect(fs.existsSync(path.join(tempDir, 'boards', 'default', 'in-progress', 'move-api.md'))).toBe(true)
    })

    it('DELETE /api/tasks/:id should delete a task', async () => {
      writeFeatureFile(tempDir, 'delete-api.md', makeFeatureContent({
        id: 'delete-api'
      }), 'backlog')

      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const res = await httpRequest('DELETE', `http://localhost:${port}/api/tasks/delete-api`)
      expect(res.status).toBe(200)
      const json = JSON.parse(res.body)
      expect(json.ok).toBe(true)

      // File should be gone
      expect(fs.existsSync(path.join(tempDir, 'boards', 'default', 'backlog', 'delete-api.md'))).toBe(false)
    })

    it('DELETE /api/tasks/:id should return 404 for non-existent task', async () => {
      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const res = await httpRequest('DELETE', `http://localhost:${port}/api/tasks/nonexistent`)
      expect(res.status).toBe(404)
    })
  })

  // ── REST API: Columns ──

  describe('REST API — Columns', () => {
    it('GET /api/columns should list columns', async () => {
      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const res = await httpGet(`http://localhost:${port}/api/columns`)
      const json = JSON.parse(res.body)
      expect(json.ok).toBe(true)
      expect(json.data.length).toBe(5)
      expect(json.data.map((c: Record<string, unknown>) => c.id)).toEqual([
        'backlog', 'todo', 'in-progress', 'review', 'done'
      ])
    })

    it('POST /api/columns should add a column', async () => {
      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const res = await httpRequest('POST', `http://localhost:${port}/api/columns`, {
        name: 'Testing',
        color: '#ff9900'
      })
      expect(res.status).toBe(201)
      const json = JSON.parse(res.body)
      expect(json.ok).toBe(true)
      expect(json.data.name).toBe('Testing')
      expect(json.data.color).toBe('#ff9900')

      // Verify column was added
      const listRes = await httpGet(`http://localhost:${port}/api/columns`)
      const listJson = JSON.parse(listRes.body)
      expect(listJson.data.length).toBe(6)
      const testing = listJson.data.find((c: Record<string, unknown>) => c.id === json.data.id)
      expect(testing).toBeDefined()
      expect(testing.name).toBe('Testing')
    })

    it('PUT /api/columns/:id should update a column', async () => {
      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const res = await httpRequest('PUT', `http://localhost:${port}/api/columns/review`, {
        name: 'QA Review',
        color: '#ff0000'
      })
      expect(res.status).toBe(200)
      const json = JSON.parse(res.body)
      expect(json.ok).toBe(true)

      // Verify update
      const listRes = await httpGet(`http://localhost:${port}/api/columns`)
      const listJson = JSON.parse(listRes.body)
      const review = listJson.data.find((c: Record<string, unknown>) => c.id === 'review')
      expect(review.name).toBe('QA Review')
      expect(review.color).toBe('#ff0000')
    })

    it('PUT /api/columns/:id should return 404 for non-existent column', async () => {
      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const res = await httpRequest('PUT', `http://localhost:${port}/api/columns/nonexistent`, {
        name: 'Nope'
      })
      expect(res.status).toBe(404)
    })

    it('DELETE /api/columns/:id should remove an empty column', async () => {
      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      // Add a column first, then remove it
      const createRes = await httpRequest('POST', `http://localhost:${port}/api/columns`, {
        name: 'Temp Col',
        color: '#000'
      })
      const createdCol = JSON.parse(createRes.body).data
      const colId = createdCol.id

      const res = await httpRequest('DELETE', `http://localhost:${port}/api/columns/${colId}`)
      expect(res.status).toBe(200)

      // Verify removal
      const listRes = await httpGet(`http://localhost:${port}/api/columns`)
      const listJson = JSON.parse(listRes.body)
      expect(listJson.data.find((c: Record<string, unknown>) => c.id === colId)).toBeUndefined()
    })
  })

  // ── REST API: Settings ──

  describe('REST API — Settings', () => {
    it('GET /api/settings should return settings', async () => {
      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const res = await httpGet(`http://localhost:${port}/api/settings`)
      const json = JSON.parse(res.body)
      expect(json.ok).toBe(true)
      expect(json.data.showPriorityBadges).toBe(true)
      expect(json.data.showBuildWithAI).toBe(false)
    })

    it('PUT /api/settings should update settings', async () => {
      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const res = await httpRequest('PUT', `http://localhost:${port}/api/settings`, {
        showPriorityBadges: false,
        compactMode: true,
        showAssignee: true,
        showDueDate: true,
        showLabels: true,
        showBuildWithAI: false,
        showFileName: false,
        markdownEditorMode: false,
        defaultPriority: 'high',
        defaultStatus: 'todo'
      })
      expect(res.status).toBe(200)
      const json = JSON.parse(res.body)
      expect(json.ok).toBe(true)
      expect(json.data.showPriorityBadges).toBe(false)
      expect(json.data.compactMode).toBe(true)

      // Verify via GET
      const getRes = await httpGet(`http://localhost:${port}/api/settings`)
      const getJson = JSON.parse(getRes.body)
      expect(getJson.data.showPriorityBadges).toBe(false)
      expect(getJson.data.compactMode).toBe(true)
    })
  })

  // ── REST API: Webhooks ──

  describe('REST API — Webhooks', () => {
    it('GET /api/webhooks should return empty list initially', async () => {
      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const res = await httpGet(`http://localhost:${port}/api/webhooks`)
      const json = JSON.parse(res.body)
      expect(json.ok).toBe(true)
      expect(json.data).toEqual([])
    })

    it('POST /api/webhooks should register a webhook', async () => {
      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const res = await httpRequest('POST', `http://localhost:${port}/api/webhooks`, {
        url: 'https://example.com/hook',
        events: ['task.created', 'task.moved'],
        secret: 'test-secret'
      })
      expect(res.status).toBe(201)
      const json = JSON.parse(res.body)
      expect(json.ok).toBe(true)
      expect(json.data.url).toBe('https://example.com/hook')
      expect(json.data.events).toEqual(['task.created', 'task.moved'])
      expect(json.data.id).toMatch(/^wh_/)

      // Verify via GET
      const listRes = await httpGet(`http://localhost:${port}/api/webhooks`)
      const listJson = JSON.parse(listRes.body)
      expect(listJson.data.length).toBe(1)
    })

    it('DELETE /api/webhooks/:id should remove a webhook', async () => {
      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      // Create first
      const createRes = await httpRequest('POST', `http://localhost:${port}/api/webhooks`, {
        url: 'https://example.com/hook',
        events: ['*']
      })
      const webhookId = JSON.parse(createRes.body).data.id

      // Delete
      const res = await httpRequest('DELETE', `http://localhost:${port}/api/webhooks/${webhookId}`)
      expect(res.status).toBe(200)

      // Verify removed
      const listRes = await httpGet(`http://localhost:${port}/api/webhooks`)
      const listJson = JSON.parse(listRes.body)
      expect(listJson.data.length).toBe(0)
    })

    it('DELETE /api/webhooks/:id should return 404 for non-existent webhook', async () => {
      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const res = await httpRequest('DELETE', `http://localhost:${port}/api/webhooks/wh_nonexistent`)
      expect(res.status).toBe(404)
    })
  })

  // ── REST API: CORS & Error Handling ──

  describe('REST API — CORS & Error Handling', () => {
    it('should include CORS headers on API responses', async () => {
      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const res = await httpGet(`http://localhost:${port}/api/tasks`)
      expect(res.headers['access-control-allow-origin']).toBe('*')
    })

    it('should handle OPTIONS preflight for CORS', async () => {
      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const res = await httpRequest('OPTIONS', `http://localhost:${port}/api/tasks`)
      expect(res.status).toBe(204)
      expect(res.headers['access-control-allow-origin']).toBe('*')
      expect(res.headers['access-control-allow-methods']).toBeDefined()
    })

    it('should return 404 for unknown API paths', async () => {
      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const res = await httpGet(`http://localhost:${port}/api/nonexistent`)
      expect(res.status).toBe(404)
      const json = JSON.parse(res.body)
      expect(json.ok).toBe(false)
    })

    it('REST API changes should broadcast to WebSocket clients', async () => {
      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      // Listen for init broadcast from WS
      const wsUpdate = waitForMessage(ws, 'init', 5000)

      // Create task via API
      await httpRequest('POST', `http://localhost:${port}/api/tasks`, {
        content: '# Broadcast Test',
        status: 'backlog',
        priority: 'medium'
      })

      // WS client should receive broadcast
      const response = await wsUpdate
      const features = response.features as Array<Record<string, unknown>>
      expect(features.length).toBe(1)
      expect(features[0].content).toContain('Broadcast Test')
    })
  })
})
