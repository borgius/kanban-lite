import * as net from 'node:net'
import * as path from 'node:path'

import { generateKeyBetween } from 'fractional-indexing'
import * as vscode from 'vscode'

import type { Feature, FeatureStatus, Priority } from '../shared/types'
import { generateFeatureFilename } from '../shared/types'
import { readConfig, allocateCardId } from '../shared/config'
import { startServer } from '../standalone/server'
import { ensureStatusSubfolders, getFeatureFilePath } from './featureFileUtils'
import { KanbanPanel } from './KanbanPanel'
import { SidebarViewProvider } from './SidebarViewProvider'

async function createFeatureFromPrompts(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage('No workspace folder open')
    return
  }

  // Ask for title
  const title = await vscode.window.showInputBox({
    prompt: 'Feature title',
    placeHolder: 'Enter a title for the new feature'
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

  const statusMap: Record<string, FeatureStatus> = {
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
    placeHolder: 'Enter a description for the feature'
  })

  // Create the feature file
  const root = workspaceFolders[0].uri.fsPath
  const kanbanConfig = readConfig(root)
  const featuresDir = path.join(root, kanbanConfig.featuresDirectory)
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(featuresDir))
  await ensureStatusSubfolders(featuresDir, kanbanConfig.columns.map(c => c.id))

  const numericId = allocateCardId(root)
  const filename = generateFeatureFilename(numericId, title)
  const now = new Date().toISOString()

  // Build content with title as first # heading
  const content = `# ${title}${description ? '\n\n' + description : ''}`

  const feature: Feature = {
    id: String(numericId),
    status,
    priority,
    assignee: null,
    dueDate: null,
    created: now,
    modified: now,
    completedAt: status === 'done' ? now : null,
    labels: [],
    attachments: [],
    order: generateKeyBetween(null, null),
    content,
    filePath: getFeatureFilePath(featuresDir, status, filename)
  }

  const fileContent = serializeFeature(feature)
  await vscode.workspace.fs.writeFile(vscode.Uri.file(feature.filePath), new TextEncoder().encode(fileContent))

  // Open the created file
  const document = await vscode.workspace.openTextDocument(feature.filePath)
  await vscode.window.showTextDocument(document)

  vscode.window.showInformationMessage(`Created feature: ${title}`)
}

function serializeFeature(feature: Feature): string {
  const frontmatter = [
    '---',
    `id: "${feature.id}"`,
    `status: "${feature.status}"`,
    `priority: "${feature.priority}"`,
    `assignee: ${feature.assignee ? `"${feature.assignee}"` : 'null'}`,
    `dueDate: ${feature.dueDate ? `"${feature.dueDate}"` : 'null'}`,
    `created: "${feature.created}"`,
    `modified: "${feature.modified}"`,
    `completedAt: ${feature.completedAt ? `"${feature.completedAt}"` : 'null'}`,
    `labels: [${feature.labels.map(l => `"${l}"`).join(', ')}]`,
    `order: "${feature.order}"`,
    '---',
    ''
  ].join('\n')

  return frontmatter + feature.content
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
    const featuresDir = path.join(root, kanbanConfig.featuresDirectory)
    const webviewDir = path.join(context.extensionPath, 'dist', 'standalone-webview')

    findFreePort(3464).then(port => {
      standaloneServer = startServer(featuresDir, port, webviewDir)
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
    vscode.commands.registerCommand('kanban-lite.addFeature', () => {
      createFeatureFromPrompts()
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
