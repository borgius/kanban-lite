import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webhookProviderPlugin, type Webhook } from './index'

const CONFIG_FILE = '.kanban.json'

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kl-webhooks-plugin-test-'))
}

function readConfig(workspaceRoot: string): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(path.join(workspaceRoot, CONFIG_FILE), 'utf-8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

function writeConfig(workspaceRoot: string, config: Record<string, unknown>): void {
  fs.writeFileSync(path.join(workspaceRoot, CONFIG_FILE), JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

describe('webhookProviderPlugin manifest', () => {
  it('has id "webhooks" and provides webhook.delivery', () => {
    expect(webhookProviderPlugin.manifest.id).toBe('webhooks')
    expect(webhookProviderPlugin.manifest.provides).toContain('webhook.delivery')
  })
})

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

describe('webhookProviderPlugin CRUD', () => {
  let workspaceDir: string

  beforeEach(() => {
    workspaceDir = createTempDir()
  })

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('listWebhooks returns empty array when no webhooks exist', () => {
    expect(webhookProviderPlugin.listWebhooks(workspaceDir)).toEqual([])
  })

  it('listWebhooks returns empty array when config has no webhooks key', () => {
    writeConfig(workspaceDir, { defaultBoard: 'main' })
    expect(webhookProviderPlugin.listWebhooks(workspaceDir)).toEqual([])
  })

  it('listWebhooks returns webhooks from existing config', () => {
    writeConfig(workspaceDir, {
      webhooks: [{ id: 'wh_abc', url: 'http://example.com', events: ['*'], active: true }],
    })
    const result = webhookProviderPlugin.listWebhooks(workspaceDir)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('wh_abc')
  })

  it('createWebhook adds a webhook with generated id and active=true', () => {
    const wh = webhookProviderPlugin.createWebhook(workspaceDir, {
      url: 'http://example.com/hook',
      events: ['task.created'],
    })
    expect(wh.id).toMatch(/^wh_[0-9a-f]{12}$/)
    expect(wh.url).toBe('http://example.com/hook')
    expect(wh.events).toEqual(['task.created'])
    expect(wh.active).toBe(true)
    expect(wh.secret).toBeUndefined()
  })

  it('createWebhook persists the webhook to config', () => {
    const wh = webhookProviderPlugin.createWebhook(workspaceDir, {
      url: 'http://example.com/hook',
      events: ['*'],
    })
    const config = readConfig(workspaceDir)
    const persisted = config.webhooks as Webhook[]
    expect(persisted).toHaveLength(1)
    expect(persisted[0].id).toBe(wh.id)
  })

  it('createWebhook persists optional secret', () => {
    const wh = webhookProviderPlugin.createWebhook(workspaceDir, {
      url: 'http://example.com/hook',
      events: ['*'],
      secret: 'mysecret',
    })
    expect(wh.secret).toBe('mysecret')
    const config = readConfig(workspaceDir)
    const persisted = config.webhooks as Webhook[]
    expect(persisted[0].secret).toBe('mysecret')
  })

  it('createWebhook appends to existing webhooks', () => {
    webhookProviderPlugin.createWebhook(workspaceDir, { url: 'http://a.com', events: ['*'] })
    webhookProviderPlugin.createWebhook(workspaceDir, { url: 'http://b.com', events: ['task.created'] })
    expect(webhookProviderPlugin.listWebhooks(workspaceDir)).toHaveLength(2)
  })

  it('createWebhook preserves other config fields', () => {
    writeConfig(workspaceDir, { defaultBoard: 'main', nextCardId: 42 })
    webhookProviderPlugin.createWebhook(workspaceDir, { url: 'http://example.com', events: ['*'] })
    const config = readConfig(workspaceDir)
    expect(config.defaultBoard).toBe('main')
    expect(config.nextCardId).toBe(42)
    expect((config.webhooks as Webhook[])).toHaveLength(1)
  })

  it('updateWebhook updates fields and returns updated webhook', () => {
    const wh = webhookProviderPlugin.createWebhook(workspaceDir, {
      url: 'http://example.com',
      events: ['*'],
    })
    const updated = webhookProviderPlugin.updateWebhook(workspaceDir, wh.id, {
      url: 'http://new.example.com',
      active: false,
    })
    expect(updated).not.toBeNull()
    expect(updated!.url).toBe('http://new.example.com')
    expect(updated!.active).toBe(false)
    expect(updated!.events).toEqual(['*'])
  })

  it('updateWebhook persists changes', () => {
    const wh = webhookProviderPlugin.createWebhook(workspaceDir, {
      url: 'http://example.com',
      events: ['*'],
    })
    webhookProviderPlugin.updateWebhook(workspaceDir, wh.id, { active: false })
    const config = readConfig(workspaceDir)
    expect((config.webhooks as Webhook[])[0].active).toBe(false)
  })

  it('updateWebhook returns null for non-existent id', () => {
    const result = webhookProviderPlugin.updateWebhook(workspaceDir, 'wh_nonexistent', { active: false })
    expect(result).toBeNull()
  })

  it('deleteWebhook removes the webhook and returns true', () => {
    const wh = webhookProviderPlugin.createWebhook(workspaceDir, {
      url: 'http://example.com',
      events: ['*'],
    })
    expect(webhookProviderPlugin.deleteWebhook(workspaceDir, wh.id)).toBe(true)
    expect(webhookProviderPlugin.listWebhooks(workspaceDir)).toHaveLength(0)
  })

  it('deleteWebhook persists removal', () => {
    const wh = webhookProviderPlugin.createWebhook(workspaceDir, {
      url: 'http://example.com',
      events: ['*'],
    })
    webhookProviderPlugin.deleteWebhook(workspaceDir, wh.id)
    const config = readConfig(workspaceDir)
    expect((config.webhooks as Webhook[])).toHaveLength(0)
  })

  it('deleteWebhook returns false for non-existent id', () => {
    expect(webhookProviderPlugin.deleteWebhook(workspaceDir, 'wh_nonexistent')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Listener lifecycle
// ---------------------------------------------------------------------------

describe('webhookProviderPlugin createListener', () => {
  let workspaceDir: string

  beforeEach(() => {
    workspaceDir = createTempDir()
  })

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('returns listener with correct manifest', () => {
    const listener = webhookProviderPlugin.createListener(workspaceDir)
    expect(listener.manifest.id).toBe('webhooks')
    expect(listener.manifest.provides).toContain('webhook.delivery')
  })

  it('init calls bus.onAny to subscribe', () => {
    const mockBus = { onAny: vi.fn().mockReturnValue(() => {}) }
    const listener = webhookProviderPlugin.createListener(workspaceDir)
    listener.init(mockBus as never, workspaceDir)
    expect(mockBus.onAny).toHaveBeenCalledOnce()
  })

  it('destroy calls the unsubscribe function returned by onAny', () => {
    const unsubscribeSpy = vi.fn()
    const mockBus = { onAny: vi.fn().mockReturnValue(unsubscribeSpy) }
    const listener = webhookProviderPlugin.createListener(workspaceDir)
    listener.init(mockBus as never, workspaceDir)
    listener.destroy()
    expect(unsubscribeSpy).toHaveBeenCalledOnce()
  })

  it('destroy is safe to call before init', () => {
    const listener = webhookProviderPlugin.createListener(workspaceDir)
    expect(() => listener.destroy()).not.toThrow()
  })

  it('destroy is idempotent', () => {
    const unsubscribeSpy = vi.fn()
    const mockBus = { onAny: vi.fn().mockReturnValue(unsubscribeSpy) }
    const listener = webhookProviderPlugin.createListener(workspaceDir)
    listener.init(mockBus as never, workspaceDir)
    listener.destroy()
    listener.destroy()
    expect(unsubscribeSpy).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// Delivery – event filtering
// ---------------------------------------------------------------------------

describe('delivery event filtering', () => {
  let workspaceDir: string

  beforeEach(() => {
    workspaceDir = createTempDir()
  })

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('does not attempt delivery when no webhooks match the event', async () => {
    // Register a webhook subscribed only to 'task.created'
    webhookProviderPlugin.createWebhook(workspaceDir, {
      url: 'http://127.0.0.1:1/unreachable',
      events: ['task.created'],
    })

    let capturedHandler: ((event: string, payload: { data: unknown }) => void) | undefined
    const mockBus = {
      onAny: vi.fn().mockImplementation((h: (event: string, payload: { data: unknown }) => void) => {
        capturedHandler = h
        return () => {}
      }),
    }
    const errors: string[] = []
    const origError = console.error
    console.error = (...args: unknown[]) => errors.push(String(args[0]))

    const listener = webhookProviderPlugin.createListener(workspaceDir)
    listener.init(mockBus as never, workspaceDir)

    // Fire a non-matching event
    capturedHandler!('task.deleted', { data: {} })
    await new Promise((r) => setTimeout(r, 100))

    console.error = origError
    listener.destroy()

    expect(errors.filter((e) => e.includes('[kl-webhooks-plugin]'))).toHaveLength(0)
  })

  it('skips inactive webhooks', async () => {
    const wh = webhookProviderPlugin.createWebhook(workspaceDir, {
      url: 'http://127.0.0.1:1/unreachable',
      events: ['*'],
    })
    webhookProviderPlugin.updateWebhook(workspaceDir, wh.id, { active: false })

    let capturedHandler: ((event: string, payload: { data: unknown }) => void) | undefined
    const mockBus = {
      onAny: vi.fn().mockImplementation((h: (event: string, payload: { data: unknown }) => void) => {
        capturedHandler = h
        return () => {}
      }),
    }
    const errors: string[] = []
    const origError = console.error
    console.error = (...args: unknown[]) => errors.push(String(args[0]))

    const listener = webhookProviderPlugin.createListener(workspaceDir)
    listener.init(mockBus as never, workspaceDir)
    capturedHandler!('task.created', { data: {} })
    await new Promise((r) => setTimeout(r, 100))

    console.error = origError
    listener.destroy()

    expect(errors.filter((e) => e.includes('[kl-webhooks-plugin]'))).toHaveLength(0)
  })

  it('swallows delivery errors without throwing', async () => {
    // Register a webhook pointing to a port guaranteed to refuse connections.
    webhookProviderPlugin.createWebhook(workspaceDir, {
      url: 'http://127.0.0.1:1/hook', // port 1 is always refused
      events: ['*'],
    })

    let capturedHandler: ((event: string, payload: { data: unknown }) => void) | undefined
    const mockBus = {
      onAny: vi.fn().mockImplementation((h: (event: string, payload: { data: unknown }) => void) => {
        capturedHandler = h
        return () => {}
      }),
    }
    const errors: string[] = []
    const origError = console.error
    console.error = (...args: unknown[]) => errors.push(String(args[0]))

    const listener = webhookProviderPlugin.createListener(workspaceDir)
    listener.init(mockBus as never, workspaceDir)

    // Should not throw even though delivery will fail
    expect(() => capturedHandler!('task.created', { data: {} })).not.toThrow()
    await new Promise((r) => setTimeout(r, 500))

    console.error = origError
    listener.destroy()

    // Error must be logged, not thrown
    const deliveryErrors = errors.filter((e) => e.includes('[kl-webhooks-plugin]'))
    expect(deliveryErrors.length).toBeGreaterThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// Delivery – HMAC signing
// ---------------------------------------------------------------------------

describe('HMAC signing', () => {
  let workspaceDir: string

  beforeEach(() => {
    workspaceDir = createTempDir()
  })

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('sends X-Webhook-Signature header with correct sha256 HMAC', async () => {
    const secret = 'test-secret-key'
    let receivedHeaders: Record<string, string | string[] | undefined> = {}
    let receivedBody = ''

    const server = http.createServer((req, res) => {
      let body = ''
      req.on('data', (chunk: Buffer) => { body += chunk.toString() })
      req.on('end', () => {
        receivedHeaders = { ...req.headers }
        receivedBody = body
        res.writeHead(200)
        res.end()
      })
    })

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port

    webhookProviderPlugin.createWebhook(workspaceDir, {
      url: `http://127.0.0.1:${port}/hook`,
      events: ['*'],
      secret,
    })

    let capturedHandler: ((event: string, payload: { data: unknown }) => void) | undefined
    const mockBus = {
      onAny: vi.fn().mockImplementation((h: (event: string, payload: { data: unknown }) => void) => {
        capturedHandler = h
        return () => {}
      }),
    }

    const listener = webhookProviderPlugin.createListener(workspaceDir)
    listener.init(mockBus as never, workspaceDir)
    capturedHandler!('task.created', { data: { id: 'card-1' } })

    // Wait for delivery
    await new Promise((r) => setTimeout(r, 500))
    await new Promise<void>((resolve) => server.close(() => resolve()))
    listener.destroy()

    const expectedSig = 'sha256=' + crypto.createHmac('sha256', secret).update(receivedBody).digest('hex')
    expect(receivedHeaders['x-webhook-signature']).toBe(expectedSig)
    expect(receivedHeaders['x-webhook-event']).toBe('task.created')
  })

  it('omits X-Webhook-Signature header when no secret is set', async () => {
    let receivedHeaders: Record<string, string | string[] | undefined> = {}

    const server = http.createServer((req, res) => {
      receivedHeaders = { ...req.headers }
      res.writeHead(200)
      res.end()
    })

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port

    webhookProviderPlugin.createWebhook(workspaceDir, {
      url: `http://127.0.0.1:${port}/hook`,
      events: ['*'],
    })

    let capturedHandler: ((event: string, payload: { data: unknown }) => void) | undefined
    const mockBus = {
      onAny: vi.fn().mockImplementation((h: (event: string, payload: { data: unknown }) => void) => {
        capturedHandler = h
        return () => {}
      }),
    }

    const listener = webhookProviderPlugin.createListener(workspaceDir)
    listener.init(mockBus as never, workspaceDir)
    capturedHandler!('task.updated', { data: {} })

    await new Promise((r) => setTimeout(r, 500))
    await new Promise<void>((resolve) => server.close(() => resolve()))
    listener.destroy()

    expect(receivedHeaders['x-webhook-signature']).toBeUndefined()
    expect(receivedHeaders['x-webhook-event']).toBe('task.updated')
  })

  it('sends correct payload envelope structure', async () => {
    let receivedBody = ''

    const server = http.createServer((req, res) => {
      let body = ''
      req.on('data', (chunk: Buffer) => { body += chunk.toString() })
      req.on('end', () => {
        receivedBody = body
        res.writeHead(200)
        res.end()
      })
    })

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port

    webhookProviderPlugin.createWebhook(workspaceDir, {
      url: `http://127.0.0.1:${port}/hook`,
      events: ['task.created'],
    })

    let capturedHandler: ((event: string, payload: { data: unknown }) => void) | undefined
    const mockBus = {
      onAny: vi.fn().mockImplementation((h: (event: string, payload: { data: unknown }) => void) => {
        capturedHandler = h
        return () => {}
      }),
    }

    const listener = webhookProviderPlugin.createListener(workspaceDir)
    listener.init(mockBus as never, workspaceDir)
    capturedHandler!('task.created', { data: { id: 'card-1', status: 'backlog' } })

    await new Promise((r) => setTimeout(r, 500))
    await new Promise<void>((resolve) => server.close(() => resolve()))
    listener.destroy()

    const parsed = JSON.parse(receivedBody) as { event: string; timestamp: string; data: unknown }
    expect(parsed.event).toBe('task.created')
    expect(typeof parsed.timestamp).toBe('string')
    expect(parsed.data).toEqual({ id: 'card-1', status: 'backlog' })
  })
})
