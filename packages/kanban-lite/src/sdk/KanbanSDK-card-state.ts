import type { Card } from '../shared/types'
import {
  CARD_STATE_OPEN_DOMAIN,
  CARD_STATE_UNREAD_DOMAIN,
  CardStateError,
  DEFAULT_CARD_STATE_ACTOR,
  ERR_CARD_STATE_IDENTITY_UNAVAILABLE,
  ERR_CARD_STATE_UNAVAILABLE,
} from './types'
import type { AuthContext, AuthDecision, CardOpenStateValue, CardStateStatus, CardUnreadSummary } from './types'
import { canUseDefaultCardStateActor } from './plugins'
import type { CardStateCursor, CardStateRecord } from './plugins'
import { cursorsMatch, getUnreadActivityCursor, _isPlainObject } from './KanbanSDK-types'
import { KanbanSDKStatus } from './KanbanSDK-status'
import * as Logs from './modules/logs'
import type { SDKContext } from './modules/context'

/**
 * Extends KanbanSDKStatus with card-state tracking (unread, read-through,
 * open-card), auth resolution helpers, and the public runWithAuth / canPerformAction API.
 */
export class KanbanSDKCardState extends KanbanSDKStatus {
  // --- Internal card-state helpers ---

  /** @internal */
  private _requireCardStateCapabilities(): import('./plugins').ResolvedCapabilityBag {
    if (!this._capabilities) {
      throw new CardStateError(ERR_CARD_STATE_UNAVAILABLE, 'card.state is unavailable for injected storage engines')
    }
    return this._capabilities
  }

  /** @internal */
  private async _resolveCardStateTarget(cardId: string, boardId?: string): Promise<{ cardId: string; boardId: string }> {
    const card = await (this as unknown as { getCard(id: string, boardId?: string): Promise<Card | null> }).getCard(cardId, boardId)
    if (!card) throw new Error(`Card not found: ${cardId}`)
    return {
      cardId: card.id,
      boardId: card.boardId || this._resolveBoardId(boardId),
    }
  }

  /** @internal */
  private _resolveCardStateTargetDirect(
    card: Pick<Card, 'id' | 'boardId'>,
    fallbackBoardId?: string,
  ): { cardId: string; boardId: string } {
    return {
      cardId: card.id,
      boardId: card.boardId || this._resolveBoardId(fallbackBoardId),
    }
  }

  /** @internal */
  private async _resolveCardStateActorId(): Promise<string> {
    const capabilities = this._requireCardStateCapabilities()

    if (canUseDefaultCardStateActor(capabilities.authProviders)) {
      return DEFAULT_CARD_STATE_ACTOR.id
    }

    try {
      const identity = await capabilities.authIdentity.resolveIdentity(this._currentAuthContext ?? {})
      if (identity?.subject) return identity.subject
    } catch {
      // handled below as a stable public card-state error
    }

    throw new CardStateError(
      ERR_CARD_STATE_IDENTITY_UNAVAILABLE,
      'card.state requires a resolved actor from the configured auth.identity provider',
    )
  }

  /** @internal */
  private async _getLatestUnreadActivityCursor(cardId: string, boardId: string): Promise<CardStateCursor | null> {
    const logs = await (this as unknown as { listLogs(cardId: string, boardId: string): Promise<import('../shared/types').LogEntry[]> }).listLogs(cardId, boardId)
    for (let index = logs.length - 1; index >= 0; index -= 1) {
      const cursor = getUnreadActivityCursor(logs[index], index)
      if (cursor) return cursor
    }
    return null
  }

  /** @internal */
  private _createUnreadSummary(
    actorId: string,
    target: { cardId: string; boardId: string },
    latestActivity: CardStateCursor | null,
    readThrough: CardStateCursor | null,
  ): CardUnreadSummary {
    return {
      actorId,
      boardId: target.boardId,
      cardId: target.cardId,
      latestActivity,
      readThrough,
      unread: latestActivity != null && !cursorsMatch(latestActivity, readThrough),
    }
  }

  // --- Card-state public API ---

  async getCardState(cardId: string, boardId?: string, domain: string = CARD_STATE_UNREAD_DOMAIN): Promise<CardStateRecord | null> {
    const capabilities = this._requireCardStateCapabilities()
    const actorId = await this._resolveCardStateActorId()
    const target = await this._resolveCardStateTarget(cardId, boardId)
    return capabilities.cardState.getCardState({
      actorId,
      boardId: target.boardId,
      cardId: target.cardId,
      domain,
    })
  }

  async getCardStateReadModelForCard(
    card: Card,
    fallbackBoardId?: string,
  ): Promise<{ unread: CardUnreadSummary; open: CardStateRecord<CardOpenStateValue> | null }> {
    const capabilities = this._requireCardStateCapabilities()
    const actorId = await this._resolveCardStateActorId()
    const target = this._resolveCardStateTargetDirect(card, fallbackBoardId)
    const key = { actorId, boardId: target.boardId, cardId: target.cardId }

    const [logs, readThrough, open] = await Promise.all([
      Logs.listLogsForCard(this as unknown as SDKContext, card),
      capabilities.cardState.getUnreadCursor(key),
      capabilities.cardState.getCardState({ ...key, domain: CARD_STATE_OPEN_DOMAIN }) as Promise<CardStateRecord<CardOpenStateValue> | null>,
    ])

    let latestActivity: CardStateCursor | null = null
    for (let index = logs.length - 1; index >= 0; index -= 1) {
      const cursor = getUnreadActivityCursor(logs[index], index)
      if (cursor) { latestActivity = cursor; break }
    }

    const unread = this._createUnreadSummary(actorId, target, latestActivity, readThrough)
    return { unread, open: open as CardStateRecord<CardOpenStateValue> | null }
  }

  async getCardStateReadModelForCards(
    cards: readonly Card[],
    fallbackBoardId?: string,
  ): Promise<Map<string, { unread: CardUnreadSummary; open: CardStateRecord<CardOpenStateValue> | null }>> {
    const results = new Map<string, { unread: CardUnreadSummary; open: CardStateRecord<CardOpenStateValue> | null }>()
    if (cards.length === 0) return results

    const capabilities = this._requireCardStateCapabilities()
    const actorId = await this._resolveCardStateActorId()

    const cardsByBoard = new Map<string, Card[]>()
    for (const card of cards) {
      const boardId = card.boardId || this._resolveBoardId(fallbackBoardId)
      const group = cardsByBoard.get(boardId)
      if (group) group.push(card)
      else cardsByBoard.set(boardId, [card])
    }

    const batchSupported = typeof capabilities.cardState.batchGetCardStates === 'function'
    type StateMap = Map<string, { unread: CardStateCursor | null; open: CardStateRecord<CardOpenStateValue> | null }>

    const prefetchStates = async (boardId: string, boardCards: Card[]): Promise<StateMap> => {
      const stateMap: StateMap = new Map()
      for (const c of boardCards) stateMap.set(c.id, { unread: null, open: null })
      if (!batchSupported) return stateMap
      const records = await capabilities.cardState.batchGetCardStates!({
        actorId,
        boardId,
        cardIds: boardCards.map(c => c.id),
        domains: [CARD_STATE_UNREAD_DOMAIN, CARD_STATE_OPEN_DOMAIN],
      })
      for (const record of records) {
        const bucket = stateMap.get(record.cardId)
        if (!bucket) continue
        if (record.domain === CARD_STATE_UNREAD_DOMAIN) {
          if (_isPlainObject(record.value) && typeof (record.value as { cursor?: unknown }).cursor === 'string') {
            bucket.unread = record.value as CardStateCursor
          }
        } else if (record.domain === CARD_STATE_OPEN_DOMAIN) {
          bucket.open = record as CardStateRecord<CardOpenStateValue>
        }
      }
      return stateMap
    }

    await Promise.all(Array.from(cardsByBoard.entries()).map(async ([boardId, boardCards]) => {
      const stateMap = await prefetchStates(boardId, boardCards)
      await Promise.all(boardCards.map(async (card) => {
        const target = this._resolveCardStateTargetDirect(card, fallbackBoardId)
        const prefetched = stateMap.get(card.id) ?? { unread: null, open: null }

        const [unreadCursor, open] = await Promise.all([
          batchSupported
            ? Promise.resolve(prefetched.unread)
            : capabilities.cardState.getUnreadCursor({ actorId, boardId: target.boardId, cardId: target.cardId }),
          batchSupported
            ? Promise.resolve(prefetched.open)
            : capabilities.cardState.getCardState({ actorId, boardId: target.boardId, cardId: target.cardId, domain: CARD_STATE_OPEN_DOMAIN }) as Promise<CardStateRecord<CardOpenStateValue> | null>,
        ])

        const unread = this._createUnreadSummary(actorId, target, null, unreadCursor)
        results.set(card.id, { unread, open })
      }))
    }))

    return results
  }

  async getUnreadSummary(cardId: string, boardId?: string): Promise<CardUnreadSummary> {
    const capabilities = this._requireCardStateCapabilities()
    const actorId = await this._resolveCardStateActorId()
    const target = await this._resolveCardStateTarget(cardId, boardId)
    const latestActivity = await this._getLatestUnreadActivityCursor(target.cardId, target.boardId)
    const readThrough = await capabilities.cardState.getUnreadCursor({
      actorId,
      boardId: target.boardId,
      cardId: target.cardId,
    })
    return this._createUnreadSummary(actorId, target, latestActivity, readThrough)
  }

  async markCardOpened(cardId: string, boardId?: string): Promise<CardUnreadSummary> {
    const capabilities = this._requireCardStateCapabilities()
    const actorId = await this._resolveCardStateActorId()
    const target = await this._resolveCardStateTarget(cardId, boardId)
    const latestActivity = await this._getLatestUnreadActivityCursor(target.cardId, target.boardId)
    const openedAt = new Date().toISOString()

    let readThrough: CardStateCursor | null = null
    if (latestActivity) {
      const unreadRecord = await capabilities.cardState.markUnreadReadThrough({
        actorId,
        boardId: target.boardId,
        cardId: target.cardId,
        cursor: latestActivity,
      })
      readThrough = unreadRecord.value
    }

    const openValue: CardOpenStateValue = {
      openedAt,
      readThrough,
    }

    await capabilities.cardState.setCardState({
      actorId,
      boardId: target.boardId,
      cardId: target.cardId,
      domain: CARD_STATE_OPEN_DOMAIN,
      value: openValue,
      updatedAt: openedAt,
    })

    return this._createUnreadSummary(actorId, target, latestActivity, readThrough)
  }

  async markCardRead(cardId: string, boardId?: string, readThrough?: CardStateCursor): Promise<CardUnreadSummary> {
    const capabilities = this._requireCardStateCapabilities()
    const actorId = await this._resolveCardStateActorId()
    const target = await this._resolveCardStateTarget(cardId, boardId)
    const latestActivity = await this._getLatestUnreadActivityCursor(target.cardId, target.boardId)
    const cursor = readThrough ?? latestActivity

    if (!cursor) {
      return this._createUnreadSummary(actorId, target, latestActivity, null)
    }

    const unreadRecord = await capabilities.cardState.markUnreadReadThrough({
      actorId,
      boardId: target.boardId,
      cardId: target.cardId,
      cursor,
    })

    return this._createUnreadSummary(actorId, target, latestActivity, unreadRecord.value)
  }

  // --- Auth resolution helpers ---

  /** @internal */
  protected async _resolveActorForMutation(): Promise<string> {
    const ctx = this._currentAuthContext ?? {}
    if (this._capabilities) {
      const identity = await this._capabilities.authIdentity.resolveIdentity(ctx)
      if (identity?.subject) return identity.subject
    }
    switch (ctx.transport) {
      case 'http': return 'api'
      case 'mcp': return 'mcp'
      case 'cli': return 'cli'
      case 'extension': return 'user'
      default: return 'sdk'
    }
  }

  async canPerformAction(action: string, context?: AuthContext): Promise<boolean> {
    if (!this._capabilities) {
      return true
    }

    const resolvedContext: AuthContext = context ?? this._currentAuthContext ?? {}
    const identity = await this._capabilities.authIdentity.resolveIdentity(resolvedContext)
    const decision = await this._capabilities.authPolicy.checkPolicy(identity, action, resolvedContext)
    return decision.allowed
  }

  runWithAuth<T>(auth: AuthContext, fn: () => Promise<T>): Promise<T> {
    return KanbanSDKCardState._runWithScopedAuth(auth, fn)
  }
}
