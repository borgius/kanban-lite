import { KanbanSDK, PluginSettingsOperationError } from '../sdk/KanbanSDK'
import type { CardStateRecord, McpToolResult } from '../sdk/plugins'
import {
  AuthError,
  CardStateError,
  CARD_STATE_OPEN_DOMAIN,
  ERR_CARD_STATE_IDENTITY_UNAVAILABLE,
  ERR_CARD_STATE_UNAVAILABLE,
  type CardOpenStateValue,
  type CardUnreadSummary,
} from '../sdk/types'
import { getDisplayTitleFromContent } from '../shared/types'

export interface McpToolRegistrar {
  tool(
    name: string,
    description: string,
    inputSchema: Record<string, unknown>,
    handler: (args: Record<string, unknown>) => Promise<McpToolResult>,
  ): void
}

export type McpAuthRunner = <T>(fn: () => Promise<T>) => Promise<T>

interface McpCardStateReadModel {
  cardId: string
  boardId: string
  cardState: {
    unread: CardUnreadSummary
    open: CardStateRecord<CardOpenStateValue> | null
  }
}

interface McpCardStateMutationModel {
  unread: CardUnreadSummary
  cardState: McpCardStateReadModel['cardState']
}

export type McpPluginSettingsListModel = Awaited<ReturnType<KanbanSDK['listPluginSettings']>>
export type McpPluginSettingsReadModel = NonNullable<Awaited<ReturnType<KanbanSDK['getPluginSettings']>>>
export type McpPluginSettingsInstallModel = Awaited<ReturnType<KanbanSDK['installPluginSettingsPackage']>>

export function createMcpJsonResult(body: unknown): McpToolResult {
  return { content: [{ type: 'text' as const, text: JSON.stringify(body, null, 2) }] }
}

export function createMcpTextResult(text: string): McpToolResult {
  return { content: [{ type: 'text' as const, text }] }
}

export function createMcpTextErrorResult(text: string): McpToolResult {
  return { ...createMcpTextResult(text), isError: true }
}

function cardStateErrorToPublicMessage(code: typeof ERR_CARD_STATE_IDENTITY_UNAVAILABLE | typeof ERR_CARD_STATE_UNAVAILABLE): string {
  return code === ERR_CARD_STATE_IDENTITY_UNAVAILABLE
    ? 'Card state is unavailable until your configured user identity can be resolved.'
    : 'Unable to update card state right now. Refresh and try again.'
}

export function createMcpCardStateErrorResult(err: unknown): McpToolResult | null {
  if (err instanceof CardStateError) {
    return createMcpJsonResult({
      code: err.code,
      availability: err.availability,
      message: cardStateErrorToPublicMessage(err.code),
    })
  }

  if (!err || typeof err !== 'object') return null
  const code = (err as { code?: unknown }).code
  if (code !== ERR_CARD_STATE_IDENTITY_UNAVAILABLE && code !== ERR_CARD_STATE_UNAVAILABLE) return null

  return createMcpJsonResult({
    code,
    availability: code === ERR_CARD_STATE_IDENTITY_UNAVAILABLE ? 'identity-unavailable' : 'unavailable',
    message: cardStateErrorToPublicMessage(code),
  })
}

export function createMcpErrorResult(err: unknown): McpToolResult {
  const cardStateResult = createMcpCardStateErrorResult(err)
  if (cardStateResult) {
    return { ...cardStateResult, isError: true }
  }
  if (err instanceof Error && (
    err.message.startsWith('Multiple cards match "')
    || err.message.startsWith('Card not found: ')
  )) {
    return createMcpTextErrorResult(err.message)
  }
  if (err instanceof PluginSettingsOperationError) {
    return { ...createMcpJsonResult(err.payload), isError: true }
  }
  if (err instanceof AuthError) {
    return createMcpTextErrorResult(err.message)
  }
  return createMcpTextErrorResult(String(err))
}

export async function resolveMcpCardId(sdk: KanbanSDK, cardId: string, boardId?: string): Promise<string> {
  const card = await sdk.getCard(cardId, boardId)
  if (card) return card.id

  const all = await sdk.listCards(undefined, boardId)
  const matches = all.filter(item => item.id.includes(cardId))
  if (matches.length === 1) return matches[0].id
  if (matches.length > 1) throw new Error(`Multiple cards match "${cardId}": ${matches.map(match => match.id).join(', ')}`)
  throw new Error(`Card not found: ${cardId}`)
}

export async function runWithResolvedMcpCardId<T>(
  sdk: KanbanSDK,
  runWithAuth: McpAuthRunner,
  cardId: string,
  boardId: string | undefined,
  fn: (resolvedId: string) => Promise<T>,
): Promise<T> {
  return runWithAuth(async () => {
    const resolvedId = await resolveMcpCardId(sdk, cardId, boardId)
    return fn(resolvedId)
  })
}

export async function buildMcpCardStateReadModel(sdk: KanbanSDK, cardId: string, boardId?: string): Promise<McpCardStateReadModel> {
  const unread = await sdk.getUnreadSummary(cardId, boardId)
  const open = await sdk.getCardState(unread.cardId, unread.boardId, CARD_STATE_OPEN_DOMAIN) as CardStateRecord<CardOpenStateValue> | null
  return {
    cardId: unread.cardId,
    boardId: unread.boardId,
    cardState: { unread, open },
  }
}

export async function buildMcpCardStateMutationModel(sdk: KanbanSDK, unread: CardUnreadSummary): Promise<McpCardStateMutationModel> {
  const open = await sdk.getCardState(unread.cardId, unread.boardId, CARD_STATE_OPEN_DOMAIN) as CardStateRecord<CardOpenStateValue> | null
  return {
    unread,
    cardState: {
      unread,
      open,
    },
  }
}

export function getBoardTitleFieldsForMcp(sdk: KanbanSDK, boardId?: string): { fields: readonly string[] | undefined; template: string | undefined } {
  const config = sdk.getConfigSnapshot()
  const resolvedBoardId = boardId || config.defaultBoard
  const board = config.boards[resolvedBoardId]
  return { fields: board?.title, template: board?.titleTemplate }
}

export function decorateMcpCardTitle<T extends { content: string; metadata?: Record<string, unknown> }>(
  card: T,
  titleFields?: readonly string[],
  titleTemplate?: string,
): T & { title: string } {
  return {
    ...card,
    title: getDisplayTitleFromContent(card.content, card.metadata, titleFields, titleTemplate),
  }
}

export function resolveOptionalBoardId(boardId: unknown): string | undefined {
  return typeof boardId === 'string' ? boardId : undefined
}
