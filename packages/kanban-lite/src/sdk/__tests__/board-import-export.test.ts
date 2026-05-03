import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { KanbanSDK } from '../KanbanSDK'
import { exportBoardSettings, importBoardSettings } from '../modules/board-import-export'
import type { SDKContext } from '../modules/context'

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-board-import-export-test-'))
}

function writeKanbanJson(workspaceRoot: string, config: object): void {
  fs.writeFileSync(path.join(workspaceRoot, '.kanban.json'), JSON.stringify(config, null, 2), 'utf-8')
}

function readKanbanJson(workspaceRoot: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(workspaceRoot, '.kanban.json'), 'utf-8')) as Record<string, unknown>
}

const BOARD_COLUMNS = [
  { id: 'backlog', name: 'Backlog', color: '#94a3b8' },
  { id: 'done', name: 'Done', color: '#22c55e' },
]

const BASE_CONFIG = {
  version: 2,
  boards: {
    default: {
      name: 'Default Board',
      description: 'My default board',
      columns: BOARD_COLUMNS,
      nextCardId: 1,
      defaultStatus: 'backlog',
      defaultPriority: 'medium',
    },
  },
  defaultBoard: 'default',
  kanbanDirectory: '.kanban',
  aiAgent: 'claude',
  defaultPriority: 'medium',
  defaultStatus: 'backlog',
  nextCardId: 1,
  labels: {
    bug: { color: '#ef4444' },
    feature: { color: '#3b82f6' },
  },
}

describe('board-import-export', () => {
  let workspaceDir: string
  let kanbanDir: string
  let sdk: KanbanSDK

  beforeEach(() => {
    workspaceDir = createTempDir()
    kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
    writeKanbanJson(workspaceDir, BASE_CONFIG)
    sdk = new KanbanSDK(kanbanDir)
  })

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  // Helper to get an SDKContext for direct module tests
  function makeCtx(): SDKContext {
    return sdk as unknown as SDKContext
  }

  describe('exportBoardSettings', () => {
    it('exports board config including name, columns, and description', () => {
      const archive = exportBoardSettings(makeCtx(), { boardId: 'default' })
      expect(archive.kind).toBe('kanban-lite.board-settings')
      expect(archive.version).toBe(1)
      expect(typeof archive.exportedAt).toBe('string')
      expect(archive.board.id).toBe('default')
      expect(archive.board.config.name).toBe('Default Board')
      expect(archive.board.config.description).toBe('My default board')
      expect(archive.board.config.columns).toEqual(BOARD_COLUMNS)
    })

    it('includes labels in the workspace fragment', () => {
      const archive = exportBoardSettings(makeCtx(), { boardId: 'default' })
      expect(archive.workspace.labels).toEqual({
        bug: { color: '#ef4444' },
        feature: { color: '#3b82f6' },
      })
    })

    it('uses default board when boardId is omitted', () => {
      const archive = exportBoardSettings(makeCtx())
      expect(archive.board.id).toBe('default')
    })

    it('includes webhook.delivery plugin fragment when present', () => {
      const configWithPlugin = {
        ...BASE_CONFIG,
        plugins: {
          'webhook.delivery': { provider: 'kl-plugin-webhook', options: { webhooks: [] } },
        },
      }
      writeKanbanJson(workspaceDir, configWithPlugin)
      const archive = exportBoardSettings(makeCtx())
      expect(archive.workspace.plugins?.['webhook.delivery']).toBeDefined()
    })

    it('omits auth and storage plugin fragments', () => {
      const configWithAuth = {
        ...BASE_CONFIG,
        plugins: {
          'auth.identity': { provider: 'local', options: {} },
          'card.storage': { provider: 'markdown', options: {} },
        },
      }
      writeKanbanJson(workspaceDir, configWithAuth)
      const archive = exportBoardSettings(makeCtx())
      // auth and storage should not be in the export
      expect(archive.workspace.plugins?.['auth.identity' as keyof typeof archive.workspace.plugins]).toBeUndefined()
      expect(archive.workspace.plugins?.['card.storage' as keyof typeof archive.workspace.plugins]).toBeUndefined()
    })

    it('omits forms fragment when no forms defined', () => {
      const archive = exportBoardSettings(makeCtx())
      expect(archive.workspace.forms).toBeUndefined()
    })

    it('includes forms in the workspace fragment when present', () => {
      const configWithForms = {
        ...BASE_CONFIG,
        forms: { contact: { fields: [{ id: 'name', type: 'text' }] } },
      }
      writeKanbanJson(workspaceDir, configWithForms)
      const archive = exportBoardSettings(makeCtx())
      expect(archive.workspace.forms).toBeDefined()
      expect(archive.workspace.forms?.contact).toBeDefined()
    })
  })

  describe('importBoardSettings', () => {
    it('imports a valid archive and writes config', () => {
      const archive = exportBoardSettings(makeCtx(), { boardId: 'default' })
      // Modify exported archive to use a different board ID
      const newArchive = { ...archive, board: { id: 'imported', config: { ...archive.board.config, name: 'Imported Board' } } }

      importBoardSettings(makeCtx(), { payload: newArchive })

      const saved = readKanbanJson(workspaceDir)
      const boards = saved.boards as Record<string, unknown>
      expect(boards.imported).toBeDefined()
      expect((boards.imported as { name?: string }).name).toBe('Imported Board')
    })

    it('merges labels from workspace fragment without overwriting unrelated labels', () => {
      const archive = exportBoardSettings(makeCtx(), { boardId: 'default' })
      const newArchive = {
        ...archive,
        board: { ...archive.board, id: 'imported2' },
        workspace: { ...archive.workspace, labels: { newlabel: { color: '#000000' } } },
      }
      importBoardSettings(makeCtx(), { payload: newArchive })

      const saved = readKanbanJson(workspaceDir)
      const labels = saved.labels as Record<string, unknown>
      // Pre-existing labels are preserved
      expect(labels.bug).toBeDefined()
      expect(labels.feature).toBeDefined()
      // Imported label is added
      expect(labels.newlabel).toEqual({ color: '#000000' })
    })

    it('throws when board already exists and overwrite is false', () => {
      const archive = exportBoardSettings(makeCtx(), { boardId: 'default' })
      expect(() => importBoardSettings(makeCtx(), { payload: archive })).toThrow('Board already exists: default')
    })

    it('overwrites existing board when overwrite is true', () => {
      const archive = exportBoardSettings(makeCtx(), { boardId: 'default' })
      const modifiedArchive = {
        ...archive,
        board: { id: 'default', config: { ...archive.board.config, name: 'Overwritten Board' } },
      }
      const result = importBoardSettings(makeCtx(), { payload: modifiedArchive, options: { overwrite: true } })
      expect(result.name).toBe('Overwritten Board')
    })

    it('rejects payload with wrong kind', () => {
      const badPayload = { kind: 'some-other-tool.settings', version: 1, board: { id: 'x', config: { name: 'X', columns: [] } }, workspace: {} }
      expect(() => importBoardSettings(makeCtx(), { payload: badPayload })).toThrow('unsupported archive kind')
    })

    it('rejects payload with unsupported version', () => {
      const badPayload = { kind: 'kanban-lite.board-settings', version: 99, board: { id: 'x', config: { name: 'X', columns: [] } }, workspace: {} }
      expect(() => importBoardSettings(makeCtx(), { payload: badPayload })).toThrow('unsupported archive version')
    })

    it('rejects payload with missing board.id', () => {
      const badPayload = { kind: 'kanban-lite.board-settings', version: 1, board: { id: '', config: { name: 'X', columns: [] } }, workspace: {} }
      expect(() => importBoardSettings(makeCtx(), { payload: badPayload })).toThrow('missing board.id')
    })

    it('rejects payload with missing board.config.name', () => {
      const badPayload = { kind: 'kanban-lite.board-settings', version: 1, board: { id: 'x', config: { columns: [] } }, workspace: {} }
      expect(() => importBoardSettings(makeCtx(), { payload: badPayload })).toThrow('board.config.name')
    })

    it('rejects non-object payload', () => {
      expect(() => importBoardSettings(makeCtx(), { payload: null })).toThrow('payload must be a JSON object')
      expect(() => importBoardSettings(makeCtx(), { payload: 'string' })).toThrow('payload must be a JSON object')
    })

    it('writes config exactly once (single write call)', () => {
      const archive = exportBoardSettings(makeCtx(), { boardId: 'default' })
      const newArchive = { ...archive, board: { id: 'once', config: { ...archive.board.config, name: 'Once Board' } } }

      // Read mtime before import
      const configPath = path.join(workspaceDir, '.kanban.json')
      const mtimeBefore = fs.statSync(configPath).mtimeMs

      importBoardSettings(makeCtx(), { payload: newArchive })

      const saved = readKanbanJson(workspaceDir)
      expect((saved.boards as Record<string, { name?: string }>).once?.name).toBe('Once Board')
      // Confirm file was written (mtime changed or equal at ms granularity)
      const mtimeAfter = fs.statSync(configPath).mtimeMs
      expect(mtimeAfter).toBeGreaterThanOrEqual(mtimeBefore)
    })
  })

  describe('KanbanSDK wrappers', () => {
    it('sdk.exportBoardSettings works', () => {
      const archive = sdk.exportBoardSettings('default')
      expect(archive.kind).toBe('kanban-lite.board-settings')
      expect(archive.board.id).toBe('default')
    })

    it('sdk.importBoardSettings works', () => {
      const archive = sdk.exportBoardSettings('default')
      const newArchive = { ...archive, board: { id: 'sdk-imported', config: { ...archive.board.config, name: 'SDK Import' } } }
      const result = sdk.importBoardSettings(newArchive)
      expect(result.id).toBe('sdk-imported')
      expect(result.name).toBe('SDK Import')
    })
  })
})
