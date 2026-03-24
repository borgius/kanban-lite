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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitFor(check: () => boolean, timeoutMs = 1500, intervalMs = 25): Promise<void> {
  const started = Date.now()
  while (!check()) {
    if (Date.now() - started >= timeoutMs) {
      throw new Error(`Condition was not met within ${timeoutMs}ms`)
    }
    await sleep(intervalMs)
  }
}

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

describe('Webhook CRUD via KanbanSDK (no provider — throws deterministic error)', () => {
  let kanbanDir: string
  let cleanup: () => void
  let sdk: KanbanSDK

  beforeEach(() => {
    ;({ kanbanDir, cleanup } = createTempWorkspace())
    sdk = createSDK(kanbanDir)
  })

  afterEach(() => {
    sdk.destroy()
    cleanup()
  })

  const pluginError = /Webhook commands require kl-webhooks-plugin/

  it('listWebhooks throws when no plugin is active', () => {
    expect(() => sdk.listWebhooks()).toThrow(pluginError)
  })

  it('createWebhook throws when no plugin is active', async () => {
    await expect(sdk.createWebhook({ url: 'https://example.com', events: ['*'] })).rejects.toThrow(pluginError)
  })

  it('deleteWebhook throws when no plugin is active', async () => {
    await expect(sdk.deleteWebhook('wh_any')).rejects.toThrow(pluginError)
  })

  it('updateWebhook throws when no plugin is active', async () => {
    await expect(sdk.updateWebhook('wh_any', { url: 'https://new.com' })).rejects.toThrow(pluginError)
  })
})

// ---------------------------------------------------------------------------
// Event-driven delivery through the built-in webhook listener
// (SDK mutation path → EventBus → WebhookListenerPlugin → HTTP POST)
// ---------------------------------------------------------------------------

describe('Webhook delivery via built-in listener (built-in fallback path)', () => {
  it('does NOT POST to a matching webhook when no plugin is active', async () => {
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
      await sdk.createCard({ content: '# No delivery without plugin.' })
      await sleep(400)
      expect(received).toHaveLength(0)
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
      await sleep(300)
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
      await sleep(300)
      expect(called).toBe(false)
      sdk.destroy()
    } finally {
      cleanup()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })

  it('does NOT POST to wildcard webhook when no plugin is active', async () => {
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
      await sleep(400)
      expect(receivedEvent).toBe('')
      sdk.destroy()
    } finally {
      cleanup()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })

  it('does NOT deliver HMAC-signed POST when no plugin is active', async () => {
    let receivedHeaders: http.IncomingHttpHeaders = {}
    const server = http.createServer((req, res) => {
      if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
      let body = ''
      req.on('data', chunk => { body += String(chunk) })
      req.on('end', () => {
        receivedHeaders = req.headers
        void body
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
      await sleep(500)

      expect(receivedHeaders['x-webhook-signature']).toBeUndefined()

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
