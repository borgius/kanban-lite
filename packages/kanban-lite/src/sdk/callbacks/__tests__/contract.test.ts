import { describe, expect, it } from 'vitest'

import {
  CALLBACK_DURABLE_EVENT_RECORD_D1_WRITE_BUDGET,
  buildCallbackHandlerIdempotencyKey,
  createDurableCallbackDispatchMetadata,
  createDurableCallbackHandlerClaims,
  createDurableCallbackHandlerRevision,
  getDurableCallbackDispatchMetadata,
  getDurableCallbackHandlerClaims,
  withDurableCallbackDispatchMeta,
} from '../contract'

describe('durable callback dispatch contract', () => {
  it('creates durable callback metadata with checkpoint-per-handler-attempt Cloudflare D1 budgets', () => {
    const metadata = createDurableCallbackDispatchMetadata('cb_evt_fixed')

    expect(CALLBACK_DURABLE_EVENT_RECORD_D1_WRITE_BUDGET).toEqual({
      claimOrUpsert: 1,
      checkpointPerHandlerAttempt: 1,
      terminalStatusUpdateIncludedInCheckpoint: true,
      lifecycleFormula: '1 + total handler attempts',
    })

    expect(metadata).toEqual({
      eventId: 'cb_evt_fixed',
      idempotencyScope: 'event-handler',
      budgets: {
        durableEventRecordD1Writes: CALLBACK_DURABLE_EVENT_RECORD_D1_WRITE_BUDGET,
      },
    })
  })

  it('keys handler idempotency by durable event id plus handler id', () => {
    expect(buildCallbackHandlerIdempotencyKey('cb_evt_fixed', 'handler-a')).toBe(
      'callback-event:cb_evt_fixed:handler:handler-a',
    )
    expect(buildCallbackHandlerIdempotencyKey('cb_evt_fixed', 'handler-a')).not.toBe(
      buildCallbackHandlerIdempotencyKey('cb_evt_fixed', 'handler-b'),
    )
    expect(buildCallbackHandlerIdempotencyKey('cb_evt_fixed', 'handler-a')).not.toBe(
      buildCallbackHandlerIdempotencyKey('cb_evt_other', 'handler-a'),
    )
  })

  it('creates stable handler revisions from executable payload and match config fingerprints', () => {
    const revisionA = createDurableCallbackHandlerRevision({
      type: 'inline',
      events: ['task.created'],
      source: 'async ({ event }) => event.event',
    })
    const revisionB = createDurableCallbackHandlerRevision({
      source: 'async ({ event }) => event.event',
      events: ['task.created'],
      type: 'inline',
    })
    const revisionC = createDurableCallbackHandlerRevision({
      type: 'inline',
      events: ['task.updated'],
      source: 'async ({ event }) => event.event',
    })

    expect(revisionA).toBe(revisionB)
    expect(revisionA).not.toBe(revisionC)
  })

  it('promotes durable callback claims from event-only metadata to event-plus-handler claims', () => {
    const claims = createDurableCallbackHandlerClaims(
      createDurableCallbackDispatchMetadata('cb_evt_fixed'),
      'handler-a',
      'sha256:handler-a',
    )

    expect(claims).toEqual({
      eventId: 'cb_evt_fixed',
      handlerId: 'handler-a',
      handlerRevision: 'sha256:handler-a',
      idempotencyKey: 'callback-event:cb_evt_fixed:handler:handler-a',
      idempotencyScope: 'event-handler',
      budgets: {
        durableEventRecordD1Writes: CALLBACK_DURABLE_EVENT_RECORD_D1_WRITE_BUDGET,
      },
    })
    expect(getDurableCallbackHandlerClaims(claims)).toEqual(claims)
  })

  it('merges durable callback metadata into event meta without discarding existing fields', () => {
    const merged = withDurableCallbackDispatchMeta({ audit: true, source: 'test' }, 'cb_evt_meta')

    expect(merged).toMatchObject({
      audit: true,
      source: 'test',
    })
    expect(getDurableCallbackDispatchMetadata(merged)).toEqual({
      eventId: 'cb_evt_meta',
      idempotencyScope: 'event-handler',
      budgets: {
        durableEventRecordD1Writes: CALLBACK_DURABLE_EVENT_RECORD_D1_WRITE_BUDGET,
      },
    })
  })
})
