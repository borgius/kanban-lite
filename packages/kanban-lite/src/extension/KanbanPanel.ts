import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { getDisplayTitleFromContent, CARD_FORMAT_VERSION, createEmptyPluginSettingsPayload } from '../shared/types'
import type {
  Card,
  KanbanColumn,
  CardFrontmatter,
  CardDisplaySettings,
  CreateCardPayload,
  LogEntry,
  PluginSettingsInstallTransportResult,
  PluginSettingsPayload,
  PluginSettingsProviderTransport,
  PluginSettingsResultMessage,
  PluginSettingsTransportAction,
  SubmitFormMessage,
} from '../shared/types'
import { serializeCard, parseCardFile } from '../sdk/parser'
import { readConfig, configToSettings, CONFIG_FILENAME, DEFAULT_CONFIG } from '../shared/config'
import type { PluginCapabilityNamespace } from '../shared/config'
import { KanbanSDK, DEFAULT_PLUGIN_SETTINGS_REDACTION, PluginSettingsOperationError, createPluginSettingsErrorPayload } from '../sdk/KanbanSDK'
import { AuthError, type AuthContext } from '../sdk/types'
import { getExtensionAuthStatus, resolveExtensionAuthContext } from './auth'
import { decorateCardsForWebview, formatCardStateWarning, performExplicitCardOpen } from './cardStateUi'


type CreateCardData = CreateCardPayload

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class KanbanPanel {
  public static readonly viewType = 'kanban-lite.panel'
  public static currentPanel: KanbanPanel | undefined
  public static serverPort: number = 2954

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
  private _tempFileWatcher: vscode.FileSystemWatcher | undefined
  private _tempFilePath: string | undefined
  private _tempFileCardId: string | undefined
  private _tempFileWriting = false
  private _cardsToWebviewVersion = 0

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
          vscode.Uri.joinPath(extensionUri, 'dist', 'standalone-webview')
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

  public refresh(): void {
    this._update()
  }

  public async reloadState(): Promise<void> {
    await this._loadCards()
    this._sendCardsToWebview()
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
    this._panel = panel
    this._extensionUri = extensionUri
    this._context = context

    // Ensure webview options are set (critical for deserialization after reload)
    this._panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(extensionUri, 'dist', 'standalone-webview')
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
          case 'bulkUpdateCard':
            await this._updateCard(message.cardId, message.updates)
            break
          case 'openCard': {
            // Clean up any SQLite temp file from a previously-opened card
            if (this._tempFileCardId && this._tempFileCardId !== message.cardId) {
              this._cleanupTempFile()
            }
            const openRoot = this._getWorkspaceRoot()
            const openCfg = openRoot ? readConfig(openRoot) : DEFAULT_CONFIG
            if (openCfg.markdownEditorMode) {
              await this._openCardInNativeEditor(message.cardId)
            } else {
              await this._openCardInWebview(message.cardId)
            }
            break
          }
          case 'saveCardContent':
            await this._saveCardContent(message.cardId, message.content, message.frontmatter)
            break
          case 'addChecklistItem':
            await this._addChecklistItem(message.cardId, message.title, message.description, message.expectedToken, message.boardId)
            break
          case 'editChecklistItem':
            await this._editChecklistItem(message.cardId, message.index, message.title, message.description, message.modifiedAt, message.boardId)
            break
          case 'deleteChecklistItem':
            await this._deleteChecklistItem(message.cardId, message.index, message.modifiedAt, message.boardId)
            break
          case 'checkChecklistItem':
            await this._checkChecklistItem(message.cardId, message.index, message.modifiedAt, message.boardId)
            break
          case 'uncheckChecklistItem':
            await this._uncheckChecklistItem(message.cardId, message.index, message.modifiedAt, message.boardId)
            break
          case 'closeCard':
            this._currentEditingCardId = null
            {
              const sdk = this._getSDK()
              if (sdk) void sdk.clearActiveCard(this._currentBoardId).catch(() => {})
            }
            this._cleanupTempFile()
            break
          case 'openFile': {
            const feat = await this._getCardForCurrentAuth(message.cardId)
            if (feat) {
              const sdk = this._getSDK()
              const localCardPath = sdk ? sdk.getLocalCardPath(feat) : feat.filePath
              if (localCardPath) {
                const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(localCardPath))
                await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside })
              } else {
                await this._openCardInTempFile(feat)
              }
            }
            break
          }
          case 'openSettings': {
            await this._postSettingsBridgePayload()
            break
          }
          case 'loadPluginSettings': {
            await this._postLoadPluginSettingsResult()
            break
          }
          case 'readPluginSettings': {
            await this._postPluginSettingsReadResult(message.capability, message.providerId)
            break
          }
          case 'selectPluginSettingsProvider': {
            await this._postPluginSettingsMutationResult('select', message.capability, message.providerId, async (sdk) => ({
              provider: await this._runWithAuth(sdk, async () => sdk.selectPluginSettingsProvider(message.capability, message.providerId)),
            }))
            break
          }
          case 'updatePluginSettingsOptions': {
            await this._postPluginSettingsMutationResult('updateOptions', message.capability, message.providerId, async (sdk) => ({
              provider: await this._runWithAuth(sdk, async () => sdk.updatePluginSettingsOptions(
                message.capability,
                message.providerId,
                message.options,
              )),
            }))
            break
          }
          case 'installPluginSettingsPackage': {
            await this._postPluginSettingsMutationResult('install', undefined, undefined, async (sdk) => ({
              install: await this._runWithAuth(sdk, () => sdk.installPluginSettingsPackage({
                packageName: message.packageName,
                scope: message.scope,
              })),
            }))
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
          case 'openMetadataFile': {
            const rawPath = message.path as string
            const workspaceRoot = this._getWorkspaceRoot()
            const resolvedPath = /^([/~]|[A-Za-z]:[/\\])/.test(rawPath)
              ? rawPath.replace(/^~/, process.env.HOME ?? '')
              : path.resolve(workspaceRoot ?? '', rawPath)
            try {
              const fileUri = vscode.Uri.file(resolvedPath)
              await vscode.workspace.fs.stat(fileUri)
              try {
                const doc = await vscode.workspace.openTextDocument(fileUri)
                await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside })
              } catch {
                await vscode.env.openExternal(fileUri)
              }
            } catch {
              vscode.window.showWarningMessage(`File not found: ${resolvedPath}`)
            }
            break
          }
          case 'downloadCard': {
              const dlCard = await this._getCardForCurrentAuth(message.cardId)
            if (!dlCard) break
            const downloadSdk = this._getSDK()
            const localCardPath = downloadSdk ? downloadSdk.getLocalCardPath(dlCard) : dlCard.filePath
            const defaultName = localCardPath ? path.basename(localCardPath) : `${dlCard.id}.md`
            const workspaceRoot = this._getWorkspaceRoot()
            const saveUri = await vscode.window.showSaveDialog({
              defaultUri: vscode.Uri.file(path.join(workspaceRoot ?? '', defaultName)),
              filters: { 'Markdown': ['md'] },
              title: 'Download card as Markdown'
            })
            if (saveUri) {
              const fileContent = localCardPath
                ? await vscode.workspace.fs.readFile(vscode.Uri.file(localCardPath))
                : Buffer.from(serializeCard(dlCard), 'utf-8')
              await vscode.workspace.fs.writeFile(saveUri, fileContent)
              vscode.window.showInformationMessage(`Card saved to ${saveUri.fsPath}`)
            }
            break
          }
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
          case 'addLog':
            await this._addLog(message.cardId, message.text, message.source, message.object, message.timestamp)
            break
          case 'clearLogs':
            await this._clearLogs(message.cardId)
            break
          case 'getLogs':
            await this._sendLogs(message.cardId)
            break
          case 'addBoardLog':
            await this._addBoardLog(message.text, message.source, message.object, message.timestamp)
            break
          case 'clearBoardLogs':
            await this._clearBoardLogs()
            break
          case 'getBoardLogs':
            await this._sendBoardLogs()
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
          case 'reorderColumns': {
            if (!this._sdk) break
            await this._runWithAuth(this._sdk, () => this._sdk!.reorderColumns(message.columnIds, message.boardId))
            this._sendCardsToWebview()
            break
          }
          case 'setMinimizedColumns': {
            if (!this._sdk) break
            await this._runWithAuth(this._sdk, () => this._sdk!.setMinimizedColumns(message.columnIds, message.boardId))
            break
          }
          case 'cleanupColumn':
            await this._cleanupColumn(message.columnId)
            break
          case 'transferCard': {
            const sdk = this._getSDK()
            if (!sdk || !this._currentBoardId || !message.toBoard) break
            const fromBoard = this._currentBoardId
            const toBoard = message.toBoard
            this._migrating = true
            try {
              await this._runWithAuth(sdk, () => sdk.transferCard(
                message.cardId,
                fromBoard,
                toBoard,
                message.targetStatus,
              ))
              // Switch to the destination board and re-open the card there
              this._currentBoardId = toBoard
              await this._loadCards()
              this._sendCardsToWebview()
              this.openCard(message.cardId)
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
            try {
              const createdBoard = await this._runWithAuth(this._sdk, () => this._sdk!.createBoard('', message.name))
              this._currentBoardId = createdBoard.id
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
            try {
              await this._runWithAuth(sdk, () => sdk.setLabel(message.name, message.definition))
              await this._loadCards()
              this._sendCardsToWebview()
              this._panel.webview.postMessage({ type: 'labelsUpdated', labels: sdk.getLabels() })
            } catch (err) {
              vscode.window.showErrorMessage(`Failed to set label: ${err}`)
            }
            break
          }
          case 'renameLabel': {
            const sdk = this._getSDK()
            if (!sdk) break
            await this._runWithAuth(sdk, () => sdk.renameLabel(message.oldName, message.newName))
            await this._loadCards()
            this._sendCardsToWebview()
            this._panel.webview.postMessage({ type: 'labelsUpdated', labels: sdk.getLabels() })
            break
          }
          case 'deleteLabel': {
            const sdk = this._getSDK()
            if (!sdk) break
            await this._runWithAuth(sdk, () => sdk.deleteLabel(message.name))
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
              await this._runWithAuth(triggerSdk, () => triggerSdk.triggerAction(cardId, action, undefined))
              await this._loadCards()
              this._sendCardsToWebview()
              if (this._currentEditingCardId === cardId) {
                await this._sendCardContent(cardId)
              }
              this._panel.webview.postMessage({ type: 'actionResult', callbackKey })
            } catch (err) {
              this._panel.webview.postMessage({ type: 'actionResult', callbackKey, error: String(err) })
            }
            break
          }
          case 'triggerBoardAction': {
            const { boardId, actionKey, callbackKey } = message
            const triggerSdk = this._getSDK()
            if (!triggerSdk) break
            try {
              await this._runWithAuth(triggerSdk, () => triggerSdk.triggerBoardAction(boardId, actionKey))
              this._panel.webview.postMessage({ type: 'boardActionResult', callbackKey })
            } catch (err) {
              this._panel.webview.postMessage({ type: 'boardActionResult', callbackKey, error: String(err) })
            }
            break
          }
          case 'submitForm': {
            const { cardId, formId, callbackKey, boardId } = message as SubmitFormMessage
            const submitSdk = this._getSDK()
            if (!submitSdk) break
            try {
              const result = await this._runWithAuth(submitSdk, () => submitSdk.submitForm({
                cardId,
                formId,
                data: (message as SubmitFormMessage).data,
                boardId: boardId ?? this._currentBoardId,
              }))
              await this._loadCards()
              this._sendCardsToWebview()
              if (this._currentEditingCardId === cardId) {
                await this._sendCardContent(cardId)
              }
              this._panel.webview.postMessage({ type: 'submitFormResult', callbackKey, result })
            } catch (err) {
              this._panel.webview.postMessage({ type: 'submitFormResult', callbackKey, error: String(err) })
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

    const sdk = this._getSDK()
    const watchGlob = sdk?.getStorageStatus().watchGlob
    if (!watchGlob) return

    // Watch for changes in the kanban directory (recursive for board/status subfolders)
    const pattern = new vscode.RelativePattern(kanbanDir, watchGlob)
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
          if (editingCard && sdk?.getLocalCardPath(editingCard) === uri.fsPath) {
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

    this._cleanupTempFile()

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
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'standalone-webview', 'index.js')
    )
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'standalone-webview', 'style.css')
    )
    const nonce = this._getNonce()

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; img-src ${webview.cspSource} data: blob:; font-src ${webview.cspSource};">
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

  private async _getAuthContext(): Promise<AuthContext> {
    return resolveExtensionAuthContext(this._context)
  }

  private async _runWithAuth<T>(sdk: KanbanSDK, fn: () => Promise<T>): Promise<T> {
    return sdk.runWithAuth(await this._getAuthContext(), fn)
  }

  private async _getPluginSettingsPayload(
    sdk: KanbanSDK | null,
    scoped = false,
  ): Promise<PluginSettingsPayload> {
    if (!sdk) {
      return createEmptyPluginSettingsPayload(DEFAULT_PLUGIN_SETTINGS_REDACTION)
    }
    if (scoped) {
      return await this._runWithAuth(sdk, async () => sdk.listPluginSettings())
    }
    return await sdk.listPluginSettings()
  }

  private async _getPluginSettingsMutationPayload(sdk: KanbanSDK): Promise<PluginSettingsPayload> {
    try {
      return await this._getPluginSettingsPayload(sdk, true)
    } catch (error) {
      if (this._shouldClearPluginSettingsMutationState(error)) {
        return createEmptyPluginSettingsPayload(DEFAULT_PLUGIN_SETTINGS_REDACTION)
      }
      throw error
    }
  }

  private _toPluginSettingsProviderTransport(
    provider: Awaited<ReturnType<KanbanSDK['getPluginSettings']>>,
  ): PluginSettingsProviderTransport | null {
    return provider ? { ...provider } : null
  }

  private _toPluginSettingsInstallTransportResult(
    result: Awaited<ReturnType<KanbanSDK['installPluginSettingsPackage']>>,
  ): PluginSettingsInstallTransportResult {
    return {
      packageName: result.packageName,
      scope: result.scope,
      command: result.command,
      stdout: result.stdout,
      stderr: result.stderr,
      message: result.message,
      redaction: result.redaction,
    }
  }

  private _toPluginSettingsErrorPayload(
    action: PluginSettingsTransportAction,
    error: unknown,
    capability?: PluginCapabilityNamespace,
    providerId?: string,
  ) {
    if (error instanceof PluginSettingsOperationError) {
      return error.payload
    }
    const fallback = {
      read: {
        code: 'plugin-settings-read-failed',
        message: 'Unable to read plugin settings.',
      },
      select: {
        code: 'plugin-settings-select-failed',
        message: 'Unable to persist the selected plugin provider.',
      },
      updateOptions: {
        code: 'plugin-settings-update-failed',
        message: 'Unable to persist plugin options.',
      },
      install: {
        code: 'plugin-settings-install-failed',
        message: 'Unable to install plugin package. In-product installs disable lifecycle scripts; install the package manually if it requires lifecycle scripts.',
      },
    } satisfies Record<PluginSettingsTransportAction, { code: string; message: string }>

    return createPluginSettingsErrorPayload({
      code: fallback[action].code,
      message: fallback[action].message,
      capability,
      providerId,
      redaction: DEFAULT_PLUGIN_SETTINGS_REDACTION,
    })
  }

  private _shouldClearPluginSettingsMutationState(error: unknown): boolean {
    if (error instanceof AuthError) {
      return true
    }
    if (!error || typeof error !== 'object') {
      return false
    }
    const category = (error as { category?: unknown }).category
    return typeof category === 'string' && category.startsWith('auth.')
  }

  private _toPluginSettingsMutationErrorResult(
    action: Exclude<PluginSettingsTransportAction, 'read'>,
    error: unknown,
    capability?: PluginCapabilityNamespace,
    providerId?: string,
  ): PluginSettingsResultMessage {
    return {
      type: 'pluginSettingsResult',
      action,
      ...(this._shouldClearPluginSettingsMutationState(error)
        ? {
            pluginSettings: createEmptyPluginSettingsPayload(DEFAULT_PLUGIN_SETTINGS_REDACTION),
            provider: null,
          }
        : {}),
      error: this._toPluginSettingsErrorPayload(action, error, capability, providerId),
    }
  }

  private _postPluginSettingsResult(message: PluginSettingsResultMessage): void {
    this._panel.webview.postMessage(message)
  }

  private async _postSettingsBridgePayload(): Promise<void> {
    const sdk = this._getSDK()
    const settings = sdk ? sdk.getSettings() : configToSettings(DEFAULT_CONFIG)
    this._panel.webview.postMessage({
      type: 'showSettings',
      settings,
      pluginSettings: createEmptyPluginSettingsPayload(DEFAULT_PLUGIN_SETTINGS_REDACTION),
    })
  }

  private async _postLoadPluginSettingsResult(): Promise<void> {
    const sdk = this._getSDK()
    try {
      this._postPluginSettingsResult({
        type: 'pluginSettingsResult',
        action: 'read',
        pluginSettings: await this._getPluginSettingsPayload(sdk, true),
      })
    } catch (error) {
      this._postPluginSettingsResult({
        type: 'pluginSettingsResult',
        action: 'read',
        pluginSettings: createEmptyPluginSettingsPayload(DEFAULT_PLUGIN_SETTINGS_REDACTION),
        provider: null,
        error: this._toPluginSettingsErrorPayload('read', error),
      })
    }
  }

  private async _postPluginSettingsReadResult(
    capability: PluginCapabilityNamespace,
    providerId: string,
  ): Promise<void> {
    const sdk = this._getSDK()

    if (!sdk) {
      this._postPluginSettingsResult({
        type: 'pluginSettingsResult',
        action: 'read',
        pluginSettings: await this._getPluginSettingsPayload(null),
        provider: null,
      })
      return
    }

    try {
      this._postPluginSettingsResult({
        type: 'pluginSettingsResult',
        action: 'read',
        pluginSettings: await this._getPluginSettingsPayload(sdk, true),
        provider: this._toPluginSettingsProviderTransport(
          await this._runWithAuth(sdk, async () => sdk.getPluginSettings(capability, providerId)),
        ),
      })
    } catch (error) {
      this._postPluginSettingsResult({
        type: 'pluginSettingsResult',
        action: 'read',
        pluginSettings: createEmptyPluginSettingsPayload(DEFAULT_PLUGIN_SETTINGS_REDACTION),
        provider: null,
        error: this._toPluginSettingsErrorPayload('read', error, capability, providerId),
      })
    }
  }

  private async _postPluginSettingsMutationResult(
    action: Exclude<PluginSettingsTransportAction, 'read'>,
    capability: PluginCapabilityNamespace | undefined,
    providerId: string | undefined,
    run: (sdk: KanbanSDK) => Promise<{
      provider?: Awaited<ReturnType<KanbanSDK['getPluginSettings']>>
      install?: Awaited<ReturnType<KanbanSDK['installPluginSettingsPackage']>>
    }>,
  ): Promise<void> {
    const sdk = this._getSDK()
    if (!sdk) {
      this._postPluginSettingsResult({
        type: 'pluginSettingsResult',
        action,
        pluginSettings: await this._getPluginSettingsPayload(null),
        provider: null,
        error: this._toPluginSettingsErrorPayload(action, null, capability, providerId),
      })
      return
    }

    try {
      const result = await run(sdk)
      this._postPluginSettingsResult({
        type: 'pluginSettingsResult',
        action,
        pluginSettings: await this._getPluginSettingsMutationPayload(sdk),
        provider: this._toPluginSettingsProviderTransport(result.provider ?? null),
        install: result.install ? this._toPluginSettingsInstallTransportResult(result.install) : undefined,
      })
    } catch (error) {
      this._postPluginSettingsResult(this._toPluginSettingsMutationErrorResult(action, error, capability, providerId))
    }
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
      this._cards = await this._runWithAuth(sdk, () => sdk.listCards(columns, this._currentBoardId))
    } catch {
      this._cards = []
    } finally {
      this._migrating = false
    }
  }

  private async _getCardForCurrentAuth(cardId: string): Promise<Card | null> {
    const sdk = this._getSDK()
    if (!sdk) {
      return this._cards.find((card) => card.id === cardId) ?? null
    }

    const card = await this._runWithAuth(sdk, () => sdk.getCard(cardId, this._currentBoardId))
    const existingIndex = this._cards.findIndex((cachedCard) => cachedCard.id === cardId)

    if (!card) {
      if (existingIndex !== -1) {
        this._cards.splice(existingIndex, 1)
      }
      return null
    }

    if (existingIndex !== -1) {
      this._cards[existingIndex] = card
    } else {
      this._cards.push(card)
    }

    return card
  }

  public triggerCreateDialog(): void {
    this._panel.webview.postMessage({ type: 'triggerCreateDialog' })
  }

  public openCard(cardId: string): void {
    const root = this._getWorkspaceRoot()
    const cfg = root ? readConfig(root) : DEFAULT_CONFIG
    if (cfg.markdownEditorMode) {
      void this._openCardInNativeEditor(cardId)
    } else {
      void this._openCardInWebview(cardId)
    }
  }

  private async _handleExplicitCardOpen(cardId: string): Promise<void> {
    const sdk = this._getSDK()
    if (!sdk) return

    const warning = await performExplicitCardOpen(
      sdk,
      (fn) => this._runWithAuth(sdk, fn),
      cardId,
      this._currentBoardId,
    )

    if (warning) {
      vscode.window.showWarningMessage(formatCardStateWarning(warning))
    }

    this._sendCardsToWebview()
  }

  private async _openCardInWebview(cardId: string): Promise<void> {
    await this._handleExplicitCardOpen(cardId)
    await this._sendCardContent(cardId)
  }

  private async _createCard(data: CreateCardData): Promise<void> {
    const sdk = this._getSDK()
    if (!sdk) {
      vscode.window.showErrorMessage('No workspace folder open')
      return
    }

    this._migrating = true
    try {
      const card = await this._runWithAuth(sdk, () => sdk.createCard({
        content: data.content,
        status: data.status,
        priority: data.priority,
        assignee: data.assignee ?? undefined,
        dueDate: data.dueDate ?? undefined,
        labels: data.labels,
        metadata: data.metadata,
        actions: data.actions,
        forms: data.forms,
        formData: data.formData,
        boardId: this._currentBoardId,
      }))
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
      const updated = await this._runWithAuth(sdk, () => sdk.moveCard(cardId, newStatus, newOrder, this._currentBoardId))
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
      await this._runWithAuth(sdk, () => sdk.deleteCard(cardId, this._currentBoardId))
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
      await this._runWithAuth(sdk, () => sdk.permanentlyDeleteCard(cardId, this._currentBoardId))
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
      await this._runWithAuth(sdk, () => sdk.purgeDeletedCards(this._currentBoardId))
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
      await this._runWithAuth(sdk, () => sdk.updateCard(cardId, { status: settings.defaultStatus }, this._currentBoardId))
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
      const updated = await this._runWithAuth(sdk, () => sdk.updateCard(cardId, updates, this._currentBoardId))
      const idx = this._cards.findIndex(f => f.id === cardId)
      if (idx !== -1) this._cards[idx] = updated
      this._sendCardsToWebview()
    } finally {
      this._migrating = false
    }
  }

  private _cleanupTempFile(): void {
    if (this._tempFileWatcher) {
      this._tempFileWatcher.dispose()
      this._tempFileWatcher = undefined
    }
    if (this._tempFilePath) {
      try { fs.unlinkSync(this._tempFilePath) } catch { /* ignore */ }
      this._tempFilePath = undefined
    }
    this._tempFileCardId = undefined
  }

  private async _openCardInTempFile(card: Card): Promise<void> {
    // Clean up any previous temp file
    this._cleanupTempFile()

    const tmpPath = path.join(os.tmpdir(), `kanban-card-${card.id}.md`)
    this._tempFileWriting = true
    try {
      fs.writeFileSync(tmpPath, serializeCard(card), 'utf-8')
    } finally {
      this._tempFileWriting = false
    }
    this._tempFilePath = tmpPath
    this._tempFileCardId = card.id

    const panelColumn = this._panel.viewColumn ?? vscode.ViewColumn.One
    const targetColumn = panelColumn === vscode.ViewColumn.One ? vscode.ViewColumn.Two : vscode.ViewColumn.Beside
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(tmpPath))
    await vscode.window.showTextDocument(doc, { viewColumn: targetColumn, preview: true })

    // Watch the temp file for changes and sync back to the DB
    let debounce: NodeJS.Timeout | undefined
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(os.tmpdir(), path.basename(tmpPath))
    )
    const handleChange = () => {
      if (this._tempFileWriting) return
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(async () => {
        const cardId = this._tempFileCardId
        const filePath = this._tempFilePath
        if (!cardId || !filePath) return
        const sdk = this._getSDK()
        if (!sdk) return
        try {
          const raw = fs.readFileSync(filePath, 'utf-8')
          const parsed = parseCardFile(raw, `${cardId}.md`)
          if (!parsed) return
          this._migrating = true
          try {
            const updated = await this._runWithAuth(sdk, () => sdk.updateCard(cardId, {
              content: parsed.content,
              status: parsed.status,
              priority: parsed.priority,
              assignee: parsed.assignee,
              dueDate: parsed.dueDate,
              labels: parsed.labels,
              metadata: parsed.metadata,
            }, this._currentBoardId))
            const idx = this._cards.findIndex(f => f.id === cardId)
            if (idx !== -1) this._cards[idx] = updated
            this._sendCardsToWebview()
            if (this._currentEditingCardId === cardId) {
              await this._sendCardContent(cardId)
            }
          } finally {
            this._migrating = false
          }
        } catch { /* ignore parse/update errors */ }
      }, 300)
    }
    watcher.onDidChange(handleChange)
    this._tempFileWatcher = watcher
  }

  private async _openCardInNativeEditor(cardId: string): Promise<void> {
    const sdk = this._getSDK()
    if (!sdk) return

    await this._handleExplicitCardOpen(cardId)

    const card = await this._getCardForCurrentAuth(cardId)
    if (!card) return

    const localCardPath = sdk?.getLocalCardPath(card)
    if (!localCardPath) {
      await this._openCardInTempFile(card)
      return
    }

    // Use a fixed column beside the panel so repeated clicks reuse the same split
    const panelColumn = this._panel.viewColumn ?? vscode.ViewColumn.One
    const targetColumn = panelColumn === vscode.ViewColumn.One ? vscode.ViewColumn.Two : vscode.ViewColumn.Beside

    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(localCardPath))
    await vscode.window.showTextDocument(doc, { viewColumn: targetColumn, preview: true })
    this._currentEditingCardId = cardId
  }

  private async _sendCardContent(cardId: string): Promise<void> {
    const card = await this._getCardForCurrentAuth(cardId)
    if (!card) {
      if (this._currentEditingCardId === cardId) {
        this._currentEditingCardId = null
      }
      return
    }

    this._currentEditingCardId = cardId
    const canShowChecklist = await this._canShowChecklist()

    this._panel.webview.postMessage({
      type: 'cardContent',
      cardId: card.id,
      content: card.content,
      frontmatter: this._buildCardFrontmatter(card, canShowChecklist),
      comments: card.comments || [],
      logs: await this._getLogsForCard(card.id)
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
      const updated = await this._runWithAuth(sdk, () => sdk.updateCard(cardId, {
        content,
        status: frontmatter.status,
        priority: frontmatter.priority,
        assignee: frontmatter.assignee,
        dueDate: frontmatter.dueDate,
        labels: frontmatter.labels,
        attachments: frontmatter.attachments,
        metadata: frontmatter.metadata,
        actions: frontmatter.actions,
        forms: frontmatter.forms,
        formData: frontmatter.formData,
      }, this._currentBoardId))
      this._lastWrittenContent = serializeCard(updated)
      const idx = this._cards.findIndex(f => f.id === cardId)
      if (idx !== -1) this._cards[idx] = updated
      this._sendCardsToWebview()
    } finally {
      this._migrating = false
    }
  }

  private async _mutateChecklistCard(
    cardId: string,
    mutate: (sdk: KanbanSDK, boardId: string | undefined) => Promise<Card>,
    boardId?: string,
  ): Promise<void> {
    const sdk = this._getSDK()
    if (!sdk) return

    this._migrating = true
    try {
      const updated = typeof (sdk as unknown as { runWithAuth?: unknown }).runWithAuth === 'function'
        ? await sdk.runWithAuth(await this._getAuthContext(), () => mutate(sdk, boardId))
        : await mutate(sdk, boardId)
      const idx = this._cards.findIndex((card) => card.id === cardId)
      if (idx !== -1) {
        this._cards[idx] = updated
      }

      this._sendCardsToWebview()
      await this._sendCardContent(cardId)
    } finally {
      this._migrating = false
    }
  }

  private async _addChecklistItem(cardId: string, title: string, description: string, expectedToken: string, boardId?: string): Promise<void> {
    await this._mutateChecklistCard(cardId, (sdk, activeBoardId) => sdk.addChecklistItem(cardId, title, description, expectedToken, activeBoardId), boardId)
  }

  private async _editChecklistItem(
    cardId: string,
    index: number,
    title: string,
    description: string,
    modifiedAt?: string,
    boardId?: string,
  ): Promise<void> {
    await this._mutateChecklistCard(
      cardId,
      (sdk, activeBoardId) => sdk.editChecklistItem(cardId, index, title, description, modifiedAt, activeBoardId),
      boardId,
    )
  }

  private async _deleteChecklistItem(
    cardId: string,
    index: number,
    modifiedAt?: string,
    boardId?: string,
  ): Promise<void> {
    await this._mutateChecklistCard(
      cardId,
      (sdk, activeBoardId) => sdk.deleteChecklistItem(cardId, index, modifiedAt, activeBoardId),
      boardId,
    )
  }

  private async _checkChecklistItem(
    cardId: string,
    index: number,
    modifiedAt?: string,
    boardId?: string,
  ): Promise<void> {
    await this._mutateChecklistCard(
      cardId,
      (sdk, activeBoardId) => sdk.checkChecklistItem(cardId, index, modifiedAt, activeBoardId),
      boardId,
    )
  }

  private async _uncheckChecklistItem(
    cardId: string,
    index: number,
    modifiedAt?: string,
    boardId?: string,
  ): Promise<void> {
    await this._mutateChecklistCard(
      cardId,
      (sdk, activeBoardId) => sdk.uncheckChecklistItem(cardId, index, modifiedAt, activeBoardId),
      boardId,
    )
  }

  private async _canShowChecklist(): Promise<boolean> {
    const sdk = this._getSDK()
    if (!sdk) return true

    try {
      return await sdk.canPerformAction('card.checklist.show', await this._getAuthContext())
    } catch {
      return false
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
        updated = await this._runWithAuth(sdk, () => sdk.addAttachment(cardId, uri.fsPath, this._currentBoardId))
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
    const sdk = this._getSDK()
    if (!sdk) return

    const card = await this._getCardForCurrentAuth(cardId)
    if (!card) return

    // Resolve attachment directory via SDK (handles both markdown and SQLite paths)
    const attachmentDir = await this._runWithAuth(sdk, () => sdk.getAttachmentDir(cardId, this._currentBoardId))
    if (!attachmentDir) {
      vscode.window.showWarningMessage('The active attachment provider does not expose a local file path to open.')
      return
    }

    const attachmentPath = path.resolve(attachmentDir, attachment)

    const ext = path.extname(attachment).toLowerCase()
    // Text-based files open as VS Code editor tabs; everything else opens externally
    // (PDF, images, etc. open via the OS default viewer or browser)
    const isTextFile = ['.json', '.txt', '.md', '.html', '.xml', '.csv', '.ts', '.js', '.py', '.yaml', '.yml', '.toml', '.log'].includes(ext)

    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(attachmentPath))
      if (isTextFile) {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(attachmentPath))
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside })
      } else {
        await vscode.env.openExternal(vscode.Uri.file(attachmentPath))
      }
    } catch {
      await vscode.env.openExternal(vscode.Uri.file(attachmentPath))
    }
  }

  private async _removeAttachment(cardId: string, attachment: string): Promise<void> {
    const sdk = this._getSDK()
    if (!sdk) return

    this._migrating = true
    try {
      const updated = await this._runWithAuth(sdk, () => sdk.removeAttachment(cardId, attachment, this._currentBoardId))
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
      const updated = await this._runWithAuth(sdk, () => sdk.addComment(cardId, author, content, this._currentBoardId))
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
      const updated = await this._runWithAuth(sdk, () => sdk.updateComment(cardId, commentId, content, this._currentBoardId))
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
      const updated = await this._runWithAuth(sdk, () => sdk.deleteComment(cardId, commentId, this._currentBoardId))
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

  private async _getLogsForCard(cardId: string): Promise<LogEntry[]> {
    const sdk = this._getSDK()
    if (!sdk) return []
    try {
      return await this._runWithAuth(sdk, () => sdk.listLogs(cardId, this._currentBoardId))
    } catch {
      return []
    }
  }

  private async _addLog(cardId: string, text: string, source?: string, object?: Record<string, unknown>, timestamp?: string): Promise<void> {
    const sdk = this._getSDK()
    if (!sdk) return
    try {
      await this._runWithAuth(sdk, () => sdk.addLog(cardId, text, { source, object, timestamp }, this._currentBoardId))
      await this._sendLogs(cardId)
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to add log: ${getErrorMessage(err)}`)
    }
  }

  private async _clearLogs(cardId: string): Promise<void> {
    const sdk = this._getSDK()
    if (!sdk) return
    try {
      await this._runWithAuth(sdk, () => sdk.clearLogs(cardId, this._currentBoardId))
      await this._sendLogs(cardId)
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to clear logs: ${getErrorMessage(err)}`)
    }
  }

  private async _sendLogs(cardId: string): Promise<void> {
    const logs = await this._getLogsForCard(cardId)
    this._panel.webview.postMessage({
      type: 'logsUpdated',
      cardId,
      logs
    })
  }

  private async _addBoardLog(text: string, source?: string, object?: Record<string, unknown>, timestamp?: string): Promise<void> {
    const sdk = this._getSDK()
    if (!sdk) return
    try {
      await this._runWithAuth(sdk, () => sdk.addBoardLog(text, { source, object, timestamp }, this._currentBoardId))
      await this._sendBoardLogs()
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to add board log: ${getErrorMessage(err)}`)
    }
  }

  private async _clearBoardLogs(): Promise<void> {
    const sdk = this._getSDK()
    if (!sdk) return
    try {
      await this._runWithAuth(sdk, () => sdk.clearBoardLogs(this._currentBoardId))
      await this._sendBoardLogs()
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to clear board logs: ${getErrorMessage(err)}`)
    }
  }

  private async _sendBoardLogs(): Promise<void> {
    const sdk = this._getSDK()
    if (!sdk) return
    const boardId = this._currentBoardId ?? ''
    try {
      const logs = await sdk.listBoardLogs(this._currentBoardId)
      this._panel.webview.postMessage({ type: 'boardLogsUpdated', boardId, logs })
    } catch {
      this._panel.webview.postMessage({ type: 'boardLogsUpdated', boardId, logs: [] })
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

    const aiRoot = this._getWorkspaceRoot()
    const aiConfig = aiRoot ? readConfig(aiRoot) : DEFAULT_CONFIG
    const activeBoardId = this._currentBoardId || aiConfig.defaultBoard
    const titleFields = aiConfig.boards[activeBoardId]?.title
    const title = getDisplayTitleFromContent(card.content, card.metadata, titleFields)

    const labels = card.labels.length > 0 ? ` [${card.labels.join(', ')}]` : ''
    const description = card.content.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()
    const shortDesc = description.length > 200 ? description.substring(0, 200) + '...' : description

    const promptTarget = this._sdk?.getLocalCardPath(card) ?? `card ${card.id}`
    const prompt = `Implement this card: "${title}" (${card.priority} priority)${labels}. ${shortDesc} See full details in: ${promptTarget}`

    // Use provided agent or fall back to config
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

  private async _saveSettings(settings: CardDisplaySettings): Promise<void> {
    const sdk = this._getSDK()
    if (!sdk) return
    try {
      await this._runWithAuth(sdk, () => sdk.updateSettings(settings))
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to save settings: ${getErrorMessage(err)}`)
    }
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

    if (!sdk) {
      this._panel.webview.postMessage({
        type: 'init',
        cards: this._cards,
        columns,
        settings,
        boards,
        currentBoard,
        labels: {},
        minimizedColumnIds: []
      })
      return
    }

    const nextVersion = ++this._cardsToWebviewVersion

    void Promise.all([
      decorateCardsForWebview(sdk, (fn) => this._runWithAuth(sdk, fn), this._cards, this._currentBoardId),
      getExtensionAuthStatus(this._context, sdk),
    ]).then(([cards, authStatus]) => {
      if (nextVersion !== this._cardsToWebviewVersion) {
        return
      }

      this._panel.webview.postMessage({
        type: 'init',
        cards,
        columns,
        settings,
        boards,
        currentBoard,
        labels: sdk.getLabels(),
        minimizedColumnIds: sdk.getMinimizedColumns(this._currentBoardId),
        authStatus,
      })
    }).catch((error) => {
      if (nextVersion !== this._cardsToWebviewVersion) {
        return
      }

      vscode.window.showWarningMessage(`Failed to load card-state badges: ${error instanceof Error ? error.message : String(error)}`)
      void getExtensionAuthStatus(this._context, sdk).then((authStatus) => {
        if (nextVersion !== this._cardsToWebviewVersion) {
          return
        }

        this._panel.webview.postMessage({
          type: 'init',
          cards: this._cards,
          columns,
          settings,
          boards,
          currentBoard,
          labels: sdk.getLabels(),
          minimizedColumnIds: sdk.getMinimizedColumns(this._currentBoardId),
          authStatus,
        })
      })
    })
  }

  private async _addColumn(column: { name: string; color: string }): Promise<void> {
    const sdk = this._getSDK()
    if (!sdk) return
    try {
      await this._runWithAuth(sdk, () => sdk.addColumn({ id: '', name: column.name, color: column.color }, this._currentBoardId))
      this._sendCardsToWebview()
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to add column: ${getErrorMessage(err)}`)
    }
  }

  private async _editColumn(columnId: string, updates: { name: string; color: string }): Promise<void> {
    const sdk = this._getSDK()
    if (!sdk) return
    try {
      await this._runWithAuth(sdk, () => sdk.updateColumn(columnId, updates, this._currentBoardId))
      this._sendCardsToWebview()
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to update column: ${getErrorMessage(err)}`)
    }
  }

  private _removeColumn(columnId: string): void {
    const sdk = this._getSDK()
    if (!sdk) return
    void this._runWithAuth(sdk, () => sdk.removeColumn(columnId, this._currentBoardId)).then(() => {
      this._sendCardsToWebview()
    }).catch((err: Error) => {
      vscode.window.showWarningMessage(err.message)
    })
  }

  private async _cleanupColumn(columnId: string): Promise<void> {
    const sdk = this._getSDK()
    if (!sdk) return

    this._migrating = true
    try {
      await this._runWithAuth(sdk, () => sdk.cleanupColumn(columnId, this._currentBoardId))
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

  private _buildCardFrontmatter(card: Card, canShowChecklist = false): CardFrontmatter {
    return {
      version: card.version ?? CARD_FORMAT_VERSION,
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
      actions: card.actions,
      forms: card.forms,
      formData: card.formData,
      ...(canShowChecklist ? { tasks: card.tasks ?? [] } : {}),
    }
  }
}
