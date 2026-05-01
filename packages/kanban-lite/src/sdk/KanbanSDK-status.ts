import type { PluginCapabilityNamespace } from '../shared/config'
import type {
  PluginSettingsErrorPayload,
  PluginSettingsInstallRequest,
  PluginSettingsInstallScope,
  PluginSettingsPayload,
  PluginSettingsRedactionPolicy,
  PluginSettingsRedactionTarget,
} from '../shared/types'
import type { PluginSettingsInstallResult } from './plugin-settings'
import type { KanbanSDK } from './KanbanSDK'
import type { ConfigStorageCapabilityResolution } from '../shared/config'
import { normalizeConfigStorageSelection } from '../shared/config'
import {
  canUseDefaultCardStateActor,
  discoverPluginSettingsInventory,
  persistPluginSettingsProviderOptions,
  persistPluginSettingsProviderSelection,
  readPluginSettingsProvider,
} from './plugins'
import {
  inspectMobileSession as inspectMobileSessionContract,
  resolveMobileBootstrap as resolveMobileBootstrapContract,
} from './mobileSession'
import { KANBAN_EVENT_CATALOG } from './integrationCatalog'
import type {
  CardStateStatus,
  InspectMobileSessionInput,
  MobileSessionStatus,
  ResolveMobileBootstrapInput,
  ResolveMobileBootstrapResult,
  SDKAvailableEventDescriptor,
  SDKAvailableEventsOptions,
} from './types'
import type { AuthContext, AuthDecision } from './types'
import {
  CARD_STATE_DEFAULT_ACTOR_MODE,
  DEFAULT_CARD_STATE_ACTOR,
  ERR_CARD_STATE_UNAVAILABLE,
  AuthError,
} from './types'
import {
  createPluginSettingsErrorPayload,
  createPluginSettingsInstallCommand,
  createPluginSettingsManualInstallCommand,
  DEFAULT_PLUGIN_SETTINGS_REDACTION,
  PLUGIN_SETTINGS_INSTALL_FAILURE_MESSAGE,
  PLUGIN_SETTINGS_INSTALL_SUCCESS_MESSAGE,
  PluginSettingsOperationError,
  redactPluginSettingsInstallOutput,
  toPluginSettingsOperationError,
  validatePluginSettingsInstallRequest,
} from './plugin-settings'
import { readConfigRepositoryDocument } from './modules/configRepository'
import type { ConfigStorageResolutionInput, PluginSettingsProviderReadModel, StorageStatus, AuthStatus, WebhookStatus, CardStateRuntimeStatus } from './KanbanSDK-types'
import {
  compareAvailableEvents,
  matchesEventMask,
  normalizeAvailableEventType,
} from './KanbanSDK-types'
import { KanbanSDKCore } from './KanbanSDK-core'

export type { StorageStatus, AuthStatus, WebhookStatus, CardStateRuntimeStatus }

/**
 * Extends KanbanSDKCore with storage/auth diagnostics, mobile bootstrap,
 * event catalog listing, and plugin-settings CRUD.
 */
export class KanbanSDKStatus extends KanbanSDKCore {
  // --- Storage status ---

  resolveConfigStorageStatus(config?: ConfigStorageResolutionInput): ConfigStorageCapabilityResolution {
    const repositoryResult = readConfigRepositoryDocument(this.workspaceRoot)
    const input = config
      ? structuredClone(config) as ConfigStorageResolutionInput
      : this._getRuntimeConfigStorageInput(repositoryResult)

    return normalizeConfigStorageSelection(input, {
      explicitFailure: this._resolveConfigStorageFailure(input, repositoryResult),
    })
  }

  getStorageStatus(): StorageStatus {
    return {
      storageEngine: this._storage.type,
      providers: this._capabilities?.providers ?? null,
      configStorage: this.resolveConfigStorageStatus(),
      isFileBacked: this._capabilities?.isFileBacked ?? this._storage.type === 'markdown',
      watchGlob: this._capabilities?.getWatchGlob() ?? (this._storage.type === 'markdown' ? 'boards/**/*.md' : null),
    }
  }

  // --- Auth status ---

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

  // --- Mobile bootstrap ---

  async resolveMobileBootstrap(input: ResolveMobileBootstrapInput): Promise<ResolveMobileBootstrapResult> {
    return resolveMobileBootstrapContract(this.workspaceRoot, input)
  }

  async inspectMobileSession(input: InspectMobileSessionInput): Promise<MobileSessionStatus> {
    return inspectMobileSessionContract(this.workspaceRoot, input)
  }

  // --- Webhook status ---

  getWebhookStatus(): WebhookStatus {
    const webhookProvider = this._capabilities?.webhookProvider?.manifest.id ?? 'none'
    return {
      webhookProvider,
      webhookProviderActive: this._capabilities?.webhookProvider != null,
    }
  }

  // --- Event catalog ---

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

    for (const runtimePlugin of this._capabilities?.runtimePluginEvents ?? []) {
      for (const pluginEvent of runtimePlugin.events) {
        if (type !== 'all' && pluginEvent.phase !== type) continue
        if (!matchesEventMask(pluginEvent.event, options.mask)) continue

        const key = `${pluginEvent.phase}:${pluginEvent.event}`
        const existing = descriptors.get(key)
        const pluginIds = Array.from(new Set([...(existing?.pluginIds ?? []), runtimePlugin.id]))

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

  // --- Plugin settings ---

  async listPluginSettings(): Promise<PluginSettingsPayload> {
    await this._authorizeAction('plugin-settings.read')

    try {
      return await discoverPluginSettingsInventory(this.workspaceRoot, DEFAULT_PLUGIN_SETTINGS_REDACTION, this as unknown as KanbanSDK)
    } catch (error) {
      throw toPluginSettingsOperationError({
        error,
        fallbackCode: 'plugin-settings-read-failed',
        fallbackMessage: 'Unable to list plugin settings.',
      })
    }
  }

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
        this as unknown as KanbanSDK,
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
        this as unknown as KanbanSDK,
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
        this as unknown as KanbanSDK,
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

  // --- Card-state status ---

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

  // --- Extension lookup ---

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getExtension<T extends Record<string, any> = Record<string, unknown>>(id: string): T | undefined {
    const entry = this._capabilities?.sdkExtensions.find(e => e.id === id)
    return entry?.extensions as T | undefined
  }

  /** @internal — exposed for auth methods in KanbanSDKCardState */
  async _authorizeAction(action: string, context?: AuthContext): Promise<AuthDecision> {
    if (!this._capabilities) {
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
}
