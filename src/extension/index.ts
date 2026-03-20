import * as net from 'node:net'
import * as path from 'node:path'

import * as vscode from 'vscode'

import type { CardStatus, Priority } from '../shared/types'
import { readConfig } from '../shared/config'
import { KanbanSDK } from '../sdk/KanbanSDK'
import { startServer } from '../standalone/server'
import { AUTH_TOKEN_SECRET_KEY, resolveExtensionAuthContext } from './auth'
import { KanbanPanel } from './KanbanPanel'
import { SidebarViewProvider } from './SidebarViewProvider'

async function createCardFromPrompts(context: vscode.ExtensionContext): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage('No workspace folder open')
    return
  }

  // Ask for title
  const title = await vscode.window.showInputBox({
    prompt: 'Card title',
    placeHolder: 'Enter a title for the new card'
  })
  if (!title) return

  // Ask for status
  const statusItems: vscode.QuickPickItem[] = [
    { label: 'Backlog', description: 'Not yet planned' },
    { label: 'To Do', description: 'Planned for development' },
    { label: 'In Progress', description: 'Currently being worked on' },
    { label: 'Review', description: 'Ready for review' },
    { label: 'Done', description: 'Completed' }
  ]
  const statusPick = await vscode.window.showQuickPick(statusItems, {
    placeHolder: 'Select initial status'
  })
  if (!statusPick) return

  const statusMap: Record<string, CardStatus> = {
    'Backlog': 'backlog',
    'To Do': 'todo',
    'In Progress': 'in-progress',
    'Review': 'review',
    'Done': 'done'
  }
  const status = statusMap[statusPick.label]

  // Ask for priority
  const priorityItems: vscode.QuickPickItem[] = [
    { label: 'Critical', description: 'Urgent, needs immediate attention' },
    { label: 'High', description: 'Important, should be done soon' },
    { label: 'Medium', description: 'Normal priority' },
    { label: 'Low', description: 'Nice to have, can wait' }
  ]
  const priorityPick = await vscode.window.showQuickPick(priorityItems, {
    placeHolder: 'Select priority'
  })
  if (!priorityPick) return

  const priority = priorityPick.label.toLowerCase() as Priority

  // Ask for description (optional)
  const description = await vscode.window.showInputBox({
    prompt: 'Description (optional)',
    placeHolder: 'Enter a description for the card'
  })

  // Create the card via SDK
  const root = workspaceFolders[0].uri.fsPath
  const kanbanConfig = readConfig(root)
  const kanbanDir = path.join(root, kanbanConfig.kanbanDirectory)
  const sdk = new KanbanSDK(kanbanDir)

  const content = `# ${title}${description ? '\n\n' + description : ''}`
  const card = await sdk.createCard({ content, status, priority }, await resolveExtensionAuthContext(context))

  const localCardPath = sdk.getLocalCardPath(card)
  if (localCardPath) {
    const document = await vscode.workspace.openTextDocument(localCardPath)
    await vscode.window.showTextDocument(document)
  }

  vscode.window.showInformationMessage(`Created card: ${title}`)
}

let standaloneServer: ReturnType<typeof startServer> | undefined
let statusBarItem: vscode.StatusBarItem | undefined

function findFreePort(startPort: number, maxAttempts = 10): Promise<number> {
  return new Promise((resolve, reject) => {
    let attempt = 0
    function tryPort(port: number) {
      const server = net.createServer()
      server.once('error', () => {
        attempt++
        if (attempt >= maxAttempts) {
          reject(new Error('No free port found'))
        } else {
          tryPort(port + 1)
        }
      })
      server.once('listening', () => {
        server.close(() => resolve(port))
      })
      server.listen(port)
    }
    tryPort(startPort)
  })
}

export function activate(context: vscode.ExtensionContext) {
  // Start standalone HTTP server so the board is accessible in a browser
  const workspaceFolders = vscode.workspace.workspaceFolders
  if (workspaceFolders) {
    const root = workspaceFolders[0].uri.fsPath
    const kanbanConfig = readConfig(root)
    const kanbanDir = path.join(root, kanbanConfig.kanbanDirectory)
    const webviewDir = path.join(context.extensionPath, 'dist', 'standalone-webview')

    // Set port synchronously so panels created before the server starts use the right port
    KanbanPanel.serverPort = kanbanConfig.port

    findFreePort(kanbanConfig.port).then(port => {
      if (port !== kanbanConfig.port) {
        // Configured port was busy; update and refresh any already-open panel
        KanbanPanel.serverPort = port
        KanbanPanel.currentPanel?.refresh()
      }
      standaloneServer = startServer(kanbanDir, port, webviewDir)
      standaloneServer.on('error', () => {
        standaloneServer = undefined
      })

      statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50)
      statusBarItem.text = `kanban:${port}`
      statusBarItem.tooltip = `Kanban board running at http://localhost:${port}`
      statusBarItem.command = {
        title: 'Open Kanban in Browser',
        command: 'vscode.open',
        arguments: [vscode.Uri.parse(`http://localhost:${port}`)]
      }
      statusBarItem.show()
      context.subscriptions.push(statusBarItem)
    }).catch(() => {
      // No free port found — non-critical, skip
    })
  }

  // Sidebar webview in the activity bar
  const sidebarProvider = new SidebarViewProvider(context.extensionUri, context)
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarViewProvider.viewType, sidebarProvider)
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('kanban-lite.open', () => {
      const wasOpen = !!KanbanPanel.currentPanel
      KanbanPanel.createOrShow(context.extensionUri, context)
      if (!wasOpen && KanbanPanel.currentPanel) {
        sidebarProvider.setBoardOpen(true)
        KanbanPanel.currentPanel.onDispose(() => {
          sidebarProvider.setBoardOpen(false)
        })
      }
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('kanban-lite.addCard', () => {
      createCardFromPrompts(context)
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('kanban-lite.setAuthToken', async () => {
      const token = await vscode.window.showInputBox({
        prompt: 'Kanban auth token',
        placeHolder: 'Paste a bearer token for extension-host SDK calls',
        password: true,
        ignoreFocusOut: true,
      })
      if (!token) return
      await context.secrets.store(AUTH_TOKEN_SECRET_KEY, token)
      await KanbanPanel.currentPanel?.reloadState()
      vscode.window.showInformationMessage('Kanban auth token saved securely in VS Code.')
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('kanban-lite.clearAuthToken', async () => {
      await context.secrets.delete(AUTH_TOKEN_SECRET_KEY)
      await KanbanPanel.currentPanel?.reloadState()
      vscode.window.showInformationMessage('Kanban auth token cleared from VS Code secure storage.')
    })
  )

  // If a panel already exists, revive it
  if (vscode.window.registerWebviewPanelSerializer) {
    vscode.window.registerWebviewPanelSerializer(KanbanPanel.viewType, {
      async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel) {
        KanbanPanel.revive(webviewPanel, context.extensionUri, context)
        sidebarProvider.setBoardOpen(true)
        KanbanPanel.currentPanel?.onDispose(() => {
          sidebarProvider.setBoardOpen(false)
        })
      }
    })
  }
}

export function deactivate() {
  if (standaloneServer) {
    standaloneServer.close()
    standaloneServer = undefined
  }
  if (statusBarItem) {
    statusBarItem.dispose()
    statusBarItem = undefined
  }
}
