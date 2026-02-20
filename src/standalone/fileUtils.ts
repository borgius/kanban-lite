import * as fs from 'fs'
import * as path from 'path'

export function getFeatureFilePath(featuresDir: string, status: string, filename: string): string {
  if (status === 'done') {
    return path.join(featuresDir, 'done', `${filename}.md`)
  }
  return path.join(featuresDir, `${filename}.md`)
}

export function ensureStatusSubfolders(featuresDir: string): void {
  const doneDir = path.join(featuresDir, 'done')
  fs.mkdirSync(doneDir, { recursive: true })
}

export function moveFeatureFile(
  currentPath: string,
  featuresDir: string,
  newStatus: string
): string {
  const filename = path.basename(currentPath)
  const targetDir = newStatus === 'done'
    ? path.join(featuresDir, 'done')
    : featuresDir
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

  return targetPath
}

export function getStatusFromPath(filePath: string, featuresDir: string): string | null {
  const relative = path.relative(featuresDir, filePath)
  const parts = relative.split(path.sep)
  if (parts.length === 2 && parts[0] === 'done') {
    return 'done'
  }
  return null
}
