import { afterEach, describe, expect, it, vi } from 'vitest'

import { installSharedRuntimeHost, resetSharedRuntimeHost } from '../../kanban-lite/src/shared/runtimeHostState'

import {
  enqueueEmailAirtableReviewAction,
  recordTaskCreatedDiagnostic,
  TSF_CLOUDFLARE_CALLBACK_LOG_MARKER,
  TSF_CLOUDFLARE_CALLBACK_LOG_SOURCE,
  TSF_CLOUDFLARE_TASK_CREATED_LOG_TEXT,
  TSF_REVIEW_ACTION_LOG_MARKER,
} from '../../../callbacks/tsf-runtime'

describe('tsf Cloudflare callback runtime handler', () => {
  afterEach(() => {
    resetSharedRuntimeHost()
  })

  it('writes an observable diagnostic task log for task.created events', async () => {
    const listLogs = vi.fn(async () => [])
    const addLog = vi.fn(async () => ({ ok: true }))

    await recordTaskCreatedDiagnostic({
      callback: {
        eventId: 'cb_evt_task_created',
        handlerId: 'tsf-task-created-diagnostic',
        idempotencyKey: 'callback-event:cb_evt_task_created:handler:tsf-task-created-diagnostic',
      },
      event: {
        event: 'task.created',
        data: {
          id: 'card-123',
          boardId: 'default',
        },
      },
      sdk: {
        listLogs,
        addLog,
      },
    })

    expect(listLogs).toHaveBeenCalledWith('card-123', 'default')
    expect(addLog).toHaveBeenCalledWith(
      'card-123',
      TSF_CLOUDFLARE_TASK_CREATED_LOG_TEXT,
      expect.objectContaining({
        source: TSF_CLOUDFLARE_CALLBACK_LOG_SOURCE,
        object: expect.objectContaining({
          marker: TSF_CLOUDFLARE_CALLBACK_LOG_MARKER,
          callbackEventId: 'cb_evt_task_created',
          handlerId: 'tsf-task-created-diagnostic',
          idempotencyKey: 'callback-event:cb_evt_task_created:handler:tsf-task-created-diagnostic',
          event: 'task.created',
          cardId: 'card-123',
          boardId: 'default',
        }),
      }),
      'default',
    )
  })

  it('is idempotent for duplicate queue deliveries of the same callback event', async () => {
    const listLogs = vi.fn(async () => ([
      {
        source: TSF_CLOUDFLARE_CALLBACK_LOG_SOURCE,
        text: TSF_CLOUDFLARE_TASK_CREATED_LOG_TEXT,
        object: {
          marker: TSF_CLOUDFLARE_CALLBACK_LOG_MARKER,
          callbackEventId: 'cb_evt_task_created',
          handlerId: 'tsf-task-created-diagnostic',
        },
      },
    ]))
    const addLog = vi.fn(async () => ({ ok: true }))

    await recordTaskCreatedDiagnostic({
      callback: {
        eventId: 'cb_evt_task_created',
        handlerId: 'tsf-task-created-diagnostic',
      },
      event: {
        event: 'task.created',
        data: {
          id: 'card-123',
          boardId: 'default',
        },
      },
      sdk: {
        listLogs,
        addLog,
      },
    })

    expect(listLogs).toHaveBeenCalledWith('card-123', 'default')
    expect(addLog).not.toHaveBeenCalled()
  })

  it.each(['approve', 'rematch', 'analyze'] as const)('enqueues %s review actions for email-ops email-airtable link cards', async (action) => {
    const send = vi.fn(async () => undefined)
    const requireQueue = vi.fn((handleName: string) => {
      expect(handleName).toBe('reviewActions')
      return { send }
    })
    installSharedRuntimeHost({
      getCloudflareWorkerProviderContext: () => ({ requireQueue }),
    } as never)

    const listLogs = vi.fn(async () => [])
    const addLog = vi.fn(async () => ({ ok: true }))
    const moveCard = vi.fn(async () => ({ ok: true }))

    await enqueueEmailAirtableReviewAction({
      callback: {
        eventId: `cb_evt_${action}`,
        handlerId: 'tsf-review-action',
        idempotencyKey: `callback-event:cb_evt_${action}:handler:tsf-review-action`,
      },
      event: {
        event: 'card.action.triggered',
        actor: 'reviewer',
        data: {
          action,
          board: 'email-ops',
          card: {
            id: 'card-123',
            status: 'needs-review',
            metadata: {
              review_type: 'email-airtable-link',
              thread_id: 'thread-123',
              candidate_id: 'candidate-123',
              airtable_record_id: 'record-123',
              run_id: 'run-123',
            },
          },
        },
      },
      sdk: {
        listLogs,
        addLog,
        moveCard,
      },
    })

    expect(listLogs).toHaveBeenCalledWith('card-123', 'email-ops')
    expect(requireQueue).toHaveBeenCalledWith('reviewActions')
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      version: 1,
      type: 'email-airtable-review-action',
      action,
      boardId: 'email-ops',
      cardId: 'card-123',
      threadId: 'thread-123',
      candidateId: 'candidate-123',
      airtableRecordId: 'record-123',
      runId: 'run-123',
      actor: 'reviewer',
      triggerSource: 'action',
      callbackEventId: `cb_evt_${action}`,
      handlerId: 'tsf-review-action',
    }))
    expect(moveCard).toHaveBeenCalledWith('card-123', 'in-review', undefined, 'email-ops')
    expect(addLog).toHaveBeenCalledWith(
      'card-123',
      `Queued pipeline ${action} action for thread \`thread-123\``,
      expect.objectContaining({
        source: TSF_CLOUDFLARE_CALLBACK_LOG_SOURCE,
        object: expect.objectContaining({
          marker: TSF_REVIEW_ACTION_LOG_MARKER,
          callbackEventId: `cb_evt_${action}`,
          handlerId: 'tsf-review-action',
          idempotencyKey: `callback-event:cb_evt_${action}:handler:tsf-review-action`,
          action,
          triggerSource: 'action',
          threadId: 'thread-123',
          candidateId: 'candidate-123',
          airtableRecordId: 'record-123',
        }),
      }),
      'email-ops',
    )
  })

  it('ignores unsupported or non-email-airtable review action events without touching the queue', async () => {
    const requireQueue = vi.fn()
    installSharedRuntimeHost({
      getCloudflareWorkerProviderContext: () => ({ requireQueue }),
    } as never)

    const listLogs = vi.fn(async () => [])
    const addLog = vi.fn(async () => ({ ok: true }))
    const moveCard = vi.fn(async () => ({ ok: true }))
    const sdk = { listLogs, addLog, moveCard }
    const callback = {
      eventId: 'cb_evt_ignored',
      handlerId: 'tsf-review-action',
    }

    for (const data of [
      {
        action: 'reject',
        board: 'email-ops',
        card: {
          id: 'card-123',
          metadata: { review_type: 'email-airtable-link', thread_id: 'thread-123' },
        },
      },
      {
        action: 'analyze',
        board: 'default',
        card: {
          id: 'card-123',
          metadata: { review_type: 'email-airtable-link', thread_id: 'thread-123' },
        },
      },
      {
        action: 'analyze',
        board: 'email-ops',
        card: {
          id: 'card-123',
          metadata: { review_type: 'other-review', thread_id: 'thread-123' },
        },
      },
    ]) {
      await enqueueEmailAirtableReviewAction({
        callback,
        event: {
          event: 'card.action.triggered',
          data,
        },
        sdk,
      })
    }

    expect(listLogs).not.toHaveBeenCalled()
    expect(requireQueue).not.toHaveBeenCalled()
    expect(addLog).not.toHaveBeenCalled()
    expect(moveCard).not.toHaveBeenCalled()
  })

  it('enqueues analyze review actions from Analyze form submissions with selected options', async () => {
    const send = vi.fn(async () => undefined)
    const requireQueue = vi.fn((handleName: string) => {
      expect(handleName).toBe('reviewActions')
      return { send }
    })
    installSharedRuntimeHost({
      getCloudflareWorkerProviderContext: () => ({ requireQueue }),
    } as never)

    const listLogs = vi.fn(async () => [])
    const addLog = vi.fn(async () => ({ ok: true }))
    const moveCard = vi.fn(async () => ({ ok: true }))

    await enqueueEmailAirtableReviewAction({
      callback: {
        eventId: 'cb_evt_form_analyze',
        handlerId: 'tsf-review-action',
        idempotencyKey: 'callback-event:cb_evt_form_analyze:handler:tsf-review-action',
      },
      event: {
        event: 'form.submitted',
        actor: 'reviewer',
        data: {
          boardId: 'email-ops',
          form: {
            id: 'analyze',
            name: 'Analyze',
          },
          data: {
            model: '@cf/meta/llama-4-scout-17b-16e-instruct',
            promptTemplate: 'approval_readiness',
            reviewerQuestion: 'What evidence is still missing for auto-approve?',
          },
          card: {
            id: 'card-123',
            status: 'needs-review',
            metadata: {
              review_type: 'email-airtable-link',
              thread_id: 'thread-123',
              candidate_id: 'candidate-123',
              airtable_record_id: 'record-123',
              run_id: 'run-123',
            },
          },
        },
      },
      sdk: {
        listLogs,
        addLog,
        moveCard,
      },
    })

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      version: 1,
      type: 'email-airtable-review-action',
      action: 'analyze',
      boardId: 'email-ops',
      cardId: 'card-123',
      threadId: 'thread-123',
      candidateId: 'candidate-123',
      airtableRecordId: 'record-123',
      runId: 'run-123',
      actor: 'reviewer',
      analysisModel: '@cf/meta/llama-4-scout-17b-16e-instruct',
      promptTemplate: 'approval_readiness',
      reviewerQuestion: 'What evidence is still missing for auto-approve?',
      triggerSource: 'form',
      callbackEventId: 'cb_evt_form_analyze',
      handlerId: 'tsf-review-action',
    }))
    expect(moveCard).toHaveBeenCalledWith('card-123', 'in-review', undefined, 'email-ops')
    expect(addLog).toHaveBeenCalledWith(
      'card-123',
      'Queued pipeline analyze form for thread `thread-123`',
      expect.objectContaining({
        source: TSF_CLOUDFLARE_CALLBACK_LOG_SOURCE,
        object: expect.objectContaining({
          marker: TSF_REVIEW_ACTION_LOG_MARKER,
          callbackEventId: 'cb_evt_form_analyze',
          handlerId: 'tsf-review-action',
          action: 'analyze',
          triggerSource: 'form',
          threadId: 'thread-123',
          analysisModel: '@cf/meta/llama-4-scout-17b-16e-instruct',
          promptTemplate: 'approval_readiness',
        }),
      }),
      'email-ops',
    )
  })
})
