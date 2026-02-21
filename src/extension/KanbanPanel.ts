import * as vscode from 'vscode'
import * as path from 'path'
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'
import { getTitleFromContent, generateFeatureFilename, extractNumericId } from '../shared/types'
import type { Feature, FeatureStatus, Priority, KanbanColumn, FeatureFrontmatter, CardDisplaySettings } from '../shared/types'
import { parseFeatureFile, serializeFeature } from '../sdk/parser'
import { ensureStatusSubfolders, moveFeatureFile, renameFeatureFile, getFeatureFilePath, getStatusFromPath } from './featureFileUtils'
import { readConfig, writeConfig, configToSettings, settingsToConfig, allocateCardId, syncCardIdCounter, CONFIG_FILENAME, DEFAULT_CONFIG } from '../shared/config'


interface CreateFeatureData {
  status: FeatureStatus
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
  private _lastWrittenContent: string = ''
  private _migrating = false
  private _onDisposeCallbacks: (() => void)[] = []

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

    // Watch for changes in the features directory (recursive for status subfolders)
    const pattern = new vscode.RelativePattern(featuresDir, '**/*.md')
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
            const currentContent = this._serializeFeature(editingFeature)
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

  private async _ensureFeaturesDir(): Promise<string | null> {
    const featuresDir = this._getWorkspaceFeaturesDir()
    if (!featuresDir) return null

    try {
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(featuresDir))
      const columnIds = this._getColumns().map(c => c.id)
      await ensureStatusSubfolders(featuresDir, columnIds)
      return featuresDir
    } catch {
      return null
    }
  }

  private async _loadFeatures(): Promise<void> {
    const featuresDir = this._getWorkspaceFeaturesDir()
    if (!featuresDir) {
      this._features = []
      return
    }

    try {
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(featuresDir))
      const columnIds = this._getColumns().map(c => c.id)
      await ensureStatusSubfolders(featuresDir, columnIds)

      // Phase 1: Migrate flat root .md files into their status subfolder
      this._migrating = true
      try {
        const rootEntries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(featuresDir))
        for (const [name, type] of rootEntries) {
          if (type !== vscode.FileType.File || !name.endsWith('.md')) continue
          const filePath = path.join(featuresDir, name)
          try {
            const content = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.file(filePath)))
            const feature = this._parseFeatureFile(content, filePath)
            if (feature) {
              await moveFeatureFile(filePath, featuresDir, feature.status, feature.attachments)
            }
          } catch {
            // Skip files that fail to migrate
          }
        }
      } finally {
        this._migrating = false
      }

      // Phase 2: Load .md files from ALL subdirectories
      const features: Feature[] = []
      const topEntries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(featuresDir))
      for (const [name, type] of topEntries) {
        if (type !== vscode.FileType.Directory || name.startsWith('.')) continue
        const subdir = path.join(featuresDir, name)
        try {
          const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(subdir))
          for (const [file, fileType] of entries) {
            if (fileType !== vscode.FileType.File || !file.endsWith('.md')) continue
            const filePath = path.join(subdir, file)
            const content = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.file(filePath)))
            const feature = this._parseFeatureFile(content, filePath)
            if (feature) features.push(feature)
          }
        } catch {
          // Skip unreadable directories
        }
      }

      // Phase 3: Reconcile status ↔ folder mismatches
      this._migrating = true
      try {
        for (const feature of features) {
          const pathStatus = getStatusFromPath(feature.filePath, featuresDir)
          if (pathStatus !== null && pathStatus !== feature.status) {
            try {
              const newPath = await moveFeatureFile(feature.filePath, featuresDir, feature.status, feature.attachments)
              feature.filePath = newPath
            } catch {
              // Will retry on next load
            }
          }
        }
      } finally {
        this._migrating = false
      }

      // Migrate legacy integer order values to fractional indices
      const hasLegacyOrder = features.some(f => /^\d+$/.test(f.order))
      if (hasLegacyOrder) {
        const byStatus = new Map<string, Feature[]>()
        for (const f of features) {
          const list = byStatus.get(f.status) || []
          list.push(f)
          byStatus.set(f.status, list)
        }

        const migrationWrites: Feature[] = []
        for (const columnFeatures of byStatus.values()) {
          columnFeatures.sort((a, b) => parseInt(a.order) - parseInt(b.order))
          const keys = generateNKeysBetween(null, null, columnFeatures.length)
          for (let i = 0; i < columnFeatures.length; i++) {
            columnFeatures[i].order = keys[i]
            migrationWrites.push(columnFeatures[i])
          }
        }

        for (const f of migrationWrites) {
          const content = this._serializeFeature(f)
          await vscode.workspace.fs.writeFile(vscode.Uri.file(f.filePath), new TextEncoder().encode(content))
        }
      }

      // Sync ID counter with existing cards
      const root = this._getWorkspaceRoot()
      if (root) {
        const numericIds = features
          .map(f => parseInt(f.id, 10))
          .filter(n => !Number.isNaN(n))
        if (numericIds.length > 0) {
          syncCardIdCounter(root, numericIds)
        }
      }

      this._features = features.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
    } catch {
      this._features = []
    }
  }

  private _parseFeatureFile(content: string, filePath: string): Feature | null {
    return parseFeatureFile(content, filePath)
  }

  private _serializeFeature(feature: Feature): string {
    return serializeFeature(feature)
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
    const featuresDir = await this._ensureFeaturesDir()
    if (!featuresDir) {
      vscode.window.showErrorMessage('No workspace folder open')
      return
    }

    const title = getTitleFromContent(data.content)
    const workspaceRoot = this._getWorkspaceRoot()
    if (!workspaceRoot) return
    const numericId = allocateCardId(workspaceRoot)
    const filename = generateFeatureFilename(numericId, title)
    const now = new Date().toISOString()
    const featuresInStatus = this._features
      .filter(f => f.status === data.status)
      .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
    const lastOrder = featuresInStatus.length > 0 ? featuresInStatus[featuresInStatus.length - 1].order : null

    const feature: Feature = {
      id: String(numericId),
      status: data.status,
      priority: data.priority,
      assignee: data.assignee,
      dueDate: data.dueDate,
      created: now,
      modified: now,
      completedAt: data.status === 'done' ? now : null,
      labels: data.labels,
      attachments: [],
      order: generateKeyBetween(lastOrder, null),
      content: data.content,
      filePath: getFeatureFilePath(featuresDir, data.status, filename)
    }

    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(feature.filePath)))
    const content = this._serializeFeature(feature)
    await vscode.workspace.fs.writeFile(vscode.Uri.file(feature.filePath), new TextEncoder().encode(content))

    this._features.push(feature)
    this._sendFeaturesToWebview()
  }

  private async _moveFeature(featureId: string, newStatus: string, newOrder: number): Promise<void> {
    const feature = this._features.find(f => f.id === featureId)
    if (!feature) return

    const featuresDir = this._getWorkspaceFeaturesDir()
    if (!featuresDir) return

    const oldStatus = feature.status
    const statusChanged = oldStatus !== newStatus

    // Update feature status
    feature.status = newStatus as FeatureStatus
    feature.modified = new Date().toISOString()
    if (statusChanged) {
      feature.completedAt = newStatus === 'done' ? new Date().toISOString() : null
    }

    // Get sorted features in the target column (excluding the moved feature)
    const targetColumnFeatures = this._features
      .filter(f => f.status === newStatus && f.id !== featureId)
      .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))

    // Compute fractional index between neighbors at the target position
    const clampedOrder = Math.max(0, Math.min(newOrder, targetColumnFeatures.length))
    const before = clampedOrder > 0 ? targetColumnFeatures[clampedOrder - 1].order : null
    const after = clampedOrder < targetColumnFeatures.length ? targetColumnFeatures[clampedOrder].order : null
    feature.order = generateKeyBetween(before, after)

    // Only the moved feature needs to be written
    const content = this._serializeFeature(feature)
    await vscode.workspace.fs.writeFile(vscode.Uri.file(feature.filePath), new TextEncoder().encode(content))

    // Move file when status changes
    if (statusChanged) {
      this._migrating = true
      try {
        const newPath = await moveFeatureFile(feature.filePath, featuresDir, newStatus, feature.attachments)
        feature.filePath = newPath
      } catch {
        // Move failed; file stays in old folder, will reconcile on next load
      } finally {
        this._migrating = false
      }
    }

    this._sendFeaturesToWebview()
  }

  private async _deleteFeature(featureId: string): Promise<void> {
    const feature = this._features.find(f => f.id === featureId)
    if (!feature) return

    try {
      await vscode.workspace.fs.delete(vscode.Uri.file(feature.filePath))
      this._features = this._features.filter(f => f.id !== featureId)
      this._sendFeaturesToWebview()
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to delete feature: ${err}`)
    }
  }

  private async _updateFeature(featureId: string, updates: Partial<Feature>): Promise<void> {
    const feature = this._features.find(f => f.id === featureId)
    if (!feature) return

    const featuresDir = this._getWorkspaceFeaturesDir()
    if (!featuresDir) return

    const oldStatus = feature.status
    const oldTitle = getTitleFromContent(feature.content)

    // Merge updates
    Object.assign(feature, updates)
    feature.modified = new Date().toISOString()
    if (oldStatus !== feature.status) {
      feature.completedAt = feature.status === 'done' ? new Date().toISOString() : null
    }

    // Persist to file
    const content = this._serializeFeature(feature)
    await vscode.workspace.fs.writeFile(vscode.Uri.file(feature.filePath), new TextEncoder().encode(content))

    // Rename file if title changed (numeric-ID cards only)
    const newTitle = getTitleFromContent(feature.content)
    const numId = extractNumericId(feature.id)
    if (numId !== null && newTitle !== oldTitle) {
      const newFilename = generateFeatureFilename(numId, newTitle)
      this._migrating = true
      try {
        feature.filePath = await renameFeatureFile(feature.filePath, newFilename)
      } catch { /* retry next load */ } finally { this._migrating = false }
    }

    // Move file when status changes
    if (oldStatus !== feature.status) {
      this._migrating = true
      try {
        const newPath = await moveFeatureFile(feature.filePath, featuresDir, feature.status, feature.attachments)
        feature.filePath = newPath
      } catch {
        // Move failed; file stays in old folder, will reconcile on next load
      } finally {
        this._migrating = false
      }
    }

    this._sendFeaturesToWebview()
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
      frontmatter
    })
  }

  private async _saveFeatureContent(
    featureId: string,
    content: string,
    frontmatter: FeatureFrontmatter
  ): Promise<void> {
    const feature = this._features.find(f => f.id === featureId)
    if (!feature) return

    const featuresDir = this._getWorkspaceFeaturesDir()
    if (!featuresDir) return

    const oldStatus = feature.status
    const oldTitle = getTitleFromContent(feature.content)

    // Update feature in memory
    feature.content = content
    feature.status = frontmatter.status
    feature.priority = frontmatter.priority
    feature.assignee = frontmatter.assignee
    feature.dueDate = frontmatter.dueDate
    feature.labels = frontmatter.labels
    feature.attachments = frontmatter.attachments || feature.attachments || []
    feature.modified = new Date().toISOString()
    if (oldStatus !== feature.status) {
      feature.completedAt = feature.status === 'done' ? new Date().toISOString() : null
    }

    // Save to file
    const fileContent = this._serializeFeature(feature)
    this._lastWrittenContent = fileContent
    await vscode.workspace.fs.writeFile(vscode.Uri.file(feature.filePath), new TextEncoder().encode(fileContent))

    // Rename file if title changed (numeric-ID cards only)
    const saveNewTitle = getTitleFromContent(feature.content)
    const saveNumId = extractNumericId(feature.id)
    if (saveNumId !== null && saveNewTitle !== oldTitle) {
      const newFilename = generateFeatureFilename(saveNumId, saveNewTitle)
      this._migrating = true
      try {
        feature.filePath = await renameFeatureFile(feature.filePath, newFilename)
      } catch { /* retry next load */ } finally { this._migrating = false }
    }

    // Move file when status changes
    if (oldStatus !== feature.status) {
      this._migrating = true
      try {
        const newPath = await moveFeatureFile(feature.filePath, featuresDir, feature.status, feature.attachments)
        feature.filePath = newPath
      } catch {
        // Move failed; file stays in old folder, will reconcile on next load
      } finally {
        this._migrating = false
      }
    }

    // Update all features in webview
    this._sendFeaturesToWebview()
  }

  private async _addAttachment(featureId: string): Promise<void> {
    const feature = this._features.find(f => f.id === featureId)
    if (!feature) return

    const uris = await vscode.window.showOpenDialog({
      canSelectMany: true,
      openLabel: 'Attach',
      title: 'Select files to attach'
    })
    if (!uris || uris.length === 0) return

    const featureDir = path.dirname(feature.filePath)

    for (const uri of uris) {
      const fileName = path.basename(uri.fsPath)
      const destPath = path.join(featureDir, fileName)

      // If file is not already in the feature directory, copy it
      if (path.dirname(uri.fsPath) !== featureDir) {
        await vscode.workspace.fs.copy(uri, vscode.Uri.file(destPath), { overwrite: true })
      }

      // Add to attachments if not already present
      if (!feature.attachments.includes(fileName)) {
        feature.attachments.push(fileName)
      }
    }

    feature.modified = new Date().toISOString()
    const fileContent = this._serializeFeature(feature)
    this._lastWrittenContent = fileContent
    await vscode.workspace.fs.writeFile(vscode.Uri.file(feature.filePath), new TextEncoder().encode(fileContent))

    this._sendFeaturesToWebview()
    // Refresh the editor with updated frontmatter
    if (this._currentEditingFeatureId === featureId) {
      await this._sendFeatureContent(featureId)
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
    const feature = this._features.find(f => f.id === featureId)
    if (!feature) return

    feature.attachments = feature.attachments.filter(a => a !== attachment)
    feature.modified = new Date().toISOString()

    const fileContent = this._serializeFeature(feature)
    this._lastWrittenContent = fileContent
    await vscode.workspace.fs.writeFile(vscode.Uri.file(feature.filePath), new TextEncoder().encode(fileContent))

    this._sendFeaturesToWebview()
    if (this._currentEditingFeatureId === featureId) {
      await this._sendFeatureContent(featureId)
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
    const root = this._getWorkspaceRoot()
    if (!root) return
    const config = readConfig(root)
    const updated = settingsToConfig(config, settings)
    writeConfig(root, updated)
    this._sendFeaturesToWebview()
  }

  private _getColumns(): KanbanColumn[] {
    const root = this._getWorkspaceRoot()
    if (!root) return [...DEFAULT_CONFIG.columns]
    const config = readConfig(root)
    return config.columns.map(c => ({ ...c }))
  }

  private _saveColumns(columns: KanbanColumn[]): void {
    const root = this._getWorkspaceRoot()
    if (!root) return
    const config = readConfig(root)
    config.columns = columns
    writeConfig(root, config)
    this._sendFeaturesToWebviewWithColumns(columns)
  }

  private _sendFeaturesToWebviewWithColumns(columns: KanbanColumn[]): void {
    const root = this._getWorkspaceRoot()
    const config = root ? readConfig(root) : { ...DEFAULT_CONFIG }
    const settings = configToSettings(config)

    // Override showBuildWithAI based on VS Code's AI feature toggle
    const aiDisabled = vscode.workspace.getConfiguration('chat').get<boolean>('disableAIFeatures', false)
    if (aiDisabled) {
      settings.showBuildWithAI = false
    }

    this._panel.webview.postMessage({
      type: 'init',
      features: this._features,
      columns,
      settings
    })
  }

  private async _addColumn(column: { name: string; color: string }): Promise<void> {
    const columns = this._getColumns()
    const id = column.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    let uniqueId = id
    let counter = 1
    while (columns.some(c => c.id === uniqueId)) {
      uniqueId = `${id}-${counter++}`
    }
    columns.push({ id: uniqueId, name: column.name, color: column.color })
    await this._saveColumns(columns)
  }

  private async _editColumn(columnId: string, updates: { name: string; color: string }): Promise<void> {
    const columns = this._getColumns()
    if (!columns.some(c => c.id === columnId)) return
    const updatedColumns = columns.map(c =>
      c.id === columnId ? { ...c, name: updates.name, color: updates.color } : c
    )
    await this._saveColumns(updatedColumns)
  }

  private async _removeColumn(columnId: string): Promise<void> {
    const columns = this._getColumns()
    const hasFeatures = this._features.some(f => f.status === columnId)
    if (hasFeatures) {
      vscode.window.showWarningMessage(`Cannot remove list "${columnId}" because it still contains features. Move or delete them first.`)
      return
    }
    const updated = columns.filter(c => c.id !== columnId)
    if (updated.length === 0) {
      vscode.window.showWarningMessage('Cannot remove the last list.')
      return
    }
    await this._saveColumns(updated)
  }

  private _sendFeaturesToWebview(): void {
    this._sendFeaturesToWebviewWithColumns(this._getColumns())
  }
}
