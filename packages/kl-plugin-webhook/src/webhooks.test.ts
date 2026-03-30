import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebhookListenerPlugin, cliPlugin, sdkExtensionPlugin, standaloneHttpPlugin, webhookProviderPlugin, type Webhook } from './index'

const CONFIG_FILE = '.kanban.json'

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kl-plugin-webhook-test-'))
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

  it('listWebhooks prefers plugins["webhook.delivery"].options.webhooks when present', () => {
    writeConfig(workspaceDir, {
      webhooks: [{ id: 'wh_top', url: 'http://top.example.com', events: ['*'], active: true }],
      plugins: {
        'webhook.delivery': {
          provider: 'kl-plugin-webhook',
          options: {
            webhooks: [{ id: 'wh_opt', url: 'http://opt.example.com', events: ['task.created'], active: true }],
          },
        },
      },
    })

    const result = webhookProviderPlugin.listWebhooks(workspaceDir)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('wh_opt')
  })

  it('createWebhook adds a webhook with generated id and active=true', () => {
    const wh = webhookProviderPlugin.createWebhook(workspaceDir, {
      url: 'http://example.com/hook',
      events: ['task.created'],
    })
    expect(wh.id).toMatch(/^wh_[0-9a-f]{16}$/)
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

  it('createWebhook also persists into plugins["webhook.delivery"].options.webhooks when plugin config exists', () => {
    writeConfig(workspaceDir, {
      plugins: {
        'webhook.delivery': {
          provider: 'kl-plugin-webhook',
          options: {},
        },
      },
    })

    const created = webhookProviderPlugin.createWebhook(workspaceDir, {
      url: 'http://example.com/hook',
      events: ['*'],
    })

    const config = readConfig(workspaceDir)
    const pluginWebhooks = ((config.plugins as Record<string, unknown>)['webhook.delivery'] as Record<string, unknown>)
      .options as Record<string, unknown>
    const persisted = pluginWebhooks.webhooks as Webhook[]

    expect(Array.isArray(persisted)).toBe(true)
    expect(persisted).toHaveLength(1)
    expect(persisted[0].id).toBe(created.id)
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

describe('WebhookListenerPlugin', () => {
  let workspaceDir: string

  beforeEach(() => {
    workspaceDir = createTempDir()
  })

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('returns listener with correct manifest', () => {
    const listener = new WebhookListenerPlugin(workspaceDir)
    expect(listener.manifest.id).toBe('webhooks')
    expect(listener.manifest.provides).toContain('event.listener')
  })

  it('register calls bus.onAny to subscribe', () => {
    const mockBus = { onAny: vi.fn().mockReturnValue(() => {}) }
    const listener = new WebhookListenerPlugin(workspaceDir)
    listener.register(mockBus as never)
    expect(mockBus.onAny).toHaveBeenCalledOnce()
  })

  it('register is idempotent', () => {
    const mockBus = { onAny: vi.fn().mockReturnValue(() => {}) }
    const listener = new WebhookListenerPlugin(workspaceDir)
    listener.register(mockBus as never)
    listener.register(mockBus as never)
    expect(mockBus.onAny).toHaveBeenCalledOnce()
  })

  it('unregister calls the unsubscribe function returned by onAny', () => {
    const unsubscribeSpy = vi.fn()
    const mockBus = { onAny: vi.fn().mockReturnValue(unsubscribeSpy) }
    const listener = new WebhookListenerPlugin(workspaceDir)
    listener.register(mockBus as never)
    listener.unregister()
    expect(unsubscribeSpy).toHaveBeenCalledOnce()
  })

  it('unregister is safe to call before register', () => {
    const listener = new WebhookListenerPlugin(workspaceDir)
    expect(() => listener.unregister()).not.toThrow()
  })

  it('unregister is idempotent', () => {
    const unsubscribeSpy = vi.fn()
    const mockBus = { onAny: vi.fn().mockReturnValue(unsubscribeSpy) }
    const listener = new WebhookListenerPlugin(workspaceDir)
    listener.register(mockBus as never)
    listener.unregister()
    listener.unregister()
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

  it('does not attempt delivery for before-events even when a matching after-event webhook exists', async () => {
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

    const listener = new WebhookListenerPlugin(workspaceDir)
    listener.register(mockBus as never)

    // Fire the matching before-event name; listener-only contract must ignore it.
    capturedHandler!('task.create', { data: {} })
    await new Promise((r) => setTimeout(r, 100))

    console.error = origError
    listener.unregister()

    expect(errors.filter((e) => e.includes('[kl-plugin-webhook]'))).toHaveLength(0)
  })

  it('delivers a matching after-event exactly once', async () => {
    const received: Array<{ event: string; timestamp: string; data: unknown }> = []
    const server = http.createServer((req, res) => {
      let body = ''
      req.on('data', (chunk: Buffer) => { body += chunk.toString() })
      req.on('end', () => {
        received.push(JSON.parse(body) as { event: string; timestamp: string; data: unknown })
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

    const listener = new WebhookListenerPlugin(workspaceDir)
    listener.register(mockBus as never)

    capturedHandler!('task.create', { data: { ignored: true } })
    capturedHandler!('task.created', {
      data: {
        event: 'task.created',
        timestamp: '2026-03-23T00:00:00.000Z',
        data: { id: 'card-1' },
      },
    })

    await new Promise((r) => setTimeout(r, 300))
    await new Promise<void>((resolve) => server.close(() => resolve()))
    listener.unregister()

    expect(received).toHaveLength(1)
    expect(received[0].event).toBe('task.created')
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

    const listener = new WebhookListenerPlugin(workspaceDir)
    listener.register(mockBus as never)
    capturedHandler!('task.created', {
      data: {
        event: 'task.created',
        timestamp: '2026-03-23T00:00:00.000Z',
        data: {},
      },
    })
    await new Promise((r) => setTimeout(r, 100))

    console.error = origError
    listener.unregister()

    expect(errors.filter((e) => e.includes('[kl-plugin-webhook]'))).toHaveLength(0)
  })

  it('delivers to a webhook subscribed to * for any after-event', async () => {
    const received: string[] = []
    const server = http.createServer((req, res) => {
      let body = ''
      req.on('data', (chunk: Buffer) => { body += chunk.toString() })
      req.on('end', () => {
        received.push((JSON.parse(body) as { event: string }).event)
        res.writeHead(200)
        res.end()
      })
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

    const listener = new WebhookListenerPlugin(workspaceDir)
    listener.register(mockBus as never)

    capturedHandler!('task.created', { data: { id: 'card-1' } })
    capturedHandler!('comment.created', { data: { id: 'comment-1' } })

    await new Promise((r) => setTimeout(r, 300))
    await new Promise<void>((resolve) => server.close(() => resolve()))
    listener.unregister()

    expect(received).toHaveLength(2)
    expect(received).toContain('task.created')
    expect(received).toContain('comment.created')
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

    const listener = new WebhookListenerPlugin(workspaceDir)
    listener.register(mockBus as never)

    // Should not throw even though delivery will fail
    expect(() => capturedHandler!('task.created', {
      data: {
        event: 'task.created',
        timestamp: '2026-03-23T00:00:00.000Z',
        data: {},
      },
    })).not.toThrow()
    await new Promise((r) => setTimeout(r, 500))

    console.error = origError
    listener.unregister()

    // Error must be logged, not thrown
    const deliveryErrors = errors.filter((e) => e.includes('[kl-plugin-webhook]'))
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

    const afterPayload = {
      event: 'task.created',
      timestamp: '2026-03-23T00:00:00.000Z',
      data: { id: 'card-1' },
    }

    const listener = new WebhookListenerPlugin(workspaceDir)
    listener.register(mockBus as never)
    capturedHandler!('task.created', { data: afterPayload })

    // Wait for delivery
    await new Promise((r) => setTimeout(r, 500))
    await new Promise<void>((resolve) => server.close(() => resolve()))
    listener.unregister()

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

    const listener = new WebhookListenerPlugin(workspaceDir)
    listener.register(mockBus as never)
    capturedHandler!('task.updated', {
      data: {
        event: 'task.updated',
        timestamp: '2026-03-23T00:00:00.000Z',
        data: {},
      },
    })

    await new Promise((r) => setTimeout(r, 500))
    await new Promise<void>((resolve) => server.close(() => resolve()))
    listener.unregister()

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

    const afterPayload = {
      event: 'task.created',
      timestamp: '2026-03-23T00:00:00.000Z',
      data: { id: 'card-1', status: 'backlog' },
    }

    const listener = new WebhookListenerPlugin(workspaceDir)
    listener.register(mockBus as never)
    capturedHandler!('task.created', { data: afterPayload })

    await new Promise((r) => setTimeout(r, 500))
    await new Promise<void>((resolve) => server.close(() => resolve()))
    listener.unregister()

    const parsed = JSON.parse(receivedBody) as { event: string; timestamp: string; data: unknown }
    expect(parsed.event).toBe('task.created')
    expect(typeof parsed.timestamp).toBe('string')
    expect(parsed.data).toEqual(afterPayload)
  })
})

// ---------------------------------------------------------------------------
// standaloneHttpPlugin – manifest and route handlers
// ---------------------------------------------------------------------------

describe('standaloneHttpPlugin', () => {
  it('has id "webhooks" and provides standalone.http', () => {
    expect(standaloneHttpPlugin.manifest.id).toBe('webhooks')
    expect(standaloneHttpPlugin.manifest.provides).toContain('standalone.http')
  })

  it('registerRoutes returns an array of 5 handler functions', () => {
    const handlers = standaloneHttpPlugin.registerRoutes()
    expect(Array.isArray(handlers)).toBe(true)
    expect(handlers).toHaveLength(5)
    handlers.forEach((h) => expect(typeof h).toBe('function'))
  })

  // ---------------------------------------------------------------------------
  // Route handler helpers
  // ---------------------------------------------------------------------------

  type SdkMock = {
    listWebhooks: ReturnType<typeof vi.fn>
    createWebhook: ReturnType<typeof vi.fn>
    updateWebhook: ReturnType<typeof vi.fn>
    deleteWebhook: ReturnType<typeof vi.fn>
    addBoardLog: ReturnType<typeof vi.fn>
    runWithAuth: ReturnType<typeof vi.fn>
  }

  function makeRouteFn(method: string, url: string) {
    return (m: string, pattern: string): Record<string, string> | null => {
      if (m !== method) return null
      const keys: string[] = []
      const re = new RegExp(
        '^' +
          pattern.replace(/:([^/]+)/g, (_, key: string) => {
            keys.push(key)
            return '([^/]+)'
          }) +
          '$',
      )
      const match = url.match(re)
      if (!match) return null
      const params: Record<string, string> = {}
      keys.forEach((k, i) => {
        params[k] = match[i + 1]
      })
      return params
    }
  }

  function makeRes() {
    const res = {
      statusCode: 0,
      headers: {} as Record<string, string>,
      body: '',
      writeHead(status: number, headers: Record<string, string>) {
        res.statusCode = status
        Object.assign(res.headers, headers)
      },
      end(b: string) {
        res.body = b
      },
    }
    return res
  }

  function makeCtx(
    method: string,
    url: string,
    body?: Record<string, unknown>,
    sdkOverrides?: Partial<SdkMock>,
  ) {
    const res = makeRes()
    const rawBody = body ? Buffer.from(JSON.stringify(body)) : undefined
    const req = { method, headers: {}, _rawBody: rawBody }
    const sdk: SdkMock = {
      listWebhooks: vi.fn().mockReturnValue([]),
      createWebhook: vi
        .fn()
        .mockResolvedValue({ id: 'wh_new', url: 'http://x.com', events: ['*'], active: true }),
      updateWebhook: vi
        .fn()
        .mockResolvedValue({ id: 'wh_1', url: 'http://x.com', events: ['*'], active: false }),
      deleteWebhook: vi.fn().mockResolvedValue(true),
      addBoardLog: vi.fn().mockResolvedValue(undefined),
      runWithAuth: vi.fn().mockImplementation((_auth: unknown, fn: () => Promise<unknown>) => fn()),
      ...sdkOverrides,
    }
    return {
      ctx: { sdk, req, res, route: makeRouteFn(method, url) } as unknown as Parameters<
        (typeof standaloneHttpPlugin.registerRoutes)
      >[0] extends undefined
        ? never
        : never,
      // Use a plain object cast — tests care about behavior, not the type
      plainCtx: { sdk, req, res, route: makeRouteFn(method, url) },
      sdk,
      res,
    }
  }

  const [getHandler, testHandler, postHandler, putHandler, deleteHandler] =
    standaloneHttpPlugin.registerRoutes() as unknown as Array<
      (ctx: { sdk: SdkMock; req: object; res: ReturnType<typeof makeRes>; route: ReturnType<typeof makeRouteFn> }) => Promise<boolean>
    >

  // ---------------------------------------------------------------------------
  // GET /api/webhooks
  // ---------------------------------------------------------------------------

  it('GET /api/webhooks returns false for non-matching method', async () => {
    const { plainCtx } = makeCtx('POST', '/api/webhooks')
    const result = await getHandler(plainCtx as never)
    expect(result).toBe(false)
  })

  it('GET /api/webhooks returns false for non-matching path', async () => {
    const { plainCtx } = makeCtx('GET', '/api/other')
    const result = await getHandler(plainCtx as never)
    expect(result).toBe(false)
  })

  it('GET /api/webhooks lists webhooks and returns 200', async () => {
    const wh: Webhook = { id: 'wh_abc', url: 'http://a.com', events: ['*'], active: true }
    const { plainCtx, sdk, res } = makeCtx('GET', '/api/webhooks', undefined, {
      listWebhooks: vi.fn().mockReturnValue([wh]),
    })
    const result = await getHandler(plainCtx as never)
    expect(result).toBe(true)
    expect(sdk.runWithAuth).toHaveBeenCalledOnce()
    expect(sdk.listWebhooks).toHaveBeenCalledOnce()
    expect(res.statusCode).toBe(200)
    const parsed = JSON.parse(res.body) as { ok: boolean; data: Webhook[] }
    expect(parsed.ok).toBe(true)
    expect(parsed.data).toEqual([wh])
  })

  it('GET /api/webhooks returns 401 on auth error', async () => {
    const authErr = Object.assign(new Error('Not authed'), { category: 'auth.unauthorized' })
    const { plainCtx, res } = makeCtx('GET', '/api/webhooks', undefined, {
      runWithAuth: vi.fn().mockRejectedValue(authErr),
    })
    await getHandler(plainCtx as never)
    expect(res.statusCode).toBe(401)
    const parsed = JSON.parse(res.body) as { ok: boolean }
    expect(parsed.ok).toBe(false)
  })

  it('GET /api/webhooks returns 403 on policy denial', async () => {
    const authErr = Object.assign(new Error('Action denied'), { category: 'auth.policy.denied' })
    const { plainCtx, res } = makeCtx('GET', '/api/webhooks', undefined, {
      runWithAuth: vi.fn().mockRejectedValue(authErr),
    })
    await getHandler(plainCtx as never)
    expect(res.statusCode).toBe(403)
    const parsed = JSON.parse(res.body) as { ok: boolean }
    expect(parsed.ok).toBe(false)
  })

  // ---------------------------------------------------------------------------
  // POST /api/webhooks
  // ---------------------------------------------------------------------------

  it('POST /api/webhooks returns false for non-matching route', async () => {
    const { plainCtx } = makeCtx('GET', '/api/webhooks')
    const result = await postHandler(plainCtx as never)
    expect(result).toBe(false)
  })

  it('POST /api/webhooks/test writes a board log entry through the SDK', async () => {
    const { plainCtx, sdk, res } = makeCtx('POST', '/api/webhooks/test', {
      event: 'task.created',
      timestamp: '2026-03-25T00:00:00.000Z',
      data: { id: 'card-1' },
    })

    await testHandler(plainCtx as never)

    expect(res.statusCode).toBe(200)
    expect(sdk.runWithAuth).toHaveBeenCalledOnce()
    expect(sdk.addBoardLog).toHaveBeenCalledWith(
      '[webhook-test] Received event: task.created',
      expect.objectContaining({
        source: 'webhook-test',
        timestamp: '2026-03-25T00:00:00.000Z',
      }),
    )
  })

  it('POST /api/webhooks returns 400 when url or events missing', async () => {
    const { plainCtx, res } = makeCtx('POST', '/api/webhooks', { url: 'http://x.com' })
    await postHandler(plainCtx as never)
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).ok).toBe(false)
  })

  it('POST /api/webhooks creates webhook and returns 201', async () => {
    const newWh: Webhook = { id: 'wh_new', url: 'http://x.com', events: ['*'], active: true }
    const { plainCtx, sdk, res } = makeCtx(
      'POST',
      '/api/webhooks',
      { url: 'http://x.com', events: ['*'] },
      { createWebhook: vi.fn().mockResolvedValue(newWh) },
    )
    await postHandler(plainCtx as never)
    expect(res.statusCode).toBe(201)
    const parsed = JSON.parse(res.body) as { ok: boolean; data: Webhook }
    expect(parsed.ok).toBe(true)
    expect(parsed.data.id).toBe('wh_new')
    expect(sdk.createWebhook).toHaveBeenCalledWith({
      url: 'http://x.com',
      events: ['*'],
      secret: undefined,
    })
  })

  it('POST /api/webhooks passes secret when provided', async () => {
    const { plainCtx, sdk } = makeCtx(
      'POST',
      '/api/webhooks',
      { url: 'http://x.com', events: ['*'], secret: 'mysecret' },
      { createWebhook: vi.fn().mockResolvedValue({ id: 'wh_s', url: 'http://x.com', events: ['*'], active: true, secret: 'mysecret' }) },
    )
    await postHandler(plainCtx as never)
    expect(sdk.createWebhook).toHaveBeenCalledWith({
      url: 'http://x.com',
      events: ['*'],
      secret: 'mysecret',
    })
  })

  it('POST /api/webhooks returns 403 on policy denial', async () => {
    const authErr = Object.assign(new Error('Action denied'), { category: 'auth.policy.denied' })
    const { plainCtx, res } = makeCtx(
      'POST',
      '/api/webhooks',
      { url: 'http://x.com', events: ['*'] },
      { runWithAuth: vi.fn().mockRejectedValue(authErr) },
    )
    await postHandler(plainCtx as never)
    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body) as { ok: boolean }).toMatchObject({ ok: false })
  })

  // ---------------------------------------------------------------------------
  // PUT /api/webhooks/:id
  // ---------------------------------------------------------------------------

  it('PUT /api/webhooks/:id returns false for non-matching route', async () => {
    const { plainCtx } = makeCtx('GET', '/api/webhooks/wh_1')
    const result = await putHandler(plainCtx as never)
    expect(result).toBe(false)
  })

  it('PUT /api/webhooks/:id updates webhook and returns 200', async () => {
    const updated: Webhook = { id: 'wh_1', url: 'http://new.com', events: ['*'], active: false }
    const { plainCtx, sdk, res } = makeCtx(
      'PUT',
      '/api/webhooks/wh_1',
      { url: 'http://new.com', active: false },
      { updateWebhook: vi.fn().mockResolvedValue(updated) },
    )
    await putHandler(plainCtx as never)
    expect(res.statusCode).toBe(200)
    const parsed = JSON.parse(res.body) as { ok: boolean; data: Webhook }
    expect(parsed.ok).toBe(true)
    expect(parsed.data.url).toBe('http://new.com')
    expect(sdk.updateWebhook).toHaveBeenCalledWith('wh_1', { url: 'http://new.com', active: false })
  })

  it('PUT /api/webhooks/:id returns 404 when webhook not found', async () => {
    const { plainCtx, res } = makeCtx(
      'PUT',
      '/api/webhooks/wh_missing',
      { active: false },
      { updateWebhook: vi.fn().mockResolvedValue(null) },
    )
    await putHandler(plainCtx as never)
    expect(res.statusCode).toBe(404)
    expect(JSON.parse(res.body).ok).toBe(false)
  })

  it('PUT /api/webhooks/:id returns 403 on policy denial', async () => {
    const authErr = Object.assign(new Error('Action denied'), { category: 'auth.policy.denied' })
    const { plainCtx, res } = makeCtx(
      'PUT',
      '/api/webhooks/wh_1',
      { active: false },
      { runWithAuth: vi.fn().mockRejectedValue(authErr) },
    )
    await putHandler(plainCtx as never)
    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body) as { ok: boolean }).toMatchObject({ ok: false })
  })

  // ---------------------------------------------------------------------------
  // DELETE /api/webhooks/:id
  // ---------------------------------------------------------------------------

  it('DELETE /api/webhooks/:id returns false for non-matching route', async () => {
    const { plainCtx } = makeCtx('GET', '/api/webhooks/wh_1')
    const result = await deleteHandler(plainCtx as never)
    expect(result).toBe(false)
  })

  it('DELETE /api/webhooks/:id deletes and returns 200 with id', async () => {
    const { plainCtx, sdk, res } = makeCtx('DELETE', '/api/webhooks/wh_1', undefined, {
      deleteWebhook: vi.fn().mockResolvedValue(true),
    })
    await deleteHandler(plainCtx as never)
    expect(res.statusCode).toBe(200)
    const parsed = JSON.parse(res.body) as { ok: boolean; data: { id: string } }
    expect(parsed.ok).toBe(true)
    expect(parsed.data.id).toBe('wh_1')
    expect(sdk.deleteWebhook).toHaveBeenCalledWith('wh_1')
  })

  it('DELETE /api/webhooks/:id returns 404 when webhook not found', async () => {
    const { plainCtx, res } = makeCtx('DELETE', '/api/webhooks/wh_missing', undefined, {
      deleteWebhook: vi.fn().mockResolvedValue(false),
    })
    await deleteHandler(plainCtx as never)
    expect(res.statusCode).toBe(404)
    expect(JSON.parse(res.body).ok).toBe(false)
  })

  it('DELETE /api/webhooks/:id returns 403 on policy denial', async () => {
    const authErr = Object.assign(new Error('Action denied'), { category: 'auth.policy.denied' })
    const { plainCtx, res } = makeCtx('DELETE', '/api/webhooks/wh_1', undefined, {
      runWithAuth: vi.fn().mockRejectedValue(authErr),
    })
    await deleteHandler(plainCtx as never)
    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body) as { ok: boolean }).toMatchObject({ ok: false })
  })
})

// ---------------------------------------------------------------------------
// cliPlugin – plugin-owned webhook CLI commands
// ---------------------------------------------------------------------------

function mockProcessExit(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(process, 'exit').mockImplementation((code?: number | string | null) => {
    throw new Error(`process.exit:${code ?? 0}`)
  })
}

describe('cliPlugin manifest', () => {
  it('has id "webhooks" and command "webhooks"', () => {
    expect(cliPlugin.manifest.id).toBe('webhooks')
    expect(cliPlugin.command).toBe('webhooks')
  })

  it('exports a run function', () => {
    expect(typeof cliPlugin.run).toBe('function')
  })
})

describe('cliPlugin — list', () => {
  let workspaceDir: string

  beforeEach(() => {
    workspaceDir = createTempDir()
  })

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('lists webhooks as a table', async () => {
    webhookProviderPlugin.createWebhook(workspaceDir, { url: 'http://example.com/hook', events: ['*'] })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await cliPlugin.run([], {}, { workspaceRoot: workspaceDir })

    const output = logSpy.mock.calls.map(c => c.join('')).join('\n')
    expect(output).toContain('example.com')
    expect(output).toContain('yes')
  })

  it('lists webhooks as JSON with --json flag', async () => {
    webhookProviderPlugin.createWebhook(workspaceDir, { url: 'http://example.com/hook', events: ['task.created'] })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await cliPlugin.run(['list'], { json: true }, { workspaceRoot: workspaceDir })

    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string) as unknown[]
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed).toHaveLength(1)
  })

  it('prints empty message when no webhooks', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await cliPlugin.run(['list'], {}, { workspaceRoot: workspaceDir })

    expect(logSpy.mock.calls[0][0]).toContain('No webhooks')
  })
})

describe('cliPlugin — add', () => {
  let workspaceDir: string

  beforeEach(() => {
    workspaceDir = createTempDir()
  })

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('creates a webhook and prints confirmation', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await cliPlugin.run(['add'], { url: 'http://example.com/hook', events: 'task.created' }, { workspaceRoot: workspaceDir })

    const output = logSpy.mock.calls.map(c => c.join('')).join('\n')
    expect(output).toContain('Created webhook')
    expect(webhookProviderPlugin.listWebhooks(workspaceDir)).toHaveLength(1)
    expect(webhookProviderPlugin.listWebhooks(workspaceDir)[0].events).toEqual(['task.created'])
  })

  it('creates a webhook with JSON output', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await cliPlugin.run(['add'], { url: 'http://example.com/hook', json: true }, { workspaceRoot: workspaceDir })

    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string) as Webhook
    expect(parsed.url).toBe('http://example.com/hook')
    expect(parsed.active).toBe(true)
  })

  it('exits with error when --url is missing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = mockProcessExit()

    await expect(
      cliPlugin.run(['add'], {}, { workspaceRoot: workspaceDir }),
    ).rejects.toThrow('process.exit:1')

    exitSpy.mockRestore()
  })
})

describe('cliPlugin — remove / rm', () => {
  let workspaceDir: string

  beforeEach(() => {
    workspaceDir = createTempDir()
  })

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('removes a webhook by id', async () => {
    const wh = webhookProviderPlugin.createWebhook(workspaceDir, { url: 'http://example.com/hook', events: ['*'] })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await cliPlugin.run(['remove', wh.id], {}, { workspaceRoot: workspaceDir })

    expect(logSpy.mock.calls[0][0]).toContain('Removed webhook')
    expect(webhookProviderPlugin.listWebhooks(workspaceDir)).toHaveLength(0)
  })

  it('rm alias removes a webhook', async () => {
    const wh = webhookProviderPlugin.createWebhook(workspaceDir, { url: 'http://example.com/hook', events: ['*'] })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await cliPlugin.run(['rm', wh.id], {}, { workspaceRoot: workspaceDir })

    expect(logSpy.mock.calls[0][0]).toContain('Removed webhook')
  })

  it('exits with error when id not found', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = mockProcessExit()

    await expect(
      cliPlugin.run(['remove', 'wh_nonexistent'], {}, { workspaceRoot: workspaceDir }),
    ).rejects.toThrow('process.exit:1')

    exitSpy.mockRestore()
  })

  it('exits with error when id is missing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = mockProcessExit()

    await expect(
      cliPlugin.run(['remove'], {}, { workspaceRoot: workspaceDir }),
    ).rejects.toThrow('process.exit:1')

    exitSpy.mockRestore()
  })
})

describe('cliPlugin — update', () => {
  let workspaceDir: string

  beforeEach(() => {
    workspaceDir = createTempDir()
  })

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('updates a webhook and prints confirmation', async () => {
    const wh = webhookProviderPlugin.createWebhook(workspaceDir, { url: 'http://old.example.com', events: ['*'] })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await cliPlugin.run(['update', wh.id], { url: 'http://new.example.com' }, { workspaceRoot: workspaceDir })

    const output = logSpy.mock.calls.map(c => c.join('')).join('\n')
    expect(output).toContain('Updated webhook')
    expect(webhookProviderPlugin.listWebhooks(workspaceDir)[0].url).toBe('http://new.example.com')
  })

  it('updates a webhook and outputs JSON', async () => {
    const wh = webhookProviderPlugin.createWebhook(workspaceDir, { url: 'http://example.com', events: ['*'] })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await cliPlugin.run(['update', wh.id], { events: 'task.created', json: true }, { workspaceRoot: workspaceDir })

    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string) as Webhook
    expect(parsed.events).toEqual(['task.created'])
  })

  it('sets active to false when --active false', async () => {
    const wh = webhookProviderPlugin.createWebhook(workspaceDir, { url: 'http://example.com', events: ['*'] })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await cliPlugin.run(['update', wh.id], { active: 'false' }, { workspaceRoot: workspaceDir })

    expect(webhookProviderPlugin.listWebhooks(workspaceDir)[0].active).toBe(false)
  })

  it('exits with error when id not found', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = mockProcessExit()

    await expect(
      cliPlugin.run(['update', 'wh_nonexistent'], { url: 'http://x.com' }, { workspaceRoot: workspaceDir }),
    ).rejects.toThrow('process.exit:1')

    exitSpy.mockRestore()
  })

  it('exits with error when id is missing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = mockProcessExit()

    await expect(
      cliPlugin.run(['update'], {}, { workspaceRoot: workspaceDir }),
    ).rejects.toThrow('process.exit:1')

    exitSpy.mockRestore()
  })
})

describe('cliPlugin — unknown subcommand', () => {
  it('exits with error for unknown subcommand', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = mockProcessExit()

    await expect(
      cliPlugin.run(['unknown-subcmd'], {}, { workspaceRoot: '/tmp' }),
    ).rejects.toThrow('process.exit:1')

    exitSpy.mockRestore()
    vi.restoreAllMocks()
  })
})

describe('cliPlugin — CLI discovery (webhook-only workspace)', () => {
  it('cliPlugin is exported and discoverable as the canonical CLI owner for webhooks', () => {
    // The named export `cliPlugin` is what loadCliPlugins() looks for (mod.cliPlugin with a .run function).
    expect(cliPlugin).toBeDefined()
    expect(typeof cliPlugin.run).toBe('function')
    expect(cliPlugin.command).toBe('webhooks')
    expect(cliPlugin.manifest.id).toBe('webhooks')
  })
})

// ---------------------------------------------------------------------------
// cliPlugin — SDK auth delegation (context.sdk + context.runWithCliAuth)
// ---------------------------------------------------------------------------

describe('cliPlugin — SDK auth delegation', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('delegates list to context.sdk when provided', async () => {
    const wh: Webhook = { id: 'wh_sdk1', url: 'http://example.com', events: ['*'], active: true }
    const mockSdk = { listWebhooks: vi.fn().mockReturnValue([wh]) } as Parameters<typeof cliPlugin.run>[2]['sdk'] & {}
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await cliPlugin.run(['list'], { json: true }, { workspaceRoot: '/tmp', sdk: mockSdk, runWithCliAuth: (fn) => fn() })

    expect(mockSdk.listWebhooks).toHaveBeenCalledOnce()
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string) as unknown[]
    expect(parsed).toHaveLength(1)
    expect((parsed[0] as Webhook).id).toBe('wh_sdk1')
  })

  it('delegates add through context.runWithCliAuth', async () => {
    const wh: Webhook = { id: 'wh_sdk2', url: 'http://example.com/hook', events: ['task.created'], active: true }
    const mockSdk = { createWebhook: vi.fn().mockResolvedValue(wh) } as unknown as Parameters<typeof cliPlugin.run>[2]['sdk'] & {}
    const runWithCliAuth = vi.fn((fn: () => Promise<unknown>) => fn())
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await cliPlugin.run(['add'], { url: 'http://example.com/hook', events: 'task.created' }, {
      workspaceRoot: '/tmp',
      sdk: mockSdk,
      runWithCliAuth,
    })

    expect(runWithCliAuth).toHaveBeenCalledOnce()
    expect(mockSdk.createWebhook).toHaveBeenCalledWith({ url: 'http://example.com/hook', events: ['task.created'], secret: undefined })
  })

  it('delegates add to context.sdk even when runWithCliAuth is absent', async () => {
    const wh: Webhook = { id: 'wh_sdk2b', url: 'http://example.com/hook', events: ['*'], active: true }
    const mockSdk = { createWebhook: vi.fn().mockResolvedValue(wh) } as unknown as Parameters<typeof cliPlugin.run>[2]['sdk'] & {}
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await cliPlugin.run(['add'], { url: 'http://example.com/hook' }, {
      workspaceRoot: '/tmp',
      sdk: mockSdk,
    })

    expect(mockSdk.createWebhook).toHaveBeenCalledWith({ url: 'http://example.com/hook', events: ['*'], secret: undefined })
  })

  it('propagates AuthError from context.sdk.createWebhook (access denied)', async () => {
    const authErr = Object.assign(new Error('Action "webhook.create" denied'), { category: 'auth.policy.denied' })
    const mockSdk = { createWebhook: vi.fn().mockRejectedValue(authErr) } as unknown as Parameters<typeof cliPlugin.run>[2]['sdk'] & {}
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await expect(
      cliPlugin.run(['add'], { url: 'http://example.com/hook' }, {
        workspaceRoot: '/tmp',
        sdk: mockSdk,
        runWithCliAuth: (fn) => fn(),
      }),
    ).rejects.toMatchObject({ category: 'auth.policy.denied', message: 'Action "webhook.create" denied' })
  })

  it('does not log success output before propagating a denied create error', async () => {
    const authErr = Object.assign(new Error('Denied'), { category: 'auth.policy.denied' })
    const mockSdk = { createWebhook: vi.fn().mockRejectedValue(authErr) } as unknown as Parameters<typeof cliPlugin.run>[2]['sdk'] & {}
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await expect(
      cliPlugin.run(['add'], { url: 'http://example.com/hook' }, {
        workspaceRoot: '/tmp',
        sdk: mockSdk,
        runWithCliAuth: (fn) => fn(),
      }),
    ).rejects.toBeDefined()

    expect(logSpy).not.toHaveBeenCalled()
  })

  it('delegates remove through context.runWithCliAuth', async () => {
    const mockSdk = { deleteWebhook: vi.fn().mockResolvedValue(true) } as unknown as Parameters<typeof cliPlugin.run>[2]['sdk'] & {}
    const runWithCliAuth = vi.fn((fn: () => Promise<unknown>) => fn())
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await cliPlugin.run(['remove', 'wh_xyz'], {}, { workspaceRoot: '/tmp', sdk: mockSdk, runWithCliAuth })

    expect(runWithCliAuth).toHaveBeenCalledOnce()
    expect(mockSdk.deleteWebhook).toHaveBeenCalledWith('wh_xyz')
  })

  it('delegates update through context.runWithCliAuth', async () => {
    const updatedWh: Webhook = { id: 'wh_xyz', url: 'http://new.example.com', events: ['*'], active: false }
    const mockSdk = { updateWebhook: vi.fn().mockResolvedValue(updatedWh) } as unknown as Parameters<typeof cliPlugin.run>[2]['sdk'] & {}
    const runWithCliAuth = vi.fn((fn: () => Promise<unknown>) => fn())
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await cliPlugin.run(['update', 'wh_xyz'], { url: 'http://new.example.com', active: 'false' }, {
      workspaceRoot: '/tmp',
      sdk: mockSdk,
      runWithCliAuth,
    })

    expect(runWithCliAuth).toHaveBeenCalledOnce()
    expect(mockSdk.updateWebhook).toHaveBeenCalledWith('wh_xyz', { url: 'http://new.example.com', active: false })
  })
})

// ---------------------------------------------------------------------------
// sdkExtensionPlugin – SDK extension pack contract (SPE-03)
// ---------------------------------------------------------------------------

describe('sdkExtensionPlugin manifest', () => {
  it('has id "kl-plugin-webhook" and provides sdk.extension', () => {
    expect(sdkExtensionPlugin.manifest.id).toBe('kl-plugin-webhook')
    expect(sdkExtensionPlugin.manifest.provides).toContain('sdk.extension')
  })

  it('exposes listWebhooks, createWebhook, updateWebhook, deleteWebhook in extensions', () => {
    expect(typeof sdkExtensionPlugin.extensions.listWebhooks).toBe('function')
    expect(typeof sdkExtensionPlugin.extensions.createWebhook).toBe('function')
    expect(typeof sdkExtensionPlugin.extensions.updateWebhook).toBe('function')
    expect(typeof sdkExtensionPlugin.extensions.deleteWebhook).toBe('function')
  })
})

describe('sdkExtensionPlugin CRUD via extensions bag', () => {
  let workspaceDir: string

  beforeEach(() => {
    workspaceDir = createTempDir()
  })

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('listWebhooks returns empty array when no webhooks exist', () => {
    expect(sdkExtensionPlugin.extensions.listWebhooks(workspaceDir)).toEqual([])
  })

  it('createWebhook adds a webhook and returns it with generated id', () => {
    const wh = sdkExtensionPlugin.extensions.createWebhook(workspaceDir, {
      url: 'http://ext.example.com/hook',
      events: ['task.created'],
    })
    expect(wh.id).toMatch(/^wh_[0-9a-f]{16}$/)
    expect(wh.url).toBe('http://ext.example.com/hook')
    expect(wh.active).toBe(true)
  })

  it('listWebhooks via extensions returns same data as webhookProviderPlugin.listWebhooks', () => {
    webhookProviderPlugin.createWebhook(workspaceDir, { url: 'http://a.com', events: ['*'] })
    const fromExt = sdkExtensionPlugin.extensions.listWebhooks(workspaceDir)
    const fromProvider = webhookProviderPlugin.listWebhooks(workspaceDir)
    expect(fromExt).toEqual(fromProvider)
  })

  it('updateWebhook via extensions updates and returns the webhook', () => {
    const wh = sdkExtensionPlugin.extensions.createWebhook(workspaceDir, {
      url: 'http://ext.example.com',
      events: ['*'],
    })
    const updated = sdkExtensionPlugin.extensions.updateWebhook(workspaceDir, wh.id, { active: false })
    expect(updated).not.toBeNull()
    expect(updated!.active).toBe(false)
  })

  it('deleteWebhook via extensions removes the webhook', () => {
    const wh = sdkExtensionPlugin.extensions.createWebhook(workspaceDir, {
      url: 'http://ext.example.com',
      events: ['*'],
    })
    expect(sdkExtensionPlugin.extensions.deleteWebhook(workspaceDir, wh.id)).toBe(true)
    expect(sdkExtensionPlugin.extensions.listWebhooks(workspaceDir)).toHaveLength(0)
  })

  it('extension methods share state with webhookProviderPlugin (same backing store)', () => {
    const wh = webhookProviderPlugin.createWebhook(workspaceDir, { url: 'http://b.com', events: ['*'] })
    // Delete via extension bag
    expect(sdkExtensionPlugin.extensions.deleteWebhook(workspaceDir, wh.id)).toBe(true)
    // Both paths should now see empty list
    expect(webhookProviderPlugin.listWebhooks(workspaceDir)).toHaveLength(0)
    expect(sdkExtensionPlugin.extensions.listWebhooks(workspaceDir)).toHaveLength(0)
  })
})
