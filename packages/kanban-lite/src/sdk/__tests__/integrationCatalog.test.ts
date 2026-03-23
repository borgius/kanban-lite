import { describe, expect, it } from 'vitest'
import {
  KANBAN_ACTION_CATALOG,
  KANBAN_EVENT_CATALOG,
  getActionsByResource,
  getApiAfterEvents,
  getEventsByResource,
  getSdkAfterEvents,
  getSdkBeforeEvents,
} from '../integrationCatalog'
import type { KanbanResource } from '../integrationCatalog'

function toEventNameSet(entries: ReadonlyArray<{ event: string }>): ReadonlySet<string> {
  return new Set(entries.map(entry => entry.event))
}

describe('KANBAN_EVENT_CATALOG', () => {
  it('is non-empty', () => {
    expect(KANBAN_EVENT_CATALOG.length).toBeGreaterThan(0)
  })

  it('every entry has event, resource, label, and transport flags', () => {
    for (const entry of KANBAN_EVENT_CATALOG) {
      expect(typeof entry.event).toBe('string')
      expect(entry.event.length).toBeGreaterThan(0)
      expect(typeof entry.resource).toBe('string')
      expect(typeof entry.label).toBe('string')
      expect(typeof entry.sdkBefore).toBe('boolean')
      expect(typeof entry.sdkAfter).toBe('boolean')
      expect(typeof entry.apiAfter).toBe('boolean')
    }
  })

  it('no two entries share the same event name', () => {
    const names = KANBAN_EVENT_CATALOG.map(e => e.event)
    expect(new Set(names).size).toBe(names.length)
  })

  it('every entry is either a before-event or an after-event, never both', () => {
    for (const entry of KANBAN_EVENT_CATALOG) {
      const isBeforeOrAfter = entry.sdkBefore !== entry.sdkAfter
      expect(isBeforeOrAfter).toBe(true)
    }
  })

  describe('before-event transport invariants', () => {
    it('all before-events have sdkBefore=true, sdkAfter=false, apiAfter=false', () => {
      const beforeEvents = KANBAN_EVENT_CATALOG.filter(e => e.sdkBefore)
      expect(beforeEvents.length).toBeGreaterThan(0)
      for (const entry of beforeEvents) {
        expect(entry.sdkBefore).toBe(true)
        expect(entry.sdkAfter).toBe(false)
        expect(entry.apiAfter).toBe(false)
      }
    })

    it('contains expected before-event SDK names', () => {
      const names = toEventNameSet(KANBAN_EVENT_CATALOG.filter(e => e.sdkBefore))
      expect(names.has('card.create')).toBe(true)
      expect(names.has('card.update')).toBe(true)
      expect(names.has('card.move')).toBe(true)
      expect(names.has('card.delete')).toBe(true)
      expect(names.has('card.transfer')).toBe(true)
      expect(names.has('card.action.trigger')).toBe(true)
      expect(names.has('board.create')).toBe(true)
      expect(names.has('column.create')).toBe(true)
      expect(names.has('comment.create')).toBe(true)
      expect(names.has('label.set')).toBe(true)
      expect(names.has('webhook.create')).toBe(true)
      expect(names.has('form.submit')).toBe(true)
      expect(names.has('storage.migrate')).toBe(true)
    })

    it('before-events are NOT present in apiAfter set', () => {
      const beforeNames = toEventNameSet(KANBAN_EVENT_CATALOG.filter(e => e.sdkBefore))
      const apiNames = toEventNameSet(getApiAfterEvents())
      for (const name of beforeNames) {
        expect(apiNames.has(name)).toBe(false)
      }
    })
  })

  describe('after-event transport invariants', () => {
    it('all after-events have sdkBefore=false, sdkAfter=true, apiAfter=true', () => {
      const afterEvents = KANBAN_EVENT_CATALOG.filter(e => e.sdkAfter)
      expect(afterEvents.length).toBeGreaterThan(0)
      for (const entry of afterEvents) {
        expect(entry.sdkBefore).toBe(false)
        expect(entry.sdkAfter).toBe(true)
        expect(entry.apiAfter).toBe(true)
      }
    })

    it('contains expected after-event SDK names (task.* not card.*)', () => {
      const names = toEventNameSet(KANBAN_EVENT_CATALOG.filter(e => e.sdkAfter))
      expect(names.has('task.created')).toBe(true)
      expect(names.has('task.updated')).toBe(true)
      expect(names.has('task.moved')).toBe(true)
      expect(names.has('task.deleted')).toBe(true)
      expect(names.has('comment.created')).toBe(true)
      expect(names.has('column.created')).toBe(true)
      expect(names.has('board.created')).toBe(true)
      expect(names.has('attachment.added')).toBe(true)
      expect(names.has('settings.updated')).toBe(true)
      expect(names.has('form.submitted')).toBe(true)
      expect(names.has('auth.allowed')).toBe(true)
      expect(names.has('auth.denied')).toBe(true)
    })

    it('does NOT contain incorrect card event aliases', () => {
      const afterNames = toEventNameSet(KANBAN_EVENT_CATALOG.filter(e => e.sdkAfter))
      // Trigger node stub had wrong names - these must NOT exist in catalog
      expect(afterNames.has('card.created')).toBe(false)
      expect(afterNames.has('card.updated')).toBe(false)
      expect(afterNames.has('card.moved')).toBe(false)
      expect(afterNames.has('label.created')).toBe(false)
      expect(afterNames.has('label.updated')).toBe(false)
    })

    it('all after-events are also apiAfter events', () => {
      const afterEvents = getSdkAfterEvents()
      const apiEvents = toEventNameSet(getApiAfterEvents())
      for (const entry of afterEvents) {
        expect(apiEvents.has(entry.event)).toBe(true)
      }
    })
  })

  describe('resource coverage', () => {
    const EXPECTED_RESOURCES: KanbanResource[] = [
      'board', 'card', 'comment', 'attachment', 'column', 'label',
      'settings', 'storage', 'form', 'webhook', 'auth',
    ]

    it.each(EXPECTED_RESOURCES)('has at least one event for resource: %s', (resource) => {
      const events = getEventsByResource(resource)
      expect(events.length).toBeGreaterThan(0)
    })
  })
})

describe('KANBAN_ACTION_CATALOG', () => {
  it('is non-empty', () => {
    expect(KANBAN_ACTION_CATALOG.length).toBeGreaterThan(0)
  })

  it('every entry has resource, operation, and label', () => {
    for (const entry of KANBAN_ACTION_CATALOG) {
      expect(typeof entry.resource).toBe('string')
      expect(typeof entry.operation).toBe('string')
      expect(entry.operation.length).toBeGreaterThan(0)
      expect(typeof entry.label).toBe('string')
    }
  })

  const EXPECTED_ACTION_RESOURCES: KanbanResource[] = [
    'board', 'card', 'comment', 'attachment', 'column', 'label',
    'settings', 'storage', 'form', 'webhook', 'workspace', 'auth',
  ]

  it.each(EXPECTED_ACTION_RESOURCES)('has at least one action for resource: %s', (resource) => {
    const actions = getActionsByResource(resource)
    expect(actions.length).toBeGreaterThan(0)
  })

  it('card resource includes create, list, get, update, move, delete', () => {
    const ops: ReadonlySet<string> = new Set(getActionsByResource('card').map(a => a.operation))
    expect(ops.has('create')).toBe(true)
    expect(ops.has('list')).toBe(true)
    expect(ops.has('get')).toBe(true)
    expect(ops.has('update')).toBe(true)
    expect(ops.has('move')).toBe(true)
    expect(ops.has('delete')).toBe(true)
  })
})

describe('catalog helper functions', () => {
  it('getSdkBeforeEvents returns only before-events', () => {
    const result = getSdkBeforeEvents()
    expect(result.length).toBeGreaterThan(0)
    for (const e of result) {
      expect(e.sdkBefore).toBe(true)
      expect(e.sdkAfter).toBe(false)
    }
  })

  it('getSdkAfterEvents returns only after-events', () => {
    const result = getSdkAfterEvents()
    expect(result.length).toBeGreaterThan(0)
    for (const e of result) {
      expect(e.sdkAfter).toBe(true)
      expect(e.sdkBefore).toBe(false)
    }
  })

  it('getApiAfterEvents returns a subset of SDK after-events', () => {
    const apiEvents = getApiAfterEvents()
    const sdkAfterNames = toEventNameSet(getSdkAfterEvents())
    expect(apiEvents.length).toBeGreaterThan(0)
    for (const e of apiEvents) {
      expect(sdkAfterNames.has(e.event)).toBe(true)
    }
  })

  it('getEventsByResource filters correctly', () => {
    const cardEvents = getEventsByResource('card')
    expect(cardEvents.every(e => e.resource === 'card')).toBe(true)
    expect(cardEvents.length).toBeGreaterThan(0)
  })

  it('getActionsByResource filters correctly', () => {
    const boardActions = getActionsByResource('board')
    expect(boardActions.every(a => a.resource === 'board')).toBe(true)
    expect(boardActions.length).toBeGreaterThan(0)
  })

  it('before-event count + after-event count equals total catalog size', () => {
    expect(getSdkBeforeEvents().length + getSdkAfterEvents().length).toBe(KANBAN_EVENT_CATALOG.length)
  })
})
