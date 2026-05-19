import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { Client, StreamableHTTPClientTransport } from '../mcp-server/testSdkClient'
import { createCloudflareWorkerBootstrap } from '../sdk/env'
import { createCloudflareWorkerFetchHandler } from './index'

type McpTextResult = {
  content?: Array<{ type?: string; text?: string }>
}

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true })
  }
})

function createTempWorkspaceRoot(): string {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-lite-worker-mcp-'))
  tempDirs.push(workspaceRoot)
  return workspaceRoot
}

function createWorkerBootstrapConfig() {
  return {
    version: 2,
    defaultBoard: 'default',
    boards: {
      default: {
        name: 'Default',
        columns: [
          { id: 'backlog', name: 'Backlog', color: '#6b7280' },
          { id: 'todo', name: 'To Do', color: '#3b82f6' },
        ],
        nextCardId: 1,
        defaultStatus: 'backlog',
        defaultPriority: 'medium',
      },
    },
    plugins: {
      'config.storage': {
        provider: 'localfs',
        options: { scope: 'bootstrap' },
      },
    },
  }
}

function readMcpTextContent(result: unknown): string {
  if (!result || typeof result !== 'object') {
    throw new Error('Expected MCP tool result object')
  }

  const content = (result as McpTextResult).content
  const textEntry = Array.isArray(content)
    ? content.find((entry) => entry?.type === 'text' && typeof entry.text === 'string')
    : undefined

  if (!textEntry?.text) {
    throw new Error('Expected MCP text content payload')
  }

  return textEntry.text
}

describe('Cloudflare worker MCP transport', () => {
  it('supports MCP initialize, tools/list, and list_boards over /mcp', async () => {
    const workspaceRoot = createTempWorkspaceRoot()
    const kanbanDir = path.join(workspaceRoot, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })

    const handler = createCloudflareWorkerFetchHandler({
      kanbanDir,
      bootstrap: createCloudflareWorkerBootstrap({
        config: createWorkerBootstrapConfig(),
      }),
    })

    const transport = new StreamableHTTPClientTransport(new URL('https://example.test/mcp'), {
      fetch: async (input, init) => {
        const request = new Request(input, init)
        return handler(request)
      },
    })
    transport.onerror = () => undefined

    const client = new Client({ name: 'kanban-lite-worker-mcp-test-client', version: '1.0.0' })

    try {
      await client.connect(transport)

      const toolsResult = await client.listTools()
      expect(toolsResult.tools.some((tool) => tool.name === 'list_boards')).toBe(true)
      expect(toolsResult.tools.some((tool) => tool.name === 'get_workspace_info')).toBe(true)
      expect(transport.sessionId).toBeUndefined()
      expect(transport.protocolVersion).toBe('2025-11-25')

      const boardsResult = await client.callTool({
        name: 'list_boards',
        arguments: {},
      })
      const boards = JSON.parse(readMcpTextContent(boardsResult)) as Array<{
        id: string
        name: string
      }>

      expect(boards).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'default',
          name: 'Default',
        }),
      ]))
    } finally {
      await transport.close()
    }
  })
})
