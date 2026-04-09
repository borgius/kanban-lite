import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createRequire } from 'node:module'

const runtimeRequire = createRequire(import.meta.url)

export type TempKanbanWorkspace = {
  workspaceDir: string
  kanbanDir: string
  cleanup(): void
}

export function findWorkspaceRoot(startDir: string): string {
  let dir = startDir
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      break
    }
    dir = parent
  }
  throw new Error('Cannot find workspace root (pnpm-workspace.yaml not found)')
}

export function requireWorkspaceBuild<T>(startDir: string, relativePath: string, label: string): T {
  const workspaceRoot = findWorkspaceRoot(startDir)
  const modulePath = path.join(workspaceRoot, relativePath)
  if (!fs.existsSync(modulePath)) {
    throw new Error(`${label} not built at: ${modulePath}\nRun: pnpm build`)
  }
  return runtimeRequire(modulePath) as T
}

export function loadWorkspaceKanbanLiteSdk<T>(startDir: string): T {
  return requireWorkspaceBuild<T>(
    startDir,
    path.join('packages', 'kanban-lite', 'dist', 'sdk', 'index.cjs'),
    'kanban-lite SDK',
  )
}

export function createTempKanbanWorkspace(prefix: string, kanbanDirectory = '.kanban'): TempKanbanWorkspace {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  const kanbanDir = path.join(workspaceDir, kanbanDirectory)
  fs.mkdirSync(kanbanDir, { recursive: true })

  return {
    workspaceDir,
    kanbanDir,
    cleanup: () => fs.rmSync(workspaceDir, { recursive: true, force: true }),
  }
}
