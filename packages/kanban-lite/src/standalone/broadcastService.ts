import { WebSocket } from 'ws'
import type { Card } from '../shared/types'
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
  let logs: import('../shared/types').LogEntry[] = []
  try { logs = await ctx.sdk.listLogs(card.id, ctx.currentBoardId) } catch { /* ignore */ }
  ws.send(JSON.stringify({
    type: 'cardContent',
    cardId: card.id,
    content: card.content,
    frontmatter: buildCardFrontmatter(card),
    comments: card.comments || [],
    logs,
  }))
}
