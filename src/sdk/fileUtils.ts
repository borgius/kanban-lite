import * as path from 'path'
import * as fs from 'fs/promises'

export function getFeatureFilePath(featuresDir: string, status: string, filename: string): string {
  if (status === 'done') {
    return path.join(featuresDir, 'done', `${filename}.md`)
  }
  return path.join(featuresDir, `${filename}.md`)
}

export async function ensureDirectories(featuresDir: string): Promise<void> {
  await fs.mkdir(path.join(featuresDir, 'done'), { recursive: true })
}

export async function moveFeatureFile(
  currentPath: string,
  featuresDir: string,
  newStatus: string
): Promise<string> {
  const filename = path.basename(currentPath)
  const targetDir = newStatus === 'done'
    ? path.join(featuresDir, 'done')
    : featuresDir
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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}
