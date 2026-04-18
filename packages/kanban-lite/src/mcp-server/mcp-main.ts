import * as path from 'path'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { KanbanSDK } from '../sdk/KanbanSDK'
import { resolveKanbanDir as resolveDefaultKanbanDir, resolveWorkspaceRoot } from '../sdk/fileUtils'
import { createMcpAuthHelpers } from './auth'
import { createMcpPluginContext } from './registrars'
import { registerBoardMcpTools } from './tools/boards'
import { registerCardMcpTools } from './tools/cards'
import { registerContentMcpTools } from './tools/content'
import { registerSettingsMcpTools } from './tools/settings'

export {
  createMcpPluginContext,
  registerCardStateMcpTools,
  registerChecklistMcpTools,
  registerPluginMcpTools,
  registerPluginSettingsMcpTools,
} from './registrars'
export {
  createMcpCardStateErrorResult,
  createMcpErrorResult,
} from './shared'

export async function resolveKanbanDir(): Promise<string> {
  const dirIndex = process.argv.indexOf('--dir')
  if (dirIndex !== -1 && process.argv[dirIndex + 1]) {
    return path.resolve(process.argv[dirIndex + 1])
  }

  const envDir = process.env.KANBAN_DIR || process.env.KANBAN_FEATURES_DIR
  if (envDir) {
    return path.resolve(envDir)
  }

  const configIndex = process.argv.indexOf('--config')
  const configFilePath = configIndex !== -1 && process.argv[configIndex + 1]
    ? path.resolve(process.argv[configIndex + 1])
    : undefined

  return resolveDefaultKanbanDir(process.cwd(), configFilePath)
}

export interface CreateMcpServerOptions {
  sdk: KanbanSDK
  workspaceRoot: string
  kanbanDir: string
  authHelpers?: ReturnType<typeof createMcpAuthHelpers>
}

export function createMcpServerInstance(options: CreateMcpServerOptions): McpServer {
  const { sdk, workspaceRoot, kanbanDir } = options
  const { getAuthStatus: getMcpAuthStatus, runWithAuth: runWithMcpAuth } = options.authHelpers ?? createMcpAuthHelpers(sdk)

  const server = new McpServer({
    name: 'kanban-lite',
    version: '1.0.0',
  })

  const mcpPluginContext = createMcpPluginContext({
    sdk,
    workspaceRoot,
    kanbanDir,
    runWithAuth: runWithMcpAuth,
  })

  registerBoardMcpTools(server, sdk, runWithMcpAuth)
  registerCardMcpTools(server, sdk, runWithMcpAuth)
  registerContentMcpTools(server, sdk, runWithMcpAuth)
  registerSettingsMcpTools(server, sdk, runWithMcpAuth, getMcpAuthStatus, workspaceRoot, kanbanDir, mcpPluginContext)

  return server
}

export async function main(): Promise<void> {
  const kanbanDir = await resolveKanbanDir()
  const configIndex = process.argv.indexOf('--config')
  const configFilePath = configIndex !== -1 && process.argv[configIndex + 1]
    ? path.resolve(process.argv[configIndex + 1])
    : undefined
  const workspaceRoot = resolveWorkspaceRoot(process.cwd(), configFilePath)
  const sdk = new KanbanSDK(kanbanDir)

  const server = createMcpServerInstance({ sdk, workspaceRoot, kanbanDir })

  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js')
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
