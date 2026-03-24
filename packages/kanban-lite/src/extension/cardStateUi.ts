import type { Card, CardStateErrorTransport, CardStateReadModelTransport, CardStateStatusTransport } from '../shared/types'
import type { KanbanSDK } from '../sdk/KanbanSDK'
import type { CardStateRecord } from '../sdk/plugins'
import { CARD_STATE_OPEN_DOMAIN, CardStateError } from '../sdk/types'
import type { CardOpenStateValue } from '../sdk/types'

type CardStateAwareSDK = Pick<KanbanSDK, 'getCardStateStatus' | 'getUnreadSummary' | 'getCardState' | 'markCardOpened' | 'setActiveCard'>
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
  card: Pick<Card, 'id' | 'boardId'>,
  fallbackBoardId?: string,
): Promise<CardStateReadModelTransport> {
  const status = toCardStateStatus(sdk.getCardStateStatus())
  const boardId = card.boardId ?? fallbackBoardId

  try {
    const unread = await runWithAuth(() => sdk.getUnreadSummary(card.id, boardId))
    const open = await runWithAuth(() => sdk.getCardState(card.id, boardId, CARD_STATE_OPEN_DOMAIN) as Promise<CardStateRecord<CardOpenStateValue> | null>)

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
  return Promise.all(cards.map(async (card) => ({
    ...card,
    cardState: await buildCardStateReadModelForCard(sdk, runWithAuth, card, fallbackBoardId),
  })))
}

export async function performExplicitCardOpen(
  sdk: CardStateAwareSDK,
  runWithAuth: CardStateAuthRunner,
  cardId: string,
  boardId?: string,
): Promise<CardStateErrorTransport | null> {
  let unexpectedError: unknown = null
  let mappedError: CardStateErrorTransport | null = null

  try {
    await runWithAuth(() => sdk.markCardOpened(cardId, boardId))
  } catch (error) {
    mappedError = toCardStateError(error)
    if (!mappedError) {
      unexpectedError = error
    }
  }

  await sdk.setActiveCard(cardId, boardId)

  if (unexpectedError) {
    throw unexpectedError
  }

  return mappedError
}

export function formatCardStateWarning(error: CardStateErrorTransport): string {
  if (error.availability === 'identity-unavailable') {
    return `Card unread state could not be updated: ${error.message}`
  }

  return `Card unread state is unavailable: ${error.message}`
}
