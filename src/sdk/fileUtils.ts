import * as path from 'path'
import * as fs from 'fs/promises'

export function getFeatureFilePath(featuresDir: string, status: string, filename: string): string {
  return path.join(featuresDir, status, `${filename}.md`)
}

export async function ensureDirectories(featuresDir: string): Promise<void> {
  await fs.mkdir(featuresDir, { recursive: true })
}

export async function ensureStatusSubfolders(featuresDir: string, statuses: string[]): Promise<void> {
  for (const status of statuses) {
    await fs.mkdir(path.join(featuresDir, status), { recursive: true })
  }
}

export async function moveFeatureFile(
  currentPath: string,
  featuresDir: string,
  newStatus: string,
  attachments?: string[]
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

  await fs.mkdir(targetDir, { recursive: true })
  await fs.rename(currentPath, targetPath)

  if (attachments && attachments.length > 0) {
    const sourceDir = path.dirname(currentPath)
    for (const attachment of attachments) {
      const srcAttach = path.join(sourceDir, attachment)
      const destAttach = path.join(targetDir, attachment)
      try {
        await fs.access(srcAttach)
        await fs.rename(srcAttach, destAttach)
      } catch {
        // Best effort -- skip failed attachment moves
      }
    }
  }

  return targetPath
}

export async function renameFeatureFile(currentPath: string, newFilename: string): Promise<string> {
  const dir = path.dirname(currentPath)
  const newPath = path.join(dir, `${newFilename}.md`)
  if (currentPath === newPath) return currentPath
  await fs.rename(currentPath, newPath)
  return newPath
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
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}
