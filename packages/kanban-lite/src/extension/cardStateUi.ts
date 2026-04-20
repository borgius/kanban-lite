import type { Card, CardStateErrorTransport, CardStateReadModelTransport, CardStateStatusTransport } from '../shared/types'
import type { KanbanSDK } from '../sdk/KanbanSDK'
import { CardStateError } from '../sdk/types'

type CardStateAwareSDK = Pick<KanbanSDK, 'getCardStateStatus' | 'getUnreadSummary' | 'getCardState' | 'markCardOpened' | 'setActiveCard' | 'getCardStateReadModelForCard' | 'getCardStateReadModelForCards'>
export type CardStateAuthRunner = <T>(fn: () => Promise<T>) => Promise<T>

function toCardStateStatus(status: ReturnType<CardStateAwareSDK['getCardStateStatus']>): CardStateStatusTransport {
  return {
    backend: status.backend,
    availability: status.availability,
    configured: !status.defaultActorAvailable,
    ...(status.errorCode ? { errorCode: status.errorCode } : {}),
  }
}

function toCardStateError(error: unknown): CardStateErrorTransport | null {
  if (!(error instanceof CardStateError)) {
    return null
  }

  return {
    code: error.code,
    availability: error.availability,
    message: error.message,
  }
}

export async function buildCardStateReadModelForCard(
  sdk: CardStateAwareSDK,
  runWithAuth: CardStateAuthRunner,
  card: Card,
  fallbackBoardId?: string,
): Promise<CardStateReadModelTransport> {
  const status = toCardStateStatus(sdk.getCardStateStatus())
  const boardId = card.boardId ?? fallbackBoardId

  try {
    const { unread, open } = await runWithAuth(() =>
      sdk.getCardStateReadModelForCard(card, boardId),
    )

    return {
      unread,
      open,
      status,
    }
  } catch (error) {
    const mappedError = toCardStateError(error)
    if (!mappedError) {
      throw error
    }

    return {
      unread: null,
      open: null,
      status: {
        ...status,
        availability: mappedError.availability,
        errorCode: mappedError.code,
      },
      error: mappedError,
    }
  }
}

export async function decorateCardsForWebview(
  sdk: CardStateAwareSDK,
  runWithAuth: CardStateAuthRunner,
  cards: Card[],
  fallbackBoardId?: string,
): Promise<Card[]> {
  if (cards.length === 0) return []

  const status = toCardStateStatus(sdk.getCardStateStatus())

  // Strip comments from the board-level payload. Comments are only needed
  // when a card is opened, and the per-card `sendCardContent` / REST detail
  // paths re-fetch the full card via `sdk.getCard(...)`. Stripping here
  // avoids shipping every card's comment thread with every board init /
  // cardsUpdated broadcast, which can dominate payload size on active
  // boards (and costs us R2/attachment round-trips on remote backends).
  const stripComments = (card: Card): Card => card.comments && card.comments.length > 0
    ? { ...card, comments: [] }
    : card

  // Batch-fetch every card's read model in a single pass. The SDK coalesces
  // card-state provider I/O into one round-trip per board when the provider
  // supports it (e.g. Cloudflare D1), reducing `2 × N` per-card queries to
  // `1` per board. Fall back to per-card decoration when the batch call
  // fails with a card-state error so we still render sensible UI state.
  let readModels: Awaited<ReturnType<CardStateAwareSDK['getCardStateReadModelForCards']>> | null = null
  let batchError: CardStateErrorTransport | null = null
  try {
    readModels = await runWithAuth(() => sdk.getCardStateReadModelForCards(cards, fallbackBoardId))
  } catch (error) {
    batchError = toCardStateError(error)
    if (!batchError) throw error
  }

  if (readModels) {
    return cards.map((card) => {
      const entry = readModels!.get(card.id)
      const stripped = stripComments(card)
      return {
        ...stripped,
        cardState: entry
          ? { unread: entry.unread, open: entry.open, status }
          : { unread: null, open: null, status },
      }
    })
  }

  const fallbackStatus: CardStateStatusTransport = batchError
    ? { ...status, availability: batchError.availability, errorCode: batchError.code }
    : status
  return cards.map((card) => ({
    ...stripComments(card),
    cardState: {
      unread: null,
      open: null,
      status: fallbackStatus,
      ...(batchError ? { error: batchError } : {}),
    },
  }))
}

export async function performExplicitCardOpen(
  sdk: CardStateAwareSDK,
  runWithAuth: CardStateAuthRunner,
  cardId: string,
  boardId?: string,
): Promise<CardStateErrorTransport | null> {
  let mappedError: CardStateErrorTransport | null = null

  try {
    await runWithAuth(() => sdk.markCardOpened(cardId, boardId))
  } catch (error) {
    mappedError = toCardStateError(error)
    if (!mappedError) {
      throw error
    }
  }

  await runWithAuth(() => sdk.setActiveCard(cardId, boardId))

  return mappedError
}

export function formatCardStateWarning(error: CardStateErrorTransport): string {
  if (error.availability === 'identity-unavailable') {
    return `Card unread state could not be updated: ${error.message}`
  }

  return `Card unread state is unavailable: ${error.message}`
}
