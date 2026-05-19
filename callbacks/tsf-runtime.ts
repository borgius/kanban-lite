import { getSharedRuntimeHost } from '../packages/kanban-lite/src/shared/runtimeHostState'

export const TSF_CLOUDFLARE_CALLBACK_LOG_SOURCE = 'callback.runtime.cloudflare'
export const TSF_CLOUDFLARE_CALLBACK_LOG_MARKER = 'tsf-kanban-lite-callback'
export const TSF_CLOUDFLARE_TASK_CREATED_LOG_TEXT = 'Cloudflare callback queue processed task.created'
export const TSF_REVIEW_ACTION_LOG_MARKER = 'tsf-kanban-lite-review-action'

interface TsfCallbackSdk {
  listLogs(cardId: string, boardId?: string): Promise<unknown>
  addLog(
    cardId: string,
    text: string,
    options?: { source?: string; object?: Record<string, unknown> },
    boardId?: string,
  ): Promise<unknown>
  moveCard(cardId: string, newStatus: string, position?: number, boardId?: string): Promise<unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getTaskReference(event: unknown): { id: string; boardId?: string } | null {
  if (!isRecord(event) || !isRecord(event.data)) {
    return null
  }

  const id = typeof event.data.id === 'string' ? event.data.id.trim() : ''
  if (!id) {
    return null
  }

  const boardId = typeof event.data.boardId === 'string' && event.data.boardId.trim()
    ? event.data.boardId.trim()
    : undefined

  return { id, boardId }
}

function hasExistingCallbackLog(
  entries: unknown,
  callback: { eventId: string; handlerId: string },
  marker: string,
): boolean {
  if (!Array.isArray(entries)) {
    return false
  }

  return entries.some((entry) => {
    if (!isRecord(entry) || entry.source !== TSF_CLOUDFLARE_CALLBACK_LOG_SOURCE || !isRecord(entry.object)) {
      return false
    }

    return entry.object.marker === marker
      && entry.object.callbackEventId === callback.eventId
      && entry.object.handlerId === callback.handlerId
  })
}

interface EmailAirtableReviewQueuePayload {
  action: 'approve' | 'rematch' | 'analyze'
  boardId: string
  cardId: string
  threadId: string
  candidateId?: string
  airtableRecordId?: string
  runId?: string
  actor?: string
  currentStatus?: string
  analysisModel?: string
  promptTemplate?: string
  reviewerQuestion?: string
  triggerSource: 'action' | 'form'
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function getEmailAirtableReviewCardPayload(
  boardId: string,
  card: Record<string, unknown> | null,
  actor: unknown,
): Omit<EmailAirtableReviewQueuePayload, 'action' | 'analysisModel' | 'promptTemplate' | 'reviewerQuestion' | 'triggerSource'> | null {
  const cardId = typeof card?.id === 'string' ? card.id.trim() : ''
  const currentStatus = typeof card?.status === 'string' ? card.status.trim() : undefined
  const metadata = isRecord(card?.metadata) ? card.metadata : null
  if (!cardId || !metadata) {
    return null
  }

  if (metadata.review_type !== 'email-airtable-link') {
    return null
  }

  const threadId = typeof metadata.thread_id === 'string' ? metadata.thread_id.trim() : ''
  if (!threadId) {
    return null
  }

  return {
    boardId,
    cardId,
    threadId,
    candidateId: normalizeOptionalString(metadata.candidate_id),
    airtableRecordId: normalizeOptionalString(metadata.airtable_record_id),
    runId: normalizeOptionalString(metadata.run_id),
    actor: normalizeOptionalString(actor),
    currentStatus,
  }
}

function getEmailAirtableReviewAction(event: unknown): EmailAirtableReviewQueuePayload | null {
  if (!isRecord(event) || event.event !== 'card.action.triggered' || !isRecord(event.data)) {
    return null
  }

  const action = typeof event.data.action === 'string' ? event.data.action.trim() : ''
  if (action !== 'approve' && action !== 'rematch' && action !== 'analyze') {
    return null
  }

  const boardId = typeof event.data.board === 'string' ? event.data.board.trim() : ''
  if (boardId !== 'email-ops') {
    return null
  }

  const card = isRecord(event.data.card) ? event.data.card : null
  const payload = getEmailAirtableReviewCardPayload(boardId, card, event.actor)
  if (!payload) return null

  return {
    action,
    ...payload,
    triggerSource: 'action',
  }
}

function getEmailAirtableAnalyzeFormSubmission(event: unknown): EmailAirtableReviewQueuePayload | null {
  if (!isRecord(event) || event.event !== 'form.submitted' || !isRecord(event.data)) {
    return null
  }

  const boardId = typeof event.data.boardId === 'string' ? event.data.boardId.trim() : ''
  if (boardId !== 'email-ops') {
    return null
  }

  const form = isRecord(event.data.form) ? event.data.form : null
  const formId = normalizeOptionalString(form?.id)?.toLowerCase()
  const formName = normalizeOptionalString(form?.name)?.toLowerCase()
  if (formId !== 'analyze' && formName !== 'analyze') {
    return null
  }

  const card = isRecord(event.data.card) ? event.data.card : null
  const payload = getEmailAirtableReviewCardPayload(boardId, card, event.actor)
  if (!payload) return null

  const data = isRecord(event.data.data) ? event.data.data : null
  const requestedModel = normalizeOptionalString(data?.model)

  return {
    action: 'analyze',
    ...payload,
    analysisModel: requestedModel === '__default__' ? undefined : requestedModel,
    promptTemplate: normalizeOptionalString(data?.promptTemplate),
    reviewerQuestion: normalizeOptionalString(data?.reviewerQuestion),
    triggerSource: 'form',
  }
}

export async function recordTaskCreatedDiagnostic(input: {
  callback: { eventId: string; handlerId: string; idempotencyKey?: string }
  event: unknown
  sdk: TsfCallbackSdk
}): Promise<void> {
  const task = getTaskReference(input.event)
  if (!task) {
    return
  }

  const existingLogs = await input.sdk.listLogs(task.id, task.boardId)
  if (hasExistingCallbackLog(existingLogs, input.callback, TSF_CLOUDFLARE_CALLBACK_LOG_MARKER)) {
    return
  }

  const eventName = isRecord(input.event) && typeof input.event.event === 'string'
    ? input.event.event
    : 'task.created'

  await input.sdk.addLog(
    task.id,
    TSF_CLOUDFLARE_TASK_CREATED_LOG_TEXT,
    {
      source: TSF_CLOUDFLARE_CALLBACK_LOG_SOURCE,
      object: {
        marker: TSF_CLOUDFLARE_CALLBACK_LOG_MARKER,
        callbackEventId: input.callback.eventId,
        handlerId: input.callback.handlerId,
        idempotencyKey: input.callback.idempotencyKey ?? null,
        event: eventName,
        cardId: task.id,
        boardId: task.boardId ?? null,
      },
    },
    task.boardId,
  )
}

export async function enqueueEmailAirtableReviewAction(input: {
  callback: { eventId: string; handlerId: string; idempotencyKey?: string }
  event: unknown
  sdk: TsfCallbackSdk
}): Promise<void> {
  const payload = getEmailAirtableReviewAction(input.event) ?? getEmailAirtableAnalyzeFormSubmission(input.event)
  if (!payload) {
    return
  }

  const existingLogs = await input.sdk.listLogs(payload.cardId, payload.boardId)
  if (hasExistingCallbackLog(existingLogs, input.callback, TSF_REVIEW_ACTION_LOG_MARKER)) {
    return
  }

  const worker = getSharedRuntimeHost()?.getCloudflareWorkerProviderContext?.()
  const reviewActionsQueue = worker?.requireQueue<{ send(message: unknown): Promise<unknown> }>('reviewActions')
  if (!reviewActionsQueue) {
    throw new Error('Cloudflare Worker queue binding handle `reviewActions` is not available in the kanban runtime host.')
  }

  await reviewActionsQueue.send({
    version: 1,
    type: 'email-airtable-review-action',
    action: payload.action,
    boardId: payload.boardId,
    cardId: payload.cardId,
    threadId: payload.threadId,
    candidateId: payload.candidateId ?? null,
    airtableRecordId: payload.airtableRecordId ?? null,
    runId: payload.runId ?? null,
    actor: payload.actor ?? null,
    analysisModel: payload.analysisModel ?? null,
    promptTemplate: payload.promptTemplate ?? null,
    reviewerQuestion: payload.reviewerQuestion ?? null,
    triggerSource: payload.triggerSource,
    callbackEventId: input.callback.eventId,
    handlerId: input.callback.handlerId,
    queuedAt: new Date().toISOString(),
  })

  if (payload.currentStatus && payload.currentStatus !== 'in-review') {
    await input.sdk.moveCard(payload.cardId, 'in-review', undefined, payload.boardId)
  }

  await input.sdk.addLog(
    payload.cardId,
    `Queued pipeline ${payload.action} ${payload.triggerSource === 'form' ? 'form' : 'action'} for thread \`${payload.threadId}\``,
    {
      source: TSF_CLOUDFLARE_CALLBACK_LOG_SOURCE,
      object: {
        marker: TSF_REVIEW_ACTION_LOG_MARKER,
        callbackEventId: input.callback.eventId,
        handlerId: input.callback.handlerId,
        idempotencyKey: input.callback.idempotencyKey ?? null,
        action: payload.action,
        triggerSource: payload.triggerSource,
        threadId: payload.threadId,
        candidateId: payload.candidateId ?? null,
        airtableRecordId: payload.airtableRecordId ?? null,
        analysisModel: payload.analysisModel ?? null,
        promptTemplate: payload.promptTemplate ?? null,
      },
    },
    payload.boardId,
  )
}
