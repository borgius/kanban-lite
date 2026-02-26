import * as vscode from 'vscode'
import * as path from 'path'
import { getTitleFromContent } from '../shared/types'
import type { Feature, Priority, KanbanColumn, FeatureFrontmatter, CardDisplaySettings } from '../shared/types'
import { serializeFeature } from '../sdk/parser'
import { readConfig, configToSettings, CONFIG_FILENAME, DEFAULT_CONFIG } from '../shared/config'
import { KanbanSDK } from '../sdk/KanbanSDK'


interface CreateFeatureData {
  status: string
  priority: Priority
  content: string
  assignee: string | null
  dueDate: string | null
  labels: string[]
}

export class KanbanPanel {
  public static readonly viewType = 'kanban-lite.panel'
  public static currentPanel: KanbanPanel | undefined

  private readonly _panel: vscode.WebviewPanel
  private readonly _extensionUri: vscode.Uri
  private readonly _context: vscode.ExtensionContext
  private _features: Feature[] = []
  private _disposables: vscode.Disposable[] = []
  private _fileWatcher: vscode.FileSystemWatcher | undefined
  private _configWatcher: vscode.FileSystemWatcher | undefined
  private _currentEditingFeatureId: string | null = null
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
            await this._loadFeatures()
            this._sendFeaturesToWebview()
            break
          case 'createFeature': {
            await this._createFeature(message.data)
            const createRoot = this._getWorkspaceRoot()
            const createCfg = createRoot ? readConfig(createRoot) : DEFAULT_CONFIG
            if (createCfg.markdownEditorMode) {
              // Open the newly created feature in native editor
              const created = this._features[this._features.length - 1]
              if (created) {
                this._openFeatureInNativeEditor(created.id)
              }
            }
            break
          }
          case 'moveFeature':
            await this._moveFeature(message.featureId, message.newStatus, message.newOrder)
            break
          case 'deleteFeature':
            await this._deleteFeature(message.featureId)
            break
          case 'permanentDeleteFeature':
            await this._permanentDeleteFeature(message.featureId)
            break
          case 'restoreFeature':
            await this._restoreFeature(message.featureId)
            break
          case 'updateFeature':
            await this._updateFeature(message.featureId, message.updates)
            break
          case 'openFeature': {
            const openRoot = this._getWorkspaceRoot()
            const openCfg = openRoot ? readConfig(openRoot) : DEFAULT_CONFIG
            if (openCfg.markdownEditorMode) {
              this._openFeatureInNativeEditor(message.featureId)
            } else {
              await this._sendFeatureContent(message.featureId)
            }
            break
          }
          case 'saveFeatureContent':
            await this._saveFeatureContent(message.featureId, message.content, message.frontmatter)
            break
          case 'closeFeature':
            this._currentEditingFeatureId = null
            break
          case 'openFile': {
            const feat = this._features.find(f => f.id === message.featureId)
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
            await this._addAttachment(message.featureId)
            break
          case 'openAttachment':
            await this._openAttachment(message.featureId, message.attachment)
            break
          case 'removeAttachment':
            await this._removeAttachment(message.featureId, message.attachment)
            break
          case 'addComment':
            await this._addComment(message.featureId, message.author, message.content)
            break
          case 'updateComment':
            await this._updateComment(message.featureId, message.commentId, message.content)
            break
          case 'deleteComment':
            await this._deleteComment(message.featureId, message.commentId)
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
          case 'transferCard': {
            const sdk = this._getSDK()
            if (!sdk || !this._currentBoardId) break
            this._migrating = true
            try {
              await sdk.transferCard(
                message.featureId,
                this._currentBoardId,
                message.toBoard,
                message.targetStatus
              )
              this._currentEditingFeatureId = null
              await this._loadFeatures()
              this._sendFeaturesToWebview()
            } catch (err) {
              vscode.window.showErrorMessage(`Failed to transfer card: ${err}`)
            } finally {
              this._migrating = false
            }
            break
          }
          case 'switchBoard':
            this._currentBoardId = message.boardId
            await this._loadFeatures()
            this._sendFeaturesToWebview()
            break
          case 'createBoard': {
            if (!this._sdk) break
            const { generateSlug } = await import('../shared/types')
            const boardId = generateSlug(message.name) || 'board'
            try {
              this._sdk.createBoard(boardId, message.name)
              this._currentBoardId = boardId
              await this._loadFeatures()
              this._sendFeaturesToWebview()
            } catch (err) {
              vscode.window.showErrorMessage(`Failed to create board: ${err}`)
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

    // Set up file watcher for feature files
    this._setupFileWatcher()

    // Watch .kanban.json for config changes
    this._setupConfigWatcher()
  }

  private _setupFileWatcher(): void {
    // Dispose old watcher if re-setting up (e.g. featuresDirectory changed)
    if (this._fileWatcher) {
      this._fileWatcher.dispose()
    }

    const featuresDir = this._getWorkspaceFeaturesDir()
    if (!featuresDir) return

    // Watch for changes in the features directory (recursive for board/status subfolders)
    const pattern = new vscode.RelativePattern(featuresDir, 'boards/**/*.md')
    this._fileWatcher = vscode.workspace.createFileSystemWatcher(pattern)

    // Debounce to avoid multiple rapid updates
    let debounceTimer: NodeJS.Timeout | undefined

    const handleFileChange = (uri?: vscode.Uri) => {
      if (this._migrating) return
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(async () => {
        await this._loadFeatures()
        this._sendFeaturesToWebview()

        // If the changed file is the currently-edited feature, check for external changes
        if (this._currentEditingFeatureId && uri) {
          const editingFeature = this._features.find(f => f.id === this._currentEditingFeatureId)
          if (editingFeature && editingFeature.filePath === uri.fsPath) {
            const currentContent = serializeFeature(editingFeature)
            if (currentContent !== this._lastWrittenContent) {
              // External change detected — refresh the editor
              this._sendFeatureContent(this._currentEditingFeatureId)
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

    let lastFeaturesDir = this._getWorkspaceFeaturesDir()

    const handleConfigChange = () => {
      const newFeaturesDir = this._getWorkspaceFeaturesDir()
      if (lastFeaturesDir !== newFeaturesDir) {
        lastFeaturesDir = newFeaturesDir
        this._setupFileWatcher()
        this._loadFeatures().then(() => this._sendFeaturesToWebview())
      } else {
        this._sendFeaturesToWebview()
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

  private _getWorkspaceFeaturesDir(): string | null {
    const root = this._getWorkspaceRoot()
    if (!root) return null
    const config = readConfig(root)
    return path.join(root, config.featuresDirectory)
  }

  private _getSDK(): KanbanSDK | null {
    const featuresDir = this._getWorkspaceFeaturesDir()
    if (!featuresDir) return null
    if (!this._sdk || this._sdk.featuresDir !== featuresDir) {
      this._sdk = new KanbanSDK(featuresDir)
    }
    return this._sdk
  }

  private async _loadFeatures(): Promise<void> {
    const sdk = this._getSDK()
    if (!sdk) {
      this._features = []
      return
    }

    try {
      this._migrating = true
      const columns = this._getColumns().map(c => c.id)
      this._features = await sdk.listCards(columns, this._currentBoardId)
    } catch {
      this._features = []
    } finally {
      this._migrating = false
    }
  }

  public triggerCreateDialog(): void {
    this._panel.webview.postMessage({ type: 'triggerCreateDialog' })
  }

  public openFeature(featureId: string): void {
    const root = this._getWorkspaceRoot()
    const cfg = root ? readConfig(root) : DEFAULT_CONFIG
    if (cfg.markdownEditorMode) {
      this._openFeatureInNativeEditor(featureId)
    } else {
      this._sendFeatureContent(featureId)
    }
  }

  private async _createFeature(data: CreateFeatureData): Promise<void> {
    const sdk = this._getSDK()
    if (!sdk) {
      vscode.window.showErrorMessage('No workspace folder open')
      return
    }

    this._migrating = true
    try {
      const feature = await sdk.createCard({
        content: data.content,
        status: data.status,
        priority: data.priority,
        assignee: data.assignee ?? undefined,
        dueDate: data.dueDate ?? undefined,
        labels: data.labels,
        boardId: this._currentBoardId
      })
      this._features.push(feature)
      this._sendFeaturesToWebview()
    } finally {
      this._migrating = false
    }
  }

  private async _moveFeature(featureId: string, newStatus: string, newOrder: number): Promise<void> {
    const sdk = this._getSDK()
    if (!sdk) return

    this._migrating = true
    try {
      const updated = await sdk.moveCard(featureId, newStatus, newOrder, this._currentBoardId)
      const idx = this._features.findIndex(f => f.id === featureId)
      if (idx !== -1) this._features[idx] = updated
      this._sendFeaturesToWebview()
    } finally {
      this._migrating = false
    }
  }

  private async _deleteFeature(featureId: string): Promise<void> {
    const sdk = this._getSDK()
    if (!sdk) return

    try {
      await sdk.deleteCard(featureId, this._currentBoardId)
      await this._loadFeatures()
      this._sendFeaturesToWebview()
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to delete feature: ${err}`)
    }
  }

  private async _permanentDeleteFeature(featureId: string): Promise<void> {
    const sdk = this._getSDK()
    if (!sdk) return

    try {
      await sdk.permanentlyDeleteCard(featureId, this._currentBoardId)
      this._features = this._features.filter(f => f.id !== featureId)
      this._sendFeaturesToWebview()
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to permanently delete feature: ${err}`)
    }
  }

  private async _restoreFeature(featureId: string): Promise<void> {
    const sdk = this._getSDK()
    if (!sdk) return

    try {
      const settings = sdk.getSettings()
      await sdk.updateCard(featureId, { status: settings.defaultStatus }, this._currentBoardId)
      await this._loadFeatures()
      this._sendFeaturesToWebview()
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to restore feature: ${err}`)
    }
  }

  private async _updateFeature(featureId: string, updates: Partial<Feature>): Promise<void> {
    const sdk = this._getSDK()
    if (!sdk) return

    this._migrating = true
    try {
      const updated = await sdk.updateCard(featureId, updates, this._currentBoardId)
      const idx = this._features.findIndex(f => f.id === featureId)
      if (idx !== -1) this._features[idx] = updated
      this._sendFeaturesToWebview()
    } finally {
      this._migrating = false
    }
  }

  private async _openFeatureInNativeEditor(featureId: string): Promise<void> {
    const feature = this._features.find(f => f.id === featureId)
    if (!feature) return

    // Use a fixed column beside the panel so repeated clicks reuse the same split
    const panelColumn = this._panel.viewColumn ?? vscode.ViewColumn.One
    const targetColumn = panelColumn === vscode.ViewColumn.One ? vscode.ViewColumn.Two : vscode.ViewColumn.Beside

    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(feature.filePath))
    await vscode.window.showTextDocument(doc, { viewColumn: targetColumn, preview: true })
  }

  private async _sendFeatureContent(featureId: string): Promise<void> {
    const feature = this._features.find(f => f.id === featureId)
    if (!feature) return

    this._currentEditingFeatureId = featureId

    const frontmatter: FeatureFrontmatter = {
      id: feature.id,
      status: feature.status,
      priority: feature.priority,
      assignee: feature.assignee,
      dueDate: feature.dueDate,
      created: feature.created,
      modified: feature.modified,
      completedAt: feature.completedAt,
      labels: feature.labels,
      attachments: feature.attachments,
      order: feature.order
    }

    this._panel.webview.postMessage({
      type: 'featureContent',
      featureId: feature.id,
      content: feature.content,
      frontmatter,
      comments: feature.comments || []
    })
  }

  private async _saveFeatureContent(
    featureId: string,
    content: string,
    frontmatter: FeatureFrontmatter
  ): Promise<void> {
    const sdk = this._getSDK()
    if (!sdk) return

    this._migrating = true
    try {
      const updated = await sdk.updateCard(featureId, {
        content,
        status: frontmatter.status,
        priority: frontmatter.priority,
        assignee: frontmatter.assignee,
        dueDate: frontmatter.dueDate,
        labels: frontmatter.labels,
        attachments: frontmatter.attachments
      }, this._currentBoardId)
      this._lastWrittenContent = serializeFeature(updated)
      const idx = this._features.findIndex(f => f.id === featureId)
      if (idx !== -1) this._features[idx] = updated
      this._sendFeaturesToWebview()
    } finally {
      this._migrating = false
    }
  }

  private async _addAttachment(featureId: string): Promise<void> {
    const sdk = this._getSDK()
    const feature = this._features.find(f => f.id === featureId)
    if (!feature || !sdk) return

    const uris = await vscode.window.showOpenDialog({
      canSelectMany: true,
      openLabel: 'Attach',
      title: 'Select files to attach'
    })
    if (!uris || uris.length === 0) return

    this._migrating = true
    try {
      let updated = feature
      for (const uri of uris) {
        updated = await sdk.addAttachment(featureId, uri.fsPath, this._currentBoardId)
      }
      const idx = this._features.findIndex(f => f.id === featureId)
      if (idx !== -1) this._features[idx] = updated

      this._sendFeaturesToWebview()
      if (this._currentEditingFeatureId === featureId) {
        await this._sendFeatureContent(featureId)
      }
    } finally {
      this._migrating = false
    }
  }

  private async _openAttachment(featureId: string, attachment: string): Promise<void> {
    const feature = this._features.find(f => f.id === featureId)
    if (!feature) return

    const featureDir = path.dirname(feature.filePath)
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

  private async _removeAttachment(featureId: string, attachment: string): Promise<void> {
    const sdk = this._getSDK()
    if (!sdk) return

    this._migrating = true
    try {
      const updated = await sdk.removeAttachment(featureId, attachment, this._currentBoardId)
      const idx = this._features.findIndex(f => f.id === featureId)
      if (idx !== -1) this._features[idx] = updated

      this._sendFeaturesToWebview()
      if (this._currentEditingFeatureId === featureId) {
        await this._sendFeatureContent(featureId)
      }
    } finally {
      this._migrating = false
    }
  }

  private async _addComment(featureId: string, author: string, content: string): Promise<void> {
    const sdk = this._getSDK()
    if (!sdk) return

    this._migrating = true
    try {
      const updated = await sdk.addComment(featureId, author, content, this._currentBoardId)
      const idx = this._features.findIndex(f => f.id === featureId)
      if (idx !== -1) this._features[idx] = updated

      this._sendFeaturesToWebview()
      if (this._currentEditingFeatureId === featureId) {
        await this._sendFeatureContent(featureId)
      }
    } finally {
      this._migrating = false
    }
  }

  private async _updateComment(featureId: string, commentId: string, content: string): Promise<void> {
    const sdk = this._getSDK()
    if (!sdk) return

    this._migrating = true
    try {
      const updated = await sdk.updateComment(featureId, commentId, content, this._currentBoardId)
      const idx = this._features.findIndex(f => f.id === featureId)
      if (idx !== -1) this._features[idx] = updated

      this._sendFeaturesToWebview()
      if (this._currentEditingFeatureId === featureId) {
        await this._sendFeatureContent(featureId)
      }
    } finally {
      this._migrating = false
    }
  }

  private async _deleteComment(featureId: string, commentId: string): Promise<void> {
    const sdk = this._getSDK()
    if (!sdk) return

    this._migrating = true
    try {
      const updated = await sdk.deleteComment(featureId, commentId, this._currentBoardId)
      const idx = this._features.findIndex(f => f.id === featureId)
      if (idx !== -1) this._features[idx] = updated

      this._sendFeaturesToWebview()
      if (this._currentEditingFeatureId === featureId) {
        await this._sendFeatureContent(featureId)
      }
    } finally {
      this._migrating = false
    }
  }

  private async _startWithAI(
    agent?: 'claude' | 'codex' | 'opencode',
    permissionMode?: 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions'
  ): Promise<void> {
    // Find the currently editing feature
    const feature = this._features.find(f => f.id === this._currentEditingFeatureId)
    if (!feature) {
      vscode.window.showErrorMessage('No feature selected')
      return
    }

    // Parse title from the first # heading in content
    const titleMatch = feature.content.match(/^#\s+(.+)$/m)
    const title = titleMatch ? titleMatch[1].trim() : getTitleFromContent(feature.content)

    const labels = feature.labels.length > 0 ? ` [${feature.labels.join(', ')}]` : ''
    const description = feature.content.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()
    const shortDesc = description.length > 200 ? description.substring(0, 200) + '...' : description

    const prompt = `Implement this feature: "${title}" (${feature.priority} priority)${labels}. ${shortDesc} See full details in: ${feature.filePath}`

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
    this._sendFeaturesToWebview()
  }

  private _getColumns(): KanbanColumn[] {
    const sdk = this._getSDK()
    if (!sdk) return [...DEFAULT_CONFIG.boards.default.columns]
    return sdk.listColumns(this._currentBoardId)
  }

  private _sendFeaturesToWebview(): void {
    const sdk = this._getSDK()
    const columns = sdk ? sdk.listColumns(this._currentBoardId) : [...DEFAULT_CONFIG.boards.default.columns]
    const settings = sdk ? sdk.getSettings() : configToSettings(DEFAULT_CONFIG)
    const boards = sdk ? sdk.listBoards() : []
    const root = this._getWorkspaceRoot()
    const config = root ? readConfig(root) : DEFAULT_CONFIG
    const currentBoard = this._currentBoardId || config.defaultBoard

    // Override showBuildWithAI based on VS Code's AI feature toggle
    const aiDisabled = vscode.workspace.getConfiguration('chat').get<boolean>('disableAIFeatures', false)
    if (aiDisabled) {
      settings.showBuildWithAI = false
    }

    this._panel.webview.postMessage({
      type: 'init',
      features: this._features,
      columns,
      settings,
      boards,
      currentBoard
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
    this._sendFeaturesToWebview()
  }

  private _editColumn(columnId: string, updates: { name: string; color: string }): void {
    const sdk = this._getSDK()
    if (!sdk) return
    sdk.updateColumn(columnId, updates, this._currentBoardId)
    this._sendFeaturesToWebview()
  }

  private _removeColumn(columnId: string): void {
    const sdk = this._getSDK()
    if (!sdk) return
    const hasFeatures = this._features.some(f => f.status === columnId)
    if (hasFeatures) {
      vscode.window.showWarningMessage(`Cannot remove list "${columnId}" because it still contains features. Move or delete them first.`)
      return
    }
    const columns = sdk.listColumns()
    if (columns.length <= 1) {
      vscode.window.showWarningMessage('Cannot remove the last list.')
      return
    }
    sdk.removeColumn(columnId, this._currentBoardId)
    this._sendFeaturesToWebview()
  }
}
