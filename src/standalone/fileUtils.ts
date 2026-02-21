import * as fs from 'fs'
import * as path from 'path'

export function getFeatureFilePath(featuresDir: string, status: string, filename: string): string {
  return path.join(featuresDir, status, `${filename}.md`)
}

export function ensureStatusSubfolders(featuresDir: string, statuses: string[]): void {
  for (const status of statuses) {
    fs.mkdirSync(path.join(featuresDir, status), { recursive: true })
  }
}

export function moveFeatureFile(
  currentPath: string,
  featuresDir: string,
  newStatus: string,
  attachments?: string[]
): string {
  const filename = path.basename(currentPath)
  const targetDir = path.join(featuresDir, newStatus)
  let targetPath = path.join(targetDir, filename)

  if (currentPath === targetPath) return currentPath

  const ext = path.extname(filename)
  const base = path.basename(filename, ext)
  let counter = 1
  while (fs.existsSync(targetPath)) {
    targetPath = path.join(targetDir, `${base}-${counter}${ext}`)
    counter++
  }

  fs.mkdirSync(targetDir, { recursive: true })
  fs.renameSync(currentPath, targetPath)

  if (attachments && attachments.length > 0) {
    const sourceDir = path.dirname(currentPath)
    for (const attachment of attachments) {
      const srcAttach = path.join(sourceDir, attachment)
      const destAttach = path.join(targetDir, attachment)
      try {
        if (fs.existsSync(srcAttach)) {
          fs.renameSync(srcAttach, destAttach)
        }
      } catch {
        // Best effort -- skip failed attachment moves
      }
    }
  }

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
