import type { Card, CardSortOption, ResolvedFormDescriptor, TaskPermissionsReadModel } from '../shared/types'
import type { CreateCardInput, SubmitFormInput, SubmitFormResult } from './types'
import { sanitizeCard } from './types'
import * as Cards from './modules/cards'
import * as Boards from './modules/boards'
import type { MethodInput, ListCardsOptions } from './KanbanSDK-types'
import { normalizeListCardsOptions } from './KanbanSDK-types'
import { KanbanSDKBoards } from './KanbanSDK-boards'

export { KanbanSDKBoards }

export class KanbanSDKCards extends KanbanSDKBoards {
  // --- Transfer ---

  async transferCard(cardId: string, toBoardId: string, targetStatus?: string): Promise<Card> {
    const target = await this._resolveCardMutationTarget(cardId)
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Boards.transferCard> & { fromBoardId?: string }>('card.transfer', {
      cardId,
      toBoardId,
      targetStatus,
      fromBoardId: target.boardId,
    }, undefined, target.boardId)
    const snapshot = await this.getCard(mergedInput.cardId)
    if (!snapshot) throw new Error(`Card not found: ${mergedInput.cardId}`)

    const fromBoardId = snapshot.boardId ?? target.boardId
    const card = await Boards.transferCard(this._ctx, mergedInput)
    this._runAfterEvent('task.moved', sanitizeCard(card), undefined, card.boardId, {
      previousStatus: snapshot?.status,
      fromBoard: fromBoardId,
      toBoard: mergedInput.toBoardId,
      transfer: true,
    })
    return this._getScopedMutationCard(card)
  }

  // --- Internal helpers ---

  /** @internal */
  protected async _getScopedMutationCard(card: Card): Promise<Card> {
    const visibleCard = await this.getCard(card.id)
    if (visibleCard) return visibleCard
    if (this._currentAuthContext) throw new Error(`Card not found: ${card.id}`)
    return card
  }

  /** @internal */
  protected async _resolveCardMutationTarget(cardId: string): Promise<{ card: Card | null; boardId: string }> {
    const card = await this._getCardRaw(cardId)
    return {
      card,
      boardId: card?.boardId ?? this._resolveBoardId(),
    }
  }

  // --- Card queries ---

  async listCards(columns?: string[], boardId?: string, options?: ListCardsOptions): Promise<Card[]>
  async listCards(
    columns?: string[],
    boardId?: string,
    metaFilter?: Record<string, string>,
    sort?: CardSortOption,
    searchQuery?: string,
    fuzzy?: boolean
  ): Promise<Card[]>
  async listCards(
    columns?: string[],
    boardId?: string,
    optionsOrMetaFilter?: ListCardsOptions | Record<string, string>,
    sort?: CardSortOption,
    searchQuery?: string,
    fuzzy?: boolean
  ): Promise<Card[]> {
    const options = normalizeListCardsOptions(optionsOrMetaFilter, sort, searchQuery, fuzzy)
    return Cards.listCards(this._ctx, { columns, boardId, metaFilter: options.metaFilter, sort: options.sort, searchQuery: options.searchQuery, fuzzy: options.fuzzy })
  }

  /** @internal */
  async _listCardsRaw(columns?: string[], boardId?: string): Promise<Card[]> {
    return Cards.listCardsRaw(this._ctx, { columns, boardId })
  }

  async getCard(cardId: string): Promise<Card | null> {
    return Cards.getCard(this._ctx, { cardId })
  }

  /** @internal */
  async _getCardRaw(cardId: string): Promise<Card | null> {
    return Cards.getCardRaw(this._ctx, { cardId })
  }

  async getTaskPermissions(card: Omit<Card, 'filePath'>): Promise<TaskPermissionsReadModel>
  async getTaskPermissions(cardId: string): Promise<TaskPermissionsReadModel | null>
  async getTaskPermissions(cardOrId: string | Omit<Card, 'filePath'>): Promise<TaskPermissionsReadModel | null> {
    const card = typeof cardOrId === 'string' ? await this.getCard(cardOrId) : cardOrId
    return card ? Cards.buildTaskPermissionsReadModel(this._ctx, card) : null
  }

  async getResolvedTaskForms(card: Omit<Card, 'filePath'>): Promise<ResolvedFormDescriptor[]>
  async getResolvedTaskForms(cardId: string): Promise<ResolvedFormDescriptor[] | null>
  async getResolvedTaskForms(cardOrId: string | Omit<Card, 'filePath'>): Promise<ResolvedFormDescriptor[] | null> {
    const card = typeof cardOrId === 'string' ? await this.getCard(cardOrId) : cardOrId
    return card ? Cards.resolveCardForms(this._ctx, card) : null
  }

  // --- Active card ---

  async getActiveCard(boardId?: string): Promise<Card | null> {
    return Cards.getActiveCard(this._ctx, { boardId })
  }

  /** @internal */
  async setActiveCard(cardId: string): Promise<Card> {
    return Cards.setActiveCard(this._ctx, { cardId })
  }

  /** @internal */
  async clearActiveCard(boardId?: string): Promise<void> {
    return Cards.clearActiveCard(this._ctx, { boardId })
  }

  // --- Card mutations ---

  async createCard(data: CreateCardInput): Promise<Card> {
    const mergedInput = await this._runBeforeEvent<CreateCardInput & Record<string, unknown>>('card.create', { ...data } as CreateCardInput & Record<string, unknown>, undefined, data.boardId)
    if (Array.isArray(mergedInput.tasks) && mergedInput.tasks.length > 0) {
      await this._authorizeAction('card.checklist.add')
    }
    const card = await Cards.createCard(this._ctx, mergedInput)
    this._runAfterEvent('task.created', sanitizeCard(card), undefined, card.boardId)
    return this._getScopedMutationCard(card)
  }

  async updateCard(cardId: string, updates: Partial<Card>): Promise<Card> {
    const target = await this._resolveCardMutationTarget(cardId)
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Cards.updateCard>>('card.update', { cardId, updates }, undefined, target.boardId)
    const card = await Cards.updateCard(this._ctx, mergedInput)
    this._runAfterEvent('task.updated', sanitizeCard(card), undefined, card.boardId)
    return this._getScopedMutationCard(card)
  }

  // --- Checklist ---

  async addChecklistItem(cardId: string, title: string, description: string, expectedToken: string): Promise<Card> {
    const target = await this._resolveCardMutationTarget(cardId)
    const createdBy = await this._resolveActorForMutation()
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Cards.addChecklistItem>>(
      'card.checklist.add',
      { cardId, title, description, expectedToken, createdBy },
      undefined,
      target.boardId,
    )
    const card = await Cards.addChecklistItem(this._ctx, mergedInput)
    this._runAfterEvent('task.updated', sanitizeCard(card), undefined, card.boardId)
    return this._getScopedMutationCard(card)
  }

  async editChecklistItem(cardId: string, index: number, title: string, description: string, modifiedAt?: string): Promise<Card> {
    const target = await this._resolveCardMutationTarget(cardId)
    const modifiedBy = await this._resolveActorForMutation()
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Cards.editChecklistItem>>(
      'card.checklist.edit',
      { cardId, index, title, description, modifiedAt, modifiedBy },
      undefined,
      target.boardId,
    )
    const card = await Cards.editChecklistItem(this._ctx, mergedInput)
    this._runAfterEvent('task.updated', sanitizeCard(card), undefined, card.boardId)
    return this._getScopedMutationCard(card)
  }

  async deleteChecklistItem(cardId: string, index: number, modifiedAt?: string): Promise<Card> {
    const target = await this._resolveCardMutationTarget(cardId)
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Cards.deleteChecklistItem>>(
      'card.checklist.delete',
      { cardId, index, modifiedAt },
      undefined,
      target.boardId,
    )
    const card = await Cards.deleteChecklistItem(this._ctx, mergedInput)
    this._runAfterEvent('task.updated', sanitizeCard(card), undefined, card.boardId)
    return this._getScopedMutationCard(card)
  }

  async checkChecklistItem(cardId: string, index: number, modifiedAt?: string): Promise<Card> {
    const target = await this._resolveCardMutationTarget(cardId)
    const modifiedBy = await this._resolveActorForMutation()
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Cards.checkChecklistItem>>(
      'card.checklist.check',
      { cardId, index, modifiedAt, modifiedBy },
      undefined,
      target.boardId,
    )
    const card = await Cards.checkChecklistItem(this._ctx, mergedInput)
    this._runAfterEvent('task.updated', sanitizeCard(card), undefined, card.boardId)
    return this._getScopedMutationCard(card)
  }

  async uncheckChecklistItem(cardId: string, index: number, modifiedAt?: string): Promise<Card> {
    const target = await this._resolveCardMutationTarget(cardId)
    const modifiedBy = await this._resolveActorForMutation()
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Cards.uncheckChecklistItem>>(
      'card.checklist.uncheck',
      { cardId, index, modifiedAt, modifiedBy },
      undefined,
      target.boardId,
    )
    const card = await Cards.uncheckChecklistItem(this._ctx, mergedInput)
    this._runAfterEvent('task.updated', sanitizeCard(card), undefined, card.boardId)
    return this._getScopedMutationCard(card)
  }

  // --- Forms & actions ---

  async submitForm(input: SubmitFormInput): Promise<SubmitFormResult> {
    const target = await this._resolveCardMutationTarget(input.cardId)
    const mergedInput = await this._runBeforeEvent<SubmitFormInput & Record<string, unknown>>('form.submit', { ...input } as SubmitFormInput & Record<string, unknown>, undefined, target.boardId)
    const result = await Cards.submitForm(this._ctx, mergedInput)
    this._runAfterEvent('form.submitted', result, undefined, result.boardId)
    return result
  }

  async triggerAction(cardId: string, action: string): Promise<void> {
    const target = await this._resolveCardMutationTarget(cardId)
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Cards.triggerAction>>('card.action.trigger', { cardId, action }, undefined, target.boardId)
    const payload = await Cards.triggerAction(this._ctx, mergedInput)
    this._runAfterEvent('card.action.triggered', payload, undefined, payload.board)
  }

  // --- Card lifecycle ---

  async moveCard(cardId: string, newStatus: string, position?: number): Promise<Card> {
    const target = await this._resolveCardMutationTarget(cardId)
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Cards.moveCard>>('card.move', { cardId, newStatus, position }, undefined, target.boardId)
    const card = await Cards.moveCard(this._ctx, mergedInput)
    this._runAfterEvent('task.moved', sanitizeCard(card), undefined, card.boardId)
    return this._getScopedMutationCard(card)
  }

  async deleteCard(cardId: string): Promise<void> {
    const target = await this._resolveCardMutationTarget(cardId)
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Cards.deleteCard>>('card.delete', { cardId }, undefined, target.boardId)
    await Cards.deleteCard(this._ctx, mergedInput)
    const deleted = await this.getCard(mergedInput.cardId)
    if (deleted) this._runAfterEvent('task.deleted', sanitizeCard(deleted), undefined, deleted.boardId)
  }

  async permanentlyDeleteCard(cardId: string): Promise<void> {
    const target = await this._resolveCardMutationTarget(cardId)
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Cards.permanentlyDeleteCard>>('card.delete', { cardId }, undefined, target.boardId)
    const snapshot = await this.getCard(mergedInput.cardId)
    await Cards.permanentlyDeleteCard(this._ctx, mergedInput)
    if (snapshot) this._runAfterEvent('task.deleted', sanitizeCard(snapshot), undefined, snapshot.boardId)
  }

  // --- Card queries ---

  async getCardsByStatus(status: string, boardId?: string): Promise<Card[]> {
    return Cards.getCardsByStatus(this._ctx, { status, boardId })
  }

  async getUniqueAssignees(boardId?: string): Promise<string[]> {
    return Cards.getUniqueAssignees(this._ctx, { boardId })
  }

  async getUniqueLabels(boardId?: string): Promise<string[]> {
    return Cards.getUniqueLabels(this._ctx, { boardId })
  }
}
