import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'path'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { Card } from '../shared/types'
import { DEFAULT_CONFIG, readConfig, normalizeStorageCapabilities, normalizeAuthCapabilities, normalizeWebhookCapabilities, normalizeCardStateCapabilities, normalizeCallbackCapabilities, normalizeCronCapabilities, normalizeConfigStorageSelection } from '../shared/config'
import type { KanbanConfig, ProviderRef, ResolvedCapabilities, ResolvedCronCapabilities, ConfigStorageFailure } from '../shared/config'
import type { SDKEvent, SDKEventType, SDKOptions, AuthContext, SDKEventHandler, SDKEventListenerPlugin, BeforeEventPayload, AfterEventPayload, SDKBeforeEventType, SDKAfterEventType } from './types'
import type { EventBusAnyListener, EventBusWaitOptions } from './eventBus'
import { EventBus } from './eventBus'
import { withDurableCallbackDispatchMeta } from './callbacks/contract'
import type { StorageEngine } from './plugins/types'
import { resolveKanbanDir } from './fileUtils'
import {
  createBuiltinAuthListenerPlugin,
  resolveCapabilityBag,
  resolveConfigStorageProviderForRepository,
} from './plugins'
import type { ResolvedCapabilityBag } from './plugins'
import { getRuntimeHost, loadWorkspaceEnv } from '../shared/env'
import {
  ConfigRepositoryProviderError,
  readConfigRepositoryDocument,
  readSeedConfigRepositoryDocument,
} from './modules/configRepository'
import type { ConfigRepositoryReadResult } from './modules/configRepository'
import { getConfigRepositoryDocumentId } from './configDocumentIdentity'
import { runPluginSettingsInstallCommand } from './plugin-settings'
import type { ConfigStorageResolutionInput, ReadonlySnapshot } from './KanbanSDK-types'
import { _isPlainObject } from './KanbanSDK-types'

/** @internal */
type CallbackRuntimeContextAwareListener = SDKEventListenerPlugin & {
  attachRuntimeContext?: (context: object) => void
}

function cloneProviderRef(ref: ProviderRef): ProviderRef {
  return ref.options !== undefined
    ? { provider: ref.provider, options: { ...ref.options } }
    : { provider: ref.provider }
}

function readBootstrapConfig(kanbanDir: string): KanbanConfig {
  try {
    return readConfig(path.dirname(kanbanDir), { allowSeedFallbackOnProviderError: true })
  } catch {
    return structuredClone(DEFAULT_CONFIG) as KanbanConfig
  }
}

function resolveConfiguredCapabilitiesFrom(config: KanbanConfig, options?: SDKOptions): ResolvedCapabilities {
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

/**
 * Base SDK class: constructor, event bus, static auth helpers, lifecycle
 * primitives, board resolution helpers, and attachment low-level I/O.
 *
 * All public SDK surface lives in the subclass chain below.
 * @internal
 */
export class KanbanSDKCore {
  protected _migrated = false
  protected _onEvent?: SDKEventHandler
  protected readonly _eventBus: EventBus
  protected _webhookPlugin: SDKEventListenerPlugin | null = null
  protected _callbackPlugin: SDKEventListenerPlugin | null = null
  protected _cronPlugin: SDKEventListenerPlugin | null = null
  protected _pluginInstallRunner = runPluginSettingsInstallCommand
  /** @internal */ _storage: StorageEngine
  protected _capabilities: ResolvedCapabilityBag | null = null
  /** @internal Async-scoped auth carrier. */
  protected static readonly _authStorage = new AsyncLocalStorage<AuthContext>()

  /** @internal */
  protected static _runWithScopedAuth<T>(auth: AuthContext, fn: () => Promise<T>): Promise<T> {
    return KanbanSDKCore._authStorage.run(auth, fn)
  }

  /** @internal */
  protected static _getScopedAuth(): AuthContext | undefined {
    return KanbanSDKCore._authStorage.getStore()
  }

  /** @internal */
  protected static _cloneMergeValue(value: unknown): unknown {
    if (Array.isArray(value) || _isPlainObject(value)) {
      return structuredClone(value)
    }
    return value
  }

  /** @internal */
  protected static _deepMerge<T extends Record<string, unknown>>(
    target: T,
    source: Record<string, unknown>,
  ): T {
    const result: Record<string, unknown> = { ...target }
    for (const key of Object.keys(source)) {
      const tv = target[key]
      const sv = source[key]
      result[key] =
        _isPlainObject(sv) && _isPlainObject(tv)
          ? KanbanSDKCore._deepMerge(tv as Record<string, unknown>, sv)
          : KanbanSDKCore._cloneMergeValue(sv)
    }
    return result as T
  }

  /** Absolute path to the `.kanban` kanban directory. */
  public readonly kanbanDir: string

  constructor(kanbanDir?: string, options?: SDKOptions) {
    if (options?.remoteUrl) {
      throw new Error(
        'Use RemoteKanbanSDK({ remoteUrl, token }) instead of KanbanSDK when connecting to a remote API.',
      )
    }
    this.kanbanDir = kanbanDir ?? resolveKanbanDir()
    loadWorkspaceEnv(path.dirname(this.kanbanDir))
    this._onEvent = options?.onEvent
    this._pluginInstallRunner = options?.pluginInstallRunner ?? runPluginSettingsInstallCommand

    this._eventBus = new EventBus()

    if (this._onEvent) {
      this._eventBus.onAny((event, payload) => {
        this._onEvent!(event as SDKEventType, (payload as SDKEvent).data)
      })
    }

    if (options?.storage) {
      this._storage = options.storage
      this._capabilities = null
      return
    }

    const bootstrapConfig = readBootstrapConfig(this.kanbanDir)
    const capabilityBag = resolveCapabilityBag(
      resolveConfiguredCapabilitiesFrom(bootstrapConfig, options),
      this.kanbanDir,
      normalizeAuthCapabilities(bootstrapConfig),
      normalizeWebhookCapabilities(bootstrapConfig),
      normalizeCardStateCapabilities(bootstrapConfig),
      normalizeCallbackCapabilities(bootstrapConfig),
      normalizeCronCapabilities(bootstrapConfig),
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
      this._webhookPlugin = webhookListener
      this._webhookPlugin.register(this._eventBus)
    }

    const callbackListener = this._capabilities.callbackListener
    if (callbackListener) {
      this._callbackPlugin = callbackListener
      ;(this._callbackPlugin as CallbackRuntimeContextAwareListener).attachRuntimeContext?.({
        workspaceRoot: this.workspaceRoot,
        sdk: this,
      })
      this._callbackPlugin.register(this._eventBus)
    }

    const cronListener = this._capabilities.cronListener
    if (cronListener) {
      this._cronPlugin = cronListener
      this._cronPlugin.register(this._eventBus)
    }

    this._capabilities.authListener.register(this._eventBus)
  }

  // --- Event bus ---

  on(event: string, listener: (payload: SDKEvent) => void): () => void { return this._eventBus.on(event, listener) }
  once(event: string, listener: (payload: SDKEvent) => void): () => void { return this._eventBus.once(event, listener) }
  many(event: string, timesToListen: number, listener: (payload: SDKEvent) => void): () => void { return this._eventBus.many(event, timesToListen, listener) }
  onAny(listener: EventBusAnyListener): () => void { return this._eventBus.onAny(listener) }
  off(event: string, listener: (payload: SDKEvent) => void): void { this._eventBus.off(event, listener) }
  offAny(listener: EventBusAnyListener): void { this._eventBus.offAny(listener) }
  removeAllListeners(event?: string): void { this._eventBus.removeAllListeners(event) }
  eventNames(): string[] { return this._eventBus.eventNames() }
  listenerCount(event?: string): number { return this._eventBus.listenerCount(event) }
  hasListeners(event: string): boolean { return this._eventBus.hasListeners(event) }
  async waitFor(event: string, options?: EventBusWaitOptions): Promise<SDKEvent> { return this._eventBus.waitFor(event, options) }

  get eventBus(): EventBus { return this._eventBus }
  get storageEngine(): StorageEngine { return this._storage }
  get capabilities(): ResolvedCapabilityBag | null { return this._capabilities }

  // --- Auth context ---

  /** Returns the auth context installed by the nearest enclosing runWithAuth call, if any. @internal */
  get _currentAuthContext(): AuthContext | undefined {
    return KanbanSDKCore._getScopedAuth()
  }

  /** @internal */
  protected _resolveEventActor(actor?: string): string | undefined {
    return actor ?? this._currentAuthContext?.actorHint
  }

  // --- Before/after event helpers ---

  /** @internal */
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
      (acc, override) => KanbanSDKCore._deepMerge(acc, override) as TInput,
      baseInput,
    )
  }

  /** @internal */
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
      meta: withDurableCallbackDispatchMeta(meta),
    }
    this._eventBus.emit(event, {
      type: event,
      data: afterPayload,
      timestamp: afterPayload.timestamp,
      actor: resolvedActor,
      boardId,
    })
  }

  // --- Lifecycle ---

  close(): void {
    this._storage.close()
    this._webhookPlugin?.unregister()
    this._callbackPlugin?.unregister()
    this._cronPlugin?.unregister()
    this._capabilities?.authListener.unregister()
    this._eventBus.destroy()
  }

  destroy(): void { this.close() }

  /** @internal */
  emitEvent(event: SDKEventType, data: unknown): void {
    this._eventBus.emit(event, {
      type: event,
      data,
      timestamp: new Date().toISOString(),
    })
  }

  get workspaceRoot(): string { return path.dirname(this.kanbanDir) }

  // --- Config/board helpers ---

  getConfigSnapshot(): ReadonlySnapshot<KanbanConfig> {
    return structuredClone(readConfig(this.workspaceRoot)) as ReadonlySnapshot<KanbanConfig>
  }

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

  // --- Config storage private helpers ---

  /** @internal */
  protected _getRuntimeConfigStorageInput(snapshotResult: ConfigRepositoryReadResult): ConfigStorageResolutionInput {
    const resolvedSnapshotResult = snapshotResult.status === 'error'
      ? readSeedConfigRepositoryDocument(
          this.workspaceRoot,
          path.join(this.workspaceRoot, '.kanban.json'),
        )
      : snapshotResult
    const snapshot = resolvedSnapshotResult.status === 'ok'
      ? structuredClone(resolvedSnapshotResult.value) as ConfigStorageResolutionInput
      : {} as ConfigStorageResolutionInput
    if (snapshot.plugins?.['config.storage']) return snapshot

    const runtimeCardProvider = this._capabilities?.providers['card.storage']
      ? structuredClone(this._capabilities.providers['card.storage'])
      : { provider: this._storage.type }

    return {
      storageEngine: snapshot.storageEngine,
      sqlitePath: snapshot.sqlitePath,
      plugins: {
        ...(snapshot.plugins ?? {}),
        'card.storage': runtimeCardProvider,
      },
    }
  }

  /** @internal */
  protected _getConfigStorageFailureFromRepositoryResult(
    configured: ProviderRef,
    repositoryResult: ConfigRepositoryReadResult,
  ): ConfigStorageFailure | null {
    if (repositoryResult.status !== 'error') return null
    const repositoryError = repositoryResult.cause
    if (!(repositoryError instanceof ConfigRepositoryProviderError)) return null
    if (repositoryError.providerId !== configured.provider) return null
    return {
      code: 'config-storage-provider-unavailable',
      message: repositoryError.message,
    }
  }

  /** @internal */
  protected _resolveConfigStorageFailure(
    input: ConfigStorageResolutionInput,
    repositoryResult?: ConfigRepositoryReadResult,
  ): ConfigStorageFailure | null {
    const runtimeHostFailure = getRuntimeHost()?.getConfigStorageFailure?.(
      this.workspaceRoot,
      structuredClone(input) as ConfigStorageResolutionInput,
    )
    if (runtimeHostFailure !== undefined) {
      return runtimeHostFailure ? structuredClone(runtimeHostFailure) as ConfigStorageFailure : null
    }

    const configured = normalizeConfigStorageSelection(input).configured
    if (!configured || configured.provider === 'localfs') return null

    try {
      resolveConfigStorageProviderForRepository(
        configured,
        this.workspaceRoot,
        getConfigRepositoryDocumentId(),
      )
    } catch {
      return {
        code: 'config-storage-provider-unavailable',
        message: `Configured config.storage provider '${configured.provider}' is unavailable in this runtime.`,
      }
    }

    const resolvedRepositoryResult = repositoryResult ?? readConfigRepositoryDocument(this.workspaceRoot)
    return this._getConfigStorageFailureFromRepositoryResult(configured, resolvedRepositoryResult)
  }

  // --- Attachment low-level I/O ---

  getLocalCardPath(card: Card): string | null {
    return this._capabilities?.getLocalCardPath(card) ?? (card.filePath || null)
  }

  getAttachmentStoragePath(card: Card): string | null {
    if (this._capabilities) return this._capabilities.getAttachmentDir(card)
    try { return this._storage.getCardDir(card) } catch { return null }
  }

  async appendAttachment(card: Card, attachment: string, content: string | Uint8Array): Promise<boolean> {
    const appendHandler = this._capabilities?.attachmentStorage.appendAttachment
    if (!appendHandler) return false
    return appendHandler(card, attachment, content)
  }

  async readAttachment(card: Card, attachment: string): Promise<{ data: Uint8Array; contentType?: string } | null> {
    const readHandler = this._capabilities?.attachmentStorage.readAttachment
    if (readHandler) return readHandler(card, attachment)
    const materializedPath = await this.materializeAttachment(card, attachment)
    if (!materializedPath) return null
    try { return { data: await fs.readFile(materializedPath) } } catch { return null }
  }

  async writeAttachment(card: Card, attachment: string, content: string | Uint8Array): Promise<void> {
    const writeHandler = this._capabilities?.attachmentStorage.writeAttachment
    if (writeHandler) { await writeHandler(card, attachment, content); return }
    const safeAttachment = path.basename(attachment)
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kanban-attachment-'))
    const tempPath = path.join(tempDir, safeAttachment)
    try {
      await fs.writeFile(tempPath, content)
      await this.copyAttachment(tempPath, card)
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  }

  async materializeAttachment(card: Card, attachment: string): Promise<string | null> {
    if (this._capabilities) return this._capabilities.materializeAttachment(card, attachment)
    const normalized = attachment.replace(/\\/g, '/')
    if (!normalized || normalized.includes('/')) return null
    if (!Array.isArray(card.attachments) || !card.attachments.includes(normalized)) return null
    const attachmentDir = this.getAttachmentStoragePath(card)
    if (!attachmentDir) return null
    return path.join(attachmentDir, normalized)
  }

  async copyAttachment(sourcePath: string, card: Card): Promise<void> {
    if (this._capabilities) { await this._capabilities.attachmentStorage.copyAttachment(sourcePath, card); return }
    await this._storage.copyAttachment(sourcePath, card)
  }

}
