import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'

const DEFAULT_STATUS_FOLDERS = ['backlog', 'todo', 'in-progress', 'review', 'done']

export function getStatusFolders(): string[] {
  const config = vscode.workspace.getConfiguration('kanban-markdown')
  const columns = config.get<{ id: string }[]>('columns')
  if (columns && columns.length > 0) {
    return columns.map(c => c.id)
  }
  return DEFAULT_STATUS_FOLDERS
}

export function getFeatureFilePath(featuresDir: string, status: string, filename: string): string {
  return path.join(featuresDir, status, `${filename}.md`)
}

export async function ensureStatusSubfolders(featuresDir: string): Promise<void> {
  const statuses = getStatusFolders()
  for (const status of statuses) {
    await fs.promises.mkdir(path.join(featuresDir, status), { recursive: true })
  }
}

export async function moveFeatureFile(
  currentPath: string,
  featuresDir: string,
  newStatus: string
): Promise<string> {
  const filename = path.basename(currentPath)
  const targetDir = path.join(featuresDir, newStatus)
  let targetPath = path.join(targetDir, filename)

  if (currentPath === targetPath) return currentPath

  const ext = path.extname(filename)
  const base = path.basename(filename, ext)
  let counter = 1
  while (await fileExists(targetPath)) {
    targetPath = path.join(targetDir, `${base}-${counter}${ext}`)
    counter++
  }

  await fs.promises.mkdir(targetDir, { recursive: true })
  await fs.promises.rename(currentPath, targetPath)

  return targetPath
}

export function getStatusFromPath(filePath: string, featuresDir: string): string | null {
  const relative = path.relative(featuresDir, filePath)
  const parts = relative.split(path.sep)
  if (parts.length === 2) {
    return parts[0]
  }
  return null
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath)
    return true
  } catch {
    return false
  }
}
