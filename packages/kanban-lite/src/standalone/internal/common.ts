import * as http from 'http'
import * as os from 'os'
import * as path from 'path'
import type { Card, CardStateErrorTransport, CardStateReadModelTransport, CardStateStatusTransport, ResolvedFormDescriptor, TaskPermissionsReadModel } from '../../shared/types'
import { CARD_STATE_OPEN_DOMAIN } from '../../sdk/types'
import type { StandaloneHttpRequestContext } from '../../sdk'
import type { CardOpenStateValue, CardUnreadSummary } from '../../sdk/types'
import { sanitizeCard } from '../../sdk/types'
import type { CardStateRecord } from '../../sdk/plugins'
import type { StandaloneContext } from '../context'
import { getCardStateErrorLike } from '../authUtils'
import type { MIME_TYPES } from '../httpUtils'

export interface StandaloneRequestContext extends StandaloneHttpRequestContext {
  ctx: StandaloneContext
}

export type StandaloneCardStateAuthRunner = <T>(fn: () => Promise<T>) => Promise<T>

export type StandaloneRouteHandler = (request: StandaloneRequestContext) => Promise<boolean>

export type StandaloneSanitizedCard = ReturnType<typeof sanitizeCard>

export interface StandaloneCardStateReadModel extends CardStateReadModelTransport {
  unread: CardUnreadSummary | null
  open: CardStateRecord<CardOpenStateValue> | null
  status: CardStateStatusTransport
  error?: CardStateErrorTransport
}

export type StandaloneCardReadModel = StandaloneSanitizedCard & {
  cardState: StandaloneCardStateReadModel
  permissions: TaskPermissionsReadModel
  resolvedForms?: ResolvedFormDescriptor[]
}

export interface BuildCardReadModelOptions {
  includeResolvedForms?: boolean
  rethrowCardStateErrors?: boolean
}

export interface StandaloneCardStateMutationModel {
  unread: CardUnreadSummary
  cardState: StandaloneCardStateReadModel
}

export function createRouteMatcher(method: string, pathname: string, matchRoute: (expectedMethod: string, actualMethod: string, pathname: string, pattern: string) => Record<string, string> | null) {
  return (expectedMethod: string, pattern: string): Record<string, string> | null => matchRoute(expectedMethod, method, pathname, pattern)
}

function toCardStateStatus(ctx: StandaloneContext): CardStateStatusTransport {
  const status = ctx.sdk.getCardStateStatus()
  return {
    backend: status.backend,
    availability: status.availability,
    configured: !status.defaultActorAvailable,
    ...(status.errorCode ? { errorCode: status.errorCode } : {}),
  }
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
  runWithAuth?: StandaloneCardStateAuthRunner,
  options?: BuildCardReadModelOptions,
): Promise<StandaloneCardStateReadModel> {
  const run = runWithAuth ?? (async <T,>(fn: () => Promise<T>) => fn())
  const status = toCardStateStatus(ctx)

  try {
    const unread = unreadSummary ?? await run(() => ctx.sdk.getUnreadSummary(cardId, boardId))
    const open = await run(() => ctx.sdk.getCardState(cardId, boardId, CARD_STATE_OPEN_DOMAIN) as Promise<CardStateRecord<CardOpenStateValue> | null>)
    return { unread, open, status }
  } catch (error) {
    const mappedError = getCardStateErrorLike(error)
    if (!mappedError) {
      throw error
    }

    if (options?.rethrowCardStateErrors) {
      throw mappedError
    }

    return {
      unread: null,
      open: null,
      status: {
        ...status,
        availability: mappedError.availability,
        errorCode: mappedError.code,
      },
      error: {
        code: mappedError.code,
        availability: mappedError.availability,
        message: mappedError.message,
      },
    }
  }
}

export async function buildCardReadModel(
  card: Card | StandaloneSanitizedCard,
  ctx: StandaloneContext,
  runWithAuth?: StandaloneCardStateAuthRunner,
  options?: BuildCardReadModelOptions,
): Promise<StandaloneCardReadModel> {
  const sanitized = 'filePath' in card ? sanitizeCard(card) : card
  const run = runWithAuth ?? (async <T,>(fn: () => Promise<T>) => fn())
  const permissions = await run(() => ctx.sdk.getTaskPermissions(sanitized))
  const resolvedForms = options?.includeResolvedForms
    ? await run(() => ctx.sdk.getResolvedTaskForms(sanitized))
    : undefined

  return {
    ...sanitized,
    cardState: await buildCardStateReadModel(ctx, sanitized.id, sanitized.boardId, undefined, runWithAuth, options),
    permissions,
    ...(options?.includeResolvedForms ? { resolvedForms: resolvedForms ?? [] } : {}),
  }
}

export async function buildCardReadModels(
  cards: Card[],
  searchParams: URLSearchParams,
  ctx: StandaloneContext,
  runWithAuth?: StandaloneCardStateAuthRunner,
  options?: BuildCardReadModelOptions,
): Promise<StandaloneCardReadModel[]> {
  const filtered = applyCommonCardFilters(cards, searchParams, ctx)
  return Promise.all(filtered.map(card => buildCardReadModel(card, ctx, runWithAuth, options)))
}

export async function buildCardStateMutationModel(
  ctx: StandaloneContext,
  unread: CardUnreadSummary,
  runWithAuth?: StandaloneCardStateAuthRunner,
): Promise<StandaloneCardStateMutationModel> {
  return {
    unread,
    cardState: await buildCardStateReadModel(ctx, unread.cardId, unread.boardId, unread, runWithAuth),
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
