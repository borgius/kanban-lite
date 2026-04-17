import type {
  AuthIdentityPlugin,
  AuthPolicyPlugin,
  AuthContext,
  AuthDecision,
  AuthIdentity,
  KanbanSDK,
  PluginSettingsOptionsSchemaMetadata,
} from 'kanban-lite/sdk'
import {
  createOpenAuthIdentityPlugin,
  createOpenAuthIdentityOptionsSchema,
  OPENAUTH_IDENTITY_PLUGIN,
} from './openauth-identity'
import { createStandaloneHttpPlugin } from './openauth-http'
import { createEmbeddedIssuer } from './openauth-issuer'
import { cliPlugin } from './openauth-cli'

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { subjects } from './openauth-subjects'
export type { Subjects } from './openauth-subjects'
export { createOpenAuthIdentityPlugin, OPENAUTH_IDENTITY_PLUGIN } from './openauth-identity'
export { createStandaloneHttpPlugin } from './openauth-http'
export { createEmbeddedIssuer, hashPassword, isHashedPassword } from './openauth-issuer'
export type { OpenAuthIdentityOptions } from './openauth-identity'
export type { OpenAuthHttpOptions } from './openauth-http'
export type { EmbeddedIssuerOptions, EmbeddedIssuerUser, ScryptHasherResult } from './openauth-issuer'
export { cliPlugin } from './openauth-cli'

// ---------------------------------------------------------------------------
// Keyed plugin collections — SDK loadExternalModule() probes these
// ---------------------------------------------------------------------------

export const authIdentityPlugins: Record<string, AuthIdentityPlugin> = {
  openauth: OPENAUTH_IDENTITY_PLUGIN,
}

export const OPENAUTH_POLICY_PLUGIN: AuthPolicyPlugin = {
  manifest: { id: 'openauth', provides: ['auth.policy'] },
  async checkPolicy(identity: AuthIdentity | null, _action: string, _context: AuthContext): Promise<AuthDecision> {
    return identity ? { allowed: true } : { allowed: false, reason: 'auth.identity.missing' }
  },
}

export const authPolicyPlugins: Record<string, AuthPolicyPlugin> = {
  openauth: OPENAUTH_POLICY_PLUGIN,
}

// ---------------------------------------------------------------------------
// Factory functions — SDK also probes these
// ---------------------------------------------------------------------------

export function createAuthIdentityPlugin(
  options?: Record<string, unknown>,
  providerId?: string,
): AuthIdentityPlugin {
  return createOpenAuthIdentityPlugin(options)
}

// ---------------------------------------------------------------------------
// Options schemas
// ---------------------------------------------------------------------------

export function optionsSchemas(
  sdk?: KanbanSDK,
): Record<string, PluginSettingsOptionsSchemaMetadata> {
  return {
    'auth.identity': createOpenAuthIdentityOptionsSchema(sdk),
  }
}

// ---------------------------------------------------------------------------
// Standalone HTTP plugin
// ---------------------------------------------------------------------------

export { createStandaloneHttpPlugin as createStandalonePlugin }

// ---------------------------------------------------------------------------
// Plugin manifest
// ---------------------------------------------------------------------------

export const pluginManifest = {
  id: 'kl-plugin-openauth',
  capabilities: {
    'auth.identity': ['openauth'] as const,
  },
  integrations: ['standalone.http', 'cli'] as const,
} as const

// ---------------------------------------------------------------------------
// Default export — full plugin package
// ---------------------------------------------------------------------------

const openAuthPluginPackage = {
  pluginManifest,
  authIdentityPlugins,
  authPolicyPlugins,
  createAuthIdentityPlugin,
  createStandaloneHttpPlugin,
  createStandalonePlugin: createStandaloneHttpPlugin,
  createEmbeddedIssuer,
  cliPlugin,
  optionsSchemas,
}

export default openAuthPluginPackage
