import * as fs from 'fs/promises'
import * as path from 'path'

/**
 * Migrate a v1 single-board file system layout to v2 multi-board layout.
 * Moves status subdirectories from .kanban/{status}/ into .kanban/boards/default/{status}/.
 * Idempotent: if boards/ already exists, this is a no-op.
 */
export async function migrateFileSystemToMultiBoard(kanbanDir: string): Promise<void> {
  const boardsDir = path.join(kanbanDir, 'boards')
  const defaultBoardDir = path.join(boardsDir, 'default')

  // Check if already migrated
  try {
    await fs.access(boardsDir)
    return // boards/ already exists, skip
  } catch {
    // Not yet migrated, proceed
  }

  await fs.mkdir(defaultBoardDir, { recursive: true })

  let entries: import('fs').Dirent[]
  try {
    entries = await fs.readdir(kanbanDir, { withFileTypes: true }) as import('fs').Dirent[]
  } catch {
    return // kanbanDir doesn't exist yet
  }

  // Move each subdirectory that looks like a status folder
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name === 'boards' || entry.name.startsWith('.')) continue

    const src = path.join(kanbanDir, entry.name)
    const dest = path.join(defaultBoardDir, entry.name)
    await fs.rename(src, dest)
  }

  // Move any root-level .md files into default/backlog/
  const rootMdFiles = entries.filter(e => e.isFile() && e.name.endsWith('.md'))
  if (rootMdFiles.length > 0) {
    const backlogDir = path.join(defaultBoardDir, 'backlog')
    await fs.mkdir(backlogDir, { recursive: true })
    for (const file of rootMdFiles) {
      await fs.rename(
        path.join(kanbanDir, file.name),
        path.join(backlogDir, file.name)
      )
    }
  }
}
