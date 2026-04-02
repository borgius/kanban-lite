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
import { Client } from '../../node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'
import { StdioClientTransport } from '../../node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js'
import { createMcpPluginContext, registerCardStateMcpTools, registerChecklistMcpTools, registerPluginMcpTools, registerPluginSettingsMcpTools } from './index'
import { createPluginSettingsErrorPayload, KanbanSDK, PluginSettingsOperationError } from '../sdk/KanbanSDK'
import * as pluginRegistry from '../sdk/plugins'
import { createBuiltinAuthListenerPlugin, resolveCapabilityBag } from '../sdk/plugins'
import { AuthError, ERR_CARD_STATE_IDENTITY_UNAVAILABLE } from '../sdk/types'
import type { AuthContext, AuthDecision } from '../sdk/types'
import type { AuthIdentity } from '../sdk/plugins'
import type { SDKEventListenerPlugin } from '../sdk/types'
import type { Webhook } from '../shared/config'
import { mcpPlugin } from '../../../kl-plugin-webhook/src/index'

const REPO_ROOT = path.resolve(__dirname, '../../../..')
const TSX_CLI_PATH = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const MCP_ENTRYPOINT = path.join(REPO_ROOT, 'packages/kanban-lite/src/mcp-server/index.ts')

type CapabilityBag = ReturnType<typeof resolveCapabilityBag>

type McpTextResult = {
  content?: Array<{ type?: string; text?: string }>
  isError?: boolean
}

type PluginSettingsRunWithAuth = Parameters<typeof registerPluginSettingsMcpTools>[1]['runWithAuth']
type PluginSettingsRunWithAuthMock = PluginSettingsRunWithAuth & ReturnType<typeof vi.fn<(fn: () => Promise<unknown>) => Promise<unknown>>>

function createPluginSettingsRunWithAuthMock(
  implementation: (fn: () => Promise<unknown>) => Promise<unknown>,
): PluginSettingsRunWithAuthMock {
  const mock = vi.fn<(fn: () => Promise<unknown>) => Promise<unknown>>(implementation)
  return Object.assign(
    ((fn: () => Promise<unknown>) => mock(fn)) as PluginSettingsRunWithAuth,
    mock,
  )
}

function makeMcpCardContent(opts: {
  id: string
  title: string
  labels: string[]
  order: string
}): string {
  const { id, title, labels, order } = opts
  return `---
id: "${id}"
status: "backlog"
priority: "medium"
assignee: null
dueDate: null
created: "2026-03-31T00:00:00.000Z"
modified: "2026-03-31T00:00:00.000Z"
completedAt: null
labels: [${labels.map((label) => `"${label}"`).join(', ')}]
attachments: []
order: "${order}"
---
# ${title}

MCP visibility fixture.
`
}

function writeMcpCardFile(kanbanDir: string, filename: string, content: string, status = 'backlog'): string {
  const targetDir = path.join(kanbanDir, 'boards', 'default', status)
  fs.mkdirSync(targetDir, { recursive: true })
  const filePath = path.join(targetDir, filename)
  fs.writeFileSync(filePath, content, 'utf-8')
  return filePath
}

function installTempMcpPlugin(packageName: string, entrySource: string): () => void {
  const packageDir = path.join(REPO_ROOT, 'node_modules', packageName)
  fs.mkdirSync(packageDir, { recursive: true })
  fs.writeFileSync(
    path.join(packageDir, 'package.json'),
    JSON.stringify({ name: packageName, main: 'index.js' }, null, 2),
    'utf-8',
  )
  fs.writeFileSync(path.join(packageDir, 'index.js'), entrySource, 'utf-8')
  return () => fs.rmSync(packageDir, { recursive: true, force: true })
}

function createVisibilityScopedAuthIdentityPluginSource(packageName: string): string {
  return `module.exports = {
  authIdentityPlugin: {
    manifest: { id: '${packageName}', provides: ['auth.identity'] },
    async resolveIdentity(context) {
      const rawToken = context && typeof context.token === 'string' ? context.token : ''
      const token = rawToken.startsWith('Bearer ') ? rawToken.slice(7) : rawToken
      if (token === 'reader-token') return { subject: 'alice', roles: ['reader'] }
      if (token === 'writer-token') return { subject: 'casey', roles: ['writer'] }
      return null
    },
  },
}
`
}

function readMcpTextContent(result: unknown): string {
  if (!result || typeof result !== 'object') return 'null'
  const content = (result as McpTextResult).content
  if (!Array.isArray(content) || content.length === 0) return 'null'
  const first = content[0]
  return first?.type === 'text' && typeof first.text === 'string' ? first.text : 'null'
}

async function createMcpVisibilityWorkspace(packageName: string): Promise<{
  workspaceRoot: string
  kanbanDir: string
  configPath: string
  publicCardId: string
  privateCardId: string
  cleanup: () => void
}> {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-mcp-auth-visibility-'))
  const kanbanDir = path.join(workspaceRoot, '.kanban')
  const configPath = path.join(workspaceRoot, '.kanban.json')
  const publicCardId = 'public-card'
  const privateCardId = 'private-card'
  const hiddenAttachmentPath = path.join(workspaceRoot, 'hidden-attachment.txt')

  fs.mkdirSync(kanbanDir, { recursive: true })
  writeMcpCardFile(
    kanbanDir,
    `${publicCardId}.md`,
    makeMcpCardContent({
      id: publicCardId,
      title: 'Public card',
      labels: ['public'],
      order: 'a0',
    }),
  )
  writeMcpCardFile(
    kanbanDir,
    `${privateCardId}.md`,
    makeMcpCardContent({
      id: privateCardId,
      title: 'Private card',
      labels: ['private'],
      order: 'a1',
    }),
  )
  fs.writeFileSync(hiddenAttachmentPath, 'hidden attachment', 'utf-8')
  fs.writeFileSync(
    path.join(kanbanDir, '.active-card.json'),
    JSON.stringify({
      cardId: privateCardId,
      boardId: 'default',
      updatedAt: '2026-03-31T00:00:00.000Z',
    }),
    'utf-8',
  )

  const sdk = new KanbanSDK(kanbanDir)
  await sdk.init()
  try {
    await sdk.addComment(privateCardId, 'seed-user', 'Hidden comment')
    await sdk.addLog(privateCardId, 'Hidden log')
    await sdk.addAttachment(privateCardId, hiddenAttachmentPath)
  } finally {
    sdk.close()
  }

  fs.writeFileSync(
    configPath,
    JSON.stringify({
      version: 2,
      defaultBoard: 'default',
      kanbanDirectory: '.kanban',
      boards: {
        default: {
          name: 'Default',
          columns: [{ id: 'backlog', name: 'Backlog' }],
          nextCardId: 1,
          defaultStatus: 'backlog',
          defaultPriority: 'medium',
        },
      },
      plugins: {
        'auth.identity': { provider: packageName },
        'auth.policy': { provider: 'noop' },
        'auth.visibility': {
          provider: 'kl-plugin-auth-visibility',
          options: {
            rules: [
              { roles: ['writer'], labels: ['public', 'private'] },
              { roles: ['reader'], labels: ['public'] },
            ],
          },
        },
      },
    }, null, 2) + '\n',
    'utf-8',
  )

  return {
    workspaceRoot,
    kanbanDir,
    configPath,
    publicCardId,
    privateCardId,
    cleanup: () => fs.rmSync(workspaceRoot, { recursive: true, force: true }),
  }
}

async function withMcpClient<T>(
  workspace: { workspaceRoot: string; kanbanDir: string; configPath: string },
  token: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      TSX_CLI_PATH,
      MCP_ENTRYPOINT,
      '--dir',
      workspace.kanbanDir,
      '--config',
      workspace.configPath,
    ],
    cwd: workspace.workspaceRoot,
    env: { ...process.env, NO_COLOR: '1', KANBAN_LITE_TOKEN: token, KANBAN_TOKEN: '' },
    stderr: 'pipe',
  })
  const client = new Client({ name: 'kanban-lite-auth-visibility-test-client', version: '1.0.0' })

  try {
    await client.connect(transport)
    return await fn(client)
  } finally {
    await transport.close().catch(() => undefined)
  }
}

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

function capturePluginSettingsTools(targetSdk: KanbanSDK) {
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

  const registered = registerPluginSettingsMcpTools(server, {
    sdk: targetSdk,
    runWithAuth: (fn) => targetSdk.runWithAuth({ transport: 'mcp' }, fn),
  })

  return { registered, tools }
}

function captureChecklistTools(targetSdk: KanbanSDK) {
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

  const registered = registerChecklistMcpTools(server, {
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
      sdk.runWithAuth(mcpAuthCtx, () => sdk.createBoard('new-board', 'New Board')),
    )

    expect(result.isError).toBe(true)
    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe('text')
    expect(result.content[0].text).toContain('board.create')
    expect(result.content[0].text).not.toContain('secret-mcp-token-must-not-appear-in-response')
  })

  it('denied delete_board produces isError: true with stable message', async () => {
    const result = await mcpHandler(() =>
      sdk.runWithAuth({ transport: 'mcp' }, () => sdk.deleteBoard('default')),
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
    const { secret, ...safe } = w
    void secret
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
          throw new AuthError('auth.policy.denied', 'webhook.list denied by provider')
        },
        createWebhook(_root: string, _input: { url: string; events: string[]; secret?: string }): Webhook {
          throw new AuthError('auth.policy.denied', 'webhook.create denied by provider')
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

  it('keeps widened MCP plugin contexts compatible with full public SDK reads', async () => {
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

    const probePlugin = {
      manifest: { id: 'sdk-seam-probe', provides: ['mcp.tools'] as const },
      registerTools: (ctx: ReturnType<typeof createMcpPluginContext>) => [{
        name: 'sdk_snapshot_probe',
        description: 'Regression probe for widened MCP SDK context.',
        inputSchema: () => ({}),
        handler: async () => ({
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              hasGetConfigSnapshot: typeof ctx.sdk.getConfigSnapshot === 'function',
              hasGetBoard: typeof ctx.sdk.getBoard === 'function',
              hasGetExtension: typeof ctx.sdk.getExtension === 'function',
              defaultBoard: ctx.sdk.getConfigSnapshot().defaultBoard,
              defaultBoardName: ctx.sdk.getBoard('default').name,
              workspaceRoot: ctx.sdk.workspaceRoot,
            }),
          }],
        }),
      }],
    }

    const resolveSpy = vi.spyOn(pluginRegistry, 'resolveMcpPlugins').mockReturnValue([
      mcpPlugin as never,
      probePlugin as never,
    ])

    try {
      const registered = registerPluginMcpTools(
        server,
        {},
        createMcpPluginContext({
          sdk,
          workspaceRoot: workspaceDir,
          kanbanDir,
          runWithAuth: (fn) => sdk.runWithAuth({ transport: 'mcp' }, fn),
        }),
      )

      expect(registered).toContain('sdk_snapshot_probe')
      const probeTool = tools.find((tool) => tool.name === 'sdk_snapshot_probe')
      expect(probeTool).toBeDefined()

      const result = await probeTool!.handler({})
      expect(JSON.parse(result.content[0].text)).toEqual({
        hasGetConfigSnapshot: true,
        hasGetBoard: true,
        hasGetExtension: true,
        defaultBoard: 'default',
        defaultBoardName: 'Default',
        workspaceRoot: workspaceDir,
      })
    } finally {
      resolveSpy.mockRestore()
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

describe('MCP plugin-settings parity tools', () => {
  let workspaceDir: string
  let kanbanDir: string
  let sdk: KanbanSDK

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-mcp-plugin-settings-'))
    kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
    fs.writeFileSync(path.join(workspaceDir, '.kanban.json'), JSON.stringify({
      plugins: {
        'auth.identity': {
          provider: 'local',
          options: {
            apiToken: 'mcp-super-secret-token',
            users: [{ username: 'alice', password: 'mcp-super-secret-password', role: 'admin' }],
          },
        },
        'auth.policy': { provider: 'noop' },
      },
    }, null, 2))
    sdk = new KanbanSDK(kanbanDir)
  })

  afterEach(() => {
    sdk.close()
    vi.restoreAllMocks()
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('registers plugin-settings MCP tools with stable parity names and schema fields', () => {
    const { registered, tools } = capturePluginSettingsTools(sdk)

    expect(registered).toEqual([
      'list_plugin_settings',
      'select_plugin_settings_provider',
      'update_plugin_settings_options',
      'install_plugin_settings_package',
    ])
    expect(tools.map((tool) => tool.name)).toEqual(registered)
    expect(Object.keys(tools.find((tool) => tool.name === 'list_plugin_settings')?.schema ?? {})).toEqual([])
    expect(Object.keys(tools.find((tool) => tool.name === 'select_plugin_settings_provider')?.schema ?? {})).toEqual(['capability', 'providerId'])
    expect(Object.keys(tools.find((tool) => tool.name === 'update_plugin_settings_options')?.schema ?? {})).toEqual(['capability', 'providerId', 'options'])
    expect(Object.keys(tools.find((tool) => tool.name === 'install_plugin_settings_package')?.schema ?? {})).toEqual(['packageName', 'scope'])
  })

  it('returns redacted plugin-settings payloads for list and update flows', async () => {
    const { tools } = capturePluginSettingsTools(sdk)
    const listTool = tools.find((tool) => tool.name === 'list_plugin_settings')
    const updateTool = tools.find((tool) => tool.name === 'update_plugin_settings_options')

    expect(listTool).toBeDefined()
    expect(updateTool).toBeDefined()

    const listResult = await listTool!.handler({})
    expect(listResult.isError).toBeUndefined()
    expect(listResult.content[0].text).not.toContain('mcp-super-secret-token')
    expect(listResult.content[0].text).not.toContain('mcp-super-secret-password')

    const updateResult = await updateTool!.handler({
      capability: 'auth.identity',
      providerId: 'local',
      options: {
        apiToken: 'updated-mcp-secret',
        users: [{ username: 'alice', password: '$2b$12$updated-hash', role: 'manager' }],
      },
    })

    expect(updateResult.isError).toBeUndefined()
    expect(JSON.parse(updateResult.content[0].text)).toMatchObject({
      capability: 'auth.identity',
      providerId: 'local',
      selected: {
        capability: 'auth.identity',
        providerId: 'local',
        source: 'config',
      },
      options: {
        values: {
          apiToken: '••••••',
          users: [{ username: 'alice', password: '••••••', role: 'manager' }],
        },
        redactedPaths: expect.arrayContaining(['apiToken', 'users[0].password']),
      },
    })
    expect(updateResult.content[0].text).not.toContain('updated-mcp-secret')
    expect(updateResult.content[0].text).not.toContain('$2b$12$updated-hash')
  })

  it('routes list_plugin_settings through scoped auth and preserves MCP auth errors', async () => {
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
    const runWithAuth = createPluginSettingsRunWithAuthMock(async (fn) => {
      void fn
      throw new AuthError('auth.policy.denied', 'plugin-settings.read denied for MCP')
    })

    registerPluginSettingsMcpTools(server, {
      sdk,
      runWithAuth,
    })

    const listTool = tools.find((tool) => tool.name === 'list_plugin_settings')
    expect(listTool).toBeDefined()

    const result = await listTool!.handler({})

    expect(runWithAuth).toHaveBeenCalledOnce()
    expect(result).toEqual({
      content: [{ type: 'text', text: 'plugin-settings.read denied for MCP' }],
      isError: true,
    })
  })

  it('returns structured redacted install errors instead of raw exception strings', async () => {
    const { tools } = capturePluginSettingsTools(sdk)
    const installTool = tools.find((tool) => tool.name === 'install_plugin_settings_package')

    expect(installTool).toBeDefined()

    vi.spyOn(sdk, 'installPluginSettingsPackage').mockRejectedValue(
      new PluginSettingsOperationError(createPluginSettingsErrorPayload({
        code: 'plugin-settings-install-failed',
        message: 'Unable to install plugin package. In-product installs disable lifecycle scripts; install the package manually if it requires lifecycle scripts.',
        details: {
          packageName: 'kl-plugin-auth',
          scope: 'workspace',
          exitCode: 1,
          stderr: 'Authorization: Bearer [REDACTED]\npassword=[REDACTED]',
        },
      })),
    )

    const result = await installTool!.handler({
      packageName: 'kl-plugin-auth',
      scope: 'workspace',
    })

    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      code: 'plugin-settings-install-failed',
      message: 'Unable to install plugin package. In-product installs disable lifecycle scripts; install the package manually if it requires lifecycle scripts.',
      details: {
        packageName: 'kl-plugin-auth',
        scope: 'workspace',
        exitCode: 1,
        stderr: 'Authorization: Bearer [REDACTED]\npassword=[REDACTED]',
      },
      redaction: {
        maskedValue: '••••••',
        writeOnly: true,
      },
    })
    expect(result.content[0].text).not.toContain('npm_super_secret_token')
    expect(result.content[0].text).not.toContain('super-secret-password')
  })

  it('rejects invalid plugin install package names through the shared SDK guardrail', async () => {
    const { tools } = capturePluginSettingsTools(sdk)
    const installTool = tools.find((tool) => tool.name === 'install_plugin_settings_package')

    expect(installTool).toBeDefined()

    const result = await installTool!.handler({
      packageName: 'kl-plugin-auth --save-dev',
      scope: 'workspace',
    })

    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      code: 'invalid-plugin-install-package-name',
      message: 'Plugin install requests must use an exact unscoped kl-* package name with no version specifier, flag, URL, path, whitespace, or shell fragment.',
      redaction: {
        maskedValue: '••••••',
        writeOnly: true,
      },
    })
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
      provider: 'localfs',
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

describe('MCP checklist tools', () => {
  let workspaceDir: string
  let kanbanDir: string
  let sdk: KanbanSDK

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-mcp-checklist-'))
    kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
    sdk = new KanbanSDK(kanbanDir)
  })

  afterEach(() => {
    sdk.close()
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('registers checklist MCP tools with explicit expectedRaw contracts', () => {
    const { registered, tools } = captureChecklistTools(sdk)

    expect(registered).toEqual([
      'list_card_checklist_items',
      'add_card_checklist_item',
      'edit_card_checklist_item',
      'delete_card_checklist_item',
      'check_card_checklist_item',
      'uncheck_card_checklist_item',
    ])
    expect(tools.map((tool) => tool.name)).toEqual(registered)
    expect(Object.keys(tools.find((tool) => tool.name === 'list_card_checklist_items')?.schema ?? {})).toEqual(['boardId', 'cardId'])
    expect(Object.keys(tools.find((tool) => tool.name === 'add_card_checklist_item')?.schema ?? {})).toEqual(['boardId', 'cardId', 'text', 'expectedToken'])
    expect(Object.keys(tools.find((tool) => tool.name === 'edit_card_checklist_item')?.schema ?? {})).toEqual(['boardId', 'cardId', 'index', 'text', 'expectedRaw'])
    expect(Object.keys(tools.find((tool) => tool.name === 'check_card_checklist_item')?.schema ?? {})).toEqual(['boardId', 'cardId', 'index', 'expectedRaw'])
  })

  it('returns checklist items plus optimistic-concurrency values through the MCP checklist tools', async () => {
    const card = await sdk.createCard({ content: '# MCP checklist', tasks: ['- [ ] First task'] })
    const { tools } = captureChecklistTools(sdk)

    const listTool = tools.find((tool) => tool.name === 'list_card_checklist_items')
    const addTool = tools.find((tool) => tool.name === 'add_card_checklist_item')
    const checkTool = tools.find((tool) => tool.name === 'check_card_checklist_item')

    expect(listTool).toBeDefined()
    expect(addTool).toBeDefined()
    expect(checkTool).toBeDefined()

    const listed = JSON.parse(readMcpTextContent(await listTool!.handler({ cardId: card.id })))
    expect(listed).toMatchObject({
      cardId: card.id,
      boardId: 'default',
      summary: {
        total: 1,
        completed: 0,
        incomplete: 1,
      },
      items: [
        {
          index: 0,
          raw: '- [ ] First task',
          expectedRaw: '- [ ] First task',
          checked: false,
          text: 'First task',
        },
      ],
    })
    expect(listed.token).toMatch(/^cl1:/)

    const added = JSON.parse(readMcpTextContent(await addTool!.handler({
      cardId: card.id,
      text: 'Second task',
      expectedToken: listed.token,
    })))
    expect(added.summary).toEqual({ total: 2, completed: 0, incomplete: 2 })
    expect(added.token).toMatch(/^cl1:/)

    const checked = JSON.parse(readMcpTextContent(await checkTool!.handler({
      cardId: card.id,
      index: 1,
      expectedRaw: '- [ ] Second task',
    })))
    expect(checked).toMatchObject({
      cardId: card.id,
      boardId: 'default',
      summary: {
        total: 2,
        completed: 1,
        incomplete: 1,
      },
      items: [
        {
          index: 0,
          raw: '- [ ] First task',
          expectedRaw: '- [ ] First task',
          checked: false,
          text: 'First task',
        },
        {
          index: 1,
          raw: '- [x] Second task',
          expectedRaw: '- [x] Second task',
          checked: true,
          text: 'Second task',
        },
      ],
    })
    expect(checked.token).toMatch(/^cl1:/)
  })
})

describe('MCP auth visibility parity', () => {
  it('uses MCP auth scope for list_cards, get_card, and get_active_card while preserving visible multiple-match UX', async () => {
    const packageName = `kanban-mcp-auth-visibility-${Date.now()}-reads`
    const cleanupPlugin = installTempMcpPlugin(
      packageName,
      createVisibilityScopedAuthIdentityPluginSource(packageName),
    )
    const workspace = await createMcpVisibilityWorkspace(packageName)

    try {
      await withMcpClient(workspace, 'reader-token', async (client) => {
        const listResult = await client.callTool({ name: 'list_cards', arguments: {} })
        expect(JSON.parse(readMcpTextContent(listResult))).toEqual([
          expect.objectContaining({ id: workspace.publicCardId }),
        ])

        const activeResult = await client.callTool({ name: 'get_active_card', arguments: {} })
        expect(JSON.parse(readMcpTextContent(activeResult))).toBeNull()

        const getResult = await client.callTool({ name: 'get_card', arguments: { cardId: 'card' } })
        expect(JSON.parse(readMcpTextContent(getResult))).toMatchObject({ id: workspace.publicCardId })
      })

      await withMcpClient(workspace, 'writer-token', async (client) => {
        const getResult = await client.callTool({ name: 'get_card', arguments: { cardId: 'card' } })
        expect((getResult as McpTextResult).isError).toBe(true)
        expect(readMcpTextContent(getResult)).toContain('Multiple cards match "card": public-card, private-card')
      })
    } finally {
      workspace.cleanup()
      cleanupPlugin()
    }
  })

  it('uses MCP auth scope for card-targeted list tools and mutation preflight resolution', async () => {
    const packageName = `kanban-mcp-auth-visibility-${Date.now()}-targets`
    const cleanupPlugin = installTempMcpPlugin(
      packageName,
      createVisibilityScopedAuthIdentityPluginSource(packageName),
    )
    const workspace = await createMcpVisibilityWorkspace(packageName)

    try {
      await withMcpClient(workspace, 'reader-token', async (client) => {
        for (const toolName of ['list_attachments', 'list_comments', 'list_logs']) {
          const result = await client.callTool({ name: toolName, arguments: { cardId: workspace.privateCardId } })
          expect((result as McpTextResult).isError).toBe(true)
          expect(readMcpTextContent(result)).toBe(`Card not found: ${workspace.privateCardId}`)
        }

        const addComment = await client.callTool({
          name: 'add_comment',
          arguments: {
            cardId: 'card',
            author: 'reader',
            content: 'partial visible comment',
          },
        })
        expect((addComment as McpTextResult).isError).toBeUndefined()
        expect(JSON.parse(readMcpTextContent(addComment))).toMatchObject({
          author: 'reader',
          content: 'partial visible comment',
        })

        const publicCard = await client.callTool({ name: 'get_card', arguments: { cardId: workspace.publicCardId } })
        expect(JSON.parse(readMcpTextContent(publicCard))).toMatchObject({
          id: workspace.publicCardId,
          comments: [expect.objectContaining({ author: 'reader', content: 'partial visible comment' })],
        })
      })
    } finally {
      workspace.cleanup()
      cleanupPlugin()
    }
  })
})
