import * as http from 'http'
import * as fs from 'fs'
import * as path from 'path'
import { WebSocketServer } from 'ws'
import { KanbanSDK } from '../../sdk/KanbanSDK'
import type { StandaloneContext } from '../context'
import { broadcastLogsUpdatedToEditingClients, getClientsEditingCard } from '../broadcastService'

export function getIndexHtml(basePath = ''): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" type="image/svg+xml" href="${basePath}/favicon.svg">
  <link href="${basePath}/style.css" rel="stylesheet">
  <title>Kanban Board</title>
  <script>window.__KB_BASE__ = ${JSON.stringify(basePath)}<\/script>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="${basePath}/index.js"><\/script>
</body>
</html>`
}

export const indexHtml = getIndexHtml()

export interface StandaloneRuntime {
  absoluteKanbanDir: string
  workspaceRoot: string
  resolvedWebviewDir: string
  server: http.Server
  wss: WebSocketServer
  sdk: KanbanSDK
  ctx: StandaloneContext
}

function resolveStandaloneWebviewDir(webviewDir?: string): string {
  if (webviewDir) return webviewDir

  const candidates = [
    path.join(__dirname, 'standalone-webview'),
    path.join(__dirname, '..', '..', '..', 'dist', 'standalone-webview'),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'index.js'))) return candidate
  }

  return candidates[0]
}

export function createStandaloneRuntime(kanbanDir: string, webviewDir?: string, httpServer?: http.Server, basePath?: string): StandaloneRuntime {
  const absoluteKanbanDir = path.resolve(kanbanDir)
  const workspaceRoot = path.dirname(absoluteKanbanDir)
  const resolvedWebviewDir = resolveStandaloneWebviewDir(webviewDir)

  const server = httpServer ?? http.createServer()
  const wss = new WebSocketServer({ server, path: (basePath || '') + '/ws' })

  const ctx = {} as StandaloneContext
  const sdk = new KanbanSDK(absoluteKanbanDir, {
    onEvent: (event, data) => {
      if (event === 'log.added') {
        const { cardId } = data as { cardId: string }
        if (getClientsEditingCard(ctx, cardId).length > 0) {
          void broadcastLogsUpdatedToEditingClients(ctx, cardId)
        }
      }
    }
  })

  Object.assign(ctx, {
    absoluteKanbanDir,
    workspaceRoot,
    sdk,
    wss,
    cards: [],
    migrating: false,
    suppressWatcherEventsUntil: 0,
    currentEditingCardId: null,
    clientEditingCardIds: new Map(),
    lastWrittenContent: '',
    currentBoardId: undefined,
    tempFilePath: undefined,
    tempFileCardId: undefined,
    tempFileWatcher: undefined,
    tempFileWriting: false,
  })

  return {
    absoluteKanbanDir,
    workspaceRoot,
    resolvedWebviewDir,
    server,
    wss,
    sdk,
    ctx,
  }
}
