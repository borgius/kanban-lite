import * as path from 'path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { KanbanSDK } from '../sdk/KanbanSDK'
import { resolveKanbanDir as resolveDefaultKanbanDir, resolveWorkspaceRoot } from '../sdk/fileUtils'
import { readConfig } from '../shared/config'
import { createMcpAuthHelpers } from './auth'
import {
  createMcpPluginContext,
  registerCardStateMcpTools,
  registerChecklistMcpTools,
  registerPluginMcpTools,
  registerPluginSettingsMcpTools,
} from './registrars'
import { type McpToolRegistrar } from './shared'
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

async function resolveKanbanDir(): Promise<string> {
  // 1. CLI arg --dir
  const dirIndex = process.argv.indexOf('--dir')
  if (dirIndex !== -1 && process.argv[dirIndex + 1]) {
    return path.resolve(process.argv[dirIndex + 1])
  }
  // 2. Environment variable (KANBAN_DIR preferred, KANBAN_FEATURES_DIR kept as alias)
  const envDir = process.env.KANBAN_DIR || process.env.KANBAN_FEATURES_DIR
  if (envDir) {
    return path.resolve(envDir)
  }
  // 3. Optional explicit config file
  const configIndex = process.argv.indexOf('--config')
  const configFilePath = configIndex !== -1 && process.argv[configIndex + 1]
    ? path.resolve(process.argv[configIndex + 1])
    : undefined
  // 4. Auto-detect from cwd / config
  return resolveDefaultKanbanDir(process.cwd(), configFilePath)
}


// --- Main ---

async function main(): Promise<void> {
  const kanbanDir = await resolveKanbanDir()
  const configIndex = process.argv.indexOf('--config')
  const configFilePath = configIndex !== -1 && process.argv[configIndex + 1]
    ? path.resolve(process.argv[configIndex + 1])
    : undefined
  const workspaceRoot = resolveWorkspaceRoot(process.cwd(), configFilePath)
  const sdk = new KanbanSDK(kanbanDir)

  const server = new McpServer({
    name: 'kanban-lite',
    version: '1.0.0',
  })
  const { getAuthStatus: getMcpAuthStatus, runWithAuth: runWithMcpAuth } = createMcpAuthHelpers(sdk)
  const registrar = server as unknown as McpToolRegistrar

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

  // --- Start server ---

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

if (require.main === module) {
  main().catch(err => {
    console.error(`MCP Server error: ${err.message}`)
    process.exit(1)
  })
}
