import * as vscode from 'vscode'
import * as path from 'path'
import { getTitleFromContent, CARD_FORMAT_VERSION } from '../shared/types'
import type { Card, Priority, KanbanColumn, CardFrontmatter, CardDisplaySettings } from '../shared/types'
import { serializeCard } from '../sdk/parser'
import { readConfig, configToSettings, CONFIG_FILENAME, DEFAULT_CONFIG } from '../shared/config'
import { KanbanSDK } from '../sdk/KanbanSDK'


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

export class KanbanPanel {
  public static readonly viewType = 'kanban-lite.panel'
  public static currentPanel: KanbanPanel | undefined

  private readonly _panel: vscode.WebviewPanel
  private readonly _extensionUri: vscode.Uri
  private readonly _context: vscode.ExtensionContext
  private _cards: Card[] = []
  private _disposables: vscode.Disposable[] = []
  private _fileWatcher: vscode.FileSystemWatcher | undefined
  private _configWatcher: vscode.FileSystemWatcher | undefined
  private _currentEditingCardId: string | null = null
  private _currentBoardId: string | undefined = undefined
  private _lastWrittenContent: string = ''
  private _migrating = false
  private _onDisposeCallbacks: (() => void)[] = []
  private _sdk: KanbanSDK | null = null

  public static createOrShow(extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined

    // If we already have a panel, show it
    if (KanbanPanel.currentPanel) {
      KanbanPanel.currentPanel._panel.reveal(column)
      return
    }

    // Otherwise, create a new panel
    const panel = vscode.window.createWebviewPanel(
      KanbanPanel.viewType,
      'Kanban Board',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'dist'),
          vscode.Uri.joinPath(extensionUri, 'dist', 'webview')
        ]
      }
    )

    // Set the tab icon
    panel.iconPath = {
      light: vscode.Uri.joinPath(extensionUri, 'resources', 'kanban-light.svg'),
      dark: vscode.Uri.joinPath(extensionUri, 'resources', 'kanban-dark.svg')
    }

    KanbanPanel.currentPanel = new KanbanPanel(panel, extensionUri, context)
  }

  public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
    KanbanPanel.currentPanel = new KanbanPanel(panel, extensionUri, context)
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
    this._panel = panel
    this._extensionUri = extensionUri
    this._context = context

    // Ensure webview options are set (critical for deserialization after reload)
    this._panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(extensionUri, 'dist'),
        vscode.Uri.joinPath(extensionUri, 'dist', 'webview')
      ]
    }

    // Set the webview's initial html content
    this._update()

    // Listen for when the panel is disposed
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables)

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.type) {
          case 'ready':
            await this._loadCards()
            this._sendCardsToWebview()
            break
          case 'createCard': {
            await this._createCard(message.data)
            const createRoot = this._getWorkspaceRoot()
            const createCfg = createRoot ? readConfig(createRoot) : DEFAULT_CONFIG
            if (createCfg.markdownEditorMode) {
              // Open the newly created card in native editor
              const created = this._cards[this._cards.length - 1]
              if (created) {
                this._openCardInNativeEditor(created.id)
              }
            }
            break
          }
          case 'moveCard':
            await this._moveCard(message.cardId, message.newStatus, message.newOrder)
            break
          case 'deleteCard':
            await this._deleteCard(message.cardId)
            break
          case 'permanentDeleteCard':
            await this._permanentDeleteCard(message.cardId)
            break
          case 'restoreCard':
            await this._restoreCard(message.cardId)
            break
          case 'purgeDeletedCards':
            await this._purgeDeletedCards()
            break
          case 'updateCard':
            await this._updateCard(message.cardId, message.updates)
            break
          case 'openCard': {
            const openRoot = this._getWorkspaceRoot()
            const openCfg = openRoot ? readConfig(openRoot) : DEFAULT_CONFIG
            if (openCfg.markdownEditorMode) {
              this._openCardInNativeEditor(message.cardId)
            } else {
              await this._sendCardContent(message.cardId)
            }
            break
          }
          case 'saveCardContent':
            await this._saveCardContent(message.cardId, message.content, message.frontmatter)
            break
          case 'closeCard':
            this._currentEditingCardId = null
            break
          case 'openFile': {
            const feat = this._cards.find(f => f.id === message.cardId)
            if (feat) {
              const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(feat.filePath))
              await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside })
            }
            break
          }
          case 'openSettings': {
            const settingsRoot = this._getWorkspaceRoot()
            const settingsCfg = settingsRoot ? readConfig(settingsRoot) : { ...DEFAULT_CONFIG }
            const openSettings = configToSettings(settingsCfg)
            this._panel.webview.postMessage({ type: 'showSettings', settings: openSettings })
            break
          }
          case 'focusMenuBar':
            // Focus must leave the webview before focusMenuBar works (VS Code limitation).
            // Use Activity Bar (not Side Bar) — it's always visible and won't expand a collapsed sidebar.
            await vscode.commands.executeCommand('workbench.action.focusActivityBar')
            await vscode.commands.executeCommand('workbench.action.focusMenuBar')
            break
          case 'addAttachment':
            await this._addAttachment(message.cardId)
            break
          case 'openAttachment':
            await this._openAttachment(message.cardId, message.attachment)
            break
          case 'removeAttachment':
            await this._removeAttachment(message.cardId, message.attachment)
            break
          case 'addComment':
            await this._addComment(message.cardId, message.author, message.content)
            break
          case 'updateComment':
            await this._updateComment(message.cardId, message.commentId, message.content)
            break
          case 'deleteComment':
            await this._deleteComment(message.cardId, message.commentId)
            break
          case 'startWithAI':
            await this._startWithAI(message.agent, message.permissionMode)
            break
          case 'saveSettings':
            await this._saveSettings(message.settings)
            break
          case 'addColumn':
            await this._addColumn(message.column)
            break
          case 'editColumn':
            await this._editColumn(message.columnId, message.updates)
            break
          case 'removeColumn':
            await this._removeColumn(message.columnId)
            break
          case 'cleanupColumn':
            await this._cleanupColumn(message.columnId)
            break
          case 'transferCard': {
            const sdk = this._getSDK()
            if (!sdk || !this._currentBoardId) break
            this._migrating = true
            try {
              await sdk.transferCard(
                message.cardId,
                this._currentBoardId,
                message.toBoard,
                message.targetStatus
              )
              this._currentEditingCardId = null
              await this._loadCards()
              this._sendCardsToWebview()
            } catch (err) {
              vscode.window.showErrorMessage(`Failed to transfer card: ${err}`)
            } finally {
              this._migrating = false
            }
            break
          }
          case 'switchBoard':
            this._currentBoardId = message.boardId
            await this._loadCards()
            this._sendCardsToWebview()
            break
          case 'createBoard': {
            if (!this._sdk) break
            const { generateSlug } = await import('../shared/types')
            const boardId = generateSlug(message.name) || 'board'
            try {
              this._sdk.createBoard(boardId, message.name)
              this._currentBoardId = boardId
              await this._loadCards()
              this._sendCardsToWebview()
            } catch (err) {
              vscode.window.showErrorMessage(`Failed to create board: ${err}`)
            }
            break
          }
          case 'setLabel': {
            const sdk = this._getSDK()
            if (!sdk) break
            sdk.setLabel(message.name, message.definition)
            await this._loadCards()
            this._sendCardsToWebview()
            this._panel.webview.postMessage({ type: 'labelsUpdated', labels: sdk.getLabels() })
            break
          }
          case 'renameLabel': {
            const sdk = this._getSDK()
            if (!sdk) break
            await sdk.renameLabel(message.oldName, message.newName)
            await this._loadCards()
            this._sendCardsToWebview()
            this._panel.webview.postMessage({ type: 'labelsUpdated', labels: sdk.getLabels() })
            break
          }
          case 'deleteLabel': {
            const sdk = this._getSDK()
            if (!sdk) break
            await sdk.deleteLabel(message.name)
            await this._loadCards()
            this._sendCardsToWebview()
            this._panel.webview.postMessage({ type: 'labelsUpdated', labels: sdk.getLabels() })
            break
          }
          case 'triggerAction': {
            const { cardId, action, callbackKey } = message
            const triggerSdk = this._getSDK()
            if (!triggerSdk) break
            try {
              await triggerSdk.triggerAction(cardId, action)
              this._panel.webview.postMessage({ type: 'actionResult', callbackKey })
            } catch (err) {
              this._panel.webview.postMessage({ type: 'actionResult', callbackKey, error: String(err) })
            }
            break
          }
          case 'toggleTheme':
            await vscode.commands.executeCommand('workbench.action.toggleLightDarkThemes')
            break
        }
      },
      null,
      this._disposables
    )

    // Set up file watcher for card files
    this._setupFileWatcher()

    // Watch .kanban.json for config changes
    this._setupConfigWatcher()
  }

  private _setupFileWatcher(): void {
    // Dispose old watcher if re-setting up (e.g. kanbanDirectory changed)
    if (this._fileWatcher) {
      this._fileWatcher.dispose()
    }

    const kanbanDir = this._getWorkspaceKanbanDir()
    if (!kanbanDir) return

    // Watch for changes in the kanban directory (recursive for board/status subfolders)
    const pattern = new vscode.RelativePattern(kanbanDir, 'boards/**/*.md')
    this._fileWatcher = vscode.workspace.createFileSystemWatcher(pattern)

    // Debounce to avoid multiple rapid updates
    let debounceTimer: NodeJS.Timeout | undefined

    const handleFileChange = (uri?: vscode.Uri) => {
      if (this._migrating) return
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(async () => {
        await this._loadCards()
        this._sendCardsToWebview()

        // If the changed file is the currently-edited card, check for external changes
        if (this._currentEditingCardId && uri) {
          const editingCard = this._cards.find(f => f.id === this._currentEditingCardId)
          if (editingCard && editingCard.filePath === uri.fsPath) {
            const currentContent = serializeCard(editingCard)
            if (currentContent !== this._lastWrittenContent) {
              // External change detected — refresh the editor
              this._sendCardContent(this._currentEditingCardId)
            }
          }
        }
      }, 100)
    }

    this._fileWatcher.onDidChange((uri) => handleFileChange(uri), null, this._disposables)
    this._fileWatcher.onDidCreate((uri) => handleFileChange(uri), null, this._disposables)
    this._fileWatcher.onDidDelete((uri) => handleFileChange(uri), null, this._disposables)

    this._disposables.push(this._fileWatcher)
  }

  private _setupConfigWatcher(): void {
    if (this._configWatcher) {
      this._configWatcher.dispose()
    }

    const root = this._getWorkspaceRoot()
    if (!root) return

    const pattern = new vscode.RelativePattern(root, CONFIG_FILENAME)
    this._configWatcher = vscode.workspace.createFileSystemWatcher(pattern)

    let lastKanbanDir = this._getWorkspaceKanbanDir()

    const handleConfigChange = () => {
      const newKanbanDir = this._getWorkspaceKanbanDir()
      if (lastKanbanDir !== newKanbanDir) {
        lastKanbanDir = newKanbanDir
        this._setupFileWatcher()
        this._loadCards().then(() => this._sendCardsToWebview())
      } else {
        this._sendCardsToWebview()
      }
    }

    this._configWatcher.onDidChange(handleConfigChange, null, this._disposables)
    this._configWatcher.onDidCreate(handleConfigChange, null, this._disposables)
    this._configWatcher.onDidDelete(handleConfigChange, null, this._disposables)
    this._disposables.push(this._configWatcher)
  }

  public onDispose(callback: () => void): void {
    this._onDisposeCallbacks.push(callback)
  }

  public dispose() {
    KanbanPanel.currentPanel = undefined

    for (const cb of this._onDisposeCallbacks) {
      cb()
    }
    this._onDisposeCallbacks = []

    this._panel.dispose()

    while (this._disposables.length) {
      const x = this._disposables.pop()
      if (x) {
        x.dispose()
      }
    }
  }

  private _update() {
    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview)
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'index.js')
    )
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'style.css')
    )

    const nonce = this._getNonce()

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}';">
  <link href="${styleUri}" rel="stylesheet">
  <title>Kanban Board</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
  }

  private _getNonce(): string {
    let text = ''
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length))
    }
    return text
  }

  private _getWorkspaceRoot(): string | null {
    const workspaceFolders = vscode.workspace.workspaceFolders
    if (!workspaceFolders || workspaceFolders.length === 0) return null
    return workspaceFolders[0].uri.fsPath
  }

  private _getWorkspaceKanbanDir(): string | null {
    const root = this._getWorkspaceRoot()
    if (!root) return null
    const config = readConfig(root)
    return path.join(root, config.kanbanDirectory)
  }

  private _getSDK(): KanbanSDK | null {
    const kanbanDir = this._getWorkspaceKanbanDir()
    if (!kanbanDir) return null
    if (!this._sdk || this._sdk.kanbanDir !== kanbanDir) {
      this._sdk = new KanbanSDK(kanbanDir)
    }
    return this._sdk
  }

  private async _loadCards(): Promise<void> {
    const sdk = this._getSDK()
    if (!sdk) {
      this._cards = []
      return
    }

    try {
      this._migrating = true
      const columns = this._getColumns().map(c => c.id)
      this._cards = await sdk.listCards(columns, this._currentBoardId)
    } catch {
      this._cards = []
    } finally {
      this._migrating = false
    }
  }

  public triggerCreateDialog(): void {
    this._panel.webview.postMessage({ type: 'triggerCreateDialog' })
  }

  public openCard(cardId: string): void {
    const root = this._getWorkspaceRoot()
    const cfg = root ? readConfig(root) : DEFAULT_CONFIG
    if (cfg.markdownEditorMode) {
      this._openCardInNativeEditor(cardId)
    } else {
      this._sendCardContent(cardId)
    }
  }

  private async _createCard(data: CreateCardData): Promise<void> {
    const sdk = this._getSDK()
    if (!sdk) {
      vscode.window.showErrorMessage('No workspace folder open')
      return
    }

    this._migrating = true
    try {
      const card = await sdk.createCard({
        content: data.content,
        status: data.status,
        priority: data.priority,
        assignee: data.assignee ?? undefined,
        dueDate: data.dueDate ?? undefined,
        labels: data.labels,
        metadata: data.metadata,
        actions: data.actions,
        boardId: this._currentBoardId
      })
      this._cards.push(card)
      this._sendCardsToWebview()
    } finally {
      this._migrating = false
    }
  }

  private async _moveCard(cardId: string, newStatus: string, newOrder: number): Promise<void> {
    const sdk = this._getSDK()
    if (!sdk) return

    this._migrating = true
    try {
      const updated = await sdk.moveCard(cardId, newStatus, newOrder, this._currentBoardId)
      const idx = this._cards.findIndex(f => f.id === cardId)
      if (idx !== -1) this._cards[idx] = updated
      this._sendCardsToWebview()
    } finally {
      this._migrating = false
    }
  }

  private async _deleteCard(cardId: string): Promise<void> {
    const sdk = this._getSDK()
    if (!sdk) return

    try {
      await sdk.deleteCard(cardId, this._currentBoardId)
      await this._loadCards()
      this._sendCardsToWebview()
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to delete card: ${err}`)
    }
  }

  private async _permanentDeleteCard(cardId: string): Promise<void> {
    const sdk = this._getSDK()
    if (!sdk) return

    try {
      await sdk.permanentlyDeleteCard(cardId, this._currentBoardId)
      this._cards = this._cards.filter(f => f.id !== cardId)
      this._sendCardsToWebview()
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to permanently delete card: ${err}`)
    }
  }

  private async _purgeDeletedCards(): Promise<void> {
    const sdk = this._getSDK()
    if (!sdk) return

    try {
      await sdk.purgeDeletedCards(this._currentBoardId)
      this._cards = this._cards.filter(f => f.status !== 'deleted')
      this._sendCardsToWebview()
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to purge deleted cards: ${err}`)
    }
  }

  private async _restoreCard(cardId: string): Promise<void> {
    const sdk = this._getSDK()
    if (!sdk) return

    try {
      const settings = sdk.getSettings()
      await sdk.updateCard(cardId, { status: settings.defaultStatus }, this._currentBoardId)
      await this._loadCards()
      this._sendCardsToWebview()
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to restore card: ${err}`)
    }
  }

  private async _updateCard(cardId: string, updates: Partial<Card>): Promise<void> {
    const sdk = this._getSDK()
    if (!sdk) return

    this._migrating = true
    try {
      const updated = await sdk.updateCard(cardId, updates, this._currentBoardId)
      const idx = this._cards.findIndex(f => f.id === cardId)
      if (idx !== -1) this._cards[idx] = updated
      this._sendCardsToWebview()
    } finally {
      this._migrating = false
    }
  }

  private async _openCardInNativeEditor(cardId: string): Promise<void> {
    const card = this._cards.find(f => f.id === cardId)
    if (!card) return

    // Use a fixed column beside the panel so repeated clicks reuse the same split
    const panelColumn = this._panel.viewColumn ?? vscode.ViewColumn.One
    const targetColumn = panelColumn === vscode.ViewColumn.One ? vscode.ViewColumn.Two : vscode.ViewColumn.Beside

    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(card.filePath))
    await vscode.window.showTextDocument(doc, { viewColumn: targetColumn, preview: true })
  }

  private async _sendCardContent(cardId: string): Promise<void> {
    const card = this._cards.find(f => f.id === cardId)
    if (!card) return

    this._currentEditingCardId = cardId

    const frontmatter: CardFrontmatter = {
      version: CARD_FORMAT_VERSION,
      id: card.id,
      status: card.status,
      priority: card.priority,
      assignee: card.assignee,
      dueDate: card.dueDate,
      created: card.created,
      modified: card.modified,
      completedAt: card.completedAt,
      labels: card.labels,
      attachments: card.attachments,
      order: card.order,
      metadata: card.metadata,
      actions: card.actions
    }

    this._panel.webview.postMessage({
      type: 'cardContent',
      cardId: card.id,
      content: card.content,
      frontmatter,
      comments: card.comments || []
    })
  }

  private async _saveCardContent(
    cardId: string,
    content: string,
    frontmatter: CardFrontmatter
  ): Promise<void> {
    const sdk = this._getSDK()
    if (!sdk) return

    this._migrating = true
    try {
      const updated = await sdk.updateCard(cardId, {
        content,
        status: frontmatter.status,
        priority: frontmatter.priority,
        assignee: frontmatter.assignee,
        dueDate: frontmatter.dueDate,
        labels: frontmatter.labels,
        attachments: frontmatter.attachments
      }, this._currentBoardId)
      this._lastWrittenContent = serializeCard(updated)
      const idx = this._cards.findIndex(f => f.id === cardId)
      if (idx !== -1) this._cards[idx] = updated
      this._sendCardsToWebview()
    } finally {
      this._migrating = false
    }
  }

  private async _addAttachment(cardId: string): Promise<void> {
    const sdk = this._getSDK()
    const card = this._cards.find(f => f.id === cardId)
    if (!card || !sdk) return

    const uris = await vscode.window.showOpenDialog({
      canSelectMany: true,
      openLabel: 'Attach',
      title: 'Select files to attach'
    })
    if (!uris || uris.length === 0) return

    this._migrating = true
    try {
      let updated = card
      for (const uri of uris) {
        updated = await sdk.addAttachment(cardId, uri.fsPath, this._currentBoardId)
      }
      const idx = this._cards.findIndex(f => f.id === cardId)
      if (idx !== -1) this._cards[idx] = updated

      this._sendCardsToWebview()
      if (this._currentEditingCardId === cardId) {
        await this._sendCardContent(cardId)
      }
    } finally {
      this._migrating = false
    }
  }

  private async _openAttachment(cardId: string, attachment: string): Promise<void> {
    const card = this._cards.find(f => f.id === cardId)
    if (!card) return

    const featureDir = path.dirname(card.filePath)
    const attachmentPath = path.resolve(featureDir, attachment)

    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(attachmentPath))
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(attachmentPath))
      await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside })
    } catch {
      // For binary files or files that can't be opened as text, reveal in OS
      await vscode.env.openExternal(vscode.Uri.file(attachmentPath))
    }
  }

  private async _removeAttachment(cardId: string, attachment: string): Promise<void> {
    const sdk = this._getSDK()
    if (!sdk) return

    this._migrating = true
    try {
      const updated = await sdk.removeAttachment(cardId, attachment, this._currentBoardId)
      const idx = this._cards.findIndex(f => f.id === cardId)
      if (idx !== -1) this._cards[idx] = updated

      this._sendCardsToWebview()
      if (this._currentEditingCardId === cardId) {
        await this._sendCardContent(cardId)
      }
    } finally {
      this._migrating = false
    }
  }

  private async _addComment(cardId: string, author: string, content: string): Promise<void> {
    const sdk = this._getSDK()
    if (!sdk) return

    this._migrating = true
    try {
      const updated = await sdk.addComment(cardId, author, content, this._currentBoardId)
      const idx = this._cards.findIndex(f => f.id === cardId)
      if (idx !== -1) this._cards[idx] = updated

      this._sendCardsToWebview()
      if (this._currentEditingCardId === cardId) {
        await this._sendCardContent(cardId)
      }
    } finally {
      this._migrating = false
    }
  }

  private async _updateComment(cardId: string, commentId: string, content: string): Promise<void> {
    const sdk = this._getSDK()
    if (!sdk) return

    this._migrating = true
    try {
      const updated = await sdk.updateComment(cardId, commentId, content, this._currentBoardId)
      const idx = this._cards.findIndex(f => f.id === cardId)
      if (idx !== -1) this._cards[idx] = updated

      this._sendCardsToWebview()
      if (this._currentEditingCardId === cardId) {
        await this._sendCardContent(cardId)
      }
    } finally {
      this._migrating = false
    }
  }

  private async _deleteComment(cardId: string, commentId: string): Promise<void> {
    const sdk = this._getSDK()
    if (!sdk) return

    this._migrating = true
    try {
      const updated = await sdk.deleteComment(cardId, commentId, this._currentBoardId)
      const idx = this._cards.findIndex(f => f.id === cardId)
      if (idx !== -1) this._cards[idx] = updated

      this._sendCardsToWebview()
      if (this._currentEditingCardId === cardId) {
        await this._sendCardContent(cardId)
      }
    } finally {
      this._migrating = false
    }
  }

  private async _startWithAI(
    agent?: 'claude' | 'codex' | 'opencode',
    permissionMode?: 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions'
  ): Promise<void> {
    // Find the currently editing card
    const card = this._cards.find(f => f.id === this._currentEditingCardId)
    if (!card) {
      vscode.window.showErrorMessage('No card selected')
      return
    }

    // Parse title from the first # heading in content
    const titleMatch = card.content.match(/^#\s+(.+)$/m)
    const title = titleMatch ? titleMatch[1].trim() : getTitleFromContent(card.content)

    const labels = card.labels.length > 0 ? ` [${card.labels.join(', ')}]` : ''
    const description = card.content.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()
    const shortDesc = description.length > 200 ? description.substring(0, 200) + '...' : description

    const prompt = `Implement this card: "${title}" (${card.priority} priority)${labels}. ${shortDesc} See full details in: ${card.filePath}`

    // Use provided agent or fall back to config
    const aiRoot = this._getWorkspaceRoot()
    const aiConfig = aiRoot ? readConfig(aiRoot) : DEFAULT_CONFIG
    const selectedAgent = agent || aiConfig.aiAgent || 'claude'
    const selectedPermissionMode = permissionMode || 'default'

    let command: string
    const escapedPrompt = prompt.replace(/"/g, '\\"')

    switch (selectedAgent) {
      case 'claude': {
        const permissionFlag = selectedPermissionMode !== 'default' ? ` --permission-mode ${selectedPermissionMode}` : ''
        command = `claude${permissionFlag} "${escapedPrompt}"`
        break
      }
      case 'codex': {
        const approvalMap: Record<string, string> = {
          'default': 'suggest',
          'plan': 'suggest',
          'acceptEdits': 'auto-edit',
          'bypassPermissions': 'full-auto'
        }
        const approvalMode = approvalMap[selectedPermissionMode] || 'suggest'
        command = `codex --approval-mode ${approvalMode} "${escapedPrompt}"`
        break
      }
      case 'opencode': {
        command = `opencode "${escapedPrompt}"`
        break
      }
      default:
        command = `claude "${escapedPrompt}"`
    }

    const agentNames: Record<string, string> = {
      'claude': 'Claude Code',
      'codex': 'Codex',
      'opencode': 'OpenCode'
    }
    const terminal = vscode.window.createTerminal({
      name: agentNames[selectedAgent] || 'AI Agent',
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    })
    terminal.show()
    terminal.sendText(command)
  }

  private _saveSettings(settings: CardDisplaySettings): void {
    const sdk = this._getSDK()
    if (!sdk) return
    sdk.updateSettings(settings)
    this._sendCardsToWebview()
  }

  private _getColumns(): KanbanColumn[] {
    const sdk = this._getSDK()
    if (!sdk) return [...DEFAULT_CONFIG.boards.default.columns]
    return sdk.listColumns(this._currentBoardId)
  }

  private _sendCardsToWebview(): void {
    const sdk = this._getSDK()
    const columns = sdk ? sdk.listColumns(this._currentBoardId) : [...DEFAULT_CONFIG.boards.default.columns]
    const settings = sdk ? sdk.getSettings() : configToSettings(DEFAULT_CONFIG)
    const boards = sdk ? sdk.listBoards() : []
    const root = this._getWorkspaceRoot()
    const config = root ? readConfig(root) : DEFAULT_CONFIG
    const currentBoard = this._currentBoardId || config.defaultBoard

    // Override showBuildWithAI based on VS Code's AI card toggle
    const aiDisabled = vscode.workspace.getConfiguration('chat').get<boolean>('disableAIFeatures', false)
    if (aiDisabled) {
      settings.showBuildWithAI = false
    }

    this._panel.webview.postMessage({
      type: 'init',
      cards: this._cards,
      columns,
      settings,
      boards,
      currentBoard,
      labels: sdk ? sdk.getLabels() : {}
    })
  }

  private _addColumn(column: { name: string; color: string }): void {
    const sdk = this._getSDK()
    if (!sdk) return
    const id = column.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    let uniqueId = id
    let counter = 1
    const existing = sdk.listColumns()
    while (existing.some(c => c.id === uniqueId)) {
      uniqueId = `${id}-${counter++}`
    }
    sdk.addColumn({ id: uniqueId, name: column.name, color: column.color }, this._currentBoardId)
    this._sendCardsToWebview()
  }

  private _editColumn(columnId: string, updates: { name: string; color: string }): void {
    const sdk = this._getSDK()
    if (!sdk) return
    sdk.updateColumn(columnId, updates, this._currentBoardId)
    this._sendCardsToWebview()
  }

  private _removeColumn(columnId: string): void {
    const sdk = this._getSDK()
    if (!sdk) return
    const hasCards = this._cards.some(f => f.status === columnId)
    if (hasCards) {
      vscode.window.showWarningMessage(`Cannot remove list "${columnId}" because it still contains cards. Move or delete them first.`)
      return
    }
    const columns = sdk.listColumns()
    if (columns.length <= 1) {
      vscode.window.showWarningMessage('Cannot remove the last list.')
      return
    }
    sdk.removeColumn(columnId, this._currentBoardId)
    this._sendCardsToWebview()
  }

  private async _cleanupColumn(columnId: string): Promise<void> {
    const sdk = this._getSDK()
    if (!sdk) return

    this._migrating = true
    try {
      await sdk.cleanupColumn(columnId, this._currentBoardId)
      // Update in-memory cache: mark all column cards as deleted
      this._cards = this._cards.map(f =>
        f.status === columnId ? { ...f, status: 'deleted' } : f
      )
      this._sendCardsToWebview()
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to cleanup list: ${err}`)
    } finally {
      this._migrating = false
    }
  }
}
