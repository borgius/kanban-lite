import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findWorkspaceRootSync, resolveKanbanDir, resolveWorkspaceRoot } from '../fileUtils'

const tempDirs: string[] = []

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

describe('fileUtils workspace resolution', () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()
      if (dir) fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('prefers the git root over a nested package.json in monorepos', () => {
    const root = makeTempDir('kanban-fileutils-root-')
    const packageDir = path.join(root, 'packages', 'kanban-lite')

    fs.mkdirSync(path.join(root, '.git'))
    fs.mkdirSync(packageDir, { recursive: true })
    fs.writeFileSync(path.join(packageDir, 'package.json'), '{"name":"kanban-lite"}\n', 'utf-8')

    expect(findWorkspaceRootSync(packageDir)).toBe(root)
  })

  it('uses an explicit config path to resolve workspace root and kanban directory', () => {
    const root = makeTempDir('kanban-fileutils-config-')
    const elsewhere = makeTempDir('kanban-fileutils-cwd-')
    const configPath = path.join(root, '.kanban.json')

    fs.writeFileSync(configPath, JSON.stringify({ kanbanDirectory: '.boards' }, null, 2), 'utf-8')

    expect(resolveWorkspaceRoot(elsewhere, configPath)).toBe(root)
    expect(resolveKanbanDir(elsewhere, configPath)).toBe(path.join(root, '.boards'))
  })
})
