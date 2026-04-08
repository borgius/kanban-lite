import { describe, expect, it } from 'vitest'
import {
  normalizeStorageCapabilities,
  normalizeAuthCapabilities,
  normalizeWebhookCapabilities,
  normalizeCardStateCapabilities,
  normalizeCallbackCapabilities,
  normalizeConfigStorageSelection,
  PLUGIN_CAPABILITY_NAMESPACES,
} from '../../shared/config'
import type { KanbanConfig } from '../../shared/config'
import { DEFAULT_CONFIG } from '../../shared/config'
import { collectActiveExternalPackageNames } from '../plugins'
import {
  createPluginSettingsErrorPayload,
  DEFAULT_PLUGIN_SETTINGS_REDACTION,
  PLUGIN_SETTINGS_INSTALL_SCOPES,
  PluginSettingsValidationError,
  validatePluginSettingsInstallRequest,
} from '../KanbanSDK'

/** Minimal valid config scaffold for tests. */
function makeConfig(overrides: Partial<KanbanConfig> = {}): KanbanConfig {
  return { ...DEFAULT_CONFIG, ...overrides }
}

describe('normalizeStorageCapabilities', () => {
  describe('card.storage', () => {
    it('defaults to localfs when no storage fields are set', () => {
      const result = normalizeStorageCapabilities(makeConfig())
      expect(result['card.storage']).toEqual({ provider: 'localfs' })
    })

    it('maps storageEngine="markdown" to localfs provider', () => {
      const result = normalizeStorageCapabilities(makeConfig({ storageEngine: 'markdown' }))
      expect(result['card.storage']).toEqual({ provider: 'localfs' })
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
      expect(result['card.storage']).toEqual({ provider: 'localfs' })
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

    it('derives attachment.storage from card.storage when storageEngine selects sqlite', () => {
      const result = normalizeStorageCapabilities(makeConfig({ storageEngine: 'sqlite' }))
      expect(result['attachment.storage']).toEqual({
        provider: 'sqlite',
        options: { sqlitePath: '.kanban/kanban.db' },
      })
    })

    it('reuses card.storage options when attachment.storage selects the same provider', () => {
      const result = normalizeStorageCapabilities(
        makeConfig({
          plugins: {
            'card.storage': { provider: 'sqlite', options: { sqlitePath: '.kanban/custom.db' } },
            'attachment.storage': { provider: 'sqlite' },
          },
        })
      )

      expect(result['attachment.storage']).toEqual({
        provider: 'sqlite',
        options: { sqlitePath: '.kanban/custom.db' },
      })
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
  it('defaults identity/policy to noop and visibility to none when auth is absent', () => {
    const result = normalizeAuthCapabilities(makeConfig())
    expect(result['auth.identity']).toEqual({ provider: 'noop' })
    expect(result['auth.policy']).toEqual({ provider: 'noop' })
    expect(result['auth.visibility']).toEqual({ provider: 'none' })
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

  it('plugins["auth.visibility"] takes precedence over legacy auth visibility config', () => {
    const result = normalizeAuthCapabilities(
      makeConfig({
        plugins: {
          'auth.visibility': {
            provider: 'kl-plugin-auth-visibility',
            options: { mode: 'rules' },
          },
        },
        auth: {
          'auth.visibility': {
            provider: 'legacy-auth-visibility',
            options: { legacy: true },
          },
        },
      })
    )

    expect(result['auth.visibility']).toEqual({
      provider: 'kl-plugin-auth-visibility',
      options: { mode: 'rules' },
    })
  })

  it('all auth namespaces are always present in output', () => {
    const result = normalizeAuthCapabilities(makeConfig())
    expect(result).toHaveProperty('auth.identity')
    expect(result).toHaveProperty('auth.policy')
    expect(result).toHaveProperty('auth.visibility')
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
    expect(result['auth.visibility']).toEqual({ provider: 'none' })
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

describe('normalizeCallbackCapabilities', () => {
  it('defaults callback.runtime to none when config is absent', () => {
    const result = normalizeCallbackCapabilities(makeConfig())
    expect(result['callback.runtime']).toEqual({ provider: 'none' })
  })

  it('passes through an explicit callback.runtime provider with options', () => {
    const result = normalizeCallbackCapabilities(
      makeConfig({
        plugins: { 'callback.runtime': { provider: 'callbacks', options: { handlers: [] } } },
      })
    )

    expect(result['callback.runtime']).toEqual({
      provider: 'callbacks',
      options: { handlers: [] },
    })
  })

  it('callback.runtime namespace is always present in output', () => {
    const result = normalizeCallbackCapabilities(makeConfig())
    expect(result).toHaveProperty('callback.runtime')
  })

  it('does not mutate the input config', () => {
    const config = makeConfig({
      plugins: { 'callback.runtime': { provider: 'callbacks', options: { enabled: true } } },
    })
    const before = JSON.stringify(config)
    normalizeCallbackCapabilities(config)
    expect(JSON.stringify(config)).toBe(before)
  })

  it('accepts a plain object with only plugins field', () => {
    const result = normalizeCallbackCapabilities({})
    expect(result['callback.runtime']).toEqual({ provider: 'none' })
  })
})

describe('normalizeConfigStorageSelection', () => {
  it('falls back to localfs when no explicit config.storage override exists', () => {
    const result = normalizeConfigStorageSelection(makeConfig())

    expect(result).toEqual({
      configured: null,
      effective: { provider: 'localfs' },
      mode: 'fallback',
      failure: null,
    })
  })

  it('derives the effective config.storage provider from first-party card.storage when no explicit override exists', () => {
    const result = normalizeConfigStorageSelection(
      makeConfig({
        storageEngine: 'sqlite',
        sqlitePath: '.kanban/config.db',
      })
    )

    expect(result).toEqual({
      configured: null,
      effective: {
        provider: 'sqlite',
        options: { sqlitePath: '.kanban/config.db' },
      },
      mode: 'derived',
      failure: null,
    })
  })

  it('derives config.storage from the canonical cloudflare storage bundle when no explicit override exists', () => {
    const result = normalizeConfigStorageSelection(
      makeConfig({
        plugins: {
          'card.storage': { provider: 'cloudflare' },
        },
      })
    )

    expect(result).toEqual({
      configured: null,
      effective: { provider: 'cloudflare' },
      mode: 'derived',
      failure: null,
    })
  })

  it('preserves an explicit config.storage override even when it matches a derived provider default', () => {
    const result = normalizeConfigStorageSelection(
      makeConfig({
        storageEngine: 'sqlite',
        sqlitePath: '.kanban/config.db',
        plugins: {
          'config.storage': { provider: 'sqlite', options: { sqlitePath: '.kanban/config.db' } },
        },
      })
    )

    expect(result).toEqual({
      configured: {
        provider: 'sqlite',
        options: { sqlitePath: '.kanban/config.db' },
      },
      effective: {
        provider: 'sqlite',
        options: { sqlitePath: '.kanban/config.db' },
      },
      mode: 'explicit',
      failure: null,
    })
  })

  it('surfaces explicit override failures instead of silently deriving a fallback provider', () => {
    const result = normalizeConfigStorageSelection(
      makeConfig({
        storageEngine: 'sqlite',
        sqlitePath: '.kanban/derived.db',
        plugins: {
          'config.storage': { provider: 'cloudflare', options: { databaseId: 'cfg-db' } },
        },
      }),
      {
        explicitFailure: {
          code: 'config-storage-provider-unavailable',
          message: 'Cloudflare config storage is unavailable.',
        },
      }
    )

    expect(result).toEqual({
      configured: {
        provider: 'cloudflare',
        options: { databaseId: 'cfg-db' },
      },
      effective: null,
      mode: 'error',
      failure: {
        code: 'config-storage-provider-unavailable',
        message: 'Cloudflare config storage is unavailable.',
      },
    })
  })

  it('reports explicit degraded read-only mode only when it is explicitly declared', () => {
    const result = normalizeConfigStorageSelection(
      makeConfig({
        plugins: {
          'config.storage': { provider: 'cloudflare', options: { databaseId: 'cfg-db' } },
        },
      }),
      {
        explicitFailure: {
          code: 'config-storage-provider-degraded',
          message: 'Cloudflare config storage is read-only.',
          degraded: {
            effective: { provider: 'cloudflare', options: { databaseId: 'cfg-db' } },
            readOnly: true,
          },
        },
      }
    )

    expect(result).toEqual({
      configured: {
        provider: 'cloudflare',
        options: { databaseId: 'cfg-db' },
      },
      effective: {
        provider: 'cloudflare',
        options: { databaseId: 'cfg-db' },
      },
      mode: 'degraded',
      failure: {
        code: 'config-storage-provider-degraded',
        message: 'Cloudflare config storage is read-only.',
        degraded: {
          effective: { provider: 'cloudflare', options: { databaseId: 'cfg-db' } },
          readOnly: true,
        },
      },
    })
  })
})

describe('normalizeCardStateCapabilities', () => {
  it('defaults card.state to localfs provider when config is absent', () => {
    const result = normalizeCardStateCapabilities(makeConfig())
    expect(result['card.state']).toEqual({ provider: 'localfs' })
  })

  it('derives card.state from card.storage when storage is configured externally', () => {
    const result = normalizeCardStateCapabilities(
      makeConfig({
        storageEngine: 'sqlite',
        sqlitePath: '.kanban/custom.db',
      })
    )

    expect(result['card.state']).toEqual({
      provider: 'sqlite',
      options: { sqlitePath: '.kanban/custom.db' },
    })
  })

  it('passes through an explicit card.state provider with options', () => {
    const result = normalizeCardStateCapabilities(
      makeConfig({
        plugins: { 'card.state': { provider: 'my-card-state-plugin', options: { region: 'test' } } },
      })
    )
    expect(result['card.state']).toEqual({
      provider: 'my-card-state-plugin',
      options: { region: 'test' },
    })
  })

  it('card.state namespace is always present in output', () => {
    const result = normalizeCardStateCapabilities(makeConfig())
    expect(result).toHaveProperty('card.state')
  })

  it('does not mutate the input config', () => {
    const config = makeConfig({
      plugins: { 'card.state': { provider: 'my-card-state-plugin', options: { x: 1 } } },
    })
    const before = JSON.stringify(config)
    normalizeCardStateCapabilities(config)
    expect(JSON.stringify(config)).toBe(before)
  })

  it('accepts a plain object with only plugins field', () => {
    const result = normalizeCardStateCapabilities({})
    expect(result['card.state']).toEqual({ provider: 'localfs' })
  })
})

describe('collectActiveExternalPackageNames', () => {
  describe('webhook provider discovery', () => {
    it('includes kl-plugin-webhook by default when no webhook config is present', () => {
      const result = collectActiveExternalPackageNames({})
      expect(result).toContain('kl-plugin-webhook')
    })

    it('legacy webhookPlugin config activates kl-plugin-webhook via alias', () => {
      const result = collectActiveExternalPackageNames({
        webhookPlugin: { 'webhook.delivery': { provider: 'webhooks' } },
      })
      expect(result).toContain('kl-plugin-webhook')
    })

    it('plugins["webhook.delivery"] with alias "webhooks" resolves to kl-plugin-webhook', () => {
      const result = collectActiveExternalPackageNames({
        plugins: { 'webhook.delivery': { provider: 'webhooks' } },
      })
      expect(result).toContain('kl-plugin-webhook')
    })

    it('plugins["webhook.delivery"] takes precedence over webhookPlugin', () => {
      const result = collectActiveExternalPackageNames({
        plugins: { 'webhook.delivery': { provider: 'my-custom-delivery' } },
        webhookPlugin: { 'webhook.delivery': { provider: 'webhooks' } },
      })
      expect(result).toContain('my-custom-delivery')
      expect(result).not.toContain('kl-plugin-webhook')
    })

    it('custom webhook package name from webhookPlugin is passed through without alias', () => {
      const result = collectActiveExternalPackageNames({
        webhookPlugin: { 'webhook.delivery': { provider: 'my-webhook-delivery-pkg' } },
      })
      expect(result).toContain('my-webhook-delivery-pkg')
      expect(result).not.toContain('kl-plugin-webhook')
    })

    it('selected callback.runtime alias resolves to kl-plugin-callback', () => {
      const result = collectActiveExternalPackageNames({
        plugins: { 'callback.runtime': { provider: 'callbacks' } },
      })
      expect(result).toContain('kl-plugin-callback')
    })

    it('callback.runtime is not activated by default when unconfigured', () => {
      const result = collectActiveExternalPackageNames({})
      expect(result).not.toContain('kl-plugin-callback')
    })

    it('selected cloudflare storage alias resolves to kl-plugin-cloudflare', () => {
      const result = collectActiveExternalPackageNames({
        plugins: { 'card.storage': { provider: 'cloudflare' } },
      })
      expect(result).toContain('kl-plugin-cloudflare')
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
      expect(result).toContain('kl-plugin-auth')
    })

    it('plugins auth key takes precedence over legacy auth key', () => {
      const result = collectActiveExternalPackageNames({
        plugins: { 'auth.identity': { provider: 'noop' } },
        auth: { 'auth.identity': { provider: 'custom-auth' } },
      })
      expect(result).toContain('kl-plugin-auth')
      expect(result).not.toContain('custom-auth')
    })

    it('configured auth.visibility providers are included while the default disabled state is ignored', () => {
      expect(collectActiveExternalPackageNames({})).not.toContain('kl-plugin-auth-visibility')

      const result = collectActiveExternalPackageNames({
        plugins: { 'auth.visibility': { provider: 'kl-plugin-auth-visibility' } },
      })

      expect(result).toContain('kl-plugin-auth-visibility')
    })

    it('plugins auth.visibility key takes precedence over legacy auth visibility config', () => {
      const result = collectActiveExternalPackageNames({
        plugins: { 'auth.visibility': { provider: 'kl-plugin-auth-visibility' } },
        auth: { 'auth.visibility': { provider: 'legacy-auth-visibility' } },
      })

      expect(result).toContain('kl-plugin-auth-visibility')
      expect(result).not.toContain('legacy-auth-visibility')
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

    it('storage alias "sqlite" resolves to kl-plugin-storage-sqlite', () => {
      const result = collectActiveExternalPackageNames({
        plugins: { 'card.storage': { provider: 'sqlite' } },
      })
      expect(result).toContain('kl-plugin-storage-sqlite')
    })

    it('config.storage reuses storage package aliases when explicitly configured', () => {
      const result = collectActiveExternalPackageNames({
        plugins: { 'config.storage': { provider: 'sqlite' } },
      })
      expect(result).toContain('kl-plugin-storage-sqlite')
    })

    it('built-in "markdown" config.storage provider is excluded', () => {
      const result = collectActiveExternalPackageNames({
        plugins: { 'config.storage': { provider: 'markdown' } },
      })
      expect(result).not.toContain('markdown')
    })

    it('custom external card.state provider from plugins is included', () => {
      const result = collectActiveExternalPackageNames({
        plugins: { 'card.state': { provider: 'my-card-state-plugin' } },
      })
      expect(result).toContain('my-card-state-plugin')
    })

    it('built-in "builtin" card.state provider is excluded', () => {
      const result = collectActiveExternalPackageNames({
        plugins: { 'card.state': { provider: 'builtin' } },
      })
      expect(result).not.toContain('builtin')
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
      const authPkgCount = result.filter(p => p === 'kl-plugin-auth').length
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

describe('plugin settings contract helpers', () => {
  it('exposes the full plugin capability namespace set in a stable order', () => {
    expect(PLUGIN_CAPABILITY_NAMESPACES).toEqual([
      'card.storage',
      'attachment.storage',
      'config.storage',
      'card.state',
      'auth.identity',
      'auth.policy',
      'auth.visibility',
      'webhook.delivery',
      'callback.runtime',
    ])
  })

  it('declares one shared redaction policy for read, list, and error surfaces', () => {
    expect(DEFAULT_PLUGIN_SETTINGS_REDACTION).toEqual({
      maskedValue: '••••••',
      writeOnly: true,
      targets: ['read', 'list', 'error'],
    })
  })

  it('limits install requests to explicit workspace/global scope values', () => {
    expect(PLUGIN_SETTINGS_INSTALL_SCOPES).toEqual(['workspace', 'global'])
  })

  it('accepts exact kl-* install requests without rewriting the input', () => {
    expect(validatePluginSettingsInstallRequest({ packageName: 'kl-plugin-auth', scope: 'workspace' })).toEqual({
      packageName: 'kl-plugin-auth',
      scope: 'workspace',
    })
  })

  it.each([
    'kl-plugin-auth@latest',
    'npm install kl-plugin-auth',
    '../kl-plugin-auth',
    'https://example.com/kl-plugin-auth.tgz',
    'kl-plugin-auth --ignore-scripts',
    'kl-plugin-auth kl-plugin-webhook',
    ' kl-plugin-auth',
    'kl-plugin-auth ',
    'kl-plugin-auth\n--global',
    'kl-plugin-auth; rm -rf /',
    '@scope/kl-plugin-auth',
  ])('rejects non-exact package input %s at the validation boundary', (packageName) => {
    expect(() => validatePluginSettingsInstallRequest({ packageName, scope: 'workspace' })).toThrowError(PluginSettingsValidationError)

    try {
      validatePluginSettingsInstallRequest({ packageName, scope: 'workspace' })
    } catch (error) {
      expect(error).toBeInstanceOf(PluginSettingsValidationError)
      expect((error as PluginSettingsValidationError).code).toBe('invalid-plugin-install-package-name')
    }
  })

  it('rejects unsupported install scopes', () => {
    expect(() => validatePluginSettingsInstallRequest({ packageName: 'kl-plugin-auth', scope: 'user' })).toThrowError(PluginSettingsValidationError)

    try {
      validatePluginSettingsInstallRequest({ packageName: 'kl-plugin-auth', scope: 'user' })
    } catch (error) {
      expect(error).toBeInstanceOf(PluginSettingsValidationError)
      expect((error as PluginSettingsValidationError).code).toBe('invalid-plugin-install-scope')
    }
  })

  it('applies the shared redaction policy to surfaced plugin-settings errors', () => {
    expect(createPluginSettingsErrorPayload({
      code: 'plugin-settings-read-failed',
      message: 'Unable to read plugin settings.',
      details: { stderr: 'redacted output' },
    })).toEqual({
      code: 'plugin-settings-read-failed',
      message: 'Unable to read plugin settings.',
      details: { stderr: 'redacted output' },
      redaction: DEFAULT_PLUGIN_SETTINGS_REDACTION,
    })
  })
})
