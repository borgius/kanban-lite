import * as childProcess from 'node:child_process'
import * as path from 'path'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { Comment, Card, KanbanColumn, BoardInfo, LabelDefinition, CardSortOption, LogEntry } from '../shared/types'
import type {
  CardDisplaySettings,
  PluginSettingsErrorPayload,
  PluginSettingsInstallRequest,
  PluginSettingsPayload,
  PluginSettingsProviderRow,
  PluginSettingsReadPayload,
  PluginSettingsInstallScope,
  PluginSettingsRedactionPolicy,
  PluginSettingsRedactionTarget,
  Priority,
} from '../shared/types'
import { DELETED_STATUS_ID } from '../shared/types'
import { readConfig, normalizeStorageCapabilities, normalizeAuthCapabilities, normalizeWebhookCapabilities, normalizeCardStateCapabilities, normalizeCallbackCapabilities } from '../shared/config'
import type { BoardConfig, KanbanConfig, PluginCapabilityNamespace, ProviderRef, ResolvedCapabilities, ResolvedWebhookCapabilities, ResolvedCardStateCapabilities, ResolvedCallbackCapabilities, Webhook } from '../shared/config'
import type { ResolvedAuthCapabilities } from '../shared/config'
import type { CreateCardInput, SDKEvent, SDKEventHandler, SDKEventType, SDKOptions, SubmitFormInput, SubmitFormResult, AuthContext, AuthDecision, SDKEventListenerPlugin, BeforeEventPayload, AfterEventPayload, SDKBeforeEventType, SDKAfterEventType, CardStateStatus, CardOpenStateValue, CardUnreadSummary, SDKAvailableEventDescriptor, SDKAvailableEventsOptions } from './types'
import type { EventBusAnyListener, EventBusWaitOptions } from './eventBus'
import { EventBus } from './eventBus'
import { AuthError, CardStateError, sanitizeCard, CARD_STATE_DEFAULT_ACTOR_MODE, CARD_STATE_OPEN_DOMAIN, CARD_STATE_UNREAD_DOMAIN, DEFAULT_CARD_STATE_ACTOR, ERR_CARD_STATE_IDENTITY_UNAVAILABLE, ERR_CARD_STATE_UNAVAILABLE } from './types'
import type { StorageEngine } from './plugins/types'
import { resolveKanbanDir } from './fileUtils'
import {
  canUseDefaultCardStateActor,
  createBuiltinAuthListenerPlugin,
  discoverPluginSettingsInventory,
  persistPluginSettingsProviderOptions,
  persistPluginSettingsProviderSelection,
  PluginSettingsStoreError,
  readPluginSettingsProvider,
  resolveCapabilityBag,
} from './plugins'
import type { CardStateCursor, CardStateRecord, ResolvedCapabilityBag } from './plugins'
import { loadWorkspaceEnv } from '../shared/env'
import { KANBAN_EVENT_CATALOG } from './integrationCatalog'
import * as Boards from './modules/boards'
import * as Cards from './modules/cards'
import * as Labels from './modules/labels'
import * as Attachments from './modules/attachments'
import * as Comments from './modules/comments'
import * as Logs from './modules/logs'
import * as Columns from './modules/columns'
import * as Settings from './modules/settings'
import * as Migration from './modules/migration'

type CallbackRuntimeContextAwareListener = SDKEventListenerPlugin & {
  attachRuntimeContext?: (context: {
    workspaceRoot: string
    sdk: KanbanSDK
  }) => void
}

function normalizeAvailableEventType(type: SDKAvailableEventsOptions['type']): 'before' | 'after' | 'all' {
  if (type === undefined) return 'all'
  if (type === 'before' || type === 'after' || type === 'all') return type
  throw new Error(`Invalid event type filter: ${String(type)}. Expected "before", "after", or "all".`)
}

function matchesEventMask(event: string, mask?: string): boolean {
  if (!mask) return true
  const normalizedMask = mask.trim()
  if (!normalizedMask) return true

  const eventSegments = event.split('.')
  const maskSegments = normalizedMask.split('.')

  const match = (eventIndex: number, maskIndex: number): boolean => {
    if (maskIndex === maskSegments.length) return eventIndex === eventSegments.length

    const token = maskSegments[maskIndex]
    if (token === '**') {
      if (maskIndex === maskSegments.length - 1) return true
      for (let nextEventIndex = eventIndex; nextEventIndex <= eventSegments.length; nextEventIndex += 1) {
        if (match(nextEventIndex, maskIndex + 1)) return true
      }
      return false
    }

    if (eventIndex >= eventSegments.length) return false
    if (token !== '*' && token !== eventSegments[eventIndex]) return false
    return match(eventIndex + 1, maskIndex + 1)
  }

  return match(0, 0)
}

function compareAvailableEvents(left: SDKAvailableEventDescriptor, right: SDKAvailableEventDescriptor): number {
  if (left.phase !== right.phase) return left.phase === 'before' ? -1 : 1
  const eventCompare = left.event.localeCompare(right.event)
  if (eventCompare !== 0) return eventCompare
  if (left.source !== right.source) return left.source === 'core' ? -1 : 1
  return (left.pluginIds?.[0] ?? '').localeCompare(right.pluginIds?.[0] ?? '')
}

/**
 * Returns `true` when `value` is a plain-object merge candidate.
 *
 * Accepts `{}` literals and `Object.create(null)` objects. Rejects arrays,
 * class instances, primitives, and `null`. Used by `KanbanSDK._deepMerge`.
 *
 * @internal
 */
function _isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function isUnreadActivityMetadata(value: unknown): value is {
  type: string
  qualifiesForUnread: true
} {
  if (!_isPlainObject(value)) return false
  return typeof value.type === 'string'
    && value.qualifiesForUnread === true
}

function getUnreadActivityCursor(entry: LogEntry, index: number): CardStateCursor | null {
  const activity = entry.object?.activity
  if (!isUnreadActivityMetadata(activity)) return null
  return {
    cursor: `${entry.timestamp}:${index}`,
    updatedAt: entry.timestamp,
  }
}

function cursorsMatch(left: CardStateCursor | null, right: CardStateCursor | null): boolean {
  return left?.cursor === right?.cursor
}

/**
 * Resolved storage/provider metadata for diagnostics and host surfaces.
 *
 * This lightweight shape is designed for UI status banners, REST responses,
 * CLI diagnostics, and integration checks that need to know which providers
 * are active without reaching into the internal capability bag.
 */
export interface StorageStatus {
  /** Active `card.storage` provider id (also mirrored as the legacy storage-engine label). */
  storageEngine: string
  /** Fully resolved provider selections, or `null` when a pre-built storage engine was injected. */
  providers: ResolvedCapabilities | null
  /** Whether the active card provider stores cards as local files. */
  isFileBacked: boolean
  /** File-watcher glob for local card files, or `null` for non-file-backed providers. */
  watchGlob: string | null
}

/**
 * Active auth provider metadata for diagnostics and host surfaces.
 *
 * Mirrors the same diagnostic-status pattern as {@link StorageStatus}.
 * Host surfaces (REST API, CLI, MCP) can surface this to help operators
 * understand whether token-based auth enforcement is live.
 */
export interface AuthStatus {
  /** Active `auth.identity` provider id. `'noop'` when no auth plugin is configured. */
  identityProvider: string
  /** Active `auth.policy` provider id. `'noop'` when no auth plugin is configured. */
  policyProvider: string
  /**
   * `true` when a real (non-noop) identity provider is active, meaning token
   * validation is being performed.
   */
  identityEnabled: boolean
  /**
   * `true` when a real (non-noop) policy provider is active, meaning action-level
   * authorization checks are being performed.
   */
  policyEnabled: boolean
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type ServiceMethodArgs<TMethod> =
  TMethod extends (ctx: any, ...args: infer TArgs) => any ? TArgs : never
/* eslint-enable @typescript-eslint/no-explicit-any */

type MethodInput<TMethod> =
  ServiceMethodArgs<TMethod> extends [infer TFirst, ...unknown[]]
    ? TFirst
    : Record<string, unknown>

type ReadonlySnapshot<T> =
  T extends (...args: never[]) => unknown
    ? T
    : T extends readonly (infer U)[]
      ? readonly ReadonlySnapshot<U>[]
      : T extends object
        ? { readonly [K in keyof T]: ReadonlySnapshot<T[K]> }
        : T

/** Shared plugin secret redaction targets that every surface must honor. */
export const PLUGIN_SETTINGS_REDACTION_TARGETS = ['read', 'list', 'error'] as const satisfies readonly PluginSettingsRedactionTarget[]

/** Default write-only secret masking policy for plugin settings contracts. */
export const DEFAULT_PLUGIN_SETTINGS_REDACTION: PluginSettingsRedactionPolicy = {
  maskedValue: '••••••',
  writeOnly: true,
  targets: PLUGIN_SETTINGS_REDACTION_TARGETS,
}

/** Supported install scopes for in-product plugin installation requests. */
export const PLUGIN_SETTINGS_INSTALL_SCOPES = ['workspace', 'global'] as const satisfies readonly PluginSettingsInstallScope[]

/** Exact package-name matcher for install requests accepted by the plugin settings contract. */
export const EXACT_PLUGIN_SETTINGS_PACKAGE_NAME_PATTERN = /^kl-[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Stable validation error codes for plugin settings contract violations. */
export type PluginSettingsValidationErrorCode =
  | 'invalid-plugin-install-package-name'
  | 'invalid-plugin-install-scope'

/** Error thrown when plugin settings SDK operations fail with a redacted payload. */
export class PluginSettingsOperationError extends Error {
  readonly payload: PluginSettingsErrorPayload

  constructor(payload: PluginSettingsErrorPayload) {
    super(payload.message)
    this.name = 'PluginSettingsOperationError'
    this.payload = payload
  }
}

/** Error thrown when a plugin settings contract validation boundary rejects input. */
export class PluginSettingsValidationError extends Error {
  readonly code: PluginSettingsValidationErrorCode

  constructor(code: PluginSettingsValidationErrorCode, message: string) {
    super(message)
    this.name = 'PluginSettingsValidationError'
    this.code = code
  }
}

/** Fixed argv install command emitted by the SDK-owned plugin installer. */
export interface PluginSettingsInstallCommand {
  command: 'npm'
  args: string[]
  cwd: string
  shell: false
}

/** Structured success payload returned by guarded plugin install requests. */
export interface PluginSettingsInstallResult {
  packageName: string
  scope: PluginSettingsInstallScope
  command: PluginSettingsInstallCommand
  stdout: string
  stderr: string
  message: string
  redaction: PluginSettingsRedactionPolicy
}

interface PluginSettingsInstallExecutionResult {
  exitCode: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
}

const PLUGIN_SETTINGS_INSTALL_SUCCESS_MESSAGE = 'Installed plugin package with lifecycle scripts disabled.'
const PLUGIN_SETTINGS_INSTALL_FAILURE_MESSAGE = 'Unable to install plugin package. In-product installs disable lifecycle scripts; install the package manually if it requires lifecycle scripts.'

function createPluginSettingsInstallCommand(
  request: PluginSettingsInstallRequest,
  workspaceRoot: string,
): PluginSettingsInstallCommand {
  return {
    command: 'npm',
    args: request.scope === 'global'
      ? ['install', '--global', '--ignore-scripts', request.packageName]
      : ['install', '--ignore-scripts', request.packageName],
    cwd: workspaceRoot,
    shell: false,
  }
}

function createPluginSettingsManualInstallCommand(
  request: PluginSettingsInstallRequest,
  workspaceRoot: string,
): PluginSettingsInstallCommand {
  return {
    command: 'npm',
    args: request.scope === 'global'
      ? ['install', '--global', request.packageName]
      : ['install', request.packageName],
    cwd: workspaceRoot,
    shell: false,
  }
}

function redactPluginSettingsInstallOutput(value: string): string {
  let redacted = value.replace(/\r\n/g, '\n')

  redacted = redacted.replace(
    /([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^/\s:@]+):([^@\s/]+)@/g,
    '$1[REDACTED]:[REDACTED]@',
  )
  redacted = redacted.replace(/(authorization\s*:\s*bearer\s+)[^\s]+/gi, '$1[REDACTED]')
  redacted = redacted.replace(/(authorization\s*:\s*basic\s+)[^\s]+/gi, '$1[REDACTED]')
  redacted = redacted.replace(
    /((_authToken|npm[_-]?auth[_-]?token|token|password|passwd|secret)\s*[=:]\s*)("?)[^"\s]+(\3)/gi,
    '$1$3[REDACTED]$4',
  )

  return redacted.trim()
}

function runPluginSettingsInstallCommand(
  command: PluginSettingsInstallCommand,
): Promise<PluginSettingsInstallExecutionResult> {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(command.command, command.args, {
      cwd: command.cwd,
      shell: command.shell,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString()
    })

    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString()
    })

    child.once('error', reject)
    child.once('close', (exitCode, signal) => {
      resolve({ exitCode, signal, stdout, stderr })
    })
  })
}

/** Returns `true` when `value` is a supported plugin install scope. */
export function isPluginSettingsInstallScope(value: unknown): value is PluginSettingsInstallScope {
  return typeof value === 'string' && (PLUGIN_SETTINGS_INSTALL_SCOPES as readonly string[]).includes(value)
}

/** Returns `true` when `value` is an exact unscoped `kl-*` npm package name. */
export function isExactPluginSettingsPackageName(value: unknown): value is string {
  return typeof value === 'string' && EXACT_PLUGIN_SETTINGS_PACKAGE_NAME_PATTERN.test(value)
}

/**
 * Validates the SDK install request contract for plugin settings flows.
 *
 * Only exact unscoped `kl-*` package names are accepted. Version specifiers,
 * paths, URLs, shell fragments, whitespace-delimited arguments, and other
 * npm wrapper syntax are rejected at this boundary before any subprocess work
 * is attempted.
 */
export function validatePluginSettingsInstallRequest(input: {
  packageName: unknown
  scope: unknown
}): PluginSettingsInstallRequest {
  if (!isPluginSettingsInstallScope(input.scope)) {
    throw new PluginSettingsValidationError(
      'invalid-plugin-install-scope',
      'Plugin install requests must declare an explicit install scope of "workspace" or "global".',
    )
  }

  if (!isExactPluginSettingsPackageName(input.packageName)) {
    throw new PluginSettingsValidationError(
      'invalid-plugin-install-package-name',
      'Plugin install requests must use an exact unscoped kl-* package name with no version specifier, flag, URL, path, whitespace, or shell fragment.',
    )
  }

  return {
    packageName: input.packageName,
    scope: input.scope,
  }
}

/** Applies the shared plugin secret redaction policy to surfaced error payloads. */
export function createPluginSettingsErrorPayload(input: {
  code: string
  message: string
  capability?: PluginCapabilityNamespace
  providerId?: string
  details?: Record<string, unknown>
  redaction?: PluginSettingsRedactionPolicy
}): PluginSettingsErrorPayload {
  return {
    code: input.code,
    message: input.message,
    capability: input.capability,
    providerId: input.providerId,
    details: input.details,
    redaction: input.redaction ?? DEFAULT_PLUGIN_SETTINGS_REDACTION,
  }
}

function toPluginSettingsOperationError(input: {
  error: unknown
  fallbackCode: string
  fallbackMessage: string
  capability?: PluginCapabilityNamespace
  providerId?: string
}): PluginSettingsOperationError {
  if (input.error instanceof AuthError) {
    throw input.error
  }

  if (input.error instanceof PluginSettingsOperationError) {
    return input.error
  }

  if (input.error instanceof PluginSettingsStoreError) {
    return new PluginSettingsOperationError(createPluginSettingsErrorPayload({
      code: input.error.code,
      message: input.error.message,
      capability: input.capability,
      providerId: input.providerId,
      details: input.error.details,
    }))
  }

  if (input.error instanceof PluginSettingsValidationError) {
    return new PluginSettingsOperationError(createPluginSettingsErrorPayload({
      code: input.error.code,
      message: input.error.message,
      capability: input.capability,
      providerId: input.providerId,
    }))
  }

  return new PluginSettingsOperationError(createPluginSettingsErrorPayload({
    code: input.fallbackCode,
    message: input.fallbackMessage,
    capability: input.capability,
    providerId: input.providerId,
  }))
}

/**
 * Active webhook provider metadata for diagnostics and host surfaces.
 *
 * Mirrors the same diagnostic-status pattern as {@link StorageStatus}.
 * Host surfaces (REST API, CLI, MCP) can surface this to help operators
 * understand whether an external webhook delivery plugin is live.
 */
export interface WebhookStatus {
  /**
   * Active `webhook.delivery` provider id.
   * Returns `'none'` when `kl-plugin-webhook` is not installed.
   */
  webhookProvider: string
  /**
   * `true` when an external webhook provider plugin is active.
   * `false` when `kl-plugin-webhook` is not installed.
   */
  webhookProviderActive: boolean
}

/** Active card-state provider metadata for diagnostics and host surfaces. */
export type CardStateRuntimeStatus = CardStateStatus

type PluginSettingsProviderReadModel = PluginSettingsReadPayload & Pick<
  PluginSettingsProviderRow,
  'packageName' | 'discoverySource' | 'optionsSchema'
>

/**
 * Optional search and sort inputs for {@link KanbanSDK.listCards}.
 *
 * The object form is the recommended public contract for new callers because it
 * keeps structured metadata filters, free-text search, fuzzy search, and sort
 * options in one explicit shape.
 *
 * @example
 * ```ts
 * const cards = await sdk.listCards(undefined, 'bugs', {
 *   searchQuery: 'release meta.team: backend',
 *   metaFilter: { 'links.jira': 'PROJ-' },
 *   sort: 'modified:desc',
 *   fuzzy: true,
 * })
 * ```
 */
export interface ListCardsOptions {
  /**
   * Optional map of dot-notation metadata paths to required values.
   * Each entry is AND-based and field-scoped.
   */
  metaFilter?: Record<string, string>
  /**
   * Optional sort order. Defaults to fractional board order.
   */
  sort?: CardSortOption
  /**
   * Optional free-text query. The query may also include inline
   * `meta.field: value` tokens, which are merged with `metaFilter`.
   */
  searchQuery?: string
  /**
   * Enables fuzzy matching when `true`. Exact substring matching remains the default.
   */
  fuzzy?: boolean
}

const LIST_CARD_SORT_OPTIONS: ReadonlySet<CardSortOption> = new Set([
  'created:asc',
  'created:desc',
  'modified:asc',
  'modified:desc',
])

function isStringRecord(value: unknown): value is Record<string, string> {
  return Boolean(value)
    && !Array.isArray(value)
    && typeof value === 'object'
    && Object.values(value as Record<string, unknown>).every(entry => typeof entry === 'string')
}

function isCardSortOption(value: unknown): value is CardSortOption {
  return typeof value === 'string' && LIST_CARD_SORT_OPTIONS.has(value as CardSortOption)
}

function isListCardsOptions(value: unknown): value is ListCardsOptions {
  if (!value || Array.isArray(value) || typeof value !== 'object') return false
  const candidate = value as Partial<ListCardsOptions> & Record<string, unknown>
  if ('metaFilter' in candidate && candidate.metaFilter !== undefined && !isStringRecord(candidate.metaFilter)) return false
  if ('sort' in candidate && candidate.sort !== undefined && !isCardSortOption(candidate.sort)) return false
  if ('searchQuery' in candidate && candidate.searchQuery !== undefined && typeof candidate.searchQuery !== 'string') return false
  if ('fuzzy' in candidate && candidate.fuzzy !== undefined && typeof candidate.fuzzy !== 'boolean') return false
  return 'metaFilter' in candidate || 'sort' in candidate || 'searchQuery' in candidate || 'fuzzy' in candidate
}

function normalizeListCardsOptions(
  optionsOrMetaFilter?: ListCardsOptions | Record<string, string>,
  sort?: CardSortOption,
  searchQuery?: string,
  fuzzy?: boolean
): ListCardsOptions {
  if (sort !== undefined || searchQuery !== undefined || fuzzy !== undefined) {
    return {
      metaFilter: optionsOrMetaFilter as Record<string, string> | undefined,
      sort,
      searchQuery,
      fuzzy,
    }
  }

  if (!optionsOrMetaFilter) return {}

  return isListCardsOptions(optionsOrMetaFilter)
    ? optionsOrMetaFilter
    : { metaFilter: optionsOrMetaFilter }
}

function cloneProviderRef(ref: ProviderRef): ProviderRef {
  return ref.options !== undefined
    ? { provider: ref.provider, options: { ...ref.options } }
    : { provider: ref.provider }
}

function resolveConfiguredAuthCapabilities(kanbanDir: string): ResolvedAuthCapabilities {
  const config = readConfig(path.dirname(kanbanDir))
  return normalizeAuthCapabilities(config)
}

function resolveConfiguredCapabilities(kanbanDir: string, options?: SDKOptions): ResolvedCapabilities {
  const config = readConfig(path.dirname(kanbanDir))
  const capabilities = normalizeStorageCapabilities(config)

  if (options?.storageEngine === 'sqlite') {
    capabilities['card.storage'] = {
      provider: 'sqlite',
      options: { sqlitePath: options.sqlitePath ?? config.sqlitePath ?? '.kanban/kanban.db' },
    }
  } else if (options?.storageEngine === 'markdown') {
    capabilities['card.storage'] = { provider: 'localfs' }
  }

  if (options?.capabilities?.['card.storage']) {
    capabilities['card.storage'] = cloneProviderRef(options.capabilities['card.storage'])
  }
  if (options?.capabilities?.['attachment.storage']) {
    capabilities['attachment.storage'] = cloneProviderRef(options.capabilities['attachment.storage'])
  }

  return capabilities
}

function resolveConfiguredWebhookCapabilities(kanbanDir: string): ResolvedWebhookCapabilities {
  const config = readConfig(path.dirname(kanbanDir))
  return normalizeWebhookCapabilities(config)
}

function resolveConfiguredCallbackCapabilities(kanbanDir: string): ResolvedCallbackCapabilities {
  const config = readConfig(path.dirname(kanbanDir))
  return normalizeCallbackCapabilities(config)
}

function resolveConfiguredCardStateCapabilities(kanbanDir: string): ResolvedCardStateCapabilities {
  const config = readConfig(path.dirname(kanbanDir))
  return normalizeCardStateCapabilities(config)
}

/**
 * Core SDK for managing kanban boards with provider-backed card storage.
 *
 * Provides full CRUD operations for boards, cards, columns, comments,
 * attachments, and display settings. By default cards are persisted as
 * markdown files with YAML frontmatter under the `.kanban/` directory,
 * organized by board and status column, but the resolved `card.storage`
 * provider may also route card/comment persistence to SQLite, MySQL, or an
 * external plugin.
 *
 * This class is the foundation that the CLI, MCP server, and standalone
 * HTTP server are all built on top of.
 *
 * @example
 * ```ts
 * const sdk = new KanbanSDK('/path/to/project/.kanban')
 * await sdk.init()
 * const cards = await sdk.listCards()
 * ```
 */
export class KanbanSDK {
  private _migrated = false
  private _onEvent?: SDKEventHandler
  private readonly _eventBus: EventBus
  private _webhookPlugin: SDKEventListenerPlugin | null = null
  private _callbackPlugin: SDKEventListenerPlugin | null = null
  private _pluginInstallRunner = runPluginSettingsInstallCommand
  /** @internal */ _storage: StorageEngine
  private _capabilities: ResolvedCapabilityBag | null = null
  /** @internal Async-scoped auth carrier. Installed per request scope via {@link runWithAuth}. */
  private static readonly _authStorage = new AsyncLocalStorage<AuthContext>()

  /** @internal */
  private static _runWithScopedAuth<T>(auth: AuthContext, fn: () => Promise<T>): Promise<T> {
    return KanbanSDK._authStorage.run(auth, fn)
  }

  /** @internal */
  private static _getScopedAuth(): AuthContext | undefined {
    return KanbanSDK._authStorage.getStore()
  }

  /**
   * Absolute path to the `.kanban` kanban directory.
   * The parent of this directory is treated as the workspace root.
   */
  public readonly kanbanDir: string

  /**
   * Creates a new KanbanSDK instance.
   *
   * @param kanbanDir - Absolute path to the `.kanban` kanban directory.
   *   When omitted, the directory is auto-detected by walking up from
   *   `process.cwd()` to find the workspace root (via `.git`, `package.json`,
   *   or `.kanban.json`), then reading `kanbanDirectory` from `.kanban.json`
   *   (defaults to `'.kanban'`).
   * @param options - Optional configuration including an event handler callback
   *   and storage engine selection.
   *
   * @example
   * ```ts
   * // Auto-detect from process.cwd()
   * const sdk = new KanbanSDK()
   *
   * // Explicit path
   * const sdk = new KanbanSDK('/home/user/my-project/.kanban')
   *
   * // With event handler for webhooks
   * const sdk = new KanbanSDK('/home/user/my-project/.kanban', {
   *   onEvent: (event, data) => fireWebhooks(root, event, data)
   * })
   *
   * // Force SQLite storage
   * const sdk = new KanbanSDK('/home/user/my-project/.kanban', {
   *   storageEngine: 'sqlite'
   * })
   * ```
   */
  constructor(kanbanDir?: string, options?: SDKOptions) {
    this.kanbanDir = kanbanDir ?? resolveKanbanDir()
    loadWorkspaceEnv(path.dirname(this.kanbanDir))
    this._onEvent = options?.onEvent
    this._pluginInstallRunner = options?.pluginInstallRunner ?? runPluginSettingsInstallCommand

    // Initialize the pub/sub event bus
    this._eventBus = new EventBus()

    // Backward compatibility: wire legacy onEvent callback as a bus listener
    if (this._onEvent) {
      this._eventBus.onAny((event, payload) => {
        this._onEvent!(event as SDKEventType, (payload as SDKEvent).data)
      })
    }

    if (options?.storage) {
      this._storage = options.storage
      this._capabilities = null
      // Pre-built storage engine injected: no runtime capability bag is available.
      // _webhookPlugin/_callbackPlugin stay null; plugin-owned runtime hooks are unavailable.
      return
    }

    const capabilityBag = resolveCapabilityBag(
      resolveConfiguredCapabilities(this.kanbanDir, options),
      this.kanbanDir,
      resolveConfiguredAuthCapabilities(this.kanbanDir),
      resolveConfiguredWebhookCapabilities(this.kanbanDir),
      resolveConfiguredCardStateCapabilities(this.kanbanDir),
      resolveConfiguredCallbackCapabilities(this.kanbanDir),
    )
    this._capabilities = {
      ...capabilityBag,
      authListener: createBuiltinAuthListenerPlugin(
        capabilityBag.authIdentity,
        capabilityBag.authPolicy,
        () => this._currentAuthContext,
      ),
    }
    this._storage = this._capabilities.cardStorage

    const webhookListener = this._capabilities.webhookListener
    if (webhookListener) {
      // Provider-supplied listener from the external webhook package.
      this._webhookPlugin = webhookListener
      this._webhookPlugin.register(this._eventBus)
    }
    // When no listener is provided, _webhookPlugin stays null. No delivery listener is
    // registered. Webhook CRUD methods will return plugin-missing errors.

    const callbackListener = this._capabilities.callbackListener
    if (callbackListener) {
      this._callbackPlugin = callbackListener
      ;(this._callbackPlugin as CallbackRuntimeContextAwareListener).attachRuntimeContext?.({
        workspaceRoot: this.workspaceRoot,
        sdk: this,
      })
      this._callbackPlugin.register(this._eventBus)
    }
    // When no listener is provided, _callbackPlugin stays null. The shared SDK
    // lifecycle remains the only runtime registration point for same-runtime callbacks.

    // Register the built-in auth listener plugin.
    this._capabilities.authListener.register(this._eventBus)
  }

  /**
   * The underlying SDK event bus for advanced event workflows.
   *
   * Most consumers can use the convenience proxy methods on `KanbanSDK`
   * itself (`on`, `once`, `many`, `onAny`, `waitFor`, etc.). Access the
   * raw bus directly when you specifically need the shared `EventBus`
   * instance.
   */
  get eventBus(): EventBus { return this._eventBus }

  /** Subscribe to an SDK event or wildcard pattern. */
  on(event: string, listener: (payload: SDKEvent) => void): () => void {
    return this._eventBus.on(event, listener)
  }

  /** Subscribe to the next matching SDK event only once. */
  once(event: string, listener: (payload: SDKEvent) => void): () => void {
    return this._eventBus.once(event, listener)
  }

  /** Subscribe to an SDK event a fixed number of times. */
  many(event: string, timesToListen: number, listener: (payload: SDKEvent) => void): () => void {
    return this._eventBus.many(event, timesToListen, listener)
  }

  /** Subscribe to every SDK event regardless of name. */
  onAny(listener: EventBusAnyListener): () => void {
    return this._eventBus.onAny(listener)
  }

  /** Remove a specific event listener. */
  off(event: string, listener: (payload: SDKEvent) => void): void {
    this._eventBus.off(event, listener)
  }

  /** Remove a specific catch-all listener. */
  offAny(listener: EventBusAnyListener): void {
    this._eventBus.offAny(listener)
  }

  /** Remove all event listeners for one event, or all listeners when omitted. */
  removeAllListeners(event?: string): void {
    this._eventBus.removeAllListeners(event)
  }

  /** Return the registered event names currently tracked by the bus. */
  eventNames(): string[] {
    return this._eventBus.eventNames()
  }

  /** Get the number of listeners for a specific event, or all listeners when omitted. */
  listenerCount(event?: string): number {
    return this._eventBus.listenerCount(event)
  }

  /** Check whether any listeners are registered for an event or for the bus overall. */
  hasListeners(event?: string): boolean {
    return this._eventBus.hasListeners(event)
  }

  /** Wait for the next matching SDK event and resolve with its payload. */
  waitFor(event: string, options?: EventBusWaitOptions): Promise<SDKEvent> {
    return this._eventBus.waitFor(event, options)
  }

  /**
   * The active storage engine powering this SDK instance.
   * Returns the resolved `card.storage` provider implementation
   * (for example `markdown`, `sqlite`, or `mysql`).
   */
  get storageEngine(): StorageEngine {
    return this._storage
  }

  /**
   * The resolved storage/attachment capability bag for this SDK instance.
   * Returns `null` when a pre-built storage engine was injected directly.
   */
  get capabilities(): ResolvedCapabilityBag | null {
    return this._capabilities
  }

  /**
   * Returns storage/provider metadata for host surfaces and diagnostics.
   *
   * Use this to inspect resolved provider ids, file-backed status, and
   * watcher behavior without reaching into capability internals.
   *
   * @returns A {@link StorageStatus} snapshot containing the active provider id,
   *   resolved provider selections (when available), whether cards are backed by
   *   local files, and the watcher glob used by file-backed hosts.
   *
   * @example
   * ```ts
   * const status = sdk.getStorageStatus()
   * console.log(status.storageEngine) // 'markdown' | 'sqlite' | 'mysql' | ...
  * console.log(status.watchGlob) // e.g. markdown card glob for board/status directories
   * ```
   */
  getStorageStatus(): StorageStatus {
    return {
      storageEngine: this._storage.type,
      providers: this._capabilities?.providers ?? null,
      isFileBacked: this._capabilities?.isFileBacked ?? this._storage.type === 'markdown',
      watchGlob: this._capabilities?.getWatchGlob() ?? (this._storage.type === 'markdown' ? 'boards/**/*.md' : null),
    }
  }

  /**
   * Returns auth provider metadata for host surfaces and diagnostics.
   *
   * Use this to inspect which identity and policy providers are active
   * and whether real auth enforcement is enabled.
   *
   * @returns An {@link AuthStatus} snapshot containing the active provider ids
   *   and boolean flags indicating whether non-noop providers are live.
   *
   * @example
   * ```ts
   * const status = sdk.getAuthStatus()
   * console.log(status.identityProvider) // 'noop' | 'my-token-plugin' | ...
   * console.log(status.identityEnabled)  // false when no plugin configured
   * ```
   */
  getAuthStatus(): AuthStatus {
    const identityProvider = this._capabilities?.authIdentity.manifest.id ?? 'noop'
    const policyProvider = this._capabilities?.authPolicy.manifest.id ?? 'noop'
    return {
      identityProvider,
      policyProvider,
      identityEnabled: identityProvider !== 'noop',
      policyEnabled: policyProvider !== 'noop',
    }
  }

  /**
   * Returns webhook provider metadata for host surfaces and diagnostics.
   *
   * Use this to inspect which webhook delivery provider is active and whether
   * `kl-plugin-webhook` is installed.
   *
   * @returns A {@link WebhookStatus} snapshot containing the active provider id
   *   and a boolean flag indicating whether a provider is active.
   *
   * @example
   * ```ts
   * const status = sdk.getWebhookStatus()
   * console.log(status.webhookProvider)      // 'none' | 'webhooks' | ...
   * console.log(status.webhookProviderActive) // false when kl-plugin-webhook not installed
   * ```
   */
  getWebhookStatus(): WebhookStatus {
    const webhookProvider = this._capabilities?.webhookProvider?.manifest.id ?? 'none'
    return {
      webhookProvider,
      webhookProviderActive: this._capabilities?.webhookProvider != null,
    }
  }

  /**
   * Returns the discoverable SDK event catalog for this runtime.
   *
   * The returned list includes built-in core before/after events plus any
   * plugin-declared events exported through active `sdkExtensionPlugin.events`
   * bags. `mask` uses the same dotted wildcard semantics as the SDK event bus:
   * `*` matches one segment and `**` matches zero or more segments.
   *
   * @param options - Optional phase/type and wildcard-mask filters.
   * @returns A stable, sorted list of discoverable event descriptors.
   */
  listAvailableEvents(options: SDKAvailableEventsOptions = {}): SDKAvailableEventDescriptor[] {
    const type = normalizeAvailableEventType(options.type)
    const descriptors = new Map<string, SDKAvailableEventDescriptor>()

    for (const descriptor of KANBAN_EVENT_CATALOG) {
      const phase = descriptor.sdkBefore ? 'before' : 'after'
      if (type !== 'all' && phase !== type) continue
      if (!matchesEventMask(descriptor.event, options.mask)) continue

      descriptors.set(`${phase}:${descriptor.event}`, {
        event: descriptor.event,
        phase,
        source: 'core',
        resource: descriptor.resource,
        label: descriptor.label,
        sdkBefore: descriptor.sdkBefore,
        sdkAfter: descriptor.sdkAfter,
        apiAfter: descriptor.apiAfter,
      })
    }

    for (const extension of this._capabilities?.sdkExtensions ?? []) {
      for (const pluginEvent of extension.events) {
        if (type !== 'all' && pluginEvent.phase !== type) continue
        if (!matchesEventMask(pluginEvent.event, options.mask)) continue

        const key = `${pluginEvent.phase}:${pluginEvent.event}`
        const existing = descriptors.get(key)
        const pluginIds = Array.from(new Set([...(existing?.pluginIds ?? []), extension.id]))

        if (!existing) {
          descriptors.set(key, {
            event: pluginEvent.event,
            phase: pluginEvent.phase,
            source: 'plugin',
            resource: pluginEvent.resource,
            label: pluginEvent.label,
            sdkBefore: pluginEvent.phase === 'before',
            sdkAfter: pluginEvent.phase === 'after',
            apiAfter: pluginEvent.phase === 'after' ? pluginEvent.apiAfter ?? false : false,
            pluginIds,
          })
          continue
        }

        descriptors.set(key, {
          ...existing,
          resource: existing.resource ?? pluginEvent.resource,
          label: existing.label ?? pluginEvent.label,
          apiAfter: existing.apiAfter || (pluginEvent.phase === 'after' ? pluginEvent.apiAfter ?? false : false),
          pluginIds,
        })
      }
    }

    return [...descriptors.values()].sort(compareAvailableEvents)
  }

  /**
   * Lists the capability-grouped plugin provider inventory for the workspace.
   *
   * Discovery reuses the canonical runtime loader order so the returned rows
   * reflect providers that the SDK can actually resolve at runtime. Selected
   * state is derived from `.kanban.json`, and the payload carries the shared
   * plugin-settings redaction policy for downstream UI/API/CLI/MCP reuse.
   * Requires the `plugin-settings.read` auth action before any inventory is materialized.
   *
   * @returns A capability-grouped plugin settings inventory payload.
   */
  async listPluginSettings(): Promise<PluginSettingsPayload> {
    await this._authorizeAction('plugin-settings.read')

    try {
      return await discoverPluginSettingsInventory(this.workspaceRoot, DEFAULT_PLUGIN_SETTINGS_REDACTION, this)
    } catch (error) {
      throw toPluginSettingsOperationError({
        error,
        fallbackCode: 'plugin-settings-read-failed',
        fallbackMessage: 'Unable to list plugin settings.',
      })
    }
  }

  /**
   * Returns the redacted plugin settings read model for one provider.
   *
   * The read model includes the provider's discovery source, current selected
   * state for the capability, any discovered options schema metadata, and a
   * redacted snapshot of persisted options when this provider is selected.
  * Requires the `plugin-settings.read` auth action before any provider payload is materialized.
   *
   * @param capability - The capability namespace to inspect.
   * @param providerId - Provider identifier within that capability.
   * @returns The redacted provider read model, or `null` when the provider is not discovered.
   */
  async getPluginSettings(
    capability: PluginCapabilityNamespace,
    providerId: string,
  ): Promise<PluginSettingsProviderReadModel | null> {
    await this._authorizeAction('plugin-settings.read')

    try {
      return await readPluginSettingsProvider(
        this.workspaceRoot,
        capability,
        providerId,
        DEFAULT_PLUGIN_SETTINGS_REDACTION,
        this,
      )
    } catch (error) {
      throw toPluginSettingsOperationError({
        error,
        fallbackCode: 'plugin-settings-read-failed',
        fallbackMessage: 'Unable to read plugin settings.',
        capability,
        providerId,
      })
    }
  }

  /**
   * Persists the canonical selected provider for one capability inside `.kanban.json`.
   *
   * Selection is modeled only by the provider ref stored under `plugins[capability]`.
   * Re-selecting the same provider preserves any existing persisted options while
   * switching to a different provider replaces the previous single-provider entry.
   * Selecting `none` for `webhook.delivery` disables webhook runtime loading while
   * preserving any stored webhook options for later re-enable.
  * Requires the `plugin-settings.update` auth action before any persistence or
  * provider readback occurs.
   *
   * @param capability - Capability namespace to update.
   * @param providerId - Provider identifier to select.
   * @returns The redacted provider read model after persistence succeeds, or `null`
   *   when the capability was explicitly disabled.
   */
  async selectPluginSettingsProvider(
    capability: PluginCapabilityNamespace,
    providerId: string,
  ): Promise<PluginSettingsProviderReadModel | null> {
    await this._authorizeAction('plugin-settings.update')

    try {
      return await persistPluginSettingsProviderSelection(
        this.workspaceRoot,
        capability,
        providerId,
        DEFAULT_PLUGIN_SETTINGS_REDACTION,
        this,
      )
    } catch (error) {
      throw toPluginSettingsOperationError({
        error,
        fallbackCode: 'plugin-settings-select-failed',
        fallbackMessage: 'Unable to persist the selected plugin provider.',
        capability,
        providerId,
      })
    }
  }

  /**
   * Persists provider options under the canonical capability-selection model.
   *
   * Secret fields remain write-only: callers may submit the shared masked value
   * placeholder to keep an existing stored secret unchanged, while any non-masked
    * replacement overwrites that secret. When the target provider is already
    * selected, the canonical `plugins[capability]` entry is updated in place.
    * When the provider is currently inactive, the options are cached under the
    * shared plugin-options store so hosts can save and reopen schema-driven forms
    * without changing enablement; selecting that provider later restores the
    * cached options into `plugins[capability]`.
    * Requires the `plugin-settings.update` auth action before any persistence or
    * provider readback occurs.
   *
   * @param capability - Capability namespace to update.
   * @param providerId - Provider identifier whose options are being updated.
   * @param options - Provider options payload to persist.
   * @returns The redacted provider read model after persistence succeeds.
   */
  async updatePluginSettingsOptions(
    capability: PluginCapabilityNamespace,
    providerId: string,
    options: Record<string, unknown>,
  ): Promise<PluginSettingsProviderReadModel> {
    await this._authorizeAction('plugin-settings.update')

    try {
      return await persistPluginSettingsProviderOptions(
        this.workspaceRoot,
        capability,
        providerId,
        options,
        DEFAULT_PLUGIN_SETTINGS_REDACTION,
        this,
      )
    } catch (error) {
      throw toPluginSettingsOperationError({
        error,
        fallbackCode: 'plugin-settings-update-failed',
        fallbackMessage: 'Unable to persist plugin options.',
        capability,
        providerId,
      })
    }
  }

  /**
   * Installs a supported external plugin package through guarded `npm install` execution.
   *
   * The SDK validates the request before launching a subprocess, accepts only exact
   * unscoped `kl-*` package names, always disables lifecycle scripts for in-product
   * installs, and redacts stdout/stderr before surfacing either the success payload
   * or a structured failure payload.
   * Requires the `plugin-settings.update` auth action before validation or install
   * subprocess work begins.
   *
   * @param input - Candidate package name and install scope to validate and install.
   * @returns Structured redacted success payload describing the executed npm command.
   * @throws {PluginSettingsOperationError} When validation fails or npm exits unsuccessfully.
   */
  async installPluginSettingsPackage(input: {
    packageName: unknown
    scope: unknown
  }): Promise<PluginSettingsInstallResult> {
    await this._authorizeAction('plugin-settings.update')

    let request: PluginSettingsInstallRequest

    try {
      request = validatePluginSettingsInstallRequest(input)
    } catch (error) {
      throw toPluginSettingsOperationError({
        error,
        fallbackCode: 'plugin-settings-install-failed',
        fallbackMessage: PLUGIN_SETTINGS_INSTALL_FAILURE_MESSAGE,
      })
    }

    const command = createPluginSettingsInstallCommand(request, this.workspaceRoot)
    const manualInstall = createPluginSettingsManualInstallCommand(request, this.workspaceRoot)

    try {
      const execution = await this._pluginInstallRunner(command)
      const stdout = redactPluginSettingsInstallOutput(execution.stdout)
      const stderr = redactPluginSettingsInstallOutput(execution.stderr)

      if (execution.exitCode !== 0) {
        throw new PluginSettingsOperationError(createPluginSettingsErrorPayload({
          code: 'plugin-settings-install-failed',
          message: PLUGIN_SETTINGS_INSTALL_FAILURE_MESSAGE,
          details: {
            packageName: request.packageName,
            scope: request.scope,
            exitCode: execution.exitCode,
            signal: execution.signal ?? undefined,
            command,
            manualInstall,
            stdout,
            stderr,
          },
        }))
      }

      return {
        packageName: request.packageName,
        scope: request.scope,
        command,
        stdout,
        stderr,
        message: PLUGIN_SETTINGS_INSTALL_SUCCESS_MESSAGE,
        redaction: DEFAULT_PLUGIN_SETTINGS_REDACTION,
      }
    } catch (error) {
      if (error instanceof PluginSettingsOperationError) {
        throw error
      }

      throw new PluginSettingsOperationError(createPluginSettingsErrorPayload({
        code: 'plugin-settings-install-failed',
        message: PLUGIN_SETTINGS_INSTALL_FAILURE_MESSAGE,
        details: {
          packageName: request.packageName,
          scope: request.scope,
          command,
          manualInstall,
          error: error instanceof Error
            ? redactPluginSettingsInstallOutput(error.message)
            : 'Unknown install error.',
        },
      }))
    }
  }

  /**
    * Returns card-state provider metadata for host surfaces and diagnostics.
    *
    * The status includes the stable auth-absent default actor contract and lets
    * callers distinguish configured-identity failures from true backend
    * unavailability via `availability` / `errorCode`.
   */
  getCardStateStatus(): CardStateRuntimeStatus {
    if (!this._capabilities) {
      return {
        provider: 'none',
        active: false,
        backend: 'none',
        availability: 'unavailable',
        defaultActorMode: CARD_STATE_DEFAULT_ACTOR_MODE,
        defaultActor: DEFAULT_CARD_STATE_ACTOR,
        defaultActorAvailable: true,
        errorCode: ERR_CARD_STATE_UNAVAILABLE,
      }
    }

    const provider = this._capabilities.cardState.manifest.id

    return {
      provider,
      active: true,
      backend: this._capabilities.cardStateContext.backend,
      availability: 'available',
      defaultActorMode: CARD_STATE_DEFAULT_ACTOR_MODE,
      defaultActor: DEFAULT_CARD_STATE_ACTOR,
      defaultActorAvailable: canUseDefaultCardStateActor(this._capabilities.authProviders),
    }
  }

  /**
   * Returns the SDK extension bag contributed by the plugin with the given `id`,
   * or `undefined` when no active plugin has exported a matching `sdkExtensionPlugin`.
   *
   * Use this to access plugin-owned SDK capabilities (e.g. webhook CRUD methods
   * contributed by `kl-plugin-webhook`) without importing plugin packages directly.
   *
   * @typeParam T - Shape of the expected extension bag.
   * @param id - The plugin manifest id to look up (e.g. `'kl-plugin-webhook'`).
   * @returns The resolved extension bag cast to `T`, or `undefined` when the plugin
   *   is not active or has not exported `sdkExtensionPlugin`.
   *
   * @example
   * ```ts
   * const webhookExt = sdk.getExtension<{ listWebhooks(): Webhook[] }>('kl-plugin-webhook')
   * const webhooks = webhookExt?.listWebhooks() ?? []
   * ```
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getExtension<T extends Record<string, any> = Record<string, unknown>>(id: string): T | undefined {
    const entry = this._capabilities?.sdkExtensions.find(e => e.id === id)
    return entry?.extensions as T | undefined
  }

  /** @internal */
  private _requireCardStateCapabilities(): ResolvedCapabilityBag {
    if (!this._capabilities) {
      throw new CardStateError(ERR_CARD_STATE_UNAVAILABLE, 'card.state is unavailable for injected storage engines')
    }
    return this._capabilities
  }

  /** @internal */
  private async _resolveCardStateTarget(cardId: string, boardId?: string): Promise<{ cardId: string; boardId: string }> {
    const card = await this.getCard(cardId, boardId)
    if (!card) throw new Error(`Card not found: ${cardId}`)
    return {
      cardId: card.id,
      boardId: card.boardId || this._resolveBoardId(boardId),
    }
  }

  /**
   * Derives a card-state target directly from a pre-loaded Card without a listCards round-trip.
   * @internal
   */
  private _resolveCardStateTargetDirect(
    card: Pick<Card, 'id' | 'boardId'>,
    fallbackBoardId?: string,
  ): { cardId: string; boardId: string } {
    return {
      cardId: card.id,
      boardId: card.boardId || this._resolveBoardId(fallbackBoardId),
    }
  }

  /** @internal */
  private async _resolveCardStateActorId(): Promise<string> {
    const capabilities = this._requireCardStateCapabilities()

    if (canUseDefaultCardStateActor(capabilities.authProviders)) {
      return DEFAULT_CARD_STATE_ACTOR.id
    }

    try {
      const identity = await capabilities.authIdentity.resolveIdentity(this._currentAuthContext ?? {})
      if (identity?.subject) return identity.subject
    } catch {
      // handled below as a stable public card-state error
    }

    throw new CardStateError(
      ERR_CARD_STATE_IDENTITY_UNAVAILABLE,
      'card.state requires a resolved actor from the configured auth.identity provider',
    )
  }

  /** @internal */
  private async _getLatestUnreadActivityCursor(cardId: string, boardId: string): Promise<CardStateCursor | null> {
    const logs = await this.listLogs(cardId, boardId)
    for (let index = logs.length - 1; index >= 0; index -= 1) {
      const cursor = getUnreadActivityCursor(logs[index], index)
      if (cursor) return cursor
    }
    return null
  }

  /** @internal */
  private _createUnreadSummary(
    actorId: string,
    target: { cardId: string; boardId: string },
    latestActivity: CardStateCursor | null,
    readThrough: CardStateCursor | null,
  ): CardUnreadSummary {
    return {
      actorId,
      boardId: target.boardId,
      cardId: target.cardId,
      latestActivity,
      readThrough,
      unread: latestActivity != null && !cursorsMatch(latestActivity, readThrough),
    }
  }

  /**
   * Reads persisted card-state for the current actor without producing any side effects.
   *
    * When `domain` is omitted, the unread cursor domain is returned.
    * This method reads actor-scoped `card.state` only and does not reflect or
    * modify active-card UI state.
   */
  async getCardState(cardId: string, boardId?: string, domain: string = CARD_STATE_UNREAD_DOMAIN): Promise<CardStateRecord | null> {
    const capabilities = this._requireCardStateCapabilities()
    const actorId = await this._resolveCardStateActorId()
    const target = await this._resolveCardStateTarget(cardId, boardId)
    return capabilities.cardState.getCardState({
      actorId,
      boardId: target.boardId,
      cardId: target.cardId,
      domain,
    })
  }

  /**
   * Batch-efficient read model for a pre-loaded card used during board init and broadcast.
   *
   * Unlike calling {@link getUnreadSummary} and {@link getCardState} separately, this method:
   * - Resolves the actor identity exactly once.
   * - Derives the board/card target from the supplied Card without an extra listCards round-trip.
   * - Runs log, unread-cursor, and open-state I/O concurrently.
   *
   * Use this when the caller already holds the full Card object (e.g. inside
   * `decorateCardsForWebview`) to avoid the N² file-scan that the individual
   * methods incur when called in a loop over all cards.
   *
   * @param card - The pre-loaded Card object.
   * @param fallbackBoardId - Board ID to use when `card.boardId` is not set.
   * @returns Unread summary and open-domain card-state record for the current actor.
   */
  async getCardStateReadModelForCard(
    card: Card,
    fallbackBoardId?: string,
  ): Promise<{ unread: CardUnreadSummary; open: CardStateRecord<CardOpenStateValue> | null }> {
    const capabilities = this._requireCardStateCapabilities()
    const actorId = await this._resolveCardStateActorId()
    const target = this._resolveCardStateTargetDirect(card, fallbackBoardId)
    const key = { actorId, boardId: target.boardId, cardId: target.cardId }

    const [logs, readThrough, open] = await Promise.all([
      Logs.listLogsForCard(this, card),
      capabilities.cardState.getUnreadCursor(key),
      capabilities.cardState.getCardState({ ...key, domain: CARD_STATE_OPEN_DOMAIN }) as Promise<CardStateRecord<CardOpenStateValue> | null>,
    ])

    let latestActivity: CardStateCursor | null = null
    for (let index = logs.length - 1; index >= 0; index -= 1) {
      const cursor = getUnreadActivityCursor(logs[index], index)
      if (cursor) { latestActivity = cursor; break }
    }

    const unread = this._createUnreadSummary(actorId, target, latestActivity, readThrough)
    return { unread, open: open as CardStateRecord<CardOpenStateValue> | null }
  }

  /**
    * Derives unread state for the current actor from persisted activity logs without mutating card state.
    *
    * Unread derivation is SDK-owned for both the built-in file-backed backend and
    * first-party compatibility backends such as `sqlite`.
   */
  async getUnreadSummary(cardId: string, boardId?: string): Promise<CardUnreadSummary> {
    const capabilities = this._requireCardStateCapabilities()
    const actorId = await this._resolveCardStateActorId()
    const target = await this._resolveCardStateTarget(cardId, boardId)
    const latestActivity = await this._getLatestUnreadActivityCursor(target.cardId, target.boardId)
    const readThrough = await capabilities.cardState.getUnreadCursor({
      actorId,
      boardId: target.boardId,
      cardId: target.cardId,
    })
    return this._createUnreadSummary(actorId, target, latestActivity, readThrough)
  }

  /**
   * Persists an explicit open-card mutation for the current actor.
   *
   * Opening a card records the `open` domain and acknowledges the latest unread
    * activity cursor for that actor without depending on `setActiveCard`.
    * This does not change workspace active-card UI state.
   */
  async markCardOpened(cardId: string, boardId?: string): Promise<CardUnreadSummary> {
    const capabilities = this._requireCardStateCapabilities()
    const actorId = await this._resolveCardStateActorId()
    const target = await this._resolveCardStateTarget(cardId, boardId)
    const latestActivity = await this._getLatestUnreadActivityCursor(target.cardId, target.boardId)
    const openedAt = new Date().toISOString()

    let readThrough: CardStateCursor | null = null
    if (latestActivity) {
      const unreadRecord = await capabilities.cardState.markUnreadReadThrough({
        actorId,
        boardId: target.boardId,
        cardId: target.cardId,
        cursor: latestActivity,
      })
      readThrough = unreadRecord.value
    }

    const openValue: CardOpenStateValue = {
      openedAt,
      readThrough,
    }

    await capabilities.cardState.setCardState({
      actorId,
      boardId: target.boardId,
      cardId: target.cardId,
      domain: CARD_STATE_OPEN_DOMAIN,
      value: openValue,
      updatedAt: openedAt,
    })

    return this._createUnreadSummary(actorId, target, latestActivity, readThrough)
  }

  /**
   * Persists an explicit read-through cursor for the current actor.
   *
   * Reads are side-effect free; call this method when you want to acknowledge
    * unread activity explicitly. Configured-identity failures surface as
    * `ERR_CARD_STATE_IDENTITY_UNAVAILABLE` rather than backend unavailability.
   */
  async markCardRead(cardId: string, boardId?: string, readThrough?: CardStateCursor): Promise<CardUnreadSummary> {
    const capabilities = this._requireCardStateCapabilities()
    const actorId = await this._resolveCardStateActorId()
    const target = await this._resolveCardStateTarget(cardId, boardId)
    const latestActivity = await this._getLatestUnreadActivityCursor(target.cardId, target.boardId)
    const cursor = readThrough ?? latestActivity

    if (!cursor) {
      return this._createUnreadSummary(actorId, target, latestActivity, null)
    }

    const unreadRecord = await capabilities.cardState.markUnreadReadThrough({
      actorId,
      boardId: target.boardId,
      cardId: target.cardId,
      cursor,
    })

    return this._createUnreadSummary(actorId, target, latestActivity, unreadRecord.value)
  }

  /**
   * Resolves caller identity and evaluates whether the named action is permitted.
   *
   * This is the internal SDK pre-action authorization seam. SDK methods that
   * represent mutating or privileged operations should call this before
   * executing their logic.
   *
   * When no auth plugins are configured the built-in noop path allows all
   * actions anonymously, preserving the current open-access behavior
   * for workspaces without an auth configuration.
   *
   * @param action  - Canonical action name (e.g. `'card.create'`, `'board.delete'`).
   * @param context - Optional auth context from the inbound request.
   * @returns Fulfilled {@link AuthDecision} when the action is permitted.
   * @throws {AuthError} When the policy plugin denies the action.
   *
   * @internal
   */
  async _authorizeAction(action: string, context?: AuthContext): Promise<AuthDecision> {
    if (!this._capabilities) {
      // Pre-built storage engine injected directly — operate in noop/anonymous mode.
      return { allowed: true }
    }
    const resolvedContext: AuthContext = context ?? this._currentAuthContext ?? {}
    const identity = await this._capabilities.authIdentity.resolveIdentity(resolvedContext)
    const decision = await this._capabilities.authPolicy.checkPolicy(identity, action, resolvedContext)
    if (!decision.allowed) {
      try {
        const reason = !identity ? 'auth.identity.missing' : (decision.reason ?? 'auth.policy.denied')
        this._eventBus.emit('auth.denied', {
          type: 'auth.denied',
          data: { action, reason, actor: identity?.subject },
          timestamp: new Date().toISOString(),
          actor: identity?.subject,
          boardId: context?.boardId,
        })
      } catch { /* ignore listener errors */ }
      throw new AuthError(
        decision.reason ?? 'auth.policy.denied',
        `Action "${action}" denied${identity ? ` for "${identity.subject}"` : ''}`,
        identity?.subject,
      )
    }
    const result: AuthDecision = { ...decision, actor: decision.actor ?? identity?.subject }
    try {
      this._eventBus.emit('auth.allowed', {
        type: 'auth.allowed',
        data: { action, actor: result.actor },
        timestamp: new Date().toISOString(),
        actor: result.actor,
        boardId: context?.boardId,
      })
    } catch { /* ignore listener errors */ }
    return result
  }

  /**
   * Runs `fn` within an async scope where `auth` is the active auth context.
   *
   * Use this on host surfaces (REST routes, CLI commands, MCP handlers) to
   * bind a request-scoped {@link AuthContext} before calling SDK mutators.
   * The context is propagated automatically through every `await` in the call
   * tree without being threaded through method signatures.
   *
   * @param auth - Request-scoped auth context to install for the duration of `fn`.
   * @param fn   - Async callback to execute with the auth context active.
   * @returns The promise returned by `fn`.
   *
   * @example
   * ```ts
   * const card = await sdk.runWithAuth({ token: req.headers.authorization }, () =>
   *   sdk.createCard({ boardId: 'default', title: 'New task' })
   * )
   * ```
   */
  runWithAuth<T>(auth: AuthContext, fn: () => Promise<T>): Promise<T> {
    return KanbanSDK._runWithScopedAuth(auth, fn)
  }

  /** Returns the auth context installed by the nearest enclosing {@link runWithAuth} call, if any. @internal */
  get _currentAuthContext(): AuthContext | undefined {
    return KanbanSDK._getScopedAuth()
  }

  /** @internal */
  private _resolveEventActor(actor?: string): string | undefined {
    return actor ?? this._currentAuthContext?.actorHint
  }

  /** @internal */
  private static _cloneMergeValue(value: unknown): unknown {
    if (Array.isArray(value) || _isPlainObject(value)) {
      return structuredClone(value)
    }
    return value
  }

  /**
   * Recursively deep-merges `source` into a shallow copy of `target`.
   *
   * - Plain objects are merged recursively; later keys override earlier keys at
   *   every depth.
   * - Arrays, primitives, and class instances in `source` **replace** the
   *   corresponding value in `target` (no concatenation of arrays).
   * - `target` itself is never mutated; the caller receives the merged clone.
   *
   * @internal
   */
  private static _deepMerge<T extends Record<string, unknown>>(
    target: T,
    source: Record<string, unknown>,
  ): T {
    const result: Record<string, unknown> = { ...target }
    for (const key of Object.keys(source)) {
      const tv = target[key]
      const sv = source[key]
      result[key] =
        _isPlainObject(sv) && _isPlainObject(tv)
          ? KanbanSDK._deepMerge(tv as Record<string, unknown>, sv)
          : KanbanSDK._cloneMergeValue(sv)
    }
    return result as T
  }

  /**
   * Dispatches a before-event to all registered listeners and returns a
   * deep-merged clone of the input.
   *
   * Clones `input` immediately with `structuredClone` so the caller's object
   * is never mutated. Awaits all registered before-event listeners in
   * registration order via {@link EventBus.emitAsync}. Each plain-object
   * listener response is deep-merged in registration order over the clone so
   * that later-registered listeners override earlier ones at every nesting
   * depth. Arrays in listener responses **replace** (no concatenation).
   * Non-plain-object, `void`, or empty `{}` responses contribute no keys and
   * the accumulated input stays effectively unchanged.
   *
   * **Throwing aborts the mutation:** any error thrown by a listener —
   * including {@link AuthError} — propagates immediately to the caller.
   * No subsequent listeners execute and no mutation write occurs.
   *
   * @param event   - Before-event name (e.g. `'card.create'`).
   * @param input   - Initial mutation input used as the clone/merge base.
   * @param actor   - Resolved acting principal, if known.
   * @param boardId - Board context for this action, if applicable.
   * @returns Promise resolving to the deep-merged input clone after all listeners settle.
   *
   * @internal
   */
  async _runBeforeEvent<TInput extends Record<string, unknown>>(
    event: SDKBeforeEventType,
    input: TInput,
    actor?: string,
    boardId?: string,
  ): Promise<TInput> {
    const baseInput = structuredClone(input)
    const resolvedActor = this._resolveEventActor(actor)
    const payload: BeforeEventPayload<TInput> = {
      event,
      input: baseInput,
      actor: resolvedActor,
      boardId,
      timestamp: new Date().toISOString(),
    }
    const outputs = await this._eventBus.emitAsync(event, payload)
    return outputs.reduce<TInput>(
      (acc, override) => KanbanSDK._deepMerge(acc, override) as TInput,
      baseInput,
    )
  }

  /**
   * Emits an after-event exactly once after a mutation has been committed.
   *
   * Wraps `data` in an {@link AfterEventPayload} envelope and emits it on the event
   * bus as an {@link SDKEvent}. After-event listeners are non-blocking: the event bus
   * isolates errors per listener so a failing listener never prevents sibling listeners
   * from executing and never propagates to the SDK caller.
   *
   * @param event   - After-event name (e.g. `'task.created'`).
   * @param data    - The committed mutation result.
   * @param actor   - Resolved acting principal, if known.
   * @param boardId - Board context for this event, if applicable.
   * @param meta    - Optional audit metadata.
   *
   * @internal
   */
  _runAfterEvent<TResult>(
    event: SDKAfterEventType,
    data: TResult,
    actor?: string,
    boardId?: string,
    meta?: Record<string, unknown>,
  ): void {
    const resolvedActor = this._resolveEventActor(actor)
    const afterPayload: AfterEventPayload<TResult> = {
      event,
      data,
      actor: resolvedActor,
      boardId,
      timestamp: new Date().toISOString(),
      meta,
    }
    this._eventBus.emit(event, {
      type: event,
      data: afterPayload,
      timestamp: afterPayload.timestamp,
      actor: resolvedActor,
      boardId,
    })
  }

  /**
   * Returns the local file path for a card when the active provider exposes one.
   *
   * This is most useful for editor integrations or diagnostics that need to open
   * or reveal the underlying source file. Providers that do not expose stable
   * local card files return `null`.
   *
   * @param card - The resolved card object.
   * @returns The absolute on-disk card path, or `null` when the active provider
   *   does not expose one.
   *
   * @example
   * ```ts
   * const card = await sdk.getCard('42')
   * if (card) {
   *   console.log(sdk.getLocalCardPath(card))
   * }
   * ```
   */
  getLocalCardPath(card: Card): string | null {
    return this._capabilities?.getLocalCardPath(card) ?? (card.filePath || null)
  }

  /**
   * Returns the local attachment directory for a card when the active
   * attachment provider exposes one.
   *
   * File-backed providers typically return an absolute directory under the
   * workspace, while database-backed or remote attachment providers may return
   * `null` when attachments are not directly browseable on disk.
   *
   * @param card - The resolved card object.
   * @returns The absolute attachment directory, or `null` when the active
   *   attachment provider cannot expose one.
   */
  getAttachmentStoragePath(card: Card): string | null {
    if (this._capabilities) {
      return this._capabilities.getAttachmentDir(card)
    }

    try {
      return this._storage.getCardDir(card)
    } catch {
      return null
    }
  }

  /**
   * Requests an efficient in-place append for an attachment when the active
   * attachment provider supports it.
   *
   * Returns `true` when the provider handled the append directly and `false`
   * when callers should fall back to rewriting the attachment through the
   * normal copy/materialization path.
   */
  async appendAttachment(card: Card, attachment: string, content: string | Uint8Array): Promise<boolean> {
    const appendHandler = this._capabilities?.attachmentStorage.appendAttachment
    if (!appendHandler) return false
    return appendHandler(card, attachment, content)
  }

  /**
   * Resolves or materializes a safe local file path for a named attachment.
   *
   * For simple file-backed providers this usually returns the existing file.
   * Other providers may need to materialize a temporary local copy first.
   * The method also guards against invalid attachment names and only resolves
   * files already attached to the card.
   *
   * @param card - The resolved card object.
   * @param attachment - Attachment filename exactly as stored on the card.
   * @returns An absolute local path, or `null` when the attachment cannot be
   *   safely exposed by the current provider.
   *
   * @example
   * ```ts
   * const card = await sdk.getCard('42')
   * const pdfPath = card ? await sdk.materializeAttachment(card, 'report.pdf') : null
   * ```
   */
  async materializeAttachment(card: Card, attachment: string): Promise<string | null> {
    if (this._capabilities) {
      return this._capabilities.materializeAttachment(card, attachment)
    }

    const normalized = attachment.replace(/\\/g, '/')
    if (!normalized || normalized.includes('/')) return null
    if (!Array.isArray(card.attachments) || !card.attachments.includes(normalized)) return null

    const attachmentDir = this.getAttachmentStoragePath(card)
    if (!attachmentDir) return null
    return path.join(attachmentDir, normalized)
  }

  /**
   * Copies an attachment through the resolved attachment-storage capability.
   *
   * This is a low-level helper used by higher-level attachment flows. It writes
   * the supplied source file into the active attachment provider for the given
   * card, whether that provider is local filesystem storage or a custom plugin.
   *
   * @param sourcePath - Absolute or relative path to the source file to copy.
   * @param card - The target card that should own the copied attachment.
   */
  async copyAttachment(sourcePath: string, card: Card): Promise<void> {
    if (this._capabilities) {
      await this._capabilities.attachmentStorage.copyAttachment(sourcePath, card)
      return
    }
    await this._storage.copyAttachment(sourcePath, card)
  }

  /**
   * Closes the storage engine and releases any held resources (e.g. database
   * connections). Call this when the SDK instance is no longer needed.
   */
  close(): void {
    this._storage.close()
    this._webhookPlugin?.unregister()
    this._callbackPlugin?.unregister()
    this._capabilities?.authListener.unregister()
    this._eventBus.destroy()
  }

  /** Tear down the SDK, destroying the event bus and all listeners. */
  destroy(): void {
    this.close()
  }

  /**
   * Emits an event to the registered handler, if one exists.
   * Called internally after every successful mutating operation.
   */
  /** @internal */
  emitEvent(event: SDKEventType, data: unknown): void {
    this._eventBus.emit(event, {
      type: event,
      data,
      timestamp: new Date().toISOString(),
    })
  }

  /**
   * The workspace root directory (parent of the kanban directory).
   *
   * This is the project root where `.kanban.json` configuration lives.
   *
   * @returns The absolute path to the workspace root directory.
   *
   * @example
   * ```ts
   * const sdk = new KanbanSDK('/home/user/my-project/.kanban')
   * console.log(sdk.workspaceRoot) // '/home/user/my-project'
   * ```
   */
  get workspaceRoot(): string {
    return path.dirname(this.kanbanDir)
  }

  /**
   * Returns a cloned read-only snapshot of the current workspace config.
   *
   * The returned snapshot is created from a fresh config read and deep-cloned
   * before being returned, so callers receive an isolated view of the current
   * `.kanban.json` state rather than a live mutable runtime object. Mutating the
   * returned snapshot does not update persisted config or affect this SDK instance.
   *
   * @returns A cloned read-only snapshot of the current {@link KanbanConfig}.
   *
   * @example
   * ```ts
   * const config = sdk.getConfigSnapshot()
   * console.log(config.defaultBoard)
   * ```
   */
  getConfigSnapshot(): ReadonlySnapshot<KanbanConfig> {
    return structuredClone(readConfig(this.workspaceRoot)) as ReadonlySnapshot<KanbanConfig>
  }

  // --- Board resolution helpers ---

  /** @internal */
  _resolveBoardId(boardId?: string): string {
    const config = readConfig(this.workspaceRoot)
    return boardId || config.defaultBoard
  }

  /** @internal */
  _boardDir(boardId?: string): string {
    const resolvedId = this._resolveBoardId(boardId)
    return path.join(this.kanbanDir, 'boards', resolvedId)
  }

  /** @internal */
  _isCompletedStatus(status: string, boardId?: string): boolean {
    const config = readConfig(this.workspaceRoot)
    const resolvedId = boardId || config.defaultBoard
    const board = config.boards[resolvedId]
    if (!board || board.columns.length === 0) return status === 'done'
    return board.columns[board.columns.length - 1].id === status
  }

  /** @internal */
  async _ensureMigrated(): Promise<void> {
    if (this._migrated) return
    await this._storage.migrate()
    this._migrated = true
  }

  /**
   * Initializes the SDK by running any pending filesystem migrations and
   * ensuring the default board's directory structure exists.
   *
   * This should be called once before performing any operations, especially
   * on a fresh workspace or after upgrading from a single-board layout.
   *
   * @returns A promise that resolves when initialization is complete.
   *
   * @example
   * ```ts
   * const sdk = new KanbanSDK('/path/to/project/.kanban')
   * await sdk.init()
   * ```
   */
  async init(): Promise<void> {
    await this._storage.init()
    this._migrated = true
    const boardDir = this._boardDir()
    await this._storage.ensureBoardDirs(boardDir, [DELETED_STATUS_ID])
  }

  // --- Board management ---

  /**
   * Lists all boards defined in the workspace configuration.
   *
   * @returns An array of {@link BoardInfo} objects containing each board's
    *   `id`, `name`, optional `description`, and display-title metadata config.
   *
   * @example
   * ```ts
   * const boards = sdk.listBoards()
   * // [{ id: 'default', name: 'Default Board', description: undefined }]
   * ```
   */
  listBoards(): BoardInfo[] {
    return Boards.listBoards(this)
  }

  /**
   * Creates a new board with the given ID and name.
   *
   * If no columns are specified, the new board inherits columns from the
   * default board. If the default board has no columns, a standard set of
   * five columns (Backlog, To Do, In Progress, Review, Done) is used.
   *
   * @param id - Unique identifier for the board (used in file paths and API calls).
   * @param name - Human-readable display name for the board.
   * @param options - Optional configuration for the new board.
   * @param options.description - A short description of the board's purpose.
   * @param options.columns - Custom column definitions. Defaults to the default board's columns.
   * @param options.defaultStatus - The default status for new cards. Defaults to the first column's ID.
   * @param options.defaultPriority - The default priority for new cards. Defaults to the workspace default.
   * @returns A {@link BoardInfo} object for the newly created board.
   * @throws {Error} If a board with the given `id` already exists.
   *
   * @example
   * ```ts
   * const board = sdk.createBoard('bugs', 'Bug Tracker', {
   *   description: 'Track and triage bugs',
   *   defaultStatus: 'triage'
   * })
   * ```
   */
  async createBoard(id: string, name: string, options?: {
    description?: string
    columns?: KanbanColumn[]
    defaultStatus?: string
    defaultPriority?: Priority
  }): Promise<BoardInfo> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Boards.createBoard>>('board.create', { id, name, options }, undefined, id)
    const board = Boards.createBoard(this, mergedInput)
    this._runAfterEvent('board.created', board, undefined, board.id)
    return board
  }

  /**
   * Deletes a board and its directory from the filesystem.
   *
   * The board must be empty (no cards) and must not be the default board.
   * The board's directory is removed recursively from disk, and the board
   * entry is removed from the workspace configuration.
   *
   * @param boardId - The ID of the board to delete.
   * @returns A promise that resolves when the board has been deleted.
   * @throws {Error} If the board does not exist.
   * @throws {Error} If the board is the default board.
   * @throws {Error} If the board still contains cards.
   *
   * @example
   * ```ts
   * await sdk.deleteBoard('old-sprint')
   * ```
   */
  async deleteBoard(boardId: string): Promise<void> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Boards.deleteBoard>>('board.delete', { boardId }, undefined, boardId)
    await Boards.deleteBoard(this, mergedInput)
    this._runAfterEvent('board.deleted', { id: mergedInput.boardId }, undefined, mergedInput.boardId)
  }

  /**
   * Retrieves the full configuration for a specific board.
   *
   * @param boardId - The ID of the board to retrieve.
    * @returns The {@link BoardConfig} object containing columns, settings, metadata, and display-title metadata config.
   * @throws {Error} If the board does not exist.
   *
   * @example
   * ```ts
   * const config = sdk.getBoard('default')
   * console.log(config.columns) // [{ id: 'backlog', name: 'Backlog', ... }, ...]
   * ```
   */
  getBoard(boardId: string): BoardConfig {
    return Boards.getBoard(this, { boardId })
  }

  /**
   * Updates properties of an existing board.
   *
   * Only the provided fields are updated; omitted fields remain unchanged.
   * The `nextCardId` counter cannot be modified through this method.
   *
   * @param boardId - The ID of the board to update.
   * @param updates - A partial object containing the fields to update.
   * @param updates.name - New display name for the board.
   * @param updates.description - New description for the board.
   * @param updates.columns - Replacement column definitions.
   * @param updates.defaultStatus - New default status for new cards.
   * @param updates.defaultPriority - New default priority for new cards.
  * @param updates.title - Ordered metadata keys whose values should prefix rendered card titles.
   * @returns The updated {@link BoardConfig} object.
   * @throws {Error} If the board does not exist.
   *
   * @example
   * ```ts
   * const updated = sdk.updateBoard('bugs', {
   *   name: 'Bug Tracker v2',
   *   defaultPriority: 'high'
   * })
   * ```
   */
  async updateBoard(boardId: string, updates: Partial<Omit<BoardConfig, 'nextCardId'>>): Promise<BoardConfig> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Boards.updateBoard>>('board.update', { boardId, updates }, undefined, boardId)
    const board = Boards.updateBoard(this, mergedInput)
    this._runAfterEvent('board.updated', { id: mergedInput.boardId, ...board }, undefined, mergedInput.boardId)
    return board
  }

  /**
   * Returns the named actions defined on a board.
   *
   * @param boardId - Board ID. Defaults to the active board when omitted.
   * @returns A map of action key to display title.
   * @throws {Error} If the board does not exist.
    *
    * @example
    * ```ts
    * const actions = sdk.getBoardActions('deployments')
    * console.log(actions.deploy) // 'Deploy now'
    * ```
   */
  getBoardActions(boardId?: string): Record<string, string> {
    return Boards.getBoardActions(this, { boardId })
  }

  /**
   * Adds or updates a named action on a board.
   *
   * @param boardId - Board ID.
   * @param key - Unique action key (used as identifier).
   * @param title - Human-readable display title for the action.
   * @returns The updated actions map.
   * @throws {Error} If the board does not exist.
    *
    * @example
    * ```ts
    * sdk.addBoardAction('deployments', 'deploy', 'Deploy now')
    * ```
   */
  async addBoardAction(boardId: string, key: string, title: string): Promise<Record<string, string>> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Boards.addBoardAction>>('board.action.config.add', { boardId, key, title }, undefined, boardId)
    const actions = Boards.addBoardAction(this, mergedInput)
    this._runAfterEvent('board.updated', { id: mergedInput.boardId, actions }, undefined, mergedInput.boardId)
    return actions
  }

  /**
   * Removes a named action from a board.
   *
   * @param boardId - Board ID.
   * @param key - The action key to remove.
   * @returns The updated actions map.
   * @throws {Error} If the board does not exist.
   * @throws {Error} If the action key is not found on the board.
    *
    * @example
    * ```ts
    * sdk.removeBoardAction('deployments', 'deploy')
    * ```
   */
  async removeBoardAction(boardId: string, key: string): Promise<Record<string, string>> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Boards.removeBoardAction>>('board.action.config.remove', { boardId, key }, undefined, boardId)
    const actions = Boards.removeBoardAction(this, mergedInput)
    this._runAfterEvent('board.updated', { id: mergedInput.boardId, actions }, undefined, mergedInput.boardId)
    return actions
  }

  /**
   * Fires the `board.action` webhook event for a named board action.
   *
   * @param boardId - The board that owns the action.
   * @param actionKey - The key of the action to trigger.
   * @throws {Error} If the board does not exist.
   * @throws {Error} If the action key is not defined on the board.
    *
    * @example
    * ```ts
    * await sdk.triggerBoardAction('deployments', 'deploy')
    * ```
   */
  async triggerBoardAction(boardId: string, actionKey: string): Promise<void> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Boards.triggerBoardAction>>('board.action.trigger', { boardId, actionKey }, undefined, boardId)
    const actionData = await Boards.triggerBoardAction(this, mergedInput)
    this._runAfterEvent('board.action', actionData, undefined, actionData.boardId)
  }

  /**
   * Transfers a card from one board to another.
   *
   * The card file is physically moved to the target board's directory. If a
   * target status is not specified, the card is placed in the target board's
   * default status column. The card's order is recalculated to place it at
   * the end of the target column. Timestamps (`modified`, `completedAt`)
   * are updated accordingly.
   *
   * @param cardId - The ID of the card to transfer.
   * @param fromBoardId - The ID of the source board.
   * @param toBoardId - The ID of the destination board.
   * @param targetStatus - Optional status column in the destination board.
   *   Defaults to the destination board's default status.
   * @returns A promise resolving to the updated {@link Card} card object.
   * @throws {Error} If either board does not exist.
   * @throws {Error} If the card is not found in the source board.
   *
   * @example
   * ```ts
   * const card = await sdk.transferCard('42', 'inbox', 'bugs', 'triage')
   * console.log(card.boardId) // 'bugs'
   * console.log(card.status)  // 'triage'
   * ```
   */
  async transferCard(cardId: string, fromBoardId: string, toBoardId: string, targetStatus?: string): Promise<Card> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Boards.transferCard>>('card.transfer', {
      cardId,
      fromBoardId,
      toBoardId,
      targetStatus,
    }, undefined, fromBoardId)
    const snapshot = await this.getCard(mergedInput.cardId, mergedInput.fromBoardId)
    const card = await Boards.transferCard(this, mergedInput)
    this._runAfterEvent('task.moved', sanitizeCard(card), undefined, card.boardId, {
      previousStatus: snapshot?.status,
      fromBoard: mergedInput.fromBoardId,
      toBoard: mergedInput.toBoardId,
      transfer: true,
    })
    return card
  }

  // --- Card CRUD ---

  /**
   * Lists all cards on a board, optionally filtered by column/status and search criteria.
   *
   * **Note:** This includes soft-deleted cards (status `'deleted'`).
   * Filter them out if you need only active cards.
   *
   * This method performs several housekeeping tasks during loading:
   * - Migrates flat root-level `.md` files into their proper status subdirectories
   * - Reconciles status/folder mismatches (moves files to match their frontmatter status)
   * - Migrates legacy integer ordering to fractional indexing
   * - Syncs the card ID counter with existing cards
   *
  * By default cards are returned sorted by their fractional order key (board order).
  * Pass a {@link CardSortOption} to sort by creation or modification date instead.
  *
  * Search behavior is storage-agnostic and is the same for markdown and SQLite workspaces:
  * - Exact mode is the default.
  * - Exact free-text search checks the legacy text fields: `content`, `id`, `assignee`, and `labels`.
  * - Inline `meta.field: value` tokens and `metaFilter` entries are always field-scoped and AND-based.
  * - In exact mode, metadata matching uses case-insensitive substring matching.
  * - In fuzzy mode, free-text search also considers metadata values, and field-scoped metadata checks gain fuzzy fallback matching.
  *
  * New code should prefer the object overload so search and sort options stay explicit.
  * The legacy positional parameters remain supported for backward compatibility.
   *
   * @param columns - Optional array of status/column IDs to filter by.
   *   When provided, ensures those subdirectories exist on disk.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
  * @param optionsOrMetaFilter - Either the recommended {@link ListCardsOptions} object,
  *   or the legacy positional `metaFilter` map for backward compatibility.
  * @param sort - Legacy positional sort order. One of `'created:asc'`, `'created:desc'`,
  *   `'modified:asc'`, `'modified:desc'`. Defaults to fractional board order.
  * @param searchQuery - Legacy positional free-text query, which may include
  *   `meta.field: value` tokens.
  * @param fuzzy - Legacy positional fuzzy-search toggle. Defaults to `false`.
   * @returns A promise resolving to an array of {@link Card} card objects.
   *
   * @example
   * ```ts
   * // List all cards on the default board
   * const allCards = await sdk.listCards()
   *
   * // List only cards in 'todo' and 'in-progress' columns on the 'bugs' board
   * const filtered = await sdk.listCards(['todo', 'in-progress'], 'bugs')
   *
   * // Preferred object form: exact metadata-aware search using inline meta tokens
   * const releaseCards = await sdk.listCards(undefined, undefined, {
   *   searchQuery: 'release meta.team: backend'
   * })
   *
   * // Preferred object form: fuzzy search across free text and metadata values
   * const fuzzyMatches = await sdk.listCards(undefined, undefined, {
   *   searchQuery: 'meta.team: backnd api plumbng',
   *   fuzzy: true
   * })
   *
   * // Structured metadata filters remain supported and are merged with inline meta tokens
   * const q1Jira = await sdk.listCards(undefined, undefined, {
   *   metaFilter: { sprint: 'Q1', 'links.jira': 'PROJ' },
   *   sort: 'created:desc'
   * })
   *
   * // Legacy positional form still works for existing callers
   * const newest = await sdk.listCards(undefined, undefined, undefined, 'created:desc', 'meta.team: backend', true)
   * ```
   */
  async listCards(columns?: string[], boardId?: string, options?: ListCardsOptions): Promise<Card[]>
  async listCards(
    columns?: string[],
    boardId?: string,
    metaFilter?: Record<string, string>,
    sort?: CardSortOption,
    searchQuery?: string,
    fuzzy?: boolean
  ): Promise<Card[]>
  async listCards(
    columns?: string[],
    boardId?: string,
    optionsOrMetaFilter?: ListCardsOptions | Record<string, string>,
    sort?: CardSortOption,
    searchQuery?: string,
    fuzzy?: boolean
  ): Promise<Card[]> {
    const options = normalizeListCardsOptions(optionsOrMetaFilter, sort, searchQuery, fuzzy)

    return Cards.listCards(
      this,
      { columns, boardId, metaFilter: options.metaFilter, sort: options.sort, searchQuery: options.searchQuery, fuzzy: options.fuzzy }
    )
  }

  /**
   * Retrieves a single card by its ID.
   *
   * Supports partial ID matching -- the provided `cardId` is matched against
   * all cards on the board.
   *
   * @param cardId - The full or partial ID of the card to retrieve.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving to the matching {@link Card} card, or `null` if not found.
   *
   * @example
   * ```ts
   * const card = await sdk.getCard('42')
   * if (card) {
   *   console.log(card.content)
   * }
   * ```
   */
  async getCard(cardId: string, boardId?: string): Promise<Card | null> {
    return Cards.getCard(this, { cardId, boardId })
  }

  /**
   * Retrieves the card currently marked as active/open in this workspace.
   *
   * Active-card state is persisted in the workspace so other interfaces
   * (standalone server, CLI, MCP, and VS Code) can query the same card.
   * Returns `null` when no card is currently active.
   *
   * @param boardId - Optional board ID. When provided, returns the active card
   *   only if it belongs to that board.
   * @returns A promise resolving to the active {@link Card}, or `null`.
   *
   * @example
   * ```ts
   * const active = await sdk.getActiveCard()
   * if (active) {
   *   console.log(active.id)
   * }
   * ```
   */
  async getActiveCard(boardId?: string): Promise<Card | null> {
    return Cards.getActiveCard(this, { boardId })
  }

  /** @internal */
  async setActiveCard(cardId: string, boardId?: string): Promise<Card> {
    return Cards.setActiveCard(this, { cardId, boardId })
  }

  /** @internal */
  async clearActiveCard(boardId?: string): Promise<void> {
    return Cards.clearActiveCard(this, { boardId })
  }

  /**
   * Creates a new card on a board.
   *
   * The card is assigned an auto-incrementing numeric ID, placed at the end
   * of its target status column using fractional indexing, and persisted as a
   * markdown file with YAML frontmatter. If no status or priority is provided,
   * the board's defaults are used.
   *
   * @param data - The card creation input. See {@link CreateCardInput}.
   * @param data.content - Markdown content for the card. The first `# Heading` becomes the title.
   * @param data.status - Optional status column. Defaults to the board's default status.
   * @param data.priority - Optional priority level. Defaults to the board's default priority.
   * @param data.assignee - Optional assignee name.
   * @param data.dueDate - Optional due date as an ISO 8601 string.
   * @param data.labels - Optional array of label strings.
   * @param data.attachments - Optional array of attachment filenames.
   * @param data.metadata - Optional arbitrary key-value metadata stored in the card's frontmatter.
   * @param data.actions - Optional per-card actions as action keys or key-to-title map.
   * @param data.forms - Optional attached forms, using workspace-form references or inline definitions.
   * @param data.formData - Optional per-form persisted values keyed by resolved form ID.
   * @param data.boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving to the newly created {@link Card} card.
   *
   * @example
   * ```ts
   * const card = await sdk.createCard({
   *   content: '# Fix login bug\n\nUsers cannot log in with email.',
   *   status: 'todo',
   *   priority: 'high',
   *   labels: ['bug', 'auth'],
   *   boardId: 'bugs'
   * })
   * console.log(card.id) // '7'
   * ```
   */
  async createCard(data: CreateCardInput): Promise<Card> {
    const mergedInput = await this._runBeforeEvent<CreateCardInput & Record<string, unknown>>('card.create', { ...data } as CreateCardInput & Record<string, unknown>, undefined, data.boardId)
    const card = await Cards.createCard(this, mergedInput)
    this._runAfterEvent('task.created', sanitizeCard(card), undefined, card.boardId)
    return card
  }

  /**
   * Updates an existing card's properties.
   *
   * Only the provided fields are updated; omitted fields remain unchanged.
   * The `filePath`, `id`, and `boardId` fields are protected and cannot be
   * overwritten. If the card's title changes, the underlying file is renamed.
   * If the status changes, the file is moved to the new status subdirectory
   * and `completedAt` is updated accordingly.
  *
  * Common update fields include `content`, `status`, `priority`, `assignee`,
  * `dueDate`, `labels`, `metadata`, `actions`, `forms`, and `formData`.
   *
   * @param cardId - The ID of the card to update.
   * @param updates - A partial {@link Card} object with the fields to update.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving to the updated {@link Card} card.
   * @throws {Error} If the card is not found.
   *
   * @example
   * ```ts
   * const updated = await sdk.updateCard('42', {
   *   priority: 'critical',
   *   assignee: 'alice',
   *   labels: ['urgent', 'backend']
   * })
   * ```
   */
  async updateCard(cardId: string, updates: Partial<Card>, boardId?: string): Promise<Card> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Cards.updateCard>>('card.update', { cardId, updates, boardId }, undefined, boardId)
    const card = await Cards.updateCard(this, mergedInput)
    this._runAfterEvent('task.updated', sanitizeCard(card), undefined, card.boardId)
    return card
  }

  /**
   * Validates and persists a form submission for a card, then emits `form.submit`
   * through the normal SDK event/webhook pipeline.
   *
   * The target form must already be attached to the card, either as an inline
   * card-local form or as a named reusable workspace form reference.
   *
   * **Partial-at-rest semantics:** `card.formData[formId]` may be a partial
   * record at rest (containing only previously submitted or pre-seeded fields).
   * The merge below always produces a full canonical object, and that full
   * object is what gets persisted and returned as `result.data`.
   *
   * Merge order for the resolved base payload (lowest → highest priority):
   * 1. Workspace-config form defaults (`KanbanConfig.forms[formName].data`)
   * 2. Card-scoped attachment defaults (`attachment.data`)
   * 3. Persisted per-card form data (`card.formData[formId]`, may be partial)
   * 4. Card metadata fields that are declared in the form schema
   * 5. The submitted payload passed to this method
   *
   * Before the merge, string values in each source layer are prepared via
   * `prepareFormData()` (from `src/shared/formDataPreparation`), which resolves
   * `${path}` placeholders against the full card interpolation context.
   *
   * Validation happens authoritatively in the SDK before persistence and before
   * any event/webhook emission, so CLI/API/MCP/UI callers all share the same rules.
  * After a successful submit, the SDK also appends a system card log entry that
  * records the submitted payload under `payload` for audit/debug visibility.
   *
   * @param input - The form submission input.
   * @param input.cardId - ID of the card that owns the target form.
   * @param input.formId - Resolved form ID/name to submit.
   * @param input.data - Submitted field values to merge over the resolved base payload.
   * @param input.boardId - Optional board ID. Defaults to the workspace default board.
   * @returns The canonical persisted payload and event context. `result.data` is
   *   always the full merged and validated object (never a partial snapshot).
   * @throws {Error} If the card or form cannot be found, or if validation fails.
   *
   * @example
   * ```ts
   * const result = await sdk.submitForm({
   *   cardId: '42',
   *   formId: 'bug-report',
   *   data: { severity: 'high', title: 'Crash on save' }
   * })
   * console.log(result.data.severity) // 'high'
   * ```
   */
  async submitForm(input: SubmitFormInput): Promise<SubmitFormResult> {
    const mergedInput = await this._runBeforeEvent<SubmitFormInput & Record<string, unknown>>('form.submit', { ...input } as SubmitFormInput & Record<string, unknown>, undefined, input.boardId)
    const result = await Cards.submitForm(this, mergedInput)
    this._runAfterEvent('form.submitted', result, undefined, result.boardId)
    return result
  }

  /**
   * Triggers a named action for a card.
   *
   * Validates the card, appends an activity log entry, and emits the
   * `card.action.triggered` after-event so registered webhooks receive
   * the action payload automatically.
   *
   * @param cardId - The ID of the card to trigger the action for.
   * @param action - The action name string (e.g. `'retry'`, `'sendEmail'`).
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise that resolves when the action has been processed.
   * @throws {Error} If the card is not found.
   *
   * @example
   * ```ts
   * await sdk.triggerAction('42', 'retry')
   * await sdk.triggerAction('42', 'sendEmail', 'bugs')
   * ```
   */
  async triggerAction(cardId: string, action: string, boardId?: string): Promise<void> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Cards.triggerAction>>('card.action.trigger', { cardId, action, boardId }, undefined, boardId)
    const payload = await Cards.triggerAction(this, mergedInput)
    this._runAfterEvent('card.action.triggered', payload, undefined, payload.board)
  }

  /**
   * Moves a card to a different status column and/or position within that column.
   *
   * The card's fractional order key is recalculated based on the target
   * position. If the status changes, the underlying file is moved to the
   * corresponding subdirectory and `completedAt` is updated accordingly.
   *
   * @param cardId - The ID of the card to move.
   * @param newStatus - The target status/column ID.
   * @param position - Optional zero-based index within the target column.
   *   Defaults to the end of the column.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving to the updated {@link Card} card.
   * @throws {Error} If the card is not found.
   *
   * @example
   * ```ts
   * // Move card to 'in-progress' at position 0 (top of column)
   * const card = await sdk.moveCard('42', 'in-progress', 0)
   *
   * // Move card to 'done' at the end (default)
   * const done = await sdk.moveCard('42', 'done')
   * ```
   */
  async moveCard(cardId: string, newStatus: string, position?: number, boardId?: string): Promise<Card> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Cards.moveCard>>('card.move', { cardId, newStatus, position, boardId }, undefined, boardId)
    const card = await Cards.moveCard(this, mergedInput)
    this._runAfterEvent('task.moved', sanitizeCard(card), undefined, card.boardId)
    return card
  }

  /**
   * Soft-deletes a card by moving it to the `deleted` status column.
   * The file remains on disk and can be restored.
   *
   * @param cardId - The ID of the card to soft-delete.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise that resolves when the card has been moved to deleted status.
   * @throws {Error} If the card is not found.
   *
   * @example
   * ```ts
   * await sdk.deleteCard('42', 'bugs')
   * ```
   */
  async deleteCard(cardId: string, boardId?: string): Promise<void> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Cards.deleteCard>>('card.delete', { cardId, boardId }, undefined, boardId)
    await Cards.deleteCard(this, mergedInput)
    const deleted = await this.getCard(mergedInput.cardId, mergedInput.boardId)
    if (deleted) this._runAfterEvent('task.deleted', sanitizeCard(deleted), undefined, deleted.boardId)
  }

  /**
   * Permanently deletes a card's markdown file from disk.
   * This cannot be undone.
   *
   * @param cardId - The ID of the card to permanently delete.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise that resolves when the card file has been removed from disk.
   * @throws {Error} If the card is not found.
   *
   * @example
   * ```ts
   * await sdk.permanentlyDeleteCard('42', 'bugs')
   * ```
   */
  async permanentlyDeleteCard(cardId: string, boardId?: string): Promise<void> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Cards.permanentlyDeleteCard>>('card.delete', { cardId, boardId }, undefined, boardId)
    const snapshot = await this.getCard(mergedInput.cardId, mergedInput.boardId)
    await Cards.permanentlyDeleteCard(this, mergedInput)
    if (snapshot) this._runAfterEvent('task.deleted', sanitizeCard(snapshot), undefined, snapshot.boardId)
  }

  /**
   * Returns all cards in a specific status column.
   *
   * This is a convenience wrapper around {@link listCards} that filters
   * by a single status value.
   *
   * @param status - The status/column ID to filter by (e.g., `'todo'`, `'in-progress'`).
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving to an array of {@link Card} cards in the given status.
   *
   * @example
   * ```ts
   * const inProgress = await sdk.getCardsByStatus('in-progress')
   * console.log(`${inProgress.length} cards in progress`)
   * ```
   */
  async getCardsByStatus(status: string, boardId?: string): Promise<Card[]> {
    return Cards.getCardsByStatus(this, { status, boardId })
  }

  /**
   * Returns a sorted list of unique assignee names across all cards on a board.
   *
   * Cards with no assignee are excluded from the result.
   *
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving to a sorted array of unique assignee name strings.
   *
   * @example
   * ```ts
   * const assignees = await sdk.getUniqueAssignees('bugs')
   * // ['alice', 'bob', 'charlie']
   * ```
   */
  async getUniqueAssignees(boardId?: string): Promise<string[]> {
    return Cards.getUniqueAssignees(this, { boardId })
  }

  /**
   * Returns a sorted list of unique labels across all cards on a board.
   *
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving to a sorted array of unique label strings.
   *
   * @example
   * ```ts
   * const labels = await sdk.getUniqueLabels()
   * // ['bug', 'enhancement', 'frontend', 'urgent']
   * ```
   */
  async getUniqueLabels(boardId?: string): Promise<string[]> {
    return Cards.getUniqueLabels(this, { boardId })
  }

  // --- Label definition management ---

  /**
   * Returns all label definitions from the workspace configuration.
   *
   * Label definitions map label names to their color and optional group.
   * Labels on cards that have no definition will render with default gray styling.
   *
   * @returns A record mapping label names to {@link LabelDefinition} objects.
   *
   * @example
   * ```ts
   * const labels = sdk.getLabels()
   * // { bug: { color: '#e11d48', group: 'Type' }, docs: { color: '#16a34a' } }
   * ```
   */
  getLabels(): Record<string, LabelDefinition> {
    return Labels.getLabels(this)
  }

  /**
   * Creates or updates a label definition in the workspace configuration.
   *
   * If the label already exists, its definition is replaced entirely.
   * The change is persisted to `.kanban.json` immediately.
   *
   * @param name - The label name (e.g. `'bug'`, `'frontend'`).
   * @param definition - The label definition with color and optional group.
   *
   * @example
   * ```ts
   * sdk.setLabel('bug', { color: '#e11d48', group: 'Type' })
   * sdk.setLabel('docs', { color: '#16a34a' })
   * ```
   */
  async setLabel(name: string, definition: LabelDefinition): Promise<void> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Labels.setLabel>>('label.set', { name, definition: { ...definition } })
    Labels.setLabel(this, mergedInput)
  }

  /**
   * Removes a label definition from the workspace configuration and cascades
   * the deletion to all cards by removing the label from their `labels` array.
   *
   * @param name - The label name to remove.
   *
   * @example
   * ```ts
   * await sdk.deleteLabel('bug')
   * ```
   */
  async deleteLabel(name: string): Promise<void> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Labels.deleteLabel>>('label.delete', { name })
    return Labels.deleteLabel(this, mergedInput)
  }

  /**
   * Renames a label in the configuration and cascades the change to all cards.
   *
   * Updates the label key in `.kanban.json` and replaces the old label name
   * with the new one on every card that uses it.
   *
   * @param oldName - The current label name.
   * @param newName - The new label name.
   *
   * @example
   * ```ts
   * await sdk.renameLabel('bug', 'defect')
   * // Config updated: 'defect' now has bug's color/group
   * // All cards with 'bug' label now have 'defect' instead
   * ```
   */
  async renameLabel(oldName: string, newName: string): Promise<void> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Labels.renameLabel>>('label.rename', { oldName, newName })
    return Labels.renameLabel(this, mergedInput)
  }

  /**
   * Returns a sorted list of label names that belong to the given group.
   *
   * Labels without an explicit `group` property are not matched by any
   * group name (they are considered ungrouped).
   *
   * @param group - The group name to filter by (e.g. `'Type'`, `'Priority'`).
   * @returns A sorted array of label names in the group.
   *
   * @example
   * ```ts
   * sdk.setLabel('bug', { color: '#e11d48', group: 'Type' })
   * sdk.setLabel('feature', { color: '#2563eb', group: 'Type' })
   *
   * sdk.getLabelsInGroup('Type')
   * // ['bug', 'feature']
   * ```
   */
  getLabelsInGroup(group: string): string[] {
    return Labels.getLabelsInGroup(this, { group })
  }

  /**
   * Returns all cards that have at least one label belonging to the given group.
   *
   * Looks up all labels in the group via {@link getLabelsInGroup}, then filters
   * cards to those containing any of those labels.
   *
   * @param group - The group name to filter by.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving to an array of matching {@link Card} cards.
   *
   * @example
   * ```ts
   * const typeCards = await sdk.filterCardsByLabelGroup('Type')
   * // Returns all cards with 'bug', 'feature', or any other 'Type' label
   * ```
   */
  async filterCardsByLabelGroup(group: string, boardId?: string): Promise<Card[]> {
    return Labels.filterCardsByLabelGroup(this, { group, boardId })
  }

  // --- Attachment management ---

  /**
   * Adds a file attachment to a card.
   *
   * The source file is copied into the card's directory (alongside its
   * markdown file) unless it already resides there. The attachment filename
   * is added to the card's `attachments` array if not already present.
   *
   * @param cardId - The ID of the card to attach the file to.
   * @param sourcePath - Path to the file to attach. Can be absolute or relative.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving to the updated {@link Card} card.
   * @throws {Error} If the card is not found.
   *
   * @example
   * ```ts
   * const card = await sdk.addAttachment('42', '/tmp/screenshot.png')
   * console.log(card.attachments) // ['screenshot.png']
   * ```
   */
  async addAttachment(cardId: string, sourcePath: string, boardId?: string): Promise<Card> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Attachments.addAttachment>>('attachment.add', { cardId, sourcePath, boardId }, undefined, boardId)
    const card = await Attachments.addAttachment(this, mergedInput)
    this._runAfterEvent('attachment.added', { cardId: mergedInput.cardId, attachment: path.basename(mergedInput.sourcePath) }, undefined, card.boardId ?? this._resolveBoardId(mergedInput.boardId))
    return card
  }

  /**
   * Removes an attachment reference from a card's metadata.
   *
   * This removes the attachment filename from the card's `attachments` array
   * but does not delete the physical file from disk.
   *
   * @param cardId - The ID of the card to remove the attachment from.
   * @param attachment - The attachment filename to remove (e.g., `'screenshot.png'`).
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving to the updated {@link Card} card.
   * @throws {Error} If the card is not found.
   *
   * @example
   * ```ts
   * const card = await sdk.removeAttachment('42', 'old-screenshot.png')
   * ```
   */
  async removeAttachment(cardId: string, attachment: string, boardId?: string): Promise<Card> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Attachments.removeAttachment>>('attachment.remove', { cardId, attachment, boardId }, undefined, boardId)
    const card = await Attachments.removeAttachment(this, mergedInput)
    this._runAfterEvent('attachment.removed', { cardId: mergedInput.cardId, attachment: mergedInput.attachment }, undefined, card.boardId ?? this._resolveBoardId(mergedInput.boardId))
    return card
  }

  /**
   * Lists all attachment filenames for a card.
   *
   * @param cardId - The ID of the card whose attachments to list.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving to an array of attachment filename strings.
   * @throws {Error} If the card is not found.
   *
   * @example
   * ```ts
   * const files = await sdk.listAttachments('42')
   * // ['screenshot.png', 'debug-log.txt']
   * ```
   */
  async listAttachments(cardId: string, boardId?: string): Promise<string[]> {
    return Attachments.listAttachments(this, { cardId, boardId })
  }

  /**
   * Returns the absolute path to the attachment directory for a card.
   *
    * For the default markdown/localfs path this is typically
    * `{column_dir}/attachments/`. Other providers may return a different local
    * directory or `null` when attachments are not directly browseable on disk.
   *
   * @param cardId - The ID of the card.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving to the absolute directory path, or `null` if the card is not found.
   *
   * @example
   * ```ts
   * const dir = await sdk.getAttachmentDir('42')
   * // '/workspace/.kanban/boards/default/backlog/attachments'
   * ```
   */
  async getAttachmentDir(cardId: string, boardId?: string): Promise<string | null> {
    return Attachments.getAttachmentDir(this, { cardId, boardId })
  }

  // --- Comment management ---

  /**
   * Lists all comments on a card.
   *
   * @param cardId - The ID of the card whose comments to list.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving to an array of {@link Comment} objects.
   * @throws {Error} If the card is not found.
   *
   * @example
   * ```ts
   * const comments = await sdk.listComments('42')
   * for (const c of comments) {
   *   console.log(`${c.author}: ${c.content}`)
   * }
   * ```
   */
  async listComments(cardId: string, boardId?: string): Promise<Comment[]> {
    return Comments.listComments(this, { cardId, boardId })
  }

  /**
   * Adds a comment to a card.
   *
   * The comment is assigned an auto-incrementing ID (e.g., `'c1'`, `'c2'`)
   * based on the existing comments. The card's `modified` timestamp is updated.
   *
   * @param cardId - The ID of the card to comment on.
   * @param author - The name of the comment author.
   * @param content - The comment text content.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving to the updated {@link Card} card (including the new comment).
   * @throws {Error} If the card is not found.
   *
   * @example
   * ```ts
   * const card = await sdk.addComment('42', 'alice', 'This needs more investigation.')
   * console.log(card.comments.length) // 1
   * ```
   */
  async addComment(cardId: string, author: string, content: string, boardId?: string): Promise<Card> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Comments.addComment>>('comment.create', { cardId, author, content, boardId }, undefined, boardId)
    const card = await Comments.addComment(this, mergedInput)
    const newComment = card.comments[card.comments.length - 1]
    if (newComment) this._runAfterEvent('comment.created', { ...newComment, cardId: mergedInput.cardId }, undefined, card.boardId ?? this._resolveBoardId(mergedInput.boardId))
    return card
  }

  /**
   * Updates the content of an existing comment on a card.
   *
   * @param cardId - The ID of the card containing the comment.
   * @param commentId - The ID of the comment to update (e.g., `'c1'`).
   * @param content - The new content for the comment.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving to the updated {@link Card} card.
   * @throws {Error} If the card is not found.
   * @throws {Error} If the comment is not found on the card.
   *
   * @example
   * ```ts
   * const card = await sdk.updateComment('42', 'c1', 'Updated: this is now resolved.')
   * ```
   */
  async updateComment(cardId: string, commentId: string, content: string, boardId?: string): Promise<Card> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Comments.updateComment>>('comment.update', { cardId, commentId, content, boardId }, undefined, boardId)
    const card = await Comments.updateComment(this, mergedInput)
    const updatedComment = card.comments?.find(c => c.id === mergedInput.commentId)
    if (updatedComment) this._runAfterEvent('comment.updated', { ...updatedComment, cardId: mergedInput.cardId }, undefined, card.boardId ?? this._resolveBoardId(mergedInput.boardId))
    return card
  }

  /**
   * Deletes a comment from a card.
   *
   * @param cardId - The ID of the card containing the comment.
   * @param commentId - The ID of the comment to delete (e.g., `'c1'`).
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving to the updated {@link Card} card.
   * @throws {Error} If the card is not found.
   *
   * @example
   * ```ts
   * const card = await sdk.deleteComment('42', 'c2')
   * ```
   */
  async deleteComment(cardId: string, commentId: string, boardId?: string): Promise<Card> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Comments.deleteComment>>('comment.delete', { cardId, commentId, boardId }, undefined, boardId)
    const cardBefore = await this.getCard(mergedInput.cardId, mergedInput.boardId)
    const deletedComment = cardBefore?.comments?.find(c => c.id === mergedInput.commentId)
    const card = await Comments.deleteComment(this, mergedInput)
    if (deletedComment) this._runAfterEvent('comment.deleted', { ...deletedComment, cardId: mergedInput.cardId }, undefined, card.boardId ?? this._resolveBoardId(mergedInput.boardId))
    return card
  }

  /**
   * Creates a comment on a card from a streaming text source, persisting it
   * once the stream is exhausted.
   *
   * This method is the streaming counterpart to {@link addComment}. It is
   * intended for use by AI agents that generate comment text incrementally
   * (e.g. an LLM `textStream`). The caller may supply `onStart` and `onChunk`
   * callbacks to fan live progress out to connected WebSocket viewers without
   * requiring intermediate disk writes.
   *
   * @param cardId - The ID of the card to comment on.
   * @param author - Display name of the streaming author.
   * @param stream - An `AsyncIterable<string>` that yields text chunks.
   * @param options.boardId - Optional board ID override.
   * @param options.onStart - Called once before iteration with the allocated
   *   comment ID, author, and ISO timestamp.
   * @param options.onChunk - Called after each chunk with the comment ID and
   *   the raw chunk string.
   * @returns A promise resolving to the updated {@link Card} once the stream
   *   has been fully consumed and the comment has been persisted.
   * @throws {Error} If the card is not found.
   * @throws {Error} If `author` is empty.
   *
   * @example
   * ```ts
   * // Stream an AI SDK textStream as a comment
   * const { textStream } = await streamText({ model, prompt })
   * const card = await sdk.streamComment('42', 'ai-agent', textStream, {
   *   onStart: (id, author, created) => broadcast({ type: 'commentStreamStart', cardId: '42', commentId: id, author, created }),
   *   onChunk: (id, chunk) => broadcast({ type: 'commentChunk', cardId: '42', commentId: id, chunk }),
   * })
   * ```
   */
  async streamComment(
    cardId: string,
    author: string,
    stream: AsyncIterable<string>,
    options?: {
      boardId?: string
      onStart?: (commentId: string, author: string, created: string) => void
      onChunk?: (commentId: string, chunk: string) => void
    }
  ): Promise<Card> {
    const { boardId, onStart, onChunk } = options ?? {}
    const card = await Comments.streamComment(this, { cardId, author, boardId, stream, onStart, onChunk })
    const newComment = card.comments?.[card.comments.length - 1]
    if (newComment) this._runAfterEvent('comment.created', { ...newComment, cardId }, undefined, card.boardId ?? this._resolveBoardId(boardId))
    return card
  }



  /**
   * Returns the absolute path to the log file for a card.
   *
    * The log file is stored as the card attachment `<cardId>.log` through the
    * active `attachment.storage` provider. File-backed providers usually return
    * a stable workspace path, while remote providers may return a materialized
    * temporary local file path instead.
   *
   * @param cardId - The ID of the card.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving to the log file path, or `null` if the card is not found.
   */
  async getLogFilePath(cardId: string, boardId?: string): Promise<string | null> {
    return Logs.getLogFilePath(this, { cardId, boardId })
  }

  /**
   * Lists all log entries for a card.
   *
   * Reads the card's `.log` file and parses each line into a {@link LogEntry}.
   * Returns an empty array if no log file exists.
   *
   * @param cardId - The ID of the card whose logs to list.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving to an array of {@link LogEntry} objects.
   * @throws {Error} If the card is not found.
   *
   * @example
   * ```ts
   * const logs = await sdk.listLogs('42')
   * for (const entry of logs) {
   *   console.log(`[${entry.source}] ${entry.text}`)
   * }
   * ```
   */
  async listLogs(cardId: string, boardId?: string): Promise<LogEntry[]> {
    return Logs.listLogs(this, { cardId, boardId })
  }

  /**
   * Adds a log entry to a card.
   *
    * Appends a new line to the card's `.log` attachment via the active
    * attachment-storage capability. Providers may handle this with a native
    * append hook when available, otherwise the SDK falls back to a safe
    * read/modify/write cycle. If the file does not exist, it is created and
    * automatically added to the card's attachments array.
   * The timestamp defaults to the current time if not provided.
   * The source defaults to `'default'` if not provided.
   *
   * @param cardId - The ID of the card to add the log to.
   * @param text - The log message text. Supports inline markdown.
   * @param options - Optional log entry parameters.
   * @param options.source - Source/origin label. Defaults to `'default'`.
   * @param options.timestamp - ISO 8601 timestamp. Defaults to current time.
   * @param options.object - Optional structured data to attach as JSON.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving to the created {@link LogEntry}.
   * @throws {Error} If the card is not found.
   *
   * @example
   * ```ts
   * const entry = await sdk.addLog('42', 'Build started')
   * const entry2 = await sdk.addLog('42', 'Deploy complete', {
   *   source: 'ci',
   *   object: { version: '1.2.3', duration: 42 }
   * })
   * ```
   */
  async addLog(
    cardId: string,
    text: string,
    options?: { source?: string; timestamp?: string; object?: Record<string, unknown> },
    boardId?: string,
  ): Promise<LogEntry> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Logs.addLog>>('log.add', { cardId, text, boardId, options }, undefined, boardId)
    const entry = await Logs.addLog(this, mergedInput)
    this._runAfterEvent('log.added', { cardId: mergedInput.cardId, entry }, undefined, this._resolveBoardId(mergedInput.boardId))
    return entry
  }

  /**
   * Clears all log entries for a card by deleting the `.log` file.
   *
    * The log attachment reference is removed from the card's attachments array.
    * When a local/materialized file exists, it is deleted best-effort as well.
    * New log entries recreate the log attachment automatically.
   *
   * @param cardId - The ID of the card whose logs to clear.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise that resolves when the logs have been cleared.
   * @throws {Error} If the card is not found.
   *
   * @example
   * ```ts
   * await sdk.clearLogs('42')
   * ```
   */
  async clearLogs(cardId: string, boardId?: string): Promise<void> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Logs.clearLogs>>('log.clear', { cardId, boardId }, undefined, boardId)
    await Logs.clearLogs(this, mergedInput)
    this._runAfterEvent('log.cleared', { cardId: mergedInput.cardId }, undefined, this._resolveBoardId(mergedInput.boardId))
  }

  // --- Board-level log management ---

  /**
   * Returns the absolute path to the board-level log file for a given board.
   *
   * The board log file is located at `.kanban/boards/<boardId>/board.log`,
   * at the same level as the column folders.
   *
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns The absolute path to `board.log` for the specified board.
   *
   * @example
   * ```ts
   * const logPath = sdk.getBoardLogFilePath()
   * // '/workspace/.kanban/boards/default/board.log'
   * ```
   */
  getBoardLogFilePath(boardId?: string): string {
    return Logs.getBoardLogFilePath(this, { boardId })
  }

  /**
   * Lists all log entries from the board-level log file.
   *
   * Returns an empty array if the log file does not exist yet.
   *
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise that resolves to an array of {@link LogEntry} objects, oldest first.
   *
   * @example
   * ```ts
   * const logs = await sdk.listBoardLogs()
   * // [{ timestamp: '2024-01-01T00:00:00.000Z', source: 'api', text: 'Card created' }]
   * ```
   */
  async listBoardLogs(boardId?: string): Promise<LogEntry[]> {
    return Logs.listBoardLogs(this, { boardId })
  }

  /**
   * Appends a new log entry to the board-level log file.
   *
   * Creates the log file if it does not yet exist.
   *
   * @param text - The human-readable log message.
   * @param options - Optional entry metadata: source label, ISO timestamp override, and structured object.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise that resolves to the created {@link LogEntry}.
   *
   * @example
   * ```ts
   * const entry = await sdk.addBoardLog('Board archived', { source: 'cli' })
   * ```
   */
  async addBoardLog(
    text: string,
    options?: { source?: string; timestamp?: string; object?: Record<string, unknown> },
    boardId?: string,
  ): Promise<LogEntry> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Logs.addBoardLog>>('board.log.add', { text, boardId, options }, undefined, boardId)
    const entry = await Logs.addBoardLog(this, mergedInput)
    this._runAfterEvent('board.log.added', { boardId: this._resolveBoardId(mergedInput.boardId), entry }, undefined, this._resolveBoardId(mergedInput.boardId))
    return entry
  }

  /**
   * Clears all log entries for a board by deleting the board-level `board.log` file.
   *
   * New log entries will recreate the file automatically.
   * No error is thrown if the file does not exist.
   *
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise that resolves when the logs have been cleared.
   *
   * @example
   * ```ts
   * await sdk.clearBoardLogs()
   * ```
   */
  async clearBoardLogs(boardId?: string): Promise<void> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Logs.clearBoardLogs>>('board.log.clear', { boardId }, undefined, boardId)
    await Logs.clearBoardLogs(this, mergedInput)
    this._runAfterEvent('board.log.cleared', { boardId: this._resolveBoardId(mergedInput.boardId as string | undefined) }, undefined, this._resolveBoardId(mergedInput.boardId as string | undefined))
  }

  // --- Column management (board-scoped) ---

  /**
   * Lists all columns defined for a board.
   *
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns An array of {@link KanbanColumn} objects in their current order.
   *
   * @example
   * ```ts
   * const columns = sdk.listColumns('bugs')
   * // [{ id: 'triage', name: 'Triage', color: '#ef4444' }, ...]
   * ```
   */
  listColumns(boardId?: string): KanbanColumn[] {
    return Columns.listColumns(this, { boardId })
  }

  /**
   * Adds a new column to a board.
   *
   * The column is appended to the end of the board's column list.
   *
   * @param column - The column definition to add.
   * @param column.id - Unique identifier for the column (used as status values on cards).
   * @param column.name - Human-readable display name.
   * @param column.color - CSS color string for the column header.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns The full updated array of {@link KanbanColumn} objects for the board.
   * @throws {Error} If the board is not found.
   * @throws {Error} If a column with the same ID already exists.
   * @throws {Error} If the column ID is `'deleted'` (reserved for soft-delete).
   *
   * @example
   * ```ts
   * const columns = sdk.addColumn(
   *   { id: 'blocked', name: 'Blocked', color: '#ef4444' },
   *   'default'
   * )
   * ```
   */
  async addColumn(column: KanbanColumn, boardId?: string): Promise<KanbanColumn[]> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Columns.addColumn>>('column.create', { column, boardId }, undefined, boardId)
    const columns = Columns.addColumn(this, mergedInput)
    const added = columns.find(c => c.id === mergedInput.column.id) ?? columns[columns.length - 1]
    if (added) this._runAfterEvent('column.created', added, undefined, this._resolveBoardId(mergedInput.boardId))
    return columns
  }

  /**
   * Updates the properties of an existing column.
   *
   * Only the provided fields (`name`, `color`) are updated; the column's
   * `id` cannot be changed.
   *
   * @param columnId - The ID of the column to update.
   * @param updates - A partial object with the fields to update.
   * @param updates.name - New display name for the column.
   * @param updates.color - New CSS color string for the column.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns The full updated array of {@link KanbanColumn} objects for the board.
   * @throws {Error} If the board is not found.
   * @throws {Error} If the column is not found.
   *
   * @example
   * ```ts
   * const columns = sdk.updateColumn('in-progress', {
   *   name: 'Working On',
   *   color: '#f97316'
   * })
   * ```
   */
  async updateColumn(columnId: string, updates: Partial<Omit<KanbanColumn, 'id'>>, boardId?: string): Promise<KanbanColumn[]> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Columns.updateColumn>>('column.update', { columnId, updates, boardId }, undefined, boardId)
    const columns = Columns.updateColumn(this, mergedInput)
    const updated = columns.find(c => c.id === mergedInput.columnId)
    if (updated) this._runAfterEvent('column.updated', updated, undefined, this._resolveBoardId(mergedInput.boardId))
    return columns
  }

  /**
   * Removes a column from a board.
   *
   * The column must be empty (no cards currently assigned to it).
   * This operation cannot be undone.
   *
   * @param columnId - The ID of the column to remove.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving to the updated array of {@link KanbanColumn} objects.
   * @throws {Error} If the board is not found.
   * @throws {Error} If the column is not found.
   * @throws {Error} If the column still contains cards.
   * @throws {Error} If the column ID is `'deleted'` (reserved for soft-delete).
   *
   * @example
   * ```ts
   * const columns = await sdk.removeColumn('blocked', 'default')
   * ```
   */
  async removeColumn(columnId: string, boardId?: string): Promise<KanbanColumn[]> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Columns.removeColumn>>('column.delete', { columnId, boardId }, undefined, boardId)
    const colSnapshot = Columns.listColumns(this, { boardId: mergedInput.boardId }).find(c => c.id === mergedInput.columnId)
    const columns = await Columns.removeColumn(this, mergedInput)
    if (colSnapshot) this._runAfterEvent('column.deleted', colSnapshot, undefined, this._resolveBoardId(mergedInput.boardId))
    return columns
  }

  /**
   * Moves all cards in the specified column to the `deleted` (soft-delete) column.
   *
   * This is a non-destructive operation — cards are moved to the reserved
   * `deleted` status and can be restored or permanently deleted later.
   * The column itself is not removed.
   *
   * @param columnId - The ID of the column whose cards should be moved to `deleted`.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving to the number of cards that were moved.
   * @throws {Error} If the column is `'deleted'` (no-op protection).
   *
   * @example
   * ```ts
   * const moved = await sdk.cleanupColumn('blocked')
   * console.log(`Moved ${moved} cards to deleted`)
   * ```
   */
  async cleanupColumn(columnId: string, boardId?: string): Promise<number> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Columns.cleanupColumn>>('column.cleanup', { columnId, boardId }, undefined, boardId)
    return Columns.cleanupColumn(this, mergedInput)
  }

  /**
   * Permanently deletes all cards currently in the `deleted` column.
   *
   * This is equivalent to "empty trash". All soft-deleted cards are
   * removed from disk. This operation cannot be undone.
   *
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving to the number of cards that were permanently deleted.
   *
   * @example
   * ```ts
   * const count = await sdk.purgeDeletedCards()
   * console.log(`Permanently deleted ${count} cards`)
   * ```
   */
  async purgeDeletedCards(boardId?: string): Promise<number> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Columns.purgeDeletedCards>>('card.purgeDeleted', { boardId }, undefined, boardId)
    return Columns.purgeDeletedCards(this, mergedInput)
  }

  /**
   * Reorders the columns of a board.
   *
   * The `columnIds` array must contain every existing column ID exactly once,
   * in the desired new order.
   *
   * @param columnIds - An array of all column IDs in the desired order.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns The reordered array of {@link KanbanColumn} objects.
   * @throws {Error} If the board is not found.
   * @throws {Error} If any column ID in the array does not exist.
   * @throws {Error} If the array does not include all column IDs.
   *
   * @example
   * ```ts
   * const columns = sdk.reorderColumns(
   *   ['backlog', 'todo', 'blocked', 'in-progress', 'review', 'done'],
   *   'default'
   * )
   * ```
   */
  async reorderColumns(columnIds: string[], boardId?: string): Promise<KanbanColumn[]> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Columns.reorderColumns>>('column.reorder', { columnIds, boardId }, undefined, boardId)
    return Columns.reorderColumns(this, mergedInput)
  }

  /**
   * Returns the minimized column IDs for a board.
   *
   * @param boardId - Board to query (uses default board if omitted).
   * @returns Array of column IDs currently marked as minimized.
   */
  getMinimizedColumns(boardId?: string): string[] {
    return Columns.getMinimizedColumns(this, { boardId })
  }

  /**
   * Sets the minimized column IDs for a board, persisting the state to the
   * workspace config file. Stale or invalid IDs are silently dropped.
   *
   * @param columnIds - Column IDs to mark as minimized.
   * @param boardId - Board to update (uses default board if omitted).
   * @returns The sanitized list of minimized column IDs that was saved.
   */
  async setMinimizedColumns(columnIds: string[], boardId?: string): Promise<string[]> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Columns.setMinimizedColumns>>('column.setMinimized', { columnIds, boardId }, undefined, boardId)
    return Columns.setMinimizedColumns(this, mergedInput)
  }

  // --- Settings management (global) ---

  /**
   * Returns the global card display settings for the workspace.
   *
   * Display settings control which fields are shown on card previews
   * (e.g., priority badges, assignee avatars, due dates, labels).
   *
   * @returns The current {@link CardDisplaySettings} object.
   *
   * @example
   * ```ts
   * const settings = sdk.getSettings()
   * console.log(settings.showPriority) // true
   * ```
   */
  getSettings(): CardDisplaySettings {
    return Settings.getSettings(this)
  }

  /**
   * Updates the global card display settings for the workspace.
   *
   * The provided settings object fully replaces the display settings
   * in the workspace configuration file (`.kanban.json`).
   *
   * @param settings - The new {@link CardDisplaySettings} to apply.
   *
   * @example
   * ```ts
   * sdk.updateSettings({
   *   showPriority: true,
   *   showAssignee: true,
   *   showDueDate: false,
   *   showLabels: true
   * })
   * ```
   */
  async updateSettings(settings: CardDisplaySettings): Promise<void> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Settings.updateSettings>>('settings.update', { settings })
    Settings.updateSettings(this, mergedInput)
    this._runAfterEvent('settings.updated', mergedInput.settings)
  }

  // ---------------------------------------------------------------------------
  // Storage migration
  // ---------------------------------------------------------------------------

  /**
   * Migrates all card data from the current storage engine to SQLite.
   *
   * Cards are scanned from every board using the active engine, then written
    * through the configured `sqlite` compatibility provider. After all data has
    * been copied the workspace `.kanban.json` is updated with
    * `storageEngine: 'sqlite'` and `sqlitePath` so that subsequent SDK instances
    * resolve the same compatibility provider.
   *
   * The existing markdown files are **not** deleted; they serve as a manual
   * backup until the caller explicitly removes them.
   *
   * @param dbPath - Path to the SQLite database file. Relative paths are
   *   resolved from the workspace root. Defaults to `'.kanban/kanban.db'`.
   * @returns The total number of cards migrated.
   * @throws {Error} If the current engine is already `'sqlite'`.
   *
   * @example
   * ```ts
   * const count = await sdk.migrateToSqlite()
   * console.log(`Migrated ${count} cards to SQLite`)
   * ```
   */
  async migrateToSqlite(dbPath?: string): Promise<number> {
    const from = this._capabilities?.providers['card.storage'].provider ?? this._storage.type
    const mergedInput = await this._runBeforeEvent<{ to: string; from: string; dbPath?: string }>('storage.migrate', { to: 'sqlite', from, dbPath })
    const count = await Migration.migrateToSqlite(this, { dbPath: mergedInput.dbPath })
    this._runAfterEvent('storage.migrated', { from, to: 'sqlite', count })
    return count
  }

  /**
    * Migrates all card data from the current `sqlite` compatibility provider back
    * to markdown files.
   *
   * Cards are scanned from every board in the SQLite database and written as
   * individual `.md` files under `.kanban/boards/<boardId>/<status>/`. After
   * migration the workspace `.kanban.json` is updated to remove the
   * `storageEngine`/`sqlitePath` overrides so the default markdown engine is
   * used by subsequent SDK instances.
   *
   * The SQLite database file is **not** deleted; it serves as a manual backup.
   *
   * @returns The total number of cards migrated.
   * @throws {Error} If the current engine is already `'markdown'`.
   *
   * @example
   * ```ts
   * const count = await sdk.migrateToMarkdown()
   * console.log(`Migrated ${count} cards to markdown`)
   * ```
   */
  async migrateToMarkdown(): Promise<number> {
    const from = this._capabilities?.providers['card.storage'].provider ?? this._storage.type
    await this._runBeforeEvent<{ to: string; from: string }>('storage.migrate', { to: 'markdown', from })
    const count = await Migration.migrateToMarkdown(this)
    this._runAfterEvent('storage.migrated', { from, to: 'markdown', count })
    return count
  }

  /**
   * Sets the default board for the workspace.
   *
   * @param boardId - The ID of the board to set as the default.
   * @throws {Error} If the board does not exist.
   *
   * @example
   * ```ts
   * sdk.setDefaultBoard('sprint-2')
   * ```
   */
  async setDefaultBoard(boardId: string): Promise<void> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Settings.setDefaultBoard>>('board.setDefault', { boardId }, undefined, boardId)
    Settings.setDefaultBoard(this, mergedInput)
  }

  /**
   * Lists all registered webhooks.
   *
   * Delegates to the resolved `kl-plugin-webhook` provider.
   * Throws if no `webhook.delivery` provider is installed.
   *
   * @returns Array of {@link Webhook} objects.
   * @throws {Error} When `kl-plugin-webhook` is not installed.
   */
  listWebhooks(): Webhook[] {
    if (this._capabilities?.webhookProvider) {
      return this._capabilities.webhookProvider.listWebhooks(this.workspaceRoot)
    }
    throw new Error('Webhook commands require kl-plugin-webhook. Run: npm install kl-plugin-webhook')
  }

  /**
   * Creates and persists a new webhook.
   *
   * Delegates to the resolved `kl-plugin-webhook` provider.
   * Throws if no `webhook.delivery` provider is installed.
   *
   * @param webhookConfig - The webhook configuration.
   * @returns The newly created {@link Webhook}.
   * @throws {Error} When `kl-plugin-webhook` is not installed.
   */
  async createWebhook(webhookConfig: { url: string; events: string[]; secret?: string }): Promise<Webhook> {
    if (!this._capabilities?.webhookProvider) {
      throw new Error('Webhook commands require kl-plugin-webhook. Run: npm install kl-plugin-webhook')
    }
    const mergedInput = await this._runBeforeEvent<{ url: string; events: string[]; secret?: string }>('webhook.create', { ...webhookConfig })
    return this._capabilities.webhookProvider.createWebhook(this.workspaceRoot, mergedInput)
  }

  /**
   * Deletes a webhook by its ID.
   *
   * Delegates to the resolved `kl-plugin-webhook` provider.
   * Throws if no `webhook.delivery` provider is installed.
   *
   * @param id - The webhook ID to delete.
   * @returns `true` if deleted, `false` if not found.
   * @throws {Error} When `kl-plugin-webhook` is not installed.
   */
  async deleteWebhook(id: string): Promise<boolean> {
    if (!this._capabilities?.webhookProvider) {
      throw new Error('Webhook commands require kl-plugin-webhook. Run: npm install kl-plugin-webhook')
    }
    const mergedInput = await this._runBeforeEvent<{ id: string }>('webhook.delete', { id })
    return this._capabilities.webhookProvider.deleteWebhook(this.workspaceRoot, mergedInput.id)
  }

  /**
   * Updates an existing webhook's configuration.
   *
   * Delegates to the resolved `kl-plugin-webhook` provider.
   * Throws if no `webhook.delivery` provider is installed.
   *
   * @param id - The webhook ID to update.
   * @param updates - Partial webhook fields to merge.
   * @returns The updated {@link Webhook}, or `null` if not found.
   * @throws {Error} When `kl-plugin-webhook` is not installed.
   */
  async updateWebhook(id: string, updates: Partial<Pick<Webhook, 'url' | 'events' | 'secret' | 'active'>>): Promise<Webhook | null> {
    if (!this._capabilities?.webhookProvider) {
      throw new Error('Webhook commands require kl-plugin-webhook. Run: npm install kl-plugin-webhook')
    }
    const mergedInput = await this._runBeforeEvent<{ id: string; url?: string; events?: string[]; secret?: string; active?: boolean }>('webhook.update', { id, ...updates })
    const { id: resolvedId, ...resolvedUpdates } = mergedInput
    return this._capabilities.webhookProvider.updateWebhook(this.workspaceRoot, resolvedId, resolvedUpdates)
  }

}
