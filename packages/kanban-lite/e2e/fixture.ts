import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDir = path.dirname(fileURLToPath(import.meta.url))

export const repoRoot = path.resolve(currentDir, '../../..')
export const fixtureTemplateDir = path.join(currentDir, 'fixtures', 'workspace-template')
export const standaloneE2EWorkspaceDir = path.join(repoRoot, 'tmp', 'e2e', 'workspace')
export const standaloneE2EKanbanDir = path.join(standaloneE2EWorkspaceDir, '.kanban')

export function prepareStandaloneE2EWorkspace(): void {
  fs.rmSync(standaloneE2EWorkspaceDir, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(standaloneE2EWorkspaceDir), { recursive: true })
  fs.cpSync(fixtureTemplateDir, standaloneE2EWorkspaceDir, { recursive: true })
}
