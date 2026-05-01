import * as path from 'path'
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

  async transferCard(cardId: string, fromBoardId: string, toBoardId: string, targetStatus?: string): Promise<Card> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Boards.transferCard>>('card.transfer', {
      cardId,
      fromBoardId,
      toBoardId,
      targetStatus,
    }, undefined, fromBoardId)
    const snapshot = await this.getCard(mergedInput.cardId, mergedInput.fromBoardId)
    const card = await Boards.transferCard(this._ctx, mergedInput)
    this._runAfterEvent('task.moved', sanitizeCard(card), undefined, card.boardId, {
      previousStatus: snapshot?.status,
      fromBoard: mergedInput.fromBoardId,
      toBoard: mergedInput.toBoardId,
      transfer: true,
    })
    return this._getScopedMutationCard(card)
  }

  // --- Internal helpers ---

  /** @internal */
  protected async _getScopedMutationCard(card: Card): Promise<Card> {
    const visibleCard = await this.getCard(card.id, card.boardId)
    if (visibleCard) return visibleCard
    if (this._currentAuthContext) throw new Error(`Card not found: ${card.id}`)
    return card
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

  async getCard(cardId: string, boardId?: string): Promise<Card | null> {
    return Cards.getCard(this._ctx, { cardId, boardId })
  }

  /** @internal */
  async _getCardRaw(cardId: string, boardId?: string): Promise<Card | null> {
    return Cards.getCardRaw(this._ctx, { cardId, boardId })
  }

  async getTaskPermissions(card: Omit<Card, 'filePath'>): Promise<TaskPermissionsReadModel>
  async getTaskPermissions(cardId: string, boardId?: string): Promise<TaskPermissionsReadModel | null>
  async getTaskPermissions(cardOrId: string | Omit<Card, 'filePath'>, boardId?: string): Promise<TaskPermissionsReadModel | null> {
    const card = typeof cardOrId === 'string' ? await this.getCard(cardOrId, boardId) : cardOrId
    return card ? Cards.buildTaskPermissionsReadModel(this._ctx, card) : null
  }

  async getResolvedTaskForms(card: Omit<Card, 'filePath'>): Promise<ResolvedFormDescriptor[]>
  async getResolvedTaskForms(cardId: string, boardId?: string): Promise<ResolvedFormDescriptor[] | null>
  async getResolvedTaskForms(cardOrId: string | Omit<Card, 'filePath'>, boardId?: string): Promise<ResolvedFormDescriptor[] | null> {
    const card = typeof cardOrId === 'string' ? await this.getCard(cardOrId, boardId) : cardOrId
    return card ? Cards.resolveCardForms(this._ctx, card) : null
  }

  // --- Active card ---

  async getActiveCard(boardId?: string): Promise<Card | null> {
    return Cards.getActiveCard(this._ctx, { boardId })
  }

  /** @internal */
  async setActiveCard(cardId: string, boardId?: string): Promise<Card> {
    return Cards.setActiveCard(this._ctx, { cardId, boardId })
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

  async updateCard(cardId: string, updates: Partial<Card>, boardId?: string): Promise<Card> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Cards.updateCard>>('card.update', { cardId, updates, boardId }, undefined, boardId)
    const card = await Cards.updateCard(this._ctx, mergedInput)
    this._runAfterEvent('task.updated', sanitizeCard(card), undefined, card.boardId)
    return this._getScopedMutationCard(card)
  }

  // --- Checklist ---

  async addChecklistItem(cardId: string, title: string, description: string, expectedToken: string, boardId?: string): Promise<Card> {
    const createdBy = await this._resolveActorForMutation()
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Cards.addChecklistItem>>(
      'card.checklist.add',
      { cardId, title, description, expectedToken, boardId, createdBy },
      undefined,
      boardId,
    )
    const card = await Cards.addChecklistItem(this._ctx, mergedInput)
    this._runAfterEvent('task.updated', sanitizeCard(card), undefined, card.boardId)
    return this._getScopedMutationCard(card)
  }

  async editChecklistItem(cardId: string, index: number, title: string, description: string, modifiedAt?: string, boardId?: string): Promise<Card> {
    const modifiedBy = await this._resolveActorForMutation()
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Cards.editChecklistItem>>(
      'card.checklist.edit',
      { cardId, index, title, description, modifiedAt, boardId, modifiedBy },
      undefined,
      boardId,
    )
    const card = await Cards.editChecklistItem(this._ctx, mergedInput)
    this._runAfterEvent('task.updated', sanitizeCard(card), undefined, card.boardId)
    return this._getScopedMutationCard(card)
  }

  async deleteChecklistItem(cardId: string, index: number, modifiedAt?: string, boardId?: string): Promise<Card> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Cards.deleteChecklistItem>>(
      'card.checklist.delete',
      { cardId, index, modifiedAt, boardId },
      undefined,
      boardId,
    )
    const card = await Cards.deleteChecklistItem(this._ctx, mergedInput)
    this._runAfterEvent('task.updated', sanitizeCard(card), undefined, card.boardId)
    return this._getScopedMutationCard(card)
  }

  async checkChecklistItem(cardId: string, index: number, modifiedAt?: string, boardId?: string): Promise<Card> {
    const modifiedBy = await this._resolveActorForMutation()
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Cards.checkChecklistItem>>(
      'card.checklist.check',
      { cardId, index, modifiedAt, boardId, modifiedBy },
      undefined,
      boardId,
    )
    const card = await Cards.checkChecklistItem(this._ctx, mergedInput)
    this._runAfterEvent('task.updated', sanitizeCard(card), undefined, card.boardId)
    return this._getScopedMutationCard(card)
  }

  async uncheckChecklistItem(cardId: string, index: number, modifiedAt?: string, boardId?: string): Promise<Card> {
    const modifiedBy = await this._resolveActorForMutation()
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Cards.uncheckChecklistItem>>(
      'card.checklist.uncheck',
      { cardId, index, modifiedAt, boardId, modifiedBy },
      undefined,
      boardId,
    )
    const card = await Cards.uncheckChecklistItem(this._ctx, mergedInput)
    this._runAfterEvent('task.updated', sanitizeCard(card), undefined, card.boardId)
    return this._getScopedMutationCard(card)
  }

  // --- Forms & actions ---

  async submitForm(input: SubmitFormInput): Promise<SubmitFormResult> {
    const mergedInput = await this._runBeforeEvent<SubmitFormInput & Record<string, unknown>>('form.submit', { ...input } as SubmitFormInput & Record<string, unknown>, undefined, input.boardId)
    const result = await Cards.submitForm(this._ctx, mergedInput)
    this._runAfterEvent('form.submitted', result, undefined, result.boardId)
    return result
  }

  async triggerAction(cardId: string, action: string, boardId?: string): Promise<void> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Cards.triggerAction>>('card.action.trigger', { cardId, action, boardId }, undefined, boardId)
    const payload = await Cards.triggerAction(this._ctx, mergedInput)
    this._runAfterEvent('card.action.triggered', payload, undefined, payload.board)
  }

  // --- Card lifecycle ---

  async moveCard(cardId: string, newStatus: string, position?: number, boardId?: string): Promise<Card> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Cards.moveCard>>('card.move', { cardId, newStatus, position, boardId }, undefined, boardId)
    const card = await Cards.moveCard(this._ctx, mergedInput)
    this._runAfterEvent('task.moved', sanitizeCard(card), undefined, card.boardId)
    return this._getScopedMutationCard(card)
  }

  async deleteCard(cardId: string, boardId?: string): Promise<void> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Cards.deleteCard>>('card.delete', { cardId, boardId }, undefined, boardId)
    await Cards.deleteCard(this._ctx, mergedInput)
    const deleted = await this.getCard(mergedInput.cardId, mergedInput.boardId)
    if (deleted) this._runAfterEvent('task.deleted', sanitizeCard(deleted), undefined, deleted.boardId)
  }

  async permanentlyDeleteCard(cardId: string, boardId?: string): Promise<void> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Cards.permanentlyDeleteCard>>('card.delete', { cardId, boardId }, undefined, boardId)
    const snapshot = await this.getCard(mergedInput.cardId, mergedInput.boardId)
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
