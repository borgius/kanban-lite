import * as vscode from 'vscode'
import * as path from 'path'
import { getTitleFromContent } from '../shared/types'
import type { CardStatus, Priority, KanbanColumn } from '../shared/types'
import { readConfig, CONFIG_FILENAME } from '../shared/config'
import { KanbanSDK } from '../sdk/KanbanSDK'
import { KanbanPanel } from './KanbanPanel'

interface SidebarCard {
  id: string
  title: string
  status: CardStatus
  priority: Priority
}

export class SidebarViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'kanban-lite.boardView'

  private _view?: vscode.WebviewView
  private _cards: SidebarCard[] = []
  private _fileWatcher?: vscode.FileSystemWatcher
  private _debounceTimer?: NodeJS.Timeout
  private _disposables: vscode.Disposable[] = []

  constructor(private readonly _extensionUri: vscode.Uri, private readonly _context: vscode.ExtensionContext) {
    this._setupFileWatcher()

    // Watch .kanban.json for config changes
    const workspaceFolders = vscode.workspace.workspaceFolders
    if (workspaceFolders) {
      const root = workspaceFolders[0].uri.fsPath
      const configPattern = new vscode.RelativePattern(root, CONFIG_FILENAME)
      const configWatcher = vscode.workspace.createFileSystemWatcher(configPattern)

      const handleConfigChange = () => {
        this._setupFileWatcher()
        this._refresh()
      }

      configWatcher.onDidChange(handleConfigChange, null, this._disposables)
      configWatcher.onDidCreate(handleConfigChange, null, this._disposables)
      configWatcher.onDidDelete(handleConfigChange, null, this._disposables)
      this._disposables.push(configWatcher)
    }
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView

    webviewView.webview.options = {
      enableScripts: true
    }

    webviewView.webview.onDidReceiveMessage(message => {
      switch (message.type) {
        case 'ready':
          this._refresh()
          break
        case 'openBoard':
          vscode.commands.executeCommand('kanban-lite.open')
          break
        case 'newCard':
          vscode.commands.executeCommand('kanban-lite.open')
          // Wait for the panel to be ready, then trigger create dialog
          setTimeout(() => {
            KanbanPanel.currentPanel?.triggerCreateDialog()
          }, 500)
          break
        case 'openCard':
          vscode.commands.executeCommand('kanban-lite.open')
          setTimeout(() => {
            KanbanPanel.currentPanel?.openCard(message.cardId)
          }, 500)
          break
      }
    }, null, this._disposables)

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        vscode.commands.executeCommand('kanban-lite.open')
      }
    }, null, this._disposables)

    webviewView.onDidDispose(() => {
      this._view = undefined
    })

    // Auto-open the board when the sidebar first loads
    vscode.commands.executeCommand('kanban-lite.open')

    webviewView.webview.html = this._getHtml()
  }

  public setBoardOpen(open: boolean): void {
    if (this._view) {
      this._view.webview.postMessage({ type: 'boardOpenChanged', open })
    }
  }

  public dispose(): void {
    if (this._fileWatcher) {
      this._fileWatcher.dispose()
    }
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer)
    }
    for (const d of this._disposables) {
      d.dispose()
    }
  }

  private _setupFileWatcher(): void {
    if (this._fileWatcher) {
      this._fileWatcher.dispose()
    }

    const kanbanDir = this._getKanbanDir()
    if (!kanbanDir) return

    const pattern = new vscode.RelativePattern(kanbanDir, '**/*.md')
    this._fileWatcher = vscode.workspace.createFileSystemWatcher(pattern)

    const handleChange = () => {
      if (this._debounceTimer) clearTimeout(this._debounceTimer)
      this._debounceTimer = setTimeout(() => this._refresh(), 300)
    }

    this._fileWatcher.onDidChange(handleChange, null, this._disposables)
    this._fileWatcher.onDidCreate(handleChange, null, this._disposables)
    this._fileWatcher.onDidDelete(handleChange, null, this._disposables)
  }

  private async _refresh(): Promise<void> {
    await this._loadCards()
    if (this._view) {
      this._view.webview.postMessage({
        type: 'update',
        cards: this._cards,
        columns: this._getColumns()
      })
      this._view.webview.postMessage({
        type: 'boardOpenChanged',
        open: !!KanbanPanel.currentPanel
      })
    }
  }

  private _getKanbanDir(): string | null {
    const workspaceFolders = vscode.workspace.workspaceFolders
    if (!workspaceFolders || workspaceFolders.length === 0) return null
    const root = workspaceFolders[0].uri.fsPath
    const config = readConfig(root)
    return path.join(root, config.kanbanDirectory)
  }

  private _getColumns(): KanbanColumn[] {
    const kanbanDir = this._getKanbanDir()
    if (!kanbanDir) return []
    const sdk = new KanbanSDK(kanbanDir)
    return sdk.listColumns()
  }

  private async _loadCards(): Promise<void> {
    const kanbanDir = this._getKanbanDir()
    if (!kanbanDir) {
      this._cards = []
      return
    }

    try {
      const sdk = new KanbanSDK(kanbanDir)
      const cards = await sdk.listCards()
      this._cards = cards.map(c => ({
        id: c.id,
        title: getTitleFromContent(c.content),
        status: c.status,
        priority: c.priority,
      }))
    } catch {
      this._cards = []
    }
  }

  private _getHtml(): string {
    const nonce = this._getNonce()

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <style nonce="${nonce}">
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: transparent;
      padding: 12px 14px;
    }

    .actions {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 16px;
    }

    button {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      width: 100%;
      padding: 6px 12px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      line-height: 20px;
    }

    .btn-primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .btn-primary:hover {
      background: var(--vscode-button-hoverBackground);
    }

    .btn-secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .btn-secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    .section {
      margin-bottom: 14px;
    }

    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-foreground));
      opacity: 0.8;
    }

    .section-header .total {
      font-weight: 400;
      opacity: 0.7;
    }

    .stat-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 3px 0;
      font-size: var(--vscode-font-size);
    }

    .stat-label {
      display: flex;
      align-items: center;
      gap: 7px;
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .stat-count {
      opacity: 0.7;
      font-variant-numeric: tabular-nums;
    }

    .card-list {
      list-style: none;
    }

    .card-item {
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 4px 6px;
      border-radius: 4px;
      cursor: pointer;
      font-size: var(--vscode-font-size);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .card-item:hover {
      background: var(--vscode-list-hoverBackground);
    }

    .card-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .card-title {
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .empty-state {
      color: var(--vscode-descriptionForeground);
      font-size: var(--vscode-font-size);
      font-style: italic;
      padding: 4px 0;
    }

    .separator {
      height: 1px;
      background: var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border, transparent));
      margin: 12px 0;
    }
  </style>
</head>
<body>
  <div class="actions">
    <button class="btn-primary" id="openBoard">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M14 1H2a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1zM2 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2H2zm3 4a1 1 0 0 0-1 1v6a1 1 0 0 0 2 0V5a1 1 0 0 0-1-1zm3 0a1 1 0 0 0-1 1v4a1 1 0 0 0 2 0V5a1 1 0 0 0-1-1zm3 0a1 1 0 0 0-1 1v8a1 1 0 0 0 2 0V5a1 1 0 0 0-1-1z"/></svg>
      Open Board
    </button>
    <button class="btn-secondary" id="newCard">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a.5.5 0 0 1 .5.5V7h5.5a.5.5 0 0 1 0 1H8.5v5.5a.5.5 0 0 1-1 0V8H2a.5.5 0 0 1 0-1h5.5V1.5A.5.5 0 0 1 8 1z"/></svg>
      New Card
    </button>
  </div>

  <div class="separator"></div>

  <div class="section" id="overviewSection">
    <div class="section-header">
      <span>Overview</span>
      <span class="total" id="totalCount">0 total</span>
    </div>
    <div id="statRows"></div>
  </div>

  <div class="separator"></div>

  <div id="columnSections"></div>

  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();
      let columns = [];
      let cards = [];

      document.getElementById('openBoard').addEventListener('click', () => {
        vscode.postMessage({ type: 'openBoard' });
      });
      document.getElementById('newCard').addEventListener('click', () => {
        vscode.postMessage({ type: 'newCard' });
      });

      window.addEventListener('message', e => {
        const msg = e.data;
        if (msg.type === 'update') {
          columns = msg.columns;
          cards = msg.cards;
          render();
        } else if (msg.type === 'boardOpenChanged') {
          document.getElementById('openBoard').style.display = msg.open ? 'none' : '';
        }
      });

      function render() {
        // Total count
        document.getElementById('totalCount').textContent = cards.length + ' total';

        // Stat rows
        const statRows = document.getElementById('statRows');
        statRows.innerHTML = '';
        for (const col of columns) {
          const count = cards.filter(f => f.status === col.id).length;
          const row = document.createElement('div');
          row.className = 'stat-row';
          row.innerHTML =
            '<span class="stat-label">' +
              '<span class="dot" style="background:' + col.color + '"></span>' +
              col.name +
            '</span>' +
            '<span class="stat-count">' + count + '</span>';
          statRows.appendChild(row);
        }

        // Column sections with their cards
        const sectionsContainer = document.getElementById('columnSections');
        sectionsContainer.innerHTML = '';
        for (const col of columns) {
          const colCards = cards.filter(f => f.status === col.id);
          if (colCards.length === 0) continue;

          const section = document.createElement('div');
          section.className = 'section';

          const header = document.createElement('div');
          header.className = 'section-header';
          header.innerHTML = '<span>' + escapeHtml(col.name) + '</span>';
          section.appendChild(header);

          const list = document.createElement('ul');
          list.className = 'card-list';
          for (const f of colCards) {
            const li = document.createElement('li');
            li.className = 'card-item';
            li.title = f.title;
            li.innerHTML =
              '<span class="card-dot" style="background:' + col.color + '"></span>' +
              '<span class="card-title">' + escapeHtml(f.title) + '</span>';
            li.addEventListener('click', () => {
              vscode.postMessage({ type: 'openCard', cardId: f.id });
            });
            list.appendChild(li);
          }
          section.appendChild(list);
          sectionsContainer.appendChild(section);
        }
      }

      function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
      }

      vscode.postMessage({ type: 'ready' });
    })();
  </script>
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
}
