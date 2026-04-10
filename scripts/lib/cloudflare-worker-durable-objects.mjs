export const activeCardDurableObjectBinding = 'KANBAN_ACTIVE_CARD_STATE'
export const activeCardDurableObjectClassName = 'KanbanActiveCardState'
export const activeCardDurableObjectMigrationTag = 'kanban-active-card-state-v1'
export const liveSyncTransportMode = 'http-sync-websocket-notify'
export const liveSyncNotifyPath = '/live-sync/notify'

export function renderKanbanWorkerDurableObjectClassSource() {
  return `export class ${activeCardDurableObjectClassName} extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
  }

  async fetch(request) {
    const url = new URL(request.url)
    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket' && url.pathname.endsWith('/ws')) {
      const webSocketPair = new WebSocketPair()
      const [client, server] = Object.values(webSocketPair)
      this.ctx.acceptWebSocket(server)
      server.send(JSON.stringify({ type: 'syncTransportMode', mode: ${JSON.stringify(liveSyncTransportMode)} }))
      return new Response(null, { status: 101, webSocket: client })
    }

    if (request.method === 'POST' && url.pathname.endsWith(${JSON.stringify(liveSyncNotifyPath)})) {
      let payload = null
      try {
        payload = await request.json()
      } catch {
        payload = null
      }

      const message = {
        type: 'syncRequired',
        ...(payload && typeof payload === 'object' && typeof payload.reason === 'string'
          ? { reason: payload.reason }
          : {}),
      }
      const json = JSON.stringify(message)
      for (const socket of this.ctx.getWebSockets()) {
        socket.send(json)
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response('Not found', { status: 404 })
  }

  async getActiveCardState() {
    const state = await this.ctx.storage.get('active-card')
    if (!state || typeof state !== 'object') {
      return null
    }

    if (typeof state.cardId !== 'string' || typeof state.boardId !== 'string') {
      return null
    }

    return {
      cardId: state.cardId,
      boardId: state.boardId,
      updatedAt: typeof state.updatedAt === 'string' ? state.updatedAt : new Date().toISOString(),
    }
  }

  async setActiveCardState(state) {
    await this.ctx.storage.put('active-card', state)
  }

  async clearActiveCardState() {
    await this.ctx.storage.delete('active-card')
  }

  webSocketMessage() {}

  webSocketClose(ws, code, reason) {
    ws.close(code, reason)
  }
}
`
}

export function renderKanbanWorkerDurableObjectConfigBlocks() {
  return `
[[durable_objects.bindings]]
name = ${JSON.stringify(activeCardDurableObjectBinding)}
class_name = ${JSON.stringify(activeCardDurableObjectClassName)}

[[migrations]]
tag = ${JSON.stringify(activeCardDurableObjectMigrationTag)}
new_sqlite_classes = [${JSON.stringify(activeCardDurableObjectClassName)}]
`
}
