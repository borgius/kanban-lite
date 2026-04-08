import * as fs from 'node:fs'
import * as path from 'node:path'
import { hash } from 'bcryptjs'
import type {
  KanbanSDK,
  KanbanCliPlugin,
  CliPluginContext,
  PluginSettingsOptionsSchemaMetadata,
  PluginSettingsRedactionPolicy,
  StandaloneHttpPluginRegistrationOptions,
} from 'kanban-lite/sdk'
import {
  AUTH_PLUGIN_SECRET_REDACTION,
  NOOP_IDENTITY_PLUGIN,
  NOOP_POLICY_PLUGIN,
  RBAC_USER_ACTIONS,
  RBAC_MANAGER_ACTIONS,
  RBAC_ADMIN_ACTIONS,
  RBAC_ROLE_MATRIX,
  createAuthIdentityOptionsSchema,
  createResolvedKlauthPolicyOptionsSchema,
  createResolvedLocalAuthPolicyOptionsSchema,
  createResolvedRbacPolicyOptionsSchema,
  getAuthProviderSelection,
  cloneWritableConfig,
  getWritableUsers,
  getWritableRoles,
  normalizeOptionalRole,
  type AuthPluginOptionsSchemaFactory,
  type AuthListenerOverrideContext,
  type AuthListenerPluginOptions,
} from './auth-core'
import { createStandaloneHttpPlugin } from './auth-http'
import {
  createAuthIdentityPlugin,
  createAuthPolicyPlugin,
  authIdentityPlugins,
  authPolicyPlugins,
  createAuthListenerPlugin,
  createNoopAuthListenerPlugin,
  createRbacAuthListenerPlugin,
  createLocalAuthListenerPlugin,
  authListenerPluginFactories,
  createRbacIdentityPlugin,
  RBAC_IDENTITY_PLUGIN,
  RBAC_POLICY_PLUGIN,
  ProviderBackedAuthListenerPlugin,
} from './auth-plugins'
export { createStandaloneHttpPlugin, LOCAL_IDENTITY_PLUGIN, LOCAL_POLICY_PLUGIN } from './auth-http'
export {
  createAuthIdentityPlugin,
  createAuthPolicyPlugin,
  authIdentityPlugins,
  authPolicyPlugins,
  createAuthListenerPlugin,
  createNoopAuthListenerPlugin,
  createRbacAuthListenerPlugin,
  createLocalAuthListenerPlugin,
  authListenerPluginFactories,
  createRbacIdentityPlugin,
  RBAC_IDENTITY_PLUGIN,
  RBAC_POLICY_PLUGIN,
  ProviderBackedAuthListenerPlugin,
} from './auth-plugins'
export { RBAC_USER_ACTIONS, RBAC_MANAGER_ACTIONS, RBAC_ADMIN_ACTIONS, RBAC_ROLE_MATRIX, SDK_BEFORE_EVENT_NAMES } from './auth-rbac'

export type {
  AuthContext,
  AuthDecision,
  AuthErrorCategory,
  AuthIdentity,
  AuthIdentityPlugin,
  AuthPluginManifest,
  AuthPolicyPlugin,
  BeforeEventListenerResponse,
  BeforeEventPayload,
  CliPluginContext,
  KanbanCliPlugin,
  PluginSettingsOptionsSchemaMetadata,
  ProviderRef,
  RbacPrincipalEntry,
  RbacRole,
  SDKBeforeEventType,
  SDKEvent,
  SDKEventListener,
  SDKEventListenerPlugin,
  StandaloneHttpPlugin,
  StandaloneHttpPluginRegistrationOptions,
} from 'kanban-lite/sdk'

export const cliPlugin: KanbanCliPlugin = {
  manifest: { id: 'kl-plugin-auth' },
  command: 'auth',
  async run(
    subArgs: string[],
    flags: Record<string, string | boolean | string[]>,
    context: CliPluginContext,
  ): Promise<void> {
    const sub = subArgs[0]

    if (sub === 'create-user') {
      const username = flags.username as string | undefined
      const password = flags.password as string | undefined
      const role = normalizeOptionalRole(flags.role)
      if (!username || !password) {
        console.error('Usage: kl auth create-user --username <name> --password <pass> [--role <role>]')
        process.exit(1)
      }

      const cfgPath = path.join(context.workspaceRoot, '.kanban.json')
      const cfg = await cloneWritableConfig(context)

      const plugins =
        typeof cfg.plugins === 'object' && cfg.plugins !== null
          ? (cfg.plugins as Record<string, unknown>)
          : {}
      const existingIdentity = getAuthProviderSelection(cfg, 'auth.identity')
      const identity =
        typeof plugins['auth.identity'] === 'object' && plugins['auth.identity'] !== null
          ? (plugins['auth.identity'] as Record<string, unknown>)
          : { provider: existingIdentity?.provider ?? 'kl-plugin-auth' }
      const options =
        typeof identity.options === 'object' && identity.options !== null
          ? (identity.options as Record<string, unknown>)
          : existingIdentity?.options
            ? structuredClone(existingIdentity.options)
            : {}
      const roles = getWritableRoles(existingIdentity)
      const users = Array.isArray(options.users)
        ? (options.users as { username: string; password: string; role?: string }[])
        : getWritableUsers(existingIdentity)

      if (users.some(u => u.username === username)) {
        console.error(`User "${username}" already exists.`)
        process.exit(1)
      }

      const hashed = await hash(password, 12)
      const newUser: { username: string; password: string; role?: string } = { username, password: hashed }
      if (role) newUser.role = role
      users.push(newUser)
      if (role && !roles.includes(role)) {
        roles.push(role)
      }
      if (roles.length > 0) {
        options.roles = roles
      }
      options.users = users
      identity.options = options
      plugins['auth.identity'] = identity
      cfg.plugins = plugins

      await fs.promises.writeFile(cfgPath, JSON.stringify(cfg, null, 2) + '\n', 'utf-8')
      console.log(`User "${username}" added.`)
      return
    }

    console.error(`Unknown auth sub-command: ${sub ?? '(none)'}`)
    console.error('Available sub-commands: create-user')
    process.exit(1)
  },
}

/** Standard package manifest for engine discovery. */
export const pluginManifest = {
  id: 'kl-plugin-auth',
  capabilities: {
    'auth.identity': ['local', 'rbac', 'kl-plugin-auth'] as const,
    'auth.policy': ['local', 'rbac', 'kl-plugin-auth'] as const,
  },
  integrations: ['standalone.http', 'cli', 'event.listener'] as const,
} as const

/** Options schemas keyed by provider id for plugin-settings discovery. */
export const optionsSchemas: Record<string, AuthPluginOptionsSchemaFactory> = {
  'kl-plugin-auth': createAuthIdentityOptionsSchema,
  local: createAuthIdentityOptionsSchema,
  rbac: createAuthIdentityOptionsSchema,
}

/** Policy options schemas keyed by provider id for plugin-settings discovery. */
export const policyOptionsSchemas: Record<string, AuthPluginOptionsSchemaFactory> = {
  'kl-plugin-auth': createResolvedKlauthPolicyOptionsSchema,
  local: createResolvedLocalAuthPolicyOptionsSchema,
  rbac: createResolvedRbacPolicyOptionsSchema,
}

const authPluginPackage = {
  pluginManifest,
  authIdentityPlugins,
  authPolicyPlugins,
  createAuthIdentityPlugin,
  createAuthPolicyPlugin,
  createStandaloneHttpPlugin,
  createAuthListenerPlugin,
  createLocalAuthListenerPlugin,
  createNoopAuthListenerPlugin,
  createRbacAuthListenerPlugin,
  authListenerPluginFactories,
  optionsSchemas,
  policyOptionsSchemas,
}

export default authPluginPackage
