import type {
  AuthContext,
  AuthIdentity,
  AuthIdentityPlugin,
  RbacPrincipalEntry,
} from 'kanban-lite/sdk'
import {
  NOOP_IDENTITY_PLUGIN,
  cloneIdentity,
  createAuthIdentityOptionsSchema,
  getConfiguredApiToken,
  normalizeToken,
  safeTokenEquals,
} from './auth-core'
import {
  LOCAL_IDENTITY_PLUGIN,
} from './auth-http'

export function createRbacIdentityPlugin(
  principals: ReadonlyMap<string, RbacPrincipalEntry>,
): AuthIdentityPlugin {
  return {
    manifest: { id: 'rbac', provides: ['auth.identity'] },
    async resolveIdentity(context: AuthContext): Promise<AuthIdentity | null> {
      if (!context.token) return null
      const raw = context.token.startsWith('Bearer ') ? context.token.slice(7) : context.token
      const entry = principals.get(raw)
      if (!entry) return null
      return {
        subject: entry.subject,
        roles: [...entry.roles],
        ...(Array.isArray(entry.groups) ? { groups: [...entry.groups] } : {}),
      }
    },
  }
}

export const RBAC_IDENTITY_PLUGIN: AuthIdentityPlugin = {
  ...createRbacIdentityPlugin(new Map()),
  optionsSchema: createAuthIdentityOptionsSchema,
}

/**
 * Default auth identity plugin exported under the package name.
 * Allows `"provider": "kl-plugin-auth"` in `.kanban.json` `plugins` config,
 * using the same local-auth identity behaviour.
 */
const KL_AUTH_DEFAULT_IDENTITY_PLUGIN: AuthIdentityPlugin = {
  manifest: { id: 'kl-plugin-auth', provides: ['auth.identity'] },
  optionsSchema: createAuthIdentityOptionsSchema,
  resolveIdentity: LOCAL_IDENTITY_PLUGIN.resolveIdentity,
}

/**
 * Factory for a configurable identity plugin for the `kl-plugin-auth` provider.
 *
 * When `options.apiToken` is provided it is used as the API token for
 * token-based identity resolution, taking precedence over the
 * `KANBAN_LITE_TOKEN` / `KANBAN_TOKEN` environment variables.  This lets
 * operators pin a known token directly in `.kanban.json` without relying on
 * auto-generated environment values.
 *
 * When `options.apiToken` is absent the plugin falls back to the standard
 * env-var lookup, preserving existing behaviour.
 *
 * @example
 * ```json
 * "auth.identity": {
 *   "provider": "kl-plugin-auth",
 *   "options": { "apiToken": "my-secret-token" }
 * }
 * ```
 */
export function createAuthIdentityPlugin(options?: Record<string, unknown>, providerId = 'kl-plugin-auth'): AuthIdentityPlugin {
  const explicitToken =
    typeof options?.apiToken === 'string' && options.apiToken.length > 0
      ? options.apiToken
      : null

  return {
    manifest: { id: providerId, provides: ['auth.identity'] },
    optionsSchema: createAuthIdentityOptionsSchema,
    async resolveIdentity(context: AuthContext): Promise<AuthIdentity | null> {
      if (context.identity) return cloneIdentity(context.identity)

      const token = normalizeToken(context.token)
      const configuredToken = explicitToken ?? getConfiguredApiToken()
      if (token && configuredToken && safeTokenEquals(token, configuredToken)) {
        return { subject: context.actorHint ?? 'api-token' }
      }

      if (context.actorHint) {
        return { subject: context.actorHint }
      }

      return null
    },
  }
}

export const authIdentityPlugins: Record<string, AuthIdentityPlugin> = {
  local: LOCAL_IDENTITY_PLUGIN,
  noop: NOOP_IDENTITY_PLUGIN,
  rbac: RBAC_IDENTITY_PLUGIN,
  'kl-plugin-auth': KL_AUTH_DEFAULT_IDENTITY_PLUGIN,
}
