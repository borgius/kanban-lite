import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { KanbanSDK } from '../KanbanSDK'
import { resolveCapabilityBag } from '../plugins'
import { AuthError } from '../types'
import type { AuthContext, AuthDecision } from '../types'
import type { AuthIdentity } from '../plugins'

type CapabilityBag = ReturnType<typeof resolveCapabilityBag>

function setCapabilities(sdk: KanbanSDK, bag: CapabilityBag): void {
  ;(sdk as unknown as { _capabilities: CapabilityBag | null })._capabilities = bag
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-auth-enf-'))
}

/** Build a deny-all policy plugin that records each action it receives. */
function makeDenyAllPolicy(captured: string[] = []) {
  return {
    manifest: { id: 'deny-all-test', provides: ['auth.policy' as const] },
    async checkPolicy(
      _identity: AuthIdentity | null,
      action: string,
      _ctx: AuthContext,
    ): Promise<AuthDecision> {
      captured.push(action)
      return { allowed: false, reason: 'auth.policy.denied' as const }
    },
  }
}

/**
 * Inject a deny-all policy into an SDK instance.
 * Returns the array that accumulates captured action strings.
 */
function injectDenyAll(sdk: KanbanSDK, kanbanDir: string): string[] {
  const captured: string[] = []
  const bag = resolveCapabilityBag(
    { 'card.storage': { provider: 'markdown' }, 'attachment.storage': { provider: 'localfs' } },
    kanbanDir,
  )
  setCapabilities(sdk, { ...bag, authPolicy: makeDenyAllPolicy(captured) })
  return captured
}

// ---------------------------------------------------------------------------
// Suite 1: privileged async mutating methods throw AuthError under a deny-all policy
// ---------------------------------------------------------------------------

describe('auth enforcement: deny-all policy causes AuthError on every mutating method', () => {
  let workspaceDir: string
  let kanbanDir: string
  let sdk: KanbanSDK

  beforeEach(() => {
    workspaceDir = createTempDir()
    kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
    sdk = new KanbanSDK(kanbanDir)
    injectDenyAll(sdk, kanbanDir)
  })

  afterEach(() => {
    sdk.close()
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  const cases: Array<[string, (s: KanbanSDK) => Promise<unknown>]> = [
    ['deleteBoard', s => s.deleteBoard('default')],
    ['createCard', s => s.createCard({ content: '# T' })],
    ['updateCard', s => s.updateCard('kl-1', { content: '# Updated' })],
    ['moveCard', s => s.moveCard('kl-1', 'in-progress')],
    ['deleteCard', s => s.deleteCard('kl-1')],
    ['permanentlyDeleteCard', s => s.permanentlyDeleteCard('kl-1')],
    ['addAttachment', s => s.addAttachment('kl-1', '/tmp/file.txt')],
    ['removeAttachment', s => s.removeAttachment('kl-1', 'file.txt')],
    ['addComment', s => s.addComment('kl-1', 'alice', 'Hello')],
    ['updateComment', s => s.updateComment('kl-1', 'c1', 'Updated')],
    ['deleteComment', s => s.deleteComment('kl-1', 'c1')],
    ['removeColumn', s => s.removeColumn('backlog')],
    ['submitForm', s => s.submitForm({ cardId: 'kl-1', formId: 'triage', data: {} })],
    ['transferCard', s => s.transferCard('kl-1', 'default', 'bugs', 'todo')],
    ['triggerAction', s => s.triggerAction('kl-1', 'retry')],
    ['triggerBoardAction', s => s.triggerBoardAction('default', 'deploy')],
    ['addLog', s => s.addLog('kl-1', 'Build started')],
    ['clearLogs', s => s.clearLogs('kl-1')],
    ['addBoardLog', s => s.addBoardLog('Board deploy started', undefined, 'default')],
    ['clearBoardLogs', s => s.clearBoardLogs('default')],
    ['cleanupColumn', s => s.cleanupColumn('backlog')],
    ['purgeDeletedCards', s => s.purgeDeletedCards('default')],
    ['renameLabel', s => s.renameLabel('bug', 'defect')],
    ['deleteLabel', s => s.deleteLabel('bug')],
    ['createBoard', s => s.createBoard('new-board', 'New Board')],
    ['updateBoard', s => s.updateBoard('default', { name: 'Updated' })],
    ['addBoardAction', s => s.addBoardAction('default', 'deploy', 'Deploy')],
    ['removeBoardAction', s => s.removeBoardAction('default', 'deploy')],
    ['setLabel', s => s.setLabel('bug', { color: '#e11d48' })],
    ['addColumn', s => s.addColumn({ id: 'new-col', name: 'New', color: '#000' })],
    ['updateColumn', s => s.updateColumn('backlog', { name: 'Updated' })],
    ['reorderColumns', s => s.reorderColumns(['backlog'])],
    ['setMinimizedColumns', s => s.setMinimizedColumns(['backlog'])],
    ['updateSettings', s => s.updateSettings({ showPriorityBadges: true, showAssignee: true, showDueDate: false, showLabels: true, showBuildWithAI: false, showFileName: false, compactMode: false, markdownEditorMode: false, showDeletedColumn: false, defaultPriority: 'medium', defaultStatus: 'backlog', boardZoom: 100, cardZoom: 100 })],
    ['setDefaultBoard', s => s.setDefaultBoard('default')],
    ['createWebhook', s => s.createWebhook({ url: 'https://example.com', events: ['*'] })],
    ['updateWebhook', s => s.updateWebhook('wh-1', { url: 'https://updated.com' })],
    ['deleteWebhook', s => s.deleteWebhook('wh-1')],
    ['migrateToSqlite', s => s.migrateToSqlite()],
    ['migrateToMarkdown', s => s.migrateToMarkdown()],
  ]

  for (const [label, invoke] of cases) {
    it(`${label} throws AuthError`, async () => {
      await expect(invoke(sdk)).rejects.toBeInstanceOf(AuthError)
    })
  }
})

// ---------------------------------------------------------------------------
// Suite 2: AuthError carries auth.policy.denied category
// ---------------------------------------------------------------------------

describe('auth enforcement: AuthError category', () => {
  let workspaceDir: string
  let kanbanDir: string
  let sdk: KanbanSDK

  beforeEach(() => {
    workspaceDir = createTempDir()
    kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
    sdk = new KanbanSDK(kanbanDir)
    injectDenyAll(sdk, kanbanDir)
  })

  afterEach(() => {
    sdk.close()
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('AuthError from createCard carries category auth.policy.denied', async () => {
    try {
      await sdk.createCard({ content: '# T' })
      throw new Error('Expected AuthError')
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError)
      expect((err as AuthError).category).toBe('auth.policy.denied')
    }
  })

  it('AuthError from deleteBoard carries category auth.policy.denied', async () => {
    try {
      await sdk.deleteBoard('default')
      throw new Error('Expected AuthError')
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError)
      expect((err as AuthError).category).toBe('auth.policy.denied')
    }
  })
})

// ---------------------------------------------------------------------------
// Suite 3: action names sent to the policy plugin
// ---------------------------------------------------------------------------

describe('auth enforcement: action names dispatched to policy plugin', () => {
  let workspaceDir: string
  let kanbanDir: string
  let sdk: KanbanSDK
  let captured: string[]

  beforeEach(() => {
    workspaceDir = createTempDir()
    kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
    sdk = new KanbanSDK(kanbanDir)
    captured = injectDenyAll(sdk, kanbanDir)
  })

  afterEach(() => {
    sdk.close()
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  const cases: Array<[string, (s: KanbanSDK) => Promise<unknown>]> = [
    ['board.delete',      s => s.deleteBoard('default')],
    ['card.create',       s => s.createCard({ content: '# T' })],
    ['card.update',       s => s.updateCard('kl-1', { content: '# T' })],
    ['card.move',         s => s.moveCard('kl-1', 'in-progress')],
    ['card.delete',       s => s.deleteCard('kl-1')],
    ['card.delete',       s => s.permanentlyDeleteCard('kl-1')],
    ['attachment.add',    s => s.addAttachment('kl-1', '/tmp/f.txt')],
    ['attachment.remove', s => s.removeAttachment('kl-1', 'f.txt')],
    ['comment.create',    s => s.addComment('kl-1', 'alice', 'hi')],
    ['comment.update',    s => s.updateComment('kl-1', 'c1', 'updated')],
    ['comment.delete',    s => s.deleteComment('kl-1', 'c1')],
    ['column.delete',     s => s.removeColumn('backlog')],
    ['form.submit',       s => s.submitForm({ cardId: 'kl-1', formId: 'triage', data: {} })],
    ['card.transfer',     s => s.transferCard('kl-1', 'default', 'bugs', 'todo')],
    ['card.action.trigger', s => s.triggerAction('kl-1', 'retry')],
    ['board.action.trigger', s => s.triggerBoardAction('default', 'deploy')],
    ['log.add',           s => s.addLog('kl-1', 'Build started')],
    ['log.clear',         s => s.clearLogs('kl-1')],
    ['board.log.add',     s => s.addBoardLog('Board log', undefined, 'default')],
    ['board.log.clear',   s => s.clearBoardLogs('default')],
    ['column.cleanup',    s => s.cleanupColumn('backlog')],
    ['card.purgeDeleted', s => s.purgeDeletedCards('default')],
    ['label.rename',      s => s.renameLabel('bug', 'defect')],
    ['label.delete',      s => s.deleteLabel('bug')],
    ['board.create',               s => s.createBoard('new-board', 'New Board')],
    ['board.update',               s => s.updateBoard('default', { name: 'Updated' })],
    ['board.action.config.add',    s => s.addBoardAction('default', 'deploy', 'Deploy')],
    ['board.action.config.remove', s => s.removeBoardAction('default', 'deploy')],
    ['label.set',                  s => s.setLabel('bug', { color: '#e11d48' })],
    ['column.create',              s => s.addColumn({ id: 'new-col', name: 'New', color: '#000' })],
    ['column.update',              s => s.updateColumn('backlog', { name: 'Updated' })],
    ['column.reorder',             s => s.reorderColumns(['backlog'])],
    ['column.setMinimized',        s => s.setMinimizedColumns(['backlog'])],
    ['settings.update',            s => s.updateSettings({ showPriorityBadges: true, showAssignee: true, showDueDate: false, showLabels: true, showBuildWithAI: false, showFileName: false, compactMode: false, markdownEditorMode: false, showDeletedColumn: false, defaultPriority: 'medium', defaultStatus: 'backlog', boardZoom: 100, cardZoom: 100 })],
    ['board.setDefault',           s => s.setDefaultBoard('default')],
    ['webhook.create',             s => s.createWebhook({ url: 'https://example.com', events: ['*'] })],
    ['webhook.update',             s => s.updateWebhook('wh-1', { url: 'https://updated.com' })],
    ['webhook.delete',             s => s.deleteWebhook('wh-1')],
    ['storage.migrate',            s => s.migrateToSqlite()],
    ['storage.migrate',            s => s.migrateToMarkdown()],
  ]

  for (const [expectedAction, invoke] of cases) {
    it(`'${expectedAction}' is dispatched (${invoke.toString().match(/s\.\w+/)?.[0] ?? ''})`, async () => {
      await expect(invoke(sdk)).rejects.toBeInstanceOf(AuthError)
      expect(captured).toContain(expectedAction)
    })
  }
})

// ---------------------------------------------------------------------------
// Suite 4: noop path — no capabilities means all actions pass through
// ---------------------------------------------------------------------------

describe('auth enforcement: noop path (storage injected directly)', () => {
  it('_authorizeAction returns allowed:true when _capabilities is null', async () => {
    const workspaceDir = createTempDir()
    const kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })

    const { MarkdownStorageEngine } = await import('../plugins/markdown')
    const storage = new MarkdownStorageEngine(kanbanDir)
    const sdk = new KanbanSDK(kanbanDir, { storage })

    try {
      expect(sdk.capabilities).toBeNull()
      const decision = await sdk._authorizeAction('card.create')
      expect(decision.allowed).toBe(true)
    } finally {
      sdk.close()
      fs.rmSync(workspaceDir, { recursive: true, force: true })
    }
  })

  it('_authorizeAction passes auth context through without error when no capabilities', async () => {
    const workspaceDir = createTempDir()
    const kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })

    const { MarkdownStorageEngine } = await import('../plugins/markdown')
    const storage = new MarkdownStorageEngine(kanbanDir)
    const sdk = new KanbanSDK(kanbanDir, { storage })
    const ctx: AuthContext = { token: 'secret-token', tokenSource: 'env', transport: 'cli' }

    try {
      const decision = await sdk._authorizeAction('board.delete', ctx)
      expect(decision.allowed).toBe(true)
    } finally {
      sdk.close()
      fs.rmSync(workspaceDir, { recursive: true, force: true })
    }
  })
})

describe('auth enforcement: SDK enriches auth context with target hints', () => {
  let workspaceDir: string
  let kanbanDir: string
  let sdk: KanbanSDK
  let captured: Array<{ action: string; context: AuthContext }>

  beforeEach(() => {
    workspaceDir = createTempDir()
    kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
    sdk = new KanbanSDK(kanbanDir)
    captured = []

    const bag = resolveCapabilityBag(
      { 'card.storage': { provider: 'markdown' }, 'attachment.storage': { provider: 'localfs' } },
      kanbanDir,
    )

    setCapabilities(sdk, {
      ...bag,
      authPolicy: {
        manifest: { id: 'capture-and-deny', provides: ['auth.policy' as const] },
        async checkPolicy(_identity: AuthIdentity | null, action: string, context: AuthContext): Promise<AuthDecision> {
          captured.push({ action, context: { ...context } })
          return { allowed: false, reason: 'auth.policy.denied' }
        },
      },
    })
  })

  afterEach(() => {
    sdk.close()
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('passes board/card/comment hints for updateComment', async () => {
    await expect(sdk.updateComment('card-1', 'c1', 'Updated', 'default', { transport: 'cli' })).rejects.toBeInstanceOf(AuthError)

    expect(captured).toContainEqual({
      action: 'comment.update',
      context: expect.objectContaining({
        transport: 'cli',
        boardId: 'default',
        cardId: 'card-1',
        commentId: 'c1',
      }),
    })
  })

  it('passes transfer target hints for transferCard', async () => {
    await expect(sdk.transferCard('card-2', 'default', 'bugs', 'todo', { transport: 'mcp' })).rejects.toBeInstanceOf(AuthError)

    expect(captured).toContainEqual({
      action: 'card.transfer',
      context: expect.objectContaining({
        transport: 'mcp',
        cardId: 'card-2',
        fromBoardId: 'default',
        toBoardId: 'bugs',
        columnId: 'todo',
      }),
    })
  })
})
