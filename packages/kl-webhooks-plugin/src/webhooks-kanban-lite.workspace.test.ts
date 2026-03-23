/**
 * Workspace integration tests for kl-webhooks-plugin.
 *
 * Proves that kl-webhooks-plugin is loaded and active when consumed through the
 * kanban-lite KanbanSDK in the workspace context.  KanbanSDK resolves the
 * webhook provider through the "webhooks" alias → packages/kl-webhooks-plugin.
 *
 * Prerequisites: run `pnpm build` (or `pnpm --filter kanban-lite build`) first.
 */
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// Resolve workspace kanban-lite SDK
// ---------------------------------------------------------------------------

interface WorkspaceKanbanSDK {
  getWebhookStatus(): { webhookProvider: string; webhookProviderActive: boolean }
  readonly capabilities?: { webhookListener?: { manifest: { id: string } } } | null
  createCard(input: { content: string }): Promise<unknown>
  close(): void
}

function loadWorkspaceKanbanLiteSdk(): { KanbanSDK: new (dir: string, opts?: Record<string, unknown>) => WorkspaceKanbanSDK } {
  let dir = __dirname
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      const sdkPath = path.join(dir, 'packages', 'kanban-lite', 'dist', 'sdk', 'index.cjs')
      if (!fs.existsSync(sdkPath)) {
        throw new Error(`kanban-lite SDK not built at: ${sdkPath}\nRun: pnpm build`)
      }
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require(sdkPath) as { KanbanSDK: new (dir: string, opts?: Record<string, unknown>) => WorkspaceKanbanSDK }
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error('Cannot find workspace root (pnpm-workspace.yaml not found)')
}

const { KanbanSDK } = loadWorkspaceKanbanLiteSdk()

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('kl-webhooks-plugin: consumption via kanban-lite workspace SDK', () => {
  let workspaceDir: string
  let kanbanDir: string

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kl-webhooks-ws-'))
    kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('KanbanSDK resolves kl-webhooks-plugin as the active webhook.delivery provider', () => {
    const sdk = new KanbanSDK(kanbanDir)
    const status = sdk.getWebhookStatus()
    expect(status.webhookProvider).toBe('webhooks')
    expect(status.webhookProviderActive).toBe(true)
    expect(sdk.capabilities?.webhookListener?.manifest.id).toBe('webhooks')
    sdk.close()
  })

  it('KanbanSDK uses the package listener for one committed after-event delivery', async () => {
    const received: Array<{ event: string; timestamp: string; data: unknown }> = []
    const server = http.createServer((req, res) => {
      let body = ''
      req.on('data', (chunk: Buffer) => { body += chunk.toString() })
      req.on('end', () => {
        received.push(JSON.parse(body) as { event: string; timestamp: string; data: unknown })
        res.writeHead(200)
        res.end()
      })
    })

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port

    fs.writeFileSync(
      path.join(workspaceDir, '.kanban.json'),
      JSON.stringify(
        {
          version: 2,
          boards: {
            default: {
              name: 'Default',
              columns: [{ id: 'backlog', name: 'Backlog' }],
              nextCardId: 1,
              defaultStatus: 'backlog',
              defaultPriority: 'medium',
            },
          },
          defaultBoard: 'default',
          kanbanDirectory: '.kanban',
          webhooks: [
            {
              id: 'wh_pkg_listener',
              url: `http://127.0.0.1:${port}/hook`,
              events: ['task.created'],
              active: true,
            },
          ],
        },
        null,
        2,
      ) + '\n',
      'utf-8',
    )

    const sdk = new KanbanSDK(kanbanDir)
    expect(sdk.capabilities?.webhookListener?.manifest.id).toBe('webhooks')

    try {
      await sdk.createCard({ content: '# Plugin listener delivery' })
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(received).toHaveLength(1)
      expect(received[0].event).toBe('task.created')
    } finally {
      sdk.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
