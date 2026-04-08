import { createHash, randomUUID } from 'node:crypto'

export const CALLBACK_EVENT_ID_PREFIX = 'cb_evt' as const
export const CALLBACK_HANDLER_IDEMPOTENCY_SCOPE = 'event-handler' as const

/**
 * Shared Cloudflare D1 durability budget model for callback event records.
 *
 * The runtime claims or inserts the durable record once, then checkpoints that
 * record after every handler attempt. The terminal summary is folded into the
 * last checkpoint, so the full lifecycle budget is `1 + total handler
 * attempts`.
 */
export const CALLBACK_DURABLE_EVENT_RECORD_D1_WRITE_BUDGET = Object.freeze({
  claimOrUpsert: 1,
  checkpointPerHandlerAttempt: 1,
  terminalStatusUpdateIncludedInCheckpoint: true,
  lifecycleFormula: '1 + total handler attempts',
} as const)

export interface DurableCallbackDispatchMetadata {
  readonly eventId: string
  readonly idempotencyScope: typeof CALLBACK_HANDLER_IDEMPOTENCY_SCOPE
  readonly budgets: {
    readonly durableEventRecordD1Writes: typeof CALLBACK_DURABLE_EVENT_RECORD_D1_WRITE_BUDGET
  }
}

export interface DurableCallbackHandlerClaims extends DurableCallbackDispatchMetadata {
  readonly handlerId: string
  readonly handlerRevision: string
  readonly idempotencyKey: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeStableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeStableJsonValue(entry))
  }

  if (isRecord(value)) {
    const normalizedEntries = Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, normalizeStableJsonValue(value[key])] as const)
      .filter(([, entry]) => entry !== undefined)

    return Object.fromEntries(normalizedEntries)
  }

  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'function' || typeof value === 'symbol' || value === undefined) return undefined
  return value
}

function normalizeNonEmptyIdentifier(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) {
    throw new Error(`${label} must be a non-empty string.`)
  }
  return normalized
}

export function createDurableCallbackEventId(): string {
  return `${CALLBACK_EVENT_ID_PREFIX}_${randomUUID()}`
}

export function createDurableCallbackDispatchMetadata(
  eventId: string = createDurableCallbackEventId(),
): DurableCallbackDispatchMetadata {
  return {
    eventId: normalizeNonEmptyIdentifier(eventId, 'callback event id'),
    idempotencyScope: CALLBACK_HANDLER_IDEMPOTENCY_SCOPE,
    budgets: {
      durableEventRecordD1Writes: CALLBACK_DURABLE_EVENT_RECORD_D1_WRITE_BUDGET,
    },
  }
}

export function createDurableCallbackHandlerRevision(fingerprintSource: unknown): string {
  const normalized = normalizeStableJsonValue(fingerprintSource)
  return `sha256:${createHash('sha256').update(JSON.stringify(normalized)).digest('hex')}`
}

export function createDurableCallbackHandlerClaims(
  dispatch: DurableCallbackDispatchMetadata,
  handlerId: string,
  handlerRevision: string,
): DurableCallbackHandlerClaims {
  const normalizedHandlerId = normalizeNonEmptyIdentifier(handlerId, 'callback handler id')
  const normalizedHandlerRevision = normalizeNonEmptyIdentifier(
    handlerRevision,
    'callback handler revision',
  )

  return {
    ...dispatch,
    handlerId: normalizedHandlerId,
    handlerRevision: normalizedHandlerRevision,
    idempotencyKey: buildCallbackHandlerIdempotencyKey(dispatch.eventId, normalizedHandlerId),
  }
}

export function withDurableCallbackDispatchMeta(
  meta?: Record<string, unknown>,
  eventId?: string,
): Record<string, unknown> {
  return {
    ...(meta ?? {}),
    callback: createDurableCallbackDispatchMetadata(eventId),
  }
}

export function getDurableCallbackDispatchMetadata(
  meta: unknown,
): DurableCallbackDispatchMetadata | null {
  if (!isRecord(meta)) return null
  const callback = meta.callback
  if (!isRecord(callback)) return null
  if (typeof callback.eventId !== 'string' || callback.eventId.trim().length === 0) return null
  if (callback.idempotencyScope !== CALLBACK_HANDLER_IDEMPOTENCY_SCOPE) return null

  return {
    eventId: callback.eventId,
    idempotencyScope: CALLBACK_HANDLER_IDEMPOTENCY_SCOPE,
    budgets: {
      durableEventRecordD1Writes: CALLBACK_DURABLE_EVENT_RECORD_D1_WRITE_BUDGET,
    },
  }
}

export function getDurableCallbackHandlerClaims(
  value: unknown,
): DurableCallbackHandlerClaims | null {
  if (!isRecord(value)) return null

  const candidate = isRecord(value.callback) ? value.callback : value
  if (!isRecord(candidate)) return null
  if (typeof candidate.eventId !== 'string' || candidate.eventId.trim().length === 0) return null
  if (candidate.idempotencyScope !== CALLBACK_HANDLER_IDEMPOTENCY_SCOPE) return null
  if (typeof candidate.handlerId !== 'string' || candidate.handlerId.trim().length === 0) return null
  if (typeof candidate.handlerRevision !== 'string' || candidate.handlerRevision.trim().length === 0) return null

  const handlerId = candidate.handlerId.trim()
  const eventId = candidate.eventId.trim()
  const idempotencyKey = buildCallbackHandlerIdempotencyKey(eventId, handlerId)
  if (candidate.idempotencyKey !== idempotencyKey) return null

  return {
    eventId,
    idempotencyScope: CALLBACK_HANDLER_IDEMPOTENCY_SCOPE,
    budgets: {
      durableEventRecordD1Writes: CALLBACK_DURABLE_EVENT_RECORD_D1_WRITE_BUDGET,
    },
    handlerId,
    handlerRevision: candidate.handlerRevision.trim(),
    idempotencyKey,
  }
}

export function buildCallbackHandlerIdempotencyKey(eventId: string, handlerId: string): string {
  const normalizedEventId = normalizeNonEmptyIdentifier(eventId, 'callback event id')
  const normalizedHandlerId = normalizeNonEmptyIdentifier(handlerId, 'callback handler id')
  return `callback-event:${normalizedEventId}:handler:${normalizedHandlerId}`
}
