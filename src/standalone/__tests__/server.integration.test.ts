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
function writeFeatureFile(dir: string, filename: string, content: string, subfolder?: string): string {
  const targetDir = subfolder ? path.join(dir, subfolder) : dir
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
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }))
    }).on('error', reject)
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
    // Clean up temp dirs
    fs.rmSync(tempDir, { recursive: true, force: true })
    fs.rmSync(webviewDir, { recursive: true, force: true })
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
      // Pre-populate a feature file
      writeFeatureFile(tempDir, 'test-feature.md', makeFeatureContent({
        id: 'test-feature',
        status: 'backlog',
        priority: 'high',
        title: 'Test Feature'
      }))

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
      }))
      writeFeatureFile(tempDir, 'feature-a.md', makeFeatureContent({
        id: 'feature-a',
        order: 'a0'
      }))

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

      // Verify file exists on disk
      const files = fs.readdirSync(tempDir).filter(f => f.endsWith('.md'))
      expect(files.length).toBe(1)

      const fileContent = fs.readFileSync(path.join(tempDir, files[0]), 'utf-8')
      expect(fileContent).toContain('status: "todo"')
      expect(fileContent).toContain('priority: "high"')
      expect(fileContent).toContain('# My New Feature')
      expect(fileContent).toContain('labels: ["frontend"]')
    })

    it('should create done feature in done/ subfolder', async () => {
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

      // File should be in done/ subfolder
      const doneFiles = fs.readdirSync(path.join(tempDir, 'done')).filter(f => f.endsWith('.md'))
      expect(doneFiles.length).toBe(1)
    })

    it('should assign correct order when creating in a populated column', async () => {
      writeFeatureFile(tempDir, 'existing.md', makeFeatureContent({
        id: 'existing',
        status: 'backlog',
        order: 'a0'
      }))

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
      expect(backlogFeatures[1].order > backlogFeatures[0].order).toBe(true)
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
    it('should change status and update file on disk', async () => {
      writeFeatureFile(tempDir, 'move-me.md', makeFeatureContent({
        id: 'move-me',
        status: 'backlog',
        title: 'Move Me'
      }))

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

      // Verify file was updated
      const fileContent = fs.readFileSync(path.join(tempDir, 'move-me.md'), 'utf-8')
      expect(fileContent).toContain('status: "in-progress"')
    })

    it('should move file to done/ subfolder when status changes to done', async () => {
      writeFeatureFile(tempDir, 'finish-me.md', makeFeatureContent({
        id: 'finish-me',
        status: 'review',
        title: 'Finish Me'
      }))

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

      // File should now be in done/ subfolder
      expect(fs.existsSync(path.join(tempDir, 'finish-me.md'))).toBe(false)
      expect(fs.existsSync(path.join(tempDir, 'done', 'finish-me.md'))).toBe(true)
    })

    it('should move file out of done/ when status changes from done', async () => {
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

      // File should be back in root
      expect(fs.existsSync(path.join(tempDir, 'done', 'reopen-me.md'))).toBe(false)
      expect(fs.existsSync(path.join(tempDir, 'reopen-me.md'))).toBe(true)
    })

    it('should compute correct fractional order between neighbors', async () => {
      writeFeatureFile(tempDir, 'feat-a.md', makeFeatureContent({
        id: 'feat-a',
        status: 'todo',
        order: 'a0'
      }))
      writeFeatureFile(tempDir, 'feat-c.md', makeFeatureContent({
        id: 'feat-c',
        status: 'todo',
        order: 'a2'
      }))
      writeFeatureFile(tempDir, 'feat-move.md', makeFeatureContent({
        id: 'feat-move',
        status: 'backlog',
        order: 'a0'
      }))

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
      expect(todoFeatures[1].order > todoFeatures[0].order).toBe(true)
      expect(todoFeatures[1].order < todoFeatures[2].order).toBe(true)
    })
  })

  // ── Delete Feature ──

  describe('deleteFeature', () => {
    it('should delete feature file from disk', async () => {
      writeFeatureFile(tempDir, 'delete-me.md', makeFeatureContent({
        id: 'delete-me',
        title: 'Delete Me'
      }))

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
      expect(fs.existsSync(path.join(tempDir, 'delete-me.md'))).toBe(false)
    })

    it('should only delete the targeted feature', async () => {
      writeFeatureFile(tempDir, 'keep-me.md', makeFeatureContent({ id: 'keep-me' }))
      writeFeatureFile(tempDir, 'remove-me.md', makeFeatureContent({ id: 'remove-me' }))

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
      expect(fs.existsSync(path.join(tempDir, 'keep-me.md'))).toBe(true)
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
      }))

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
      const fileContent = fs.readFileSync(path.join(tempDir, 'update-me.md'), 'utf-8')
      expect(fileContent).toContain('priority: "critical"')
      expect(fileContent).toContain('assignee: "alice"')
      expect(fileContent).toContain('labels: ["urgent"]')
    })

    it('should set completedAt when status changes to done', async () => {
      writeFeatureFile(tempDir, 'complete-me.md', makeFeatureContent({
        id: 'complete-me',
        status: 'review'
      }))

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
      }))

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
      }))

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

      // Verify on disk
      const fileContent = fs.readFileSync(path.join(tempDir, 'save-me.md'), 'utf-8')
      expect(fileContent).toContain('status: "in-progress"')
      expect(fileContent).toContain('# Save Me Updated')
      expect(fileContent).toContain('assignee: "charlie"')
    })

    it('should move file to done/ when saved with done status', async () => {
      writeFeatureFile(tempDir, 'save-done.md', makeFeatureContent({
        id: 'save-done',
        status: 'review',
        title: 'Save Done'
      }))

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

      expect(fs.existsSync(path.join(tempDir, 'save-done.md'))).toBe(false)
      expect(fs.existsSync(path.join(tempDir, 'done', 'save-done.md'))).toBe(true)
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
      }))

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
      }))

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
      }))

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
      }))

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
      }))
      writeFeatureFile(tempDir, 'legacy-2.md', makeFeatureContent({
        id: 'legacy-2',
        status: 'backlog',
        order: '1'
      }))

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
      const file1 = fs.readFileSync(path.join(tempDir, 'legacy-1.md'), 'utf-8')
      const file2 = fs.readFileSync(path.join(tempDir, 'legacy-2.md'), 'utf-8')
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

  describe('done/non-done reconciliation', () => {
    it('should move root file with status:done to done/ subfolder', async () => {
      // Place a done-status file in root (mismatched)
      writeFeatureFile(tempDir, 'misplaced-done.md', makeFeatureContent({
        id: 'misplaced-done',
        status: 'done',
        title: 'Misplaced Done'
      }))

      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')

      // After load, file should have been moved to done/
      expect(fs.existsSync(path.join(tempDir, 'misplaced-done.md'))).toBe(false)
      expect(fs.existsSync(path.join(tempDir, 'done', 'misplaced-done.md'))).toBe(true)
    })

    it('should move done/ file with non-done status to root', async () => {
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

      // After load, file should have been moved to root
      expect(fs.existsSync(path.join(tempDir, 'done', 'misplaced-active.md'))).toBe(false)
      expect(fs.existsSync(path.join(tempDir, 'misplaced-active.md'))).toBe(true)
    })
  })

  // ── Parsing edge cases ──

  describe('parsing edge cases', () => {
    it('should skip non-markdown files', async () => {
      writeFeatureFile(tempDir, 'not-a-feature.txt', 'just some text')
      writeFeatureFile(tempDir, 'real-feature.md', makeFeatureContent({
        id: 'real-feature',
        title: 'Real Feature'
      }))

      server = startServer(tempDir, port, webviewDir)
      await sleep(200)
      ws = await connectWs(port)

      const response = await sendAndReceive(ws, { type: 'ready' }, 'init')
      const features = response.features as Array<Record<string, unknown>>
      expect(features.length).toBe(1)
      expect(features[0].id).toBe('real-feature')
    })

    it('should skip files without valid frontmatter', async () => {
      writeFeatureFile(tempDir, 'no-frontmatter.md', '# Just a heading\n\nNo frontmatter here.')
      writeFeatureFile(tempDir, 'valid.md', makeFeatureContent({
        id: 'valid',
        title: 'Valid Feature'
      }))

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

      writeFeatureFile(tempDir, 'crlf-feature.md', content)

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

      // Verify file on disk
      const settingsFile = path.join(tempDir, '.kanban-settings.json')
      expect(fs.existsSync(settingsFile)).toBe(true)
      const persisted = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'))
      expect(persisted.compactMode).toBe(true)
      expect(persisted.showLabels).toBe(false)
    })

    it('should load persisted settings on server restart', async () => {
      // Write settings file before starting server
      fs.mkdirSync(tempDir, { recursive: true })
      fs.writeFileSync(
        path.join(tempDir, '.kanban-settings.json'),
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
})
