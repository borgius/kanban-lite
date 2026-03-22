/**
 * Tests for the built-in WebhookListenerPlugin EventListenerPlugin lifecycle contract.
 *
 * These tests verify the plugin correctly implements the EventListenerPlugin
 * interface and handles init/destroy lifecycle without coupling to delivery
 * internals (fireWebhooks). Actual end-to-end delivery behavior — including
 * single-delivery guarantees — is covered at the SDK level by
 * webhook-delegation.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventBus } from '../eventBus'
import { WebhookListenerPlugin, createWebhookListenerPlugin } from '../plugins/webhookListener'

describe('WebhookListenerPlugin EventListenerPlugin contract', () => {
  let bus: EventBus
  let plugin: WebhookListenerPlugin

  beforeEach(() => {
    bus = new EventBus()
    plugin = new WebhookListenerPlugin()
  })

  afterEach(() => {
    plugin.destroy()
    bus.destroy()
  })

  it('implements EventListenerPlugin: provides event.listener capability', () => {
    expect(plugin.manifest.provides).toContain('event.listener')
  })

  it('init() attaches exactly one subscription to the event bus', () => {
    const onAnySpy = vi.spyOn(bus, 'onAny')
    plugin.init(bus, '/workspace')
    expect(onAnySpy).toHaveBeenCalledOnce()
    onAnySpy.mockRestore()
  })

  it('destroy() before init() does not throw', () => {
    const fresh = new WebhookListenerPlugin()
    expect(() => fresh.destroy()).not.toThrow()
  })

  it('destroy() calls the unsubscribe handle returned by onAny', () => {
    const unsubSpy = vi.fn()
    vi.spyOn(bus, 'onAny').mockReturnValueOnce(unsubSpy)
    plugin.init(bus, '/workspace')
    plugin.destroy()
    expect(unsubSpy).toHaveBeenCalledOnce()
  })

  it('destroy() is safe to call multiple times after init()', () => {
    plugin.init(bus, '/workspace')
    plugin.destroy()
    expect(() => plugin.destroy()).not.toThrow()
  })

  it('createWebhookListenerPlugin factory returns a fresh instance each call', () => {
    const p1 = createWebhookListenerPlugin()
    const p2 = createWebhookListenerPlugin()
    expect(p1).not.toBe(p2)
    expect(p1).toBeInstanceOf(WebhookListenerPlugin)
    p1.destroy()
    p2.destroy()
  })
})
