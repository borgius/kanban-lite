import * as http from 'http'
import * as os from 'os'
import * as path from 'path'
import type { Card } from '../../shared/types'
import { CARD_STATE_OPEN_DOMAIN } from '../../sdk/types'
import type { StandaloneHttpRequestContext } from '../../sdk'
import type { CardOpenStateValue, CardUnreadSummary } from '../../sdk/types'
import { sanitizeCard } from '../../sdk/types'
import type { CardStateRecord } from '../../sdk/plugins'
import type { StandaloneContext } from '../context'
import type { MIME_TYPES } from '../httpUtils'

export interface StandaloneRequestContext extends StandaloneHttpRequestContext {
  ctx: StandaloneContext
}

export type StandaloneRouteHandler = (request: StandaloneRequestContext) => Promise<boolean>

export type StandaloneSanitizedCard = ReturnType<typeof sanitizeCard>

export interface StandaloneCardStateReadModel {
  unread: CardUnreadSummary
  open: CardStateRecord<CardOpenStateValue> | null
}

export type StandaloneCardReadModel = StandaloneSanitizedCard & {
  cardState: StandaloneCardStateReadModel
}

export interface StandaloneCardStateMutationModel {
  unread: CardUnreadSummary
  cardState: StandaloneCardStateReadModel
}

export function createRouteMatcher(method: string, pathname: string, matchRoute: (expectedMethod: string, actualMethod: string, pathname: string, pattern: string) => Record<string, string> | null) {
  return (expectedMethod: string, pattern: string): Record<string, string> | null => matchRoute(expectedMethod, method, pathname, pattern)
}

export function applyCommonCardFilters(cards: Card[], searchParams: URLSearchParams, ctx: StandaloneContext): ReturnType<typeof sanitizeCard>[] {
  let result = cards.map(sanitizeCard)

  if (searchParams.get('includeDeleted') !== 'true') {
    result = result.filter(card => card.status !== 'deleted')
  }

  const status = searchParams.get('status')
  if (status) result = result.filter(card => card.status === status)

  const priority = searchParams.get('priority')
  if (priority) result = result.filter(card => card.priority === priority)

  const assignee = searchParams.get('assignee')
  if (assignee) result = result.filter(card => card.assignee === assignee)

  const label = searchParams.get('label')
  if (label) result = result.filter(card => card.labels.includes(label))

  const labelGroup = searchParams.get('labelGroup')
  if (labelGroup) {
    const groupLabels = ctx.sdk.getLabelsInGroup(labelGroup)
    result = result.filter(card => card.labels.some(item => groupLabels.includes(item)))
  }

  return result
}

export async function buildCardStateReadModel(
  ctx: StandaloneContext,
  cardId: string,
  boardId?: string,
  unreadSummary?: CardUnreadSummary,
): Promise<StandaloneCardStateReadModel> {
  const unread = unreadSummary ?? await ctx.sdk.getUnreadSummary(cardId, boardId)
  const open = await ctx.sdk.getCardState(cardId, boardId, CARD_STATE_OPEN_DOMAIN) as CardStateRecord<CardOpenStateValue> | null
  return { unread, open }
}

export async function buildCardReadModel(
  card: Card | StandaloneSanitizedCard,
  ctx: StandaloneContext,
): Promise<StandaloneCardReadModel> {
  const sanitized = 'filePath' in card ? sanitizeCard(card) : card
  return {
    ...sanitized,
    cardState: await buildCardStateReadModel(ctx, sanitized.id, sanitized.boardId),
  }
}

export async function buildCardReadModels(
  cards: Card[],
  searchParams: URLSearchParams,
  ctx: StandaloneContext,
): Promise<StandaloneCardReadModel[]> {
  const filtered = applyCommonCardFilters(cards, searchParams, ctx)
  return Promise.all(filtered.map(card => buildCardReadModel(card, ctx)))
}

export async function buildCardStateMutationModel(
  ctx: StandaloneContext,
  unread: CardUnreadSummary,
): Promise<StandaloneCardStateMutationModel> {
  return {
    unread,
    cardState: await buildCardStateReadModel(ctx, unread.cardId, unread.boardId, unread),
  }
}

export function buildProviderSummary(
  storageStatus: ReturnType<StandaloneContext['sdk']['getStorageStatus']>,
  webhookStatus?: ReturnType<StandaloneContext['sdk']['getWebhookStatus']>,
) {
  if (!storageStatus.providers) return null
  const summary: Record<string, string> = {
    'card.storage': storageStatus.providers['card.storage'].provider,
    'attachment.storage': storageStatus.providers['attachment.storage'].provider,
  }
  if (webhookStatus) {
    summary['webhook.delivery'] = webhookStatus.webhookProvider
  }
  return summary
}

export function jsonText(body: unknown): string {
  return JSON.stringify(body)
}

export function sendNoContent(res: http.ServerResponse): void {
  res.writeHead(204)
  res.end()
}

export function resolveWorkspacePath(rawPath: string, workspaceRoot: string): string {
  return /^([/~]|[A-Za-z]:[/\\])/.test(rawPath)
    ? rawPath.replace(/^~/, process.env.HOME ?? os.homedir())
    : path.resolve(workspaceRoot, rawPath)
}

export function resolveStaticFilePath(resolvedWebviewDir: string, pathname: string): string {
  return path.join(resolvedWebviewDir, pathname === '/' ? 'index.html' : pathname)
}

export function getContentType(filePath: string, mimeTypes: typeof MIME_TYPES): string {
  return mimeTypes[path.extname(filePath)] || 'application/octet-stream'
}
