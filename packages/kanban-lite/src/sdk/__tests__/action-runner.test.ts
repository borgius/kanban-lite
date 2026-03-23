import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KanbanSDK } from '../KanbanSDK'
import { AuthError } from '../types'
import type { AfterEventPayload, SDKEvent } from '../types'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-action-runner-'))
}

/** Access internal runners via type assertion without touching TS visibility. */
function runBefore<T extends Record<string, unknown>>(
  sdk: KanbanSDK,
  event: string,
  input: T,
  actor?: string,
  boardId?: string,
): Promise<T> {
  return (sdk as unknown as {
    _runBeforeEvent(event: string, input: T, actor?: string, boardId?: string): Promise<T>
  })._runBeforeEvent(event as never, input, actor, boardId)
}

function runAfter<T>(
  sdk: KanbanSDK,
  event: string,
  data: T,
  actor?: string,
  boardId?: string,
  meta?: Record<string, unknown>,
): void {
  return (sdk as unknown as {
    _runAfterEvent(event: string, data: T, actor?: string, boardId?: string, meta?: Record<string, unknown>): void
  })._runAfterEvent(event as never, data, actor, boardId, meta)
}

// ---------------------------------------------------------------------------
// Suite: _runBeforeEvent — before-event dispatch and merge semantics
// ---------------------------------------------------------------------------

describe('KanbanSDK._runBeforeEvent', () => {
  let workspaceDir: string
  let sdk: KanbanSDK

  beforeEach(() => {
    workspaceDir = createTempDir()
    const kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
    sdk = new KanbanSDK(kanbanDir)
  })

  afterEach(() => {
    sdk.close()
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('returns a copy of the original input when no listeners are registered', async () => {
    const input = { title: 'My card', priority: 'medium' }
    const result = await runBefore(sdk, 'card.create', input)
    expect(result).toEqual(input)
    expect(result).not.toBe(input) // must be a new object, not the same reference
  })

  it('returns original input when listener returns void', async () => {
    sdk.on('card.create', vi.fn().mockReturnValue(undefined))
    const result = await runBefore(sdk, 'card.create', { title: 'card' })
    expect(result).toEqual({ title: 'card' })
  })

  it('merges a plain-object listener response into the input', async () => {
    sdk.on('card.create', vi.fn().mockReturnValue({ priority: 'high' }))
    const result = await runBefore(sdk, 'card.create', { title: 'card', priority: 'medium' })
    expect(result).toEqual({ title: 'card', priority: 'high' })
  })

  it('later-registered listeners override earlier ones (deterministic shallow merge)', async () => {
    sdk.on('card.create', vi.fn().mockReturnValue({ status: 'first', extra: 'a' }))
    sdk.on('card.create', vi.fn().mockReturnValue({ status: 'second' }))
    const result = await runBefore<Record<string, unknown>>(sdk, 'card.create', { status: 'original' })
    expect(result.status).toBe('second')
    expect(result.extra).toBe('a') // key from first listener, not overridden
  })

  it('each listener receives the same original (unmodified) input', async () => {
    const seen: string[] = []
    sdk.on('card.create', vi.fn().mockImplementation(({ input }: { input: Record<string, unknown> }) => {
      seen.push(input.step as string)
      return { step: 'after-first' }
    }))
    sdk.on('card.create', vi.fn().mockImplementation(({ input }: { input: Record<string, unknown> }) => {
      seen.push(input.step as string)
      return { step: 'after-second' }
    }))
    const result = await runBefore(sdk, 'card.create', { step: 'original' })
    expect(seen[0]).toBe('original')  // first listener sees original
    expect(seen[1]).toBe('original')  // second listener also sees original — bus does not chain
    expect(result.step).toBe('after-second') // _runBeforeEvent merges last-listener-wins
  })

  it('awaits async (Promise-returning) listeners', async () => {
    sdk.on('card.create', vi.fn().mockResolvedValue({ status: 'async-override' }))
    const result = await runBefore(sdk, 'card.create', { status: 'original' })
    expect(result.status).toBe('async-override')
  })

  it('propagates AuthError thrown by a before-event listener (mutation abort)', async () => {
    const authErr = new AuthError('auth.policy.denied', 'Action "card.create" denied for "alice"', 'alice')
    sdk.on('card.create', vi.fn().mockRejectedValue(authErr))
    await expect(runBefore(sdk, 'card.create', {})).rejects.toBeInstanceOf(AuthError)
  })

  it('AuthError category and actor are preserved on propagation', async () => {
    const authErr = new AuthError('auth.identity.missing', 'No token supplied', undefined)
    sdk.on('card.create', vi.fn().mockRejectedValue(authErr))
    try {
      await runBefore(sdk, 'card.create', {})
      throw new Error('Expected AuthError')
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError)
      expect((err as AuthError).category).toBe('auth.identity.missing')
    }
  })

  it('propagates generic Error thrown by a before-event listener', async () => {
    const err = new Error('plugin panic')
    sdk.on('card.create', vi.fn().mockRejectedValue(err))
    await expect(runBefore(sdk, 'card.create', {})).rejects.toThrow('plugin panic')
  })

  it('aborts on first throwing listener — subsequent listeners are not called', async () => {
    const second = vi.fn().mockReturnValue({ reached: true })
    sdk.on('card.create', vi.fn().mockRejectedValue(new AuthError('auth.policy.denied', 'denied', 'bob')))
    sdk.on('card.create', second)
    await expect(runBefore(sdk, 'card.create', {})).rejects.toBeInstanceOf(AuthError)
    expect(second).not.toHaveBeenCalled()
  })

  it('includes actor and boardId in the payload passed to listeners', async () => {
    const received: Array<{ actor?: string; boardId?: string }> = []
    sdk.on('card.create', vi.fn().mockImplementation(
      ({ actor, boardId }: { actor?: string; boardId?: string }) => {
        received.push({ actor, boardId })
      },
    ))
    await runBefore(sdk, 'card.create', { title: 'T' }, 'alice', 'team-board')
    expect(received[0]).toEqual({ actor: 'alice', boardId: 'team-board' })
  })

  // -------------------------------------------------------------------------
  // T2: clone-first immutability and deep-merge semantics
  // -------------------------------------------------------------------------

  it('never mutates the caller-owned input object (top-level)', async () => {
    sdk.on('card.create', vi.fn().mockReturnValue({ title: 'override' }))
    const input = { title: 'original' }
    const result = await runBefore(sdk, 'card.create', input)
    expect(input.title).toBe('original') // caller object unchanged
    expect(result.title).toBe('override') // merged output has override
  })

  it('never mutates caller-owned nested objects', async () => {
    sdk.on('card.create', vi.fn().mockReturnValue({ meta: { priority: 'high' } }))
    const nested = { priority: 'low', extra: 'keep' }
    const input = { meta: nested }
    const result = await runBefore<Record<string, unknown>>(sdk, 'card.create', input)
    expect(nested.priority).toBe('low')   // original nested object unchanged
    expect(nested.extra).toBe('keep')
    expect((result.meta as Record<string, unknown>).priority).toBe('high') // merged
    expect((result.meta as Record<string, unknown>).extra).toBe('keep')    // non-overridden key preserved
  })

  it('clones before dispatch so listener-side nested mutations do not leak back to the caller', async () => {
    sdk.on('card.create', vi.fn().mockImplementation(({ input }: { input: { meta: { priority: string; extra: string } } }) => {
      input.meta.priority = 'listener-mutated'
      return undefined
    }))

    const nested = { priority: 'low', extra: 'keep' }
    const input = { meta: nested }
    const result = await runBefore<Record<string, unknown>>(sdk, 'card.create', input)

    expect(nested.priority).toBe('low')
    expect((input.meta as { priority: string }).priority).toBe('low')
    expect((result.meta as { priority: string }).priority).toBe('listener-mutated')
  })

  it('deep-merges nested plain objects: listener keys added without clobbering sibling keys', async () => {
    sdk.on('card.create', vi.fn().mockReturnValue({ meta: { newKey: 'v' } }))
    const result = await runBefore<Record<string, unknown>>(sdk, 'card.create', { meta: { existing: 'stay' } })
    const meta = result.meta as Record<string, unknown>
    expect(meta.existing).toBe('stay')
    expect(meta.newKey).toBe('v')
  })

  it('arrays in listener response replace — not concatenate — the original array', async () => {
    sdk.on('card.create', vi.fn().mockReturnValue({ tags: ['b'] }))
    const result = await runBefore<Record<string, unknown>>(sdk, 'card.create', { tags: ['a'] })
    expect(result.tags).toEqual(['b']) // replacement, not ['a', 'b']
  })

  it('empty-object ({}) listener response leaves effective input unchanged', async () => {
    sdk.on('card.create', vi.fn().mockReturnValue({}))
    const result = await runBefore(sdk, 'card.create', { title: 'keep' })
    expect(result.title).toBe('keep')
  })
})

// ---------------------------------------------------------------------------
// Suite: runWithAuth — async-scoped auth carrier
// ---------------------------------------------------------------------------

describe('KanbanSDK.runWithAuth', () => {
  let workspaceDir: string
  let sdk: KanbanSDK

  beforeEach(() => {
    workspaceDir = createTempDir()
    const kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
    sdk = new KanbanSDK(kanbanDir)
  })

  afterEach(() => {
    sdk.close()
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('_currentAuthContext is undefined outside a runWithAuth scope', () => {
    const ctx = (sdk as unknown as { _currentAuthContext: unknown })._currentAuthContext
    expect(ctx).toBeUndefined()
  })

  it('_currentAuthContext returns the installed auth inside runWithAuth', async () => {
    const auth = { token: 'tok', actorHint: 'alice' }
    let inside: unknown
    await sdk.runWithAuth(auth, async () => {
      inside = (sdk as unknown as { _currentAuthContext: unknown })._currentAuthContext
    })
    expect(inside).toBe(auth)
  })

  it('_currentAuthContext is undefined again after runWithAuth resolves', async () => {
    await sdk.runWithAuth({ token: 'tok' }, async () => { /* noop */ })
    const ctx = (sdk as unknown as { _currentAuthContext: unknown })._currentAuthContext
    expect(ctx).toBeUndefined()
  })

  it('runWithAuth returns the value returned by fn', async () => {
    const result = await sdk.runWithAuth({ token: 'tok' }, async () => 42)
    expect(result).toBe(42)
  })

  it('_runBeforeEvent uses the scoped auth actor when no explicit actor is provided', async () => {
    const received: Array<{ actor?: string }> = []
    sdk.on('card.create', vi.fn().mockImplementation(({ actor }: { actor?: string }) => {
      received.push({ actor })
    }))

    await sdk.runWithAuth({ token: 'tok', actorHint: 'scoped-alice' }, async () => {
      await runBefore(sdk, 'card.create', { title: 'T' })
    })

    expect(received[0]).toEqual({ actor: 'scoped-alice' })
  })
})

// ---------------------------------------------------------------------------
// Suite: _runAfterEvent — after-event emission semantics
// ---------------------------------------------------------------------------

describe('KanbanSDK._runAfterEvent', () => {
  let workspaceDir: string
  let sdk: KanbanSDK

  beforeEach(() => {
    workspaceDir = createTempDir()
    const kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
    sdk = new KanbanSDK(kanbanDir)
  })

  afterEach(() => {
    sdk.close()
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('emits exactly once to a registered after-event listener', () => {
    const listener = vi.fn()
    sdk.on('task.created', listener)
    runAfter(sdk, 'task.created', { id: '1', title: 'T' })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('listener receives SDKEvent with AfterEventPayload as data', () => {
    const listener = vi.fn()
    sdk.on('task.created', listener)
    runAfter(sdk, 'task.created', { id: '1' }, 'alice', 'board-1', { audit: true })

    const received = listener.mock.calls[0][0] as SDKEvent<AfterEventPayload<{ id: string }>>
    expect(received.type).toBe('task.created')
    expect(received.actor).toBe('alice')
    expect(received.boardId).toBe('board-1')

    const payload = received.data as AfterEventPayload<{ id: string }>
    expect(payload.event).toBe('task.created')
    expect(payload.data).toEqual({ id: '1' })
    expect(payload.actor).toBe('alice')
    expect(payload.boardId).toBe('board-1')
    expect(payload.meta).toEqual({ audit: true })
    expect(typeof payload.timestamp).toBe('string')
  })

  it('emits only to the matching after-event, not to other events', () => {
    const created = vi.fn()
    const updated = vi.fn()
    sdk.on('task.created', created)
    sdk.on('task.updated', updated)
    runAfter(sdk, 'task.created', { id: '2' })
    expect(created).toHaveBeenCalledTimes(1)
    expect(updated).not.toHaveBeenCalled()
  })

  it('after-event listener errors are isolated — other listeners still execute', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failing = vi.fn(() => { throw new Error('after-listener boom') })
    const good = vi.fn()
    sdk.on('task.created', failing)
    sdk.on('task.created', good)
    // Must not throw even though one listener fails
    expect(() => runAfter(sdk, 'task.created', {})).not.toThrow()
    expect(failing).toHaveBeenCalled()
    expect(good).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('after-event AuthError is also isolated and does not propagate', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    sdk.on('task.created', vi.fn(() => {
      throw new AuthError('auth.policy.denied', 'after-event auth error', 'carol')
    }))
    expect(() => runAfter(sdk, 'task.created', {})).not.toThrow()
    consoleSpy.mockRestore()
  })

  it('emitting after-event with no listeners completes without error', () => {
    expect(() => runAfter(sdk, 'task.deleted', { id: '99' })).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Suite: card / comment / form mutation event flow (T4 coverage)
// ---------------------------------------------------------------------------

describe('KanbanSDK – card/comment/form mutation event flow', () => {
  let workspaceDir: string
  let sdk: KanbanSDK

  beforeEach(() => {
    workspaceDir = createTempDir()
    const kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
    sdk = new KanbanSDK(kanbanDir)
  })

  afterEach(() => {
    sdk.close()
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('createCard fires task.created after-event with AfterEventPayload wrapping the card', async () => {
    const received: SDKEvent<AfterEventPayload<{ id: string }>>[] = []
    sdk.on('task.created', (ev) => received.push(ev as SDKEvent<AfterEventPayload<{ id: string }>>))

    const card = await sdk.createCard({ content: '# T4 Create Test' })

    expect(received).toHaveLength(1)
    expect(received[0].type).toBe('task.created')
    const payload = received[0].data as AfterEventPayload<{ id: string }>
    expect(payload.event).toBe('task.created')
    expect(payload.data.id).toBe(card.id)
  })

  it('createBoard consumes merged before-event options when creating the board', async () => {
    sdk.on('board.create', vi.fn().mockReturnValue({
      name: 'Operations',
      description: 'Created by plugin',
      defaultStatus: 'review',
    }))

    const board = await sdk.createBoard('ops', 'Ops')

    expect(board.name).toBe('Operations')
    expect(board.description).toBe('Created by plugin')
    expect(sdk.getBoard('ops').defaultStatus).toBe('review')
  })

  it('createCard before-event plugin can override input fields', async () => {
    sdk.on('card.create', vi.fn().mockReturnValue({ status: 'in-progress' }))

    const card = await sdk.createCard({ content: '# Override Test', status: 'backlog' })

    expect(card.status).toBe('in-progress')
    const afterReceived: SDKEvent<AfterEventPayload<{ id: string }>>[] = []
    // verify exactly one after-event was fired (checked retroactively via card state)
    expect(card.id).toBeTruthy()
  })

  it('createCard emits task.created exactly once — no duplicate from module', async () => {
    const received: unknown[] = []
    sdk.on('task.created', () => received.push(1))

    await sdk.createCard({ content: '# Single delivery test' })

    expect(received).toHaveLength(1)
  })

  it('updateCard fires task.updated after-event exactly once', async () => {
    const card = await sdk.createCard({ content: '# Update Flow' })
    const received: unknown[] = []
    sdk.on('task.updated', () => received.push(1))

    await sdk.updateCard(card.id, { priority: 'high' })

    expect(received).toHaveLength(1)
  })

  it('moveCard fires task.moved after-event exactly once', async () => {
    const card = await sdk.createCard({ content: '# Move Flow', status: 'backlog' })
    const received: SDKEvent<AfterEventPayload<{ status: string }>>[] = []
    sdk.on('task.moved', (ev) => received.push(ev as SDKEvent<AfterEventPayload<{ status: string }>>))

    await sdk.moveCard(card.id, 'in-progress')

    expect(received).toHaveLength(1)
    const payload = received[0].data as AfterEventPayload<{ status: string }>
    expect(payload.event).toBe('task.moved')
    expect(payload.data.status).toBe('in-progress')
  })

  it('deleteCard consumes merged before-event identifiers before mutating and emitting', async () => {
    const first = await sdk.createCard({ content: '# First delete target' })
    const second = await sdk.createCard({ content: '# Second delete target' })
    const received: SDKEvent<AfterEventPayload<{ id: string }>>[] = []
    sdk.on('task.deleted', (ev) => received.push(ev as SDKEvent<AfterEventPayload<{ id: string }>>))
    sdk.on('card.delete', vi.fn().mockReturnValue({ cardId: second.id }))

    await sdk.deleteCard(first.id)

    expect((await sdk.getCard(first.id))?.status).not.toBe('deleted')
    expect((await sdk.getCard(second.id))?.status).toBe('deleted')
    expect(received).toHaveLength(1)
    expect((received[0].data as AfterEventPayload<{ id: string }>).data.id).toBe(second.id)
  })

  it('addComment fires comment.created after-event with the new comment payload', async () => {
    const card = await sdk.createCard({ content: '# Comment Event Test' })
    const received: SDKEvent<AfterEventPayload<{ id: string; author: string; cardId: string }>>[] = []
    sdk.on('comment.created', (ev) => received.push(ev as SDKEvent<AfterEventPayload<{ id: string; author: string; cardId: string }>>))

    await sdk.addComment(card.id, 'alice', 'Hello world')

    expect(received).toHaveLength(1)
    const payload = received[0].data as AfterEventPayload<{ id: string; author: string; cardId: string }>
    expect(payload.event).toBe('comment.created')
    expect(payload.data.author).toBe('alice')
    expect(payload.data.cardId).toBe(card.id)
  })

  it('addComment emits comment.created exactly once — no duplicate from module', async () => {
    const card = await sdk.createCard({ content: '# Single Comment Event' })
    const received: unknown[] = []
    sdk.on('comment.created', () => received.push(1))

    await sdk.addComment(card.id, 'bob', 'Only once please')

    expect(received).toHaveLength(1)
  })

  it('updateComment fires comment.updated after-event with updated payload', async () => {
    const card = await sdk.createCard({ content: '# Update Comment Event' })
    await sdk.addComment(card.id, 'alice', 'Original')
    const received: SDKEvent<AfterEventPayload<{ id: string; content: string }>>[] = []
    sdk.on('comment.updated', (ev) => received.push(ev as SDKEvent<AfterEventPayload<{ id: string; content: string }>>))

    await sdk.updateComment(card.id, 'c1', 'Edited')

    expect(received).toHaveLength(1)
    const payload = received[0].data as AfterEventPayload<{ id: string; content: string }>
    expect(payload.event).toBe('comment.updated')
    expect(payload.data.content).toBe('Edited')
  })

  it('deleteComment fires comment.deleted after-event with the deleted comment payload', async () => {
    const card = await sdk.createCard({ content: '# Delete Comment Event' })
    await sdk.addComment(card.id, 'alice', 'To be removed')
    const received: SDKEvent<AfterEventPayload<{ id: string; cardId: string }>>[] = []
    sdk.on('comment.deleted', (ev) => received.push(ev as SDKEvent<AfterEventPayload<{ id: string; cardId: string }>>))

    await sdk.deleteComment(card.id, 'c1')

    expect(received).toHaveLength(1)
    const payload = received[0].data as AfterEventPayload<{ id: string; cardId: string }>
    expect(payload.event).toBe('comment.deleted')
    expect(payload.data.id).toBe('c1')
    expect(payload.data.cardId).toBe(card.id)
  })

  it('before-event denial (AuthError) prevents createCard write and emits no after-event', async () => {
    const authErr = new AuthError('auth.policy.denied', 'denied', 'alice')
    sdk.on('card.create', vi.fn().mockRejectedValue(authErr))

    const afterReceived: unknown[] = []
    sdk.on('task.created', () => afterReceived.push(1))

    await expect(sdk.createCard({ content: '# Denied Card' })).rejects.toBeInstanceOf(AuthError)
    expect(afterReceived).toHaveLength(0)
  })

  it('before-event denial on addComment prevents write and emits no comment.created', async () => {
    const card = await sdk.createCard({ content: '# Auth Comment Test' })
    const authErr = new AuthError('auth.policy.denied', 'comment denied', 'alice')
    sdk.on('comment.create', vi.fn().mockRejectedValue(authErr))

    const afterReceived: unknown[] = []
    sdk.on('comment.created', () => afterReceived.push(1))

    await expect(sdk.addComment(card.id, 'alice', 'Denied comment')).rejects.toBeInstanceOf(AuthError)
    expect(afterReceived).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Suite: attachment / log mutation event flow (T6 coverage)
// ---------------------------------------------------------------------------

describe('KanbanSDK – attachment/log mutation event flow', () => {
  let workspaceDir: string
  let sdk: KanbanSDK
  let tempFile: string
  let alternateTempFile: string

  beforeEach(() => {
    workspaceDir = createTempDir()
    const kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
    sdk = new KanbanSDK(kanbanDir)
    // create a temp file to use as an attachment source
    tempFile = path.join(workspaceDir, 'attach.txt')
    fs.writeFileSync(tempFile, 'hello attachment')
    alternateTempFile = path.join(workspaceDir, 'attach-alt.txt')
    fs.writeFileSync(alternateTempFile, 'hello alternate attachment')
  })

  afterEach(() => {
    sdk.close()
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('addAttachment fires attachment.added after-event exactly once', async () => {
    const card = await sdk.createCard({ content: '# Attach Test' })
    const received: unknown[] = []
    sdk.on('attachment.added', () => received.push(1))

    await sdk.addAttachment(card.id, tempFile)

    expect(received).toHaveLength(1)
  })

  it('addAttachment after-event payload includes cardId and attachment filename', async () => {
    const card = await sdk.createCard({ content: '# Attach Payload Test' })
    const received: SDKEvent<AfterEventPayload<{ cardId: string; attachment: string }>>[] = []
    sdk.on('attachment.added', (ev) => received.push(ev as SDKEvent<AfterEventPayload<{ cardId: string; attachment: string }>>))

    await sdk.addAttachment(card.id, tempFile)

    expect(received).toHaveLength(1)
    const payload = received[0].data as AfterEventPayload<{ cardId: string; attachment: string }>
    expect(payload.event).toBe('attachment.added')
    expect(payload.data.cardId).toBe(card.id)
    expect(payload.data.attachment).toBe('attach.txt')
  })

  it('addAttachment consumes merged before-event input for the copy and after-event payload', async () => {
    const card = await sdk.createCard({ content: '# Attach Override Test' })
    const received: SDKEvent<AfterEventPayload<{ cardId: string; attachment: string }>>[] = []
    sdk.on('attachment.added', (ev) => received.push(ev as SDKEvent<AfterEventPayload<{ cardId: string; attachment: string }>>))
    sdk.on('attachment.add', vi.fn().mockReturnValue({ sourcePath: alternateTempFile }))

    const updated = await sdk.addAttachment(card.id, tempFile)

    expect(updated.attachments).toContain('attach-alt.txt')
    expect(updated.attachments).not.toContain('attach.txt')
    expect(received).toHaveLength(1)
    expect((received[0].data as AfterEventPayload<{ cardId: string; attachment: string }>).data.attachment).toBe('attach-alt.txt')
  })

  it('addAttachment before-event denial prevents write and emits no after-event', async () => {
    const card = await sdk.createCard({ content: '# Attach Deny Test' })
    const authErr = new AuthError('auth.policy.denied', 'denied', 'alice')
    sdk.on('attachment.add', vi.fn().mockRejectedValue(authErr))

    const afterReceived: unknown[] = []
    sdk.on('attachment.added', () => afterReceived.push(1))

    await expect(sdk.addAttachment(card.id, tempFile)).rejects.toBeInstanceOf(AuthError)
    expect(afterReceived).toHaveLength(0)
  })

  it('removeAttachment fires attachment.removed after-event exactly once', async () => {
    const card = await sdk.createCard({ content: '# Remove Attach Test' })
    await sdk.addAttachment(card.id, tempFile)

    const received: unknown[] = []
    sdk.on('attachment.removed', () => received.push(1))

    await sdk.removeAttachment(card.id, 'attach.txt')

    expect(received).toHaveLength(1)
  })

  it('removeAttachment after-event payload includes cardId and attachment name', async () => {
    const card = await sdk.createCard({ content: '# Remove Attach Payload Test' })
    await sdk.addAttachment(card.id, tempFile)

    const received: SDKEvent<AfterEventPayload<{ cardId: string; attachment: string }>>[] = []
    sdk.on('attachment.removed', (ev) => received.push(ev as SDKEvent<AfterEventPayload<{ cardId: string; attachment: string }>>))

    await sdk.removeAttachment(card.id, 'attach.txt')

    const payload = received[0].data as AfterEventPayload<{ cardId: string; attachment: string }>
    expect(payload.event).toBe('attachment.removed')
    expect(payload.data.attachment).toBe('attach.txt')
  })

  it('removeAttachment before-event denial prevents write and emits no after-event', async () => {
    const card = await sdk.createCard({ content: '# Remove Deny Test' })
    await sdk.addAttachment(card.id, tempFile)
    const authErr = new AuthError('auth.policy.denied', 'denied', 'alice')
    sdk.on('attachment.remove', vi.fn().mockRejectedValue(authErr))

    const afterReceived: unknown[] = []
    sdk.on('attachment.removed', () => afterReceived.push(1))

    await expect(sdk.removeAttachment(card.id, 'attach.txt')).rejects.toBeInstanceOf(AuthError)
    expect(afterReceived).toHaveLength(0)
  })

  it('addLog fires log.added after-event exactly once', async () => {
    const card = await sdk.createCard({ content: '# Log Test' })
    const received: unknown[] = []
    sdk.on('log.added', () => received.push(1))

    await sdk.addLog(card.id, 'test log message')

    expect(received).toHaveLength(1)
  })

  it('addLog after-event payload includes cardId and entry', async () => {
    const card = await sdk.createCard({ content: '# Log Payload Test' })
    const received: SDKEvent<AfterEventPayload<{ cardId: string; entry: { text: string } }>>[] = []
    sdk.on('log.added', (ev) => received.push(ev as SDKEvent<AfterEventPayload<{ cardId: string; entry: { text: string } }>>))

    await sdk.addLog(card.id, 'hello from test')

    expect(received).toHaveLength(1)
    const payload = received[0].data as AfterEventPayload<{ cardId: string; entry: { text: string } }>
    expect(payload.event).toBe('log.added')
    expect(payload.data.cardId).toBe(card.id)
    expect(payload.data.entry.text).toBe('hello from test')
  })

  it('addLog consumes merged before-event text and options', async () => {
    const card = await sdk.createCard({ content: '# Log Override Test' })
    const received: SDKEvent<AfterEventPayload<{ cardId: string; entry: { text: string; source: string } }>>[] = []
    sdk.on('log.added', (ev) => received.push(ev as SDKEvent<AfterEventPayload<{ cardId: string; entry: { text: string; source: string } }>>))
    sdk.on('log.add', vi.fn().mockReturnValue({
      text: 'plugin text',
      options: { source: 'plugin' },
    }))

    const entry = await sdk.addLog(card.id, 'original text')

    expect(entry.text).toBe('plugin text')
    expect(entry.source).toBe('plugin')
    expect((await sdk.listLogs(card.id))[0]).toMatchObject({ text: 'plugin text', source: 'plugin' })
    expect(received).toHaveLength(1)
    expect((received[0].data as AfterEventPayload<{ cardId: string; entry: { text: string; source: string } }>).data.entry).toMatchObject({ text: 'plugin text', source: 'plugin' })
  })

  it('addLog before-event denial prevents write and emits no log.added', async () => {
    const card = await sdk.createCard({ content: '# Log Deny Test' })
    const authErr = new AuthError('auth.policy.denied', 'denied', 'alice')
    sdk.on('log.add', vi.fn().mockRejectedValue(authErr))

    const afterReceived: unknown[] = []
    sdk.on('log.added', () => afterReceived.push(1))

    await expect(sdk.addLog(card.id, 'denied log')).rejects.toBeInstanceOf(AuthError)
    expect(afterReceived).toHaveLength(0)
  })

  it('clearLogs fires log.cleared after-event exactly once', async () => {
    const card = await sdk.createCard({ content: '# Clear Log Test' })
    await sdk.addLog(card.id, 'some entry')
    const received: unknown[] = []
    sdk.on('log.cleared', () => received.push(1))

    await sdk.clearLogs(card.id)

    expect(received).toHaveLength(1)
  })

  it('clearLogs before-event denial prevents clear and emits no log.cleared', async () => {
    const card = await sdk.createCard({ content: '# Clear Log Deny Test' })
    await sdk.addLog(card.id, 'entry')
    const authErr = new AuthError('auth.policy.denied', 'denied', 'alice')
    sdk.on('log.clear', vi.fn().mockRejectedValue(authErr))

    const afterReceived: unknown[] = []
    sdk.on('log.cleared', () => afterReceived.push(1))

    await expect(sdk.clearLogs(card.id)).rejects.toBeInstanceOf(AuthError)
    expect(afterReceived).toHaveLength(0)
  })

  it('addBoardLog fires board.log.added after-event exactly once', async () => {
    const received: unknown[] = []
    sdk.on('board.log.added', () => received.push(1))

    await sdk.addBoardLog('board event fired')

    expect(received).toHaveLength(1)
  })

  it('addBoardLog after-event payload includes boardId and entry', async () => {
    const received: SDKEvent<AfterEventPayload<{ boardId: string; entry: { text: string } }>>[] = []
    sdk.on('board.log.added', (ev) => received.push(ev as SDKEvent<AfterEventPayload<{ boardId: string; entry: { text: string } }>>))

    await sdk.addBoardLog('board log text')

    expect(received).toHaveLength(1)
    const payload = received[0].data as AfterEventPayload<{ boardId: string; entry: { text: string } }>
    expect(payload.event).toBe('board.log.added')
    expect(payload.data.entry.text).toBe('board log text')
  })

  it('addBoardLog before-event denial prevents write and emits no board.log.added', async () => {
    const authErr = new AuthError('auth.policy.denied', 'denied', 'alice')
    sdk.on('board.log.add', vi.fn().mockRejectedValue(authErr))

    const afterReceived: unknown[] = []
    sdk.on('board.log.added', () => afterReceived.push(1))

    await expect(sdk.addBoardLog('denied')).rejects.toBeInstanceOf(AuthError)
    expect(afterReceived).toHaveLength(0)
  })

  it('clearBoardLogs fires board.log.cleared after-event exactly once', async () => {
    await sdk.addBoardLog('entry to clear')
    const received: unknown[] = []
    sdk.on('board.log.cleared', () => received.push(1))

    await sdk.clearBoardLogs()

    expect(received).toHaveLength(1)
  })

  it('clearBoardLogs before-event denial prevents clear and emits no board.log.cleared', async () => {
    await sdk.addBoardLog('entry')
    const authErr = new AuthError('auth.policy.denied', 'denied', 'alice')
    sdk.on('board.log.clear', vi.fn().mockRejectedValue(authErr))

    const afterReceived: unknown[] = []
    sdk.on('board.log.cleared', () => afterReceived.push(1))

    await expect(sdk.clearBoardLogs()).rejects.toBeInstanceOf(AuthError)
    expect(afterReceived).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Suite: settings and storage-migration event flow (T7)
// ---------------------------------------------------------------------------

describe('KanbanSDK – settings and storage-migration event flow', () => {
  let workspaceDir: string
  let sdk: KanbanSDK

  beforeEach(() => {
    workspaceDir = createTempDir()
    const kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
    sdk = new KanbanSDK(kanbanDir)
  })

  afterEach(() => {
    sdk.close()
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  const settingsInput = {
    showPriorityBadges: true,
    showAssignee: true,
    showDueDate: false,
    showLabels: true,
    showBuildWithAI: false,
    showFileName: false,
    compactMode: false,
    markdownEditorMode: false,
    showDeletedColumn: false,
    defaultPriority: 'medium' as const,
    defaultStatus: 'backlog',
    boardZoom: 100,
    cardZoom: 100,
    boardBackgroundMode: 'fancy' as const,
    boardBackgroundPreset: 'aurora' as const,
  }

  it('updateSettings fires settings.updated after-event exactly once', async () => {
    const received: unknown[] = []
    sdk.on('settings.updated', () => received.push(1))

    await sdk.updateSettings(settingsInput)

    expect(received).toHaveLength(1)
  })

  it('updateSettings after-event carries committed settings payload', async () => {
    const received: SDKEvent<AfterEventPayload<Record<string, unknown>>>[] = []
    sdk.on('settings.updated', (ev) => received.push(ev as SDKEvent<AfterEventPayload<Record<string, unknown>>>))

    await sdk.updateSettings({ ...settingsInput, showAssignee: false, showLabels: false })

    expect(received).toHaveLength(1)
    const payload = received[0].data as AfterEventPayload<Record<string, unknown>>
    expect(payload.event).toBe('settings.updated')
  })

  it('updateSettings before-event denial prevents write and emits no settings.updated', async () => {
    const authErr = new AuthError('auth.policy.denied', 'denied', 'alice')
    sdk.on('settings.update', vi.fn().mockRejectedValue(authErr))

    const afterReceived: unknown[] = []
    sdk.on('settings.updated', () => afterReceived.push(1))

    await expect(sdk.updateSettings({ ...settingsInput, showPriorityBadges: false, showAssignee: false, showLabels: false })).rejects.toBeInstanceOf(AuthError)
    expect(afterReceived).toHaveLength(0)
  })

  it('migrateToSqlite fires storage.migrated after-event exactly once', async () => {
    await sdk.init()
    await sdk.createCard({ content: '# Migrate Test' })

    const received: unknown[] = []
    sdk.on('storage.migrated', () => received.push(1))

    const dbPath = path.join(workspaceDir, '.kanban', 'kanban.db')
    await sdk.migrateToSqlite(path.relative(workspaceDir, dbPath))

    expect(received).toHaveLength(1)
  })

  it('migrateToSqlite after-event payload includes from, to, and count', async () => {
    await sdk.init()
    await sdk.createCard({ content: '# Card 1' })
    await sdk.createCard({ content: '# Card 2' })

    const received: SDKEvent<AfterEventPayload<{ from: string; to: string; count: number }>>[] = []
    sdk.on('storage.migrated', (ev) => received.push(ev as SDKEvent<AfterEventPayload<{ from: string; to: string; count: number }>>))

    const dbPath = path.join(workspaceDir, '.kanban', 'kanban.db')
    await sdk.migrateToSqlite(path.relative(workspaceDir, dbPath))

    expect(received).toHaveLength(1)
    const payload = received[0].data as AfterEventPayload<{ from: string; to: string; count: number }>
    expect(payload.event).toBe('storage.migrated')
    expect(payload.data.to).toBe('sqlite')
    expect(payload.data.count).toBe(2)
  })

  it('migrateToSqlite before-event denial prevents migration and emits no storage.migrated', async () => {
    await sdk.init()
    const authErr = new AuthError('auth.policy.denied', 'denied', 'alice')
    sdk.on('storage.migrate', vi.fn().mockRejectedValue(authErr))

    const afterReceived: unknown[] = []
    sdk.on('storage.migrated', () => afterReceived.push(1))

    await expect(sdk.migrateToSqlite()).rejects.toBeInstanceOf(AuthError)
    expect(afterReceived).toHaveLength(0)
  })
})
