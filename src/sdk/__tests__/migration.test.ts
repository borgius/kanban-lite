import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrateFileSystemToMultiBoard } from '../migration'
import { readConfig } from '../../shared/config'
import { DEFAULT_COLUMNS } from '../../shared/types'

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-migration-test-'))
}

describe('migrateFileSystemToMultiBoard', () => {
  let workspaceDir: string
  let kanbanDir: string

  beforeEach(() => {
    workspaceDir = createTempDir()
    kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('should create boards/default/ and move status subdirs into it', async () => {
    // Create v1-style status directories with card files
    const backlogDir = path.join(kanbanDir, 'backlog')
    const todoDir = path.join(kanbanDir, 'todo')
    const doneDir = path.join(kanbanDir, 'done')
    fs.mkdirSync(backlogDir, { recursive: true })
    fs.mkdirSync(todoDir, { recursive: true })
    fs.mkdirSync(doneDir, { recursive: true })
    fs.writeFileSync(path.join(backlogDir, 'card1.md'), '# Card 1', 'utf-8')
    fs.writeFileSync(path.join(todoDir, 'card2.md'), '# Card 2', 'utf-8')
    fs.writeFileSync(path.join(doneDir, 'card3.md'), '# Card 3', 'utf-8')

    await migrateFileSystemToMultiBoard(kanbanDir)

    // Verify boards/default/ was created
    expect(fs.existsSync(path.join(kanbanDir, 'boards', 'default'))).toBe(true)

    // Verify status dirs were moved into boards/default/
    expect(fs.existsSync(path.join(kanbanDir, 'boards', 'default', 'backlog', 'card1.md'))).toBe(true)
    expect(fs.existsSync(path.join(kanbanDir, 'boards', 'default', 'todo', 'card2.md'))).toBe(true)
    expect(fs.existsSync(path.join(kanbanDir, 'boards', 'default', 'done', 'card3.md'))).toBe(true)

    // Verify old dirs no longer exist at root level
    expect(fs.existsSync(path.join(kanbanDir, 'backlog'))).toBe(false)
    expect(fs.existsSync(path.join(kanbanDir, 'todo'))).toBe(false)
    expect(fs.existsSync(path.join(kanbanDir, 'done'))).toBe(false)
  })

  it('should move root .md files into boards/default/backlog/', async () => {
    // Create root-level markdown files (orphaned cards)
    fs.writeFileSync(path.join(kanbanDir, 'orphan1.md'), '# Orphan 1', 'utf-8')
    fs.writeFileSync(path.join(kanbanDir, 'orphan2.md'), '# Orphan 2', 'utf-8')
    // Also a non-md file that should not be moved
    fs.writeFileSync(path.join(kanbanDir, 'board.json'), '{}', 'utf-8')

    await migrateFileSystemToMultiBoard(kanbanDir)

    // .md files should be moved to boards/default/backlog/
    expect(fs.existsSync(path.join(kanbanDir, 'boards', 'default', 'backlog', 'orphan1.md'))).toBe(true)
    expect(fs.existsSync(path.join(kanbanDir, 'boards', 'default', 'backlog', 'orphan2.md'))).toBe(true)

    // Non-md files remain at root
    expect(fs.existsSync(path.join(kanbanDir, 'board.json'))).toBe(true)

    // Root .md files should no longer exist
    expect(fs.existsSync(path.join(kanbanDir, 'orphan1.md'))).toBe(false)
    expect(fs.existsSync(path.join(kanbanDir, 'orphan2.md'))).toBe(false)
  })

  it('should be idempotent - second call is a no-op', async () => {
    // Create a status dir and a root .md file
    const backlogDir = path.join(kanbanDir, 'backlog')
    fs.mkdirSync(backlogDir, { recursive: true })
    fs.writeFileSync(path.join(backlogDir, 'card.md'), '# Card', 'utf-8')
    fs.writeFileSync(path.join(kanbanDir, 'orphan.md'), '# Orphan', 'utf-8')

    // First migration
    await migrateFileSystemToMultiBoard(kanbanDir)

    const migratedCardPath = path.join(kanbanDir, 'boards', 'default', 'backlog', 'card.md')
    const migratedOrphanPath = path.join(kanbanDir, 'boards', 'default', 'backlog', 'orphan.md')
    expect(fs.existsSync(migratedCardPath)).toBe(true)
    expect(fs.existsSync(migratedOrphanPath)).toBe(true)

    // Record content to verify it doesn't change
    const cardContent = fs.readFileSync(migratedCardPath, 'utf-8')
    const orphanContent = fs.readFileSync(migratedOrphanPath, 'utf-8')

    // Second migration should be a no-op
    await migrateFileSystemToMultiBoard(kanbanDir)

    expect(fs.existsSync(migratedCardPath)).toBe(true)
    expect(fs.existsSync(migratedOrphanPath)).toBe(true)
    expect(fs.readFileSync(migratedCardPath, 'utf-8')).toBe(cardContent)
    expect(fs.readFileSync(migratedOrphanPath, 'utf-8')).toBe(orphanContent)
  })

  it('should handle non-existent kanbanDir gracefully', async () => {
    const nonExistentDir = path.join(workspaceDir, 'nonexistent', '.kanban')

    // Should not throw
    await expect(migrateFileSystemToMultiBoard(nonExistentDir)).resolves.toBeUndefined()

    // boards/default/ gets created by mkdir({ recursive: true }) but no status dirs are moved
    // since there were none to begin with, so the default board dir should be empty
    const defaultBoardDir = path.join(nonExistentDir, 'boards', 'default')
    expect(fs.existsSync(defaultBoardDir)).toBe(true)
    const contents = fs.readdirSync(defaultBoardDir)
    expect(contents).toEqual([])
  })

  it('should skip dot-directories (e.g. .git)', async () => {
    // Create a dot-directory and a normal status directory
    const gitDir = path.join(kanbanDir, '.git')
    const backlogDir = path.join(kanbanDir, 'backlog')
    fs.mkdirSync(gitDir, { recursive: true })
    fs.mkdirSync(backlogDir, { recursive: true })
    fs.writeFileSync(path.join(gitDir, 'config'), 'git config content', 'utf-8')
    fs.writeFileSync(path.join(backlogDir, 'card.md'), '# Card', 'utf-8')

    await migrateFileSystemToMultiBoard(kanbanDir)

    // .git directory should remain at root, not moved into boards/default/
    expect(fs.existsSync(path.join(kanbanDir, '.git', 'config'))).toBe(true)
    expect(fs.existsSync(path.join(kanbanDir, 'boards', 'default', '.git'))).toBe(false)

    // backlog should be moved
    expect(fs.existsSync(path.join(kanbanDir, 'boards', 'default', 'backlog', 'card.md'))).toBe(true)
  })

  it('should handle mixed directories and root .md files together', async () => {
    // Create status dirs, a dot-dir, and root .md files
    const todoDir = path.join(kanbanDir, 'todo')
    const reviewDir = path.join(kanbanDir, 'review')
    fs.mkdirSync(todoDir, { recursive: true })
    fs.mkdirSync(reviewDir, { recursive: true })
    fs.writeFileSync(path.join(todoDir, 'task.md'), '# Task', 'utf-8')
    fs.writeFileSync(path.join(reviewDir, 'pr.md'), '# PR Review', 'utf-8')
    fs.writeFileSync(path.join(kanbanDir, 'loose-card.md'), '# Loose', 'utf-8')

    await migrateFileSystemToMultiBoard(kanbanDir)

    // Status dirs moved
    expect(fs.existsSync(path.join(kanbanDir, 'boards', 'default', 'todo', 'task.md'))).toBe(true)
    expect(fs.existsSync(path.join(kanbanDir, 'boards', 'default', 'review', 'pr.md'))).toBe(true)

    // Root .md moved to backlog
    expect(fs.existsSync(path.join(kanbanDir, 'boards', 'default', 'backlog', 'loose-card.md'))).toBe(true)
  })
})

describe('config migration (v1 to v2)', () => {
  let workspaceDir: string

  beforeEach(() => {
    workspaceDir = createTempDir()
  })

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('should migrate a v1 config (no version field) to v2 format with boards.default', () => {
    const v1Config = {
      kanbanDirectory: '.kanban',
      defaultPriority: 'high',
      defaultStatus: 'todo',
      columns: [
        { id: 'todo', name: 'To Do', color: '#3b82f6' },
        { id: 'done', name: 'Done', color: '#22c55e' }
      ],
      aiAgent: 'claude',
      nextCardId: 5,
      showPriorityBadges: true,
      showAssignee: false,
      showDueDate: true,
      showLabels: false,
      showBuildWithAI: true,
      showFileName: false,
      compactMode: true,
      markdownEditorMode: false
    }
    fs.writeFileSync(path.join(workspaceDir, '.kanban.json'), JSON.stringify(v1Config), 'utf-8')

    const config = readConfig(workspaceDir)

    // Should be v2 format
    expect(config.version).toBe(2)
    expect(config.defaultBoard).toBe('default')
    expect(config.boards).toBeDefined()
    expect(config.boards.default).toBeDefined()

    // Board config should carry over v1 values
    const board = config.boards.default
    expect(board.name).toBe('Default')
    expect(board.columns).toEqual(v1Config.columns)
    expect(board.nextCardId).toBe(5)
    expect(board.defaultStatus).toBe('todo')
    expect(board.defaultPriority).toBe('high')

    // Global settings should carry over
    expect(config.showAssignee).toBe(false)
    expect(config.compactMode).toBe(true)
    expect(config.showLabels).toBe(false)
    expect(config.kanbanDirectory).toBe('.kanban')
  })

  it('should migrate a v1 config with explicit version: 1 to v2 format', () => {
    const v1Config = {
      version: 1,
      kanbanDirectory: '.kanban',
      defaultPriority: 'medium',
      defaultStatus: 'backlog',
      columns: DEFAULT_COLUMNS,
      aiAgent: 'claude',
      nextCardId: 1,
      showPriorityBadges: true,
      showAssignee: true,
      showDueDate: true,
      showLabels: true,
      showBuildWithAI: true,
      showFileName: false,
      compactMode: false,
      markdownEditorMode: false
    }
    fs.writeFileSync(path.join(workspaceDir, '.kanban.json'), JSON.stringify(v1Config), 'utf-8')

    const config = readConfig(workspaceDir)

    expect(config.version).toBe(2)
    expect(config.boards.default).toBeDefined()
    expect(config.boards.default.columns).toEqual(DEFAULT_COLUMNS)
    expect(config.boards.default.nextCardId).toBe(1)
  })

  it('should persist the migrated v2 config to disk', () => {
    const v1Config = {
      kanbanDirectory: '.kanban',
      columns: [{ id: 'backlog', name: 'Backlog', color: '#6b7280' }],
      nextCardId: 3
    }
    fs.writeFileSync(path.join(workspaceDir, '.kanban.json'), JSON.stringify(v1Config), 'utf-8')

    // First read triggers migration
    readConfig(workspaceDir)

    // Second read should load the persisted v2 config directly
    const raw = JSON.parse(fs.readFileSync(path.join(workspaceDir, '.kanban.json'), 'utf-8'))
    expect(raw.version).toBe(2)
    expect(raw.boards).toBeDefined()
    expect(raw.boards.default).toBeDefined()
    expect(raw.boards.default.columns).toEqual([{ id: 'backlog', name: 'Backlog', color: '#6b7280' }])
  })

  it('should return default config when no .kanban.json exists', () => {
    const config = readConfig(workspaceDir)

    expect(config.version).toBe(2)
    expect(config.boards.default).toBeDefined()
    expect(config.boards.default.columns).toEqual(DEFAULT_COLUMNS)
    expect(config.defaultBoard).toBe('default')
  })
})
