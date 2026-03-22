import { describe, expect, it } from 'vitest'
import { normalizeStorageCapabilities, normalizeAuthCapabilities, normalizeWebhookCapabilities } from '../../shared/config'
import type { KanbanConfig } from '../../shared/config'
import { DEFAULT_CONFIG } from '../../shared/config'

/** Minimal valid config scaffold for tests. */
function makeConfig(overrides: Partial<KanbanConfig> = {}): KanbanConfig {
  return { ...DEFAULT_CONFIG, ...overrides }
}

describe('normalizeStorageCapabilities', () => {
  describe('card.storage', () => {
    it('defaults to markdown when no storage fields are set', () => {
      const result = normalizeStorageCapabilities(makeConfig())
      expect(result['card.storage']).toEqual({ provider: 'markdown' })
    })

    it('maps storageEngine="markdown" to markdown provider', () => {
      const result = normalizeStorageCapabilities(makeConfig({ storageEngine: 'markdown' }))
      expect(result['card.storage']).toEqual({ provider: 'markdown' })
    })

    it('maps storageEngine="sqlite" to sqlite provider with default sqlitePath', () => {
      const result = normalizeStorageCapabilities(makeConfig({ storageEngine: 'sqlite' }))
      expect(result['card.storage']).toEqual({
        provider: 'sqlite',
        options: { sqlitePath: '.kanban/kanban.db' },
      })
    })

    it('maps storageEngine="sqlite" with explicit sqlitePath', () => {
      const result = normalizeStorageCapabilities(
        makeConfig({ storageEngine: 'sqlite', sqlitePath: 'data/custom.db' })
      )
      expect(result['card.storage']).toEqual({
        provider: 'sqlite',
        options: { sqlitePath: 'data/custom.db' },
      })
    })

    it('plugins["card.storage"] overrides legacy storageEngine', () => {
      const result = normalizeStorageCapabilities(
        makeConfig({
          storageEngine: 'sqlite',
          sqlitePath: '.kanban/kanban.db',
          plugins: { 'card.storage': { provider: 'markdown' } },
        })
      )
      expect(result['card.storage']).toEqual({ provider: 'markdown' })
    })

    it('plugins["card.storage"] with custom options is passed through', () => {
      const result = normalizeStorageCapabilities(
        makeConfig({
          plugins: {
            'card.storage': { provider: 'kanban-mysql-plugin', options: { host: 'localhost' } },
          },
        })
      )
      expect(result['card.storage']).toEqual({
        provider: 'kanban-mysql-plugin',
        options: { host: 'localhost' },
      })
    })
  })

  describe('attachment.storage', () => {
    it('defaults to localfs', () => {
      const result = normalizeStorageCapabilities(makeConfig())
      expect(result['attachment.storage']).toEqual({ provider: 'localfs' })
    })

    it('localfs default is independent of storageEngine value', () => {
      const result = normalizeStorageCapabilities(makeConfig({ storageEngine: 'sqlite' }))
      expect(result['attachment.storage']).toEqual({ provider: 'localfs' })
    })

    it('plugins["attachment.storage"] overrides localfs default', () => {
      const result = normalizeStorageCapabilities(
        makeConfig({
          plugins: { 'attachment.storage': { provider: 's3', options: { bucket: 'my-bucket' } } },
        })
      )
      expect(result['attachment.storage']).toEqual({
        provider: 's3',
        options: { bucket: 'my-bucket' },
      })
    })
  })

  describe('backward compatibility', () => {
    it('both core namespaces are always present in the output', () => {
      const result = normalizeStorageCapabilities(makeConfig())
      expect(result).toHaveProperty('card.storage')
      expect(result).toHaveProperty('attachment.storage')
    })

    it('config without storage keys round-trips without mutation', () => {
      const config = makeConfig()
      const before = JSON.stringify(config)
      normalizeStorageCapabilities(config)
      expect(JSON.stringify(config)).toBe(before)
    })
  })
})

describe('normalizeAuthCapabilities', () => {
  it('defaults both namespaces to noop when auth is absent', () => {
    const result = normalizeAuthCapabilities(makeConfig())
    expect(result['auth.identity']).toEqual({ provider: 'noop' })
    expect(result['auth.policy']).toEqual({ provider: 'noop' })
  })

  it('defaults auth.policy to noop when only auth.identity is configured', () => {
    const result = normalizeAuthCapabilities(
      makeConfig({ auth: { 'auth.identity': { provider: 'my-identity-plugin' } } })
    )
    expect(result['auth.identity']).toEqual({ provider: 'my-identity-plugin' })
    expect(result['auth.policy']).toEqual({ provider: 'noop' })
  })

  it('defaults auth.identity to noop when only auth.policy is configured', () => {
    const result = normalizeAuthCapabilities(
      makeConfig({ auth: { 'auth.policy': { provider: 'my-policy-plugin' } } })
    )
    expect(result['auth.identity']).toEqual({ provider: 'noop' })
    expect(result['auth.policy']).toEqual({ provider: 'my-policy-plugin' })
  })

  it('passes through explicit providers with options', () => {
    const result = normalizeAuthCapabilities(
      makeConfig({
        auth: {
          'auth.identity': { provider: 'my-identity', options: { realm: 'test' } },
          'auth.policy': { provider: 'my-policy', options: { strict: true } },
        },
      })
    )
    expect(result['auth.identity']).toEqual({ provider: 'my-identity', options: { realm: 'test' } })
    expect(result['auth.policy']).toEqual({ provider: 'my-policy', options: { strict: true } })
  })

  it('both namespaces always present in output', () => {
    const result = normalizeAuthCapabilities(makeConfig())
    expect(result).toHaveProperty('auth.identity')
    expect(result).toHaveProperty('auth.policy')
  })

  it('does not mutate the input config', () => {
    const config = makeConfig({ auth: { 'auth.identity': { provider: 'my-plugin', options: { x: 1 } } } })
    const before = JSON.stringify(config)
    normalizeAuthCapabilities(config)
    expect(JSON.stringify(config)).toBe(before)
  })

  it('accepts a plain object with only auth field (Pick<KanbanConfig, "auth">)', () => {
    const result = normalizeAuthCapabilities({})
    expect(result['auth.identity']).toEqual({ provider: 'noop' })
    expect(result['auth.policy']).toEqual({ provider: 'noop' })
  })
})

describe('normalizeWebhookCapabilities', () => {
  it('defaults to webhooks provider when webhookPlugin is absent', () => {
    const result = normalizeWebhookCapabilities(makeConfig())
    expect(result['webhook.delivery']).toEqual({ provider: 'webhooks' })
  })

  it('defaults to webhooks provider when webhookPlugin is an empty object', () => {
    const result = normalizeWebhookCapabilities(makeConfig({ webhookPlugin: {} }))
    expect(result['webhook.delivery']).toEqual({ provider: 'webhooks' })
  })

  it('passes through an explicit webhook.delivery provider', () => {
    const result = normalizeWebhookCapabilities(
      makeConfig({ webhookPlugin: { 'webhook.delivery': { provider: 'my-webhook-plugin' } } })
    )
    expect(result['webhook.delivery']).toEqual({ provider: 'my-webhook-plugin' })
  })

  it('passes through explicit provider with options', () => {
    const result = normalizeWebhookCapabilities(
      makeConfig({
        webhookPlugin: { 'webhook.delivery': { provider: 'my-webhook-plugin', options: { retries: 3 } } },
      })
    )
    expect(result['webhook.delivery']).toEqual({ provider: 'my-webhook-plugin', options: { retries: 3 } })
  })

  it('webhook.delivery namespace is always present in output', () => {
    const result = normalizeWebhookCapabilities(makeConfig())
    expect(result).toHaveProperty('webhook.delivery')
  })

  it('does not mutate the input config', () => {
    const config = makeConfig({
      webhookPlugin: { 'webhook.delivery': { provider: 'my-plugin', options: { x: 1 } } },
    })
    const before = JSON.stringify(config)
    normalizeWebhookCapabilities(config)
    expect(JSON.stringify(config)).toBe(before)
  })

  it('accepts a plain object with only webhookPlugin field (Pick<KanbanConfig, "webhookPlugin">)', () => {
    const result = normalizeWebhookCapabilities({})
    expect(result['webhook.delivery']).toEqual({ provider: 'webhooks' })
  })
})
