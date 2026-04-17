import type { ZodRawShape, ZodTypeAny } from 'zod'
import type {
  ResolvedCapabilities,
  ResolvedAuthCapabilities,
  ResolvedWebhookCapabilities,
  ProviderRef,
} from '../../shared/config'
import type {
  SDKExtensionPlugin,
  SDKExtensionLoaderResult,
  SDKPluginEventDeclaration,
} from '../types'
import type { KanbanSDK } from '../KanbanSDK'
import type { AuthContext } from '../types'
import { loadExternalModule } from './plugin-loader'
import {
  BUILTIN_CARD_PLUGINS,
  BUILTIN_ATTACHMENT_IDS,
  PROVIDER_ALIASES,
} from './storage-plugins'
import {
  BUILTIN_CARD_STATE_PROVIDER_IDS,
  CARD_STATE_PROVIDER_ALIASES,
} from './card-state-plugins'
import { AUTH_PROVIDER_ALIASES, AUTH_POLICY_PROVIDER_ALIASES } from './auth-plugins'
import {
  CALLBACK_PROVIDER_ALIASES,
  WEBHOOK_PROVIDER_ALIASES,
} from './webhook-callback-plugins'
import type * as http from 'node:http'

// ---------------------------------------------------------------------------
// Standalone HTTP plugin contract
// ---------------------------------------------------------------------------

/**
 * Standalone HTTP request context exposed to plugin-provided middleware and routes.
 */
export interface StandaloneHttpRequestContext {
  readonly sdk: KanbanSDK
  readonly workspaceRoot: string
  readonly kanbanDir: string
  readonly req: http.IncomingMessage
  readonly res: http.ServerResponse
  readonly url: URL
  readonly pathname: string
  readonly method: string
  readonly resolvedWebviewDir: string
  readonly indexHtml: string
  readonly route: (expectedMethod: string, pattern: string) => Record<string, string> | null
  readonly isApiRequest: boolean
  readonly isPageRequest: boolean
  getAuthContext(): AuthContext
  setAuthContext(auth: AuthContext): AuthContext
  mergeAuthContext(auth: Partial<AuthContext>): AuthContext
}

/** Request middleware/route handlers return `true` when they fully handled the request. */
export type StandaloneHttpHandler = (request: StandaloneHttpRequestContext) => Promise<boolean>

/**
 * Registration options passed to standalone HTTP plugins after the SDK has
 * resolved the active workspace capability selections.
 */
export interface StandaloneHttpPluginRegistrationOptions {
  readonly sdk?: KanbanSDK
  readonly workspaceRoot: string
  readonly kanbanDir: string
  readonly capabilities: ResolvedCapabilities
  readonly authCapabilities: ResolvedAuthCapabilities
  readonly webhookCapabilities: ResolvedWebhookCapabilities | null
}

/**
 * Optional standalone-only integration exported by active plugin packages.
 */
export interface StandaloneHttpPlugin {
  readonly manifest: { readonly id: string; readonly provides: readonly ['standalone.http'] }
  registerMiddleware?(options: StandaloneHttpPluginRegistrationOptions): readonly StandaloneHttpHandler[]
  registerRoutes?(options: StandaloneHttpPluginRegistrationOptions): readonly StandaloneHttpHandler[]
}

// ---------------------------------------------------------------------------
// MCP plugin contract
// ---------------------------------------------------------------------------

/**
 * Runtime context available to MCP tool handlers contributed by plugins.
 */
export interface McpToolContext {
  readonly workspaceRoot: string
  readonly kanbanDir: string
  readonly sdk: KanbanSDK
  runWithAuth<T>(fn: () => Promise<T>): Promise<T>
  toErrorResult(err: unknown): McpToolResult
}

/** Canonical MCP tool result shape used by plugin-contributed tool handlers. */
export interface McpToolResult {
  readonly [key: string]: unknown
  readonly content: Array<{ type: 'text'; text: string }>
  readonly isError?: boolean
}

/** Minimal zod factory surface required by plugin-contributed MCP tool schemas. */
export interface McpSchemaFactory {
  string(): ZodTypeAny
  array(item: ZodTypeAny): ZodTypeAny
  boolean(): ZodTypeAny
}

/** A single MCP tool definition contributed by a plugin. */
export interface McpToolDefinition {
  readonly name: string
  readonly description: string
  readonly inputSchema: (z: McpSchemaFactory) => ZodRawShape
  readonly handler: (args: Record<string, unknown>, ctx: McpToolContext) => Promise<McpToolResult>
}

/**
 * Narrow MCP registration contract for plugin packages.
 */
export interface McpPluginRegistration {
  readonly manifest: { readonly id: string; readonly provides: readonly ['mcp.tools'] }
  registerTools(ctx: McpToolContext): readonly McpToolDefinition[]
}

// ---------------------------------------------------------------------------
// Private module shapes
// ---------------------------------------------------------------------------

interface StandaloneHttpPluginModule {
  readonly standaloneHttpPlugin?: unknown
  readonly createStandaloneHttpPlugin?: ((options: StandaloneHttpPluginRegistrationOptions) => unknown) | unknown
  readonly default?: unknown
}

interface SDKExtensionPluginModule {
  readonly sdkExtensionPlugin?: unknown
  readonly default?: unknown
}

interface McpPluginModule {
  readonly mcpPlugin?: unknown
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

function isValidStandaloneHttpPlugin(plugin: unknown): plugin is StandaloneHttpPlugin {
  if (!plugin || typeof plugin !== 'object') return false
  const candidate = plugin as StandaloneHttpPlugin
  return typeof candidate.manifest?.id === 'string'
    && Array.isArray(candidate.manifest?.provides)
    && candidate.manifest.provides.includes('standalone.http')
    && (candidate.registerMiddleware === undefined || typeof candidate.registerMiddleware === 'function')
    && (candidate.registerRoutes === undefined || typeof candidate.registerRoutes === 'function')
}

function isValidSDKPluginEventDeclaration(value: unknown): value is SDKPluginEventDeclaration {
  if (!value || typeof value !== 'object') return false
  const candidate = value as SDKPluginEventDeclaration
  return typeof candidate.event === 'string'
    && candidate.event.length > 0
    && (candidate.phase === 'before' || candidate.phase === 'after')
    && (candidate.resource === undefined || typeof candidate.resource === 'string')
    && (candidate.label === undefined || typeof candidate.label === 'string')
    && (candidate.apiAfter === undefined || typeof candidate.apiAfter === 'boolean')
}

function isValidSDKPluginEventDeclarations(value: unknown): value is readonly SDKPluginEventDeclaration[] {
  return Array.isArray(value) && value.every(isValidSDKPluginEventDeclaration)
}

function isValidSDKExtensionPlugin(plugin: unknown): plugin is SDKExtensionPlugin {
  if (!plugin || typeof plugin !== 'object') return false
  const candidate = plugin as SDKExtensionPlugin
  return typeof candidate.manifest?.id === 'string'
    && Array.isArray(candidate.manifest?.provides)
    && typeof candidate.extensions === 'object'
    && candidate.extensions !== null
    && (candidate.events === undefined || isValidSDKPluginEventDeclarations(candidate.events))
}

function isValidMcpPlugin(plugin: unknown): plugin is McpPluginRegistration {
  if (!plugin || typeof plugin !== 'object') return false
  const candidate = plugin as McpPluginRegistration
  return typeof candidate.manifest?.id === 'string'
    && Array.isArray(candidate.manifest?.provides)
    && candidate.manifest.provides.includes('mcp.tools')
    && typeof candidate.registerTools === 'function'
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

function tryLoadSDKExtensionPlugin(packageName: string): SDKExtensionLoaderResult | null {
  let mod: SDKExtensionPluginModule
  try {
    mod = loadExternalModule(packageName) as SDKExtensionPluginModule
  } catch {
    return null
  }
  const candidate = mod.sdkExtensionPlugin
  if (!isValidSDKExtensionPlugin(candidate)) return null
  return {
    id: candidate.manifest.id,
    events: candidate.events ?? [],
    extensions: candidate.extensions,
  }
}

export function tryLoadMcpPlugin(packageName: string): McpPluginRegistration | null {
  let mod: McpPluginModule
  try {
    mod = loadExternalModule(packageName) as McpPluginModule
  } catch (err) {
    if (err instanceof Error && err.message.includes(`Plugin package "${packageName}" is not installed.`)) {
      return null
    }
    throw err
  }

  if (mod.mcpPlugin === undefined) return null
  if (!isValidMcpPlugin(mod.mcpPlugin)) {
    throw new Error(
      `Plugin "${packageName}" does not export a valid mcpPlugin. ` +
      `Expected a named export 'mcpPlugin' with a manifest that provides 'mcp.tools' ` +
      `and a registerTools() method.`
    )
  }

  return mod.mcpPlugin
}

function loadStandaloneHttpPlugin(
  packageName: string,
  options: StandaloneHttpPluginRegistrationOptions,
): StandaloneHttpPlugin | null {
  let mod: StandaloneHttpPluginModule
  try {
    mod = loadExternalModule(packageName) as StandaloneHttpPluginModule
  } catch (err) {
    if (err instanceof Error && err.message.includes(`Plugin package "${packageName}" is not installed.`)) {
      return null
    }
    throw err
  }
  const direct = mod.standaloneHttpPlugin ?? mod.default
  if (isValidStandaloneHttpPlugin(direct)) return direct

  if (typeof mod.createStandaloneHttpPlugin === 'function') {
    const created = mod.createStandaloneHttpPlugin(options)
    if (isValidStandaloneHttpPlugin(created)) return created
    throw new Error(
      `Plugin "${packageName}" exported createStandaloneHttpPlugin() but it did not return ` +
      'a valid standalone HTTP plugin.'
    )
  }

  return null
}

// ---------------------------------------------------------------------------
// Package name collection helpers (shared between standalone HTTP and SDK extensions)
// ---------------------------------------------------------------------------

export function collectStandaloneHttpPackageNames(
  capabilities: ResolvedCapabilities,
  authCapabilities: ResolvedAuthCapabilities,
  webhookCapabilities: ResolvedWebhookCapabilities | null,
): string[] {
  const packageNames = new Set<string>()
  const add = (packageName: string | undefined): void => {
    if (packageName) packageNames.add(packageName)
  }

  const cardProvider = capabilities['card.storage'].provider
  if (!BUILTIN_CARD_PLUGINS.has(cardProvider)) {
    add(PROVIDER_ALIASES.get(cardProvider) ?? cardProvider)
  }

  const attachmentProvider = capabilities['attachment.storage'].provider
  if (!BUILTIN_ATTACHMENT_IDS.has(attachmentProvider)) {
    add(PROVIDER_ALIASES.get(attachmentProvider) ?? attachmentProvider)
  }

  add(AUTH_PROVIDER_ALIASES.get(authCapabilities['auth.identity'].provider) ?? authCapabilities['auth.identity'].provider)
  add(AUTH_POLICY_PROVIDER_ALIASES.get(authCapabilities['auth.policy'].provider) ?? authCapabilities['auth.policy'].provider)
  if (authCapabilities['auth.visibility'].provider !== 'none') {
    add(AUTH_PROVIDER_ALIASES.get(authCapabilities['auth.visibility'].provider) ?? authCapabilities['auth.visibility'].provider)
  }

  if (webhookCapabilities) {
    const webhookProvider = webhookCapabilities['webhook.delivery'].provider
    if (webhookProvider !== 'none') {
      add(WEBHOOK_PROVIDER_ALIASES.get(webhookProvider) ?? webhookProvider)
    }
  }

  return [...packageNames]
}

// ---------------------------------------------------------------------------
// Exported resolvers
// ---------------------------------------------------------------------------

export function resolveStandaloneHttpPlugins(
  options: StandaloneHttpPluginRegistrationOptions,
): StandaloneHttpPlugin[] {
  const resolved: StandaloneHttpPlugin[] = []
  for (const packageName of collectStandaloneHttpPackageNames(
    options.capabilities,
    options.authCapabilities,
    options.webhookCapabilities,
  )) {
    const plugin = loadStandaloneHttpPlugin(packageName, options)
    if (plugin) resolved.push(plugin)
  }
  return resolved
}

export function resolveSDKExtensions(
  capabilities: ResolvedCapabilities,
  authCapabilities: ResolvedAuthCapabilities,
  webhookCapabilities: ResolvedWebhookCapabilities | null,
): SDKExtensionLoaderResult[] {
  const resolved: SDKExtensionLoaderResult[] = []
  const seen = new Set<string>()
  for (const packageName of collectStandaloneHttpPackageNames(capabilities, authCapabilities, webhookCapabilities)) {
    const ext = tryLoadSDKExtensionPlugin(packageName)
    if (ext && !seen.has(ext.id)) {
      seen.add(ext.id)
      resolved.push(ext)
    }
  }
  return resolved
}

// ---------------------------------------------------------------------------
// Active external package collection and MCP resolver
// ---------------------------------------------------------------------------

/**
 * Collects the canonical set of external package names referenced by the
 * current workspace plugin configuration.
 */
export function collectActiveExternalPackageNames(config: {
  readonly plugins?: Partial<Record<string, ProviderRef>>
  readonly webhookPlugin?: Partial<Record<string, ProviderRef>>
  readonly auth?: Partial<Record<string, ProviderRef>>
}): string[] {
  const packageNames = new Set<string>()
  const add = (packageName: string | undefined): void => {
    if (packageName) packageNames.add(packageName)
  }

  const cardProvider = config.plugins?.['card.storage']?.provider === 'markdown'
    ? 'localfs'
    : config.plugins?.['card.storage']?.provider
  if (cardProvider && !BUILTIN_CARD_PLUGINS.has(cardProvider)) {
    add(PROVIDER_ALIASES.get(cardProvider) ?? cardProvider)
  }

  const attachmentProvider = config.plugins?.['attachment.storage']?.provider
  if (attachmentProvider && !BUILTIN_ATTACHMENT_IDS.has(attachmentProvider)) {
    add(PROVIDER_ALIASES.get(attachmentProvider) ?? attachmentProvider)
  }

  const configStorageProvider = config.plugins?.['config.storage']?.provider === 'markdown'
    ? 'localfs'
    : config.plugins?.['config.storage']?.provider
  if (configStorageProvider && configStorageProvider !== 'localfs') {
    add(PROVIDER_ALIASES.get(configStorageProvider) ?? configStorageProvider)
  }

  const cardStateProvider = config.plugins?.['card.state']?.provider === 'builtin'
    ? 'localfs'
    : config.plugins?.['card.state']?.provider
  if (cardStateProvider && !BUILTIN_CARD_STATE_PROVIDER_IDS.has(cardStateProvider)) {
    add(CARD_STATE_PROVIDER_ALIASES.get(cardStateProvider) ?? cardStateProvider)
  }

  const identityProvider = config.plugins?.['auth.identity']?.provider
    ?? config.auth?.['auth.identity']?.provider
  if (identityProvider) {
    add(AUTH_PROVIDER_ALIASES.get(identityProvider) ?? identityProvider)
  }

  const policyProvider = config.plugins?.['auth.policy']?.provider
    ?? config.auth?.['auth.policy']?.provider
  if (policyProvider) {
    add(AUTH_POLICY_PROVIDER_ALIASES.get(policyProvider) ?? policyProvider)
  }

  const visibilityProvider = config.plugins?.['auth.visibility']?.provider
    ?? config.auth?.['auth.visibility']?.provider
  if (visibilityProvider && visibilityProvider !== 'none') {
    add(AUTH_PROVIDER_ALIASES.get(visibilityProvider) ?? visibilityProvider)
  }

  const webhookProvider = config.plugins?.['webhook.delivery']?.provider
    ?? config.webhookPlugin?.['webhook.delivery']?.provider
    ?? 'webhooks'
  if (webhookProvider !== 'none') {
    add(WEBHOOK_PROVIDER_ALIASES.get(webhookProvider) ?? webhookProvider)
  }

  const callbackProvider = config.plugins?.['callback.runtime']?.provider ?? 'none'
  if (callbackProvider !== 'none') {
    add(CALLBACK_PROVIDER_ALIASES.get(callbackProvider) ?? callbackProvider)
  }

  return [...packageNames]
}

/**
 * Resolves optional MCP tool plugins from the canonical active-package set.
 */
export function resolveMcpPlugins(config: {
  readonly plugins?: Partial<Record<string, ProviderRef>>
  readonly webhookPlugin?: Partial<Record<string, ProviderRef>>
  readonly auth?: Partial<Record<string, ProviderRef>>
}): McpPluginRegistration[] {
  const resolved: McpPluginRegistration[] = []
  const seen = new Set<string>()

  for (const packageName of collectActiveExternalPackageNames(config)) {
    const plugin = tryLoadMcpPlugin(packageName)
    if (plugin && !seen.has(plugin.manifest.id)) {
      seen.add(plugin.manifest.id)
      resolved.push(plugin)
    }
  }

  return resolved
}
