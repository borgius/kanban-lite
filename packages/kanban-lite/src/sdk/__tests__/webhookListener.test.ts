/**
 * Tests for the built-in WebhookListenerPlugin listener lifecycle contract.
 *
 * These tests verify the plugin correctly implements the SDKEventListenerPlugin
 * interface and handles register/unregister lifecycle without coupling to delivery
 * internals (fireWebhooks). Actual end-to-end delivery behavior — including
 * single-delivery guarantees — is covered at the SDK level by
 * webhook-delegation.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventBus } from '../eventBus'
import { WebhookListenerPlugin, createWebhookListenerPlugin } from '../plugins/webhookListener'

describe('WebhookListenerPlugin listener contract', () => {
  let bus: EventBus
  let plugin: WebhookListenerPlugin

  beforeEach(() => {
    bus = new EventBus()
    plugin = new WebhookListenerPlugin('/workspace')
  })

  afterEach(() => {
    plugin.unregister()
    bus.destroy()
  })

  it('implements SDKEventListenerPlugin: provides event.listener capability', () => {
    expect(plugin.manifest.provides).toContain('event.listener')
  })

  it('register() attaches exactly one subscription to the event bus', () => {
    const onAnySpy = vi.spyOn(bus, 'onAny')
    plugin.register(bus)
    expect(onAnySpy).toHaveBeenCalledOnce()
    onAnySpy.mockRestore()
  })

  it('unregister() before register() does not throw', () => {
    const fresh = new WebhookListenerPlugin('/workspace')
    expect(() => fresh.unregister()).not.toThrow()
  })

  it('unregister() calls the unsubscribe handle returned by onAny', () => {
    const unsubSpy = vi.fn()
    vi.spyOn(bus, 'onAny').mockReturnValueOnce(unsubSpy)
    plugin.register(bus)
    plugin.unregister()
    expect(unsubSpy).toHaveBeenCalledOnce()
  })

  it('unregister() is safe to call multiple times after register()', () => {
    plugin.register(bus)
    plugin.unregister()
    expect(() => plugin.unregister()).not.toThrow()
  })

  it('createWebhookListenerPlugin factory returns a fresh instance each call', () => {
    const p1 = createWebhookListenerPlugin('/workspace')
    const p2 = createWebhookListenerPlugin('/workspace')
    expect(p1).not.toBe(p2)
    expect(p1).toBeInstanceOf(WebhookListenerPlugin)
    p1.unregister()
    p2.unregister()
  })
})
