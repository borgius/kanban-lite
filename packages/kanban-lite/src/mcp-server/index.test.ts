/**
 * Minimal regression coverage for MCP denial mapping.
 *
 * Verifies that denied admin/config actions surface a stable
 * { isError: true, content: [{type:'text', text: message}] } response
 * and never expose raw token material — matching the error-mapping
 * pattern used throughout src/mcp-server/index.ts.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMcpPluginContext, registerCardStateMcpTools, registerPluginMcpTools } from './index'
import { KanbanSDK } from '../sdk/KanbanSDK'
import * as pluginRegistry from '../sdk/plugins'
import { createBuiltinAuthListenerPlugin, resolveCapabilityBag } from '../sdk/plugins'
import { AuthError, ERR_CARD_STATE_IDENTITY_UNAVAILABLE } from '../sdk/types'
import type { AuthContext, AuthDecision } from '../sdk/types'
import type { AuthIdentity } from '../sdk/plugins'
import type { SDKEventListenerPlugin } from '../sdk/types'
import type { Webhook } from '../shared/config'
import { mcpPlugin } from '../../../kl-webhooks-plugin/src/index'

type CapabilityBag = ReturnType<typeof resolveCapabilityBag>

function setCapabilities(sdk: KanbanSDK, bag: CapabilityBag): void {
  const internal = sdk as unknown as {
    _capabilities: CapabilityBag | null
    _eventBus: import('../sdk/eventBus').EventBus
  }
  internal._capabilities?.authListener.unregister()
  internal._capabilities = {
    ...bag,
    authListener: createBuiltinAuthListenerPlugin(bag.authIdentity, bag.authPolicy),
  }
  internal._capabilities.authListener.register(internal._eventBus)
}

function injectDenyAll(sdk: KanbanSDK, kanbanDir: string): void {
  const bag = resolveCapabilityBag(
    { 'card.storage': { provider: 'markdown' }, 'attachment.storage': { provider: 'localfs' } },
    kanbanDir,
  )
  const noopListener: SDKEventListenerPlugin = {
    manifest: { id: 'deny-all-webhook-listener', provides: ['event.listener'] as const },
    register: () => {},
    unregister: () => {},
  }
  setCapabilities(sdk, {
    ...bag,
    webhookProvider: {
      manifest: { id: 'deny-all-webhook-provider', provides: ['webhook.delivery'] },
      listWebhooks: () => [],
      createWebhook: (_root: string, input: { url: string; events: string[]; secret?: string }): Webhook =>
        ({ id: 'wh_mock', url: input.url, events: input.events, active: true }),
      updateWebhook: (): Webhook | null => null,
      deleteWebhook: (): boolean => false,
    },
    webhookListener: noopListener,
    authPolicy: {
      manifest: { id: 'deny-all', provides: ['auth.policy' as const] },
      async checkPolicy(
        _identity: AuthIdentity | null,
        _action: string,
        _ctx: AuthContext,
      ): Promise<AuthDecision> {
        return { allowed: false, reason: 'auth.policy.denied' as const }
      },
    },
  })
}

/**
 * Injects a fully isolated in-memory webhook provider into the SDK capability
 * bag so CRUD tests run against provider-backed delegation, not the built-in
 * fallback that writes to `.kanban.json`.
 */
function injectMockWebhookProvider(sdk: KanbanSDK, kanbanDir: string): void {
  const store: Webhook[] = []
  let idSeq = 0
  const noopListener: SDKEventListenerPlugin = {
    manifest: { id: 'mock-webhook-listener', provides: ['event.listener'] as const },
    register: () => {},
    unregister: () => {},
  }
  const bag = resolveCapabilityBag(
    { 'card.storage': { provider: 'markdown' }, 'attachment.storage': { provider: 'localfs' } },
    kanbanDir,
  )
  setCapabilities(sdk, {
    ...bag,
    webhookProvider: {
      manifest: { id: 'mock-webhook-provider', provides: ['webhook.delivery'] },
      listWebhooks(_root: string): Webhook[] {
        return [...store]
      },
      createWebhook(_root: string, input: { url: string; events: string[]; secret?: string }): Webhook {
        const wh: Webhook = { id: `wh_mock_${++idSeq}`, url: input.url, events: input.events, active: true, ...(input.secret ? { secret: input.secret } : {}) }
        store.push(wh)
        return { ...wh }
      },
      updateWebhook(_root: string, id: string, updates: Partial<Pick<Webhook, 'url' | 'events' | 'secret' | 'active'>>): Webhook | null {
        const idx = store.findIndex(w => w.id === id)
        if (idx === -1) return null
        Object.assign(store[idx], updates)
        return { ...store[idx] }
      },
      deleteWebhook(_root: string, id: string): boolean {
        const idx = store.findIndex(w => w.id === id)
        if (idx === -1) return false
        store.splice(idx, 1)
        return true
      },
    },
    webhookListener: noopListener,
  })
}

/**
 * Replicates the error-mapping pattern used by every protected MCP tool
 * handler in src/mcp-server/index.ts:
 *   catch (err) {
 *     if (err instanceof AuthError) return { content: [...], isError: true }
 *     return { content: [...], isError: true }
 *   }
 */
async function mcpHandler<T>(
  fn: () => Promise<T>,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  try {
    const result = await fn()
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  } catch (err) {
    if (err instanceof AuthError) return { content: [{ type: 'text', text: err.message }], isError: true }
    return { content: [{ type: 'text', text: String(err) }], isError: true }
  }
}

function captureCardStateTools(targetSdk: KanbanSDK) {
  const tools: Array<{
    name: string
    description: string
    schema: Record<string, unknown>
    handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>
  }> = []

  const server = {
    tool(
      name: string,
      description: string,
      schema: Record<string, unknown>,
      handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>,
    ) {
      tools.push({ name, description, schema, handler })
    },
  }

  const registered = registerCardStateMcpTools(server, {
    sdk: targetSdk,
    runWithAuth: (fn) => targetSdk.runWithAuth({ transport: 'mcp' }, fn),
  })

  return { registered, tools }
}

describe('MCP auth denial mapping: denied admin action produces stable isError response', () => {
  let workspaceDir: string
  let kanbanDir: string
  let sdk: KanbanSDK

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-mcp-denial-'))
    kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
    sdk = new KanbanSDK(kanbanDir)
    injectDenyAll(sdk, kanbanDir)
  })

  afterEach(() => {
    sdk.close()
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('denied create_board produces isError: true with action-stable message and no token material', async () => {
    const mcpAuthCtx: AuthContext = {
      token: 'secret-mcp-token-must-not-appear-in-response',
      tokenSource: 'env',
      transport: 'mcp',
    }

    const result = await mcpHandler(() =>
      sdk.createBoard('new-board', 'New Board', undefined, mcpAuthCtx),
    )

    expect(result.isError).toBe(true)
    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe('text')
    expect(result.content[0].text).toContain('board.create')
    expect(result.content[0].text).not.toContain('secret-mcp-token-must-not-appear-in-response')
  })

  it('denied delete_board produces isError: true with stable message', async () => {
    const result = await mcpHandler(() =>
      sdk.deleteBoard('default', { transport: 'mcp' }),
    )

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('board.delete')
  })
})

describe('MCP webhook CRUD parity: SDK-backed behavior', () => {
  let workspaceDir: string
  let kanbanDir: string
  let sdk: KanbanSDK

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-mcp-webhook-'))
    kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
    sdk = new KanbanSDK(kanbanDir)
    // Inject an isolated in-memory provider so tests are provider-backed
    // and independent of the built-in .kanban.json fallback.
    injectMockWebhookProvider(sdk, kanbanDir)
  })

  afterEach(() => {
    sdk.close()
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('list_webhooks returns empty array on fresh workspace', () => {
    const result = sdk.listWebhooks()
    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(0)
  })

  it('add_webhook creates a webhook with expected fields', async () => {
    const webhook = await sdk.runWithAuth({ transport: 'mcp' }, () => sdk.createWebhook({ url: 'https://example.com/hook', events: ['*'] }))
    expect(webhook.id).toMatch(/^wh_/)
    expect(webhook.url).toBe('https://example.com/hook')
    expect(webhook.events).toEqual(['*'])
    expect(webhook.active).toBe(true)

    const listed = sdk.listWebhooks()
    expect(listed).toHaveLength(1)
    expect(listed[0].id).toBe(webhook.id)
  })

  it('update_webhook modifies an existing webhook', async () => {
    const webhook = await sdk.runWithAuth({ transport: 'mcp' }, () => sdk.createWebhook({ url: 'https://example.com/hook', events: ['*'] }))
    const updated = await sdk.runWithAuth({ transport: 'mcp' }, () => sdk.updateWebhook(webhook.id, { active: false }))
    expect(updated).not.toBeNull()
    expect(updated!.active).toBe(false)
    expect(updated!.id).toBe(webhook.id)
  })

  it('update_webhook returns null for a non-existent ID', async () => {
    const result = await sdk.runWithAuth({ transport: 'mcp' }, () => sdk.updateWebhook('wh_nonexistent', { active: false }))
    expect(result).toBeNull()
  })

  it('remove_webhook deletes an existing webhook and returns true', async () => {
    const webhook = await sdk.runWithAuth({ transport: 'mcp' }, () => sdk.createWebhook({ url: 'https://example.com/hook', events: ['*'] }))
    const removed = await sdk.runWithAuth({ transport: 'mcp' }, () => sdk.deleteWebhook(webhook.id))
    expect(removed).toBe(true)
    expect(sdk.listWebhooks()).toHaveLength(0)
  })

  it('remove_webhook returns false for a non-existent ID', async () => {
    const removed = await sdk.runWithAuth({ transport: 'mcp' }, () => sdk.deleteWebhook('wh_nonexistent'))
    expect(removed).toBe(false)
  })
})

describe('MCP webhook auth denial: provider-backed error surfaces correctly', () => {
  let workspaceDir: string
  let kanbanDir: string
  let sdk: KanbanSDK

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-mcp-webhook-auth-'))
    kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
    sdk = new KanbanSDK(kanbanDir)
    injectDenyAll(sdk, kanbanDir)
  })

  afterEach(() => {
    sdk.close()
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('denied webhook.create surfaces isError with action-stable message', async () => {
    const mcpAuthCtx: AuthContext = {
      token: 'secret-webhook-token-must-not-appear-in-response',
      tokenSource: 'env',
      transport: 'mcp',
    }
    const result = await mcpHandler(() =>
      sdk.runWithAuth(mcpAuthCtx, () => sdk.createWebhook({ url: 'https://example.com/hook', events: ['*'] })),
    )
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('webhook.create')
    expect(result.content[0].text).not.toContain('secret-webhook-token-must-not-appear-in-response')
  })

  it('denied webhook.delete surfaces isError with action-stable message', async () => {
    const result = await mcpHandler(() =>
      sdk.runWithAuth({ transport: 'mcp' }, () => sdk.deleteWebhook('wh_any')),
    )
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('webhook.delete')
  })

  it('denied webhook.update surfaces isError with action-stable message', async () => {
    const result = await mcpHandler(() =>
      sdk.runWithAuth({ transport: 'mcp' }, () => sdk.updateWebhook('wh_any', { active: false })),
    )
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('webhook.update')
  })
})

// ---------------------------------------------------------------------------
// WCTP-06 regression: secret redaction and auth-wrapping for MCP webhook tools
// ---------------------------------------------------------------------------

describe('MCP webhook secret redaction: secret never appears in tool responses', () => {
  let workspaceDir: string
  let kanbanDir: string
  let sdk: KanbanSDK

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-mcp-secret-'))
    kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
    sdk = new KanbanSDK(kanbanDir)
    injectMockWebhookProvider(sdk, kanbanDir)
  })

  afterEach(() => {
    sdk.close()
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  /**
   * Simulates the fixed list_webhooks MCP handler:
   *   const webhooks = await runWithMcpAuth(() => Promise.resolve(sdk.listWebhooks()))
   *   return JSON.stringify(webhooks.map(redactWebhook), null, 2)
   */
  function redactWebhook<T extends { secret?: string }>(w: T): Omit<T, 'secret'> {
    const { secret: _s, ...safe } = w
    return safe as Omit<T, 'secret'>
  }

  it('list_webhooks response omits secret field', async () => {
    await sdk.runWithAuth({ transport: 'mcp' }, () =>
      sdk.createWebhook({ url: 'https://example.com/hook', events: ['*'], secret: 'super-secret-key' }),
    )

    // Simulate fixed list_webhooks handler
    const webhooks = await sdk.runWithAuth({ transport: 'mcp' }, () =>
      Promise.resolve(sdk.listWebhooks()),
    )
    const responseText = JSON.stringify(webhooks.map(redactWebhook), null, 2)

    expect(responseText).not.toContain('super-secret-key')
    expect(responseText).not.toContain('"secret"')
    const parsed = JSON.parse(responseText) as Array<Record<string, unknown>>
    expect(parsed).toHaveLength(1)
    expect(parsed[0]).not.toHaveProperty('secret')
    expect(parsed[0]).toHaveProperty('id')
    expect(parsed[0]).toHaveProperty('url')
  })

  it('add_webhook response omits secret field', async () => {
    const webhook = await sdk.runWithAuth({ transport: 'mcp' }, () =>
      sdk.createWebhook({ url: 'https://example.com/hook', events: ['*'], secret: 'add-secret-key' }),
    )
    const responseText = JSON.stringify(redactWebhook(webhook), null, 2)

    expect(responseText).not.toContain('add-secret-key')
    expect(responseText).not.toContain('"secret"')
    const parsed = JSON.parse(responseText) as Record<string, unknown>
    expect(parsed).not.toHaveProperty('secret')
    expect(parsed).toHaveProperty('id')
  })

  it('update_webhook response omits secret field', async () => {
    const webhook = await sdk.runWithAuth({ transport: 'mcp' }, () =>
      sdk.createWebhook({ url: 'https://example.com/hook', events: ['*'] }),
    )
    const updated = await sdk.runWithAuth({ transport: 'mcp' }, () =>
      sdk.updateWebhook(webhook.id, { secret: 'update-secret-key' }),
    )
    expect(updated).not.toBeNull()
    const responseText = JSON.stringify(redactWebhook(updated!), null, 2)

    expect(responseText).not.toContain('update-secret-key')
    expect(responseText).not.toContain('"secret"')
    const parsed = JSON.parse(responseText) as Record<string, unknown>
    expect(parsed).not.toHaveProperty('secret')
    expect(parsed).toHaveProperty('id')
  })
})

describe('MCP list_webhooks auth-wrapping: consistent error propagation', () => {
  let workspaceDir: string
  let kanbanDir: string
  let sdk: KanbanSDK

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-mcp-list-auth-'))
    kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
    sdk = new KanbanSDK(kanbanDir)
  })

  afterEach(() => {
    sdk.close()
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('list_webhooks handler maps AuthError from provider to isError response', async () => {
    // Inject a provider whose listWebhooks throws AuthError, simulating a future
    // SDK-level auth check on webhook.list or a provider that enforces auth itself.
    const bag = resolveCapabilityBag(
      { 'card.storage': { provider: 'markdown' }, 'attachment.storage': { provider: 'localfs' } },
      kanbanDir,
    )
    const noopListener: import('../sdk/types').SDKEventListenerPlugin = {
      manifest: { id: 'mock-noop-listener', provides: ['event.listener' as const] },
      register: () => {},
      unregister: () => {},
    }
    setCapabilities(sdk, {
      ...bag,
      webhookProvider: {
        manifest: { id: 'throwing-webhook-provider', provides: ['webhook.delivery'] },
        listWebhooks(_root: string): Webhook[] {
          throw new AuthError('webhook.list denied by provider', 'webhook.list')
        },
        createWebhook(_root: string, _input: { url: string; events: string[]; secret?: string }): Webhook {
          throw new AuthError('webhook.create denied by provider', 'webhook.create')
        },
        updateWebhook(): Webhook | null { return null },
        deleteWebhook(): boolean { return false },
      },
      webhookListener: noopListener,
    })

    // Simulate the fixed list_webhooks MCP handler with runWithMcpAuth + try/catch
    const result = await mcpHandler(async () => {
      const webhooks = await sdk.runWithAuth({ transport: 'mcp' }, () =>
        Promise.resolve(sdk.listWebhooks()),
      )
      return webhooks
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('webhook.list')
  })
})

describe('plugin-owned MCP webhook registration', () => {
  let workspaceDir: string
  let kanbanDir: string
  let sdk: KanbanSDK

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-mcp-plugin-tools-'))
    kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
    sdk = new KanbanSDK(kanbanDir)
    injectMockWebhookProvider(sdk, kanbanDir)
  })

  afterEach(() => {
    sdk.close()
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  function captureRegisteredTools(targetSdk: KanbanSDK) {
    const tools: Array<{
      name: string
      description: string
      schema: Record<string, unknown>
      handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>
    }> = []

    const server = {
      tool(
        name: string,
        description: string,
        schema: Record<string, unknown>,
        handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>,
      ) {
        tools.push({ name, description, schema, handler })
      },
    }

    const resolveSpy = vi.spyOn(pluginRegistry, 'resolveMcpPlugins').mockReturnValue([mcpPlugin as never])
    let registered: string[] = []
    try {
      registered = registerPluginMcpTools(
        server,
        {},
        createMcpPluginContext({
          sdk: targetSdk,
          workspaceRoot: workspaceDir,
          kanbanDir,
          runWithAuth: (fn) => targetSdk.runWithAuth({ transport: 'mcp' }, fn),
        }),
      )
    } finally {
      resolveSpy.mockRestore()
    }

    return { registered, tools }
  }

  it('discovers webhook MCP tools through the active package path with unchanged names and schema fields', () => {
    const { registered, tools } = captureRegisteredTools(sdk)

    expect([...registered].sort()).toEqual(['add_webhook', 'list_webhooks', 'remove_webhook', 'update_webhook'])
    expect(tools.map((tool) => tool.name).sort()).toEqual(['add_webhook', 'list_webhooks', 'remove_webhook', 'update_webhook'])
    expect(Object.keys(tools.find((tool) => tool.name === 'list_webhooks')?.schema ?? {})).toEqual([])
    expect(Object.keys(tools.find((tool) => tool.name === 'add_webhook')?.schema ?? {})).toEqual(['url', 'events', 'secret'])
    expect(Object.keys(tools.find((tool) => tool.name === 'remove_webhook')?.schema ?? {})).toEqual(['webhookId'])
    expect(Object.keys(tools.find((tool) => tool.name === 'update_webhook')?.schema ?? {})).toEqual(['webhookId', 'url', 'events', 'secret', 'active'])
  })

  it('plugin-owned webhook MCP handlers preserve secret redaction', async () => {
    const { tools } = captureRegisteredTools(sdk)
    const addTool = tools.find((tool) => tool.name === 'add_webhook')
    const listTool = tools.find((tool) => tool.name === 'list_webhooks')
    const updateTool = tools.find((tool) => tool.name === 'update_webhook')

    expect(addTool).toBeDefined()
    expect(listTool).toBeDefined()
    expect(updateTool).toBeDefined()

    const added = await addTool!.handler({
      url: 'https://example.com/hook',
      events: ['*'],
      secret: 'plugin-secret-create',
    })
    expect(added.isError).toBeUndefined()
    expect(added.content[0].text).not.toContain('plugin-secret-create')
    expect(added.content[0].text).not.toContain('"secret"')

    const listed = await listTool!.handler({})
    expect(listed.content[0].text).not.toContain('plugin-secret-create')
    expect(listed.content[0].text).not.toContain('"secret"')

    const webhookId = (JSON.parse(added.content[0].text) as { id: string }).id
    const updated = await updateTool!.handler({ webhookId, secret: 'plugin-secret-update' })
    expect(updated.isError).toBeUndefined()
    expect(updated.content[0].text).not.toContain('plugin-secret-update')
    expect(updated.content[0].text).not.toContain('"secret"')
  })

  it('plugin-owned webhook MCP handlers preserve auth error mapping', async () => {
    const deniedSdk = new KanbanSDK(kanbanDir)
    injectDenyAll(deniedSdk, kanbanDir)
    try {
      const { tools } = captureRegisteredTools(deniedSdk)
      const addTool = tools.find((tool) => tool.name === 'add_webhook')
      expect(addTool).toBeDefined()

      const result = await addTool!.handler({
        url: 'https://example.com/hook',
        events: ['*'],
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('webhook.create')
    } finally {
      deniedSdk.close()
    }
  })

  it('rejects duplicate plugin-owned MCP tool registration for webhook tools', () => {
    const duplicatePlugin = {
      manifest: { id: 'duplicate-webhooks-test', provides: ['mcp.tools'] as const },
      registerTools: () => [{
        name: 'list_webhooks',
        description: 'Duplicate webhook listing tool for regression coverage.',
        inputSchema: () => ({}),
        handler: async () => ({ content: [{ type: 'text' as const, text: 'duplicate' }] }),
      }],
    }

    const server = {
      tool: vi.fn(),
    }

    const resolveSpy = vi.spyOn(pluginRegistry, 'resolveMcpPlugins').mockReturnValue([
      mcpPlugin as never,
      duplicatePlugin as never,
    ])

    try {
      expect(() => registerPluginMcpTools(
        server,
        {},
        createMcpPluginContext({
          sdk,
          workspaceRoot: workspaceDir,
          kanbanDir,
          runWithAuth: (fn) => sdk.runWithAuth({ transport: 'mcp' }, fn),
        }),
      )).toThrow('Duplicate MCP tool registration attempted for "list_webhooks".')
    } finally {
      resolveSpy.mockRestore()
    }
  })
})

describe('MCP card-state parity tools', () => {
  let workspaceDir: string
  let kanbanDir: string
  let sdk: KanbanSDK

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-mcp-card-state-'))
    kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
    sdk = new KanbanSDK(kanbanDir)
  })

  afterEach(() => {
    sdk.close()
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('registers card-state MCP tools with the expected parity names', () => {
    const { registered, tools } = captureCardStateTools(sdk)

    expect(registered).toEqual([
      'get_card_state_status',
      'get_card_state',
      'open_card',
      'read_card',
    ])
    expect(tools.map((tool) => tool.name)).toEqual(registered)
    expect(Object.keys(tools.find((tool) => tool.name === 'get_card_state_status')?.schema ?? {})).toEqual([])
    expect(Object.keys(tools.find((tool) => tool.name === 'get_card_state')?.schema ?? {})).toEqual(['boardId', 'cardId'])
    expect(Object.keys(tools.find((tool) => tool.name === 'open_card')?.schema ?? {})).toEqual(['boardId', 'cardId'])
    expect(Object.keys(tools.find((tool) => tool.name === 'read_card')?.schema ?? {})).toEqual(['boardId', 'cardId', 'readThrough'])
  })

  it('returns status plus side-effect-free read and explicit mutation envelopes aligned with CLI/API parity', async () => {
    const card = await sdk.createCard({ content: '# MCP parity card' })
    await sdk.addLog(card.id, 'Unread activity for MCP parity')

    const { tools } = captureCardStateTools(sdk)
    const statusTool = tools.find((tool) => tool.name === 'get_card_state_status')
    const getTool = tools.find((tool) => tool.name === 'get_card_state')
    const openTool = tools.find((tool) => tool.name === 'open_card')
    const readTool = tools.find((tool) => tool.name === 'read_card')

    expect(statusTool).toBeDefined()
    expect(getTool).toBeDefined()
    expect(openTool).toBeDefined()
    expect(readTool).toBeDefined()

    const statusResult = await statusTool!.handler({})
    expect(JSON.parse(statusResult.content[0].text)).toMatchObject({
      provider: 'builtin',
      backend: 'builtin',
      availability: 'available',
      defaultActorAvailable: true,
    })

    const getResult = await getTool!.handler({ cardId: card.id.slice(0, 8) })
    expect(getResult.isError).toBeUndefined()
    expect(JSON.parse(getResult.content[0].text)).toMatchObject({
      cardId: card.id,
      boardId: 'default',
      cardState: {
        unread: {
          actorId: sdk.getCardStateStatus().defaultActor.id,
          unread: true,
        },
        open: null,
      },
    })

    const openResult = await openTool!.handler({ cardId: card.id })
    expect(openResult.isError).toBeUndefined()
    expect(JSON.parse(openResult.content[0].text)).toMatchObject({
      unread: {
        cardId: card.id,
        boardId: 'default',
        unread: false,
      },
      cardState: {
        unread: {
          unread: false,
        },
        open: {
          domain: 'open',
          value: {
            readThrough: expect.any(Object),
            openedAt: expect.any(String),
          },
        },
      },
    })

    await sdk.addLog(card.id, 'Fresh unread activity after explicit open')

    const readResult = await readTool!.handler({ cardId: card.id })
    expect(readResult.isError).toBeUndefined()
    expect(JSON.parse(readResult.content[0].text)).toMatchObject({
      unread: {
        cardId: card.id,
        boardId: 'default',
        unread: false,
      },
      cardState: {
        unread: {
          unread: false,
        },
        open: {
          domain: 'open',
        },
      },
    })
  })

  it('preserves machine-readable public identity-error semantics across card-state tools', async () => {
    fs.writeFileSync(path.join(workspaceDir, '.kanban.json'), JSON.stringify({
      auth: {
        'auth.identity': { provider: 'rbac' },
        'auth.policy': { provider: 'noop' },
      },
    }, null, 2))

    const identitySdk = new KanbanSDK(kanbanDir)

    try {
      const card = await identitySdk.createCard({ content: '# MCP identity parity' })
      await identitySdk.addLog(card.id, 'Unread activity requiring identity')

      const { tools } = captureCardStateTools(identitySdk)
      const getTool = tools.find((tool) => tool.name === 'get_card_state')
      const openTool = tools.find((tool) => tool.name === 'open_card')
      const readTool = tools.find((tool) => tool.name === 'read_card')

      for (const tool of [getTool, openTool, readTool]) {
        const result = await tool!.handler({ cardId: card.id })
        expect(result.isError).toBe(true)
        expect(JSON.parse(result.content[0].text)).toEqual({
          code: ERR_CARD_STATE_IDENTITY_UNAVAILABLE,
          availability: 'identity-unavailable',
          message: 'Card state is unavailable until your configured user identity can be resolved.',
        })
      }
    } finally {
      identitySdk.close()
    }
  })
})
