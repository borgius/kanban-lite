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
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { KanbanSDK } from '../sdk/KanbanSDK'
import { resolveCapabilityBag } from '../sdk/plugins'
import { AuthError } from '../sdk/types'
import type { AuthContext, AuthDecision } from '../sdk/types'
import type { AuthIdentity } from '../sdk/plugins'
import type { EventListenerPlugin } from '../sdk/types'
import type { Webhook } from '../shared/config'

type CapabilityBag = ReturnType<typeof resolveCapabilityBag>

function setCapabilities(sdk: KanbanSDK, bag: CapabilityBag): void {
  ;(sdk as unknown as { _capabilities: CapabilityBag | null })._capabilities = bag
}

function injectDenyAll(sdk: KanbanSDK, kanbanDir: string): void {
  const bag = resolveCapabilityBag(
    { 'card.storage': { provider: 'markdown' }, 'attachment.storage': { provider: 'localfs' } },
    kanbanDir,
  )
  setCapabilities(sdk, {
    ...bag,
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
  const noopListener: EventListenerPlugin = {
    manifest: { id: 'mock-webhook-listener', provides: ['event.listener'] as const },
    init: () => {},
    destroy: () => {},
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
      createListener(_root: string): EventListenerPlugin {
        return noopListener
      },
    },
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
    const webhook = await sdk.createWebhook({ url: 'https://example.com/hook', events: ['*'] }, { transport: 'mcp' })
    expect(webhook.id).toMatch(/^wh_/)
    expect(webhook.url).toBe('https://example.com/hook')
    expect(webhook.events).toEqual(['*'])
    expect(webhook.active).toBe(true)

    const listed = sdk.listWebhooks()
    expect(listed).toHaveLength(1)
    expect(listed[0].id).toBe(webhook.id)
  })

  it('update_webhook modifies an existing webhook', async () => {
    const webhook = await sdk.createWebhook({ url: 'https://example.com/hook', events: ['*'] }, { transport: 'mcp' })
    const updated = await sdk.updateWebhook(webhook.id, { active: false }, { transport: 'mcp' })
    expect(updated).not.toBeNull()
    expect(updated!.active).toBe(false)
    expect(updated!.id).toBe(webhook.id)
  })

  it('update_webhook returns null for a non-existent ID', async () => {
    const result = await sdk.updateWebhook('wh_nonexistent', { active: false }, { transport: 'mcp' })
    expect(result).toBeNull()
  })

  it('remove_webhook deletes an existing webhook and returns true', async () => {
    const webhook = await sdk.createWebhook({ url: 'https://example.com/hook', events: ['*'] }, { transport: 'mcp' })
    const removed = await sdk.deleteWebhook(webhook.id, { transport: 'mcp' })
    expect(removed).toBe(true)
    expect(sdk.listWebhooks()).toHaveLength(0)
  })

  it('remove_webhook returns false for a non-existent ID', async () => {
    const removed = await sdk.deleteWebhook('wh_nonexistent', { transport: 'mcp' })
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
    const result = await mcpHandler(() =>
      sdk.createWebhook({ url: 'https://example.com/hook', events: ['*'] }, { transport: 'mcp' }),
    )
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('webhook.create')
  })

  it('denied webhook.delete surfaces isError with action-stable message', async () => {
    const result = await mcpHandler(() =>
      sdk.deleteWebhook('wh_any', { transport: 'mcp' }),
    )
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('webhook.delete')
  })

  it('denied webhook.update surfaces isError with action-stable message', async () => {
    const result = await mcpHandler(() =>
      sdk.updateWebhook('wh_any', { active: false }, { transport: 'mcp' }),
    )
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('webhook.update')
  })
})
