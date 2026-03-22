import { prepareStandaloneE2EWorkspace, standaloneE2EKanbanDir, standaloneE2EWorkspaceDir } from './fixture'

prepareStandaloneE2EWorkspace()

console.log(`Prepared standalone E2E workspace at ${standaloneE2EWorkspaceDir}`)
console.log(`Kanban directory: ${standaloneE2EKanbanDir}`)
