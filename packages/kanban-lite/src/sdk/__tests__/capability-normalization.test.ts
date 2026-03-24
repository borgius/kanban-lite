import { describe, expect, it } from 'vitest'
import { normalizeStorageCapabilities, normalizeAuthCapabilities, normalizeWebhookCapabilities } from '../../shared/config'
import type { KanbanConfig } from '../../shared/config'
import { DEFAULT_CONFIG } from '../../shared/config'
import { collectActiveExternalPackageNames } from '../plugins'

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

  it('plugins["webhook.delivery"] takes precedence over webhookPlugin', () => {
    const result = normalizeWebhookCapabilities(
      makeConfig({
        plugins: { 'webhook.delivery': { provider: 'from-plugins' } },
        webhookPlugin: { 'webhook.delivery': { provider: 'from-webhookPlugin' } },
      })
    )
    expect(result['webhook.delivery']).toEqual({ provider: 'from-plugins' })
  })

  it('falls back to webhookPlugin when plugins["webhook.delivery"] is absent', () => {
    const result = normalizeWebhookCapabilities(
      makeConfig({ webhookPlugin: { 'webhook.delivery': { provider: 'legacy-provider' } } })
    )
    expect(result['webhook.delivery']).toEqual({ provider: 'legacy-provider' })
  })
})

describe('collectActiveExternalPackageNames', () => {
  describe('webhook provider discovery', () => {
    it('includes kl-webhooks-plugin by default when no webhook config is present', () => {
      const result = collectActiveExternalPackageNames({})
      expect(result).toContain('kl-webhooks-plugin')
    })

    it('legacy webhookPlugin config activates kl-webhooks-plugin via alias', () => {
      const result = collectActiveExternalPackageNames({
        webhookPlugin: { 'webhook.delivery': { provider: 'webhooks' } },
      })
      expect(result).toContain('kl-webhooks-plugin')
    })

    it('plugins["webhook.delivery"] with alias "webhooks" resolves to kl-webhooks-plugin', () => {
      const result = collectActiveExternalPackageNames({
        plugins: { 'webhook.delivery': { provider: 'webhooks' } },
      })
      expect(result).toContain('kl-webhooks-plugin')
    })

    it('plugins["webhook.delivery"] takes precedence over webhookPlugin', () => {
      const result = collectActiveExternalPackageNames({
        plugins: { 'webhook.delivery': { provider: 'my-custom-delivery' } },
        webhookPlugin: { 'webhook.delivery': { provider: 'webhooks' } },
      })
      expect(result).toContain('my-custom-delivery')
      expect(result).not.toContain('kl-webhooks-plugin')
    })

    it('custom webhook package name from webhookPlugin is passed through without alias', () => {
      const result = collectActiveExternalPackageNames({
        webhookPlugin: { 'webhook.delivery': { provider: 'my-webhook-delivery-pkg' } },
      })
      expect(result).toContain('my-webhook-delivery-pkg')
      expect(result).not.toContain('kl-webhooks-plugin')
    })
  })

  describe('auth provider discovery', () => {
    it('auth providers from legacy auth key are resolved via alias', () => {
      const result = collectActiveExternalPackageNames({
        auth: {
          'auth.identity': { provider: 'noop' },
          'auth.policy': { provider: 'rbac' },
        },
      })
      expect(result).toContain('kl-auth-plugin')
    })

    it('plugins auth key takes precedence over legacy auth key', () => {
      const result = collectActiveExternalPackageNames({
        plugins: { 'auth.identity': { provider: 'noop' } },
        auth: { 'auth.identity': { provider: 'custom-auth' } },
      })
      expect(result).toContain('kl-auth-plugin')
      expect(result).not.toContain('custom-auth')
    })
  })

  describe('storage provider discovery', () => {
    it('custom external card provider from plugins is included', () => {
      const result = collectActiveExternalPackageNames({
        plugins: { 'card.storage': { provider: 'my-custom-storage' } },
      })
      expect(result).toContain('my-custom-storage')
    })

    it('built-in "markdown" card provider is excluded', () => {
      const result = collectActiveExternalPackageNames({
        plugins: { 'card.storage': { provider: 'markdown' } },
      })
      expect(result).not.toContain('markdown')
    })

    it('built-in "localfs" attachment provider is excluded', () => {
      const result = collectActiveExternalPackageNames({
        plugins: { 'attachment.storage': { provider: 'localfs' } },
      })
      expect(result).not.toContain('localfs')
    })

    it('storage alias "sqlite" resolves to kl-sqlite-storage', () => {
      const result = collectActiveExternalPackageNames({
        plugins: { 'card.storage': { provider: 'sqlite' } },
      })
      expect(result).toContain('kl-sqlite-storage')
    })
  })

  describe('general contract', () => {
    it('result is deduplicated when same package provides multiple capabilities', () => {
      const result = collectActiveExternalPackageNames({
        plugins: {
          'auth.identity': { provider: 'noop' },
          'auth.policy': { provider: 'rbac' },
        },
      })
      const authPkgCount = result.filter(p => p === 'kl-auth-plugin').length
      expect(authPkgCount).toBe(1)
    })

    it('does not mutate the input config', () => {
      const config = {
        plugins: { 'webhook.delivery': { provider: 'webhooks', options: { x: 1 } } },
        webhookPlugin: { 'webhook.delivery': { provider: 'legacy', options: { y: 2 } } },
      }
      const before = JSON.stringify(config)
      collectActiveExternalPackageNames(config)
      expect(JSON.stringify(config)).toBe(before)
    })

    it('accepts a plain object with no fields (minimal Pick)', () => {
      const result = collectActiveExternalPackageNames({})
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
    })
  })
})
