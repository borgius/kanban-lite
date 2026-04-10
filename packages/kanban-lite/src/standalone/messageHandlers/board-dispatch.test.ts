import { describe, expect, it, vi } from 'vitest'

vi.mock('../broadcastService', () => ({
  broadcast: vi.fn(),
  broadcastCardContentToEditingClients: vi.fn(),
  broadcastLogsUpdatedToEditingClients: vi.fn(),
  buildInitMessage: vi.fn(() => ({ type: 'init' })),
  loadCards: vi.fn(async () => {}),
  sendCardStates: vi.fn(async () => {}),
  sendLogsUpdated: vi.fn(async () => {}),
}))

import { dispatchBoardMessage } from './board-dispatch'
import { broadcast, buildInitMessage } from '../broadcastService'

describe('dispatchBoardMessage', () => {
  it('updates board title through sdk.updateBoard and syncs board actions with add/remove APIs', async () => {
    const sdk = {
      updateBoard: vi.fn(async () => ({ name: 'Default', columns: [], nextCardId: 1, defaultStatus: 'backlog', defaultPriority: 'medium' })),
      getBoardActions: vi.fn(() => ({ deploy: 'Deploy', retire: 'Retire' })),
      addBoardAction: vi.fn(async () => ({ deploy: 'Deploy now', rollback: 'Rollback' })),
      removeBoardAction: vi.fn(async () => ({ deploy: 'Deploy' })),
    }
    const ctx = {
      sdk,
      cards: [],
      currentBoardId: 'default',
      workspaceRoot: '/tmp/kanban-light-test',
      migrating: false,
    }
    const ws = {
      send: vi.fn(),
    }
    const runWithScopedAuthMock = vi.fn(async <T,>(fn: () => Promise<T>) => await fn())
    const runWithScopedAuth = runWithScopedAuthMock as unknown as <T>(fn: () => Promise<T>) => Promise<T>
    const authContext = { type: 'none' }

    await dispatchBoardMessage(
      ctx as never,
      ws as never,
      { type: 'updateBoardTitle', boardId: 'default', title: ['ticketId', 'region'] },
      runWithScopedAuth,
      authContext as never,
    )

    expect(sdk.updateBoard).toHaveBeenCalledWith('default', { title: ['ticketId', 'region'] })
    expect(buildInitMessage).toHaveBeenCalledWith(ctx)
    expect(broadcast).toHaveBeenCalledWith(ctx, { type: 'init' })

    vi.mocked(buildInitMessage).mockClear()
    vi.mocked(broadcast).mockClear()

    await dispatchBoardMessage(
      ctx as never,
      ws as never,
      {
        type: 'updateBoardActions',
        boardId: 'default',
        actions: {
          deploy: 'Deploy now',
          rollback: 'Rollback',
        },
      },
      runWithScopedAuth,
      authContext as never,
    )

    expect(sdk.getBoardActions).toHaveBeenCalledWith('default')
    expect(sdk.removeBoardAction).toHaveBeenCalledWith('default', 'retire')
    expect(sdk.addBoardAction).toHaveBeenCalledWith('default', 'deploy', 'Deploy now')
    expect(sdk.addBoardAction).toHaveBeenCalledWith('default', 'rollback', 'Rollback')
    expect(buildInitMessage).toHaveBeenCalledWith(ctx)
    expect(broadcast).toHaveBeenCalledWith(ctx, { type: 'init' })
  })
})
