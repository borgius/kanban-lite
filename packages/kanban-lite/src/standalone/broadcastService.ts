import type { WebSocket } from 'ws'
import type { Card, LogEntry } from '../shared/types'
import { readConfig, withConfigReadCache } from '../shared/config'
import { resolveCurrentUserName } from '../sdk/resolveCurrentUserName'
import type { AuthContext } from '../sdk/types'
import type { StorageEngine } from '../sdk/plugins/types'
import { decorateCardsForWebview } from '../extension/cardStateUi'
import type { StandaloneContext } from './context'
import { buildCardFrontmatter } from './cardHelpers'

// Use a numeric constant instead of WebSocket.OPEN.  The `ws` package
// import is unavailable in Cloudflare Worker fetch handlers, making
// the static property access throw.  The value 1 is mandated by the
// WebSocket spec and is identical across all runtimes.
const WS_OPEN = 1

// --- Request-scoped scanCards cache ---

/** Stores the real StorageEngine before proxy wrapping. */
const realStorageByCtx = new WeakMap<StandaloneContext, StorageEngine>()

/**
 * Installs a request-scoped cache around `ctx.sdk._storage.scanCards` so
 * that repeated full-board scans within the same HTTP request (e.g. the
 * `ready` handler's `loadCards` + `sendInitMessage` path) hit memory
 * instead of D1 twice.
 *
 * Call `clearScanCardsCache` in a `finally` block to restore the original
 * storage engine and free the cached data.
 */
export function enableScanCardsCache(ctx: StandaloneContext): void {
  if (ctx._scanCardsCache) return
  const real = ctx.sdk._storage
  // Tests (and some runtime hosts) may supply a stripped-down SDK without a
  // storage engine. Skip the proxy wrap in that case — callers that don't
  // use `scanCards` don't benefit from caching anyway.
  if (!real) return
  const cache = new Map<string, Card[]>()
  ctx._scanCardsCache = cache
  realStorageByCtx.set(ctx, real)

  ctx.sdk._storage = new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === 'scanCards') {
        return async (boardDir: string, boardId: string): Promise<Card[]> => {
          const key = `${boardDir}\0${boardId}`
          const cached = cache.get(key)
          if (cached) return cached
          const result = await target.scanCards(boardDir, boardId)
          cache.set(key, result)
          return result
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  }) as StorageEngine
}

export function clearScanCardsCache(ctx: StandaloneContext): void {
  const real = realStorageByCtx.get(ctx)
  if (real) {
    ctx.sdk._storage = real
    realStorageByCtx.delete(ctx)
  }
  ctx._scanCardsCache = undefined
}

export async function loadCards(ctx: StandaloneContext): Promise<void> {
  const columnIds = ctx.sdk.listColumns(ctx.currentBoardId).map(c => c.id)
  const boardDir = ctx.sdk._boardDir(ctx.currentBoardId)
  const boardId = ctx.sdk._resolveBoardId(ctx.currentBoardId)

  await ctx.sdk._ensureMigrated()
  await ctx.sdk._storage.ensureBoardDirs(boardDir, columnIds)
  ctx.cards = await ctx.sdk._storage.scanCards(boardDir, boardId)
}

export function broadcast(ctx: StandaloneContext, message: unknown): void {
  const type = (message as { type?: unknown } | null)?.type
  if (type === 'init' || type === 'cardsUpdated') {
    void broadcastPerClient(ctx, type).catch((err) => {
      console.error(`Failed to broadcast ${type}:`, err)
    })
    return
  }

  const json = JSON.stringify(message)
  for (const client of ctx.wss.clients) {
    if (client.readyState === WS_OPEN) {
      client.send(json)
    }
  }
}

export function setClientEditingCard(ctx: StandaloneContext, ws: WebSocket, cardId: string | null): void {
  ctx.clientEditingCardIds.set(ws, cardId)
}

export function setClientAuthContext(ctx: StandaloneContext, ws: WebSocket, authContext: AuthContext): void {
  ctx.clientAuthContexts.set(ws, authContext)
}

export function clearClientEditingCard(ctx: StandaloneContext, ws: WebSocket): void {
  ctx.clientEditingCardIds.delete(ws)
}

export function clearClientAuthContext(ctx: StandaloneContext, ws: WebSocket): void {
  ctx.clientAuthContexts.delete(ws)
}

export function isClientEditingCard(ctx: StandaloneContext, ws: WebSocket, cardId: string): boolean {
  return ctx.clientEditingCardIds.get(ws) === cardId
}

export function getClientsEditingCard(ctx: StandaloneContext, cardId: string): WebSocket[] {
  const matches: WebSocket[] = []
  for (const [client, editingCardId] of ctx.clientEditingCardIds.entries()) {
    if (client.readyState === WS_OPEN && editingCardId === cardId) {
      matches.push(client)
    }
  }
  return matches
}

function buildCardContentMessage(card: Card, logs: LogEntry[], canShowChecklist: boolean, canUpdateMetadata: boolean): unknown {
  const frontmatter = buildCardFrontmatter(card)
  if (canShowChecklist) {
    frontmatter.tasks = card.tasks ?? []
  }

  return {
    type: 'cardContent',
    cardId: card.id,
    content: card.content,
    frontmatter,
    comments: card.comments || [],
    logs,
    canUpdateMetadata,
  }
}

function getBoardColumnIds(ctx: StandaloneContext): string[] {
  return ctx.sdk.listColumns(ctx.currentBoardId).map(c => c.id)
}

function getAuthRunner(ctx: StandaloneContext, authContext?: AuthContext) {
  return authContext
    ? <T,>(fn: () => Promise<T>) => ctx.sdk.runWithAuth(authContext, fn)
    : async <T,>(fn: () => Promise<T>) => fn()
}

async function listVisibleCards(ctx: StandaloneContext, authContext?: AuthContext): Promise<Card[]> {
  return getAuthRunner(ctx, authContext)(() =>
    ctx.sdk.listCards(getBoardColumnIds(ctx), ctx.currentBoardId),
  )
}

async function resolveVisibleCard(
  ctx: StandaloneContext,
  cardId: string,
  authContext?: AuthContext,
  boardId?: string,
): Promise<Card | null> {
  return getAuthRunner(ctx, authContext)(() =>
    ctx.sdk.getCard(cardId, boardId ?? ctx.currentBoardId),
  )
}

async function resolveVisibleCardLogs(
  ctx: StandaloneContext,
  cardId: string,
  authContext?: AuthContext,
  boardId?: string,
): Promise<LogEntry[]> {
  try {
    return await getAuthRunner(ctx, authContext)(() =>
      ctx.sdk.listLogs(cardId, boardId ?? ctx.currentBoardId),
    )
  } catch {
    return []
  }
}

async function buildDecoratedCards(ctx: StandaloneContext, authContext?: AuthContext): Promise<Card[]> {
  const runWithAuth = getAuthRunner(ctx, authContext)
  const cards = await listVisibleCards(ctx, authContext)

  return decorateCardsForWebview(ctx.sdk, runWithAuth, cards, ctx.currentBoardId)
}

function buildBaseInitMessage(ctx: StandaloneContext, currentUser: string = 'User'): Record<string, unknown> {
  const config = readConfig(ctx.workspaceRoot)
  const settings = ctx.sdk.getSettings()
  settings.showBuildWithAI = false
  settings.markdownEditorMode = false
  return {
    type: 'init',
    columns: ctx.sdk.listColumns(ctx.currentBoardId),
    settings,
    boards: ctx.sdk.listBoards(),
    currentBoard: ctx.currentBoardId || config.defaultBoard,
    currentUser,
    workspace: {
      projectPath: ctx.workspaceRoot,
      kanbanDirectory: config.kanbanDirectory,
      port: config.port,
      configVersion: config.version
    },
    labels: ctx.sdk.getLabels(),
    minimizedColumnIds: ctx.sdk.getMinimizedColumns(ctx.currentBoardId)
  }
}

async function buildClientInitMessage(ctx: StandaloneContext, authContext?: AuthContext): Promise<unknown> {
  const currentUser = await resolveCurrentUserName(ctx.sdk, authContext)
  return {
    ...buildBaseInitMessage(ctx, currentUser),
    cards: await buildDecoratedCards(ctx, authContext),
  }
}

export async function buildScopedInitMessage(ctx: StandaloneContext, authContext?: AuthContext): Promise<unknown> {
  return buildClientInitMessage(ctx, authContext)
}

async function buildClientCardsUpdatedMessage(ctx: StandaloneContext, authContext?: AuthContext): Promise<unknown> {
  return {
    type: 'cardsUpdated',
    cards: await buildDecoratedCards(ctx, authContext),
  }
}

async function broadcastPerClient(ctx: StandaloneContext, type: 'init' | 'cardsUpdated'): Promise<void> {
  // `scanCards` is board-scoped (not auth-scoped), so every client in this
  // broadcast sees the same raw card set. Install the request-scoped cache
  // around the whole fanout so large broadcasts hit the storage engine once
  // instead of once per connected client. Only install it when it isn't
  // already active (e.g. the `ready` handler wraps a single-client send).
  const ownsCache = !ctx._scanCardsCache
  if (ownsCache) enableScanCardsCache(ctx)
  try {
    for (const client of ctx.wss.clients) {
      if (client.readyState !== WS_OPEN) continue
      const authContext = ctx.clientAuthContexts.get(client)
      // Coalesce repeated `readConfig()` calls inside the per-client build
      // (getSettings, listColumns, listBoards, getLabels, …) into a single
      // provider round-trip per client.
      const payload = await withConfigReadCache(() => type === 'init'
        ? buildClientInitMessage(ctx, authContext)
        : buildClientCardsUpdatedMessage(ctx, authContext))
      client.send(JSON.stringify(payload))
    }
  } finally {
    if (ownsCache) clearScanCardsCache(ctx)
  }
}

export function buildInitMessage(ctx: StandaloneContext): unknown {
  return {
    ...buildBaseInitMessage(ctx),
    cards: ctx.cards,
  }
}

export async function sendInitMessage(ctx: StandaloneContext, ws: WebSocket): Promise<void> {
  const authContext = ctx.clientAuthContexts.get(ws)
  const payload = await withConfigReadCache(() => buildClientInitMessage(ctx, authContext))
  ws.send(JSON.stringify(payload))
}

export async function sendCardStates(
  ctx: StandaloneContext,
  ws: WebSocket,
  cardIds: string[],
  authContext?: AuthContext,
  preloadedCards?: Card[],
): Promise<void> {
  let targetCards: Card[]
  if (preloadedCards) {
    targetCards = preloadedCards
  } else {
    const ids = new Set(cardIds)
    targetCards = (await listVisibleCards(ctx, authContext)).filter(c => ids.has(c.id))
  }
  if (targetCards.length === 0) {
    ws.send(JSON.stringify({ type: 'cardStates', states: {} }))
    return
  }
  const runWithAuth = getAuthRunner(ctx, authContext)
  const decorated = await decorateCardsForWebview(ctx.sdk, runWithAuth, targetCards, ctx.currentBoardId)
  const states: Record<string, unknown> = {}
  for (const card of decorated) {
    if (card.cardState !== undefined) states[card.id] = card.cardState
  }
  ws.send(JSON.stringify({ type: 'cardStates', states }))
}

export async function sendCardContent(
  ctx: StandaloneContext,
  ws: WebSocket,
  card: Card | string,
  authContext?: AuthContext,
  options?: { skipResolve?: boolean },
): Promise<boolean> {
  const scopedAuth = authContext ?? ctx.clientAuthContexts.get(ws)
  const cardId = typeof card === 'string' ? card : card.id
  const boardId = typeof card === 'string' ? ctx.currentBoardId : card.boardId ?? ctx.currentBoardId
  // When the caller already verified the card via sdk.getCard (which applies
  // auth-visibility filtering), skip the redundant resolveVisibleCard call
  // that would trigger another full-board scanCards.
  const visibleCard = options?.skipResolve && typeof card !== 'string'
    ? card
    : await resolveVisibleCard(ctx, cardId, scopedAuth, boardId)
  if (!visibleCard) return false

  const logs = await resolveVisibleCardLogs(ctx, visibleCard.id, scopedAuth, visibleCard.boardId)
  const canShowChecklist = await ctx.sdk.canPerformAction('card.checklist.show', scopedAuth)
  const canUpdateMetadata = await ctx.sdk.canPerformAction('card.update', scopedAuth)
  ws.send(JSON.stringify(buildCardContentMessage(visibleCard, logs, canShowChecklist, canUpdateMetadata)))
  return true
}

export async function broadcastCardContentToEditingClients(ctx: StandaloneContext, card: Card | string): Promise<void> {
  const cardId = typeof card === 'string' ? card : card.id
  const clients = getClientsEditingCard(ctx, cardId)
  if (clients.length === 0) return

  for (const client of clients) {
    await sendCardContent(ctx, client, card, ctx.clientAuthContexts.get(client))
  }
}

export async function sendLogsUpdated(
  ctx: StandaloneContext,
  ws: WebSocket,
  cardId: string,
  authContext?: AuthContext,
  logs?: LogEntry[],
): Promise<boolean> {
  const scopedAuth = authContext ?? ctx.clientAuthContexts.get(ws)
  const visibleCard = await resolveVisibleCard(ctx, cardId, scopedAuth)
  if (!visibleCard) return false

  const resolvedLogs = logs ?? await resolveVisibleCardLogs(ctx, cardId, scopedAuth, visibleCard.boardId)
  ws.send(JSON.stringify({ type: 'logsUpdated', cardId: visibleCard.id, logs: resolvedLogs }))
  return true
}

export async function broadcastLogsUpdatedToEditingClients(ctx: StandaloneContext, cardId: string, logs?: LogEntry[]): Promise<void> {
  const clients = getClientsEditingCard(ctx, cardId)
  if (clients.length === 0) return

  for (const client of clients) {
    await sendLogsUpdated(ctx, client, cardId, ctx.clientAuthContexts.get(client), logs)
  }
}

function broadcastScopedCardEventToEditingClients(ctx: StandaloneContext, cardId: string, message: unknown): void {
  const clients = getClientsEditingCard(ctx, cardId)
  if (clients.length === 0) return

  void (async () => {
    const json = JSON.stringify(message)
    for (const client of clients) {
      const visibleCard = await resolveVisibleCard(ctx, cardId, ctx.clientAuthContexts.get(client))
      if (!visibleCard) continue
      client.send(json)
    }
  })().catch((err) => {
    console.error(`Failed to broadcast scoped card event for ${cardId}:`, err)
  })
}

/**
 * Broadcasts a `commentStreamStart` event to ALL connected WebSocket clients.
 * Called once when a streaming comment session begins, before any chunks arrive.
 */
export function broadcastCommentStreamStart(
  ctx: StandaloneContext,
  cardId: string,
  commentId: string,
  author: string,
  created: string
): void {
  broadcastScopedCardEventToEditingClients(ctx, cardId, { type: 'commentStreamStart', cardId, commentId, author, created })
}

/**
 * Broadcasts a `commentChunk` event to ALL connected WebSocket clients.
 * Called for every text chunk received during a streaming comment session.
 */
export function broadcastCommentChunk(
  ctx: StandaloneContext,
  cardId: string,
  commentId: string,
  chunk: string
): void {
  broadcastScopedCardEventToEditingClients(ctx, cardId, { type: 'commentChunk', cardId, commentId, chunk })
}

/**
 * Broadcasts a `commentStreamDone` event to ALL connected WebSocket clients.
 * Called once after the stream has been fully consumed and persisted.
 */
export function broadcastCommentStreamDone(
  ctx: StandaloneContext,
  cardId: string,
  commentId: string
): void {
  broadcastScopedCardEventToEditingClients(ctx, cardId, { type: 'commentStreamDone', cardId, commentId })
}

