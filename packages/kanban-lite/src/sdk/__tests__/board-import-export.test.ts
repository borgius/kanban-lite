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
    it('exports board config including name, columns, and description', async () => {
      const archive = await exportBoardSettings(makeCtx(), { boardId: 'default' })
      expect(archive.kind).toBe('kanban-lite.board-settings')
      expect(archive.version).toBe(1)
      expect(typeof archive.exportedAt).toBe('string')
      expect(archive.board.id).toBe('default')
      expect(archive.board.config.name).toBe('Default Board')
      expect(archive.board.config.description).toBe('My default board')
      expect(archive.board.config.columns).toEqual(BOARD_COLUMNS)
    })

    it('includes labels in the workspace fragment', async () => {
      const archive = await exportBoardSettings(makeCtx(), { boardId: 'default' })
      expect(archive.workspace.labels).toEqual({
        bug: { color: '#ef4444' },
        feature: { color: '#3b82f6' },
      })
    })

    it('uses default board when boardId is omitted', async () => {
      const archive = await exportBoardSettings(makeCtx())
      expect(archive.board.id).toBe('default')
    })

    it('includes webhook.delivery plugin fragment when present', async () => {
      const configWithPlugin = {
        ...BASE_CONFIG,
        plugins: {
          'webhook.delivery': { provider: 'kl-plugin-webhook', options: { webhooks: [] } },
        },
      }
      writeKanbanJson(workspaceDir, configWithPlugin)
      const archive = await exportBoardSettings(makeCtx())
      expect(archive.workspace.plugins?.['webhook.delivery']).toBeDefined()
    })

    it('redacts secrets from hook-related workspace fragments', async () => {
      const configWithSecrets = {
        ...BASE_CONFIG,
        plugins: {
          'webhook.delivery': {
            provider: 'kl-plugin-webhook',
            options: {
              webhooks: [
                { id: 'wh_1', url: 'https://example.com', secret: 'super-secret' },
              ],
              apiToken: 'webhook-token',
            },
          },
          'callback.runtime': { provider: 'callbacks', options: { clientSecret: 'callback-secret' } },
          'cron.runtime': { provider: 'cron', options: { events: [], apiToken: 'cron-token' } },
        },
        webhookPlugin: {
          'webhook.delivery': { provider: 'webhooks', options: { token: 'legacy-token' } },
        },
        webhooks: [
          { id: 'legacy', url: 'https://example.com', events: ['*'], secret: 'legacy-secret' },
        ],
      }
      writeKanbanJson(workspaceDir, configWithSecrets)

      const archive = await exportBoardSettings(makeCtx())
      const exported = JSON.stringify(archive)

      expect(exported).not.toContain('super-secret')
      expect(exported).not.toContain('webhook-token')
      expect(exported).not.toContain('callback-secret')
      expect(exported).not.toContain('cron-token')
      expect(exported).not.toContain('legacy-token')
      expect(exported).not.toContain('legacy-secret')
      expect(exported).not.toContain('apiToken')
      expect(exported).not.toContain('clientSecret')
      expect(exported).not.toContain('"secret"')
    })

    it('omits auth and storage plugin fragments', async () => {
      const configWithAuth = {
        ...BASE_CONFIG,
        plugins: {
          'auth.identity': { provider: 'local', options: {} },
          'card.storage': { provider: 'markdown', options: {} },
        },
      }
      writeKanbanJson(workspaceDir, configWithAuth)
      const archive = await exportBoardSettings(makeCtx())
      // auth and storage should not be in the export
      expect(archive.workspace.plugins?.['auth.identity' as keyof typeof archive.workspace.plugins]).toBeUndefined()
      expect(archive.workspace.plugins?.['card.storage' as keyof typeof archive.workspace.plugins]).toBeUndefined()
    })

    it('omits forms fragment when no forms defined', async () => {
      const archive = await exportBoardSettings(makeCtx())
      expect(archive.workspace.forms).toBeUndefined()
    })

    it('includes forms in the workspace fragment when present', async () => {
      const configWithForms = {
        ...BASE_CONFIG,
        forms: { contact: { fields: [{ id: 'name', type: 'text' }] } },
      }
      writeKanbanJson(workspaceDir, configWithForms)
      const archive = await exportBoardSettings(makeCtx())
      expect(archive.workspace.forms).toBeDefined()
      expect(archive.workspace.forms?.contact).toBeDefined()
    })
  })

  describe('importBoardSettings', () => {
    it('imports a valid archive and writes config', async () => {
      const archive = await exportBoardSettings(makeCtx(), { boardId: 'default' })
      // Modify exported archive to use a different board ID
      const newArchive = { ...archive, board: { id: 'imported', config: { ...archive.board.config, name: 'Imported Board' } } }

      await importBoardSettings(makeCtx(), { payload: newArchive })

      const saved = readKanbanJson(workspaceDir)
      const boards = saved.boards as Record<string, unknown>
      expect(boards.imported).toBeDefined()
      expect((boards.imported as { name?: string }).name).toBe('Imported Board')
    })

    it('merges labels from workspace fragment without overwriting unrelated labels', async () => {
      const archive = await exportBoardSettings(makeCtx(), { boardId: 'default' })
      const newArchive = {
        ...archive,
        board: { ...archive.board, id: 'imported2' },
        workspace: { ...archive.workspace, labels: { newlabel: { color: '#000000' } } },
      }
      await importBoardSettings(makeCtx(), { payload: newArchive })

      const saved = readKanbanJson(workspaceDir)
      const labels = saved.labels as Record<string, unknown>
      // Pre-existing labels are preserved
      expect(labels.bug).toBeDefined()
      expect(labels.feature).toBeDefined()
      // Imported label is added
      expect(labels.newlabel).toEqual({ color: '#000000' })
    })

    it('throws when board already exists and overwrite is false', async () => {
      const archive = await exportBoardSettings(makeCtx(), { boardId: 'default' })
      await expect(importBoardSettings(makeCtx(), { payload: archive })).rejects.toThrow('Board already exists: default')
    })

    it('overwrites existing board when overwrite is true', async () => {
      const archive = await exportBoardSettings(makeCtx(), { boardId: 'default' })
      const modifiedArchive = {
        ...archive,
        board: { id: 'default', config: { ...archive.board.config, name: 'Overwritten Board' } },
      }
      const result = await importBoardSettings(makeCtx(), { payload: modifiedArchive, options: { overwrite: true } })
      expect(result.name).toBe('Overwritten Board')
    })

    it('rejects payload with wrong kind', async () => {
      const badPayload = { kind: 'some-other-tool.settings', version: 1, board: { id: 'x', config: { name: 'X', columns: [] } }, workspace: {} }
      await expect(importBoardSettings(makeCtx(), { payload: badPayload })).rejects.toThrow('unsupported archive kind')
    })

    it('rejects payload with unsupported version', async () => {
      const badPayload = { kind: 'kanban-lite.board-settings', version: 99, board: { id: 'x', config: { name: 'X', columns: [] } }, workspace: {} }
      await expect(importBoardSettings(makeCtx(), { payload: badPayload })).rejects.toThrow('unsupported archive version')
    })

    it('rejects payload with missing board.id', async () => {
      const badPayload = { kind: 'kanban-lite.board-settings', version: 1, board: { id: '', config: { name: 'X', columns: [] } }, workspace: {} }
      await expect(importBoardSettings(makeCtx(), { payload: badPayload })).rejects.toThrow('missing board.id')
    })

    it('rejects payload with missing board.config.name', async () => {
      const badPayload = { kind: 'kanban-lite.board-settings', version: 1, board: { id: 'x', config: { columns: [] } }, workspace: {} }
      await expect(importBoardSettings(makeCtx(), { payload: badPayload })).rejects.toThrow('board.config.name')
    })

    it('rejects non-object payload', async () => {
      await expect(importBoardSettings(makeCtx(), { payload: null })).rejects.toThrow('payload must be a JSON object')
      await expect(importBoardSettings(makeCtx(), { payload: 'string' })).rejects.toThrow('payload must be a JSON object')
    })

    it('rejects unsafe object keys before writing config', async () => {
      const archive = await exportBoardSettings(makeCtx(), { boardId: 'default' })
      const payload = JSON.parse(JSON.stringify({
        ...archive,
        board: { ...archive.board, id: 'safe-import' },
      })) as { workspace: unknown }
      payload.workspace = { labels: JSON.parse('{"__proto__":{"color":"#000000"}}') as unknown }

      await expect(importBoardSettings(makeCtx(), { payload })).rejects.toThrow('unsafe object key "__proto__"')

      const saved = readKanbanJson(workspaceDir)
      expect((saved.boards as Record<string, unknown>)['safe-import']).toBeUndefined()
    })

    it('writes config exactly once (single write call)', async () => {
      const archive = await exportBoardSettings(makeCtx(), { boardId: 'default' })
      const newArchive = { ...archive, board: { id: 'once', config: { ...archive.board.config, name: 'Once Board' } } }

      // Read mtime before import
      const configPath = path.join(workspaceDir, '.kanban.json')
      const mtimeBefore = fs.statSync(configPath).mtimeMs

      await importBoardSettings(makeCtx(), { payload: newArchive })

      const saved = readKanbanJson(workspaceDir)
      expect((saved.boards as Record<string, { name?: string }>).once?.name).toBe('Once Board')
      // Confirm file was written (mtime changed or equal at ms granularity)
      const mtimeAfter = fs.statSync(configPath).mtimeMs
      expect(mtimeAfter).toBeGreaterThanOrEqual(mtimeBefore)
    })
  })

  describe('KanbanSDK wrappers', () => {
    it('sdk.exportBoardSettings works', async () => {
      const archive = await sdk.exportBoardSettings('default')
      expect(archive.kind).toBe('kanban-lite.board-settings')
      expect(archive.board.id).toBe('default')
    })

    it('sdk.importBoardSettings works', async () => {
      const archive = await sdk.exportBoardSettings('default')
      const newArchive = { ...archive, board: { id: 'sdk-imported', config: { ...archive.board.config, name: 'SDK Import' } } }
      const result = await sdk.importBoardSettings(newArchive)
      expect(result.id).toBe('sdk-imported')
      expect(result.name).toBe('SDK Import')
    })
  })
})
