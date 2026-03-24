import { WebSocket } from 'ws'
import type { Card, LogEntry } from '../shared/types'
import { readConfig } from '../shared/config'
import type { StandaloneContext } from './context'
import { buildCardFrontmatter } from './cardHelpers'

export async function loadCards(ctx: StandaloneContext): Promise<void> {
  ctx.cards = await ctx.sdk.listCards(
    ctx.sdk.listColumns(ctx.currentBoardId).map(c => c.id),
    ctx.currentBoardId
  )
}

export function broadcast(ctx: StandaloneContext, message: unknown): void {
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

export function clearClientEditingCard(ctx: StandaloneContext, ws: WebSocket): void {
  ctx.clientEditingCardIds.delete(ws)
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

function buildCardContentMessage(card: Card, logs: LogEntry[]): unknown {
  return {
    type: 'cardContent',
    cardId: card.id,
    content: card.content,
    frontmatter: buildCardFrontmatter(card),
    comments: card.comments || [],
    logs,
  }
}

export function buildInitMessage(ctx: StandaloneContext): unknown {
  const config = readConfig(ctx.workspaceRoot)
  const settings = ctx.sdk.getSettings()
  settings.showBuildWithAI = false
  settings.markdownEditorMode = false
  return {
    type: 'init',
    cards: ctx.cards,
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

export async function sendCardContent(ctx: StandaloneContext, ws: WebSocket, card: Card): Promise<void> {
  let logs: LogEntry[] = []
  try { logs = await ctx.sdk.listLogs(card.id, ctx.currentBoardId) } catch { /* ignore */ }
  ws.send(JSON.stringify(buildCardContentMessage(card, logs)))
}

export async function broadcastCardContentToEditingClients(ctx: StandaloneContext, card: Card): Promise<void> {
  const clients = getClientsEditingCard(ctx, card.id)
  if (clients.length === 0) return

  let logs: LogEntry[] = []
  try { logs = await ctx.sdk.listLogs(card.id, ctx.currentBoardId) } catch { /* ignore */ }
  const json = JSON.stringify(buildCardContentMessage(card, logs))
  for (const client of clients) {
    client.send(json)
  }
}

export async function broadcastLogsUpdatedToEditingClients(ctx: StandaloneContext, cardId: string, logs?: LogEntry[]): Promise<void> {
  const clients = getClientsEditingCard(ctx, cardId)
  if (clients.length === 0) return

  let resolvedLogs = logs
  if (!resolvedLogs) {
    try {
      resolvedLogs = await ctx.sdk.listLogs(cardId, ctx.currentBoardId)
    } catch {
      resolvedLogs = []
    }
  }

  const json = JSON.stringify({ type: 'logsUpdated', cardId, logs: resolvedLogs })
  for (const client of clients) {
    client.send(json)
  }
}
