import * as path from 'path'
import * as fs from 'fs/promises'

/**
 * Constructs the full file path for a card markdown file.
 *
 * @param kanbanDir - The root kanban directory (e.g., `.kanban`).
 * @param status - The status subdirectory name (e.g., `backlog`, `in-progress`).
 * @param filename - The card filename without the `.md` extension.
 * @returns The absolute path to the card file, including the `.md` extension.
 */
export function getCardFilePath(kanbanDir: string, status: string, filename: string): string {
  return path.join(kanbanDir, status, `${filename}.md`)
}

/**
 * Creates the kanban directory if it does not already exist.
 *
 * @param kanbanDir - The root kanban directory path to ensure exists.
 * @returns A promise that resolves when the directory has been created or already exists.
 */
export async function ensureDirectories(kanbanDir: string): Promise<void> {
  await fs.mkdir(kanbanDir, { recursive: true })
}

/**
 * Creates subdirectories for each status column under the kanban directory.
 *
 * @param kanbanDir - The root kanban directory containing status subdirectories.
 * @param statuses - An array of status names to create as subdirectories.
 * @returns A promise that resolves when all status subdirectories have been created.
 */
export async function ensureStatusSubfolders(kanbanDir: string, statuses: string[]): Promise<void> {
  for (const status of statuses) {
    await fs.mkdir(path.join(kanbanDir, status), { recursive: true })
  }
}

/**
 * Moves a card file to a new status directory, handling name collisions by
 * appending a numeric suffix (e.g., `card-1.md`, `card-2.md`). Optionally
 * co-moves attachment files from the source directory to the target directory.
 *
 * @param currentPath - The current absolute path of the card file.
 * @param kanbanDir - The root kanban directory.
 * @param newStatus - The target status subdirectory to move the card into.
 * @param attachments - Optional array of attachment filenames to co-move alongside the card.
 * @returns A promise that resolves to the new absolute path of the moved card file.
 */
export async function moveCardFile(
  currentPath: string,
  kanbanDir: string,
  newStatus: string,
  attachments?: string[]
): Promise<string> {
  const filename = path.basename(currentPath)
  const targetDir = path.join(kanbanDir, newStatus)
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

/**
 * Renames a card file in place within its current directory.
 *
 * @param currentPath - The current absolute path of the card file.
 * @param newFilename - The new filename without the `.md` extension.
 * @returns A promise that resolves to the new absolute path of the renamed card file.
 */
export async function renameCardFile(currentPath: string, newFilename: string): Promise<string> {
  const dir = path.dirname(currentPath)
  const newPath = path.join(dir, `${newFilename}.md`)
  if (currentPath === newPath) return currentPath
  await fs.rename(currentPath, newPath)
  return newPath
}

/**
 * Extracts the status from a card's file path by examining the directory structure.
 *
 * Expects the file to be located at `{kanbanDir}/{status}/{filename}.md`. If the
 * relative path does not match this two-level structure, returns `null`.
 *
 * @param filePath - The absolute path to the card file.
 * @param kanbanDir - The root kanban directory used to compute the relative path.
 * @returns The status string extracted from the path, or `null` if the path structure is unexpected.
 */
export function getStatusFromPath(filePath: string, kanbanDir: string): string | null {
  const relative = path.relative(kanbanDir, filePath)
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
