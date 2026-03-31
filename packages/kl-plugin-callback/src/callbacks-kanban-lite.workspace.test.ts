import * as fs from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFile } from 'node:child_process'
import { once } from 'node:events'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Client } from '../../kanban-lite/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'
import { StdioClientTransport } from '../../kanban-lite/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js'
import { KanbanSDK } from '../../kanban-lite/src/sdk/KanbanSDK'
import { startServer } from '../../kanban-lite/src/standalone/server'

const execFileAsync = promisify(execFile)
const REPO_ROOT = path.resolve(__dirname, '../../..')
const TSX_CLI_PATH = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const CLI_ENTRYPOINT = path.join(REPO_ROOT, 'packages/kanban-lite/src/cli/index.ts')
const MCP_ENTRYPOINT = path.join(REPO_ROOT, 'packages/kanban-lite/src/mcp-server/index.ts')
const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

type CallbackEventRecord = {
  event: string
  cardId: string | null
  hasCreateCard: boolean
}

type CallbackWorkspace = {
  workspaceRoot: string
  kanbanDir: string
  configPath: string
  callbackLogPath: string
  cleanup: () => void
}

function createCallbackWorkspace(prefix: string): CallbackWorkspace {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
  const kanbanDir = path.join(workspaceRoot, '.kanban')
  const configPath = path.join(workspaceRoot, '.kanban.json')
  const callbackLogPath = path.join(workspaceRoot, 'callback-events.jsonl')
  const inlineSource = `async function ({ event, sdk }) { const { appendFileSync } = await import('node:fs'); const cardId = event && event.data && typeof event.data === 'object' && 'id' in event.data ? event.data.id : null; appendFileSync(${JSON.stringify(callbackLogPath)}, JSON.stringify({ event: event.event, cardId, hasCreateCard: typeof sdk.createCard === "function" }) + "\\n", "utf8"); }`

  fs.mkdirSync(kanbanDir, { recursive: true })
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      version: 2,
      defaultBoard: 'default',
      kanbanDirectory: '.kanban',
      boards: {
        default: {
          name: 'Default',
          columns: [{ id: 'backlog', name: 'Backlog' }],
          nextCardId: 1,
          defaultStatus: 'backlog',
          defaultPriority: 'medium',
        },
      },
      plugins: {
        'callback.runtime': {
          provider: 'callbacks',
          options: {
            handlers: [
              {
                name: 'capture-task-created',
                type: 'inline',
                events: ['task.created'],
                enabled: true,
                source: inlineSource,
              },
            ],
          },
        },
      },
    }, null, 2) + '\n',
    'utf-8',
  )

  return {
    workspaceRoot,
    kanbanDir,
    configPath,
    callbackLogPath,
    cleanup: () => fs.rmSync(workspaceRoot, { recursive: true, force: true }),
  }
}

function readCallbackEvents(callbackLogPath: string): CallbackEventRecord[] {
  if (!fs.existsSync(callbackLogPath)) return []
  return fs.readFileSync(callbackLogPath, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CallbackEventRecord)
}

function extractCreatedCardId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined

  const candidate = payload as {
    id?: unknown
    data?: { id?: unknown }
  }

  if (typeof candidate.id === 'string') return candidate.id
  if (candidate.data && typeof candidate.data.id === 'string') return candidate.data.id
  return undefined
}

function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_PATTERN, '')
}

function readMcpTextContent(result: unknown): string {
  if (!result || typeof result !== 'object') return 'null'

  const content = (result as { content?: unknown }).content
  if (!Array.isArray(content) || content.length === 0) return 'null'

  const first = content[0]
  if (!first || typeof first !== 'object') return 'null'

  const chunk = first as { type?: unknown; text?: unknown }
  return chunk.type === 'text' && typeof chunk.text === 'string' ? chunk.text : 'null'
}

async function expectSingleTaskCreatedEvent(callbackLogPath: string): Promise<CallbackEventRecord> {
  let record: CallbackEventRecord | undefined

  await vi.waitFor(() => {
    const records = readCallbackEvents(callbackLogPath)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      event: 'task.created',
      hasCreateCard: true,
    })
    record = records[0]
  })

  return record as CallbackEventRecord
}

async function getPort(): Promise<number> {
  const server = http.createServer()
  server.listen(0)
  await once(server, 'listening')
  const port = (server.address() as { port: number }).port
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
  return port
}

async function httpRequest(
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; body: string }> {
  const payload = body === undefined ? undefined : JSON.stringify(body)

  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method,
        headers: payload
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload).toString(),
            }
          : undefined,
      },
      (res) => {
        let responseBody = ''
        res.on('data', (chunk) => {
          responseBody += chunk
        })
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body: responseBody })
        })
      },
    )

    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('callback runtime reachability across kanban-lite host surfaces', () => {
  it('fires the configured callback from direct SDK mutations', async () => {
    const workspace = createCallbackWorkspace('kl-callback-sdk')
    const sdk = new KanbanSDK(workspace.kanbanDir)

    try {
      await sdk.init()
      const created = await sdk.createCard({ content: '# SDK created card' })
      const record = await expectSingleTaskCreatedEvent(workspace.callbackLogPath)

      expect(record.cardId).toBe(created.id)
    } finally {
      sdk.close()
      workspace.cleanup()
    }
  })

  it('fires the configured callback from standalone HTTP mutations', async () => {
    const workspace = createCallbackWorkspace('kl-callback-api')
    const port = await getPort()
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const server = startServer(workspace.kanbanDir, port, undefined, workspace.configPath)

    try {
      if (!server.listening) {
        await once(server, 'listening')
      }

      const response = await httpRequest('POST', `http://127.0.0.1:${port}/api/tasks`, {
        content: '# API created card',
        status: 'backlog',
      })

      expect(response.status).toBe(201)
      const createdId = extractCreatedCardId(JSON.parse(response.body))
      const record = await expectSingleTaskCreatedEvent(workspace.callbackLogPath)

      expect(createdId).toBeDefined()
      expect(record.cardId).toBe(createdId)
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      })
      logSpy.mockRestore()
      errorSpy.mockRestore()
      workspace.cleanup()
    }
  })

  it('fires the configured callback from CLI mutations', async () => {
    const workspace = createCallbackWorkspace('kl-callback-cli')

    try {
      const result = await execFileAsync(
        process.execPath,
        [
          TSX_CLI_PATH,
          CLI_ENTRYPOINT,
          'add',
          '--title',
          'CLI created card',
          '--dir',
          workspace.kanbanDir,
          '--config',
          workspace.configPath,
        ],
        {
          cwd: workspace.workspaceRoot,
          env: { ...process.env, NO_COLOR: '1' },
        },
      )

      expect(result.stdout).toContain('Created:')
  const createdId = stripAnsi(result.stdout).match(/Created:\s+([^\s]+)/)?.[1]
      const record = await expectSingleTaskCreatedEvent(workspace.callbackLogPath)

      expect(createdId).toBeDefined()
      expect(record.cardId).toBe(createdId)
    } finally {
      workspace.cleanup()
    }
  })

  it('fires the configured callback from MCP mutations', async () => {
    const workspace = createCallbackWorkspace('kl-callback-mcp')
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        TSX_CLI_PATH,
        MCP_ENTRYPOINT,
        '--dir',
        workspace.kanbanDir,
        '--config',
        workspace.configPath,
      ],
      cwd: workspace.workspaceRoot,
      env: { ...process.env, NO_COLOR: '1' },
      stderr: 'pipe',
    })
    const client = new Client({ name: 'kl-plugin-callback-test-client', version: '1.0.0' })

    try {
      await client.connect(transport)

      const tools = await client.listTools()
      expect(tools.tools.some((tool) => tool.name === 'create_card')).toBe(true)

      const result = await client.callTool({
        name: 'create_card',
        arguments: {
          title: 'MCP created card',
          body: 'Created from MCP tool',
          status: 'backlog',
        },
      })

      const created = JSON.parse(readMcpTextContent(result)) as { id: string }
      const record = await expectSingleTaskCreatedEvent(workspace.callbackLogPath)

      expect(record.cardId).toBe(created.id)
    } finally {
      await transport.close().catch(() => undefined)
      workspace.cleanup()
    }
  })
})
