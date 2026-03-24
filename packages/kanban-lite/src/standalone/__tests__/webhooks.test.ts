/**
 * Standalone webhook behavior tests — validated through KanbanSDK (the supported API boundary).
 *
 * These tests use the built-in-fallback path (options.storage injected) so they exercise
 * the webhook shim functions through the correct SDK seam rather than importing legacy
 * helper internals directly. End-to-end provider-backed delegation and the single-delivery
 * guarantee are tested in src/sdk/__tests__/webhook-delegation.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import { KanbanSDK } from '../../sdk/KanbanSDK'
import { MarkdownStorageEngine } from '../../sdk/plugins/markdown'
import { startServer } from '../server'

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

async function getAvailablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to determine an available port')))
        return
      }
      const { port } = address
      server.close((err) => {
        if (err) reject(err)
        else resolve(port)
      })
    })
    server.on('error', reject)
  })
}

type HttpResponse = {
  status: number
  headers: http.IncomingHttpHeaders
  body: string
}

async function httpRequest(
  method: string,
  urlString: string,
  body?: Record<string, unknown>,
): Promise<HttpResponse> {
  const url = new URL(urlString)
  const payload = body === undefined ? undefined : JSON.stringify(body)

  return await new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: payload
          ? {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload).toString(),
          }
          : undefined,
      },
      (res) => {
        let responseBody = ''
        res.setEncoding('utf-8')
        res.on('data', (chunk) => { responseBody += chunk })
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: responseBody,
          })
        })
      },
    )

    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

function enableStandaloneWebhookPlugin(workspaceDir: string): void {
  const configPath = path.join(workspaceDir, '.kanban.json')
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>
  config.webhookPlugin = {
    'webhook.delivery': { provider: 'webhooks' },
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
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

describe('Standalone webhook routes via plugin-owned path', () => {
  let workspaceDir: string
  let kanbanDir: string
  let cleanup: () => void
  let server: http.Server
  let port: number

  beforeAll(async () => {
    ;({ workspaceDir, kanbanDir, cleanup } = createTempWorkspace())
    enableStandaloneWebhookPlugin(workspaceDir)
    port = await getAvailablePort()
    server = startServer(kanbanDir, port)
    await waitFor(() => {
      const address = server.address()
      return !!address && typeof address !== 'string'
    })
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    cleanup()
  })

  it('preserves /api/webhooks CRUD behavior when only the webhook plugin config is present', async () => {
    const createRes = await httpRequest('POST', `http://127.0.0.1:${port}/api/webhooks`, {
      url: 'https://example.com/hook',
      events: ['task.created'],
      secret: 'signing-secret',
    })
    expect(createRes.status).toBe(201)
    const created = JSON.parse(createRes.body) as { ok: boolean; data: { id: string; url: string; events: string[]; secret?: string } }
    expect(created.ok).toBe(true)
    expect(created.data.url).toBe('https://example.com/hook')
    expect(created.data.events).toEqual(['task.created'])
    expect(created.data.id).toMatch(/^wh_/)

    const listRes = await httpRequest('GET', `http://127.0.0.1:${port}/api/webhooks`)
    expect(listRes.status).toBe(200)
    const listed = JSON.parse(listRes.body) as { ok: boolean; data: Array<{ id: string }> }
    expect(listed.ok).toBe(true)
    expect(listed.data).toHaveLength(1)
    expect(listed.data[0]?.id).toBe(created.data.id)

    const updateRes = await httpRequest('PUT', `http://127.0.0.1:${port}/api/webhooks/${created.data.id}`, {
      active: false,
      events: ['task.updated'],
    })
    expect(updateRes.status).toBe(200)
    const updated = JSON.parse(updateRes.body) as { ok: boolean; data: { active: boolean; events: string[] } }
    expect(updated.ok).toBe(true)
    expect(updated.data.active).toBe(false)
    expect(updated.data.events).toEqual(['task.updated'])

    const deleteRes = await httpRequest('DELETE', `http://127.0.0.1:${port}/api/webhooks/${created.data.id}`)
    expect(deleteRes.status).toBe(200)

    const finalListRes = await httpRequest('GET', `http://127.0.0.1:${port}/api/webhooks`)
    const finalList = JSON.parse(finalListRes.body) as { ok: boolean; data: unknown[] }
    expect(finalList.ok).toBe(true)
    expect(finalList.data).toEqual([])
  })

  it('publishes /api/webhooks in the standalone OpenAPI spec when the webhook plugin is active', async () => {
    const docsRes = await httpRequest('GET', `http://127.0.0.1:${port}/api/docs/json`)
    expect(docsRes.status).toBe(200)

    const spec = JSON.parse(docsRes.body) as {
      tags?: Array<{ name: string }>
      paths: Record<string, Record<string, unknown>>
    }

    expect(spec.tags?.some((tag) => tag.name === 'Webhooks')).toBe(true)
    expect(spec.paths['/api/webhooks']).toBeTruthy()
    expect(spec.paths['/api/webhooks/{id}']).toBeTruthy()
    expect(Object.keys(spec.paths['/api/webhooks'] ?? {}).sort()).toEqual(['get', 'post'])
    expect(Object.keys(spec.paths['/api/webhooks/{id}'] ?? {}).sort()).toEqual(['delete', 'put'])
  })
})
