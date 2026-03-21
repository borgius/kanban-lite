/**
 * Minimal regression coverage for MCP denial mapping.
 *
 * Verifies that denied admin/config actions surface a stable
 * { isError: true, content: [{type:'text', text: message}] } response
 * and never expose raw token material — matching the error-mapping
 * pattern used throughout src/mcp-server/index.ts.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { KanbanSDK } from '../sdk/KanbanSDK'
import { resolveCapabilityBag } from '../sdk/plugins'
import { AuthError } from '../sdk/types'
import type { AuthContext, AuthDecision } from '../sdk/types'
import type { AuthIdentity } from '../sdk/plugins'

type CapabilityBag = ReturnType<typeof resolveCapabilityBag>

function setCapabilities(sdk: KanbanSDK, bag: CapabilityBag): void {
  ;(sdk as unknown as { _capabilities: CapabilityBag | null })._capabilities = bag
}

function injectDenyAll(sdk: KanbanSDK, kanbanDir: string): void {
  const bag = resolveCapabilityBag(
    { 'card.storage': { provider: 'markdown' }, 'attachment.storage': { provider: 'localfs' } },
    kanbanDir,
  )
  setCapabilities(sdk, {
    ...bag,
    authPolicy: {
      manifest: { id: 'deny-all', provides: ['auth.policy' as const] },
      async checkPolicy(
        _identity: AuthIdentity | null,
        _action: string,
        _ctx: AuthContext,
      ): Promise<AuthDecision> {
        return { allowed: false, reason: 'auth.policy.denied' as const }
      },
    },
  })
}

/**
 * Replicates the error-mapping pattern used by every protected MCP tool
 * handler in src/mcp-server/index.ts:
 *   catch (err) {
 *     if (err instanceof AuthError) return { content: [...], isError: true }
 *     return { content: [...], isError: true }
 *   }
 */
async function mcpHandler<T>(
  fn: () => Promise<T>,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  try {
    const result = await fn()
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  } catch (err) {
    if (err instanceof AuthError) return { content: [{ type: 'text', text: err.message }], isError: true }
    return { content: [{ type: 'text', text: String(err) }], isError: true }
  }
}

describe('MCP auth denial mapping: denied admin action produces stable isError response', () => {
  let workspaceDir: string
  let kanbanDir: string
  let sdk: KanbanSDK

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-mcp-denial-'))
    kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
    sdk = new KanbanSDK(kanbanDir)
    injectDenyAll(sdk, kanbanDir)
  })

  afterEach(() => {
    sdk.close()
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('denied create_board produces isError: true with action-stable message and no token material', async () => {
    const mcpAuthCtx: AuthContext = {
      token: 'secret-mcp-token-must-not-appear-in-response',
      tokenSource: 'env',
      transport: 'mcp',
    }

    const result = await mcpHandler(() =>
      sdk.createBoard('new-board', 'New Board', undefined, mcpAuthCtx),
    )

    expect(result.isError).toBe(true)
    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe('text')
    expect(result.content[0].text).toContain('board.create')
    expect(result.content[0].text).not.toContain('secret-mcp-token-must-not-appear-in-response')
  })

  it('denied delete_board produces isError: true with stable message', async () => {
    const result = await mcpHandler(() =>
      sdk.deleteBoard('default', { transport: 'mcp' }),
    )

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('board.delete')
  })
})
