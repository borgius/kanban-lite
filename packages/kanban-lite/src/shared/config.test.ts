import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, readConfig } from './config'
import { DEFAULT_COLUMNS } from './types'

describe('config defaults', () => {
  it('keeps DEFAULT_CONFIG columns detached from DEFAULT_COLUMNS entries', () => {
    expect(DEFAULT_CONFIG.boards.default.columns).toEqual(DEFAULT_COLUMNS)
    expect(DEFAULT_CONFIG.boards.default.columns).not.toBe(DEFAULT_COLUMNS)
    expect(DEFAULT_CONFIG.boards.default.columns[0]).not.toBe(DEFAULT_COLUMNS[0])
  })

  it('returns fresh column objects when reading defaults from a missing config', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'kanban-lite-config-'))

    try {
      const first = readConfig(workspaceRoot)
      const second = readConfig(workspaceRoot)

      expect(first.boards.default.columns).toEqual(second.boards.default.columns)
      expect(first.boards.default.columns).not.toBe(second.boards.default.columns)
      expect(first.boards.default.columns[0]).not.toBe(second.boards.default.columns[0])
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })
})
