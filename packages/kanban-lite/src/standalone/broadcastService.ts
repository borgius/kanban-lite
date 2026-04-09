import { WebSocket } from 'ws'
import type { Card, LogEntry } from '../shared/types'
import { readConfig } from '../shared/config'
import type { AuthContext } from '../sdk/types'
import { decorateCardsForWebview } from '../extension/cardStateUi'
import type { StandaloneContext } from './context'
import { buildCardFrontmatter } from './cardHelpers'

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
    if (client.readyState === WebSocket.OPEN) {
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
    if (client.readyState === WebSocket.OPEN && editingCardId === cardId) {
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

function buildBaseInitMessage(ctx: StandaloneContext): Record<string, unknown> {
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
  return {
    ...buildBaseInitMessage(ctx),
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
  for (const client of ctx.wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue
    const authContext = ctx.clientAuthContexts.get(client)
    const payload = type === 'init'
      ? await buildClientInitMessage(ctx, authContext)
      : await buildClientCardsUpdatedMessage(ctx, authContext)
    client.send(JSON.stringify(payload))
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
  ws.send(JSON.stringify(await buildClientInitMessage(ctx, authContext)))
}

export async function sendCardStates(
  ctx: StandaloneContext,
  ws: WebSocket,
  cardIds: string[],
  authContext?: AuthContext,
): Promise<void> {
  const ids = new Set(cardIds)
  const targetCards = (await listVisibleCards(ctx, authContext)).filter(c => ids.has(c.id))
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
): Promise<boolean> {
  const scopedAuth = authContext ?? ctx.clientAuthContexts.get(ws)
  const cardId = typeof card === 'string' ? card : card.id
  const boardId = typeof card === 'string' ? ctx.currentBoardId : card.boardId ?? ctx.currentBoardId
  const visibleCard = await resolveVisibleCard(ctx, cardId, scopedAuth, boardId)
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

