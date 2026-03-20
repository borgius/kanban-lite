import * as http from 'http'
import * as path from 'path'
import { WebSocketServer } from 'ws'
import { KanbanSDK } from '../../sdk/KanbanSDK'
import type { StandaloneContext } from '../context'
import { broadcast } from '../broadcastService'
import { fireWebhooks } from '../webhooks'

export const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link href="/style.css" rel="stylesheet">
  <title>Kanban Board</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/index.js"></script>
</body>
</html>`

export interface StandaloneRuntime {
  absoluteKanbanDir: string
  workspaceRoot: string
  resolvedWebviewDir: string
  server: http.Server
  wss: WebSocketServer
  sdk: KanbanSDK
  ctx: StandaloneContext
}

export function createStandaloneRuntime(kanbanDir: string, webviewDir?: string): StandaloneRuntime {
  const absoluteKanbanDir = path.resolve(kanbanDir)
  const workspaceRoot = path.dirname(absoluteKanbanDir)
  const resolvedWebviewDir = webviewDir || path.join(__dirname, 'standalone-webview')

  const server = http.createServer()
  const wss = new WebSocketServer({ server, path: '/ws' })

  const ctx = {} as StandaloneContext
  const sdk = new KanbanSDK(absoluteKanbanDir, {
    onEvent: (event, data) => {
      fireWebhooks(workspaceRoot, event, data)
      if (event === 'log.added') {
        const { cardId } = data as { cardId: string }
        if (cardId === ctx.currentEditingCardId) {
          sdk.listLogs(cardId, ctx.currentBoardId).then(logs => {
            broadcast(ctx, { type: 'logsUpdated', cardId, logs })
          }).catch(() => {})
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
