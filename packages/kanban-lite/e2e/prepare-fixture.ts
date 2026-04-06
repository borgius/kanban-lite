import {
	prepareStandaloneE2EWorkspace,
	readStandaloneE2EScenarioNameFromArgs,
} from './fixture'

const scenarioName = readStandaloneE2EScenarioNameFromArgs(process.argv.slice(2), process.env.KANBAN_E2E_SCENARIO)
const scenario = prepareStandaloneE2EWorkspace(scenarioName)

console.log(`Prepared Playwright E2E scenario "${scenario.name}"`)
console.log(`Template: ${scenario.templateDir}`)
console.log(`Workspace: ${scenario.workspaceDir}`)
console.log(`Kanban directory: ${scenario.kanbanDir}`)
console.log(`Base URL: ${scenario.baseURL}`)
