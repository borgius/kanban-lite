import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventBus } from '../eventBus'
import { WebhookListenerPlugin, createWebhookListenerPlugin } from '../plugins/webhookListener'
import type { SDKEvent } from '../types'

// Mock fireWebhooks
vi.mock('../webhooks', () => ({
  fireWebhooks: vi.fn(),
}))

import { fireWebhooks } from '../webhooks'

function makeEvent(type: string, data: unknown = {}): SDKEvent {
  return { type, data, timestamp: new Date().toISOString() }
}

describe('WebhookListenerPlugin', () => {
  let bus: EventBus
  let plugin: WebhookListenerPlugin

  beforeEach(() => {
    bus = new EventBus()
    plugin = new WebhookListenerPlugin()
    vi.mocked(fireWebhooks).mockReset()
  })

  afterEach(() => {
    plugin.destroy()
    bus.destroy()
  })

  it('has correct manifest', () => {
    expect(plugin.manifest.id).toBe('builtin:webhook-listener')
    expect(plugin.manifest.provides).toContain('event.listener')
  })

  it('subscribes to events on init and calls fireWebhooks', () => {
    plugin.init(bus, '/workspace')
    bus.emit('task.created', makeEvent('task.created', { id: '1' }))
    expect(fireWebhooks).toHaveBeenCalledWith('/workspace', 'task.created', { id: '1' })
  })

  it('receives all event types via onAny', () => {
    plugin.init(bus, '/workspace')
    bus.emit('task.created', makeEvent('task.created', { a: 1 }))
    bus.emit('board.deleted', makeEvent('board.deleted', { b: 2 }))
    bus.emit('auth.denied', makeEvent('auth.denied', { c: 3 }))
    expect(fireWebhooks).toHaveBeenCalledTimes(3)
  })

  it('passes correct workspace root to fireWebhooks', () => {
    plugin.init(bus, '/my/path')
    bus.emit('test', makeEvent('test', {}))
    expect(fireWebhooks).toHaveBeenCalledWith('/my/path', expect.any(String), expect.anything())
  })

  it('destroy() stops receiving events', () => {
    plugin.init(bus, '/workspace')
    plugin.destroy()
    bus.emit('task.created', makeEvent('task.created'))
    expect(fireWebhooks).not.toHaveBeenCalled()
  })

  it('destroy() is safe to call multiple times', () => {
    plugin.init(bus, '/workspace')
    plugin.destroy()
    plugin.destroy() // should not throw
  })

  it('createWebhookListenerPlugin factory returns a fresh instance', () => {
    const p1 = createWebhookListenerPlugin()
    const p2 = createWebhookListenerPlugin()
    expect(p1).not.toBe(p2)
    expect(p1).toBeInstanceOf(WebhookListenerPlugin)
  })
})
