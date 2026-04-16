import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, configToSettings, readConfig, settingsToConfig } from './config'
import { DEFAULT_COLUMNS } from './types'

afterEach(() => {
  vi.restoreAllMocks()
})

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

  it('round-trips shared settings values that are opened in the settings modal', () => {
    const settings = {
      ...configToSettings(DEFAULT_CONFIG),
      showBuildWithAI: false,
      markdownEditorMode: true,
      drawerPosition: 'left' as const,
    }

    const updated = settingsToConfig(DEFAULT_CONFIG, settings)

    expect(updated.showBuildWithAI).toBe(false)
    expect(updated.markdownEditorMode).toBe(true)
    expect(updated.drawerPosition).toBe('left')
    expect(configToSettings(updated)).toMatchObject(settings)
  })

  it('preserves board title templates without treating display placeholders as env vars', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'kanban-lite-config-'))

    try {
      const config = structuredClone(DEFAULT_CONFIG)
      config.boards.default.title = ['ticketId', 'location']
      config.boards.default.titleTemplate = '${metadata.ticketId} ${metadata.location} ${title}'

      writeFileSync(join(workspaceRoot, '.kanban.json'), JSON.stringify(config, null, 2), 'utf-8')

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new Error(`process.exit(${code ?? 'undefined'})`)
      }) as typeof process.exit)
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

      const loaded = readConfig(workspaceRoot)

      expect(loaded.boards.default.title).toEqual(['ticketId', 'location'])
      expect(loaded.boards.default.titleTemplate).toBe('${metadata.ticketId} ${metadata.location} ${title}')
      expect(exitSpy).not.toHaveBeenCalled()
      expect(stderrSpy).not.toHaveBeenCalled()
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })
})
