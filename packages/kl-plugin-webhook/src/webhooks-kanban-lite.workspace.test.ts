/**
 * Workspace integration tests for kl-plugin-webhook.
 *
 * Proves that kl-plugin-webhook is loaded and active when consumed through the
 * kanban-lite KanbanSDK in the workspace context.  KanbanSDK resolves the
 * webhook provider through the "webhooks" alias → packages/kl-plugin-webhook.
 *
 * Prerequisites: run `pnpm build` (or `pnpm --filter kanban-lite build`) first.
 */
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTempKanbanWorkspace, loadWorkspaceKanbanLiteSdk } from '../../kanban-lite/src/test-utils/workspace'

// ---------------------------------------------------------------------------
// Resolve workspace kanban-lite SDK
// ---------------------------------------------------------------------------

interface WorkspaceKanbanSDK {
  getWebhookStatus(): { webhookProvider: string; webhookProviderActive: boolean }
  listWebhooks(): Array<{ id: string; url: string; events: string[]; active: boolean }>
  getConfigSnapshot(): {
    webhooks?: Array<{ id: string; url: string; events: string[]; active: boolean }>
    plugins?: { 'webhook.delivery'?: { provider?: string } }
  }
  getExtension<T extends Record<string, unknown>>(id: string): T | undefined
  readonly capabilities?: {
    webhookListener?: { manifest: { id: string } }
    standaloneHttpPlugins?: ReadonlyArray<{ manifest: { id: string } }>
    sdkExtensions?: ReadonlyArray<{ id: string; extensions: Record<string, unknown> }>
  } | null
  createCard(input: { content: string }): Promise<unknown>
  close(): void
}

const { KanbanSDK } = loadWorkspaceKanbanLiteSdk<{ KanbanSDK: new (dir: string, opts?: Record<string, unknown>) => WorkspaceKanbanSDK }>(__dirname)

function writeWebhookOnlyConfig(workspaceDir: string): void {
  fs.writeFileSync(
    path.join(workspaceDir, '.kanban.json'),
    JSON.stringify(
      {
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
          'webhook.delivery': { provider: 'webhooks' },
        },
      },
      null,
      2,
    ) + '\n',
    'utf-8',
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('kl-plugin-webhook: consumption via kanban-lite workspace SDK', () => {
  let workspaceDir: string
  let kanbanDir: string
  let cleanupWorkspace = () => {}

  beforeEach(() => {
    ;({ workspaceDir, kanbanDir, cleanup: cleanupWorkspace } = createTempKanbanWorkspace('kl-webhooks-ws-'))
  })

  afterEach(() => {
    cleanupWorkspace()
  })

  it('KanbanSDK resolves kl-plugin-webhook as the active webhook.delivery provider', () => {
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

  it('plugin standaloneHttpPlugin is registered under webhook-only config', () => {
    writeWebhookOnlyConfig(workspaceDir)
    const sdk = new KanbanSDK(kanbanDir)
    const status = sdk.getWebhookStatus()
    const snapshot = sdk.getConfigSnapshot()
    const standalonePlugins = sdk.capabilities?.standaloneHttpPlugins ?? []
    expect(status.webhookProvider).toBe('webhooks')
    expect(status.webhookProviderActive).toBe(true)
    expect(snapshot.plugins?.['webhook.delivery']?.provider).toBe('webhooks')
    expect(sdk.capabilities?.webhookListener?.manifest.id).toBe('webhooks')
    expect(standalonePlugins.some((p) => p.manifest.id === 'webhooks')).toBe(true)
    sdk.close()
  })

  it('getExtension("kl-plugin-webhook") returns the webhook extension pack', () => {
    const sdk = new KanbanSDK(kanbanDir)
    const ext = sdk.getExtension<{ listWebhooks(root: string): unknown[] }>('kl-plugin-webhook')
    expect(ext).toBeDefined()
    expect(typeof ext?.listWebhooks).toBe('function')
    sdk.close()
  })

  it('sdk.capabilities.sdkExtensions contains an entry for kl-plugin-webhook', () => {
    const sdk = new KanbanSDK(kanbanDir)
    const exts = sdk.capabilities?.sdkExtensions ?? []
    const entry = exts.find((e) => e.id === 'kl-plugin-webhook')
    expect(entry).toBeDefined()
    sdk.close()
  })

  it('public SDK webhook reads expose the same persisted webhooks through listWebhooks and getConfigSnapshot', async () => {
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
            { id: 'wh_ext_test', url: 'http://127.0.0.1:9999/hook', events: ['*'], active: true },
          ],
        },
        null,
        2,
      ) + '\n',
      'utf-8',
    )
    const sdk = new KanbanSDK(kanbanDir)
    const list = sdk.listWebhooks()
    const snapshot = sdk.getConfigSnapshot()
    expect(list.some((w) => w.id === 'wh_ext_test')).toBe(true)
    expect(snapshot.webhooks?.some((w) => w.id === 'wh_ext_test')).toBe(true)
    sdk.close()
  })
})
