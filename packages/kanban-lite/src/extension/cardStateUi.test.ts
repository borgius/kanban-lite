import { describe, expect, it, vi } from 'vitest'
import type { Card } from '../shared/types'
import { CardStateError, ERR_CARD_STATE_IDENTITY_UNAVAILABLE } from '../sdk/types'
import type { CardStateStatus } from '../sdk/types'
import { buildCardStateReadModelForCard, decorateCardsForWebview, performExplicitCardOpen } from './cardStateUi'
import type { CardStateAuthRunner } from './cardStateUi'

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    version: 1,
    id: 'card-1',
    status: 'todo',
    priority: 'medium',
    assignee: null,
    dueDate: null,
    created: '2026-03-24T00:00:00.000Z',
    modified: '2026-03-24T00:00:00.000Z',
    completedAt: null,
    labels: [],
    attachments: [],
    comments: [],
    order: 'a0',
    content: '# Card',
    filePath: '/tmp/card-1.md',
    ...overrides,
  }
}

function createSdkStub() {
  return {
    getCardStateStatus: vi.fn<() => CardStateStatus>(() => ({
      provider: 'builtin',
      active: true,
      backend: 'builtin' as const,
      availability: 'available' as const,
      defaultActorMode: 'auth-absent-only' as const,
      defaultActor: { id: 'default-user', source: 'default' as const, mode: 'auth-absent-only' as const },
      defaultActorAvailable: true,
    })),
    getUnreadSummary: vi.fn(async (cardId: string, boardId?: string) => ({
      actorId: 'default-user',
      cardId,
      boardId: boardId ?? 'default',
      latestActivity: { cursor: `card:${boardId ?? 'default'}:${cardId}:1`, updatedAt: '2026-03-24T00:00:00.000Z' },
      readThrough: null,
      unread: true,
    })),
    getCardState: vi.fn(async () => null),
    getCardStateReadModelForCard: vi.fn(async (card: { id: string; boardId?: string }, boardId?: string) => ({
      unread: {
        actorId: 'default-user',
        cardId: card.id,
        boardId: card.boardId ?? boardId ?? 'default',
        latestActivity: { cursor: `card:${card.boardId ?? boardId ?? 'default'}:${card.id}:1`, updatedAt: '2026-03-24T00:00:00.000Z' },
        readThrough: null,
        unread: true,
      },
      open: null,
    })),
    markCardOpened: vi.fn(async (cardId: string, boardId?: string) => ({
      actorId: 'default-user',
      cardId,
      boardId: boardId ?? 'default',
      latestActivity: { cursor: `card:${boardId ?? 'default'}:${cardId}:1`, updatedAt: '2026-03-24T00:00:00.000Z' },
      readThrough: { cursor: `card:${boardId ?? 'default'}:${cardId}:1`, updatedAt: '2026-03-24T00:00:00.000Z' },
      unread: false,
    })),
    setActiveCard: vi.fn(async () => makeCard()),
  }
}

describe('extension card-state UI adapter', () => {
  it('builds side-effect-free read models for the default actor', async () => {
    const sdk = createSdkStub()
    const runWithAuthCalls = vi.fn()
    const runWithAuth: CardStateAuthRunner = async <T,>(fn: () => Promise<T>) => {
      runWithAuthCalls()
      return fn()
    }

    const cardState = await buildCardStateReadModelForCard(sdk, runWithAuth, makeCard({ id: 'card-default' }), 'default')

    expect(cardState.unread).toMatchObject({
      actorId: 'default-user',
      cardId: 'card-default',
      unread: true,
    })
    expect(cardState.open).toBeNull()
    expect(cardState.status).toMatchObject({
      availability: 'available',
      backend: 'builtin',
      configured: false,
    })
    expect(sdk.getCardStateReadModelForCard).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'card-default' }),
      'default',
    )
    expect(sdk.getUnreadSummary).not.toHaveBeenCalled()
    expect(sdk.getCardState).not.toHaveBeenCalled()
    expect(sdk.markCardOpened).not.toHaveBeenCalled()
  })

  it('surfaces configured identity failures without falling back to the default actor', async () => {
    const sdk = createSdkStub()
    sdk.getCardStateStatus.mockReturnValue({
      provider: 'builtin',
      active: true,
      backend: 'builtin',
      availability: 'identity-unavailable',
      defaultActorMode: 'auth-absent-only',
      defaultActor: { id: 'default-user', source: 'default' as const, mode: 'auth-absent-only' as const },
      defaultActorAvailable: false,
      errorCode: ERR_CARD_STATE_IDENTITY_UNAVAILABLE,
    })
    sdk.getCardStateReadModelForCard.mockRejectedValue(new CardStateError(ERR_CARD_STATE_IDENTITY_UNAVAILABLE, 'Sign in required for card state'))
    const runWithAuth: CardStateAuthRunner = async <T,>(fn: () => Promise<T>) => fn()

    const cardState = await buildCardStateReadModelForCard(sdk, runWithAuth, makeCard({ id: 'card-auth' }), 'default')

    expect(cardState.unread).toBeNull()
    expect(cardState.open).toBeNull()
    expect(cardState.status).toMatchObject({
      availability: 'identity-unavailable',
      configured: true,
      errorCode: ERR_CARD_STATE_IDENTITY_UNAVAILABLE,
    })
    expect(cardState.error).toMatchObject({
      code: ERR_CARD_STATE_IDENTITY_UNAVAILABLE,
      availability: 'identity-unavailable',
      message: 'Sign in required for card state',
    })
    expect(sdk.getUnreadSummary).not.toHaveBeenCalled()
    expect(sdk.getCardState).not.toHaveBeenCalled()
  })

  it('decorates cards without mutating unread state', async () => {
    const sdk = createSdkStub()
    const runWithAuth: CardStateAuthRunner = async <T,>(fn: () => Promise<T>) => fn()

    const cards = await decorateCardsForWebview(sdk, runWithAuth, [makeCard({ id: 'card-a' })], 'default')

    expect(cards[0].cardState?.unread?.unread).toBe(true)
    expect(sdk.markCardOpened).not.toHaveBeenCalled()
  })

  it('routes explicit opens through markCardOpened while keeping setActiveCard separate', async () => {
    const sdk = createSdkStub()
    const runWithAuthCalls = vi.fn()
    const runWithAuth: CardStateAuthRunner = async <T,>(fn: () => Promise<T>) => {
      runWithAuthCalls()
      return fn()
    }

    const error = await performExplicitCardOpen(sdk, runWithAuth, 'card-open', 'default')

    expect(error).toBeNull()
    expect(runWithAuthCalls).toHaveBeenCalledTimes(1)
    expect(sdk.markCardOpened).toHaveBeenCalledWith('card-open', 'default')
    expect(sdk.setActiveCard).toHaveBeenCalledWith('card-open', 'default')
  })

  it('still updates active-card state when markCardOpened fails for configured identities', async () => {
    const sdk = createSdkStub()
    sdk.markCardOpened.mockRejectedValue(new CardStateError(ERR_CARD_STATE_IDENTITY_UNAVAILABLE, 'Sign in required for card state'))
    const runWithAuth: CardStateAuthRunner = async <T,>(fn: () => Promise<T>) => fn()

    const error = await performExplicitCardOpen(sdk, runWithAuth, 'card-open', 'default')

    expect(error).toMatchObject({
      code: ERR_CARD_STATE_IDENTITY_UNAVAILABLE,
      availability: 'identity-unavailable',
    })
    expect(sdk.setActiveCard).toHaveBeenCalledWith('card-open', 'default')
  })
})
