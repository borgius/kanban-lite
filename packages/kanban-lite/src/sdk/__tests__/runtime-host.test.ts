import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readConfig, writeConfig } from '../../shared/config'
import { getRuntimeHost, installRuntimeHost, loadWorkspaceEnv, resetRuntimeHost } from '../../shared/env'
import { loadExternalModule } from '../plugins'

const scratchRoot = path.join(process.cwd(), 'packages/kanban-lite/.test-artifacts/runtime-host')

function createWorkspace(name: string): string {
  const workspaceRoot = path.join(scratchRoot, name)
  fs.rmSync(workspaceRoot, { recursive: true, force: true })
  fs.mkdirSync(workspaceRoot, { recursive: true })
  return workspaceRoot
}

afterEach(() => {
  resetRuntimeHost()
  fs.rmSync(scratchRoot, { recursive: true, force: true })
  delete process.env.RUNTIME_HOST_SAMPLE
})

describe('runtime host overrides', () => {
  it('keeps default config and env behavior when no runtime host is installed', () => {
    const workspaceRoot = createWorkspace('defaults')
    fs.writeFileSync(path.join(workspaceRoot, '.kanban.json'), JSON.stringify({ version: 2, defaultBoard: 'default', boards: { default: { columns: [] } } }), 'utf-8')
    fs.writeFileSync(path.join(workspaceRoot, '.env'), 'RUNTIME_HOST_SAMPLE=from-dotenv\n', 'utf-8')

    loadWorkspaceEnv(workspaceRoot)
    expect(process.env.RUNTIME_HOST_SAMPLE).toBe('from-dotenv')
    expect(readConfig(workspaceRoot).defaultBoard).toBe('default')
  })

  it('lets the runtime host override config read, config write, env loading, and module resolution', () => {
    const workspaceRoot = createWorkspace('override')
    const writes: Array<{ workspaceRoot: string; defaultBoard: string }> = []

    installRuntimeHost({
      readConfig(root) {
        expect(root).toBe(workspaceRoot)
        return {
          version: 2,
          defaultBoard: 'worker',
          boards: {
            worker: {
              columns: [{ id: 'todo', name: 'Todo' }],
            },
          },
        }
      },
      writeConfig(root, _filePath, config) {
        writes.push({ workspaceRoot: root, defaultBoard: config.defaultBoard })
        return true
      },
      loadWorkspaceEnv(root) {
        process.env.RUNTIME_HOST_SAMPLE = `runtime:${root}`
        return true
      },
      resolveExternalModule(request) {
        if (request === 'runtime-host-plugin') {
          return { manifest: { id: 'runtime-host-plugin' } }
        }
        return undefined
      },
    })

    loadWorkspaceEnv(workspaceRoot)
    const config = readConfig(workspaceRoot)
    expect(config.defaultBoard).toBe('worker')
    expect(process.env.RUNTIME_HOST_SAMPLE).toBe(`runtime:${workspaceRoot}`)
    expect(loadExternalModule('runtime-host-plugin')).toEqual({ manifest: { id: 'runtime-host-plugin' } })

    writeConfig(workspaceRoot, config)
    expect(writes).toEqual([{ workspaceRoot, defaultBoard: 'worker' }])
    expect(fs.existsSync(path.join(workspaceRoot, '.kanban.json'))).toBe(false)
  })

  it('exposes the installed runtime host globally', () => {
    installRuntimeHost({ loadWorkspaceEnv: () => true })
    expect(getRuntimeHost()).not.toBeNull()
  })
})
