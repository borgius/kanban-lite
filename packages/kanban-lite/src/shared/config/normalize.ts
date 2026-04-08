import type { KanbanConfig, ProviderRef, ConfigStorageCapabilityResolution, ConfigStorageFailure,
  ResolvedCapabilities, ResolvedCardStateCapabilities, ResolvedAuthCapabilities,
  ResolvedWebhookCapabilities, ResolvedCallbackCapabilities,
} from './types'

function cloneProviderRef(ref: ProviderRef): ProviderRef {
  return ref.options !== undefined
    ? { provider: ref.provider, options: { ...ref.options } }
    : { provider: ref.provider }
}

const FIRST_PARTY_CONFIG_STORAGE_DERIVATION_PROVIDER_IDS = new Set([
  'sqlite',
  'mysql',
  'postgresql',
  'mongodb',
  'redis',
  'cloudflare',
])

function cloneConfigStorageFailure(failure: ConfigStorageFailure): ConfigStorageFailure {
  return failure.degraded
    ? {
        code: failure.code,
        message: failure.message,
        degraded: {
          effective: cloneProviderRef(failure.degraded.effective),
          readOnly: failure.degraded.readOnly,
        },
      }
    : {
        code: failure.code,
        message: failure.message,
      }
}

function normalizeConfigStorageProviderRef(ref: ProviderRef): ProviderRef {
  return ref.provider === 'markdown'
    ? {
        provider: 'localfs',
        ...(ref.options !== undefined ? { options: { ...ref.options } } : {}),
      }
    : cloneProviderRef(ref)
}

/**
 * Normalizes configured-versus-effective `config.storage` selection.
 *
 * Resolution order:
 * 1. Explicit `plugins['config.storage']` override (authoritative)
 * 2. Derived first-party storage provider from `card.storage`
 * 3. Local-file fallback (`localfs`)
 *
 * When an explicit override is present and fails, the caller must surface that
 * failure explicitly instead of silently deriving a replacement provider. A
 * degraded/read-only effective provider is only allowed when it is passed in
 * explicitly via `explicitFailure.degraded`.
 *
 * The input object is never mutated.
 */
export function normalizeConfigStorageSelection(
  config: Pick<KanbanConfig, 'storageEngine' | 'sqlitePath' | 'plugins'>,
  options: { explicitFailure?: ConfigStorageFailure | null } = {},
): ConfigStorageCapabilityResolution {
  const configured = config.plugins?.['config.storage']
    ? normalizeConfigStorageProviderRef(config.plugins['config.storage'])
    : null

  if (configured) {
    const failure = options.explicitFailure ? cloneConfigStorageFailure(options.explicitFailure) : null
    if (failure?.degraded) {
      return {
        configured,
        effective: cloneProviderRef(failure.degraded.effective),
        mode: 'degraded',
        failure,
      }
    }

    return {
      configured,
      effective: failure ? null : cloneProviderRef(configured),
      mode: failure ? 'error' : 'explicit',
      failure,
    }
  }

  const derived = normalizeStorageCapabilities(config)['card.storage']
  const effective = FIRST_PARTY_CONFIG_STORAGE_DERIVATION_PROVIDER_IDS.has(derived.provider)
    ? cloneProviderRef(derived)
    : { provider: 'localfs' }

  return {
    configured: null,
    effective,
    mode: FIRST_PARTY_CONFIG_STORAGE_DERIVATION_PROVIDER_IDS.has(derived.provider) ? 'derived' : 'fallback',
    failure: null,
  }
}

/**
 * Normalizes auth capability selections into a complete runtime capability map.
 *
 * Omitted auth providers default to the `noop` compatibility ids. When the
 * external `kl-plugin-auth` package is installed those ids resolve there;
 * otherwise core keeps a built-in compatibility fallback so behavior is
 * unchanged when auth is not configured.
 *
 * The input object is never mutated.
 */
export function normalizeAuthCapabilities(
  config: Pick<KanbanConfig, 'auth' | 'plugins'>,
): ResolvedAuthCapabilities {
  return {
    'auth.identity': config.plugins?.['auth.identity']
      ? cloneProviderRef(config.plugins['auth.identity'])
      : config.auth?.['auth.identity']
        ? cloneProviderRef(config.auth['auth.identity'])
        : { provider: 'noop' },
    'auth.policy': config.plugins?.['auth.policy']
      ? cloneProviderRef(config.plugins['auth.policy'])
      : config.auth?.['auth.policy']
        ? cloneProviderRef(config.auth['auth.policy'])
        : { provider: 'noop' },
    'auth.visibility': config.plugins?.['auth.visibility']
      ? cloneProviderRef(config.plugins['auth.visibility'])
      : config.auth?.['auth.visibility']
        ? cloneProviderRef(config.auth['auth.visibility'])
        : { provider: 'none' },
  }
}

/**
 * Normalizes card-state capability selections into a complete runtime capability map.
 *
 * `card.state` is first-class and defaults to the built-in `localfs` provider
 * when omitted from `.kanban.json`.
 *
 * The input object is never mutated.
 */
export function normalizeCardStateCapabilities(
  config: Pick<KanbanConfig, 'storageEngine' | 'sqlitePath' | 'plugins'>,
): ResolvedCardStateCapabilities {
  const configured = config.plugins?.['card.state']
  if (configured) {
    return {
      'card.state': configured.provider === 'builtin'
        ? {
            provider: 'localfs',
            ...(configured.options !== undefined ? { options: { ...configured.options } } : {}),
          }
        : cloneProviderRef(configured),
    }
  }

  const derivedFromStorage = normalizeStorageCapabilities(config)['card.storage']

  return {
    'card.state': cloneProviderRef(derivedFromStorage),
  }
}

/**
 * Normalizes legacy storage settings plus capability-based plugin selections
 * into a complete runtime capability map.
 *
 * Precedence:
 * 1. Explicit `plugins[namespace]`
 * 2. Legacy `storageEngine` / `sqlitePath` for `card.storage`
 * 3. Backward-compatible defaults (`localfs` + derived attachment provider)
 *
 * `attachment.storage` follows the active `card.storage` provider by default,
 * reusing the same provider id and options for first-party storage plugins.
 * Configure `attachment.storage` explicitly only when you want a different
 * provider (for example an attachment-only plugin such as S3).
 *
 * The input object is never mutated.
 */
export function normalizeStorageCapabilities(
  config: Pick<KanbanConfig, 'storageEngine' | 'sqlitePath' | 'plugins'>,
): ResolvedCapabilities {
  const legacyCardProvider: ProviderRef = config.storageEngine === 'sqlite'
    ? {
        provider: 'sqlite',
        options: { sqlitePath: config.sqlitePath ?? '.kanban/kanban.db' },
      }
    : { provider: 'localfs' }

  const configuredCardStorage = config.plugins?.['card.storage']
    ? cloneProviderRef(config.plugins['card.storage'])
    : null

  const normalizedCardStorage = configuredCardStorage
    ? {
        provider: configuredCardStorage.provider === 'markdown'
          ? 'localfs'
          : configuredCardStorage.provider,
        ...(configuredCardStorage.options !== undefined ? { options: { ...configuredCardStorage.options } } : {}),
      }
    : legacyCardProvider

  const configuredAttachmentStorage = config.plugins?.['attachment.storage']
    ? cloneProviderRef(config.plugins['attachment.storage'])
    : null

  const shouldReuseCardStorageForAttachments = configuredAttachmentStorage === null
    || configuredAttachmentStorage.provider === normalizedCardStorage.provider
    || (configuredAttachmentStorage.provider === 'localfs' && normalizedCardStorage.provider !== 'localfs')

  const normalizedAttachmentStorage = shouldReuseCardStorageForAttachments
    ? cloneProviderRef(normalizedCardStorage)
    : configuredAttachmentStorage

  return {
    'card.storage': normalizedCardStorage,
    'attachment.storage': normalizedAttachmentStorage,
  }
}

/**
 * Normalizes webhook capability selections into a complete runtime capability map.
 *
 * When no explicit provider is configured, defaults to `{ provider: 'webhooks' }`, which
 * maps to the `kl-plugin-webhook` external package via `WEBHOOK_PROVIDER_ALIASES`.
 * Core no longer provides a built-in webhook delivery fallback; hosts must install
 * that package anywhere webhook CRUD or runtime delivery is expected to work.
 *
 * The input object is never mutated.
 */
export function normalizeWebhookCapabilities(
  config: Pick<KanbanConfig, 'webhookPlugin' | 'plugins'>,
): ResolvedWebhookCapabilities {
  const pluginSelection = config.plugins?.['webhook.delivery']

  if (pluginSelection?.provider === 'none') {
    return {
      'webhook.delivery': { provider: 'none' },
    }
  }

  return {
    'webhook.delivery': pluginSelection
      ? cloneProviderRef(pluginSelection)
      : config.webhookPlugin?.['webhook.delivery']
        ? cloneProviderRef(config.webhookPlugin['webhook.delivery'])
        : { provider: 'webhooks' },
  }
}

/**
 * Normalizes callback runtime capability selections into a complete runtime capability map.
 *
 * `callback.runtime` is first-class but disabled by default until a provider is
 * explicitly selected through the shared plugin settings flow.
 *
 * The input object is never mutated.
 */
export function normalizeCallbackCapabilities(
  config: Pick<KanbanConfig, 'plugins'>,
): ResolvedCallbackCapabilities {
  return {
    'callback.runtime': config.plugins?.['callback.runtime']
      ? cloneProviderRef(config.plugins['callback.runtime'])
      : { provider: 'none' },
  }
}

