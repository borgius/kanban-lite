import { describe, expect, it, vi } from 'vitest'

import {
  recordTaskCreatedDiagnostic,
  TSF_CLOUDFLARE_CALLBACK_LOG_MARKER,
  TSF_CLOUDFLARE_CALLBACK_LOG_SOURCE,
  TSF_CLOUDFLARE_TASK_CREATED_LOG_TEXT,
} from '../../../callbacks/tsf-runtime'

describe('tsf Cloudflare callback runtime handler', () => {
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
})
