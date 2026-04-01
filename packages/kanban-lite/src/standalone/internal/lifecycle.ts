import * as fs from 'fs'
import * as http from 'http'
import * as os from 'os'
import * as path from 'path'
import chokidar from 'chokidar'
import { parseCardFile, serializeCard } from '../../sdk/parser'
import { broadcast, broadcastCardContentToEditingClients, getClientsEditingCard } from '../broadcastService'
import { extractAuthContext } from '../authUtils'
import type { StandaloneContext } from '../context'
import { cleanupTempFile, setupWatcher } from '../watcherSetup'
import { jsonOk, jsonError } from '../httpUtils'
import type { StandaloneRequestContext } from './common'

export function setupStandaloneLifecycle(ctx: StandaloneContext, server: http.Server): void {
  fs.mkdirSync(ctx.absoluteKanbanDir, { recursive: true })
  setupWatcher(ctx, server)
  server.on('close', () => {
    cleanupTempFile(ctx)
  })
}

export async function handleCardFileRoute(request: StandaloneRequestContext): Promise<boolean> {
  const { ctx, route, url, res, req } = request
  const params = route('GET', '/api/card-file')
  if (!params) return false

  const cardId = url.searchParams.get('cardId')
  if (!cardId) {
    jsonError(res, 400, 'cardId is required')
    return true
  }

  const requestAuth = extractAuthContext(req)
  const openCard = await ctx.sdk.runWithAuth(requestAuth, () => ctx.sdk.getCard(cardId, ctx.currentBoardId))
  if (!openCard) {
    jsonError(res, 404, 'Card not found')
    return true
  }

  if (ctx.tempFileCardId && ctx.tempFileCardId !== cardId) cleanupTempFile(ctx)

  const localCardPath = ctx.sdk.getLocalCardPath(openCard)
  if (localCardPath) {
    jsonOk(res, { path: localCardPath })
    return true
  }

  if (ctx.tempFileCardId === cardId && ctx.tempFilePath) {
    ctx.tempFileAuthContext = requestAuth
    ctx.tempFileWriting = true
    try {
      fs.writeFileSync(ctx.tempFilePath, serializeCard(openCard), 'utf-8')
    } finally {
      ctx.tempFileWriting = false
    }
    jsonOk(res, { path: ctx.tempFilePath })
    return true
  }

  const tmpPath = path.join(os.tmpdir(), `kanban-card-${openCard.id}.md`)
  ctx.tempFileWriting = true
  try {
    fs.writeFileSync(tmpPath, serializeCard(openCard), 'utf-8')
  } finally {
    ctx.tempFileWriting = false
  }

  ctx.tempFilePath = tmpPath
  ctx.tempFileCardId = openCard.id
  ctx.tempFileAuthContext = requestAuth

  let debounce: ReturnType<typeof setTimeout> | undefined
  const watcher = chokidar.watch(tmpPath, { ignoreInitial: true })
  watcher.on('change', () => {
    if (ctx.tempFileWriting) return
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(async () => {
      const currentCardId = ctx.tempFileCardId
      const currentTempPath = ctx.tempFilePath
      const currentAuthContext = ctx.tempFileAuthContext
      if (!currentCardId || !currentTempPath || !currentAuthContext) return

      try {
        const raw = fs.readFileSync(currentTempPath, 'utf-8')
        const parsed = parseCardFile(raw, `${currentCardId}.md`)
        if (!parsed) return

        ctx.migrating = true
        try {
          const updated = await ctx.sdk.runWithAuth(currentAuthContext, () => ctx.sdk.updateCard(currentCardId, {
            content: parsed.content,
            status: parsed.status,
            priority: parsed.priority,
            assignee: parsed.assignee,
            dueDate: parsed.dueDate,
            labels: parsed.labels,
            metadata: parsed.metadata,
          }, ctx.currentBoardId))
          const cardIndex = ctx.cards.findIndex(card => card.id === currentCardId)
          if (cardIndex !== -1) ctx.cards[cardIndex] = updated
          broadcast(ctx, { type: 'cardsUpdated' })
          if (getClientsEditingCard(ctx, currentCardId).length > 0) {
            await broadcastCardContentToEditingClients(ctx, updated)
          }
        } finally {
          ctx.migrating = false
        }
      } catch {
        // ignore temp editor sync errors
      }
    }, 300)
  })

  ctx.tempFileWatcher = watcher
  jsonOk(res, { path: tmpPath })
  return true
}
