import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readConfig, withConfigReadCache, writeConfig, DEFAULT_CONFIG } from './config'

function makeWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'kanban-lite-cfg-cache-'))
  writeFileSync(join(root, '.kanban.json'), JSON.stringify(DEFAULT_CONFIG))
  return root
}

describe('withConfigReadCache', () => {
  it('coalesces repeated readConfig calls inside the scope', async () => {
    const root = makeWorkspace()
    try {
      await withConfigReadCache(async () => {
        const a = readConfig(root)
        const b = readConfig(root)
        expect(a).toEqual(b)
        // Cloned per call so existing mutation-safe callers are preserved.
        expect(a).not.toBe(b)
        expect(a.boards.default.columns).not.toBe(b.boards.default.columns)
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('invalidates the cache on writeConfig so subsequent reads see fresh state', async () => {
    const root = makeWorkspace()
    try {
      await withConfigReadCache(async () => {
        const before = readConfig(root)
        expect(before.defaultBoard).toBe('default')

        const updated = { ...before, kanbanDirectory: '.kanban-renamed' }
        writeConfig(root, updated)

        const after = readConfig(root)
        expect(after.kanbanDirectory).toBe('.kanban-renamed')
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('leaves out-of-scope readConfig calls uncached', async () => {
    const root = makeWorkspace()
    try {
      const a = readConfig(root)
      const b = readConfig(root)
      // Outside withConfigReadCache, each call is an independent read,
      // with its own fresh object graph (existing contract).
      expect(a).not.toBe(b)
      expect(a.boards.default.columns[0]).not.toBe(b.boards.default.columns[0])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
