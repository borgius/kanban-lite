export {
  PluginSettingsStoreError,
  resolvePluginSettingsOptionsSchema,
} from './plugin-settings'
export type {
  PluginSettingsOptionsSchemaFactory,
  PluginSettingsOptionsSchemaInput,
  PluginSettingsOptionsSchemaValueResolver,
} from './plugin-settings'

export {
  WORKSPACE_ROOT,
  loadExternalModule,
  resolveCallbackRuntimeModule,
} from './plugin-loader'

export {
  AUTH_PROVIDER_ALIASES,
  AUTH_POLICY_PROVIDER_ALIASES,
  createRbacIdentityPlugin,
  NOOP_IDENTITY_PLUGIN,
  NOOP_POLICY_PLUGIN,
  RBAC_ADMIN_ACTIONS,
  RBAC_IDENTITY_PLUGIN,
  RBAC_MANAGER_ACTIONS,
  RBAC_POLICY_PLUGIN,
  RBAC_ROLE_MATRIX,
  RBAC_USER_ACTIONS,
} from './auth-plugins'
export type {
  AuthIdentity,
  AuthIdentityPlugin,
  AuthPluginManifest,
  AuthPolicyPlugin,
  AuthVisibilityFilterInput,
  AuthVisibilityPlugin,
  RbacPrincipalEntry,
  RbacRole,
} from './auth-plugins'

export {
  CARD_STATE_PROVIDER_ALIASES,
} from './card-state-plugins'
export type {
  CardStateCursor,
  CardStateKey,
  CardStateModuleContext,
  CardStateProvider,
  CardStateProviderManifest,
  CardStateReadThroughInput,
  CardStateRecord,
  CardStateUnreadKey,
  CardStateValue,
  CardStateWriteInput,
} from './card-state-plugins'

export {
  resolveConfigStorageProviderForRepository,
} from './config-storage-plugins'
export type {
  ConfigStorageModuleContext,
  ConfigStorageProviderManifest,
  ConfigStorageProviderPlugin,
} from './config-storage-plugins'

export {
  BUILTIN_ATTACHMENT_IDS,
  PROVIDER_ALIASES,
} from './storage-plugins'
export type {
  AttachmentStoragePlugin,
  CardStoragePlugin,
  PluginManifest,
} from './storage-plugins'

export {
  CALLBACK_PROVIDER_ALIASES,
  WEBHOOK_PROVIDER_ALIASES,
} from './webhook-callback-plugins'
export type {
  CallbackRuntimeListenerContext,
  WebhookProviderPlugin,
} from './webhook-callback-plugins'

export {
  createBuiltinAuthListenerPlugin,
} from './auth-listener'

export {
  collectActiveExternalPackageNames,
  resolveMcpPlugins,
} from './mcp-sdk-plugins'
export type {
  McpPluginRegistration,
  McpSchemaFactory,
  McpToolContext,
  McpToolDefinition,
  McpToolResult,
  StandaloneHttpHandler,
  StandaloneHttpPlugin,
  StandaloneHttpPluginRegistrationOptions,
  StandaloneHttpRequestContext,
} from './mcp-sdk-plugins'

export {
  canUseDefaultCardStateActor,
  resolveCapabilityBag,
} from './capability-bag'
export type {
  ResolvedCapabilityBag,
} from './capability-bag'

export {
  discoverPluginSettingsInventory,
  persistPluginSettingsProviderOptions,
  persistPluginSettingsProviderSelection,
  readPluginSettingsProvider,
} from './plugin-discovery'
