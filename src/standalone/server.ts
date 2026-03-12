import * as http from 'http'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { WebSocketServer, WebSocket } from 'ws'
import chokidar from 'chokidar'
import { type Comment, type Card, type Priority, type KanbanColumn, type CardFrontmatter, type CardDisplaySettings, type CardSortOption } from '../shared/types'
import { KanbanSDK } from '../sdk/KanbanSDK'
import { serializeCard, parseCardFile } from '../sdk/parser'
import { readConfig, writeConfig } from '../shared/config'
import { sanitizeCard } from '../sdk/types'
import { fireWebhooks } from './webhooks'
import { matchesMetaFilter } from '../sdk/metaUtils'

interface CreateCardData {
  status: string
  priority: Priority
  content: string
  assignee: string | null
  dueDate: string | null
  labels: string[]
  metadata?: Record<string, any>
  actions?: string[]
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.xml': 'text/xml',
  '.csv': 'text/csv',
  '.map': 'application/json'
}


export function startServer(kanbanDir: string, port: number, webviewDir?: string): http.Server {
  const absoluteKanbanDir = path.resolve(kanbanDir)
  let cards: Card[] = []
  let migrating = false
  let currentEditingCardId: string | null = null
  let lastWrittenContent = ''
  let currentBoardId: string | undefined
  let tempFilePath: string | undefined
  let tempFileCardId: string | undefined
  let tempFileWatcher: ReturnType<typeof chokidar.watch> | undefined
  let tempFileWriting = false

  function cleanupTempFile() {
    if (tempFileWatcher) {
      tempFileWatcher.close()
      tempFileWatcher = undefined
    }
    if (tempFilePath) {
      try { fs.unlinkSync(tempFilePath) } catch { /* ignore */ }
      tempFilePath = undefined
    }
    tempFileCardId = undefined
  }

  // Resolve webview static files directory
  const resolvedWebviewDir = webviewDir || path.join(__dirname, 'standalone-webview')

  // Derive workspace root from cards directory
  const workspaceRoot = path.dirname(absoluteKanbanDir)
  const sdk = new KanbanSDK(absoluteKanbanDir, {
    onEvent: (event, data) => {
      fireWebhooks(workspaceRoot, event, data)
      // Push fresh logs to all clients when a log entry is added for the currently viewed card
      if (event === 'log.added') {
        const { cardId } = data as { cardId: string }
        if (cardId === currentEditingCardId) {
          sdk.listLogs(cardId, currentBoardId).then(logs => {
            broadcast({ type: 'logsUpdated', cardId, logs })
          }).catch(() => {})
        }
      }
    }
  })

  // --- Helpers ---

  const VALID_SORTS: CardSortOption[] = ['created:asc', 'created:desc', 'modified:asc', 'modified:desc']

  function applySortParam<T extends { created: string; modified: string }>(result: T[], sortParam: string | null): T[] {
    if (!sortParam || !VALID_SORTS.includes(sortParam as CardSortOption)) return result
    const [field, dir] = sortParam.split(':')
    return [...result].sort((a, b) => {
      const aVal = field === 'created' ? a.created : a.modified
      const bVal = field === 'created' ? b.created : b.modified
      return dir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
    })
  }

  function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf-8')
          resolve(text ? JSON.parse(text) : {})
        } catch (err) {
          reject(err)
        }
      })
      req.on('error', reject)
    })
  }

  function matchRoute(
    expectedMethod: string,
    actualMethod: string,
    pathname: string,
    pattern: string
  ): Record<string, string> | null {
    if (expectedMethod !== actualMethod) return null
    const patternParts = pattern.split('/')
    const pathParts = pathname.split('/')
    if (patternParts.length !== pathParts.length) return null
    const params: Record<string, string> = {}
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(':')) {
        params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i])
      } else if (patternParts[i] !== pathParts[i]) {
        return null
      }
    }
    return params
  }

  function jsonOk(res: http.ServerResponse, data: unknown, status = 200): void {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    })
    res.end(JSON.stringify({ ok: true, data }))
  }

  function jsonError(res: http.ServerResponse, status: number, error: string): void {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    })
    res.end(JSON.stringify({ ok: false, error }))
  }

  // --- HTML template ---
  const indexHtml = `<!DOCTYPE html>
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

  // --- Card loading ---

  async function loadCards(): Promise<void> {
    cards = await sdk.listCards(sdk.listColumns(currentBoardId).map(c => c.id), currentBoardId)
  }

  // --- Message building & broadcast ---

  function buildInitMessage(): unknown {
    const config = readConfig(workspaceRoot)
    const settings = sdk.getSettings()
    settings.showBuildWithAI = false
    settings.markdownEditorMode = false
    return {
      type: 'init',
      cards,
      columns: sdk.listColumns(currentBoardId),
      settings,
      boards: sdk.listBoards(),
      currentBoard: currentBoardId || config.defaultBoard,
      workspace: {
        projectPath: workspaceRoot,
        kanbanDirectory: config.kanbanDirectory,
        port: config.port,
        configVersion: config.version
      },
      labels: sdk.getLabels()
    }
  }

  function broadcast(message: unknown): void {
    const json = JSON.stringify(message)
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(json)
      }
    }
  }

  // --- Mutation functions ---
  // Shared by both WebSocket handlers and REST API routes.

  async function doCreateCard(data: CreateCardData): Promise<Card> {
    migrating = true
    try {
      const card = await sdk.createCard({
        content: data.content,
        status: data.status,
        priority: data.priority,
        assignee: data.assignee,
        dueDate: data.dueDate,
        labels: data.labels,
        metadata: data.metadata,
        actions: data.actions,
        boardId: currentBoardId,
      })
      await loadCards()
      broadcast(buildInitMessage())
      return card
    } finally {
      migrating = false
    }
  }

  async function doMoveCard(cardId: string, newStatus: string, newOrder: number): Promise<Card | null> {
    const card = cards.find(f => f.id === cardId)
    if (!card) return null

    migrating = true
    try {
      const updated = await sdk.moveCard(cardId, newStatus, newOrder, currentBoardId)
      await loadCards()
      broadcast(buildInitMessage())
      return updated
    } finally {
      migrating = false
    }
  }

  async function doUpdateCard(cardId: string, updates: Partial<Card>): Promise<Card | null> {
    const card = cards.find(f => f.id === cardId)
    if (!card) return null

    migrating = true
    try {
      const updated = await sdk.updateCard(cardId, updates, currentBoardId)
      lastWrittenContent = serializeCard(updated)
      await loadCards()
      broadcast(buildInitMessage())
      return updated
    } finally {
      migrating = false
    }
  }

  async function doDeleteCard(cardId: string): Promise<boolean> {
    const card = cards.find(f => f.id === cardId)
    if (!card) return false

    try {
      await sdk.deleteCard(cardId, currentBoardId)
      await loadCards()
      broadcast(buildInitMessage())
      return true
    } catch (err) {
      console.error('Failed to delete card:', err)
      return false
    }
  }

  async function doPermanentDeleteCard(cardId: string): Promise<boolean> {
    const card = cards.find(f => f.id === cardId)
    if (!card) return false

    try {
      await sdk.permanentlyDeleteCard(cardId, currentBoardId)
      await loadCards()
      broadcast(buildInitMessage())
      return true
    } catch (err) {
      console.error('Failed to permanently delete card:', err)
      return false
    }
  }

  async function doPurgeDeletedCards(): Promise<boolean> {
    try {
      await sdk.purgeDeletedCards(currentBoardId)
      await loadCards()
      broadcast(buildInitMessage())
      return true
    } catch (err) {
      console.error('Failed to purge deleted cards:', err)
      return false
    }
  }

  function doAddColumn(name: string, color: string): KanbanColumn {
    const columns = sdk.addColumn({ id: '', name, color }, currentBoardId)
    const column = columns[columns.length - 1]
    broadcast(buildInitMessage())
    return column
  }

  function doEditColumn(columnId: string, updates: { name: string; color: string }): KanbanColumn | null {
    try {
      const columns = sdk.updateColumn(columnId, { name: updates.name, color: updates.color }, currentBoardId)
      const updated = columns.find(c => c.id === columnId) ?? null
      broadcast(buildInitMessage())
      return updated
    } catch {
      return null
    }
  }

  async function doRemoveColumn(columnId: string): Promise<{ removed: boolean; error?: string }> {
    try {
      const columns = sdk.listColumns(currentBoardId)
      if (columns.length <= 1) return { removed: false, error: 'Cannot remove last column' }
      const col = columns.find(c => c.id === columnId)
      if (!col) return { removed: false, error: 'Column not found' }
      await sdk.removeColumn(columnId, currentBoardId)
      broadcast(buildInitMessage())
      return { removed: true }
    } catch (err) {
      return { removed: false, error: String(err) }
    }
  }

  async function doCleanupColumn(columnId: string): Promise<boolean> {
    try {
      migrating = true
      await sdk.cleanupColumn(columnId, currentBoardId)
      await loadCards()
      broadcast(buildInitMessage())
      return true
    } catch (err) {
      console.error('Failed to cleanup column:', err)
      return false
    } finally {
      migrating = false
    }
  }

  function doSaveSettings(newSettings: CardDisplaySettings): void {
    sdk.updateSettings(newSettings)
    broadcast(buildInitMessage())
  }

  async function doAddAttachment(cardId: string, filename: string, fileData: Buffer): Promise<boolean> {
    const card = cards.find(f => f.id === cardId)
    if (!card) return false

    // Write file data to the card's attachment directory
    const cardDir = sdk.storageEngine.getCardDir(card)
    fs.mkdirSync(cardDir, { recursive: true })
    fs.writeFileSync(path.join(cardDir, filename), fileData)

    // Register attachment via SDK (skips copy since file is already in place)
    migrating = true
    try {
      const updated = await sdk.addAttachment(cardId, path.join(cardDir, filename), currentBoardId)
      lastWrittenContent = serializeCard(updated)
      await loadCards()
    } finally {
      migrating = false
    }
    return true
  }

  async function doRemoveAttachment(cardId: string, attachment: string): Promise<Card | null> {
    const card = cards.find(f => f.id === cardId)
    if (!card) return null

    migrating = true
    try {
      const updated = await sdk.removeAttachment(cardId, attachment, currentBoardId)
      lastWrittenContent = serializeCard(updated)
      await loadCards()
      broadcast(buildInitMessage())
      return updated
    } finally {
      migrating = false
    }
  }

  // --- Comment mutation functions ---

  async function doAddComment(cardId: string, author: string, content: string): Promise<Comment | null> {
    migrating = true
    try {
      const updated = await sdk.addComment(cardId, author, content, currentBoardId)
      lastWrittenContent = serializeCard(updated)
      const comment = updated.comments[updated.comments.length - 1]
      await loadCards()
      broadcast(buildInitMessage())
      return comment
    } catch {
      return null
    } finally {
      migrating = false
    }
  }

  async function doUpdateComment(cardId: string, commentId: string, content: string): Promise<Comment | null> {
    migrating = true
    try {
      const updated = await sdk.updateComment(cardId, commentId, content, currentBoardId)
      lastWrittenContent = serializeCard(updated)
      const comment = (updated.comments || []).find(c => c.id === commentId)
      await loadCards()
      broadcast(buildInitMessage())
      return comment ?? null
    } catch {
      return null
    } finally {
      migrating = false
    }
  }

  async function doDeleteComment(cardId: string, commentId: string): Promise<boolean> {
    const card = cards.find(f => f.id === cardId)
    if (!card) return false
    const comment = (card.comments || []).find(c => c.id === commentId)
    if (!comment) return false

    migrating = true
    try {
      const updated = await sdk.deleteComment(cardId, commentId, currentBoardId)
      lastWrittenContent = serializeCard(updated)
      await loadCards()
      broadcast(buildInitMessage())
      return true
    } catch {
      return false
    } finally {
      migrating = false
    }
  }

  // --- Log mutation functions ---

  async function doAddLog(cardId: string, text: string, source?: string, object?: Record<string, any>, timestamp?: string) {
    migrating = true
    try {
      const entry = await sdk.addLog(cardId, text, { source, timestamp, object }, currentBoardId)
      await loadCards()
      broadcast(buildInitMessage())
      return entry
    } catch {
      return null
    } finally {
      migrating = false
    }
  }

  async function doClearLogs(cardId: string): Promise<boolean> {
    migrating = true
    try {
      await sdk.clearLogs(cardId, currentBoardId)
      await loadCards()
      broadcast(buildInitMessage())
      return true
    } catch {
      return false
    } finally {
      migrating = false
    }
  }

  // --- WebSocket message handling ---

  async function handleMessage(ws: WebSocket, message: unknown): Promise<void> {
    const msg = message as Record<string, unknown>
    switch (msg.type) {
      case 'ready':
        migrating = true
        try {
          await loadCards()
          ws.send(JSON.stringify(buildInitMessage()))
        } finally {
          migrating = false
        }
        break

      case 'createCard':
        await doCreateCard(msg.data as CreateCardData)
        break

      case 'moveCard':
        await doMoveCard(msg.cardId as string, msg.newStatus as string, msg.newOrder as number)
        break

      case 'deleteCard':
        await doDeleteCard(msg.cardId as string)
        break

      case 'permanentDeleteCard':
        await doPermanentDeleteCard(msg.cardId as string)
        break

      case 'restoreCard': {
        const restoreId = msg.cardId as string
        const defaultStatus = sdk.getSettings().defaultStatus
        await doUpdateCard(restoreId, { status: defaultStatus })
        break
      }

      case 'purgeDeletedCards':
        await doPurgeDeletedCards()
        break

      case 'updateCard':
        await doUpdateCard(msg.cardId as string, msg.updates as Partial<Card>)
        break

      case 'bulkUpdateCard':
        await doUpdateCard(msg.cardId as string, msg.updates as Partial<Card>)
        break

      case 'openCard': {
        const cardId = msg.cardId as string
        const card = cards.find(f => f.id === cardId)
        if (!card) break

        // Clean up any temp file from a previously-opened card
        if (tempFileCardId && tempFileCardId !== cardId) {
          cleanupTempFile()
        }

        currentEditingCardId = cardId
        const frontmatter: CardFrontmatter = {
          version: card.version ?? 0,
          id: card.id, status: card.status, priority: card.priority,
          assignee: card.assignee, dueDate: card.dueDate, created: card.created,
          modified: card.modified, completedAt: card.completedAt,
          labels: card.labels, attachments: card.attachments, order: card.order,
          metadata: card.metadata, actions: card.actions
        }
        let logs: import('../shared/types').LogEntry[] = []
        try { logs = await sdk.listLogs(cardId, currentBoardId) } catch {}
        ws.send(JSON.stringify({ type: 'cardContent', cardId: card.id, content: card.content, frontmatter, comments: card.comments || [], logs }))
        break
      }

      case 'saveCardContent': {
        const cardId = msg.cardId as string
        const newContent = msg.content as string
        const fm = msg.frontmatter as CardFrontmatter
        await doUpdateCard(cardId, {
          content: newContent,
          status: fm.status,
          priority: fm.priority,
          assignee: fm.assignee,
          dueDate: fm.dueDate,
          labels: fm.labels,
          attachments: fm.attachments,
          actions: fm.actions,
        })
        break
      }

      case 'closeCard':
        currentEditingCardId = null
        cleanupTempFile()
        break

      case 'openSettings': {
        const settings = sdk.getSettings()
        settings.showBuildWithAI = false
        settings.markdownEditorMode = false
        ws.send(JSON.stringify({ type: 'showSettings', settings }))
        break
      }

      case 'saveSettings':
        doSaveSettings(msg.settings as CardDisplaySettings)
        break

      case 'addColumn': {
        const col = msg.column as { name: string; color: string }
        doAddColumn(col.name, col.color)
        break
      }

      case 'editColumn':
        doEditColumn(msg.columnId as string, msg.updates as { name: string; color: string })
        break

      case 'removeColumn':
        await doRemoveColumn(msg.columnId as string)
        break

      case 'cleanupColumn':
        await doCleanupColumn(msg.columnId as string)
        break

      case 'removeAttachment': {
        const cardId = msg.cardId as string
        const card = await doRemoveAttachment(cardId, msg.attachment as string)
        if (card && currentEditingCardId === cardId) {
          const frontmatter: CardFrontmatter = {
            version: card.version ?? 0,
            id: card.id, status: card.status, priority: card.priority,
            assignee: card.assignee, dueDate: card.dueDate, created: card.created,
            modified: card.modified, completedAt: card.completedAt,
            labels: card.labels, attachments: card.attachments, order: card.order,
            actions: card.actions
          }
          ws.send(JSON.stringify({ type: 'cardContent', cardId: card.id, content: card.content, frontmatter, comments: card.comments || [] }))
        }
        break
      }

      case 'addComment': {
        const comment = await doAddComment(msg.cardId as string, msg.author as string, msg.content as string)
        if (!comment) break
        const card = cards.find(f => f.id === msg.cardId)
        if (card && currentEditingCardId === msg.cardId) {
          const frontmatter: CardFrontmatter = {
            version: card.version ?? 0,
            id: card.id, status: card.status, priority: card.priority,
            assignee: card.assignee, dueDate: card.dueDate, created: card.created,
            modified: card.modified, completedAt: card.completedAt,
            labels: card.labels, attachments: card.attachments, order: card.order,
            actions: card.actions
          }
          ws.send(JSON.stringify({ type: 'cardContent', cardId: card.id, content: card.content, frontmatter, comments: card.comments || [] }))
        }
        break
      }

      case 'updateComment': {
        const comment = await doUpdateComment(msg.cardId as string, msg.commentId as string, msg.content as string)
        if (!comment) break
        const card = cards.find(f => f.id === msg.cardId)
        if (card && currentEditingCardId === msg.cardId) {
          const frontmatter: CardFrontmatter = {
            version: card.version ?? 0,
            id: card.id, status: card.status, priority: card.priority,
            assignee: card.assignee, dueDate: card.dueDate, created: card.created,
            modified: card.modified, completedAt: card.completedAt,
            labels: card.labels, attachments: card.attachments, order: card.order,
            actions: card.actions
          }
          ws.send(JSON.stringify({ type: 'cardContent', cardId: card.id, content: card.content, frontmatter, comments: card.comments || [] }))
        }
        break
      }

      case 'deleteComment': {
        await doDeleteComment(msg.cardId as string, msg.commentId as string)
        const card = cards.find(f => f.id === msg.cardId)
        if (card && currentEditingCardId === msg.cardId) {
          const frontmatter: CardFrontmatter = {
            version: card.version ?? 0,
            id: card.id, status: card.status, priority: card.priority,
            assignee: card.assignee, dueDate: card.dueDate, created: card.created,
            modified: card.modified, completedAt: card.completedAt,
            labels: card.labels, attachments: card.attachments, order: card.order,
            actions: card.actions
          }
          ws.send(JSON.stringify({ type: 'cardContent', cardId: card.id, content: card.content, frontmatter, comments: card.comments || [] }))
        }
        break
      }

      case 'addLog': {
        const entry = await doAddLog(
          msg.cardId as string,
          msg.text as string,
          msg.source as string | undefined,
          msg.object as Record<string, any> | undefined,
          msg.timestamp as string | undefined,
        )
        if (entry && currentEditingCardId === msg.cardId) {
          try {
            const logs = await sdk.listLogs(msg.cardId as string, currentBoardId)
            ws.send(JSON.stringify({ type: 'logsUpdated', cardId: msg.cardId, logs }))
          } catch { /* ignore */ }
        }
        break
      }

      case 'clearLogs': {
        await doClearLogs(msg.cardId as string)
        ws.send(JSON.stringify({ type: 'logsUpdated', cardId: msg.cardId, logs: [] }))
        break
      }

      case 'getLogs': {
        try {
          const logs = await sdk.listLogs(msg.cardId as string, currentBoardId)
          ws.send(JSON.stringify({ type: 'logsUpdated', cardId: msg.cardId, logs }))
        } catch {
          ws.send(JSON.stringify({ type: 'logsUpdated', cardId: msg.cardId, logs: [] }))
        }
        break
      }

      case 'addBoardLog': {
        try {
          const entry = await sdk.addBoardLog(
            msg.text as string,
            {
              source: msg.source as string | undefined,
              object: msg.object as Record<string, unknown> | undefined,
              timestamp: msg.timestamp as string | undefined,
            },
            currentBoardId || undefined,
          )
          const logs = await sdk.listBoardLogs(currentBoardId || undefined)
          ws.send(JSON.stringify({ type: 'boardLogsUpdated', boardId: currentBoardId, logs }))
          broadcast(buildInitMessage())
          void entry
        } catch { /* ignore */ }
        break
      }

      case 'clearBoardLogs': {
        await sdk.clearBoardLogs(currentBoardId || undefined)
        ws.send(JSON.stringify({ type: 'boardLogsUpdated', boardId: currentBoardId, logs: [] }))
        broadcast(buildInitMessage())
        break
      }

      case 'getBoardLogs': {
        try {
          const logs = await sdk.listBoardLogs(currentBoardId || undefined)
          ws.send(JSON.stringify({ type: 'boardLogsUpdated', boardId: currentBoardId, logs }))
        } catch {
          ws.send(JSON.stringify({ type: 'boardLogsUpdated', boardId: currentBoardId, logs: [] }))
        }
        break
      }

      case 'transferCard': {
        const cardId = msg.cardId as string
        const toBoard = msg.toBoard as string
        const targetStatus = msg.targetStatus as string
        migrating = true
        try {
          await sdk.transferCard(cardId, currentBoardId || readConfig(workspaceRoot).defaultBoard, toBoard, targetStatus)
          await loadCards()
          broadcast(buildInitMessage())
        } catch (err) {
          console.error('Failed to transfer card:', err)
        } finally {
          migrating = false
        }
        break
      }
      case 'switchBoard':
        currentBoardId = msg.boardId as string
        migrating = true
        try {
          await loadCards()
          broadcast(buildInitMessage())
        } finally {
          migrating = false
        }
        break

      case 'createBoard': {
        const boardName = msg.name as string
        try {
          const createdBoard = sdk.createBoard('', boardName)
          currentBoardId = createdBoard.id
          migrating = true
          try {
            await loadCards()
            broadcast(buildInitMessage())
          } finally {
            migrating = false
          }
        } catch (err) {
          console.error('Failed to create board:', err)
        }
        break
      }

      case 'setLabel': {
        sdk.setLabel(msg.name as string, msg.definition as { color: string; group?: string })
        broadcast({ type: 'labelsUpdated', labels: sdk.getLabels() })
        broadcast(buildInitMessage())
        break
      }

      case 'renameLabel': {
        await sdk.renameLabel(msg.oldName as string, msg.newName as string)
        await loadCards()
        broadcast({ type: 'labelsUpdated', labels: sdk.getLabels() })
        broadcast(buildInitMessage())
        break
      }

      case 'deleteLabel': {
        await sdk.deleteLabel(msg.name as string)
        await loadCards()
        broadcast({ type: 'labelsUpdated', labels: sdk.getLabels() })
        broadcast(buildInitMessage())
        break
      }

      case 'triggerAction': {
        const { cardId, action, callbackKey } = msg as { cardId: string; action: string; callbackKey: string }
        try {
          await sdk.triggerAction(cardId, action)
          ws.send(JSON.stringify({ type: 'actionResult', callbackKey }))
        } catch (err) {
          ws.send(JSON.stringify({ type: 'actionResult', callbackKey, error: String(err) }))
        }
        break
      }

      case 'triggerBoardAction': {
        const { boardId, actionKey, callbackKey } = msg as { boardId: string; actionKey: string; callbackKey: string }
        try {
          await sdk.triggerBoardAction(boardId, actionKey)
          ws.send(JSON.stringify({ type: 'boardActionResult', callbackKey }))
        } catch (err) {
          ws.send(JSON.stringify({ type: 'boardActionResult', callbackKey, error: String(err) }))
        }
        break
      }

      // VSCode-specific actions — no-ops in standalone (openFile handled via REST)
      case 'openFile':
      case 'focusMenuBar':
      case 'startWithAI':
      case 'addAttachment':
      case 'openAttachment':
        break
    }
  }

  // --- HTTP server ---

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`)
    const { pathname } = url
    const method = req.method || 'GET'

    // CORS preflight
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400'
      })
      res.end()
      return
    }

    // Route helper: match and extract params, then handle
    const route = (expectedMethod: string, pattern: string): Record<string, string> | null =>
      matchRoute(expectedMethod, method, pathname, pattern)

    // ==================== BOARDS API ====================

    let params = route('GET', '/api/boards')
    if (params) {
      return jsonOk(res, sdk.listBoards())
    }

    params = route('POST', '/api/boards')
    if (params) {
      try {
        const body = await readBody(req)
        const id = body.id as string
        const name = body.name as string
        if (!id) return jsonError(res, 400, 'id is required')
        if (!name) return jsonError(res, 400, 'name is required')
        const board = sdk.createBoard(id, name, {
          description: body.description as string | undefined,
          columns: body.columns as KanbanColumn[] | undefined,
        })
        return jsonOk(res, board, 201)
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('GET', '/api/boards/:boardId')
    if (params) {
      try {
        const { boardId } = params
        const board = sdk.getBoard(boardId)
        return jsonOk(res, board)
      } catch (err) {
        return jsonError(res, 404, String(err))
      }
    }

    params = route('PUT', '/api/boards/:boardId')
    if (params) {
      try {
        const { boardId } = params
        const body = await readBody(req)
        const board = sdk.updateBoard(boardId, body as Record<string, unknown>)
        return jsonOk(res, board)
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('DELETE', '/api/boards/:boardId')
    if (params) {
      try {
        const { boardId } = params
        await sdk.deleteBoard(boardId)
        return jsonOk(res, { deleted: true })
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    // ==================== BOARD ACTIONS API ====================

    params = route('GET', '/api/boards/:boardId/actions')
    if (params) {
      try {
        return jsonOk(res, sdk.getBoardActions(params.boardId))
      } catch (err) {
        return jsonError(res, 404, String(err))
      }
    }

    params = route('POST', '/api/boards/:boardId/actions')
    if (params) {
      try {
        const { boardId } = params
        const body = await readBody(req)
        const actions = body.actions as Record<string, string>
        const existing = sdk.getBoardActions(boardId)
        // Remove actions no longer present
        for (const key of Object.keys(existing)) {
          if (!(key in actions)) sdk.removeBoardAction(boardId, key)
        }
        // Add/update new actions
        for (const [key, title] of Object.entries(actions)) {
          sdk.addBoardAction(boardId, key, title)
        }
        return jsonOk(res, sdk.getBoardActions(boardId))
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('PUT', '/api/boards/:boardId/actions/:key')
    if (params) {
      try {
        const { boardId, key } = params
        const body = await readBody(req)
        const title = body.title as string
        return jsonOk(res, sdk.addBoardAction(boardId, key, title))
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('DELETE', '/api/boards/:boardId/actions/:key')
    if (params) {
      try {
        const { boardId, key } = params
        sdk.removeBoardAction(boardId, key)
        res.writeHead(204)
        res.end()
        return
      } catch (err) {
        return jsonError(res, 404, String(err))
      }
    }

    params = route('POST', '/api/boards/:boardId/actions/:key/trigger')
    if (params) {
      try {
        const { boardId, key } = params
        await sdk.triggerBoardAction(boardId, key)
        res.writeHead(204)
        res.end()
        return
      } catch (err) {
        return jsonError(res, 404, String(err))
      }
    }

    // Transfer a task between boards
    params = route('POST', '/api/boards/:boardId/tasks/:id/transfer')
    if (params) {
      try {
        const { boardId, id } = params
        const body = await readBody(req)
        const config = readConfig(workspaceRoot)
        const fromBoard = currentBoardId || config.defaultBoard
        const targetStatus = body.targetStatus as string | undefined
        const card = await sdk.transferCard(id, fromBoard, boardId, targetStatus)
        return jsonOk(res, sanitizeCard(card))
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    // ==================== BOARD-SCOPED TASKS API ====================

    params = route('GET', '/api/boards/:boardId/tasks')
    if (params) {
      try {
        const { boardId } = params
        const boardColumns = sdk.listColumns(boardId)
        const metaFilter: Record<string, string> = {}
        for (const [param, value] of url.searchParams.entries()) {
          if (param.startsWith('meta.')) metaFilter[param.slice(5)] = value
        }
        const sortParam = url.searchParams.get('sort') as CardSortOption | null
        const boardTasks = await sdk.listCards(
          boardColumns.map(c => c.id), boardId,
          Object.keys(metaFilter).length > 0 ? metaFilter : undefined,
          sortParam || undefined
        )
        let result = boardTasks.map(sanitizeCard)
        if (url.searchParams.get('includeDeleted') !== 'true') {
          result = result.filter(f => f.status !== 'deleted')
        }
        const status = url.searchParams.get('status')
        if (status) result = result.filter(f => f.status === status)
        const priority = url.searchParams.get('priority')
        if (priority) result = result.filter(f => f.priority === priority)
        const assignee = url.searchParams.get('assignee')
        if (assignee) result = result.filter(f => f.assignee === assignee)
        const label = url.searchParams.get('label')
        if (label) result = result.filter(f => f.labels.includes(label))
        const labelGroup = url.searchParams.get('labelGroup')
        if (labelGroup) {
          const groupLabels = sdk.getLabelsInGroup(labelGroup)
          result = result.filter(f => f.labels.some(l => groupLabels.includes(l)))
        }
        return jsonOk(res, result)
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('POST', '/api/boards/:boardId/tasks')
    if (params) {
      try {
        const { boardId } = params
        const body = await readBody(req)
        const content = (body.content as string) || ''
        if (!content) return jsonError(res, 400, 'content is required')
        const card = await sdk.createCard({
          content,
          status: (body.status as string) || 'backlog',
          priority: (body.priority as Priority) || 'medium',
          assignee: (body.assignee as string) || null,
          dueDate: (body.dueDate as string) || null,
          labels: (body.labels as string[]) || [],
          metadata: body.metadata as Record<string, any> | undefined,
          actions: body.actions as string[] | undefined,
          boardId,
        })
        return jsonOk(res, sanitizeCard(card), 201)
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('GET', '/api/boards/:boardId/tasks/:id')
    if (params) {
      try {
        const { boardId, id } = params
        const card = await sdk.getCard(id, boardId)
        if (!card) return jsonError(res, 404, 'Task not found')
        return jsonOk(res, sanitizeCard(card))
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('PUT', '/api/boards/:boardId/tasks/:id')
    if (params) {
      try {
        const { boardId, id } = params
        const body = await readBody(req)
        const card = await sdk.updateCard(id, body as Partial<Card>, boardId)
        return jsonOk(res, sanitizeCard(card))
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('PATCH', '/api/boards/:boardId/tasks/:id/move')
    if (params) {
      try {
        const { boardId, id } = params
        const body = await readBody(req)
        const newStatus = body.status as string
        const position = body.position as number ?? 0
        if (!newStatus) return jsonError(res, 400, 'status is required')
        const card = await sdk.moveCard(id, newStatus, position, boardId)
        return jsonOk(res, sanitizeCard(card))
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('POST', '/api/boards/:boardId/tasks/:id/actions/:action')
    if (params) {
      try {
        const { boardId, id, action } = params
        await sdk.triggerAction(id, action, boardId)
        res.writeHead(204)
        res.end()
        return
      } catch (err) {
        const msg = String(err)
        if (msg.includes('Card not found')) return jsonError(res, 404, msg)
        return jsonError(res, 400, msg)
      }
    }

    params = route('DELETE', '/api/boards/:boardId/tasks/:id/permanent')
    if (params) {
      try {
        const { boardId, id } = params
        await sdk.permanentlyDeleteCard(id, boardId)
        await loadCards()
        broadcast(buildInitMessage())
        return jsonOk(res, { deleted: true, permanent: true })
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('DELETE', '/api/boards/:boardId/tasks/:id')
    if (params) {
      try {
        const { boardId, id } = params
        await sdk.deleteCard(id, boardId)
        await loadCards()
        broadcast(buildInitMessage())
        return jsonOk(res, { deleted: true })
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    // ==================== BOARD-SCOPED COLUMNS API ====================

    params = route('GET', '/api/boards/:boardId/columns')
    if (params) {
      try {
        const { boardId } = params
        return jsonOk(res, sdk.listColumns(boardId))
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    // ==================== TASKS API ====================

    params = route('GET', '/api/tasks')
    if (params) {
      const metaFilter2: Record<string, string> = {}
      for (const [param, value] of url.searchParams.entries()) {
        if (param.startsWith('meta.')) metaFilter2[param.slice(5)] = value
      }
      const sortParam2 = url.searchParams.get('sort') as CardSortOption | null
      await loadCards()
      let result = cards.map(sanitizeCard)
      if (url.searchParams.get('includeDeleted') !== 'true') {
        result = result.filter(f => f.status !== 'deleted')
      }
      const status = url.searchParams.get('status')
      if (status) result = result.filter(f => f.status === status)
      const priority = url.searchParams.get('priority')
      if (priority) result = result.filter(f => f.priority === priority)
      const assignee = url.searchParams.get('assignee')
      if (assignee) result = result.filter(f => f.assignee === assignee)
      const label = url.searchParams.get('label')
      if (label) result = result.filter(f => f.labels.includes(label))
      const labelGroup = url.searchParams.get('labelGroup')
      if (labelGroup) {
        const groupLabels = sdk.getLabelsInGroup(labelGroup)
        result = result.filter(f => f.labels.some(l => groupLabels.includes(l)))
      }
      if (Object.keys(metaFilter2).length > 0)
        result = result.filter(f => matchesMetaFilter(f.metadata, metaFilter2))
      result = applySortParam(result, sortParam2)
      return jsonOk(res, result)
    }

    params = route('POST', '/api/tasks')
    if (params) {
      try {
        const body = await readBody(req)
        const data: CreateCardData = {
          content: (body.content as string) || '',
          status: (body.status as string) || 'backlog',
          priority: (body.priority as Priority) || 'medium',
          assignee: (body.assignee as string) || null,
          dueDate: (body.dueDate as string) || null,
          labels: (body.labels as string[]) || [],
          metadata: body.metadata as Record<string, any> | undefined,
          actions: body.actions as string[] | undefined,
        }
        if (!data.content) return jsonError(res, 400, 'content is required')
        const card = await doCreateCard(data)
        return jsonOk(res, sanitizeCard(card), 201)
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('GET', '/api/tasks/:id')
    if (params) {
      const { id } = params
      const card = cards.find(f => f.id === id)
      if (!card) return jsonError(res, 404, 'Task not found')
      return jsonOk(res, sanitizeCard(card))
    }

    params = route('PUT', '/api/tasks/:id')
    if (params) {
      try {
        const { id } = params
        const body = await readBody(req)
        const card = await doUpdateCard(id, body as Partial<Card>)
        if (!card) return jsonError(res, 404, 'Task not found')
        return jsonOk(res, sanitizeCard(card))
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('PATCH', '/api/tasks/:id/move')
    if (params) {
      try {
        const { id } = params
        const body = await readBody(req)
        const newStatus = body.status as string
        const position = body.position as number ?? 0
        if (!newStatus) return jsonError(res, 400, 'status is required')
        const card = await doMoveCard(id, newStatus, position)
        if (!card) return jsonError(res, 404, 'Task not found')
        return jsonOk(res, sanitizeCard(card))
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('POST', '/api/tasks/:id/actions/:action')
    if (params) {
      try {
        const { id, action } = params
        await sdk.triggerAction(id, action)
        res.writeHead(204)
        res.end()
        return
      } catch (err) {
        const msg = String(err)
        if (msg.includes('Card not found')) return jsonError(res, 404, msg)
        return jsonError(res, 400, msg)
      }
    }

    params = route('DELETE', '/api/tasks/:id/permanent')
    if (params) {
      const { id } = params
      const ok = await doPermanentDeleteCard(id)
      if (!ok) return jsonError(res, 404, 'Task not found')
      return jsonOk(res, { deleted: true, permanent: true })
    }

    params = route('DELETE', '/api/tasks/:id')
    if (params) {
      const { id } = params
      const ok = await doDeleteCard(id)
      if (!ok) return jsonError(res, 404, 'Task not found')
      return jsonOk(res, { deleted: true })
    }

    // ==================== ATTACHMENTS API ====================

    params = route('POST', '/api/tasks/:id/attachments')
    if (params) {
      try {
        const { id } = params
        const body = await readBody(req)
        const files = body.files as { name: string; data: string }[]
        if (!Array.isArray(files)) return jsonError(res, 400, 'files array is required')
        for (const file of files) {
          const buf = Buffer.from(file.data, 'base64')
          await doAddAttachment(id, file.name, buf)
        }
        broadcast(buildInitMessage())
        const card = cards.find(f => f.id === id)
        if (!card) return jsonError(res, 404, 'Task not found')
        return jsonOk(res, sanitizeCard(card))
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    // ==================== OPEN IN VSCODE ====================

    params = route('GET', '/api/resolve-path')
    if (params) {
      const rawPath = url.searchParams.get('path') ?? ''
      if (!rawPath) return jsonError(res, 400, 'path is required')
      const resolved = /^([/~]|[A-Za-z]:[/\\])/.test(rawPath)
        ? rawPath.replace(/^~/, process.env.HOME ?? os.homedir())
        : path.resolve(workspaceRoot, rawPath)
      return jsonOk(res, { path: resolved })
    }

    params = route('GET', '/api/card-file')
    if (params) {
      const cardId = url.searchParams.get('cardId')
      if (!cardId) return jsonError(res, 400, 'cardId is required')
      const openCard = cards.find(c => c.id === cardId)
      if (!openCard) return jsonError(res, 404, 'Card not found')

      // Clean up any previous temp file for a different card
      if (tempFileCardId && tempFileCardId !== cardId) cleanupTempFile()

      if (openCard.filePath) {
        // Markdown engine — return the real file path
        return jsonOk(res, { path: openCard.filePath })
      } else {
        // SQLite engine — write a temp file and watch for changes to sync back
        if (tempFileCardId === cardId && tempFilePath) {
          // Already watching this card's temp file — refresh content and reuse
          tempFileWriting = true
          try { fs.writeFileSync(tempFilePath, serializeCard(openCard), 'utf-8') } finally { tempFileWriting = false }
          return jsonOk(res, { path: tempFilePath })
        }
        const tmpPath = path.join(os.tmpdir(), `kanban-card-${openCard.id}.md`)
        tempFileWriting = true
        try { fs.writeFileSync(tmpPath, serializeCard(openCard), 'utf-8') } finally { tempFileWriting = false }
        tempFilePath = tmpPath
        tempFileCardId = openCard.id
        let debounce: ReturnType<typeof setTimeout> | undefined
        const watcher = chokidar.watch(tmpPath, { ignoreInitial: true })
        watcher.on('change', () => {
          if (tempFileWriting) return
          if (debounce) clearTimeout(debounce)
          debounce = setTimeout(async () => {
            const cid = tempFileCardId
            const fp = tempFilePath
            if (!cid || !fp) return
            try {
              const raw = fs.readFileSync(fp, 'utf-8')
              const parsed = parseCardFile(raw, `${cid}.md`)
              if (!parsed) return
              migrating = true
              try {
                const updated = await sdk.updateCard(cid, {
                  content: parsed.content,
                  status: parsed.status,
                  priority: parsed.priority,
                  assignee: parsed.assignee,
                  dueDate: parsed.dueDate,
                  labels: parsed.labels,
                  metadata: parsed.metadata
                }, currentBoardId)
                const idx = cards.findIndex(c => c.id === cid)
                if (idx !== -1) cards[idx] = updated
                broadcast({ type: 'cardsUpdated', cards: cards.map(sanitizeCard) })
                if (currentEditingCardId === cid) {
                  broadcast({ type: 'cardContent', cardId: updated.id, content: updated.content, frontmatter: updated })
                }
              } finally {
                migrating = false
              }
            } catch { /* ignore */ }
          }, 300)
        })
        tempFileWatcher = watcher
        return jsonOk(res, { path: tmpPath })
      }
    }

    params = route('GET', '/api/tasks/:id/attachments/:filename')
    if (params) {
      const { id, filename: attachName } = params
      const card = cards.find(f => f.id === id)
      if (!card) return jsonError(res, 404, 'Task not found')
      const cardDir = sdk.storageEngine.getCardDir(card)
      const attachmentPath = path.resolve(cardDir, attachName)
      if (!attachmentPath.startsWith(absoluteKanbanDir)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' })
        res.end('Forbidden')
        return
      }
      const ext = path.extname(attachName)
      const contentType = MIME_TYPES[ext] || 'application/octet-stream'
      fs.readFile(attachmentPath, (err, data) => {
        if (err) { res.writeHead(404); res.end('File not found'); return }
        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Disposition': `inline; filename="${attachName}"`,
          'Access-Control-Allow-Origin': '*'
        })
        res.end(data)
      })
      return
    }

    params = route('DELETE', '/api/tasks/:id/attachments/:filename')
    if (params) {
      const { id, filename: attachName } = params
      const card = await doRemoveAttachment(id, attachName)
      if (!card) return jsonError(res, 404, 'Task not found')
      return jsonOk(res, sanitizeCard(card))
    }

    // ==================== COMMENTS API ====================

    params = route('GET', '/api/tasks/:id/comments')
    if (params) {
      const { id } = params
      const card = cards.find(f => f.id === id)
      if (!card) return jsonError(res, 404, 'Task not found')
      return jsonOk(res, card.comments || [])
    }

    params = route('POST', '/api/tasks/:id/comments')
    if (params) {
      try {
        const { id } = params
        const body = await readBody(req)
        const author = body.author as string
        const content = body.content as string
        if (!author) return jsonError(res, 400, 'author is required')
        if (!content) return jsonError(res, 400, 'content is required')
        const comment = await doAddComment(id, author, content)
        if (!comment) return jsonError(res, 404, 'Task not found')
        return jsonOk(res, comment, 201)
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('PUT', '/api/tasks/:id/comments/:commentId')
    if (params) {
      try {
        const { id, commentId } = params
        const body = await readBody(req)
        const content = body.content as string
        if (!content) return jsonError(res, 400, 'content is required')
        const comment = await doUpdateComment(id, commentId, content)
        if (!comment) return jsonError(res, 404, 'Comment not found')
        return jsonOk(res, comment)
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('DELETE', '/api/tasks/:id/comments/:commentId')
    if (params) {
      const { id, commentId } = params
      const ok = await doDeleteComment(id, commentId)
      if (!ok) return jsonError(res, 404, 'Comment not found')
      return jsonOk(res, { deleted: true })
    }

    // ==================== LOGS API ====================

    params = route('GET', '/api/tasks/:id/logs')
    if (params) {
      const { id } = params
      try {
        const logs = await sdk.listLogs(id, currentBoardId)
        return jsonOk(res, logs)
      } catch {
        return jsonError(res, 404, 'Task not found')
      }
    }

    params = route('POST', '/api/tasks/:id/logs')
    if (params) {
      try {
        const { id } = params
        const body = await readBody(req)
        const text = body.text as string
        if (!text) return jsonError(res, 400, 'text is required')
        const entry = await doAddLog(
          id,
          text,
          body.source as string | undefined,
          body.object as Record<string, any> | undefined,
          body.timestamp as string | undefined,
        )
        if (!entry) return jsonError(res, 404, 'Task not found')
        return jsonOk(res, entry, 201)
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('DELETE', '/api/tasks/:id/logs')
    if (params) {
      const { id } = params
      const ok = await doClearLogs(id)
      if (!ok) return jsonError(res, 404, 'Task not found')
      return jsonOk(res, { cleared: true })
    }

    // ==================== BOARD LOGS API ====================

    params = route('GET', '/api/boards/:boardId/logs')
    if (params) {
      const bId = params.boardId as string
      const logs = await sdk.listBoardLogs(bId)
      return jsonOk(res, logs)
    }

    params = route('POST', '/api/boards/:boardId/logs')
    if (params) {
      try {
        const bId = params.boardId as string
        const body = await readBody(req)
        const text = body.text as string
        if (!text) return jsonError(res, 400, 'text is required')
        const entry = await sdk.addBoardLog(text, {
          source: body.source as string | undefined,
          object: body.object as Record<string, unknown> | undefined,
          timestamp: body.timestamp as string | undefined,
        }, bId)
        broadcast(buildInitMessage())
        return jsonOk(res, entry, 201)
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('DELETE', '/api/boards/:boardId/logs')
    if (params) {
      const bId = params.boardId as string
      await sdk.clearBoardLogs(bId)
      broadcast(buildInitMessage())
      return jsonOk(res, { cleared: true })
    }

    // ==================== COLUMNS API ====================

    params = route('GET', '/api/columns')
    if (params) {
      return jsonOk(res, sdk.listColumns(currentBoardId))
    }

    params = route('POST', '/api/columns')
    if (params) {
      try {
        const body = await readBody(req)
        const name = body.name as string
        const color = body.color as string
        if (!name) return jsonError(res, 400, 'name is required')
        const column = doAddColumn(name, color || '#6b7280')
        return jsonOk(res, column, 201)
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('PUT', '/api/columns/:id')
    if (params) {
      try {
        const { id } = params
        const body = await readBody(req)
        const column = doEditColumn(id, { name: body.name as string, color: body.color as string })
        if (!column) return jsonError(res, 404, 'Column not found')
        return jsonOk(res, column)
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('DELETE', '/api/columns/:id')
    if (params) {
      const { id } = params
      const result = await doRemoveColumn(id)
      if (!result.removed) return jsonError(res, 400, result.error || 'Cannot remove column')
      return jsonOk(res, { deleted: true })
    }

    // ==================== SETTINGS API ====================

    params = route('GET', '/api/settings')
    if (params) {
      const settings = sdk.getSettings()
      settings.showBuildWithAI = false
      settings.markdownEditorMode = false
      return jsonOk(res, settings)
    }

    params = route('PUT', '/api/settings')
    if (params) {
      try {
        const body = await readBody(req)
        doSaveSettings(body as unknown as CardDisplaySettings)
        return jsonOk(res, sdk.getSettings())
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    // ==================== WEBHOOKS API ====================

    params = route('GET', '/api/webhooks')
    if (params) {
      return jsonOk(res, sdk.listWebhooks())
    }

    params = route('POST', '/api/webhooks')
    if (params) {
      try {
        const body = await readBody(req)
        const webhookUrl = body.url as string
        const events = body.events as string[]
        const secret = body.secret as string | undefined
        if (!webhookUrl) return jsonError(res, 400, 'url is required')
        if (!events || !Array.isArray(events) || events.length === 0) {
          return jsonError(res, 400, 'events array is required')
        }
        const webhook = sdk.createWebhook({ url: webhookUrl, events, secret })
        return jsonOk(res, webhook, 201)
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('PUT', '/api/webhooks/:id')
    if (params) {
      try {
        const { id } = params
        const body = await readBody(req)
        const webhook = sdk.updateWebhook(id, body as Partial<{ url: string; events: string[]; secret: string; active: boolean }>)
        if (!webhook) return jsonError(res, 404, 'Webhook not found')
        return jsonOk(res, webhook)
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('DELETE', '/api/webhooks/:id')
    if (params) {
      const { id } = params
      const ok = sdk.deleteWebhook(id)
      if (!ok) return jsonError(res, 404, 'Webhook not found')
      return jsonOk(res, { deleted: true })
    }

    // ==================== LABELS API ====================

    params = route('GET', '/api/labels')
    if (params) {
      return jsonOk(res, sdk.getLabels())
    }

    params = route('PUT', '/api/labels/:name')
    if (params) {
      try {
        const name = decodeURIComponent(params.name)
        const body = await readBody(req)
        sdk.setLabel(name, { color: body.color as string, group: body.group as string | undefined })
        return jsonOk(res, sdk.getLabels())
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('PATCH', '/api/labels/:name')
    if (params) {
      try {
        const name = decodeURIComponent(params.name)
        const body = await readBody(req)
        const newName = body.newName as string
        if (!newName) return jsonError(res, 400, 'newName is required')
        await sdk.renameLabel(name, newName)
        await loadCards()
        broadcast({ type: 'labelsUpdated', labels: sdk.getLabels() })
        broadcast(buildInitMessage())
        return jsonOk(res, sdk.getLabels())
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('DELETE', '/api/labels/:name')
    if (params) {
      try {
        const name = decodeURIComponent(params.name)
        await sdk.deleteLabel(name)
        await loadCards()
        broadcast({ type: 'labelsUpdated', labels: sdk.getLabels() })
        broadcast(buildInitMessage())
        return jsonOk(res, { success: true })
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    // ==================== WORKSPACE API ====================

    params = route('GET', '/api/workspace')
    if (params) {
      const wsConfig = readConfig(workspaceRoot)
      return jsonOk(res, {
        path: workspaceRoot,
        port: wsConfig.port,
        storageEngine: sdk.storageEngine.type,
        sqlitePath: wsConfig.sqlitePath
      })
    }

    params = route('GET', '/api/storage')
    if (params) {
      const wsConfig = readConfig(workspaceRoot)
      return jsonOk(res, {
        type: sdk.storageEngine.type,
        sqlitePath: wsConfig.sqlitePath
      })
    }

    params = route('POST', '/api/storage/migrate-to-sqlite')
    if (params) {
      try {
        const body = await readBody(req)
        const dbPath = typeof body.sqlitePath === 'string' ? body.sqlitePath : undefined
        const count = await sdk.migrateToSqlite(dbPath)
        return jsonOk(res, { ok: true, count, storageEngine: 'sqlite' })
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    params = route('POST', '/api/storage/migrate-to-markdown')
    if (params) {
      try {
        const count = await sdk.migrateToMarkdown()
        return jsonOk(res, { ok: true, count, storageEngine: 'markdown' })
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }

    // ==================== LEGACY API (backwards compat) ====================

    if (method === 'POST' && pathname === '/api/upload-attachment') {
      try {
        const body = await readBody(req)
        const cardId = body.cardId as string
        const files = body.files as { name: string; data: string }[]
        if (!cardId || !Array.isArray(files)) return jsonError(res, 400, 'Missing cardId or files')

        for (const file of files) {
          const buf = Buffer.from(file.data, 'base64')
          await doAddAttachment(cardId, file.name, buf)
        }

        broadcast(buildInitMessage())
        const card = cards.find(f => f.id === cardId)
        if (card && currentEditingCardId === cardId) {
          const frontmatter: CardFrontmatter = {
            version: card.version ?? 0,
            id: card.id, status: card.status, priority: card.priority,
            assignee: card.assignee, dueDate: card.dueDate, created: card.created,
            modified: card.modified, completedAt: card.completedAt,
            labels: card.labels, attachments: card.attachments, order: card.order,
            metadata: card.metadata, actions: card.actions,
          }
          broadcast({ type: 'cardContent', cardId: card.id, content: card.content, frontmatter, comments: card.comments || [] })
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: String(err) }))
      }
      return
    }

    if (method === 'GET' && pathname === '/api/attachment') {
      const cardId = url.searchParams.get('cardId')
      const filename = url.searchParams.get('filename')
      if (!cardId || !filename) {
        res.writeHead(400, { 'Content-Type': 'text/plain' }); res.end('Missing cardId or filename'); return
      }
      const card = cards.find(f => f.id === cardId)
      if (!card) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Card not found'); return }
      const cardDir = sdk.storageEngine.getCardDir(card)
      const attachmentPath = path.resolve(cardDir, filename)
      if (!attachmentPath.startsWith(absoluteKanbanDir)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' }); res.end('Forbidden'); return
      }
      const ext = path.extname(filename)
      const contentType = MIME_TYPES[ext] || 'application/octet-stream'
      fs.readFile(attachmentPath, (err, data) => {
        if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('File not found'); return }
        res.writeHead(200, { 'Content-Type': contentType, 'Content-Disposition': `inline; filename="${filename}"` })
        res.end(data)
      })
      return
    }

    // Catch-all for unmatched /api/* routes
    if (pathname.startsWith('/api/')) {
      return jsonError(res, 404, 'Not found')
    }

    // ==================== STATIC FILES ====================

    const filePath = path.join(resolvedWebviewDir, pathname === '/' ? 'index.html' : pathname)

    if (!path.extname(filePath)) {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(indexHtml)
      return
    }

    const ext = path.extname(filePath)
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(indexHtml)
        return
      }
      res.writeHead(200, { 'Content-Type': contentType })
      res.end(data)
    })
  })

  // --- WebSocket server ---

  const wss = new WebSocketServer({ server, path: '/ws' })

  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString())
        handleMessage(ws, message)
      } catch (err) {
        console.error('Failed to handle message:', err)
      }
    })
  })

  // --- File watcher ---
  // Only watch for markdown file changes when using the markdown storage engine.
  // SQLite-backed boards are updated in-process and need no filesystem watching.

  let debounceTimer: ReturnType<typeof setTimeout> | undefined

  fs.mkdirSync(absoluteKanbanDir, { recursive: true })

  const handleFileChange = (changedPath?: string) => {
    if (changedPath && !changedPath.endsWith('.md')) return
    if (migrating) return
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(async () => {
      if (migrating) return
      migrating = true
      try {
        await loadCards()
        broadcast(buildInitMessage())
      } finally {
        migrating = false
      }

      if (currentEditingCardId && changedPath) {
        const editingCard = cards.find(f => f.id === currentEditingCardId)
        if (editingCard && editingCard.filePath === changedPath) {
          const currentContent = serializeCard(editingCard)
          if (currentContent !== lastWrittenContent) {
            const frontmatter: CardFrontmatter = {
              version: editingCard.version ?? 0,
              id: editingCard.id, status: editingCard.status, priority: editingCard.priority,
              assignee: editingCard.assignee, dueDate: editingCard.dueDate, created: editingCard.created,
              modified: editingCard.modified, completedAt: editingCard.completedAt,
              labels: editingCard.labels, attachments: editingCard.attachments, order: editingCard.order,
              metadata: editingCard.metadata, actions: editingCard.actions,
            }
            broadcast({ type: 'cardContent', cardId: editingCard.id, content: editingCard.content, frontmatter, comments: editingCard.comments || [] })
          }
        }
      }
    }, 100)
  }

  if (sdk.storageEngine.type === 'markdown') {
    let watcherReady = false
    const watcher = chokidar.watch(absoluteKanbanDir, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 100 }
    })

    watcher.on('ready', () => { watcherReady = true })
    watcher.on('change', (p) => watcherReady && handleFileChange(p))
    watcher.on('add', (p) => watcherReady && handleFileChange(p))
    watcher.on('unlink', (p) => watcherReady && handleFileChange(p))

    server.on('close', () => {
      watcher.close()
      wss.close()
    })
  } else {
    server.on('close', () => {
      sdk.close()
      wss.close()
    })
  }

  server.listen(port, () => {
    console.log(`Kanban board running at http://localhost:${port}`)
    console.log(`API available at http://localhost:${port}/api`)
    console.log(`Kanban directory: ${absoluteKanbanDir}`)
  })

  return server
}
