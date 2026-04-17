import type { AuthPluginOptionsSchemaFactory } from './rbac-core'
import {
  createAuthPolicyPlugin,
  authPolicyPlugins,
  createAuthListenerPlugin,
  createNoopAuthListenerPlugin,
  createRbacAuthListenerPlugin,
  authListenerPluginFactories,
  createRbacIdentityPlugin,
  RBAC_POLICY_PLUGIN,
  ProviderBackedAuthListenerPlugin,
} from './rbac-plugins'
import {
  createResolvedRbacPluginPolicyOptionsSchema,
  createResolvedLocalAuthPolicyOptionsSchema,
  createResolvedRbacPolicyOptionsSchema,
} from './rbac-core'

export {
  createAuthPolicyPlugin,
  authPolicyPlugins,
  createAuthListenerPlugin,
  createNoopAuthListenerPlugin,
  createRbacAuthListenerPlugin,
  authListenerPluginFactories,
  createRbacIdentityPlugin,
  RBAC_POLICY_PLUGIN,
  ProviderBackedAuthListenerPlugin,
} from './rbac-plugins'

export type {
  AuthListenerOverrideContext,
  AuthListenerPluginOptions,
} from './rbac-plugins'

export {
  NOOP_POLICY_PLUGIN,
  LOCAL_POLICY_PLUGIN,
  checkPermissionMatrixPolicy,
  parsePermissionMatrixEntries,
  parseLegacyPermissionMatrix,
  resolvePermissionMatrixEntries,
  createResolvedLocalAuthPolicyOptionsSchema,
  createResolvedRbacPluginPolicyOptionsSchema,
  createResolvedRbacPolicyOptionsSchema,
} from './rbac-core'

export type {
  AuthPluginOptionsSchemaFactory,
  PermissionMatrixEntry,
} from './rbac-core'

export {
  RBAC_USER_ACTIONS,
  RBAC_MANAGER_ACTIONS,
  RBAC_ADMIN_ACTIONS,
  RBAC_ROLE_MATRIX,
  SDK_BEFORE_EVENT_NAMES,
} from './rbac-actions'

export type {
  AuthContext,
  AuthDecision,
  AuthErrorCategory,
  AuthIdentity,
  AuthIdentityPlugin,
  AuthPolicyPlugin,
  BeforeEventListenerResponse,
  BeforeEventPayload,
  RbacPrincipalEntry,
  RbacRole,
  SDKBeforeEventType,
  SDKEvent,
  SDKEventListener,
  SDKEventListenerPlugin,
} from 'kanban-lite/sdk'

/** Standard package manifest for engine discovery. */
export const pluginManifest = {
  id: 'kl-plugin-rbac',
  capabilities: {
    'auth.policy': ['local', 'rbac', 'kl-plugin-rbac'] as const,
  },
  integrations: ['event.listener'] as const,
} as const

/** Policy options schemas keyed by provider id for plugin-settings discovery. */
export const policyOptionsSchemas: Record<string, AuthPluginOptionsSchemaFactory> = {
  'kl-plugin-rbac': createResolvedRbacPluginPolicyOptionsSchema,
  local: createResolvedLocalAuthPolicyOptionsSchema,
  rbac: createResolvedRbacPolicyOptionsSchema,
}

const rbacPluginPackage = {
  pluginManifest,
  authPolicyPlugins,
  createAuthPolicyPlugin,
  createAuthListenerPlugin,
  createNoopAuthListenerPlugin,
  createRbacAuthListenerPlugin,
  authListenerPluginFactories,
  createRbacIdentityPlugin,
  policyOptionsSchemas,
}

export default rbacPluginPackage
