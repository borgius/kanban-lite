import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as http from 'http'
import { createRequire } from 'module'
import { WebSocket } from 'ws'
import { vi } from 'vitest'
import { startServer } from '../server'
import { broadcast } from '../broadcastService'
import { KanbanSDK, PluginSettingsOperationError, createPluginSettingsErrorPayload } from '../../sdk/KanbanSDK'
import { buildChecklistReadModel } from '../../sdk/modules/checklist'
import { CardStateError, ERR_CARD_STATE_UNAVAILABLE } from '../../sdk/types'
import type { CardTask } from '../../shared/types'

type CardStateReadPayload = {
  unread?: Record<string, unknown> | null
  open?: Record<string, unknown> | null
}

type StandaloneInitCardPayload = Record<string, unknown> & {
  id?: string
  cardState?: CardStateReadPayload
}

// Helper: create a temp directory for cards
function createTempDir(): string {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-test-workspace-'))
  const kanbanDir = path.join(workspaceRoot, '.kanban')
  fs.mkdirSync(kanbanDir, { recursive: true })
  return kanbanDir
}

// Helper: write a card markdown file
// Files are stored under boards/default/{status}/ in the multi-board layout
function writeCardFile(dir: string, filename: string, content: string, subfolder?: string): string {
  const targetDir = subfolder ? path.join(dir, 'boards', 'default', subfolder) : path.join(dir, 'boards', 'default')
  fs.mkdirSync(targetDir, { recursive: true })
  const filePath = path.join(targetDir, filename)
  fs.writeFileSync(filePath, content, 'utf-8')
  return filePath
}

// Helper: create a standard card file content
function makeCardContent(opts: {
  id: string
  status?: string
  priority?: string
  title?: string
  order?: string
  assignee?: string | null
  dueDate?: string | null
  labels?: string[]
  attachments?: string[]
  body?: string
  metadataBlock?: string
}): string {
  const {
    id,
    status = 'backlog',
    priority = 'medium',
    title = 'Test Card',
    order = 'a0',
    assignee = null,
    dueDate = null,
    labels = [],
    attachments = [],
    body = 'Description here.',
    metadataBlock
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
attachments: [${attachments.map(a => `"${a}"`).join(', ')}]
order: "${order}"
${metadataBlock ? `metadata:\n${metadataBlock.split('\n').map(line => `  ${line}`).join('\n')}\n` : ''}---
# ${title}

${body}`
}

// Helper: connect WebSocket and wait for open
function connectWs(port: number, headers?: Record<string, string>): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`, { headers })
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

function sendAndReceiveMatching(
  ws: WebSocket,
  message: unknown,
  expectedType: string,
  predicate: (parsed: Record<string, unknown>) => boolean,
  timeout = 5000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${expectedType}`)), timeout)

    const handler = (data: Buffer | string) => {
      try {
        const parsed = JSON.parse(data.toString())
        if (parsed.type === expectedType && predicate(parsed)) {
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

function expectNoMessageOfTypes(
  ws: WebSocket,
  forbiddenTypes: string | string[],
  timeout = 400,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const forbidden = new Set(Array.isArray(forbiddenTypes) ? forbiddenTypes : [forbiddenTypes])

    const handler = (data: Buffer | string) => {
      try {
        const parsed = JSON.parse(data.toString()) as { type?: unknown }
        if (typeof parsed.type === 'string' && forbidden.has(parsed.type)) {
          clearTimeout(timer)
          ws.off('message', handler)
          reject(new Error(`Unexpected websocket message type: ${parsed.type}`))
        }
      } catch {
        // ignore
      }
    }

    const timer = setTimeout(() => {
      ws.off('message', handler)
      resolve()
    }, timeout)

    ws.on('message', handler)
  })
}

// Helper: fetch HTTP response
function httpGet(
  url: string,
  headers?: http.OutgoingHttpHeaders,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'GET', headers }, (res) => {
      let body = ''
      res.on('data', (chunk) => body += chunk)
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

// Helper: make HTTP request with method, body, and headers
function httpRequest(
  method: string,
  url: string,
  body?: unknown,
  headers?: http.OutgoingHttpHeaders,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const payload = body === undefined
      ? undefined
      : typeof body === 'string'
        ? body
        : JSON.stringify(body)
    const resolvedHeaders: http.OutgoingHttpHeaders = {
      ...(payload ? { 'Content-Length': Buffer.byteLength(payload).toString() } : {}),
      ...(typeof body === 'string' ? {} : payload ? { 'Content-Type': 'application/json' } : {}),
      ...(headers ?? {}),
    }
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method,
        headers: resolvedHeaders,
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
const LOCAL_AUTH_TEST_PASSWORD_HASH = '$2b$04$jg1y2jvcM0s3Zr0q/vhBc.HvbMAXNDTS52.VJdC/GfbB2AIYnpWmK'
const CARD_STATE_IDENTITY_PUBLIC_ERROR = 'Card state is unavailable until your configured user identity can be resolved.'
const CARD_STATE_UNAVAILABLE_PUBLIC_ERROR = 'Unable to update card state right now. Refresh and try again.'
const runtimeRequire = createRequire(import.meta.url)

function installTempPackage(packageName: string, entrySource: string): () => void {
  const packageDir = path.join(process.cwd(), 'node_modules', packageName)
  let backupDir: string | null = null

  const clearPackageCache = (): void => {
    for (const candidate of [packageName, packageDir]) {
      try {
        const resolved = runtimeRequire.resolve(candidate)
        delete runtimeRequire.cache[resolved]
      } catch {
        // ignore unresolved paths
      }
    }
  }

  if (fs.existsSync(packageDir)) {
    backupDir = fs.mkdtempSync(path.join(os.tmpdir(), `${packageName.replace(/[^a-z0-9-]/gi, '-')}-backup-`))
    fs.cpSync(packageDir, backupDir, { recursive: true })
    fs.rmSync(packageDir, { recursive: true, force: true })
  }

  fs.mkdirSync(packageDir, { recursive: true })
  fs.writeFileSync(
    path.join(packageDir, 'package.json'),
    JSON.stringify({ name: packageName, main: 'index.js' }, null, 2),
    'utf-8',
  )
  fs.writeFileSync(path.join(packageDir, 'index.js'), entrySource, 'utf-8')
  clearPackageCache()

  return () => {
    clearPackageCache()
    fs.rmSync(packageDir, { recursive: true, force: true })
    if (backupDir) {
      fs.mkdirSync(path.dirname(packageDir), { recursive: true })
      fs.cpSync(backupDir, packageDir, { recursive: true })
      fs.rmSync(backupDir, { recursive: true, force: true })
    }
    clearPackageCache()
  }
}

function writeWorkspaceConfig(workspaceDir: string, config: Record<string, unknown>): string {
  const resolvedConfigPath = path.join(workspaceDir, '.kanban.json')
  fs.writeFileSync(resolvedConfigPath, JSON.stringify({ version: 2, ...config }, null, 2), 'utf-8')
  return resolvedConfigPath
}

function createPluginSettingsScopedAuthPluginSource(packageName: string, denyAfterReadCount?: number): string {
  const denyAfterReadGuard = typeof denyAfterReadCount === 'number'
    ? `
        pluginSettingsReadCount += 1
        if (pluginSettingsReadCount > ${denyAfterReadCount}) {
          return { allowed: false, reason: 'auth.policy.denied', actor: identity.subject }
        }
`
    : ''

  return `let pluginSettingsReadCount = 0
module.exports = {
  authIdentityPlugin: {
    manifest: { id: '${packageName}', provides: ['auth.identity'] },
    async resolveIdentity(context) {
      const rawToken = context && typeof context.token === 'string' ? context.token : ''
      const token = rawToken.startsWith('Bearer ') ? rawToken.slice(7) : rawToken
      if (!token) return null
      if (token === 'admin') return { subject: 'user-admin', roles: ['admin'] }
      if (token === 'manager') return { subject: 'user-manager', roles: ['manager'] }
      return { subject: 'user-' + token, roles: ['user'] }
    },
  },
  authPolicyPlugin: {
    manifest: { id: '${packageName}', provides: ['auth.policy'] },
    async checkPolicy(identity, action) {
      if (!identity) {
        return { allowed: false, reason: 'auth.identity.missing' }
      }

      if (action === 'plugin-settings.read') {
        const roles = Array.isArray(identity.roles) ? identity.roles : []
        if (!roles.includes('admin')) {
          return { allowed: false, reason: 'auth.policy.denied', actor: identity.subject }
        }${denyAfterReadGuard}
      }

      return { allowed: true, actor: identity.subject }
    },
  },
}
`
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

function createTaskReadModelAuthPluginSource(packageName: string): string {
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
  authPolicyPlugin: {
    manifest: { id: '${packageName}', provides: ['auth.policy'] },
    async checkPolicy(identity, action) {
      if (!identity) {
        return { allowed: false, reason: 'auth.identity.missing' }
      }

      const roles = Array.isArray(identity.roles) ? identity.roles : []
      if (roles.includes('writer')) {
        return { allowed: true, actor: identity.subject }
      }

      if (roles.includes('reader') && action === 'card.checklist.show') {
        return { allowed: true, actor: identity.subject }
      }

      return { allowed: false, reason: 'auth.policy.denied', actor: identity.subject }
    },
  },
}
`
}

// Helper: create a temp webview directory with dummy static files
function createTempWebviewDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-webview-'))
  fs.writeFileSync(path.join(dir, 'index.js'), '// test js', 'utf-8')
  fs.writeFileSync(path.join(dir, 'style.css'), '/* test css */', 'utf-8')
  return dir
}

function createIsolatedStandaloneTestWorkspace(): {
  kanbanDir: string
  workspaceRoot: string
  webviewDir: string
  cleanup: () => void
} {
  const kanbanDir = createTempDir()
  const workspaceRoot = path.dirname(kanbanDir)
  const webviewDir = createTempWebviewDir()

  return {
    kanbanDir,
    workspaceRoot,
    webviewDir,
    cleanup: () => {
      fs.rmSync(workspaceRoot, { recursive: true, force: true })
      fs.rmSync(webviewDir, { recursive: true, force: true })
    },
  }
}

describe('Standalone broadcastService visibility scoping', () => {
  it('builds cardsUpdated payloads under each websocket client auth context', async () => {
    const publicCard = {
      id: 'public-card',
      boardId: 'default',
      status: 'backlog',
      priority: 'medium',
      assignee: null,
      dueDate: null,
      labels: ['public'],
      attachments: [],
      order: 'a0',
      created: '2026-03-31T00:00:00.000Z',
      modified: '2026-03-31T00:00:00.000Z',
      completedAt: null,
      content: '# Public Card',
      comments: [],
    }
    const privateCard = {
      ...publicCard,
      id: 'private-card',
      labels: ['private'],
      content: '# Private Card',
      order: 'a1',
    }

    const readerSend = vi.fn()
    const writerSend = vi.fn()
    const readerClient = { readyState: WebSocket.OPEN, send: readerSend } as unknown as WebSocket
    const writerClient = { readyState: WebSocket.OPEN, send: writerSend } as unknown as WebSocket

    let activeAuthToken: string | undefined
    const sdk = {
      listColumns: vi.fn(() => [{ id: 'backlog' }]),
      listCards: vi.fn(async () => activeAuthToken === 'reader-token' ? [publicCard] : [publicCard, privateCard]),
      getCardStateStatus: vi.fn(() => ({
        backend: 'builtin',
        availability: 'available',
        defaultActorAvailable: false,
      })),
      getCardStateReadModelForCard: vi.fn(async (card: { id: string }) => ({
        unread: {
          actorId: activeAuthToken ?? 'anonymous',
          cardId: card.id,
          unread: false,
        },
        open: null,
      })),
      getCardStateReadModelForCards: vi.fn(async (cards: ReadonlyArray<{ id: string }>) => {
        const map = new Map<string, unknown>()
        for (const c of cards) {
          map.set(c.id, {
            unread: { actorId: activeAuthToken ?? 'anonymous', cardId: c.id, unread: false },
            open: null,
          })
        }
        return map
      }),
      runWithAuth: vi.fn(async (auth: { token?: string }, fn: () => Promise<unknown>) => {
        const previous = activeAuthToken
        activeAuthToken = auth.token
        try {
          return await fn()
        } finally {
          activeAuthToken = previous
        }
      }),
    }

    const ctx = {
      sdk,
      wss: { clients: new Set([readerClient, writerClient]) },
      cards: [publicCard, privateCard],
      clientAuthContexts: new Map([
        [readerClient, { token: 'reader-token' }],
        [writerClient, { token: 'writer-token' }],
      ]),
      clientEditingCardIds: new Map(),
      currentBoardId: 'default',
    } as unknown as Parameters<typeof broadcast>[0]

    broadcast(ctx, { type: 'cardsUpdated' })
    await new Promise((resolve) => setTimeout(resolve, 0))

    const readerPayload = JSON.parse(String(readerSend.mock.calls[0][0])) as { cards: Array<{ id: string }> }
    const writerPayload = JSON.parse(String(writerSend.mock.calls[0][0])) as { cards: Array<{ id: string }> }

    expect(readerPayload.cards.map((card) => card.id)).toEqual(['public-card'])
    expect(writerPayload.cards.map((card) => card.id)).toEqual(['public-card', 'private-card'])
  })

  it('builds init payloads with a per-client current user', async () => {
    const kanbanDir = createTempDir()
    const workspaceRoot = path.dirname(kanbanDir)
    const card = {
      id: 'public-card',
      boardId: 'default',
      status: 'backlog',
      priority: 'medium',
      assignee: null,
      dueDate: null,
      labels: ['public'],
      attachments: [],
      order: 'a0',
      created: '2026-03-31T00:00:00.000Z',
      modified: '2026-03-31T00:00:00.000Z',
      completedAt: null,
      content: '# Public Card',
      comments: [],
    }

    const readerSend = vi.fn()
    const writerSend = vi.fn()
    const readerClient = { readyState: WebSocket.OPEN, send: readerSend } as unknown as WebSocket
    const writerClient = { readyState: WebSocket.OPEN, send: writerSend } as unknown as WebSocket

    let activeAuthToken: string | undefined
    const sdk = {
      listColumns: vi.fn(() => [{ id: 'backlog' }]),
      listBoards: vi.fn(() => []),
      getSettings: vi.fn(() => ({
        showPriorityBadges: true,
        showAssignee: true,
        showDueDate: true,
        showLabels: true,
        showBuildWithAI: true,
        showFileName: false,
        cardViewMode: 'large',
        markdownEditorMode: false,
        showDeletedColumn: false,
        defaultPriority: 'medium',
        defaultStatus: 'backlog',
        boardZoom: 100,
        cardZoom: 100,
        boardBackgroundMode: 'fancy',
        boardBackgroundPreset: 'aurora',
        panelMode: 'drawer',
        drawerWidth: 50,
        drawerPosition: 'right',
      })),
      getLabels: vi.fn(() => ({})),
      getMinimizedColumns: vi.fn(() => []),
      listCards: vi.fn(async () => [card]),
      getCardStateStatus: vi.fn(() => ({
        backend: 'builtin',
        availability: 'available',
        defaultActorAvailable: false,
      })),
      getCardStateReadModelForCard: vi.fn(async (visibleCard: { id: string }) => ({
        unread: {
          actorId: activeAuthToken ?? 'anonymous',
          cardId: visibleCard.id,
          unread: false,
        },
        open: null,
      })),
      getCardStateReadModelForCards: vi.fn(async (cards: ReadonlyArray<{ id: string }>) => {
        const map = new Map<string, unknown>()
        for (const c of cards) {
          map.set(c.id, {
            unread: { actorId: activeAuthToken ?? 'anonymous', cardId: c.id, unread: false },
            open: null,
          })
        }
        return map
      }),
      capabilities: {
        authIdentity: {
          resolveIdentity: vi.fn(async (auth: { token?: string }) => {
            if (auth.token === 'reader-token') {
              return { subject: 'reader-user' }
            }
            if (auth.token === 'writer-token') {
              return { subject: 'writer-user' }
            }
            return null
          }),
        },
      },
      runWithAuth: vi.fn(async (auth: { token?: string }, fn: () => Promise<unknown>) => {
        const previous = activeAuthToken
        activeAuthToken = auth.token
        try {
          return await fn()
        } finally {
          activeAuthToken = previous
        }
      }),
    }

    const ctx = {
      sdk,
      workspaceRoot,
      wss: { clients: new Set([readerClient, writerClient]) },
      cards: [card],
      clientAuthContexts: new Map([
        [readerClient, { token: 'reader-token' }],
        [writerClient, { token: 'writer-token' }],
      ]),
      clientEditingCardIds: new Map(),
      currentBoardId: 'default',
    } as unknown as Parameters<typeof broadcast>[0]

    try {
      broadcast(ctx, { type: 'init' })
      await new Promise((resolve) => setTimeout(resolve, 0))

      const readerPayload = JSON.parse(String(readerSend.mock.calls[0][0])) as { currentUser?: string }
      const writerPayload = JSON.parse(String(writerSend.mock.calls[0][0])) as { currentUser?: string }

      expect(readerPayload.currentUser).toBe('reader-user')
      expect(writerPayload.currentUser).toBe('writer-user')
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })
})

describe('Standalone Server Integration', () => {
  let server: http.Server
  let tempDir: string
  let webviewDir: string
  let port: number
  let ws: WebSocket

  // One shared server for the whole suite — each test resets filesystem state in beforeEach.
  beforeAll(async () => {
    tempDir = createTempDir()
    webviewDir = createTempWebviewDir()
    port = await getPort()
    server = startServer(tempDir, port, webviewDir)
    await sleep(200)
  })

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    fs.rmSync(tempDir, { recursive: true, force: true })
    fs.rmSync(webviewDir, { recursive: true, force: true })
  })

  beforeEach(async () => {
    // Reset per-test filesystem state so each test starts with a clean board.
    const boardsDir = path.join(tempDir, 'boards')
    if (fs.existsSync(boardsDir)) {
      fs.rmSync(boardsDir, { recursive: true, force: true })
    }
    const activeCardFile = path.join(tempDir, '.active-card.json')
    if (fs.existsSync(activeCardFile)) fs.rmSync(activeCardFile)
    const workspaceRoot = path.dirname(tempDir)
    const configFile = path.join(workspaceRoot, '.kanban.json')
    if (fs.existsSync(configFile)) fs.rmSync(configFile)
    const webhooksFile = path.join(workspaceRoot, '.kanban-webhooks.json')
    if (fs.existsSync(webhooksFile)) fs.rmSync(webhooksFile)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close()
      await sleep(50)
    }
  })

  // ── HTTP Tests ──

  describe('HTTP server', () => {
    it('logs the resolved kanban config path on startup', async () => {
      const workspaceRoot = path.dirname(tempDir)
      const resolvedConfigPath = path.join(workspaceRoot, '.kanban.json')
      fs.writeFileSync(resolvedConfigPath, JSON.stringify({ port }, null, 2), 'utf-8')
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const localPort = await getPort()
      const localServer = startServer(tempDir, localPort, webviewDir, resolvedConfigPath)
      await sleep(200)
      try {
        expect(logSpy).toHaveBeenCalledWith(`Kanban config: ${resolvedConfigPath}`)
      } finally {
        await new Promise<void>((resolve) => localServer.close(() => resolve()))
      }
    })

    it('passes the resolved public SDK to standalone plugin registration and request contexts', async () => {
      const cleanup = installTempPackage(
        'standalone-sdk-context-test-plugin',
        `module.exports = {
  authIdentityPlugin: {
    manifest: { id: 'standalone-sdk-context-test-plugin', provides: ['auth.identity'] },
    async resolveIdentity() {
      return { subject: 'standalone-sdk-context-test-plugin' }
    },
  },
  standaloneHttpPlugin: {
    manifest: { id: 'standalone-sdk-context-test-plugin', provides: ['standalone.http'] },
    registerMiddleware() {
      return [async (request) => {
        if (!request.route('GET', '/api/plugin-sdk-context')) return false
        request.mergeAuthContext({ actorHint: 'middleware-auth-context' })
        return false
      }]
    },
    registerRoutes(options) {
      return [async (request) => {
        if (!request.route('GET', '/api/plugin-sdk-context')) return false
        const registrationSnapshot = options.sdk ? options.sdk.getConfigSnapshot() : null
        const requestSnapshot = request.sdk.getConfigSnapshot()
        const registrationBoard = options.sdk ? options.sdk.getBoard('default') : null
        const requestBoard = request.sdk.getBoard('default')
        request.res.statusCode = 200
        request.res.setHeader('Content-Type', 'application/json')
        request.res.end(JSON.stringify({
          ok: true,
          registrationSdkAvailable: !!options.sdk,
          registrationPort: registrationSnapshot ? registrationSnapshot.port ?? null : null,
          registrationBoardName: registrationBoard ? registrationBoard.name : null,
          requestPort: requestSnapshot.port ?? null,
          requestBoardName: requestBoard.name,
          workspaceRootMatches: options.workspaceRoot === request.workspaceRoot,
          kanbanDirMatches: options.kanbanDir === request.kanbanDir,
          actorHint: request.getAuthContext().actorHint ?? null,
        }))
        return true
      }]
    },
  },
}
`,
      )

      const workspaceRoot = path.dirname(tempDir)
      const resolvedConfigPath = writeWorkspaceConfig(workspaceRoot, {
        port,
        auth: {
          'auth.identity': { provider: 'standalone-sdk-context-test-plugin' },
          'auth.policy': { provider: 'noop' },
        },
      })

      const localPort = await getPort()
      const localServer = startServer(tempDir, localPort, webviewDir, resolvedConfigPath)
      await sleep(200)

      try {
        const res = await httpGet(`http://localhost:${localPort}/api/plugin-sdk-context`)
        expect(res.status).toBe(200)
        expect(JSON.parse(res.body)).toEqual({
          ok: true,
          registrationSdkAvailable: true,
          registrationPort: port,
          registrationBoardName: 'Default',
          requestPort: port,
          requestBoardName: 'Default',
          workspaceRootMatches: true,
          kanbanDirMatches: true,
          actorHint: 'middleware-auth-context',
        })
      } finally {
        await new Promise<void>((resolve) => localServer.close(() => resolve()))
        cleanup()
      }
    })

    it('starts even when the Swagger UI package static assets are unavailable', async () => {
      vi.resetModules()

      const actualFs = await vi.importActual<typeof import('fs')>('fs')

      vi.doMock('fs', () => ({
        ...actualFs,
        existsSync: (filePath: fs.PathLike) => {
          const normalizedPath = String(filePath)
          if (normalizedPath.endsWith('/swagger-ui.css')) return false
          if (normalizedPath.endsWith('/logo.svg')) return false
          return actualFs.existsSync(filePath)
        },
      }))

      const { startServer: startServerWithMocks } = await import('../server')

      const localPort = await getPort()
      const localServer = startServerWithMocks(tempDir, localPort, webviewDir)
      await sleep(200)
      try {
        // Hono's @hono/swagger-ui renders a self-contained HTML page that loads
        // assets from a CDN, so the server must still come up and serve the UI
        // and the OpenAPI JSON even when the packaged static assets are missing.
        const rootRes = await httpGet(`http://localhost:${localPort}/`)
        expect(rootRes.status).toBe(200)

        const docsRes = await httpGet(`http://localhost:${localPort}/api/docs`)
        expect(docsRes.status).toBe(200)
        expect(docsRes.body).toContain('swagger')

        const specRes = await httpGet(`http://localhost:${localPort}/api/docs/json`)
        expect(specRes.status).toBe(200)
        const spec = JSON.parse(specRes.body) as { paths: Record<string, unknown> }
        expect(spec.paths).toBeTruthy()
      } finally {
        await new Promise<void>((resolve) => localServer.close(() => resolve()))
        // Undo the module mocks so subsequent tests are not affected
        vi.unmock('fs')
        vi.resetModules()
      }
    })

    it('should serve index.html at root', async () => {

      const res = await httpGet(`http://localhost:${port}/`)
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toBe('text/html')
      expect(res.body).toContain('<div id="root">')
      expect(res.body).toContain('Kanban Board')
    })

    it('should serve static CSS files', async () => {

      const res = await httpGet(`http://localhost:${port}/style.css`)
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toBe('text/css')
    })

    it('should serve static JS files', async () => {

      const res = await httpGet(`http://localhost:${port}/index.js`)
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toBe('text/javascript')
    })

    it('should fall back to index.html for unknown paths', async () => {

      const res = await httpGet(`http://localhost:${port}/some/unknown/route`)
      expect(res.status).toBe(200)
      expect(res.body).toContain('<div id="root">')
    })
  })

  // ── WebSocket: Ready / Init ──

  describe('ready message and init response', () => {
    it('should return cards and columns on ready', async () => {
      // Pre-populate a card file in its status subfolder
      writeCardFile(tempDir, 'test-card.md', makeCardContent({
        id: 'test-card',
        status: 'backlog',
        priority: 'high',
        title: 'Test Card'
      }), 'backlog')

      ws = await connectWs(port, { Authorization: 'Bearer ws-local-token' })

      const response = await sendAndReceive(ws, { type: 'ready' }, 'init')

      expect(response.type).toBe('init')
      expect(Array.isArray(response.cards)).toBe(true)
      expect(Array.isArray(response.columns)).toBe(true)

      const cards = response.cards as Array<Record<string, unknown>>
      expect(cards.length).toBe(1)
      expect(cards[0].id).toBe('test-card')
      expect(cards[0].status).toBe('backlog')
      expect(cards[0].priority).toBe('high')

      const columns = response.columns as Array<Record<string, unknown>>
      expect(columns.length).toBe(5)
      expect(columns.map(c => c.id)).toEqual(['backlog', 'todo', 'in-progress', 'review', 'done'])

      expect(response.settings).toBeDefined()
    })

    it('should return empty cards for empty directory', async () => {
      ws = await connectWs(port)

      const response = await sendAndReceive(ws, { type: 'ready' }, 'init')
      const cards = response.cards as Array<unknown>
      expect(cards.length).toBe(0)
    })

    it('should load cards from done/ subfolder', async () => {
      writeCardFile(tempDir, 'done-card.md', makeCardContent({
        id: 'done-card',
        status: 'done',
        title: 'Done Card'
      }), 'done')

      ws = await connectWs(port)

      const response = await sendAndReceive(ws, { type: 'ready' }, 'init')
      const cards = response.cards as Array<Record<string, unknown>>
      expect(cards.length).toBe(1)
      expect(cards[0].id).toBe('done-card')
      expect(cards[0].status).toBe('done')
    })

    it('should load multiple cards sorted by order', async () => {
      writeCardFile(tempDir, 'card-b.md', makeCardContent({
        id: 'card-b',
        order: 'b0'
      }), 'backlog')
      writeCardFile(tempDir, 'card-a.md', makeCardContent({
        id: 'card-a',
        order: 'a0'
      }), 'backlog')

      ws = await connectWs(port)

      const response = await sendAndReceive(ws, { type: 'ready' }, 'init')
      const cards = response.cards as Array<Record<string, unknown>>
      expect(cards.length).toBe(2)
      expect(cards[0].id).toBe('card-a')
      expect(cards[1].id).toBe('card-b')
    })

    it('should return init after ready on a newly connected socket', async () => {
      writeCardFile(tempDir, 'test-card.md', makeCardContent({
        id: 'test-card',
        status: 'backlog',
        priority: 'high',
        title: 'Test Card'
      }), 'backlog')


      const firstSocket = await connectWs(port)
      const firstResponse = await sendAndReceive(firstSocket, { type: 'ready' }, 'init')
      expect(firstResponse.type).toBe('init')

      firstSocket.close()
      await sleep(50)

      const secondSocket = await connectWs(port)
      ws = secondSocket
      const secondResponse = await sendAndReceive(secondSocket, { type: 'ready' }, 'init')

      expect(secondResponse.type).toBe('init')
      const cards = secondResponse.cards as Array<Record<string, unknown>>
      expect(cards).toHaveLength(1)
      expect(cards[0].id).toBe('test-card')
    })
  })

  describe('websocket auth context', () => {
    it('forwards bearer auth to helper-backed card mutations', async () => {
      writeCardFile(tempDir, 'auth-delete.md', makeCardContent({
        id: 'auth-delete',
        title: 'Auth Delete'
      }), 'backlog')

      const runWithAuthSpy = vi.spyOn(KanbanSDK.prototype, 'runWithAuth')
      const deleteSpy = vi.spyOn(KanbanSDK.prototype, 'deleteCard').mockResolvedValue(undefined)

      ws = await connectWs(port, { Authorization: 'Bearer websocket-secret' })

      await sendAndReceive(ws, { type: 'ready' }, 'init')
      await sendAndReceive(ws, {
        type: 'deleteCard',
        cardId: 'auth-delete'
      }, 'init')

      expect(runWithAuthSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          token: 'websocket-secret',
          tokenSource: 'request-header',
          transport: 'http'
        }),
        expect.any(Function)
      )
      expect(deleteSpy).toHaveBeenCalledWith(
        'auth-delete',
        undefined,
      )
      runWithAuthSpy.mockRestore()
    })

    it('forwards bearer auth to direct action triggers', async () => {
      const runWithAuthSpy = vi.spyOn(KanbanSDK.prototype, 'runWithAuth')
      const triggerSpy = vi.spyOn(KanbanSDK.prototype, 'triggerAction').mockResolvedValue(undefined)

      ws = await connectWs(port, { Authorization: 'Bearer action-token' })

      await sendAndReceive(ws, { type: 'ready' }, 'init')
      const response = await sendAndReceive(ws, {
        type: 'triggerAction',
        cardId: 'card-123',
        action: 'approve',
        callbackKey: 'cb-1'
      }, 'actionResult')

      expect(response).toEqual({ type: 'actionResult', callbackKey: 'cb-1' })
      expect(runWithAuthSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          token: 'action-token',
          tokenSource: 'request-header',
          transport: 'http'
        }),
        expect.any(Function)
      )
      expect(triggerSpy).toHaveBeenCalledWith(
        'card-123',
        'approve',
        undefined,
      )
      runWithAuthSpy.mockRestore()
    })

    it('scopes websocket init rebroadcasts per actor and clears unread only for the opened actor', async () => {
      const cleanup = installTempPackage(
        'standalone-card-state-websocket-auth-scope-test',
        `module.exports = {
  authIdentityPlugin: {
    manifest: { id: 'standalone-card-state-websocket-auth-scope-test', provides: ['auth.identity'] },
    async resolveIdentity(context) {
      if (!context || !context.token) return null
      const token = context.token.startsWith('Bearer ') ? context.token.slice(7) : context.token
      return { subject: 'user-' + token, roles: ['user'] }
    },
  },
}
`,
      )

      const workspaceRoot = path.dirname(tempDir)
      const resolvedConfigPath = writeWorkspaceConfig(workspaceRoot, {
        port,
        auth: {
          'auth.identity': { provider: 'standalone-card-state-websocket-auth-scope-test' },
          'auth.policy': { provider: 'noop' },
        },
      })

      const localPort = await getPort()
      const localServer = startServer(tempDir, localPort, webviewDir, resolvedConfigPath)
      await sleep(200)

      try {
        const createRes = await httpRequest('POST', `http://localhost:${localPort}/api/tasks`, {
          content: '# Multi Actor WebSocket Card State',
          status: 'todo',
        })
        expect(createRes.status).toBe(201)
        const cardId = JSON.parse(createRes.body).data.id as string

        const wsAlice = await connectWs(localPort, { Authorization: 'Bearer alice' })
        const wsBob = await connectWs(localPort, { Authorization: 'Bearer bob' })

        try {
          await sendAndReceive(wsAlice, { type: 'ready' }, 'init')
          await sendAndReceive(wsBob, { type: 'ready' }, 'init')
          const aliceInitialStates = await sendAndReceive(wsAlice, { type: 'getCardStates', cardIds: [cardId] }, 'cardStates')
          const bobInitialStates = await sendAndReceive(wsBob, { type: 'getCardStates', cardIds: [cardId] }, 'cardStates')
          expect((aliceInitialStates.states as Record<string, CardStateReadPayload>)[cardId]?.unread).toMatchObject({
            actorId: 'user-alice',
            cardId,
            unread: false,
          })
          expect((bobInitialStates.states as Record<string, CardStateReadPayload>)[cardId]?.unread).toMatchObject({
            actorId: 'user-bob',
            cardId,
            unread: false,
          })

          const aliceUpdatePromise = waitForMessage(wsAlice, 'init', 5000)
          const bobUpdatePromise = waitForMessage(wsBob, 'init', 5000)
          const logRes = await httpRequest('POST', `http://localhost:${localPort}/api/tasks/${cardId}/logs`, {
            text: 'Unread activity rebroadcast to websocket actors',
          })
          expect(logRes.status).toBe(201)

          const aliceUpdate = await aliceUpdatePromise
          const bobUpdate = await bobUpdatePromise
          const aliceUpdatedCard = (aliceUpdate.cards as StandaloneInitCardPayload[]).find((card) => card.id === cardId)
          const bobUpdatedCard = (bobUpdate.cards as StandaloneInitCardPayload[]).find((card) => card.id === cardId)
          // Board-level broadcasts defer per-card activity log reads to avoid
          // fetching every card's attachment-backed log during list/init. The
          // accurate unread value lands when the card is opened (see below).
          expect(aliceUpdatedCard?.cardState?.unread).toMatchObject({
            actorId: 'user-alice',
            cardId,
            unread: false,
          })
          expect(bobUpdatedCard?.cardState?.unread).toMatchObject({
            actorId: 'user-bob',
            cardId,
            unread: false,
          })

          const openResponse = await sendAndReceive(wsAlice, { type: 'openCard', cardId }, 'cardContent')
          expect(openResponse.cardId).toBe(cardId)

          const aliceDetailRes = await httpGet(`http://localhost:${localPort}/api/tasks/${cardId}`, {
            Authorization: 'Bearer alice',
          })
          expect(aliceDetailRes.status).toBe(200)
          expect(JSON.parse(aliceDetailRes.body).data.cardState).toMatchObject({
            unread: {
              actorId: 'user-alice',
              cardId,
              unread: false,
            },
            open: {
              actorId: 'user-alice',
              cardId,
              domain: 'open',
            },
          })

          const bobDetailRes = await httpGet(`http://localhost:${localPort}/api/tasks/${cardId}`, {
            Authorization: 'Bearer bob',
          })
          expect(bobDetailRes.status).toBe(200)
          expect(JSON.parse(bobDetailRes.body).data.cardState).toMatchObject({
            unread: {
              actorId: 'user-bob',
              cardId,
              unread: true,
            },
            open: null,
          })
        } finally {
          wsAlice.close()
          wsBob.close()
          await sleep(50)
        }
      } finally {
        await new Promise<void>((resolve) => localServer.close(() => resolve()))
        cleanup()
      }
    })
  })

  // ── Create Card ──

  describe('createCard', () => {
    it('should create a card file on disk', async () => {
      ws = await connectWs(port)

      // Init first
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      // Create card
      const response = await sendAndReceive(ws, {
        type: 'createCard',
        data: {
          status: 'todo',
          priority: 'high',
          content: '# My New Card\n\nSome description',
          assignee: null,
          dueDate: null,
          labels: ['frontend']
        }
      }, 'init')

      const cards = response.cards as Array<Record<string, unknown>>
      expect(cards.length).toBe(1)
      expect(cards[0].status).toBe('todo')
      expect(cards[0].priority).toBe('high')
      expect(cards[0].content).toBe('# My New Card\n\nSome description')
      expect(cards[0].labels).toEqual(['frontend'])

      // Verify file exists on disk in boards/default/todo/ subfolder
      const todoDir = path.join(tempDir, 'boards', 'default', 'todo')
      const files = fs.readdirSync(todoDir).filter(f => f.endsWith('.md'))
      expect(files.length).toBe(1)

      const fileContent = fs.readFileSync(path.join(todoDir, files[0]), 'utf-8')
      expect(fileContent).toContain('status: "todo"')
      expect(fileContent).toContain('priority: "high"')
      expect(fileContent).toContain('# My New Card')
      expect(fileContent).toContain('- "frontend"')
    })

    it('should create card in its status subfolder', async () => {
      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const response = await sendAndReceive(ws, {
        type: 'createCard',
        data: {
          status: 'done',
          priority: 'low',
          content: '# Completed Thing',
          assignee: null,
          dueDate: null,
          labels: []
        }
      }, 'init')

      const cards = response.cards as Array<Record<string, unknown>>
      expect(cards.length).toBe(1)
      expect(cards[0].status).toBe('done')
      expect(cards[0].completedAt).toBeTruthy()

      // File should be in boards/default/done/ subfolder
      const doneFiles = fs.readdirSync(path.join(tempDir, 'boards', 'default', 'done')).filter(f => f.endsWith('.md'))
      expect(doneFiles.length).toBe(1)
    })

    it('should assign correct order when creating in a populated column', async () => {
      writeCardFile(tempDir, 'existing.md', makeCardContent({
        id: 'existing',
        status: 'backlog',
        order: 'a0'
      }), 'backlog')

      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const response = await sendAndReceive(ws, {
        type: 'createCard',
        data: {
          status: 'backlog',
          priority: 'medium',
          content: '# Second Card',
          assignee: null,
          dueDate: null,
          labels: []
        }
      }, 'init')

      const cards = response.cards as Array<Record<string, unknown>>
      const backlogCards = cards.filter(f => f.status === 'backlog')
      expect(backlogCards.length).toBe(2)
      // New card should come after existing (order > 'a0')
      expect((backlogCards[1].order as string) > (backlogCards[0].order as string)).toBe(true)
    })

    it('should preserve assignee and dueDate', async () => {
      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const response = await sendAndReceive(ws, {
        type: 'createCard',
        data: {
          status: 'todo',
          priority: 'high',
          content: '# Assigned Card',
          assignee: 'john',
          dueDate: '2024-12-31',
          labels: ['urgent', 'backend']
        }
      }, 'init')

      const cards = response.cards as Array<Record<string, unknown>>
      expect(cards[0].assignee).toBe('john')
      expect(cards[0].dueDate).toBe('2024-12-31')
      expect(cards[0].labels).toEqual(['urgent', 'backend'])
    })
  })

  // ── Move Card ──

  describe('moveCard', () => {
    it('should change status and move file to new status folder', async () => {
      writeCardFile(tempDir, 'move-me.md', makeCardContent({
        id: 'move-me',
        status: 'backlog',
        title: 'Move Me'
      }), 'backlog')

      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const response = await sendAndReceive(ws, {
        type: 'moveCard',
        cardId: 'move-me',
        newStatus: 'in-progress',
        newOrder: 0
      }, 'init')

      const cards = response.cards as Array<Record<string, unknown>>
      expect(cards[0].status).toBe('in-progress')

      // Verify file was moved to boards/default/in-progress/ subfolder
      expect(fs.existsSync(path.join(tempDir, 'boards', 'default', 'backlog', 'move-me.md'))).toBe(false)
      const fileContent = fs.readFileSync(path.join(tempDir, 'boards', 'default', 'in-progress', 'move-me.md'), 'utf-8')
      expect(fileContent).toContain('status: "in-progress"')
    })

    it('should move file to done/ subfolder when status changes to done', async () => {
      writeCardFile(tempDir, 'finish-me.md', makeCardContent({
        id: 'finish-me',
        status: 'review',
        title: 'Finish Me'
      }), 'review')

      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const response = await sendAndReceive(ws, {
        type: 'moveCard',
        cardId: 'finish-me',
        newStatus: 'done',
        newOrder: 0
      }, 'init')

      const cards = response.cards as Array<Record<string, unknown>>
      expect(cards[0].status).toBe('done')
      expect(cards[0].completedAt).toBeTruthy()

      // File should now be in boards/default/done/ subfolder
      expect(fs.existsSync(path.join(tempDir, 'boards', 'default', 'review', 'finish-me.md'))).toBe(false)
      expect(fs.existsSync(path.join(tempDir, 'boards', 'default', 'done', 'finish-me.md'))).toBe(true)
    })

    it('should move file from done/ to target status folder', async () => {
      writeCardFile(tempDir, 'reopen-me.md', makeCardContent({
        id: 'reopen-me',
        status: 'done',
        title: 'Reopen Me'
      }), 'done')

      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const response = await sendAndReceive(ws, {
        type: 'moveCard',
        cardId: 'reopen-me',
        newStatus: 'todo',
        newOrder: 0
      }, 'init')

      const cards = response.cards as Array<Record<string, unknown>>
      expect(cards[0].status).toBe('todo')
      expect(cards[0].completedAt).toBeNull()

      // File should be in boards/default/todo/ subfolder
      expect(fs.existsSync(path.join(tempDir, 'boards', 'default', 'done', 'reopen-me.md'))).toBe(false)
      expect(fs.existsSync(path.join(tempDir, 'boards', 'default', 'todo', 'reopen-me.md'))).toBe(true)
    })

    it('should compute correct fractional order between neighbors', async () => {
      writeCardFile(tempDir, 'feat-a.md', makeCardContent({
        id: 'feat-a',
        status: 'todo',
        order: 'a0'
      }), 'todo')
      writeCardFile(tempDir, 'feat-c.md', makeCardContent({
        id: 'feat-c',
        status: 'todo',
        order: 'a2'
      }), 'todo')
      writeCardFile(tempDir, 'feat-move.md', makeCardContent({
        id: 'feat-move',
        status: 'backlog',
        order: 'a0'
      }), 'backlog')

      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')

      // Move feat-move to todo column between feat-a (position 0) and feat-c (position 1)
      const response = await sendAndReceiveMatching(ws, {
        type: 'moveCard',
        cardId: 'feat-move',
        newStatus: 'todo',
        newOrder: 1
      }, 'init', (parsed) => {
        const cards = parsed.cards as Array<Record<string, unknown>> | undefined
        return Array.isArray(cards) && cards.filter(card => card.status === 'todo').length === 3
      })

      const cards = response.cards as Array<Record<string, unknown>>
      const todoCards = cards
        .filter(f => f.status === 'todo')
        .sort((a, b) => (a.order as string) < (b.order as string) ? -1 : 1)

      expect(todoCards.length).toBe(3)
      expect(todoCards[0].id).toBe('feat-a')
      expect(todoCards[1].id).toBe('feat-move')
      expect(todoCards[2].id).toBe('feat-c')
      // Verify order is between a0 and a2
      expect((todoCards[1].order as string) > (todoCards[0].order as string)).toBe(true)
      expect((todoCards[1].order as string) < (todoCards[2].order as string)).toBe(true)
    })
  })

  // ── Delete Card ──

  describe('deleteCard', () => {
    it('should soft-delete card by moving to deleted status', async () => {
      writeCardFile(tempDir, 'delete-me.md', makeCardContent({
        id: 'delete-me',
        title: 'Delete Me'
      }), 'backlog')

      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const response = await sendAndReceiveMatching(ws, {
        type: 'deleteCard',
        cardId: 'delete-me'
      }, 'init', (parsed) => {
        const cards = parsed.cards as Array<Record<string, unknown>> | undefined
        return Array.isArray(cards) && cards.some(card => card.id === 'delete-me' && card.status === 'deleted')
      })

      const cards = response.cards as Array<Record<string, unknown>>
      // Card still exists but with deleted status
      const deletedCard = cards.find((f: Record<string, unknown>) => f.id === 'delete-me')
      expect(deletedCard).toBeTruthy()
      expect(deletedCard!.status).toBe('deleted')

      // File should be moved to deleted folder, not removed
      expect(fs.existsSync(path.join(tempDir, 'boards', 'default', 'backlog', 'delete-me.md'))).toBe(false)
      expect(fs.existsSync(path.join(tempDir, 'boards', 'default', 'deleted', 'delete-me.md'))).toBe(true)
    })

    it('should only soft-delete the targeted card', async () => {
      writeCardFile(tempDir, 'keep-me.md', makeCardContent({ id: 'keep-me' }), 'backlog')
      writeCardFile(tempDir, 'remove-me.md', makeCardContent({ id: 'remove-me' }), 'backlog')

      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const response = await sendAndReceiveMatching(ws, {
        type: 'deleteCard',
        cardId: 'remove-me'
      }, 'init', (parsed) => {
        const cards = parsed.cards as Array<Record<string, unknown>> | undefined
        return Array.isArray(cards) && cards.some(card => card.id === 'remove-me' && card.status === 'deleted')
      })

      const cards = response.cards as Array<Record<string, unknown>>
      expect(cards.length).toBe(2)
      const kept = cards.find((f: Record<string, unknown>) => f.id === 'keep-me')
      expect(kept).toBeTruthy()
      expect(kept!.status).toBe('backlog')
      const removed = cards.find((f: Record<string, unknown>) => f.id === 'remove-me')
      expect(removed).toBeTruthy()
      expect(removed!.status).toBe('deleted')
      expect(fs.existsSync(path.join(tempDir, 'boards', 'default', 'backlog', 'keep-me.md'))).toBe(true)
    })

    it('should handle deleting non-existent card gracefully', async () => {
      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')

      // This should not crash
      ws.send(JSON.stringify({ type: 'deleteCard', cardId: 'nonexistent' }))
      await sleep(200)

      // Connection should still be open
      expect(ws.readyState).toBe(WebSocket.OPEN)
    })
  })

  // ── Update Card ──

  describe('updateCard', () => {
    it('should update card properties and persist', async () => {
      writeCardFile(tempDir, 'update-me.md', makeCardContent({
        id: 'update-me',
        priority: 'low',
        title: 'Update Me'
      }), 'backlog')

      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const response = await sendAndReceive(ws, {
        type: 'updateCard',
        cardId: 'update-me',
        updates: {
          priority: 'critical',
          assignee: 'alice',
          labels: ['urgent']
        }
      }, 'init')

      const cards = response.cards as Array<Record<string, unknown>>
      expect(cards[0].priority).toBe('critical')
      expect(cards[0].assignee).toBe('alice')
      expect(cards[0].labels).toEqual(['urgent'])

      // Verify persisted on disk
      const fileContent = fs.readFileSync(path.join(tempDir, 'boards', 'default', 'backlog', 'update-me.md'), 'utf-8')
      expect(fileContent).toContain('priority: "critical"')
      expect(fileContent).toContain('assignee: "alice"')
      expect(fileContent).toContain('- "urgent"')
    })

    it('should set completedAt when status changes to done', async () => {
      writeCardFile(tempDir, 'complete-me.md', makeCardContent({
        id: 'complete-me',
        status: 'review'
      }), 'review')

      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const response = await sendAndReceive(ws, {
        type: 'updateCard',
        cardId: 'complete-me',
        updates: { status: 'done' }
      }, 'init')

      const cards = response.cards as Array<Record<string, unknown>>
      expect(cards[0].completedAt).toBeTruthy()
    })
  })

  // ── Open Card (inline editor) ──

  describe('openCard', () => {
    it('should return card content and frontmatter', async () => {
      writeCardFile(tempDir, 'open-me.md', makeCardContent({
        id: 'open-me',
        status: 'in-progress',
        priority: 'high',
        title: 'Open Me',
        assignee: 'bob',
        labels: ['backend', 'api']
      }), 'in-progress')

      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const response = await sendAndReceive(ws, {
        type: 'openCard',
        cardId: 'open-me'
      }, 'cardContent')

      expect(response.type).toBe('cardContent')
      expect(response.cardId).toBe('open-me')
      expect(response.content).toContain('# Open Me')

      const frontmatter = response.frontmatter as Record<string, unknown>
      expect(frontmatter.id).toBe('open-me')
      expect(frontmatter.status).toBe('in-progress')
      expect(frontmatter.priority).toBe('high')
      expect(frontmatter.assignee).toBe('bob')
      expect(frontmatter.labels).toEqual(['backend', 'api'])
    })

    it('should expose the opened card via the active-card REST endpoint', async () => {
      writeCardFile(tempDir, 'active-api.md', makeCardContent({
        id: 'active-api',
        status: 'todo',
        title: 'Active API Card'
      }), 'todo')

      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')
      await sendAndReceive(ws, { type: 'openCard', cardId: 'active-api' }, 'cardContent')

      const res = await httpGet(`http://localhost:${port}/api/tasks/active`)
      expect(res.status).toBe(200)
      const json = JSON.parse(res.body)
      expect(json.ok).toBe(true)
      expect(json.data.id).toBe('active-api')
      expect(json.data.filePath).toBeUndefined()
    })

    it('refreshes the open card immediately after a triggered action mutates it', async () => {
      writeCardFile(tempDir, 'action-refresh.md', makeCardContent({
        id: 'action-refresh',
        status: 'todo',
        title: 'Action Refresh Card'
      }), 'todo')

      vi.spyOn(KanbanSDK.prototype, 'triggerAction').mockImplementation(async function (this: KanbanSDK, cardId: string, action: string, boardId?: string) {
        await this.addComment(cardId, 'action-bot', `Triggered ${action}`, boardId)
      })

      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')
      await sendAndReceive(ws, { type: 'openCard', cardId: 'action-refresh' }, 'cardContent')

      const response = await sendAndReceiveMatching(ws, {
        type: 'triggerAction',
        cardId: 'action-refresh',
        action: 'approve',
        callbackKey: 'cb-action-refresh'
      }, 'cardContent', (parsed) => {
        const comments = parsed.comments as Array<Record<string, unknown>> | undefined
        return Array.isArray(comments) && comments.some(comment => comment.author === 'action-bot' && comment.content === 'Triggered approve')
      })

      const comments = response.comments as Array<Record<string, unknown>>
      expect(comments).toEqual(expect.arrayContaining([
        expect.objectContaining({ author: 'action-bot', content: 'Triggered approve' })
      ]))
    })

    it('refreshes logs in every open window when another window triggers an action', async () => {
      writeCardFile(tempDir, 'shared-action-logs.md', makeCardContent({
        id: 'shared-action-logs',
        status: 'todo',
        title: 'Shared Action Logs Card'
      }), 'todo')

      vi.spyOn(KanbanSDK.prototype, 'triggerAction').mockImplementation(async function (this: KanbanSDK, cardId: string, action: string, boardId?: string) {
        await this.addLog(cardId, `Triggered ${action}`, { source: 'action-bot' }, boardId)
      })

      const wsA = await connectWs(port)
      const wsB = await connectWs(port)

      try {
        await sendAndReceive(wsA, { type: 'ready' }, 'init')
        await sendAndReceive(wsB, { type: 'ready' }, 'init')
        await sendAndReceive(wsA, { type: 'openCard', cardId: 'shared-action-logs' }, 'cardContent')
        await sendAndReceive(wsB, { type: 'openCard', cardId: 'shared-action-logs' }, 'cardContent')

        const wsBLogsUpdate = waitForMessage(wsB, 'logsUpdated', 5000)

        await sendAndReceive(wsA, {
          type: 'triggerAction',
          cardId: 'shared-action-logs',
          action: 'approve',
          callbackKey: 'cb-shared-logs'
        }, 'actionResult')

        const response = await wsBLogsUpdate
        expect(response.cardId).toBe('shared-action-logs')
        expect(response.logs).toEqual(expect.arrayContaining([
          expect.objectContaining({ source: 'action-bot', text: 'Triggered approve' })
        ]))
      } finally {
        wsA.close()
        wsB.close()
        await sleep(50)
      }
    })
  })

  // ── Save Card Content ──

  describe('saveCardContent', () => {
    it('should save updated content and frontmatter to disk', async () => {
      writeCardFile(tempDir, 'save-me.md', makeCardContent({
        id: 'save-me',
        status: 'backlog',
        priority: 'low',
        title: 'Save Me'
      }), 'backlog')

      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')

      // Open the card first
      await sendAndReceive(ws, {
        type: 'openCard',
        cardId: 'save-me'
      }, 'cardContent')

      // Save with updated content
      const response = await sendAndReceive(ws, {
        type: 'saveCardContent',
        cardId: 'save-me',
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

      const cards = response.cards as Array<Record<string, unknown>>
      const saved = cards.find(f => f.id === 'save-me')!
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
      writeCardFile(tempDir, 'save-done.md', makeCardContent({
        id: 'save-done',
        status: 'review',
        title: 'Save Done'
      }), 'review')

      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')
      await sendAndReceive(ws, {
        type: 'openCard',
        cardId: 'save-done'
      }, 'cardContent')

      await sendAndReceiveMatching(ws, {
        type: 'saveCardContent',
        cardId: 'save-done',
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
      }, 'init', (parsed) => {
        const cards = parsed.cards as Array<Record<string, unknown>> | undefined
        return Array.isArray(cards) && cards.some(card => card.id === 'save-done' && card.status === 'done')
      })

      expect(fs.existsSync(path.join(tempDir, 'boards', 'default', 'review', 'save-done.md'))).toBe(false)
      expect(fs.existsSync(path.join(tempDir, 'boards', 'default', 'done', 'save-done.md'))).toBe(true)
    })
  })

  // ── Close Card ──

  describe('closeCard', () => {
    it('should not crash when closing', async () => {
      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')

      ws.send(JSON.stringify({ type: 'closeCard' }))
      await sleep(100)

      expect(ws.readyState).toBe(WebSocket.OPEN)
    })

    it('should clear the active-card REST endpoint when the card is closed', async () => {
      writeCardFile(tempDir, 'close-active.md', makeCardContent({
        id: 'close-active',
        title: 'Close Active Card'
      }), 'backlog')

      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')
      await sendAndReceive(ws, { type: 'openCard', cardId: 'close-active' }, 'cardContent')

      ws.send(JSON.stringify({ type: 'closeCard' }))
      await sleep(100)

      const res = await httpGet(`http://localhost:${port}/api/tasks/active`)
      expect(res.status).toBe(200)
      const json = JSON.parse(res.body)
      expect(json.ok).toBe(true)
      expect(json.data).toBeNull()
    })
  })

  describe('attachment materialization', () => {
    it('serves provider-materialized attachments even when the file is outside .kanban', async () => {
      const attachmentName = 'external-proof.txt'
      const externalAttachmentPath = path.join(path.dirname(tempDir), `served-${Date.now()}-${attachmentName}`)

      writeCardFile(tempDir, 'attachment-host.md', makeCardContent({
        id: 'attachment-host',
        title: 'Attachment Host',
        attachments: [attachmentName]
      }), 'backlog')
      fs.writeFileSync(externalAttachmentPath, 'served from provider-owned path', 'utf-8')

      vi.spyOn(KanbanSDK.prototype, 'materializeAttachment').mockImplementation(async (card, attachment) => {
        if (card.id === 'attachment-host' && attachment === attachmentName) {
          return externalAttachmentPath
        }
        return null
      })

      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const res = await httpGet(`http://localhost:${port}/api/tasks/attachment-host/attachments/${attachmentName}`)
      expect(res.status).toBe(200)
      expect(res.body).toBe('served from provider-owned path')

      fs.rmSync(externalAttachmentPath, { force: true })
    })

    it('POST /api/upload-attachment preserves the original filename', async () => {
      const cardId = 'upload-filename-host'
      const attachmentName = 'field-note.txt'

      writeCardFile(tempDir, 'upload-filename-host.md', makeCardContent({
        id: cardId,
        title: 'Upload Filename Host',
      }), 'backlog')

      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const uploadRes = await httpRequest('POST', `http://localhost:${port}/api/upload-attachment`, {
        cardId,
        files: [{
          name: attachmentName,
          data: Buffer.from('uploaded via standalone system route').toString('base64'),
        }],
      })

      expect(uploadRes.status).toBe(200)
      expect(JSON.parse(uploadRes.body)).toEqual({ ok: true })

      const detailRes = await httpGet(`http://localhost:${port}/api/tasks/${cardId}`)
      expect(detailRes.status).toBe(200)
      expect(JSON.parse(detailRes.body).data.attachments).toContain(attachmentName)

      const attachmentDir = path.join(tempDir, 'boards', 'default', 'backlog', 'attachments')
      expect(fs.existsSync(path.join(attachmentDir, attachmentName))).toBe(true)
      expect(fs.readdirSync(attachmentDir).some((entry) => entry.includes(`kanban-upload-${cardId}-`))).toBe(false)
    })
  })

  // ── No-op VSCode messages ──

  describe('VSCode-specific no-op messages', () => {
    it('should handle openFile without crashing', async () => {
      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')
      ws.send(JSON.stringify({ type: 'openFile', cardId: 'test' }))
      await sleep(100)
      expect(ws.readyState).toBe(WebSocket.OPEN)
    })

    it('should handle openSettings without crashing', async () => {
      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')
      ws.send(JSON.stringify({ type: 'openSettings' }))
      await sleep(100)
      expect(ws.readyState).toBe(WebSocket.OPEN)
    })

    it('should handle focusMenuBar without crashing', async () => {
      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')
      ws.send(JSON.stringify({ type: 'focusMenuBar' }))
      await sleep(100)
      expect(ws.readyState).toBe(WebSocket.OPEN)
    })

    it('should handle startWithAI without crashing', async () => {
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
      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')

      // Let chokidar fully initialize before making external changes
      await sleep(2000)

      // Listen for the next init broadcast
      const updatePromise = waitForMessage(ws, 'init', 15000)

      writeCardFile(tempDir, 'external-card.md', makeCardContent({
        id: 'external-card',
        status: 'todo',
        title: 'External Card'
      }), 'todo')

      const response = await updatePromise
      const cards = response.cards as Array<Record<string, unknown>>
      const external = cards.find(f => f.id === 'external-card')
      expect(external).toBeDefined()
      expect(external!.status).toBe('todo')
    })

    it('should broadcast updates when a file is modified externally', async () => {
      const filePath = writeCardFile(tempDir, 'modify-me.md', makeCardContent({
        id: 'modify-me',
        status: 'backlog',
        priority: 'low',
        title: 'Modify Me'
      }), 'backlog')

      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')

      // Let chokidar fully initialize
      await sleep(2000)

      const updatePromise = waitForMessage(ws, 'init', 15000)

      fs.writeFileSync(filePath, makeCardContent({
        id: 'modify-me',
        status: 'backlog',
        priority: 'critical',
        title: 'Modified Card'
      }), 'utf-8')

      const response = await updatePromise
      const cards = response.cards as Array<Record<string, unknown>>
      const modified = cards.find(f => f.id === 'modify-me')
      expect(modified).toBeDefined()
      expect(modified!.priority).toBe('critical')
    })

    it('should broadcast updates when a file is deleted externally', async () => {
      const filePath = writeCardFile(tempDir, 'vanish-me.md', makeCardContent({
        id: 'vanish-me',
        title: 'Vanish Me'
      }), 'backlog')

      ws = await connectWs(port)

      const initResponse = await sendAndReceive(ws, { type: 'ready' }, 'init')
      expect((initResponse.cards as Array<unknown>).length).toBe(1)

      // Let chokidar fully initialize
      await sleep(2000)

      const updatePromise = waitForMessage(ws, 'init', 15000)

      fs.unlinkSync(filePath)

      const response = await updatePromise
      const cards = response.cards as Array<unknown>
      expect(cards.length).toBe(0)
    })

    it('should honor provider-defined watch globs for non-markdown files', async () => {
      // This test needs its own server because the file watcher glob is determined
      // at startup — the spy must be active before startServer is called.
      const originalGetStorageStatus = KanbanSDK.prototype.getStorageStatus
      const statusSpy = vi.spyOn(KanbanSDK.prototype, 'getStorageStatus')
      statusSpy.mockImplementation(function (this: KanbanSDK) {
        return {
          ...originalGetStorageStatus.call(this),
          isFileBacked: true,
          watchGlob: 'boards/**/*.json',
        }
      })

      const providerStatePath = path.join(tempDir, 'boards', 'default', 'backlog', 'provider-state.json')
      fs.mkdirSync(path.dirname(providerStatePath), { recursive: true })
      fs.writeFileSync(providerStatePath, JSON.stringify({ version: 1 }), 'utf-8')

      const localPort = await getPort()
      const localServer = startServer(tempDir, localPort, webviewDir)
      await sleep(200)
      try {
        const localWs = await connectWs(localPort)
        try {
          await sendAndReceive(localWs, { type: 'ready' }, 'init')

          await sleep(2000)

          const updatePromise = waitForMessage(localWs, 'init', 15000)

          fs.writeFileSync(providerStatePath, JSON.stringify({ version: 2 }), 'utf-8')

          const response = await updatePromise
          expect(response.type).toBe('init')
        } finally {
          localWs.close()
          await sleep(50)
        }
      } finally {
        statusSpy.mockRestore()
        await new Promise<void>((resolve) => localServer.close(() => resolve()))
      }
    })
  })

  // ── Multi-client broadcast ──

  describe('multi-client broadcast', () => {
    it('should broadcast to all connected clients', async () => {
      writeCardFile(tempDir, 'broadcast-test.md', makeCardContent({
        id: 'broadcast-test',
        title: 'Broadcast Test'
      }), 'backlog')


      const ws1 = await connectWs(port)
      const ws2 = await connectWs(port)

      try {
        // Init both clients
        await sendAndReceive(ws1, { type: 'ready' }, 'init')
        await sendAndReceive(ws2, { type: 'ready' }, 'init')

        // Client 2 listens for update
        const ws2Update = new Promise<Record<string, unknown>>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Timeout waiting for broadcast with both cards')), 3000)
          const handler = (data: Buffer | string) => {
            try {
              const parsed = JSON.parse(data.toString())
              const cards = parsed.cards as Array<Record<string, unknown>> | undefined
              if (parsed.type === 'init' && Array.isArray(cards) && cards.length === 2) {
                clearTimeout(timer)
                ws2.off('message', handler)
                resolve(parsed)
              }
            } catch {
              // ignore parse errors
            }
          }
          ws2.on('message', handler)
        })

        // Client 1 creates a card
        ws1.send(JSON.stringify({
          type: 'createCard',
          data: {
            status: 'backlog',
            priority: 'medium',
            content: '# Broadcast Card',
            assignee: null,
            dueDate: null,
            labels: []
          }
        }))

        // Client 2 should receive the broadcast
        const response = await ws2Update
        const cards = response.cards as Array<Record<string, unknown>>
        expect(cards.length).toBe(2) // original + new
      } finally {
        ws1.close()
        ws2.close()
        await sleep(50)
      }
    })
  })

  // ── Migration: legacy integer orders ──

  describe('legacy order migration', () => {
    it('should migrate integer order values to fractional indices', async () => {
      writeCardFile(tempDir, 'legacy-1.md', makeCardContent({
        id: 'legacy-1',
        status: 'backlog',
        order: '0'
      }), 'backlog')
      writeCardFile(tempDir, 'legacy-2.md', makeCardContent({
        id: 'legacy-2',
        status: 'backlog',
        order: '1'
      }), 'backlog')

      ws = await connectWs(port)

      const response = await sendAndReceive(ws, { type: 'ready' }, 'init')
      const cards = response.cards as Array<Record<string, unknown>>

      // Orders should no longer be plain integers
      for (const f of cards) {
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
      writeCardFile(tempDir, 'misplaced-done.md', makeCardContent({
        id: 'misplaced-done',
        status: 'done',
        title: 'Misplaced Done'
      }))

      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')

      // After load, file should have been migrated to boards/default/done/
      expect(fs.existsSync(path.join(tempDir, 'boards', 'default', 'misplaced-done.md'))).toBe(false)
      expect(fs.existsSync(path.join(tempDir, 'boards', 'default', 'done', 'misplaced-done.md'))).toBe(true)
    })

    it('should move mismatched file to correct status subfolder', async () => {
      // Place a backlog-status file in done/ (mismatched)
      writeCardFile(tempDir, 'misplaced-active.md', makeCardContent({
        id: 'misplaced-active',
        status: 'backlog',
        title: 'Misplaced Active'
      }), 'done')

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
      writeCardFile(tempDir, 'not-a-card.txt', 'just some text', 'backlog')
      writeCardFile(tempDir, 'real-card.md', makeCardContent({
        id: 'real-card',
        title: 'Real Card'
      }), 'backlog')

      ws = await connectWs(port)

      const response = await sendAndReceive(ws, { type: 'ready' }, 'init')
      const cards = response.cards as Array<Record<string, unknown>>
      expect(cards.length).toBe(1)
      expect(cards[0].id).toBe('real-card')
    })

    it('should skip files without valid frontmatter', async () => {
      writeCardFile(tempDir, 'no-frontmatter.md', '# Just a heading\n\nNo frontmatter here.', 'backlog')
      writeCardFile(tempDir, 'valid.md', makeCardContent({
        id: 'valid',
        title: 'Valid Card'
      }), 'backlog')

      ws = await connectWs(port)

      const response = await sendAndReceive(ws, { type: 'ready' }, 'init')
      const cards = response.cards as Array<Record<string, unknown>>
      expect(cards.length).toBe(1)
      expect(cards[0].id).toBe('valid')
    })

    it('should handle Windows-style line endings', async () => {
      const content = makeCardContent({
        id: 'crlf-card',
        title: 'CRLF Card'
      }).replace(/\n/g, '\r\n')

      writeCardFile(tempDir, 'crlf-card.md', content, 'backlog')

      ws = await connectWs(port)

      const response = await sendAndReceive(ws, { type: 'ready' }, 'init')
      const cards = response.cards as Array<Record<string, unknown>>
      expect(cards.length).toBe(1)
      expect(cards[0].id).toBe('crlf-card')
    })
  })

  // ── Settings ──

  describe('settings', () => {
    it('should respond to openSettings with showSettings message', async () => {
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const response = await sendAndReceive(ws, { type: 'openSettings' }, 'showSettings')
      expect(response.type).toBe('showSettings')
      expect(response.settings).toBeDefined()
      const settings = response.settings as Record<string, unknown>
      expect(settings.showPriorityBadges).toBe(true)
      expect(settings.showBuildWithAI).toBe(true)
      expect(settings.markdownEditorMode).toBe(false)
      expect(response.settingsSupport).toMatchObject({
        showBuildWithAI: false,
        markdownEditorMode: false,
      })
      expect(response.pluginSettings).toMatchObject({
        redaction: expect.objectContaining({ maskedValue: '••••••' }),
        capabilities: expect.any(Array),
      })
    })

    it('routes plugin-settings websocket actions with redacted shared result shapes', async () => {
      writeWorkspaceConfig(path.dirname(tempDir), {
        auth: {
          'auth.identity': {
            provider: 'local',
            options: {
              apiToken: 'ws-local-token',
              users: [{ username: 'alice', password: 'ws-super-secret-password', role: 'admin' }],
            },
          },
          'auth.policy': { provider: 'local' },
        },
        plugins: {
          'card.storage': { provider: 'sqlite', options: { sqlitePath: '.kanban/custom.db' } },
        },
      })

      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const settingsResponse = await sendAndReceive(ws, { type: 'openSettings' }, 'showSettings')
      expect(settingsResponse.pluginSettings).toMatchObject({
        redaction: expect.objectContaining({ maskedValue: '••••••' }),
        capabilities: expect.arrayContaining([
          expect.objectContaining({
            capability: 'auth.identity',
            selected: expect.objectContaining({ providerId: 'local' }),
          }),
        ]),
      })
      expect(JSON.stringify(settingsResponse)).not.toContain('ws-local-token')
      expect(JSON.stringify(settingsResponse)).not.toContain('ws-super-secret-password')

      const readResponse = await sendAndReceiveMatching(
        ws,
        { type: 'readPluginSettings', capability: 'auth.identity', providerId: 'local' },
        'pluginSettingsResult',
        (parsed) => parsed.action === 'read',
      )
      expect(readResponse.pluginSettings).toMatchObject({
        redaction: expect.objectContaining({ maskedValue: '••••••' }),
      })
      expect(readResponse.provider).toMatchObject({
        capability: 'auth.identity',
        providerId: 'local',
        selected: {
          capability: 'auth.identity',
          providerId: 'local',
          source: 'legacy',
        },
        options: {
          values: {
            apiToken: '••••••',
            users: [{ username: 'alice', password: '••••••', role: 'admin' }],
          },
        },
      })
      expect(JSON.stringify(readResponse)).not.toContain('ws-local-token')
      expect(JSON.stringify(readResponse)).not.toContain('ws-super-secret-password')

      const selectResponse = await sendAndReceiveMatching(
        ws,
        { type: 'selectPluginSettingsProvider', capability: 'card.storage', providerId: 'localfs' },
        'pluginSettingsResult',
        (parsed) => parsed.action === 'select',
      )
      expect(selectResponse.provider).toMatchObject({
        capability: 'card.storage',
        providerId: 'localfs',
        selected: {
          capability: 'card.storage',
          providerId: 'localfs',
          source: 'config',
        },
      })
      expect(selectResponse.pluginSettings).toMatchObject({
        capabilities: expect.arrayContaining([
          expect.objectContaining({
            capability: 'card.storage',
            selected: expect.objectContaining({ providerId: 'localfs' }),
          }),
        ]),
      })

      const updateResponse = await sendAndReceiveMatching(
        ws,
        {
          type: 'updatePluginSettingsOptions',
          capability: 'auth.identity',
          providerId: 'local',
          options: {
            apiToken: '••••••',
            users: [{ username: 'alice', password: '$2b$12$ws-new-hash', role: 'manager' }],
          },
        },
        'pluginSettingsResult',
        (parsed) => parsed.action === 'updateOptions',
      )
      expect(updateResponse.provider).toMatchObject({
        capability: 'auth.identity',
        providerId: 'local',
        options: {
          values: {
            apiToken: '••••••',
            users: [{ username: 'alice', password: '••••••', role: 'manager' }],
          },
        },
      })
      expect(JSON.stringify(updateResponse)).not.toContain('ws-local-token')
      expect(JSON.stringify(updateResponse)).not.toContain('$2b$12$ws-new-hash')

      const persistedConfig = JSON.parse(fs.readFileSync(path.join(path.dirname(tempDir), '.kanban.json'), 'utf-8')) as {
        plugins: Record<string, { provider: string; options?: Record<string, unknown> }>
      }
      expect(persistedConfig.plugins).toMatchObject({
        'card.storage': { provider: 'localfs' },
        'auth.identity': {
          provider: 'local',
          options: {
            apiToken: 'ws-local-token',
            users: [{ username: 'alice', password: '$2b$12$ws-new-hash', role: 'manager' }],
          },
        },
      })

      const installSpy = vi.spyOn(KanbanSDK.prototype, 'installPluginSettingsPackage').mockResolvedValue({
        packageName: 'kl-plugin-auth',
        scope: 'workspace',
        command: {
          command: 'npm',
          args: ['install', '--ignore-scripts', 'kl-plugin-auth'],
          cwd: path.dirname(tempDir),
          shell: false,
        },
        stdout: 'Authorization: Bearer [REDACTED]',
        stderr: 'password=[REDACTED]',
        message: 'Installed plugin package with lifecycle scripts disabled.',
        redaction: {
          maskedValue: '••••••',
          writeOnly: true,
          targets: ['read', 'list', 'error'],
        },
      })

      const installResponse = await sendAndReceiveMatching(
        ws,
        { type: 'installPluginSettingsPackage', packageName: 'kl-plugin-auth', scope: 'workspace' },
        'pluginSettingsResult',
        (parsed) => parsed.action === 'install' && parsed.error === undefined,
      )
      expect(installResponse.install).toMatchObject({
        packageName: 'kl-plugin-auth',
        scope: 'workspace',
        stdout: 'Authorization: Bearer [REDACTED]',
        stderr: 'password=[REDACTED]',
        redaction: expect.objectContaining({ maskedValue: '••••••' }),
      })
      expect(JSON.stringify(installResponse)).not.toContain('super-secret-password')
      installSpy.mockRestore()
    })

    it('returns sanitized plugin-settings websocket install errors instead of leaking raw diagnostics', async () => {
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const installSpy = vi.spyOn(KanbanSDK.prototype, 'installPluginSettingsPackage').mockRejectedValue(
        new PluginSettingsOperationError(createPluginSettingsErrorPayload({
          code: 'plugin-settings-install-failed',
          message: 'Unable to install plugin package. In-product installs disable lifecycle scripts; install the package manually if it requires lifecycle scripts.',
          details: {
            packageName: 'kl-plugin-auth',
            scope: 'workspace',
            stderr: 'Authorization: Bearer [REDACTED]\npassword=[REDACTED]',
          },
        })),
      )

      const response = await sendAndReceiveMatching(
        ws,
        { type: 'installPluginSettingsPackage', packageName: 'kl-plugin-auth', scope: 'workspace' },
        'pluginSettingsResult',
        (parsed) => parsed.action === 'install' && parsed.error !== undefined,
      )

      expect(response.error).toMatchObject({
        code: 'plugin-settings-install-failed',
        details: expect.objectContaining({
          stderr: expect.stringContaining('[REDACTED]'),
        }),
      })
      expect(response.pluginSettings).toBeUndefined()
      expect(response.provider).toBeUndefined()
      expect(JSON.stringify(response)).not.toContain('npm_super_secret_token')
      expect(JSON.stringify(response)).not.toContain('super-secret-password')
      installSpy.mockRestore()
    })

    it('keeps websocket plugin-settings mutation refreshes inside the request auth scope', async () => {
      const packageName = 'standalone-plugin-settings-websocket-refresh-scope-test'
      const isolated = createIsolatedStandaloneTestWorkspace()
      const cleanup = installTempPackage(
        packageName,
        createPluginSettingsScopedAuthPluginSource(packageName),
      )

      const resolvedConfigPath = writeWorkspaceConfig(isolated.workspaceRoot, {
        auth: {
          'auth.identity': { provider: packageName },
          'auth.policy': { provider: packageName },
        },
        plugins: {
          'card.storage': { provider: 'sqlite', options: { sqlitePath: '.kanban/custom.db' } },
        },
      })

      const localPort = await getPort()
      const localServer = startServer(isolated.kanbanDir, localPort, isolated.webviewDir, resolvedConfigPath)
      await sleep(200)

      const installSpy = vi.spyOn(KanbanSDK.prototype, 'installPluginSettingsPackage').mockResolvedValue({
        packageName: 'kl-plugin-auth',
        scope: 'workspace',
        command: {
          command: 'npm',
          args: ['install', '--ignore-scripts', 'kl-plugin-auth'],
          cwd: isolated.workspaceRoot,
          shell: false,
        },
        stdout: 'Authorization: Bearer [REDACTED]',
        stderr: 'password=[REDACTED]',
        message: 'Installed plugin package with lifecycle scripts disabled.',
        redaction: {
          maskedValue: '••••••',
          writeOnly: true,
          targets: ['read', 'list', 'error'],
        },
      })

      try {
        ws = await connectWs(localPort, { Authorization: 'Bearer admin' })
        await sendAndReceive(ws, { type: 'ready' }, 'init')

        const selectResponse = await sendAndReceiveMatching(
          ws,
          { type: 'selectPluginSettingsProvider', capability: 'card.storage', providerId: 'localfs' },
          'pluginSettingsResult',
          (parsed) => parsed.action === 'select',
        )
        expect(selectResponse.error).toBeUndefined()
        expect(selectResponse.pluginSettings).toMatchObject({
          capabilities: expect.arrayContaining([
            expect.objectContaining({
              capability: 'card.storage',
              selected: expect.objectContaining({ providerId: 'localfs' }),
            }),
          ]),
        })

        const updateResponse = await sendAndReceiveMatching(
          ws,
          {
            type: 'updatePluginSettingsOptions',
            capability: 'card.storage',
            providerId: 'sqlite',
            options: { sqlitePath: '.kanban/updated.db' },
          },
          'pluginSettingsResult',
          (parsed) => parsed.action === 'updateOptions',
        )
        expect(updateResponse.error).toBeUndefined()
        expect(updateResponse.provider).toMatchObject({
          capability: 'card.storage',
          providerId: 'sqlite',
          options: {
            values: {
              sqlitePath: '.kanban/updated.db',
            },
          },
        })

        const installResponse = await sendAndReceiveMatching(
          ws,
          { type: 'installPluginSettingsPackage', packageName: 'kl-plugin-auth', scope: 'workspace' },
          'pluginSettingsResult',
          (parsed) => parsed.action === 'install',
        )
        expect(installResponse.error).toBeUndefined()
        expect(installResponse.install).toMatchObject({
          packageName: 'kl-plugin-auth',
          scope: 'workspace',
        })
        expect(installResponse.pluginSettings).toMatchObject({
          redaction: expect.objectContaining({ maskedValue: '••••••' }),
        })
      } finally {
        installSpy.mockRestore()
        ws.close()
        await new Promise<void>((resolve) => localServer.close(() => resolve()))
        cleanup()
        isolated.cleanup()
      }
    })

    it('preserves successful websocket plugin-settings mutations when refresh inventory reads are denied', async () => {
      const packageName = 'standalone-plugin-settings-websocket-refresh-denied-test'
      const isolated = createIsolatedStandaloneTestWorkspace()
      const cleanup = installTempPackage(
        packageName,
        createPluginSettingsScopedAuthPluginSource(packageName),
      )

      const resolvedConfigPath = writeWorkspaceConfig(isolated.workspaceRoot, {
        auth: {
          'auth.identity': { provider: packageName },
          'auth.policy': { provider: packageName },
        },
        plugins: {
          'card.storage': { provider: 'sqlite', options: { sqlitePath: '.kanban/custom.db' } },
        },
      })

      const localPort = await getPort()
      const localServer = startServer(isolated.kanbanDir, localPort, isolated.webviewDir, resolvedConfigPath)
      await sleep(200)

      const installSpy = vi.spyOn(KanbanSDK.prototype, 'installPluginSettingsPackage').mockResolvedValue({
        packageName: 'kl-plugin-auth',
        scope: 'workspace',
        command: {
          command: 'npm',
          args: ['install', '--ignore-scripts', 'kl-plugin-auth'],
          cwd: isolated.workspaceRoot,
          shell: false,
        },
        stdout: 'Authorization: Bearer [REDACTED]',
        stderr: 'password=[REDACTED]',
        message: 'Installed plugin package with lifecycle scripts disabled.',
        redaction: {
          maskedValue: '••••••',
          writeOnly: true,
          targets: ['read', 'list', 'error'],
        },
      })

      try {
        ws = await connectWs(localPort, { Authorization: 'Bearer manager' })
        await sendAndReceive(ws, { type: 'ready' }, 'init')

        const selectResponse = await sendAndReceiveMatching(
          ws,
          { type: 'selectPluginSettingsProvider', capability: 'card.storage', providerId: 'localfs' },
          'pluginSettingsResult',
          (parsed) => parsed.action === 'select',
        )
        expect(selectResponse.error).toBeUndefined()
        expect(selectResponse.pluginSettings).toMatchObject({
          redaction: expect.objectContaining({ maskedValue: '••••••' }),
          capabilities: [],
        })
        expect(selectResponse.provider).toMatchObject({
          capability: 'card.storage',
          providerId: 'localfs',
          selected: {
            capability: 'card.storage',
            providerId: 'localfs',
            source: 'config',
          },
        })

        const updateResponse = await sendAndReceiveMatching(
          ws,
          {
            type: 'updatePluginSettingsOptions',
            capability: 'card.storage',
            providerId: 'sqlite',
            options: { sqlitePath: '.kanban/updated.db' },
          },
          'pluginSettingsResult',
          (parsed) => parsed.action === 'updateOptions',
        )
        expect(updateResponse.error).toBeUndefined()
        expect(updateResponse.pluginSettings).toMatchObject({
          redaction: expect.objectContaining({ maskedValue: '••••••' }),
          capabilities: [],
        })
        expect(updateResponse.provider).toMatchObject({
          capability: 'card.storage',
          providerId: 'sqlite',
          options: {
            values: {
              sqlitePath: '.kanban/updated.db',
            },
          },
        })

        const installResponse = await sendAndReceiveMatching(
          ws,
          { type: 'installPluginSettingsPackage', packageName: 'kl-plugin-auth', scope: 'workspace' },
          'pluginSettingsResult',
          (parsed) => parsed.action === 'install',
        )
        expect(installResponse.error).toBeUndefined()
        expect(installResponse.pluginSettings).toMatchObject({
          redaction: expect.objectContaining({ maskedValue: '••••••' }),
          capabilities: [],
        })
        expect(installResponse.provider).toBeNull()
        expect(installResponse.install).toMatchObject({
          packageName: 'kl-plugin-auth',
          scope: 'workspace',
        })
      } finally {
        installSpy.mockRestore()
        ws.close()
        await new Promise<void>((resolve) => localServer.close(() => resolve()))
        cleanup()
        isolated.cleanup()
      }
    })

    it('keeps showSettings alive while denied websocket plugin-settings reads fall back to the empty/error channel', async () => {
      const packageName = 'standalone-plugin-settings-websocket-deny-test'
      const isolated = createIsolatedStandaloneTestWorkspace()
      const cleanup = installTempPackage(
        packageName,
        createPluginSettingsScopedAuthPluginSource(packageName),
      )

      const resolvedConfigPath = writeWorkspaceConfig(isolated.workspaceRoot, {
        port,
        auth: {
          'auth.identity': { provider: packageName },
          'auth.policy': { provider: packageName },
        },
      })

      const localPort = await getPort()
      const localServer = startServer(isolated.kanbanDir, localPort, isolated.webviewDir, resolvedConfigPath)
      await sleep(200)

      try {
        ws = await connectWs(localPort, { Authorization: 'Bearer manager' })
        await sendAndReceive(ws, { type: 'ready' }, 'init')

        const showSettings = await sendAndReceive(ws, { type: 'openSettings' }, 'showSettings')
        expect(showSettings.settings).toBeDefined()
        expect(showSettings.pluginSettings).toMatchObject({
          redaction: expect.objectContaining({ maskedValue: '••••••' }),
          capabilities: [],
        })
      } finally {
        ws.close()
        await new Promise<void>((resolve) => localServer.close(() => resolve()))
        cleanup()
        isolated.cleanup()
      }
    })

    it('returns empty websocket plugin-settings/provider payloads when loadPluginSettings is denied', async () => {
      const isolated = createIsolatedStandaloneTestWorkspace()
      const resolvedConfigPath = writeWorkspaceConfig(isolated.workspaceRoot, {
        auth: {
          'auth.identity': {
            provider: 'local',
            options: {
              apiToken: 'load-local-token',
              users: [{ username: 'alice', password: 'load-super-secret-password', role: 'admin' }],
            },
          },
          'auth.policy': { provider: 'local' },
        },
      })

      const localPort = await getPort()
      const localServer = startServer(isolated.kanbanDir, localPort, isolated.webviewDir, resolvedConfigPath)
      await sleep(200)

      try {
        ws = await connectWs(localPort, { Authorization: 'Bearer load-local-token' })
        await sendAndReceive(ws, { type: 'ready' }, 'init')

        const { AuthError } = await import('../../sdk/types')
        const listSpy = vi.spyOn(KanbanSDK.prototype, 'listPluginSettings').mockRejectedValue(
          new AuthError('auth.policy.denied', 'Action "plugin-settings.read" denied', undefined),
        )

        try {
          const pluginSettingsError = await sendAndReceiveMatching(
            ws,
            { type: 'loadPluginSettings' },
            'pluginSettingsResult',
            (parsed) => parsed.action === 'read' && parsed.error !== undefined,
          )
          expect(pluginSettingsError).toMatchObject({
            type: 'pluginSettingsResult',
            action: 'read',
            pluginSettings: {
              redaction: expect.objectContaining({ maskedValue: '••••••' }),
              capabilities: [],
            },
            provider: null,
            error: expect.objectContaining({
              code: 'plugin-settings-read-failed',
              message: 'Unable to read plugin settings.',
            }),
          })
        } finally {
          listSpy.mockRestore()
        }
      } finally {
        ws.close()
        await new Promise<void>((resolve) => localServer.close(() => resolve()))
        isolated.cleanup()
      }
    })

    it('clears stale websocket plugin-settings/provider payloads when a later scoped read is denied', async () => {
      const isolated = createIsolatedStandaloneTestWorkspace()
      const resolvedConfigPath = writeWorkspaceConfig(isolated.workspaceRoot, {
        auth: {
          'auth.identity': {
            provider: 'local',
            options: {
              apiToken: 'stale-local-token',
              users: [{ username: 'alice', password: 'stale-super-secret-password', role: 'admin' }],
            },
          },
          'auth.policy': { provider: 'local' },
        },
      })

      const localPort = await getPort()
      const localServer = startServer(isolated.kanbanDir, localPort, isolated.webviewDir, resolvedConfigPath)
      await sleep(200)

      try {
        ws = await connectWs(localPort, { Authorization: 'Bearer stale-local-token' })
        await sendAndReceive(ws, { type: 'ready' }, 'init')

        const readResponse = await sendAndReceiveMatching(
          ws,
          { type: 'readPluginSettings', capability: 'auth.identity', providerId: 'local' },
          'pluginSettingsResult',
          (parsed) => parsed.action === 'read' && parsed.error === undefined,
        )
        expect(readResponse.provider).toMatchObject({
          capability: 'auth.identity',
          providerId: 'local',
        })

        const { AuthError } = await import('../../sdk/types')
        const listSpy = vi.spyOn(KanbanSDK.prototype, 'listPluginSettings').mockRejectedValue(
          new AuthError('auth.policy.denied', 'Action "plugin-settings.read" denied', undefined),
        )

        const deniedResponse = await sendAndReceiveMatching(
          ws,
          { type: 'readPluginSettings', capability: 'auth.identity', providerId: 'local' },
          'pluginSettingsResult',
          (parsed) => parsed.action === 'read' && parsed.error !== undefined,
        )
        expect(deniedResponse).toMatchObject({
          pluginSettings: {
            redaction: expect.objectContaining({ maskedValue: '••••••' }),
            capabilities: [],
          },
          provider: null,
          error: expect.objectContaining({
            code: 'plugin-settings-read-failed',
            message: 'Unable to read plugin settings.',
          }),
        })
        listSpy.mockRestore()
      } finally {
        ws.close()
        await new Promise<void>((resolve) => localServer.close(() => resolve()))
        isolated.cleanup()
      }
    })

    it('clears stale websocket plugin-settings/provider payloads when plugin-settings mutations are auth-denied', async () => {
      const isolated = createIsolatedStandaloneTestWorkspace()
      const resolvedConfigPath = writeWorkspaceConfig(isolated.workspaceRoot, {
        auth: {
          'auth.identity': {
            provider: 'local',
            options: {
              apiToken: 'mutation-local-token',
              users: [{ username: 'alice', password: 'mutation-super-secret-password', role: 'admin' }],
            },
          },
          'auth.policy': { provider: 'local' },
        },
      })

      const localPort = await getPort()
      const localServer = startServer(isolated.kanbanDir, localPort, isolated.webviewDir, resolvedConfigPath)
      await sleep(200)

      try {
        ws = await connectWs(localPort, { Authorization: 'Bearer mutation-local-token' })
        await sendAndReceive(ws, { type: 'ready' }, 'init')

        const readResponse = await sendAndReceiveMatching(
          ws,
          { type: 'readPluginSettings', capability: 'auth.identity', providerId: 'local' },
          'pluginSettingsResult',
          (parsed) => parsed.action === 'read' && parsed.error === undefined,
        )
        expect(readResponse.provider).toMatchObject({
          capability: 'auth.identity',
          providerId: 'local',
        })

        const { AuthError } = await import('../../sdk/types')
        const cases = [
          {
            action: 'select',
            message: { type: 'selectPluginSettingsProvider', capability: 'auth.identity', providerId: 'local' },
            mock: vi.spyOn(KanbanSDK.prototype, 'selectPluginSettingsProvider').mockRejectedValue(
              new AuthError('auth.policy.denied', 'Action "plugin-settings.update" denied', undefined),
            ),
            expectedError: {
              code: 'plugin-settings-select-failed',
              capability: 'auth.identity',
              providerId: 'local',
            },
          },
          {
            action: 'updateOptions',
            message: {
              type: 'updatePluginSettingsOptions',
              capability: 'auth.identity',
              providerId: 'local',
              options: { apiToken: '••••••' },
            },
            mock: vi.spyOn(KanbanSDK.prototype, 'updatePluginSettingsOptions').mockRejectedValue(
              new AuthError('auth.policy.denied', 'Action "plugin-settings.update" denied', undefined),
            ),
            expectedError: {
              code: 'plugin-settings-update-failed',
              capability: 'auth.identity',
              providerId: 'local',
            },
          },
        ] as const

        try {
          for (const testCase of cases) {
            const deniedResponse = await sendAndReceiveMatching(
              ws,
              testCase.message,
              'pluginSettingsResult',
              (parsed) => parsed.action === testCase.action && parsed.error !== undefined,
            )
            expect(deniedResponse).toMatchObject({
              pluginSettings: {
                redaction: expect.objectContaining({ maskedValue: '••••••' }),
                capabilities: [],
              },
              provider: null,
              error: expect.objectContaining(testCase.expectedError),
            })
          }
        } finally {
          for (const testCase of cases) {
            testCase.mock.mockRestore()
          }
        }
      } finally {
        ws.close()
        await new Promise<void>((resolve) => localServer.close(() => resolve()))
        isolated.cleanup()
      }
    })

    it('should persist settings to .kanban-settings.json', async () => {
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
          cardViewMode: 'normal',
          markdownEditorMode: false,
          defaultPriority: 'high',
          defaultStatus: 'todo'
        }
      }, 'init')

      // init broadcast should have updated settings
      const settings = response.settings as Record<string, unknown>
      expect(settings.cardViewMode).toBe('normal')
      expect(settings.showLabels).toBe(false)
      expect(settings.defaultPriority).toBe('high')
      expect(settings.defaultStatus).toBe('todo')

      // Verify file on disk (config is at workspace root, i.e. parent of cards dir)
      const configFile = path.join(path.dirname(tempDir), '.kanban.json')
      expect(fs.existsSync(configFile)).toBe(true)
      const persisted = JSON.parse(fs.readFileSync(configFile, 'utf-8'))
      expect(persisted.cardViewMode).toBe('normal')
      expect(persisted.showLabels).toBe(false)
    })

    it('should load persisted settings on server restart', async () => {
      // Write config file at workspace root (parent of cards dir)
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

      ws = await connectWs(port)

      const response = await sendAndReceive(ws, { type: 'ready' }, 'init')
      const settings = response.settings as Record<string, unknown>
      expect(settings.showPriorityBadges).toBe(false)
      expect(settings.cardViewMode).toBe('normal')
      expect(settings.defaultPriority).toBe('low')
      // Defaults for unspecified settings
      expect(settings.showAssignee).toBe(true)
      expect(settings.showDueDate).toBe(true)
    })

    it('should broadcast settings to all connected clients', async () => {

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
          cardViewMode: 'normal',
          markdownEditorMode: false,
          defaultPriority: 'medium',
          defaultStatus: 'backlog'
        }
      }))

      const response = await ws2Update
      const settings = response.settings as Record<string, unknown>
      expect(settings.cardViewMode).toBe('normal')
      expect(settings.showFileName).toBe(true)

      ws1.close()
      ws2.close()
      await sleep(50)
    })

    it('should force showBuildWithAI=false even if client sends true', async () => {
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

      ws = await connectWs(port)

      const response = await sendAndReceive(ws, { type: 'ready' }, 'init')
      const settings = response.settings as Record<string, unknown>
      // Should fall back to defaults
      expect(settings.showPriorityBadges).toBe(true)
      expect(settings.cardViewMode).toBe('large')
    })
  })

  // ── REST API: Tasks ──

  describe('REST API — Tasks', () => {
    it('GET /api/tasks should list tasks', async () => {
      writeCardFile(tempDir, 'api-task-1.md', makeCardContent({
        id: 'api-task-1',
        status: 'backlog',
        title: 'API Task 1'
      }), 'backlog')
      writeCardFile(tempDir, 'api-task-2.md', makeCardContent({
        id: 'api-task-2',
        status: 'todo',
        title: 'API Task 2'
      }), 'todo')

      // Initialize via WS so server loads cards
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
      writeCardFile(tempDir, 'filter-1.md', makeCardContent({
        id: 'filter-1',
        status: 'backlog'
      }), 'backlog')
      writeCardFile(tempDir, 'filter-2.md', makeCardContent({
        id: 'filter-2',
        status: 'todo'
      }), 'todo')

      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const res = await httpGet(`http://localhost:${port}/api/tasks?status=todo`)
      const json = JSON.parse(res.body)
      expect(json.ok).toBe(true)
      expect(json.data.length).toBe(1)
      expect(json.data[0].id).toBe('filter-2')
    })

    it('GET /api/tasks should filter by priority', async () => {
      writeCardFile(tempDir, 'pri-high.md', makeCardContent({
        id: 'pri-high',
        priority: 'high'
      }), 'backlog')
      writeCardFile(tempDir, 'pri-low.md', makeCardContent({
        id: 'pri-low',
        priority: 'low'
      }), 'backlog')

      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const res = await httpGet(`http://localhost:${port}/api/tasks?priority=high`)
      const json = JSON.parse(res.body)
      expect(json.ok).toBe(true)
      expect(json.data.length).toBe(1)
      expect(json.data[0].id).toBe('pri-high')
    })

    it('GET /api/tasks should filter by assignee', async () => {
      writeCardFile(tempDir, 'assign-alice.md', makeCardContent({
        id: 'assign-alice',
        assignee: 'alice'
      }), 'backlog')
      writeCardFile(tempDir, 'assign-bob.md', makeCardContent({
        id: 'assign-bob',
        assignee: 'bob'
      }), 'backlog')

      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const res = await httpGet(`http://localhost:${port}/api/tasks?assignee=alice`)
      const json = JSON.parse(res.body)
      expect(json.ok).toBe(true)
      expect(json.data.length).toBe(1)
      expect(json.data[0].id).toBe('assign-alice')
    })

    it('GET /api/tasks should filter by label', async () => {
      writeCardFile(tempDir, 'label-fe.md', makeCardContent({
        id: 'label-fe',
        labels: ['frontend']
      }), 'backlog')
      writeCardFile(tempDir, 'label-be.md', makeCardContent({
        id: 'label-be',
        labels: ['backend']
      }), 'backlog')

      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const res = await httpGet(`http://localhost:${port}/api/tasks?label=frontend`)
      const json = JSON.parse(res.body)
      expect(json.ok).toBe(true)
      expect(json.data.length).toBe(1)
      expect(json.data[0].id).toBe('label-fe')
    })

    it('GET /api/tasks should combine exact q search with meta.* filters', async () => {
      writeCardFile(tempDir, 'release-backend.md', makeCardContent({
        id: 'release-backend',
        title: 'Release Backend API',
        body: 'Coordinate the backend release.',
        metadataBlock: 'team: backend'
      }), 'backlog')
      writeCardFile(tempDir, 'release-frontend.md', makeCardContent({
        id: 'release-frontend',
        title: 'Release Frontend UI',
        body: 'Coordinate the frontend release.',
        metadataBlock: 'team: frontend'
      }), 'backlog')
      writeCardFile(tempDir, 'metadata-only.md', makeCardContent({
        id: 'metadata-only',
        title: 'Roadmap review',
        body: 'Roadmap planning only.',
        metadataBlock: 'team: backend'
      }), 'backlog')

      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const query = new URLSearchParams({
        q: 'release',
        'meta.team': 'backend'
      }).toString()
      const res = await httpGet(`http://localhost:${port}/api/tasks?${query}`)
      const json = JSON.parse(res.body)

      expect(json.ok).toBe(true)
      expect(json.data.map((card: Record<string, unknown>) => card.id)).toEqual(['release-backend'])
    })

    it('GET /api/tasks should support fuzzy q search', async () => {
      writeCardFile(tempDir, 'api-plumbing.md', makeCardContent({
        id: 'api-plumbing',
        title: 'API Plumbing',
        body: 'Implements API plumbing.'
      }), 'backlog')
      writeCardFile(tempDir, 'roadmap.md', makeCardContent({
        id: 'roadmap',
        title: 'Roadmap',
        body: 'Plans next quarter work.'
      }), 'backlog')

      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const query = new URLSearchParams({
        q: 'plumbng',
        fuzzy: 'true'
      }).toString()
      const res = await httpGet(`http://localhost:${port}/api/tasks?${query}`)
      const json = JSON.parse(res.body)

      expect(json.ok).toBe(true)
      expect(json.data.map((card: Record<string, unknown>) => card.id)).toEqual(['api-plumbing'])
    })

    it('GET /api/tasks should keep exact q search strict for the same typo fixture', async () => {
      writeCardFile(tempDir, 'api-plumbing-exact.md', makeCardContent({
        id: 'api-plumbing-exact',
        title: 'API Plumbing',
        body: 'Implements API plumbing.'
      }), 'backlog')

      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const query = new URLSearchParams({
        q: 'plumbng'
      }).toString()
      const res = await httpGet(`http://localhost:${port}/api/tasks?${query}`)
      const json = JSON.parse(res.body)

      expect(json.ok).toBe(true)
      expect(json.data).toHaveLength(0)
    })

    it('GET /api/boards/:boardId/tasks should support fuzzy metadata q search', async () => {
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const createBoardRes = await httpRequest('POST', `http://localhost:${port}/api/boards`, {
        id: 'bugs',
        name: 'Bug Tracker'
      })
      expect(createBoardRes.status).toBe(201)

      await httpRequest('POST', `http://localhost:${port}/api/boards/bugs/tasks`, {
        content: '# Backend incident\n\nTrace the production API failure.',
        status: 'backlog',
        priority: 'high',
        metadata: {
          team: 'backend',
          region: 'us-east'
        }
      })
      await httpRequest('POST', `http://localhost:${port}/api/boards/bugs/tasks`, {
        content: '# Frontend incident\n\nTrace the UI error.',
        status: 'backlog',
        priority: 'high',
        metadata: {
          team: 'frontend',
          region: 'us-west'
        }
      })

      const query = new URLSearchParams({
        q: 'meta.team: backnd meta.region: useast',
        fuzzy: 'true'
      }).toString()
      const res = await httpGet(`http://localhost:${port}/api/boards/bugs/tasks?${query}`)
      const json = JSON.parse(res.body)

      expect(json.ok).toBe(true)
      expect(json.data).toHaveLength(1)
      expect(json.data[0].metadata).toEqual({ team: 'backend', region: 'us-east' })
    })

    it('GET /api/boards/:boardId/tasks should keep metadata q search exact unless fuzzy=true', async () => {
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const createBoardRes = await httpRequest('POST', `http://localhost:${port}/api/boards`, {
        id: 'bugs-exact',
        name: 'Bug Tracker Exact'
      })
      expect(createBoardRes.status).toBe(201)

      await httpRequest('POST', `http://localhost:${port}/api/boards/bugs-exact/tasks`, {
        content: '# Backend incident\n\nTrace the production API failure.',
        status: 'backlog',
        priority: 'high',
        metadata: {
          team: 'backend',
          region: 'us-east'
        }
      })

      const query = new URLSearchParams({
        q: 'meta.team: backnd meta.region: useast'
      }).toString()
      const res = await httpGet(`http://localhost:${port}/api/boards/bugs-exact/tasks?${query}`)
      const json = JSON.parse(res.body)

      expect(json.ok).toBe(true)
      expect(json.data).toHaveLength(0)
    })

    it('GET /api/tasks should pair exact and fuzzy behavior for mixed metadata plus text queries', async () => {
      writeCardFile(tempDir, 'mixed-backend.md', makeCardContent({
        id: 'mixed-backend',
        title: 'Backend release plumbing',
        body: 'Coordinate API plumbing for the backend release.',
        metadataBlock: 'team: backend'
      }), 'backlog')
      writeCardFile(tempDir, 'mixed-frontend.md', makeCardContent({
        id: 'mixed-frontend',
        title: 'Frontend release plumbing',
        body: 'Coordinate API plumbing for the frontend release.',
        metadataBlock: 'team: frontend'
      }), 'backlog')

      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const exactQuery = new URLSearchParams({
        q: 'meta.team: backend plumbng'
      }).toString()
      const exactRes = await httpGet(`http://localhost:${port}/api/tasks?${exactQuery}`)
      const exactJson = JSON.parse(exactRes.body)

      const fuzzyQuery = new URLSearchParams({
        q: 'meta.team: backend plumbng',
        fuzzy: 'true'
      }).toString()
      const fuzzyRes = await httpGet(`http://localhost:${port}/api/tasks?${fuzzyQuery}`)
      const fuzzyJson = JSON.parse(fuzzyRes.body)

      expect(exactJson.ok).toBe(true)
      expect(exactJson.data).toHaveLength(0)
      expect(fuzzyJson.ok).toBe(true)
      expect(fuzzyJson.data.map((card: Record<string, unknown>) => card.id)).toEqual(['mixed-backend'])
    })

    it('GET /api/tasks/:id should return a single task', async () => {
      writeCardFile(tempDir, 'single-task.md', makeCardContent({
        id: 'single-task',
        status: 'todo',
        priority: 'high',
        title: 'Single Task'
      }), 'todo')

      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const res = await httpGet(`http://localhost:${port}/api/tasks/single-task`)
      const json = JSON.parse(res.body)
      expect(json.ok).toBe(true)
      expect(json.data.id).toBe('single-task')
      expect(json.data.status).toBe('todo')
      expect(json.data.filePath).toBeUndefined()
    })

    it('task read routes expose card-state metadata without clearing unread and explicit read/open mutations keep active-card separate', async () => {
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const createRes = await httpRequest('POST', `http://localhost:${port}/api/tasks`, {
        content: '# API Card State Task',
        status: 'todo',
      })
      expect(createRes.status).toBe(201)
      const created = JSON.parse(createRes.body)
      const cardId = created.data.id as string

      const logRes = await httpRequest('POST', `http://localhost:${port}/api/tasks/${cardId}/logs`, {
        text: 'Unread activity from REST test',
      })
      expect(logRes.status).toBe(201)

      const statusRes = await httpGet(`http://localhost:${port}/api/card-state/status`)
      expect(statusRes.status).toBe(200)
      const statusJson = JSON.parse(statusRes.body)
      expect(statusJson.data.defaultActorAvailable).toBe(true)
      const defaultActorId = statusJson.data.defaultActor.id as string

      const listBeforeRes = await httpGet(`http://localhost:${port}/api/tasks`)
      const listBeforeJson = JSON.parse(listBeforeRes.body)
      const listedCard = listBeforeJson.data.find((card: Record<string, unknown>) => card.id === cardId)
      expect(listedCard.cardState.unread).toMatchObject({
        actorId: defaultActorId,
        boardId: 'default',
        cardId,
        unread: true,
        readThrough: null,
      })
      expect(listedCard.cardState.open).toBeNull()

      const getBeforeRes = await httpGet(`http://localhost:${port}/api/tasks/${cardId}`)
      const getBeforeJson = JSON.parse(getBeforeRes.body)
      expect(getBeforeJson.ok).toBe(true)
      expect(getBeforeJson.data.cardState.unread.unread).toBe(true)
      expect(getBeforeJson.data.cardState.open).toBeNull()

      const activeBeforeRes = await httpGet(`http://localhost:${port}/api/tasks/active`)
      expect(JSON.parse(activeBeforeRes.body).data).toBeNull()

      const readRes = await httpRequest('POST', `http://localhost:${port}/api/tasks/${cardId}/read`, {})
      expect(readRes.status).toBe(200)
      const readJson = JSON.parse(readRes.body)
      expect(readJson.data.unread).toMatchObject({
        actorId: defaultActorId,
        boardId: 'default',
        cardId,
        unread: false,
      })
      expect(readJson.data.cardState.open).toBeNull()

      const getAfterReadRes = await httpGet(`http://localhost:${port}/api/tasks/${cardId}`)
      expect(JSON.parse(getAfterReadRes.body).data.cardState.unread.unread).toBe(false)

      const secondLogRes = await httpRequest('POST', `http://localhost:${port}/api/tasks/${cardId}/logs`, {
        text: 'Second unread activity',
      })
      expect(secondLogRes.status).toBe(201)

      const getUnreadAgainRes = await httpGet(`http://localhost:${port}/api/tasks/${cardId}`)
      expect(JSON.parse(getUnreadAgainRes.body).data.cardState.unread.unread).toBe(true)

      const openRes = await httpRequest('POST', `http://localhost:${port}/api/tasks/${cardId}/open`)
      expect(openRes.status).toBe(200)
      const openJson = JSON.parse(openRes.body)
      expect(openJson.data.unread).toMatchObject({
        actorId: defaultActorId,
        boardId: 'default',
        cardId,
        unread: false,
      })
      expect(openJson.data.cardState.open).toMatchObject({
        actorId: defaultActorId,
        boardId: 'default',
        cardId,
        domain: 'open',
        value: {
          openedAt: expect.any(String),
          readThrough: openJson.data.unread.latestActivity,
        },
      })

      const activeAfterOpenRes = await httpGet(`http://localhost:${port}/api/tasks/active`)
      expect(JSON.parse(activeAfterOpenRes.body).data).toBeNull()
    })

    it('websocket init rebroadcasts builtin fallback card-state and openCard clears unread for the default actor', async () => {
      const createRes = await httpRequest('POST', `http://localhost:${port}/api/tasks`, {
        content: '# Builtin WebSocket Card State',
        status: 'todo',
      })
      expect(createRes.status).toBe(201)
      const cardId = JSON.parse(createRes.body).data.id as string

      const statusRes = await httpGet(`http://localhost:${port}/api/card-state/status`)
      expect(statusRes.status).toBe(200)
      const defaultActorId = JSON.parse(statusRes.body).data.defaultActor.id as string

      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')
      const initialStates = await sendAndReceive(ws, { type: 'getCardStates', cardIds: [cardId] }, 'cardStates')
      expect((initialStates.states as Record<string, CardStateReadPayload>)[cardId]?.unread).toMatchObject({
        actorId: defaultActorId,
        boardId: 'default',
        cardId,
        unread: false,
      })

      const updatePromise = waitForMessage(ws, 'init', 5000)
      const logRes = await httpRequest('POST', `http://localhost:${port}/api/tasks/${cardId}/logs`, {
        text: 'Unread activity over builtin websocket session',
      })
      expect(logRes.status).toBe(201)

      const updatedInit = await updatePromise
      const updatedCard = (updatedInit.cards as StandaloneInitCardPayload[]).find((card) => card.id === cardId)
      // Board-level broadcasts defer per-card activity log reads; unread
      // only flips to true on explicit open/detail fetches.
      expect(updatedCard?.cardState?.unread).toMatchObject({
        actorId: defaultActorId,
        boardId: 'default',
        cardId,
        unread: false,
      })

      const openResponse = await sendAndReceive(ws, { type: 'openCard', cardId }, 'cardContent')
      expect(openResponse.cardId).toBe(cardId)

      const detailRes = await httpGet(`http://localhost:${port}/api/tasks/${cardId}`)
      expect(detailRes.status).toBe(200)
      expect(JSON.parse(detailRes.body).data.cardState).toMatchObject({
        unread: {
          actorId: defaultActorId,
          boardId: 'default',
          cardId,
          unread: false,
        },
        open: {
          actorId: defaultActorId,
          boardId: 'default',
          cardId,
          domain: 'open',
        },
      })
    })

    it('GET /api/card-state/status should expose the active card-state provider status', async () => {
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const res = await httpGet(`http://localhost:${port}/api/card-state/status`)
      expect(res.status).toBe(200)
      const json = JSON.parse(res.body)
      expect(json.ok).toBe(true)
      expect(json.data).toMatchObject({
        provider: 'localfs',
        active: true,
        backend: 'builtin',
        availability: 'available',
        defaultActorAvailable: true,
      })
    })

    it('task read and explicit read routes return the documented public card-state identity error when a configured identity cannot be resolved', async () => {
      const cleanup = installTempPackage(
        'card-state-api-auth-failure-test',
        `module.exports = {
  authIdentityPlugin: {
    manifest: { id: 'card-state-api-auth-failure-test', provides: ['auth.identity'] },
    async resolveIdentity() {
      return null
    },
  },
}
`,
      )

      const workspaceRoot = path.dirname(tempDir)
      const resolvedConfigPath = writeWorkspaceConfig(workspaceRoot, {
        port,
        auth: {
          'auth.identity': { provider: 'card-state-api-auth-failure-test' },
          'auth.policy': { provider: 'noop' },
        },
      })

      const localPort = await getPort()
      const localServer = startServer(tempDir, localPort, webviewDir, resolvedConfigPath)
      await sleep(200)

      try {
        const createRes = await httpRequest('POST', `http://localhost:${localPort}/api/tasks`, {
          content: '# Identity Error',
          status: 'todo',
        })
        expect(createRes.status).toBe(201)
        const cardId = JSON.parse(createRes.body).data.id as string

        const taskGetRes = await httpGet(`http://localhost:${localPort}/api/tasks/${cardId}`)
        expect(taskGetRes.status).toBe(400)
        expect(JSON.parse(taskGetRes.body)).toEqual({
          ok: false,
          error: CARD_STATE_IDENTITY_PUBLIC_ERROR,
        })

        const taskReadRes = await httpRequest('POST', `http://localhost:${localPort}/api/tasks/${cardId}/read`, {})
        expect(taskReadRes.status).toBe(400)
        expect(JSON.parse(taskReadRes.body)).toEqual({
          ok: false,
          error: CARD_STATE_IDENTITY_PUBLIC_ERROR,
        })

        const boardGetRes = await httpGet(`http://localhost:${localPort}/api/boards/default/tasks/${cardId}`)
        expect(boardGetRes.status).toBe(400)
        expect(JSON.parse(boardGetRes.body)).toEqual({
          ok: false,
          error: CARD_STATE_IDENTITY_PUBLIC_ERROR,
        })
      } finally {
        await new Promise<void>((resolve) => localServer.close(() => resolve()))
        cleanup()
      }
    })

    it('task read routes distinguish configured identity failures from backend-unavailable card-state failures', async () => {
      const authCleanup = installTempPackage(
        'card-state-api-auth-distinction-test',
        `module.exports = {
  authIdentityPlugin: {
    manifest: { id: 'card-state-api-auth-distinction-test', provides: ['auth.identity'] },
    async resolveIdentity() {
      return null
    },
  },
}
`,
      )

      const workspaceRoot = path.dirname(tempDir)
      const resolvedConfigPath = writeWorkspaceConfig(workspaceRoot, {
        port,
        auth: {
          'auth.identity': { provider: 'card-state-api-auth-distinction-test' },
          'auth.policy': { provider: 'noop' },
        },
      })

      const localPort = await getPort()
      const localServer = startServer(tempDir, localPort, webviewDir, resolvedConfigPath)
      await sleep(200)

      try {
        const localCreateRes = await httpRequest('POST', `http://localhost:${localPort}/api/tasks`, {
          content: '# Error Distinction',
          status: 'todo',
        })
        expect(localCreateRes.status).toBe(201)
        const localCardId = JSON.parse(localCreateRes.body).data.id as string

        const identityRes = await httpGet(`http://localhost:${localPort}/api/tasks/${localCardId}`)
        expect(identityRes.status).toBe(400)
        expect(JSON.parse(identityRes.body)).toEqual({
          ok: false,
          error: CARD_STATE_IDENTITY_PUBLIC_ERROR,
        })

        const sharedCreateRes = await httpRequest('POST', `http://localhost:${port}/api/tasks`, {
          content: '# Backend Unavailable Distinction',
          status: 'todo',
        })
        expect(sharedCreateRes.status).toBe(201)
        const sharedCardId = JSON.parse(sharedCreateRes.body).data.id as string

        const unavailableSpy = vi.spyOn(KanbanSDK.prototype, 'getUnreadSummary').mockRejectedValue(
          new CardStateError(ERR_CARD_STATE_UNAVAILABLE, 'card.state backend offline')
        )

        const unavailableRes = await httpGet(`http://localhost:${port}/api/tasks/${sharedCardId}`)
        expect(unavailableRes.status).toBe(400)
        expect(JSON.parse(unavailableRes.body)).toEqual({
          ok: false,
          error: CARD_STATE_UNAVAILABLE_PUBLIC_ERROR,
        })
        unavailableSpy.mockRestore()
      } finally {
        await new Promise<void>((resolve) => localServer.close(() => resolve()))
        authCleanup()
      }
    })

    it('threads bearer auth into REST task card-state reads per actor', async () => {
      const cleanup = installTempPackage(
        'standalone-card-state-rest-auth-scope-test',
        `module.exports = {
  authIdentityPlugin: {
    manifest: { id: 'standalone-card-state-rest-auth-scope-test', provides: ['auth.identity'] },
    async resolveIdentity(context) {
      if (!context || !context.token) return null
      const token = context.token.startsWith('Bearer ') ? context.token.slice(7) : context.token
      return { subject: 'user-' + token, roles: ['user'] }
    },
  },
}
`,
      )

      const workspaceRoot = path.dirname(tempDir)
      const resolvedConfigPath = writeWorkspaceConfig(workspaceRoot, {
        port,
        auth: {
          'auth.identity': { provider: 'standalone-card-state-rest-auth-scope-test' },
          'auth.policy': { provider: 'noop' },
        },
      })

      const localPort = await getPort()
      const localServer = startServer(tempDir, localPort, webviewDir, resolvedConfigPath)
      await sleep(200)

      try {
        const createRes = await httpRequest('POST', `http://localhost:${localPort}/api/tasks`, {
          content: '# Multi Actor REST Card State',
          status: 'todo',
        })
        expect(createRes.status).toBe(201)
        const cardId = JSON.parse(createRes.body).data.id as string

        const logRes = await httpRequest('POST', `http://localhost:${localPort}/api/tasks/${cardId}/logs`, {
          text: 'Unread activity for multiple actors',
        })
        expect(logRes.status).toBe(201)

        const aliceDetailRes = await httpGet(`http://localhost:${localPort}/api/tasks/${cardId}`, {
          Authorization: 'Bearer alice',
        })
        expect(aliceDetailRes.status).toBe(200)
        expect(JSON.parse(aliceDetailRes.body).data.cardState.unread).toMatchObject({
          actorId: 'user-alice',
          cardId,
          unread: true,
        })

        const bobDetailRes = await httpGet(`http://localhost:${localPort}/api/tasks/${cardId}`, {
          Authorization: 'Bearer bob',
        })
        expect(bobDetailRes.status).toBe(200)
        expect(JSON.parse(bobDetailRes.body).data.cardState.unread).toMatchObject({
          actorId: 'user-bob',
          cardId,
          unread: true,
        })

        const aliceReadRes = await httpRequest('POST', `http://localhost:${localPort}/api/tasks/${cardId}/read`, {}, {
          Authorization: 'Bearer alice',
        })
        expect(aliceReadRes.status).toBe(200)
        expect(JSON.parse(aliceReadRes.body).data.cardState.unread).toMatchObject({
          actorId: 'user-alice',
          cardId,
          unread: false,
        })

        const aliceAfterReadRes = await httpGet(`http://localhost:${localPort}/api/tasks/${cardId}`, {
          Authorization: 'Bearer alice',
        })
        expect(JSON.parse(aliceAfterReadRes.body).data.cardState.unread).toMatchObject({
          actorId: 'user-alice',
          cardId,
          unread: false,
        })

        const bobAfterAliceReadRes = await httpGet(`http://localhost:${localPort}/api/tasks/${cardId}`, {
          Authorization: 'Bearer bob',
        })
        expect(JSON.parse(bobAfterAliceReadRes.body).data.cardState.unread).toMatchObject({
          actorId: 'user-bob',
          cardId,
          unread: true,
        })
      } finally {
        await new Promise<void>((resolve) => localServer.close(() => resolve()))
        cleanup()
      }
    })

    it('uses request-scoped auth for task and board list/get/active/open/read lookups when visibility is caller-specific', async () => {
      const packageName = 'standalone-rest-auth-visibility-lookups-test'
      const isolated = createIsolatedStandaloneTestWorkspace()
      const cleanup = installTempPackage(
        packageName,
        createVisibilityScopedAuthIdentityPluginSource(packageName),
      )

      writeCardFile(isolated.kanbanDir, 'public-card.md', makeCardContent({
        id: 'public-card',
        labels: ['public'],
        order: 'a0',
      }), 'backlog')
      writeCardFile(isolated.kanbanDir, 'private-card.md', makeCardContent({
        id: 'private-card',
        labels: ['private'],
        order: 'a1',
      }), 'backlog')
      fs.writeFileSync(
        path.join(isolated.kanbanDir, '.active-card.json'),
        JSON.stringify({
          cardId: 'private-card',
          boardId: 'default',
          updatedAt: '2026-03-31T00:00:00.000Z',
        }),
        'utf-8',
      )

      const resolvedConfigPath = writeWorkspaceConfig(isolated.workspaceRoot, {
        port,
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
      })

      const localPort = await getPort()
      const localServer = startServer(isolated.kanbanDir, localPort, isolated.webviewDir, resolvedConfigPath)
      await sleep(200)

      const readerHeaders = { Authorization: 'Bearer reader-token' }
      const expectTaskNotFound = async (
        responsePromise: Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>,
      ) => {
        const response = await responsePromise
        expect(response.status).toBe(404)
        expect(JSON.parse(response.body)).toEqual({
          ok: false,
          error: 'Task not found',
        })
      }

      try {
        const listRes = await httpGet(`http://localhost:${localPort}/api/tasks`, readerHeaders)
        expect(listRes.status).toBe(200)
        expect(JSON.parse(listRes.body).data.map((card: { id: string }) => card.id)).toEqual(['public-card'])

        const boardListRes = await httpGet(`http://localhost:${localPort}/api/boards/default/tasks`, readerHeaders)
        expect(boardListRes.status).toBe(200)
        expect(JSON.parse(boardListRes.body).data.map((card: { id: string }) => card.id)).toEqual(['public-card'])

        const activeRes = await httpGet(`http://localhost:${localPort}/api/tasks/active`, readerHeaders)
        expect(activeRes.status).toBe(200)
        expect(JSON.parse(activeRes.body).data).toBeNull()

        const boardActiveRes = await httpGet(`http://localhost:${localPort}/api/boards/default/tasks/active`, readerHeaders)
        expect(boardActiveRes.status).toBe(200)
        expect(JSON.parse(boardActiveRes.body).data).toBeNull()

        await expectTaskNotFound(httpGet(`http://localhost:${localPort}/api/tasks/private-card`, readerHeaders))
        await expectTaskNotFound(httpGet(`http://localhost:${localPort}/api/boards/default/tasks/private-card`, readerHeaders))
        await expectTaskNotFound(httpRequest('POST', `http://localhost:${localPort}/api/tasks/private-card/open`, {}, readerHeaders))
        await expectTaskNotFound(httpRequest('POST', `http://localhost:${localPort}/api/tasks/private-card/read`, {}, readerHeaders))
        await expectTaskNotFound(httpRequest('POST', `http://localhost:${localPort}/api/boards/default/tasks/private-card/open`, {}, readerHeaders))
        await expectTaskNotFound(httpRequest('POST', `http://localhost:${localPort}/api/boards/default/tasks/private-card/read`, {}, readerHeaders))
      } finally {
        await new Promise<void>((resolve) => localServer.close(() => resolve()))
        cleanup()
        isolated.cleanup()
      }
    })

    it('serializes task permissions on list/detail responses, resolves forms on detail, and keeps hidden cards not-found', async () => {
      const packageName = 'standalone-rest-task-read-model-contract-test'
      const isolated = createIsolatedStandaloneTestWorkspace()
      const cleanup = installTempPackage(
        packageName,
        createTaskReadModelAuthPluginSource(packageName),
      )

      const localPort = await getPort()
      const resolvedConfigPath = writeWorkspaceConfig(isolated.workspaceRoot, {
        port: localPort,
        forms: {
          inspection: {
            schema: {
              type: 'object',
              title: 'Inspection',
              properties: {
                reporter: { type: 'string' },
                status: { type: 'string' },
                note: { type: 'string' },
                region: { type: 'string' },
              },
            },
            data: {
              reporter: '${assignee}',
              status: 'new',
            },
          },
        },
        plugins: {
          'auth.identity': { provider: packageName },
          'auth.policy': { provider: packageName },
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
      })

      const localServer = startServer(isolated.kanbanDir, localPort, isolated.webviewDir, resolvedConfigPath)
      await sleep(200)

      const writerHeaders = { Authorization: 'Bearer writer-token' }
      const readerHeaders = { Authorization: 'Bearer reader-token' }

      try {
        const createPublicRes = await httpRequest('POST', `http://localhost:${localPort}/api/tasks`, {
          content: '# Public task',
          status: 'backlog',
          assignee: 'casey',
          labels: ['public'],
          metadata: { region: 'north' },
          actions: ['dispatch'],
          forms: [{
            name: 'inspection',
            data: {
              status: 'triage',
            },
          }],
          formData: {
            inspection: {
              note: 'persisted note',
            },
          },
        }, writerHeaders)
        expect(createPublicRes.status).toBe(201)
        const publicCardId = JSON.parse(createPublicRes.body).data.id as string

        const createCommentRes = await httpRequest('POST', `http://localhost:${localPort}/api/tasks/${publicCardId}/comments`, {
          author: 'casey',
          content: 'Writer note',
        }, writerHeaders)
        expect(createCommentRes.status).toBe(201)
        const publicCommentId = JSON.parse(createCommentRes.body).data.id as string

        const uploadAttachmentRes = await httpRequest('POST', `http://localhost:${localPort}/api/tasks/${publicCardId}/attachments`, {
          files: [{
            name: 'field-photo.txt',
            data: Buffer.from('snapshot').toString('base64'),
          }],
        }, writerHeaders)
        expect(uploadAttachmentRes.status).toBe(200)

        const createPrivateRes = await httpRequest('POST', `http://localhost:${localPort}/api/tasks`, {
          content: '# Private task',
          status: 'backlog',
          labels: ['private'],
        }, writerHeaders)
        expect(createPrivateRes.status).toBe(201)
        const privateCardId = JSON.parse(createPrivateRes.body).data.id as string

        const readerListRes = await httpGet(`http://localhost:${localPort}/api/tasks`, readerHeaders)
        expect(readerListRes.status).toBe(200)
        const readerListJson = JSON.parse(readerListRes.body)
        const readerAttachmentPermissions = Object.fromEntries(
          (readerListJson.data[0].attachments as string[]).map((attachmentName) => [attachmentName, { remove: false }]),
        )
        expect(readerListJson.data).toHaveLength(1)
        expect(readerListJson.data[0]).toMatchObject({
          id: publicCardId,
          permissions: {
            comment: {
              create: false,
              update: false,
              delete: false,
              byId: {
                [publicCommentId]: {
                  update: false,
                  delete: false,
                },
              },
            },
            attachment: {
              add: false,
              remove: false,
            },
            form: {
              submit: false,
              byId: {
                inspection: {
                  submit: false,
                },
              },
            },
            checklist: {
              show: true,
              add: false,
              edit: false,
              delete: false,
              check: false,
              uncheck: false,
            },
            cardAction: {
              trigger: false,
              byKey: {
                dispatch: {
                  trigger: false,
                },
              },
            },
          },
        })
        expect(readerListJson.data[0].permissions.attachment.byName).toEqual(readerAttachmentPermissions)
        expect(readerListJson.data[0].resolvedForms).toBeUndefined()

        const writerDetailRes = await httpGet(`http://localhost:${localPort}/api/tasks/${publicCardId}`, writerHeaders)
        expect(writerDetailRes.status).toBe(200)
        const writerDetailJson = JSON.parse(writerDetailRes.body)
        const writerAttachmentPermissions = Object.fromEntries(
          (writerDetailJson.data.attachments as string[]).map((attachmentName) => [attachmentName, { remove: true }]),
        )
        expect(writerDetailJson.data.permissions).toMatchObject({
          comment: {
            create: true,
            update: true,
            delete: true,
            byId: {
              [publicCommentId]: {
                update: true,
                delete: true,
              },
            },
          },
          attachment: {
            add: true,
            remove: true,
          },
          form: {
            submit: true,
            byId: {
              inspection: {
                submit: true,
              },
            },
          },
          checklist: {
            show: true,
            add: true,
            edit: true,
            delete: true,
            check: true,
            uncheck: true,
          },
          cardAction: {
            trigger: true,
            byKey: {
              dispatch: {
                trigger: true,
              },
            },
          },
        })
        expect(writerDetailJson.data.permissions.attachment.byName).toEqual(writerAttachmentPermissions)
        expect(writerDetailJson.data.resolvedForms).toEqual([
          expect.objectContaining({
            id: 'inspection',
            name: 'Inspection',
            label: 'Inspection',
            fromConfig: true,
            initialData: {
              reporter: 'casey',
              status: 'triage',
              note: 'persisted note',
              region: 'north',
            },
          }),
        ])

        const readerDetailRes = await httpGet(`http://localhost:${localPort}/api/tasks/${publicCardId}`, readerHeaders)
        expect(readerDetailRes.status).toBe(200)
        const readerDetailJson = JSON.parse(readerDetailRes.body)
        const readerDetailAttachmentPermissions = Object.fromEntries(
          (readerDetailJson.data.attachments as string[]).map((attachmentName) => [attachmentName, { remove: false }]),
        )
        expect(readerDetailJson.data.permissions).toMatchObject({
          comment: {
            create: false,
            update: false,
            delete: false,
          },
          attachment: {
            add: false,
            remove: false,
          },
          form: {
            submit: false,
          },
          checklist: {
            show: true,
            add: false,
            edit: false,
            delete: false,
            check: false,
            uncheck: false,
          },
          cardAction: {
            trigger: false,
          },
        })
        expect(readerDetailJson.data.permissions.attachment.byName).toEqual(readerDetailAttachmentPermissions)
        expect(readerDetailJson.data.resolvedForms).toEqual([
          expect.objectContaining({
            id: 'inspection',
            initialData: {
              reporter: 'casey',
              status: 'triage',
              note: 'persisted note',
              region: 'north',
            },
          }),
        ])

        const hiddenRes = await httpGet(`http://localhost:${localPort}/api/tasks/${privateCardId}`, readerHeaders)
        expect(hiddenRes.status).toBe(404)
        expect(JSON.parse(hiddenRes.body)).toEqual({
          ok: false,
          error: 'Task not found',
        })
      } finally {
        await new Promise<void>((resolve) => localServer.close(() => resolve()))
        cleanup()
        isolated.cleanup()
      }
    })

    it('returns 404 for hidden task and board card-targeted mutations instead of leaking cached card existence', async () => {
      const packageName = 'standalone-rest-auth-visibility-mutations-test'
      const isolated = createIsolatedStandaloneTestWorkspace()
      const cleanup = installTempPackage(
        packageName,
        createVisibilityScopedAuthIdentityPluginSource(packageName),
      )

      writeCardFile(isolated.kanbanDir, 'public-card.md', makeCardContent({
        id: 'public-card',
        labels: ['public'],
        order: 'a0',
      }), 'backlog')
      writeCardFile(isolated.kanbanDir, 'private-card.md', makeCardContent({
        id: 'private-card',
        labels: ['private'],
        order: 'a1',
      }), 'backlog')

      const resolvedConfigPath = writeWorkspaceConfig(isolated.workspaceRoot, {
        port,
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
      })

      const localPort = await getPort()
      const localServer = startServer(isolated.kanbanDir, localPort, isolated.webviewDir, resolvedConfigPath)
      await sleep(200)

      const readerHeaders = { Authorization: 'Bearer reader-token' }
      const writerHeaders = { Authorization: 'Bearer writer-token' }
      const expectTaskNotFoundStatus = async (
        responsePromise: Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>,
      ) => {
        const response = await responsePromise
        expect(response.status).toBe(404)
      }

      try {
        const createBoardRes = await httpRequest('POST', `http://localhost:${localPort}/api/boards`, {
          id: 'ops',
          name: 'Ops',
        }, writerHeaders)
        expect(createBoardRes.status).toBe(201)

        await expectTaskNotFoundStatus(httpRequest('PUT', `http://localhost:${localPort}/api/tasks/private-card`, {
          priority: 'high',
        }, readerHeaders))
        await expectTaskNotFoundStatus(httpRequest('PATCH', `http://localhost:${localPort}/api/tasks/private-card/move`, {
          status: 'done',
          position: 0,
        }, readerHeaders))
        await expectTaskNotFoundStatus(httpRequest('DELETE', `http://localhost:${localPort}/api/tasks/private-card`, undefined, readerHeaders))
        await expectTaskNotFoundStatus(httpRequest('DELETE', `http://localhost:${localPort}/api/tasks/private-card/permanent`, undefined, readerHeaders))

        await expectTaskNotFoundStatus(httpRequest('PUT', `http://localhost:${localPort}/api/boards/default/tasks/private-card`, {
          priority: 'high',
        }, readerHeaders))
        await expectTaskNotFoundStatus(httpRequest('PATCH', `http://localhost:${localPort}/api/boards/default/tasks/private-card/move`, {
          status: 'done',
          position: 0,
        }, readerHeaders))
        await expectTaskNotFoundStatus(httpRequest('DELETE', `http://localhost:${localPort}/api/boards/default/tasks/private-card`, undefined, readerHeaders))
        await expectTaskNotFoundStatus(httpRequest('DELETE', `http://localhost:${localPort}/api/boards/default/tasks/private-card/permanent`, undefined, readerHeaders))
        await expectTaskNotFoundStatus(httpRequest('POST', `http://localhost:${localPort}/api/boards/ops/tasks/private-card/transfer`, {
          targetStatus: 'backlog',
        }, readerHeaders))
      } finally {
        await new Promise<void>((resolve) => localServer.close(() => resolve()))
        cleanup()
        isolated.cleanup()
      }
    })

    it('treats hidden cards as not found across comment, log, attachment, and system attachment routes', async () => {
      const packageName = 'standalone-rest-auth-visibility-card-data-test'
      const isolated = createIsolatedStandaloneTestWorkspace()
      const cleanup = installTempPackage(
        packageName,
        createVisibilityScopedAuthIdentityPluginSource(packageName),
      )

      writeCardFile(isolated.kanbanDir, 'public-card.md', makeCardContent({
        id: 'public-card',
        labels: ['public'],
        order: 'a0',
      }), 'backlog')
      writeCardFile(isolated.kanbanDir, 'private-card.md', makeCardContent({
        id: 'private-card',
        labels: ['private'],
        order: 'a1',
      }), 'backlog')

      const resolvedConfigPath = writeWorkspaceConfig(isolated.workspaceRoot, {
        port,
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
      })

      const localPort = await getPort()
      const localServer = startServer(isolated.kanbanDir, localPort, isolated.webviewDir, resolvedConfigPath)
      await sleep(200)

      const readerHeaders = { Authorization: 'Bearer reader-token' }
      const writerHeaders = { Authorization: 'Bearer writer-token' }
      const expectJsonNotFound = async (
        responsePromise: Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>,
      ) => {
        const response = await responsePromise
        expect(response.status).toBe(404)
        const json = JSON.parse(response.body)
        expect(json.ok).toBe(false)
        expect(String(json.error).toLowerCase()).toContain('not found')
      }

      try {
        const seedCommentRes = await httpRequest('POST', `http://localhost:${localPort}/api/tasks/private-card/comments`, {
          author: 'casey',
          content: 'private note',
        }, writerHeaders)
        expect(seedCommentRes.status).toBe(201)

        const seedLogRes = await httpRequest('POST', `http://localhost:${localPort}/api/tasks/private-card/logs`, {
          text: 'private log entry',
        }, writerHeaders)
        expect(seedLogRes.status).toBe(201)

        const seedAttachmentRes = await httpRequest('POST', `http://localhost:${localPort}/api/tasks/private-card/attachments`, {
          files: [{
            name: 'secret.txt',
            data: Buffer.from('classified').toString('base64'),
          }],
        }, writerHeaders)
        expect(seedAttachmentRes.status).toBe(200)

        await expectJsonNotFound(httpGet(`http://localhost:${localPort}/api/tasks/private-card/comments`, readerHeaders))
        await expectJsonNotFound(httpRequest('POST', `http://localhost:${localPort}/api/tasks/private-card/comments`, {
          author: 'alice',
          content: 'should be hidden',
        }, readerHeaders))

        await expectJsonNotFound(httpGet(`http://localhost:${localPort}/api/tasks/private-card/logs`, readerHeaders))
        await expectJsonNotFound(httpRequest('POST', `http://localhost:${localPort}/api/tasks/private-card/logs`, {
          text: 'should be hidden',
        }, readerHeaders))

        await expectJsonNotFound(httpRequest('POST', `http://localhost:${localPort}/api/tasks/private-card/attachments`, {
          files: [{
            name: 'blocked.txt',
            data: Buffer.from('blocked').toString('base64'),
          }],
        }, readerHeaders))
        await expectJsonNotFound(httpGet(`http://localhost:${localPort}/api/tasks/private-card/attachments/secret.txt`, readerHeaders))
        await expectJsonNotFound(httpRequest('DELETE', `http://localhost:${localPort}/api/tasks/private-card/attachments/secret.txt`, undefined, readerHeaders))

        const hiddenSystemUploadRes = await httpRequest('POST', `http://localhost:${localPort}/api/upload-attachment`, {
          cardId: 'private-card',
          files: [{
            name: 'system-secret.txt',
            data: Buffer.from('still blocked').toString('base64'),
          }],
        }, readerHeaders)
        expect(hiddenSystemUploadRes.status).toBe(404)
        expect(JSON.parse(hiddenSystemUploadRes.body)).toEqual({
          ok: false,
          error: 'Card not found',
        })

        const hiddenSystemGetRes = await httpGet(
          `http://localhost:${localPort}/api/attachment?cardId=private-card&filename=secret.txt`,
          readerHeaders,
        )
        expect(hiddenSystemGetRes.status).toBe(404)
        expect(hiddenSystemGetRes.body).toBe('Card not found')
      } finally {
        await new Promise<void>((resolve) => localServer.close(() => resolve()))
        cleanup()
        isolated.cleanup()
      }
    })

    it('treats hidden /api/card-file requests as not found and syncs temp-file edits through the opener auth context', async () => {
      const packageName = 'standalone-rest-auth-visibility-card-file-test'
      const isolated = createIsolatedStandaloneTestWorkspace()
      const cleanup = installTempPackage(
        packageName,
        createVisibilityScopedAuthIdentityPluginSource(packageName),
      )

      const privateCardPath = writeCardFile(isolated.kanbanDir, 'private-card.md', makeCardContent({
        id: 'private-card',
        labels: ['private'],
        order: 'a1',
        body: 'Original private body.',
      }), 'backlog')

      const resolvedConfigPath = writeWorkspaceConfig(isolated.workspaceRoot, {
        port,
        plugins: {
          'auth.identity': { provider: packageName },
          'auth.policy': { provider: 'noop' },
          'auth.visibility': {
            provider: 'kl-plugin-auth-visibility',
            options: {
              rules: [
                { roles: ['writer'], labels: ['private'] },
                { roles: ['reader'], labels: ['public'] },
              ],
            },
          },
        },
      })

      const localPort = await getPort()
      const localServer = startServer(isolated.kanbanDir, localPort, isolated.webviewDir, resolvedConfigPath)
      await sleep(200)

      const readerHeaders = { Authorization: 'Bearer reader-token' }
      const writerHeaders = { Authorization: 'Bearer writer-token' }
      let writerWs: WebSocket | undefined

      try {
        writerWs = await connectWs(localPort, writerHeaders)
        await sendAndReceive(writerWs, { type: 'ready' }, 'init')

        const hiddenRes = await httpGet(`http://localhost:${localPort}/api/card-file?cardId=private-card`, readerHeaders)
        expect(hiddenRes.status).toBe(404)
        expect(JSON.parse(hiddenRes.body)).toEqual({
          ok: false,
          error: 'Card not found',
        })

        const openRes = await httpGet(`http://localhost:${localPort}/api/card-file?cardId=private-card`, writerHeaders)
        expect(openRes.status).toBe(200)
        const openPayload = JSON.parse(openRes.body) as { ok: boolean; data: { path: string } }
        expect(openPayload.ok).toBe(true)
        expect(typeof openPayload.data.path).toBe('string')

        const tempFilePath = openPayload.data.path
        const tempCard = fs.readFileSync(tempFilePath, 'utf-8')
        fs.writeFileSync(tempFilePath, tempCard.replace('Original private body.', 'Updated through temp file.'), 'utf-8')

        let syncedSource = fs.readFileSync(privateCardPath, 'utf-8')
        for (let attempt = 0; attempt < 20 && !syncedSource.includes('Updated through temp file.'); attempt += 1) {
          await sleep(100)
          syncedSource = fs.readFileSync(privateCardPath, 'utf-8')
        }

        expect(syncedSource).toContain('Updated through temp file.')
      } finally {
        writerWs?.close()
        await new Promise<void>((resolve) => localServer.close(() => resolve()))
        cleanup()
        isolated.cleanup()
      }
    })

    it('scopes websocket init and hidden card-state requests per client visibility', async () => {
      const packageName = 'standalone-websocket-auth-visibility-init-test'
      const isolated = createIsolatedStandaloneTestWorkspace()
      const cleanup = installTempPackage(
        packageName,
        createVisibilityScopedAuthIdentityPluginSource(packageName),
      )

      writeCardFile(isolated.kanbanDir, 'public-card.md', makeCardContent({
        id: 'public-card',
        labels: ['public'],
        order: 'a0',
      }), 'backlog')
      writeCardFile(isolated.kanbanDir, 'private-card.md', makeCardContent({
        id: 'private-card',
        labels: ['private'],
        order: 'a1',
      }), 'backlog')

      const resolvedConfigPath = writeWorkspaceConfig(isolated.workspaceRoot, {
        port,
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
      })

      const localPort = await getPort()
      const localServer = startServer(isolated.kanbanDir, localPort, isolated.webviewDir, resolvedConfigPath)
      await sleep(200)

      const readerWs = await connectWs(localPort, { Authorization: 'Bearer reader-token' })
      const writerWs = await connectWs(localPort, { Authorization: 'Bearer writer-token' })

      try {
        const readerInit = await sendAndReceive(readerWs, { type: 'ready' }, 'init')
        const writerInit = await sendAndReceive(writerWs, { type: 'ready' }, 'init')

        expect((readerInit.cards as Array<{ id: string }>).map((card) => card.id)).toEqual(['public-card'])
        expect((writerInit.cards as Array<{ id: string }>).map((card) => card.id)).toEqual(['public-card', 'private-card'])

        const hiddenStates = await sendAndReceive(readerWs, { type: 'getCardStates', cardIds: ['private-card'] }, 'cardStates')
        expect(hiddenStates.states).toEqual({})
      } finally {
        readerWs.close()
        writerWs.close()
        await sleep(50)
        await new Promise<void>((resolve) => localServer.close(() => resolve()))
        cleanup()
        isolated.cleanup()
      }
    })

    it('treats websocket open, close, log, and state paths as hidden-as-not-found per client auth context', async () => {
      const packageName = 'standalone-websocket-auth-visibility-card-detail-test'
      const isolated = createIsolatedStandaloneTestWorkspace()
      const cleanup = installTempPackage(
        packageName,
        createVisibilityScopedAuthIdentityPluginSource(packageName),
      )

      writeCardFile(isolated.kanbanDir, 'public-card.md', makeCardContent({
        id: 'public-card',
        labels: ['public'],
        order: 'a0',
      }), 'backlog')
      writeCardFile(isolated.kanbanDir, 'private-card.md', makeCardContent({
        id: 'private-card',
        labels: ['private'],
        order: 'a1',
      }), 'backlog')

      const resolvedConfigPath = writeWorkspaceConfig(isolated.workspaceRoot, {
        port,
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
      })

      const localPort = await getPort()
      const localServer = startServer(isolated.kanbanDir, localPort, isolated.webviewDir, resolvedConfigPath)
      await sleep(200)

      const readerHeaders = { Authorization: 'Bearer reader-token' }
      const writerHeaders = { Authorization: 'Bearer writer-token' }
      const readerWs = await connectWs(localPort, readerHeaders)
      const writerWs = await connectWs(localPort, writerHeaders)

      try {
        await sendAndReceive(readerWs, { type: 'ready' }, 'init')
        await sendAndReceive(writerWs, { type: 'ready' }, 'init')

        const hiddenStates = await sendAndReceive(readerWs, { type: 'getCardStates', cardIds: ['private-card'] }, 'cardStates')
        expect(hiddenStates.states).toEqual({})

        readerWs.send(JSON.stringify({ type: 'openCard', cardId: 'private-card' }))
        await expectNoMessageOfTypes(readerWs, ['cardContent', 'logsUpdated'])

        const hiddenActiveRes = await httpGet(`http://localhost:${localPort}/api/tasks/active`, readerHeaders)
        expect(hiddenActiveRes.status).toBe(200)
        expect(JSON.parse(hiddenActiveRes.body).data).toBeNull()

        const writerOpen = await sendAndReceive(writerWs, { type: 'openCard', cardId: 'private-card' }, 'cardContent')
        expect(writerOpen.cardId).toBe('private-card')

        readerWs.send(JSON.stringify({ type: 'closeCard' }))
        await sleep(150)

        const writerActiveRes = await httpGet(`http://localhost:${localPort}/api/tasks/active`, writerHeaders)
        expect(writerActiveRes.status).toBe(200)
        expect(JSON.parse(writerActiveRes.body).data).toMatchObject({ id: 'private-card' })

        readerWs.send(JSON.stringify({ type: 'getLogs', cardId: 'private-card' }))
        await expectNoMessageOfTypes(readerWs, 'logsUpdated')

        const writerLogsUpdatePromise = waitForMessage(writerWs, 'logsUpdated', 5000)
        const hiddenReaderLogs = expectNoMessageOfTypes(readerWs, 'logsUpdated', 800)
        const logRes = await httpRequest('POST', `http://localhost:${localPort}/api/tasks/private-card/logs`, {
          text: 'writer-only private log',
        }, writerHeaders)
        expect(logRes.status).toBe(201)

        const writerLogsUpdate = await writerLogsUpdatePromise
        expect(writerLogsUpdate.cardId).toBe('private-card')
        expect(writerLogsUpdate.logs).toEqual(expect.arrayContaining([
          expect.objectContaining({ text: 'writer-only private log' }),
        ]))
        await hiddenReaderLogs
      } finally {
        readerWs.close()
        writerWs.close()
        await sleep(50)
        await new Promise<void>((resolve) => localServer.close(() => resolve()))
        cleanup()
        isolated.cleanup()
      }
    })

    it('limits websocket comment-stream events to visible clients editing that card', async () => {
      const packageName = 'standalone-websocket-auth-visibility-comment-stream-test'
      const isolated = createIsolatedStandaloneTestWorkspace()
      const cleanup = installTempPackage(
        packageName,
        createVisibilityScopedAuthIdentityPluginSource(packageName),
      )

      writeCardFile(isolated.kanbanDir, 'public-card.md', makeCardContent({
        id: 'public-card',
        labels: ['public'],
        order: 'a0',
      }), 'backlog')
      writeCardFile(isolated.kanbanDir, 'private-card.md', makeCardContent({
        id: 'private-card',
        labels: ['private'],
        order: 'a1',
      }), 'backlog')

      const resolvedConfigPath = writeWorkspaceConfig(isolated.workspaceRoot, {
        port,
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
      })

      const localPort = await getPort()
      const localServer = startServer(isolated.kanbanDir, localPort, isolated.webviewDir, resolvedConfigPath)
      await sleep(200)

      const readerHeaders = { Authorization: 'Bearer reader-token' }
      const writerHeaders = { Authorization: 'Bearer writer-token' }
      const readerWs = await connectWs(localPort, readerHeaders)
      const writerWs = await connectWs(localPort, writerHeaders)

      try {
        await sendAndReceive(readerWs, { type: 'ready' }, 'init')
        await sendAndReceive(writerWs, { type: 'ready' }, 'init')
        await sendAndReceive(writerWs, { type: 'openCard', cardId: 'private-card' }, 'cardContent')

        const readerNoStreamEvents = expectNoMessageOfTypes(readerWs, [
          'commentStreamStart',
          'commentChunk',
          'commentStreamDone',
        ], 1000)
        const writerStreamStart = waitForMessage(writerWs, 'commentStreamStart', 5000)
        const writerStreamDone = waitForMessage(writerWs, 'commentStreamDone', 5000)

        const streamRes = await new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
          const req = http.request(
            {
              hostname: 'localhost',
              port: localPort,
              path: '/api/tasks/private-card/comments/stream?author=casey',
              method: 'POST',
              headers: {
                ...writerHeaders,
                'Content-Type': 'text/plain',
                'Transfer-Encoding': 'chunked',
              },
            },
            (res) => {
              let body = ''
              res.on('data', (chunk) => body += chunk)
              res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }))
            },
          )
          req.on('error', reject)
          req.write('private ')
          setTimeout(() => {
            req.end('streamed comment')
          }, 25)
        })
        expect(streamRes.status).toBe(201)

        expect((await writerStreamStart).cardId).toBe('private-card')
        expect((await writerStreamDone).cardId).toBe('private-card')
        await readerNoStreamEvents
      } finally {
        readerWs.close()
        writerWs.close()
        await sleep(50)
        await new Promise<void>((resolve) => localServer.close(() => resolve()))
        cleanup()
        isolated.cleanup()
      }
    })

    it('GET /api/tasks/:id should return 404 for non-existent task', async () => {
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const res = await httpGet(`http://localhost:${port}/api/tasks/nonexistent`)
      expect(res.status).toBe(404)
      const json = JSON.parse(res.body)
      expect(json.ok).toBe(false)
    })

    it('POST /api/tasks should create a task', async () => {
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

    it('supports default-board checklist REST routes and rejects generic task updates for raw tasks', async () => {
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const createRes = await httpRequest('POST', `http://localhost:${port}/api/tasks`, {
        content: '# REST Checklist Task',
        status: 'todo',
        tasks: ['- [ ] Draft release notes'],
      })
      expect(createRes.status).toBe(201)
      const created = JSON.parse(createRes.body)
      const cardId = created.data.id as string
      expect(created.data.tasks).toEqual([
        expect.objectContaining({
          title: 'Draft release notes',
          description: '',
          checked: false,
          createdAt: expect.any(String),
          modifiedAt: expect.any(String),
          createdBy: expect.any(String),
          modifiedBy: expect.any(String),
        }),
      ])

      const listRes = await httpGet(`http://localhost:${port}/api/tasks/${cardId}/checklist`)
      expect(listRes.status).toBe(200)
      const listed = JSON.parse(listRes.body).data
      expect(listed).toMatchObject({
        cardId,
        boardId: 'default',
        summary: {
          total: 1,
          completed: 0,
          incomplete: 1,
        },
        items: [
          {
            index: 0,
            checked: false,
            title: 'Draft release notes',
            description: '',
            createdAt: expect.any(String),
            modifiedAt: expect.any(String),
            createdBy: expect.any(String),
            modifiedBy: expect.any(String),
          },
        ],
      })
      expect(listed.token).toMatch(/^cl1:/)

      const missingTokenAddRes = await httpRequest('POST', `http://localhost:${port}/api/tasks/${cardId}/checklist`, {
        title: 'Review **docs**',
      })
      expect(missingTokenAddRes.status).toBe(400)
      expect(JSON.parse(missingTokenAddRes.body).error).toContain('expectedToken')

      const addRes = await httpRequest('POST', `http://localhost:${port}/api/tasks/${cardId}/checklist`, {
        title: 'Review **docs**',
        expectedToken: listed.token,
      })
      expect(addRes.status).toBe(200)
      const added = JSON.parse(addRes.body).data
      expect(added.summary).toEqual({ total: 2, completed: 0, incomplete: 2 })

      const staleAddRes = await httpRequest('POST', `http://localhost:${port}/api/tasks/${cardId}/checklist`, {
        title: 'Lost update',
        expectedToken: listed.token,
      })
      expect(staleAddRes.status).toBe(400)
      expect(JSON.parse(staleAddRes.body).error).toContain('stale')

      const editRes = await httpRequest('PUT', `http://localhost:${port}/api/tasks/${cardId}/checklist/0`, {
        title: 'Update release notes',
        modifiedAt: listed.items[0].modifiedAt,
      })
      expect(editRes.status).toBe(200)
      const edited = JSON.parse(editRes.body).data
      expect(edited.items[0]).toEqual({
        index: 0,
        checked: false,
        title: 'Update release notes',
        description: '',
        createdAt: expect.any(String),
        modifiedAt: expect.any(String),
        createdBy: expect.any(String),
        modifiedBy: expect.any(String),
      })

      const checkRes = await httpRequest('POST', `http://localhost:${port}/api/tasks/${cardId}/checklist/1/check`, {
        modifiedAt: added.items[1].modifiedAt,
      })
      expect(checkRes.status).toBe(200)
      const checked = JSON.parse(checkRes.body).data
      expect(checked.summary).toEqual({ total: 2, completed: 1, incomplete: 1 })

      const uncheckRes = await httpRequest('POST', `http://localhost:${port}/api/tasks/${cardId}/checklist/1/uncheck`, {
        modifiedAt: checked.items[1].modifiedAt,
      })
      expect(uncheckRes.status).toBe(200)
      const unchecked = JSON.parse(uncheckRes.body).data
      expect(unchecked.items[1]).toEqual({
        index: 1,
        checked: false,
        title: 'Review **docs**',
        description: '',
        createdAt: expect.any(String),
        modifiedAt: expect.any(String),
        createdBy: expect.any(String),
        modifiedBy: expect.any(String),
      })

      const deleteRes = await httpRequest('DELETE', `http://localhost:${port}/api/tasks/${cardId}/checklist/0`, {
        modifiedAt: edited.items[0].modifiedAt,
      })
      expect(deleteRes.status).toBe(200)
      const deleted = JSON.parse(deleteRes.body).data
      expect(deleted).toMatchObject({
        cardId,
        boardId: 'default',
        summary: {
          total: 1,
          completed: 0,
          incomplete: 1,
        },
        items: [
          {
            index: 0,
            checked: false,
            title: 'Review **docs**',
            description: '',
            createdAt: expect.any(String),
            modifiedAt: expect.any(String),
            createdBy: expect.any(String),
            modifiedBy: expect.any(String),
          },
        ],
      })
      expect(deleted.token).toMatch(/^cl1:/)

      const rejectedUpdate = await httpRequest('PUT', `http://localhost:${port}/api/tasks/${cardId}`, {
        tasks: ['- [ ] bypass'],
      })
      expect(rejectedUpdate.status).toBe(400)
      expect(JSON.parse(rejectedUpdate.body).error).toContain('Card tasks can only be changed through checklist operations')
    })

    it('board-scoped checklist routes preserve parity with the default-board checklist API', async () => {
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const boardRes = await httpRequest('POST', `http://localhost:${port}/api/boards`, {
        id: 'qa-checklist',
        name: 'QA Checklist Board',
      })
      expect(boardRes.status).toBe(201)

      const createRes = await httpRequest('POST', `http://localhost:${port}/api/boards/qa-checklist/tasks`, {
        content: '# Board Checklist Task',
        status: 'todo',
        tasks: ['- [ ] Verify build'],
      })
      expect(createRes.status).toBe(201)
      const created = JSON.parse(createRes.body)
      const cardId = created.data.id as string

      const listRes = await httpGet(`http://localhost:${port}/api/boards/qa-checklist/tasks/${cardId}/checklist`)
      expect(listRes.status).toBe(200)
      const listed = JSON.parse(listRes.body).data
      expect(listed.summary).toEqual({ total: 1, completed: 0, incomplete: 1 })
      expect(listed.token).toMatch(/^cl1:/)

      const addRes = await httpRequest('POST', `http://localhost:${port}/api/boards/qa-checklist/tasks/${cardId}/checklist`, {
        title: 'Ship release notes',
        expectedToken: listed.token,
      })
      expect(addRes.status).toBe(200)
      const added = JSON.parse(addRes.body).data
      expect(added.summary).toEqual({ total: 2, completed: 0, incomplete: 2 })

      const checkRes = await httpRequest('POST', `http://localhost:${port}/api/boards/qa-checklist/tasks/${cardId}/checklist/0/check`, {
        modifiedAt: listed.items[0].modifiedAt,
      })
      expect(checkRes.status).toBe(200)
      expect(JSON.parse(checkRes.body).data).toMatchObject({
        cardId,
        boardId: 'qa-checklist',
        summary: {
          total: 2,
          completed: 1,
          incomplete: 1,
        },
        items: [
          {
            index: 0,
            checked: true,
            title: 'Verify build',
            description: '',
            createdAt: expect.any(String),
            modifiedAt: expect.any(String),
            createdBy: expect.any(String),
            modifiedBy: expect.any(String),
          },
          {
            index: 1,
            checked: false,
            title: 'Ship release notes',
            description: '',
            createdAt: expect.any(String),
            modifiedAt: expect.any(String),
            createdBy: expect.any(String),
            modifiedBy: expect.any(String),
          },
        ],
      })
    })

    it('PUT /api/tasks/:id should update a task', async () => {
      writeCardFile(tempDir, 'update-api.md', makeCardContent({
        id: 'update-api',
        status: 'backlog',
        priority: 'low'
      }), 'backlog')

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

    it('POST /api/tasks should create a form-aware task', async () => {

      const res = await httpRequest('POST', `http://localhost:${port}/api/tasks`, {
        content: '# API Form Task\n\nHas a form.',
        status: 'todo',
        priority: 'high',
        forms: [{
          name: 'bug-report',
          schema: {
            title: 'Bug Report',
            type: 'object',
            properties: {
              severity: { type: 'string' }
            },
            required: ['severity']
          }
        }],
        formData: {
          'bug-report': {
            severity: 'medium'
          }
        }
      })

      expect(res.status).toBe(201)
      const json = JSON.parse(res.body)
      expect(json.ok).toBe(true)
      expect(json.data.forms).toEqual([
        {
          name: 'bug-report',
          schema: {
            title: 'Bug Report',
            type: 'object',
            properties: {
              severity: { type: 'string' }
            },
            required: ['severity']
          }
        }
      ])
      expect(json.data.formData).toEqual({ 'bug-report': { severity: 'medium' } })

      const todoDir = path.join(tempDir, 'boards', 'default', 'todo')
      const files = fs.readdirSync(todoDir).filter(f => f.endsWith('.md'))
      expect(files).toHaveLength(1)
      const fileContent = fs.readFileSync(path.join(todoDir, files[0]), 'utf-8')
      expect(fileContent).toContain('forms:')
      expect(fileContent).toContain('formData:')
      expect(fileContent).toContain('bug-report:')
    })

    it('PUT /api/tasks/:id should update form-aware fields', async () => {

      const createRes = await httpRequest('POST', `http://localhost:${port}/api/tasks`, {
        content: '# Update Form Task',
        status: 'backlog',
        priority: 'medium'
      })
      const created = JSON.parse(createRes.body)

      const updateRes = await httpRequest('PUT', `http://localhost:${port}/api/tasks/${created.data.id}`, {
        forms: [{
          name: 'triage',
          schema: {
            title: 'Triage',
            type: 'object',
            properties: {
              owner: { type: 'string' }
            }
          }
        }],
        formData: {
          triage: { owner: 'alice' }
        }
      })

      expect(updateRes.status).toBe(200)
      const updated = JSON.parse(updateRes.body)
      expect(updated.ok).toBe(true)
      expect(updated.data.forms).toEqual([
        {
          name: 'triage',
          schema: {
            title: 'Triage',
            type: 'object',
            properties: {
              owner: { type: 'string' }
            }
          }
        }
      ])
      expect(updated.data.formData).toEqual({ triage: { owner: 'alice' } })
    })

    it('POST /api/tasks/:id/forms/:formId/submit should submit via the SDK and persist form data', async () => {

      const createRes = await httpRequest('POST', `http://localhost:${port}/api/tasks`, {
        content: '# Submit Form Task',
        status: 'backlog',
        priority: 'medium',
        forms: [{
          name: 'bug-report',
          schema: {
            title: 'Bug Report',
            type: 'object',
            properties: {
              severity: { type: 'string' }
            },
            required: ['severity']
          }
        }]
      })
      const created = JSON.parse(createRes.body)
      const cardId = created.data.id

      const submitRes = await httpRequest('POST', `http://localhost:${port}/api/tasks/${cardId}/forms/bug-report/submit`, {
        data: {
          severity: 'critical'
        }
      })

      expect(submitRes.status).toBe(200)
      const submitted = JSON.parse(submitRes.body)
      expect(submitted.ok).toBe(true)
      expect(submitted.data.boardId).toBe('default')
      expect(submitted.data.form.id).toBe('bug-report')
      expect(submitted.data.data).toEqual({ severity: 'critical' })
      expect(submitted.data.card.formData).toEqual({ 'bug-report': { severity: 'critical' } })

      const getRes = await httpGet(`http://localhost:${port}/api/tasks/${cardId}`)
      const fetched = JSON.parse(getRes.body)
      expect(fetched.data.formData).toEqual({ 'bug-report': { severity: 'critical' } })
    })

    it('POST /api/tasks/:id/forms/:formId/submit should reject invalid submissions without overwriting persisted data', async () => {

      const createRes = await httpRequest('POST', `http://localhost:${port}/api/tasks`, {
        content: '# Invalid Submit Task',
        status: 'backlog',
        priority: 'medium',
        forms: [{
          name: 'bug-report',
          schema: {
            title: 'Bug Report',
            type: 'object',
            properties: {
              severity: { type: 'string' }
            },
            required: ['severity']
          }
        }],
        formData: {
          'bug-report': {
            severity: 'medium'
          }
        }
      })
      const created = JSON.parse(createRes.body)
      const cardId = created.data.id

      const submitRes = await httpRequest('POST', `http://localhost:${port}/api/tasks/${cardId}/forms/bug-report/submit`, {
        data: {
          severity: 123
        }
      })

      expect(submitRes.status).toBe(400)
      const submitted = JSON.parse(submitRes.body)
      expect(submitted.ok).toBe(false)
      expect(String(submitted.error)).toContain('Invalid form submission')

      const getRes = await httpGet(`http://localhost:${port}/api/tasks/${cardId}`)
      const fetched = JSON.parse(getRes.body)
      expect(fetched.data.formData).toEqual({ 'bug-report': { severity: 'medium' } })
    })

    it('POST /api/tasks/:id/forms/:formId/submit interpolated config defaults resolve against card context and canonical payload reflects merged values', async () => {
      // Regression: placeholder interpolation in config form defaults must resolve
      // before the submit merge, and the persisted result.data must be the full
      // canonical object (never a partial snapshot).
      // .kanban.json lives at workspace root (parent of the cards dir).
      // Must be a v2 config so migration does not strip the `forms` field.
      const kanbanJson = path.join(path.dirname(tempDir), '.kanban.json')
      fs.writeFileSync(kanbanJson, JSON.stringify({
        version: 2,
        boards: { default: { name: 'Default', columns: [{ id: 'backlog', name: 'Backlog' }], nextCardId: 1, defaultStatus: 'backlog', defaultPriority: 'medium' } },
        defaultBoard: 'default',
        kanbanDirectory: '.kanban',
        forms: {
          'interp-form': {
            schema: {
              type: 'object',
              title: 'Interpolation Test',
              required: ['reporter', 'ref'],
              properties: {
                reporter: { type: 'string' },
                ref: { type: 'string' },
                region: { type: 'string' }
              }
            },
            data: {
              reporter: '${assignee}',
              ref: '${id}',
              region: '${metadata.region}'
            }
          }
        }
      }, null, 2), 'utf-8')

      const createRes = await httpRequest('POST', `http://localhost:${port}/api/tasks`, {
        content: '# Interpolation Regression Card',
        status: 'backlog',
        priority: 'medium',
        assignee: 'bob',
        metadata: { region: 'us-east' },
        forms: [{ name: 'interp-form' }]
      })
      expect(createRes.status).toBe(201)
      const created = JSON.parse(createRes.body)
      const cardId = created.data.id

      // Submit with all required fields; values match what interpolation should
      // have resolved from config defaults (assignee→reporter, id→ref, metadata→region).
      const submitRes = await httpRequest(
        'POST',
        `http://localhost:${port}/api/tasks/${cardId}/forms/interp-form/submit`,
        { data: { reporter: 'bob', ref: cardId, region: 'us-east' } }
      )

      expect(submitRes.status).toBe(200)
      const submitted = JSON.parse(submitRes.body)
      expect(submitted.ok).toBe(true)
      // Canonical payload is the full merged object, not a partial.
      expect(submitted.data.data).toEqual({ reporter: 'bob', ref: cardId, region: 'us-east' })
      // Persisted card formData matches the canonical payload.
      expect(submitted.data.card.formData['interp-form']).toEqual({ reporter: 'bob', ref: cardId, region: 'us-east' })

      // Verify persistence via GET
      const getRes = await httpGet(`http://localhost:${port}/api/tasks/${cardId}`)
      const fetched = JSON.parse(getRes.body)
      expect(fetched.data.formData['interp-form']).toEqual({ reporter: 'bob', ref: cardId, region: 'us-east' })
    })

    it('board-scoped REST routes keep form-aware create, update, and submit behavior in parity', async () => {
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const boardRes = await httpRequest('POST', `http://localhost:${port}/api/boards`, {
        id: 'qa',
        name: 'QA Board'
      })
      expect(boardRes.status).toBe(201)

      const createRes = await httpRequest('POST', `http://localhost:${port}/api/boards/qa/tasks`, {
        content: '# QA Form Task',
        status: 'todo',
        priority: 'high',
        forms: [{
          name: 'qa-check',
          schema: {
            title: 'QA Check',
            type: 'object',
            properties: {
              status: { type: 'string' }
            },
            required: ['status']
          }
        }],
        formData: {
          'qa-check': {
            status: 'draft'
          }
        }
      })

      expect(createRes.status).toBe(201)
      const created = JSON.parse(createRes.body)
      expect(created.data.boardId).toBe('qa')
      expect(created.data.formData).toEqual({ 'qa-check': { status: 'draft' } })

      const updateRes = await httpRequest('PUT', `http://localhost:${port}/api/boards/qa/tasks/${created.data.id}`, {
        formData: {
          'qa-check': {
            status: 'ready'
          }
        }
      })

      expect(updateRes.status).toBe(200)
      const updated = JSON.parse(updateRes.body)
      expect(updated.data.formData).toEqual({ 'qa-check': { status: 'ready' } })

      const submitRes = await httpRequest('POST', `http://localhost:${port}/api/boards/qa/tasks/${created.data.id}/forms/qa-check/submit`, {
        data: {}
      })

      expect(submitRes.status).toBe(200)
      const submitted = JSON.parse(submitRes.body)
      expect(submitted.ok).toBe(true)
      expect(submitted.data.boardId).toBe('qa')
      expect(submitted.data.form.id).toBe('qa-check')
      expect(submitted.data.data).toEqual({ status: 'ready' })
      expect(submitted.data.card.formData).toEqual({ 'qa-check': { status: 'ready' } })
    })

    it('board-scoped task routes expose unread metadata without side effects and explicit read mutations clear unread only via card-state APIs', async () => {
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const boardRes = await httpRequest('POST', `http://localhost:${port}/api/boards`, {
        id: 'qa-state',
        name: 'QA State Board',
      })
      expect(boardRes.status).toBe(201)

      const createRes = await httpRequest('POST', `http://localhost:${port}/api/boards/qa-state/tasks`, {
        content: '# QA State Task',
        status: 'todo',
      })
      expect(createRes.status).toBe(201)
      const created = JSON.parse(createRes.body)
      const cardId = created.data.id as string

      const localSdk = new KanbanSDK(tempDir)
      await localSdk.init()
      await localSdk.addLog(cardId, 'Board-scoped unread activity', undefined, 'qa-state')
      localSdk.close()

      const getBeforeRes = await httpGet(`http://localhost:${port}/api/boards/qa-state/tasks/${cardId}`)
      const getBeforeJson = JSON.parse(getBeforeRes.body)
      expect(getBeforeJson.ok).toBe(true)
      expect(getBeforeJson.data.cardState.unread).toMatchObject({
        actorId: 'default-user',
        boardId: 'qa-state',
        cardId,
        unread: true,
      })

      const listBeforeRes = await httpGet(`http://localhost:${port}/api/boards/qa-state/tasks`)
      const listBeforeJson = JSON.parse(listBeforeRes.body)
      expect(listBeforeJson.data[0].cardState.unread.unread).toBe(true)

      const readRes = await httpRequest('POST', `http://localhost:${port}/api/boards/qa-state/tasks/${cardId}/read`, {})
      expect(readRes.status).toBe(200)
      const readJson = JSON.parse(readRes.body)
      expect(readJson.data.unread).toMatchObject({
        actorId: 'default-user',
        boardId: 'qa-state',
        cardId,
        unread: false,
      })

      const getAfterReadRes = await httpGet(`http://localhost:${port}/api/boards/qa-state/tasks/${cardId}`)
      expect(JSON.parse(getAfterReadRes.body).data.cardState.unread.unread).toBe(false)
    })

    it('websocket submitForm should return matching success and error callbacks', async () => {
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init', 10000)

      const createRes = await httpRequest('POST', `http://localhost:${port}/api/tasks`, {
        content: '# Socket Form Task',
        status: 'backlog',
        priority: 'medium',
        forms: [{
          name: 'bug-report',
          schema: {
            title: 'Bug Report',
            type: 'object',
            properties: {
              severity: { type: 'string' }
            },
            required: ['severity']
          }
        }]
      })
      const created = JSON.parse(createRes.body)
      const cardId = created.data.id

      const okResponse = await sendAndReceive(ws, {
        type: 'submitForm',
        cardId,
        formId: 'bug-report',
        data: { severity: 'high' },
        callbackKey: 'submit-ok'
      }, 'submitFormResult')

      expect(okResponse.callbackKey).toBe('submit-ok')
      expect((okResponse.result as Record<string, unknown>).data).toEqual({ severity: 'high' })
      expect(okResponse.error).toBeUndefined()

      const invalidCreateRes = await httpRequest('POST', `http://localhost:${port}/api/tasks`, {
        content: '# Socket Invalid Form Task',
        status: 'backlog',
        priority: 'medium',
        forms: [{
          name: 'bug-report',
          schema: {
            title: 'Bug Report',
            type: 'object',
            properties: {
              severity: { type: 'string' }
            },
            required: ['severity']
          }
        }]
      })
      const invalidCreated = JSON.parse(invalidCreateRes.body)

      const errorResponse = await sendAndReceive(ws, {
        type: 'submitForm',
        cardId: invalidCreated.data.id,
        formId: 'bug-report',
        data: {},
        callbackKey: 'submit-error'
      }, 'submitFormResult')

      expect(errorResponse.callbackKey).toBe('submit-error')
      expect(errorResponse.result).toBeUndefined()
      expect(String(errorResponse.error)).toContain('Invalid form submission')
    })

    it('websocket checklist mutations refresh the active editor from the authoritative card snapshot', async () => {
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init', 10000)

      const createRes = await httpRequest('POST', `http://localhost:${port}/api/tasks`, {
        content: '# Socket Checklist Task',
        status: 'backlog',
      })
      const created = JSON.parse(createRes.body)
      const cardId = created.data.id as string

      const opened = await sendAndReceiveMatching(
        ws,
        { type: 'openCard', cardId },
        'cardContent',
        (payload) => payload.cardId === cardId,
      )

      const checklistToken = buildChecklistReadModel({
        id: cardId,
        boardId: 'default',
        tasks: (opened.frontmatter as { tasks?: CardTask[] } | undefined)?.tasks,
      }).token

      const refreshed = await sendAndReceiveMatching(
        ws,
        { type: 'addChecklistItem', cardId, title: 'Review websocket flow', expectedToken: checklistToken },
        'cardContent',
        (payload) => payload.cardId === cardId && Array.isArray((payload.frontmatter as { tasks?: unknown[] } | undefined)?.tasks),
      )

      expect((refreshed.frontmatter as { tasks?: CardTask[] }).tasks).toEqual([
        expect.objectContaining({
          title: 'Review websocket flow',
          description: '',
          checked: false,
          createdAt: expect.any(String),
          modifiedAt: expect.any(String),
        }),
      ])
    })

    it('PUT /api/tasks/:id should return 404 for non-existent task', async () => {
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const res = await httpRequest('PUT', `http://localhost:${port}/api/tasks/nonexistent`, {
        priority: 'high'
      })
      expect(res.status).toBe(404)
    })

    it('PATCH /api/tasks/:id/move should move a task', async () => {
      writeCardFile(tempDir, 'move-api.md', makeCardContent({
        id: 'move-api',
        status: 'backlog'
      }), 'backlog')

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
      writeCardFile(tempDir, 'delete-api.md', makeCardContent({
        id: 'delete-api'
      }), 'backlog')

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
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const res = await httpRequest('DELETE', `http://localhost:${port}/api/tasks/nonexistent`)
      expect(res.status).toBe(404)
    })
  })

  // ── REST API: Columns ──

  describe('REST API — Columns', () => {
    it('GET /api/columns should list columns', async () => {
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
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const res = await httpRequest('PUT', `http://localhost:${port}/api/columns/nonexistent`, {
        name: 'Nope'
      })
      expect(res.status).toBe(404)
    })

    it('DELETE /api/columns/:id should remove an empty column', async () => {
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
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const res = await httpGet(`http://localhost:${port}/api/settings`)
      const json = JSON.parse(res.body)
      expect(json.ok).toBe(true)
      expect(json.data.showPriorityBadges).toBe(true)
      expect(json.data.showBuildWithAI).toBe(false)
    })

    it('PUT /api/settings should update settings', async () => {
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const res = await httpRequest('PUT', `http://localhost:${port}/api/settings`, {
        showPriorityBadges: false,
        cardViewMode: 'normal',
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
      expect(json.data.cardViewMode).toBe('normal')

      // Verify via GET
      const getRes = await httpGet(`http://localhost:${port}/api/settings`)
      const getJson = JSON.parse(getRes.body)
      expect(getJson.data.showPriorityBadges).toBe(false)
      expect(getJson.data.cardViewMode).toBe('normal')
    })
  })

  describe('REST API — Plugin Settings', () => {
    it('GET /api/plugin-settings and GET /api/plugin-settings/:capability/:providerId return redacted provider state', async () => {
      writeWorkspaceConfig(path.dirname(tempDir), {
        auth: {
          'auth.identity': {
            provider: 'local',
            options: {
              apiToken: 'inventory-local-token',
              users: [{ username: 'alice', password: 'super-secret-password', role: 'admin' }],
            },
          },
          'auth.policy': { provider: 'local' },
        },
      })

      const listRes = await httpGet(`http://localhost:${port}/api/plugin-settings`)
      expect(listRes.status).toBe(200)
      const listJson = JSON.parse(listRes.body)
      expect(listJson.ok).toBe(true)
      expect(listJson.data.redaction.maskedValue).toBe('••••••')
      expect(listJson.data.capabilities).toEqual(expect.arrayContaining([
        expect.objectContaining({
          capability: 'auth.identity',
          selected: expect.objectContaining({ providerId: 'local' }),
          providers: expect.arrayContaining([
            expect.objectContaining({
              providerId: 'local',
              packageName: 'kl-plugin-auth',
              isSelected: true,
            }),
          ]),
        }),
      ]))
      expect(listRes.body).not.toContain('inventory-local-token')
      expect(listRes.body).not.toContain('super-secret-password')

      const readRes = await httpGet(`http://localhost:${port}/api/plugin-settings/auth.identity/local`)
      expect(readRes.status).toBe(200)
      const readJson = JSON.parse(readRes.body)
      expect(readJson.ok).toBe(true)
      expect(readJson.data).toMatchObject({
        capability: 'auth.identity',
        providerId: 'local',
        selected: {
          capability: 'auth.identity',
          providerId: 'local',
          source: 'legacy',
        },
      })
      expect(readJson.data.options.values).toMatchObject({
        apiToken: '••••••',
        users: [{ username: 'alice', password: '••••••', role: 'admin' }],
      })
      expect(readJson.data.options.redactedPaths).toEqual(expect.arrayContaining(['apiToken', 'users[0].password']))
      expect(readRes.body).not.toContain('inventory-local-token')
      expect(readRes.body).not.toContain('super-secret-password')
    })

    it('GET plugin-settings routes use request-scoped auth and return 403 for underprivileged bearer tokens', async () => {
      const packageName = 'standalone-plugin-settings-rest-auth-scope-test'
      const isolated = createIsolatedStandaloneTestWorkspace()
      const cleanup = installTempPackage(
        packageName,
        createPluginSettingsScopedAuthPluginSource(packageName),
      )

      const resolvedConfigPath = writeWorkspaceConfig(isolated.workspaceRoot, {
        port,
        auth: {
          'auth.identity': { provider: packageName },
          'auth.policy': { provider: packageName },
        },
      })

      const localPort = await getPort()
      const localServer = startServer(isolated.kanbanDir, localPort, isolated.webviewDir, resolvedConfigPath)
      await sleep(200)

      try {
        const listRes = await httpGet(`http://localhost:${localPort}/api/plugin-settings`, {
          Authorization: 'Bearer manager',
        })
        expect(listRes.status).toBe(403)
        expect(JSON.parse(listRes.body)).toMatchObject({
          ok: false,
          error: expect.stringContaining('denied'),
        })

        const readRes = await httpGet(`http://localhost:${localPort}/api/plugin-settings/auth.identity/${packageName}`, {
          Authorization: 'Bearer manager',
        })
        expect(readRes.status).toBe(403)
        expect(JSON.parse(readRes.body)).toMatchObject({
          ok: false,
          error: expect.stringContaining('denied'),
        })
      } finally {
        await new Promise<void>((resolve) => localServer.close(() => resolve()))
        cleanup()
        isolated.cleanup()
      }
    })

    it('PUT select and PUT options persist canonical plugin state with redacted REST readbacks', async () => {
      writeWorkspaceConfig(path.dirname(tempDir), {
        auth: {
          'auth.identity': {
            provider: 'local',
            options: {
              apiToken: 'existing-token',
              users: [{ username: 'alice', password: '$2b$12$old-hash', role: 'admin' }],
            },
          },
          'auth.policy': { provider: 'local' },
        },
        plugins: {
          'card.storage': { provider: 'sqlite', options: { sqlitePath: '.kanban/custom.db' } },
          'attachment.storage': { provider: 'localfs' },
        },
      })

      const selectRes = await httpRequest('PUT', `http://localhost:${port}/api/plugin-settings/card.storage/localfs/select`, undefined, {
        Authorization: 'Bearer existing-token',
      })
      expect(selectRes.status).toBe(200)
      const selectJson = JSON.parse(selectRes.body)
      expect(selectJson.ok).toBe(true)
      expect(selectJson.data.selected).toEqual({
        capability: 'card.storage',
        providerId: 'localfs',
        source: 'config',
      })

      const optionsRes = await httpRequest('PUT', `http://localhost:${port}/api/plugin-settings/auth.identity/local/options`, {
        options: {
          apiToken: '••••••',
          users: [{ username: 'alice', password: '$2b$12$new-hash', role: 'manager' }],
        },
      }, {
        Authorization: 'Bearer existing-token',
      })
      expect(optionsRes.status).toBe(200)
      const optionsJson = JSON.parse(optionsRes.body)
      expect(optionsJson.ok).toBe(true)
      expect(optionsJson.data.selected).toEqual({
        capability: 'auth.identity',
        providerId: 'local',
        source: 'config',
      })
      expect(optionsJson.data.options.values).toMatchObject({
        apiToken: '••••••',
        users: [{ username: 'alice', password: '••••••', role: 'manager' }],
      })
      expect(optionsJson.data.options.redactedPaths).toEqual(expect.arrayContaining(['apiToken', 'users[0].password']))
      expect(optionsRes.body).not.toContain('existing-token')
      expect(optionsRes.body).not.toContain('$2b$12$new-hash')

      const listRes = await httpGet(`http://localhost:${port}/api/plugin-settings`, {
        Authorization: 'Bearer existing-token',
      })
      expect(listRes.status).toBe(200)
      const listJson = JSON.parse(listRes.body)
      expect(listJson.ok).toBe(true)
      expect(listJson.data.capabilities).toEqual(expect.arrayContaining([
        expect.objectContaining({
          capability: 'card.storage',
          selected: expect.objectContaining({ providerId: 'localfs', source: 'config' }),
          providers: expect.arrayContaining([
            expect.objectContaining({ providerId: 'localfs', isSelected: true }),
            expect.objectContaining({ providerId: 'sqlite', isSelected: false }),
          ]),
        }),
      ]))

      const readRes = await httpGet(`http://localhost:${port}/api/plugin-settings/auth.identity/local`, {
        Authorization: 'Bearer existing-token',
      })
      expect(readRes.status).toBe(200)
      const readJson = JSON.parse(readRes.body)
      expect(readJson.ok).toBe(true)
      expect(readJson.data.options.values).toMatchObject({
        apiToken: '••••••',
        users: [{ username: 'alice', password: '••••••', role: 'manager' }],
      })
      expect(readRes.body).not.toContain('existing-token')
      expect(readRes.body).not.toContain('$2b$12$new-hash')

      const persistedConfig = JSON.parse(fs.readFileSync(path.join(path.dirname(tempDir), '.kanban.json'), 'utf-8')) as {
        plugins: Record<string, { provider: string; options?: Record<string, unknown> }>
      }
      expect(persistedConfig.plugins).toMatchObject({
        'card.storage': { provider: 'localfs' },
        'auth.identity': {
          provider: 'local',
          options: {
            apiToken: 'existing-token',
            users: [{ username: 'alice', password: '$2b$12$new-hash', role: 'manager' }],
          },
        },
      })
      expect(persistedConfig.plugins['card.storage']).not.toHaveProperty('enabled')
    })

    it('PUT options for an inactive provider switches the provider and persists options to disk', async () => {
      // Arrange: noop is the active auth.identity provider; local is inactive.
      writeWorkspaceConfig(path.dirname(tempDir), {
        plugins: {
          'auth.identity': { provider: 'noop' },
          'card.storage': { provider: 'localfs' },
        },
      })

      // Act: save roles for the inactive 'local' provider.
      const res = await httpRequest('PUT', `http://localhost:${port}/api/plugin-settings/auth.identity/local/options`, {
        options: { roles: ['user', 'manager', 'admin', 'testrole'] },
      })

      // Assert: request succeeds and returned data reflects the new active provider.
      expect(res.status).toBe(200)
      const json = JSON.parse(res.body)
      expect(json.ok).toBe(true)
      expect(json.data.providerId).toBe('local')
      expect(json.data.selected).toMatchObject({ providerId: 'local', source: 'config' })

      // Assert: .kanban.json now has provider switched to 'local' with roles persisted.
      const persisted = JSON.parse(fs.readFileSync(path.join(path.dirname(tempDir), '.kanban.json'), 'utf-8')) as {
        plugins: Record<string, { provider: string; options?: Record<string, unknown> }>
      }
      expect(persisted.plugins['auth.identity']).toMatchObject({
        provider: 'local',
        options: { roles: expect.arrayContaining(['testrole']) },
      })
    })

    it('PUT /api/plugin-settings/:capability/:providerId/select maps AuthError to HTTP 403', async () => {
      const { AuthError } = await import('../../sdk/types')
      const spy = vi.spyOn(KanbanSDK.prototype, 'selectPluginSettingsProvider').mockRejectedValue(
        new AuthError('auth.policy.denied', 'Action "settings.update" denied', undefined),
      )

      const res = await httpRequest('PUT', `http://localhost:${port}/api/plugin-settings/auth.identity/local/select`)
      expect(res.status).toBe(403)
      spy.mockRestore()
    })

    it('PUT /api/plugin-settings/:capability/:providerId/options maps AuthError to HTTP 403', async () => {
      const { AuthError } = await import('../../sdk/types')
      const spy = vi.spyOn(KanbanSDK.prototype, 'updatePluginSettingsOptions').mockRejectedValue(
        new AuthError('auth.policy.denied', 'Action "settings.update" denied', undefined),
      )

      const res = await httpRequest('PUT', `http://localhost:${port}/api/plugin-settings/auth.identity/local/options`, {
        options: { apiToken: '••••••' },
      })
      expect(res.status).toBe(403)
      spy.mockRestore()
    })

    it('PUT /api/plugin-settings/:capability/:providerId/select surfaces rejected config.storage topology mutations', async () => {
      const spy = vi.spyOn(KanbanSDK.prototype, 'selectPluginSettingsProvider').mockRejectedValue(
        new PluginSettingsOperationError(createPluginSettingsErrorPayload({
          code: 'plugin-settings-runtime-mutation-rejected',
          message: "Cloudflare Worker config.storage topology changed from 'cloudflare' to 'localfs'. Update the Worker bootstrap and redeploy before applying this config change.",
          capability: 'config.storage',
          providerId: 'localfs',
        })),
      )

      const res = await httpRequest('PUT', `http://localhost:${port}/api/plugin-settings/config.storage/localfs/select`)
      expect(res.status).toBe(400)
      expect(JSON.parse(res.body)).toMatchObject({
        ok: false,
        error: "Cloudflare Worker config.storage topology changed from 'cloudflare' to 'localfs'. Update the Worker bootstrap and redeploy before applying this config change.",
        data: {
          code: 'plugin-settings-runtime-mutation-rejected',
          capability: 'config.storage',
          providerId: 'localfs',
        },
      })
      spy.mockRestore()
    })

    it('GET /api/plugin-settings and GET /api/plugin-settings/:capability/:providerId redact config-load errors', async () => {
      fs.writeFileSync(
        path.join(path.dirname(tempDir), '.kanban.json'),
        '{"plugins":{"auth.identity":{"provider":"local","options":{"apiToken":"rest-super-secret-token"}}}',
        'utf-8',
      )

      const listRes = await httpGet(`http://localhost:${port}/api/plugin-settings`)
      expect(listRes.status).toBe(500)
      const listJson = JSON.parse(listRes.body)
      expect(listJson.ok).toBe(false)
      expect(listJson.data).toMatchObject({
        code: 'plugin-settings-config-load-failed',
      })
      expect(listRes.body).not.toContain('rest-super-secret-token')

      const readRes = await httpGet(`http://localhost:${port}/api/plugin-settings/auth.identity/local`)
      expect(readRes.status).toBe(500)
      const readJson = JSON.parse(readRes.body)
      expect(readJson.ok).toBe(false)
      expect(readJson.data).toMatchObject({
        code: 'plugin-settings-config-load-failed',
        capability: 'auth.identity',
        providerId: 'local',
      })
      expect(readRes.body).not.toContain('rest-super-secret-token')
    })

    it.each([
      { label: 'specifier', invalidPackageName: 'kl-plugin-auth@latest' },
      { label: 'flag fragment', invalidPackageName: 'kl-plugin-auth --save-dev' },
      { label: 'path', invalidPackageName: '../kl-plugin-auth' },
      { label: 'url', invalidPackageName: 'https://example.com/kl-plugin-auth.tgz' },
      { label: 'shell fragment', invalidPackageName: 'kl-plugin-auth; rm -rf /' },
    ])('POST /api/plugin-settings/install rejects invalid package names for %s without echoing the input', async ({ invalidPackageName }) => {
      const res = await httpRequest('POST', `http://localhost:${port}/api/plugin-settings/install`, {
        packageName: invalidPackageName,
        scope: 'workspace',
      })

      expect(res.status).toBe(400)
      const json = JSON.parse(res.body)
      expect(json.ok).toBe(false)
      expect(json.error).toContain('exact unscoped kl-* package name')
      expect(json.data).toMatchObject({
        code: 'invalid-plugin-install-package-name',
        redaction: expect.objectContaining({ maskedValue: '••••••' }),
      })
      expect(res.body).not.toContain(invalidPackageName)
    })

    it('POST /api/plugin-settings/install returns sanitized installer diagnostics', async () => {
      const spy = vi.spyOn(KanbanSDK.prototype, 'installPluginSettingsPackage').mockRejectedValue(
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

      const res = await httpRequest('POST', `http://localhost:${port}/api/plugin-settings/install`, {
        packageName: 'kl-plugin-auth',
        scope: 'workspace',
      })

      expect(res.status).toBe(400)
      const json = JSON.parse(res.body)
      expect(json.ok).toBe(false)
      expect(json.error).toContain('install the package manually')
      expect(json.data).toMatchObject({
        code: 'plugin-settings-install-failed',
        details: expect.objectContaining({
          exitCode: 1,
          stderr: expect.stringContaining('[REDACTED]'),
        }),
      })
      const serialized = JSON.stringify(json)
      expect(serialized).not.toContain('npm_super_secret_token')
      expect(serialized).not.toContain('super-secret-password')
      spy.mockRestore()
    })
  })

  // ── REST API: Webhooks ──

  describe('REST API — Webhooks', () => {
    it('GET /api/webhooks should return empty list initially', async () => {
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const res = await httpGet(`http://localhost:${port}/api/webhooks`)
      const json = JSON.parse(res.body)
      expect(json.ok).toBe(true)
      expect(json.data).toEqual([])
    })

    it('POST /api/webhooks should register a webhook', async () => {
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
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const res = await httpRequest('DELETE', `http://localhost:${port}/api/webhooks/wh_nonexistent`)
      expect(res.status).toBe(404)
    })
  })

  // ── REST API: CORS & Error Handling ──

  describe('REST API — CORS & Error Handling', () => {
    it('should include CORS headers on API responses', async () => {
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const res = await httpGet(`http://localhost:${port}/api/tasks`)
      expect(res.headers['access-control-allow-origin']).toBe('*')
    })

    it('should handle OPTIONS preflight for CORS', async () => {
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const res = await httpRequest('OPTIONS', `http://localhost:${port}/api/tasks`)
      expect(res.status).toBe(204)
      expect(res.headers['access-control-allow-origin']).toBe('*')
      expect(res.headers['access-control-allow-methods']).toBeDefined()
    })

    it('should return 404 for unknown API paths', async () => {
      ws = await connectWs(port)
      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const res = await httpGet(`http://localhost:${port}/api/nonexistent`)
      expect(res.status).toBe(404)
      const json = JSON.parse(res.body)
      expect(json.ok).toBe(false)
    })

    it('REST API changes should broadcast to WebSocket clients', async () => {
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
      const cards = response.cards as Array<Record<string, unknown>>
      expect(cards.length).toBe(1)
      expect(cards[0].content).toContain('Broadcast Test')
    })
  })

  // ── Local standalone auth plugin ──

  describe('local standalone auth plugin', () => {
    let localAuthServer: http.Server
    let localAuthPort: number
    let localAuthWorkspaceRoot: string

    function writeLocalAuthConfig(): string {
      const workspaceRoot = path.dirname(tempDir)
      const configPath = path.join(workspaceRoot, '.kanban.json')
      fs.writeFileSync(configPath, JSON.stringify({
        version: 2,
        port,
        auth: {
          'auth.identity': {
            provider: 'local',
            options: {
              users: [{ username: 'alice', password: LOCAL_AUTH_TEST_PASSWORD_HASH }],
            },
          },
          'auth.policy': { provider: 'local' },
        },
      }, null, 2), 'utf-8')
      return workspaceRoot
    }

    beforeAll(async () => {
      localAuthWorkspaceRoot = writeLocalAuthConfig()
      localAuthPort = await getPort()
      localAuthServer = startServer(tempDir, localAuthPort, webviewDir)
      await sleep(200)
    })

    afterAll(async () => {
      await new Promise<void>((resolve) => localAuthServer.close(() => resolve()))
    })

    it('redirects unauthenticated browser requests to the plugin login page', async () => {
      const homeRes = await httpGet(`http://localhost:${localAuthPort}/`)
      expect(homeRes.status).toBe(302)
      expect(homeRes.headers.location).toContain('/auth/login')

      const loginRes = await httpGet(`http://localhost:${localAuthPort}/auth/login`)
      expect(loginRes.status).toBe(200)
      expect(loginRes.body).toContain('Sign in')
    })

    it('requires auth for API requests and accepts bearer or cookie sessions', async () => {
      const unauthorizedRes = await httpGet(`http://localhost:${localAuthPort}/api/health`)
      expect(unauthorizedRes.status).toBe(401)
      expect(JSON.parse(unauthorizedRes.body)).toMatchObject({ error: 'Authentication required' })

      const envPath = path.join(localAuthWorkspaceRoot, '.env')
      const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : ''
      const token = envContent.match(/^KANBAN_LITE_TOKEN=(.+)$/m)?.[1]
        ?? process.env.KANBAN_LITE_TOKEN
        ?? process.env.KANBAN_TOKEN
      expect(token).toMatch(/^kl-/)

      const bearerRes = await httpGet(`http://localhost:${localAuthPort}/api/health`, {
        Authorization: `Bearer ${token}`,
      })
      expect(bearerRes.status).toBe(200)

      const loginRes = await httpRequest(
        'POST',
        `http://localhost:${localAuthPort}/auth/login`,
        'username=alice&password=secret123&returnTo=%2F',
        { 'Content-Type': 'application/x-www-form-urlencoded' },
      )
      expect(loginRes.status).toBe(302)
      const setCookieHeader = Array.isArray(loginRes.headers['set-cookie'])
        ? loginRes.headers['set-cookie'][0]
        : loginRes.headers['set-cookie']
      expect(typeof setCookieHeader).toBe('string')
      const cookieHeader = String(setCookieHeader).split(';')[0]

      const cookieRes = await httpGet(`http://localhost:${localAuthPort}/api/health`, {
        Cookie: cookieHeader,
      })
      expect(cookieRes.status).toBe(200)
    })

    it('threads cookie-session auth into REST task card-state read models', async () => {
      const loginRes = await httpRequest(
        'POST',
        `http://localhost:${localAuthPort}/auth/login`,
        'username=alice&password=secret123&returnTo=%2F',
        { 'Content-Type': 'application/x-www-form-urlencoded' },
      )
      expect(loginRes.status).toBe(302)
      const setCookieHeader = Array.isArray(loginRes.headers['set-cookie'])
        ? loginRes.headers['set-cookie'][0]
        : loginRes.headers['set-cookie']
      expect(typeof setCookieHeader).toBe('string')
      const cookieHeader = String(setCookieHeader).split(';')[0]

      const createRes = await httpRequest('POST', `http://localhost:${localAuthPort}/api/tasks`, {
        content: '# Cookie REST Card State',
        status: 'todo',
      }, {
        Cookie: cookieHeader,
      })
      expect(createRes.status).toBe(201)
      const cardId = JSON.parse(createRes.body).data.id as string

      const logRes = await httpRequest('POST', `http://localhost:${localAuthPort}/api/tasks/${cardId}/logs`, {
        text: 'Unread activity from cookie session',
      }, {
        Cookie: cookieHeader,
      })
      expect(logRes.status).toBe(201)

      const listRes = await httpGet(`http://localhost:${localAuthPort}/api/tasks`, {
        Cookie: cookieHeader,
      })
      expect(listRes.status).toBe(200)
      const listJson = JSON.parse(listRes.body)
      const listedCard = listJson.data.find((card: Record<string, unknown>) => card.id === cardId)
      expect(listedCard.cardState.unread).toMatchObject({
        actorId: 'alice',
        cardId,
        unread: true,
      })

      const detailRes = await httpGet(`http://localhost:${localAuthPort}/api/tasks/${cardId}`, {
        Cookie: cookieHeader,
      })
      expect(detailRes.status).toBe(200)
      const detailJson = JSON.parse(detailRes.body)
      expect(detailJson.data.cardState.unread).toMatchObject({
        actorId: 'alice',
        cardId,
        unread: true,
      })
      expect(detailJson.data.cardState.open).toBeNull()
    })

    it('threads cookie-session auth into websocket init broadcasts and explicit open clearing', async () => {
      const loginRes = await httpRequest(
        'POST',
        `http://localhost:${localAuthPort}/auth/login`,
        'username=alice&password=secret123&returnTo=%2F',
        { 'Content-Type': 'application/x-www-form-urlencoded' },
      )
      expect(loginRes.status).toBe(302)
      const setCookieHeader = Array.isArray(loginRes.headers['set-cookie'])
        ? loginRes.headers['set-cookie'][0]
        : loginRes.headers['set-cookie']
      expect(typeof setCookieHeader).toBe('string')
      const cookieHeader = String(setCookieHeader).split(';')[0]

      const createRes = await httpRequest('POST', `http://localhost:${localAuthPort}/api/tasks`, {
        content: '# Cookie WebSocket Card State',
        status: 'todo',
      }, {
        Cookie: cookieHeader,
      })
      expect(createRes.status).toBe(201)
      const cardId = JSON.parse(createRes.body).data.id as string

      const localWs = await connectWs(localAuthPort, { Cookie: cookieHeader })

      try {
        await sendAndReceive(localWs, { type: 'ready' }, 'init')
        const initialStates = await sendAndReceive(localWs, { type: 'getCardStates', cardIds: [cardId] }, 'cardStates')
        expect((initialStates.states as Record<string, CardStateReadPayload>)[cardId]?.unread).toMatchObject({
          actorId: 'alice',
          cardId,
          unread: false,
        })

        const updatePromise = waitForMessage(localWs, 'init', 5000)
        const logRes = await httpRequest('POST', `http://localhost:${localAuthPort}/api/tasks/${cardId}/logs`, {
          text: 'Unread activity over websocket session',
        }, {
          Cookie: cookieHeader,
        })
        expect(logRes.status).toBe(201)

        const updatedInit = await updatePromise
        const updatedCard = (updatedInit.cards as StandaloneInitCardPayload[]).find((card) => card.id === cardId)
        // Board-level broadcasts defer per-card activity log reads; unread
        // only flips to true on explicit open/detail fetches.
        expect(updatedCard?.cardState?.unread).toMatchObject({
          actorId: 'alice',
          cardId,
          unread: false,
        })

        const openResponse = await sendAndReceive(localWs, { type: 'openCard', cardId }, 'cardContent')
        expect(openResponse.cardId).toBe(cardId)

        const detailRes = await httpGet(`http://localhost:${localAuthPort}/api/tasks/${cardId}`, {
          Cookie: cookieHeader,
        })
        expect(detailRes.status).toBe(200)
        const detailJson = JSON.parse(detailRes.body)
        expect(detailJson.data.cardState.unread).toMatchObject({
          actorId: 'alice',
          cardId,
          unread: false,
        })
        expect(detailJson.data.cardState.open).toMatchObject({
          actorId: 'alice',
          cardId,
          domain: 'open',
        })
      } finally {
        localWs.close()
        await sleep(50)
      }
    })
  })

  describe('REST API — Available Events', () => {
    it('GET /api/events returns built-in events and supports phase/mask filters', async () => {
      const listRes = await httpGet(`http://localhost:${port}/api/events`)
      expect(listRes.status).toBe(200)
      const listJson = JSON.parse(listRes.body)
      expect(listJson.ok).toBe(true)
      expect(listJson.data).toEqual(expect.arrayContaining([
        expect.objectContaining({ event: 'card.create', phase: 'before', source: 'core' }),
        expect.objectContaining({ event: 'task.created', phase: 'after', source: 'core' }),
      ]))

      const filteredRes = await httpGet(`http://localhost:${port}/api/events?type=after&mask=task.*`)
      expect(filteredRes.status).toBe(200)
      const filteredJson = JSON.parse(filteredRes.body)
      expect(filteredJson.ok).toBe(true)
      expect(filteredJson.data.map((event: { event: string }) => event.event)).toEqual([
        'task.created',
        'task.deleted',
        'task.moved',
        'task.updated',
      ])

      const invalidTypeRes = await httpGet(`http://localhost:${port}/api/events?type=nope`)
      expect(invalidTypeRes.status).toBe(400)
      expect(JSON.parse(invalidTypeRes.body)).toEqual({ ok: false, error: 'type must be one of: before, after, all' })
    })
  })

  // ── Admin/Config Auth Denial Mapping ──

  describe('admin route auth denial semantics', () => {
    it('POST /api/boards maps AuthError to HTTP 403', async () => {
      const { AuthError } = await import('../../sdk/types')
      const createSpy = vi.spyOn(KanbanSDK.prototype, 'createBoard').mockRejectedValue(
        new AuthError('auth.policy.denied', 'Action "board.create" denied', undefined)
      )


      const res = await httpRequest('POST', `http://localhost:${port}/api/boards`, { id: 'x', name: 'X' })
      expect(res.status).toBe(403)
      createSpy.mockRestore()
    })

    it('PUT /api/settings maps AuthError to HTTP 403', async () => {
      const { AuthError } = await import('../../sdk/types')
      const spy = vi.spyOn(KanbanSDK.prototype, 'updateSettings').mockRejectedValue(
        new AuthError('auth.policy.denied', 'Action "settings.update" denied', undefined)
      )


      const res = await httpRequest('PUT', `http://localhost:${port}/api/settings`, { defaultStatus: 'backlog' })
      expect(res.status).toBe(403)
      spy.mockRestore()
    })

    it('POST /api/webhooks maps AuthError to HTTP 403', async () => {
      const { AuthError } = await import('../../sdk/types')
      const spy = vi.spyOn(KanbanSDK.prototype, 'createWebhook').mockRejectedValue(
        new AuthError('auth.policy.denied', 'Action "webhook.create" denied', undefined)
      )


      const res = await httpRequest('POST', `http://localhost:${port}/api/webhooks`, { url: 'https://example.com', events: ['*'] })
      expect(res.status).toBe(403)
      spy.mockRestore()
    })

    it('POST /api/storage/migrate-to-sqlite maps AuthError to HTTP 403', async () => {
      const { AuthError } = await import('../../sdk/types')
      const spy = vi.spyOn(KanbanSDK.prototype, 'migrateToSqlite').mockRejectedValue(
        new AuthError('auth.policy.denied', 'Action "migration.toSqlite" denied', undefined)
      )


      const res = await httpRequest('POST', `http://localhost:${port}/api/storage/migrate-to-sqlite`, {})
      expect(res.status).toBe(403)
      spy.mockRestore()
    })
  })

  describe('websocket admin auth context threading', () => {
    it('forwards bearer auth to addColumn via websocket', async () => {
      const runWithAuthSpy = vi.spyOn(KanbanSDK.prototype, 'runWithAuth')
      const addColumnSpy = vi.spyOn(KanbanSDK.prototype, 'addColumn').mockResolvedValue([
        { id: 'new-col', name: 'New', color: '#000000' }
      ])

      ws = await connectWs(port, { Authorization: 'Bearer admin-token' })

      await sendAndReceive(ws, { type: 'ready' }, 'init')
      await sendAndReceive(ws, {
        type: 'addColumn',
        column: { name: 'New', color: '#000000' }
      }, 'init')

      expect(runWithAuthSpy).toHaveBeenCalledWith(
        expect.objectContaining({ token: 'admin-token', tokenSource: 'request-header', transport: 'http' }),
        expect.any(Function)
      )
      expect(addColumnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'New', color: '#000000' }),
        undefined,
      )
      runWithAuthSpy.mockRestore()
      addColumnSpy.mockRestore()
    })

    it('forwards bearer auth to saveSettings via websocket', async () => {
      const runWithAuthSpy = vi.spyOn(KanbanSDK.prototype, 'runWithAuth')
      const settingsSpy = vi.spyOn(KanbanSDK.prototype, 'updateSettings').mockResolvedValue(undefined)

      ws = await connectWs(port, { Authorization: 'Bearer settings-token' })

      await sendAndReceive(ws, { type: 'ready' }, 'init')
      ws.send(JSON.stringify({ type: 'saveSettings', settings: { defaultStatus: 'backlog' } }))
      await sleep(100)

      expect(runWithAuthSpy).toHaveBeenCalledWith(
        expect.objectContaining({ token: 'settings-token', tokenSource: 'request-header', transport: 'http' }),
        expect.any(Function)
      )
      expect(settingsSpy).toHaveBeenCalledWith(
        expect.anything(),
      )
      runWithAuthSpy.mockRestore()
      settingsSpy.mockRestore()
    })
  })

  // ── WebSocket Auth Denial Stability ──

  describe('websocket auth denial stability', () => {
    it('sends authDenied frame when saveSettings is denied and keeps connection open', async () => {
      const { AuthError } = await import('../../sdk/types')
      const spy = vi.spyOn(KanbanSDK.prototype, 'updateSettings').mockRejectedValue(
        new AuthError('auth.policy.denied', 'Action "settings.update" denied', undefined)
      )

      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const denial = await sendAndReceive(ws, { type: 'saveSettings', settings: { defaultStatus: 'backlog' } }, 'authDenied')

      expect(denial.type).toBe('authDenied')
      expect(denial.category).toBe('auth.policy.denied')
      expect(typeof denial.message).toBe('string')

      // Connection must remain usable after the denial
      expect(ws.readyState).toBe(WebSocket.OPEN)

      // A subsequent non-denied message should still work
      spy.mockRestore()
      const initMsg = await sendAndReceive(ws, { type: 'ready' }, 'init')
      expect(initMsg.type).toBe('init')
      expect(ws.readyState).toBe(WebSocket.OPEN)
    })

    it('sends authDenied frame when addColumn is denied and keeps connection open', async () => {
      const { AuthError } = await import('../../sdk/types')
      const spy = vi.spyOn(KanbanSDK.prototype, 'addColumn').mockRejectedValue(
        new AuthError('auth.policy.denied', 'Action "column.create" denied', undefined)
      )

      ws = await connectWs(port)

      await sendAndReceive(ws, { type: 'ready' }, 'init')

      const denial = await sendAndReceive(ws, { type: 'addColumn', column: { name: 'X', color: '#000' } }, 'authDenied')

      expect(denial.type).toBe('authDenied')
      expect(denial.category).toBe('auth.policy.denied')
      expect(ws.readyState).toBe(WebSocket.OPEN)

      spy.mockRestore()
    })
  })
})
