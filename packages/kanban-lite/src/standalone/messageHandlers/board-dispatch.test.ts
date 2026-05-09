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
import { broadcast, broadcastCardContentToEditingClients, broadcastLogsUpdatedToEditingClients, buildInitMessage } from '../broadcastService'

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

  it('routes card actions through the cardId-only SDK contract and refreshes the current-board match first', async () => {
    const defaultCard = {
      id: '338',
      boardId: 'default',
      status: 'backlog',
      content: 'Default 338',
    }
    const reviewCard = {
      id: '338',
      boardId: 'email-ops',
      status: 'needs-review',
      content: 'Email Ops 338',
    }
    const sdk = {
      triggerAction: vi.fn(async () => {}),
    }
    const ctx = {
      sdk,
      cards: [defaultCard, reviewCard],
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

    vi.mocked(buildInitMessage).mockClear()
    vi.mocked(broadcast).mockClear()
    vi.mocked(broadcastCardContentToEditingClients).mockClear()
    vi.mocked(broadcastLogsUpdatedToEditingClients).mockClear()

    await dispatchBoardMessage(
      ctx as never,
      ws as never,
      {
        type: 'triggerAction',
        cardId: '338',
        action: 'rematch',
        boardId: 'email-ops',
        callbackKey: 'cb-rematch',
      },
      runWithScopedAuth,
      authContext as never,
    )

    expect(sdk.triggerAction).toHaveBeenCalledWith('338', 'rematch')
    expect(buildInitMessage).toHaveBeenCalledWith(ctx)
    expect(broadcast).toHaveBeenCalledWith(ctx, { type: 'init' })
    expect(broadcastCardContentToEditingClients).toHaveBeenCalledWith(ctx, defaultCard)
    expect(broadcastLogsUpdatedToEditingClients).toHaveBeenCalledWith(ctx, '338', undefined, 'default')
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'actionResult', callbackKey: 'cb-rematch' }))
  })

  it('derives the source board from the card before transferring through the cardId-only SDK contract', async () => {
    const sdk = {
      getCard: vi.fn(async () => ({
        id: '338',
        boardId: 'email-ops',
        status: 'needs-review',
        content: 'Email Ops 338',
      })),
      transferCard: vi.fn(async () => ({})),
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
      {
        type: 'transferCard',
        cardId: '338',
        toBoard: 'sales-ops',
        targetStatus: 'backlog',
      },
      runWithScopedAuth,
      authContext as never,
    )

    expect(sdk.getCard).toHaveBeenCalledWith('338')
    expect(sdk.transferCard).toHaveBeenCalledWith('338', 'sales-ops', 'backlog')
  })
})
