/**
 * Standalone webhook behavior tests — validated through KanbanSDK (the supported API boundary).
 *
 * These tests use the built-in-fallback path (options.storage injected) so they exercise
 * the webhook shim functions through the correct SDK seam rather than importing legacy
 * helper internals directly. End-to-end provider-backed delegation and the single-delivery
 * guarantee are tested in src/sdk/__tests__/webhook-delegation.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import { KanbanSDK } from '../../sdk/KanbanSDK'
import { MarkdownStorageEngine } from '../../sdk/plugins/markdown'

function createTempWorkspace(): { workspaceDir: string; kanbanDir: string; cleanup: () => void } {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-standalone-webhooks-test-'))
  const kanbanDir = path.join(workspaceDir, '.kanban')
  fs.mkdirSync(kanbanDir, { recursive: true })
  fs.writeFileSync(
    path.join(workspaceDir, '.kanban.json'),
    JSON.stringify(
      {
        version: 2,
        boards: {
          default: {
            name: 'Default',
            columns: [],
            nextCardId: 1,
            defaultStatus: 'backlog',
            defaultPriority: 'medium',
          },
        },
        defaultBoard: 'default',
        kanbanDirectory: '.kanban',
        aiAgent: 'claude',
        defaultPriority: 'medium',
        defaultStatus: 'backlog',
        nextCardId: 1,
        showPriorityBadges: true,
        showAssignee: true,
        showDueDate: true,
        showLabels: true,
        showBuildWithAI: true,
        showFileName: false,
        compactMode: false,
        markdownEditorMode: false,
        showDeletedColumn: false,
        boardZoom: 100,
        cardZoom: 100,
        port: 2954,
      },
      null,
      2,
    ) + '\n',
    'utf-8',
  )
  return {
    workspaceDir,
    kanbanDir,
    cleanup: () => fs.rmSync(workspaceDir, { recursive: true, force: true }),
  }
}

/** Creates an SDK instance in built-in-fallback mode (no external provider resolution). */
function createSDK(kanbanDir: string): KanbanSDK {
  return new KanbanSDK(kanbanDir, { storage: new MarkdownStorageEngine(kanbanDir) })
}

// ---------------------------------------------------------------------------
// CRUD tests — exercised through KanbanSDK public methods
// ---------------------------------------------------------------------------

describe('Webhook CRUD via KanbanSDK (built-in fallback path)', () => {
  let workspaceDir: string
  let kanbanDir: string
  let cleanup: () => void
  let sdk: KanbanSDK

  beforeEach(() => {
    ;({ workspaceDir, kanbanDir, cleanup } = createTempWorkspace())
    sdk = createSDK(kanbanDir)
  })

  afterEach(() => {
    sdk.destroy()
    cleanup()
  })

  // ── listWebhooks ──

  describe('listWebhooks', () => {
    it('returns empty array when no webhooks are registered', () => {
      expect(sdk.listWebhooks()).toEqual([])
    })

    it('returns webhooks persisted in .kanban.json written outside the SDK session', () => {
      const configPath = path.join(workspaceDir, '.kanban.json')
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>
      config.webhooks = [
        { id: 'wh_test1', url: 'https://example.com/hook1', events: ['*'], active: true },
        { id: 'wh_test2', url: 'https://example.com/hook2', events: ['task.created'], secret: 'mysecret', active: true },
      ]
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')

      const sdk2 = createSDK(kanbanDir)
      try {
        const webhooks = sdk2.listWebhooks()
        expect(webhooks).toHaveLength(2)
        expect(webhooks[0].id).toBe('wh_test1')
        expect(webhooks[1].secret).toBe('mysecret')
      } finally {
        sdk2.destroy()
      }
    })
  })

  // ── createWebhook ──

  describe('createWebhook', () => {
    it('creates a webhook with a generated ID', async () => {
      const wh = await sdk.createWebhook({ url: 'https://example.com/hook', events: ['task.created', 'task.moved'] })
      expect(wh.id).toMatch(/^wh_[0-9a-f]+$/)
      expect(wh.url).toBe('https://example.com/hook')
      expect(wh.events).toEqual(['task.created', 'task.moved'])
      expect(wh.active).toBe(true)
      expect(wh.secret).toBeUndefined()
    })

    it('stores the optional secret', async () => {
      const wh = await sdk.createWebhook({ url: 'https://example.com/hook', events: ['*'], secret: 'my-secret-key' })
      expect(wh.secret).toBe('my-secret-key')
    })

    it('persists the webhook so it appears in listWebhooks', async () => {
      await sdk.createWebhook({ url: 'https://example.com/hook', events: ['*'] })
      expect(sdk.listWebhooks()).toHaveLength(1)
    })

    it('appends to existing webhooks', async () => {
      await sdk.createWebhook({ url: 'https://one.com', events: ['*'] })
      await sdk.createWebhook({ url: 'https://two.com', events: ['*'] })
      expect(sdk.listWebhooks()).toHaveLength(2)
    })
  })

  // ── deleteWebhook ──

  describe('deleteWebhook', () => {
    it('removes a webhook by ID and returns true', async () => {
      const wh = await sdk.createWebhook({ url: 'https://example.com/hook', events: ['*'] })
      expect(await sdk.deleteWebhook(wh.id)).toBe(true)
      expect(sdk.listWebhooks()).toHaveLength(0)
    })

    it('returns false for a non-existent ID', async () => {
      expect(await sdk.deleteWebhook('wh_nonexistent')).toBe(false)
    })

    it('removes only the targeted webhook', async () => {
      const wh1 = await sdk.createWebhook({ url: 'https://one.com', events: ['*'] })
      await sdk.createWebhook({ url: 'https://two.com', events: ['*'] })
      await sdk.deleteWebhook(wh1.id)
      const remaining = sdk.listWebhooks()
      expect(remaining).toHaveLength(1)
      expect(remaining[0].url).toBe('https://two.com')
    })
  })

  // ── updateWebhook ──

  describe('updateWebhook', () => {
    it('updates the URL of an existing webhook', async () => {
      const wh = await sdk.createWebhook({ url: 'https://old.com', events: ['*'] })
      const updated = await sdk.updateWebhook(wh.id, { url: 'https://new.com' })
      expect(updated).not.toBeNull()
      expect(updated!.url).toBe('https://new.com')
    })

    it('returns null for a non-existent ID', async () => {
      expect(await sdk.updateWebhook('wh_nonexistent', { url: 'https://new.com' })).toBeNull()
    })

    it('can deactivate a webhook via updateWebhook', async () => {
      const wh = await sdk.createWebhook({ url: 'https://example.com', events: ['*'] })
      const updated = await sdk.updateWebhook(wh.id, { active: false })
      expect(updated!.active).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// Event-driven delivery through the built-in webhook listener
// (SDK mutation path → EventBus → WebhookListenerPlugin → HTTP POST)
// ---------------------------------------------------------------------------

describe('Webhook delivery via built-in listener (built-in fallback path)', () => {
  it('POSTs to a matching webhook when an SDK mutation fires a matching event', async () => {
    const received: Array<{ event: string; data: unknown }> = []
    const server = http.createServer((req, res) => {
      if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
      let body = ''
      req.on('data', chunk => { body += String(chunk) })
      req.on('end', () => {
        try { received.push(JSON.parse(body) as { event: string; data: unknown }) } catch { /* ignore */ }
        res.writeHead(200); res.end()
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
    const port = (server.address() as net.AddressInfo).port

    const { workspaceDir, kanbanDir, cleanup } = createTempWorkspace()
    const configPath = path.join(workspaceDir, '.kanban.json')
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>
    config.webhooks = [
      { id: 'wh_delivery', url: `http://127.0.0.1:${port}/hook`, events: ['task.created'], active: true },
    ]
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')

    try {
      const sdk = new KanbanSDK(kanbanDir, { storage: new MarkdownStorageEngine(kanbanDir) })
      await sdk.createCard({ content: '# Delivery regression\n\nTest body.' })
      await new Promise(resolve => setTimeout(resolve, 400))
      expect(received).toHaveLength(1)
      expect(received[0].event).toBe('task.created')
      expect(received[0].data).toBeDefined()
      sdk.destroy()
    } finally {
      cleanup()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })

  it('does not POST to inactive webhooks', async () => {
    let called = false
    const server = http.createServer((_req, res) => { called = true; res.writeHead(200); res.end() })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
    const port = (server.address() as net.AddressInfo).port

    const { workspaceDir, kanbanDir, cleanup } = createTempWorkspace()
    const configPath = path.join(workspaceDir, '.kanban.json')
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>
    config.webhooks = [
      { id: 'wh_inactive', url: `http://127.0.0.1:${port}/hook`, events: ['*'], active: false },
    ]
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')

    try {
      const sdk = new KanbanSDK(kanbanDir, { storage: new MarkdownStorageEngine(kanbanDir) })
      await sdk.createCard({ content: '# Inactive webhook test.' })
      await new Promise(resolve => setTimeout(resolve, 300))
      expect(called).toBe(false)
      sdk.destroy()
    } finally {
      cleanup()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })

  it('does not POST when event does not match the webhook event filter', async () => {
    let called = false
    const server = http.createServer((_req, res) => { called = true; res.writeHead(200); res.end() })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
    const port = (server.address() as net.AddressInfo).port

    const { workspaceDir, kanbanDir, cleanup } = createTempWorkspace()
    const configPath = path.join(workspaceDir, '.kanban.json')
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>
    // Webhook only listens for column.created; createCard emits task.created
    config.webhooks = [
      { id: 'wh_filtered', url: `http://127.0.0.1:${port}/hook`, events: ['column.created'], active: true },
    ]
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')

    try {
      const sdk = new KanbanSDK(kanbanDir, { storage: new MarkdownStorageEngine(kanbanDir) })
      await sdk.createCard({ content: '# Event filter test.' })
      await new Promise(resolve => setTimeout(resolve, 300))
      expect(called).toBe(false)
      sdk.destroy()
    } finally {
      cleanup()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })

  it('POSTs to wildcard webhooks for any event', async () => {
    let receivedEvent = ''
    const server = http.createServer((req, res) => {
      if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
      let body = ''
      req.on('data', chunk => { body += String(chunk) })
      req.on('end', () => {
        try { receivedEvent = (JSON.parse(body) as { event: string }).event } catch { /* ignore */ }
        res.writeHead(200); res.end()
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
    const port = (server.address() as net.AddressInfo).port

    const { workspaceDir, kanbanDir, cleanup } = createTempWorkspace()
    const configPath = path.join(workspaceDir, '.kanban.json')
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>
    config.webhooks = [
      { id: 'wh_wildcard', url: `http://127.0.0.1:${port}/hook`, events: ['*'], active: true },
    ]
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')

    try {
      const sdk = new KanbanSDK(kanbanDir, { storage: new MarkdownStorageEngine(kanbanDir) })
      await sdk.createCard({ content: '# Wildcard test.' })
      await new Promise(resolve => setTimeout(resolve, 400))
      expect(receivedEvent).toBe('task.created')
      sdk.destroy()
    } finally {
      cleanup()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })

  it('includes HMAC signature header when secret is configured', async () => {
    let receivedHeaders: http.IncomingHttpHeaders = {}
    let receivedBody = ''
    const server = http.createServer((req, res) => {
      if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
      let body = ''
      req.on('data', chunk => { body += String(chunk) })
      req.on('end', () => {
        receivedHeaders = req.headers
        receivedBody = body
        res.writeHead(200); res.end()
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
    const port = (server.address() as net.AddressInfo).port

    const { workspaceDir, kanbanDir, cleanup } = createTempWorkspace()
    const configPath = path.join(workspaceDir, '.kanban.json')
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>
    config.webhooks = [
      { id: 'wh_signed', url: `http://127.0.0.1:${port}/hook`, events: ['*'], active: true, secret: 'test-secret' },
    ]
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')

    try {
      const sdk = new KanbanSDK(kanbanDir, { storage: new MarkdownStorageEngine(kanbanDir) })
      await sdk.createCard({ content: '# HMAC signature test.' })
      await new Promise(resolve => setTimeout(resolve, 500))

      const signature = receivedHeaders['x-webhook-signature'] as string
      expect(signature).toBeDefined()
      expect(signature).toMatch(/^sha256=[0-9a-f]+$/)

      const crypto = await import('node:crypto')
      const expected = crypto.createHmac('sha256', 'test-secret').update(receivedBody).digest('hex')
      expect(signature).toBe(`sha256=${expected}`)

      sdk.destroy()
    } finally {
      cleanup()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })

  it('handles delivery failure gracefully (does not reject the SDK mutation)', async () => {
    const { workspaceDir, kanbanDir, cleanup } = createTempWorkspace()
    const configPath = path.join(workspaceDir, '.kanban.json')
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>
    config.webhooks = [
      { id: 'wh_unreachable', url: 'http://127.0.0.1:1/hook', events: ['*'], active: true },
    ]
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')

    try {
      const sdk = new KanbanSDK(kanbanDir, { storage: new MarkdownStorageEngine(kanbanDir) })
      await expect(
        sdk.createCard({ content: '# Unreachable endpoint test.' })
      ).resolves.not.toThrow()
      sdk.destroy()
    } finally {
      cleanup()
    }
  })
})
