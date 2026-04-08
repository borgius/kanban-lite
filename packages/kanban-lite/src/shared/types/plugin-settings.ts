import type { ConfigStorageCapabilityResolution, PluginCapabilityNamespace } from '../config'
import type { KanbanSDK } from '../../sdk/KanbanSDK'
import type { CardDisplaySettings } from './card'


/**
 * Authoring-time resolver for dynamic plugin-settings schema values.
 *
 * The shared plugin-settings loader invokes these functions before transport,
 * so the Settings UI and other host surfaces still receive plain structured
 * JSON Forms metadata.
 */
export type PluginSettingsSchemaValueResolver<T = unknown> = (
  sdk: KanbanSDK,
  optionsSchema: PluginSettingsOptionsSchemaMetadata,
) => T | Promise<T>

/** Authoring-time sync/async value wrapper allowed inside plugin-settings metadata. */
export type PluginSettingsResolvable<T> = T | PluginSettingsSchemaValueResolver<T> | Promise<T>

/** Recursive structured value supported by dynamic plugin-settings schema metadata during authoring. */
export type PluginSettingsDynamicMetadataValue = PluginSettingsResolvable<
  | string
  | number
  | boolean
  | null
  | undefined
  | PluginSettingsDynamicMetadataValue[]
  | { [key: string]: PluginSettingsDynamicMetadataValue }
>

/** Plugin-settings JSON Schema type that allows nested sync/async resolvers during authoring. */
export type PluginSettingsJsonSchema = { [key: string]: PluginSettingsDynamicMetadataValue }

/** Plugin-settings JSON Forms UI schema type that allows nested sync/async resolvers during authoring. */
export type PluginSettingsUiSchemaElement = { [key: string]: PluginSettingsDynamicMetadataValue }

// Kanban types


export type PluginSettingsDiscoverySource = 'builtin' | 'workspace' | 'dependency' | 'global' | 'sibling'

/** Origin of the currently selected provider for a capability row. */
export type PluginSettingsSelectionSource = 'config' | 'legacy' | 'default' | 'none'

/** Surfaces that must never echo raw secret values back to callers. */
export type PluginSettingsRedactionTarget = 'read' | 'list' | 'error'

/** Supported install destinations for in-product plugin installation flows. */
export type PluginSettingsInstallScope = 'workspace' | 'global'

/** Shared secret redaction policy reused across SDK, REST, CLI, MCP, and host transports. */
export interface PluginSettingsRedactionPolicy {
  maskedValue: string
  writeOnly: true
  targets: readonly PluginSettingsRedactionTarget[]
}

/** Metadata for a single secret field declared by a provider options schema. */
export interface PluginSettingsSecretFieldMetadata {
  path: string
  redaction: PluginSettingsRedactionPolicy
}

/**
 * Provider options schema metadata used by plugin authors and shared transports.
 *
 * Authoring-time `schema` / `uiSchema` values may include nested sync/async
 * resolvers. The shared plugin-settings loader resolves them into plain JSON
 * Forms metadata before surfacing provider options through SDK/UI/API/CLI/MCP
 * transports.
 */
export interface PluginSettingsOptionsSchemaMetadata {
  schema: PluginSettingsJsonSchema
  uiSchema?: PluginSettingsUiSchemaElement
  secrets: PluginSettingsSecretFieldMetadata[]
}

/** Selected-provider state for a capability. Enablement is represented only by provider selection. */
export interface PluginSettingsSelectedState {
  capability: PluginCapabilityNamespace
  providerId: string | null
  source: PluginSettingsSelectionSource
  /** Optional configured/effective resolution details for capabilities such as `config.storage`. */
  resolution?: ConfigStorageCapabilityResolution
}

/** Provider inventory row surfaced inside a capability group. */
export interface PluginSettingsProviderRow {
  capability: PluginCapabilityNamespace
  providerId: string
  packageName: string
  discoverySource: PluginSettingsDiscoverySource
  isSelected: boolean
  optionsSchema?: PluginSettingsOptionsSchemaMetadata
}

/** Capability-group row for plugin settings inventory and selection surfaces. */
export interface PluginSettingsCapabilityRow {
  capability: PluginCapabilityNamespace
  selected: PluginSettingsSelectedState
  providers: PluginSettingsProviderRow[]
}

/** Shared plugin settings payload shape used by SDK-facing hosts and transports. */
export interface PluginSettingsPayload {
  capabilities: PluginSettingsCapabilityRow[]
  redaction: PluginSettingsRedactionPolicy
}

/** Redacted provider options readback for plugin settings detail/list flows. */
export interface PluginSettingsRedactedValues {
  values: Record<string, unknown>
  redactedPaths: string[]
  redaction: PluginSettingsRedactionPolicy
}

/** Redacted provider detail payload reused by SDK, REST, CLI, MCP, and hosts. */
export interface PluginSettingsReadPayload {
  capability: PluginCapabilityNamespace
  providerId: string
  selected: PluginSettingsSelectedState
  options: PluginSettingsRedactedValues | null
}

/** Canonical redacted error payload for plugin settings operations. */
export interface PluginSettingsErrorPayload {
  code: string
  message: string
  capability?: PluginCapabilityNamespace
  providerId?: string
  details?: Record<string, unknown>
  redaction: PluginSettingsRedactionPolicy
}

/** Install request contract accepted by SDK-facing plugin management surfaces. */
export interface PluginSettingsInstallRequest {
  packageName: string
  scope: PluginSettingsInstallScope
}

/** Host-transport provider detail payload reused across VS Code and standalone bridges. */
export interface PluginSettingsProviderTransport extends PluginSettingsReadPayload, Pick<
  PluginSettingsProviderRow,
  'packageName' | 'discoverySource' | 'optionsSchema'
> {}

/** Fixed npm argv install command surfaced through plugin host transports. */
export interface PluginSettingsInstallCommandTransport {
  command: 'npm'
  args: string[]
  cwd: string
  shell: false
}

/** Redacted install success payload surfaced through plugin host transports. */
export interface PluginSettingsInstallTransportResult {
  packageName: string
  scope: PluginSettingsInstallScope
  command: PluginSettingsInstallCommandTransport
  stdout: string
  stderr: string
  message: string
  redaction: PluginSettingsRedactionPolicy
}

/** Plugin-settings actions routed through shared host/webview bridges. */
export type PluginSettingsTransportAction = 'read' | 'select' | 'updateOptions' | 'install'

/** Shared settings payload emitted when the settings modal opens. */
export interface ShowSettingsMessage {
  type: 'showSettings'
  settings: CardDisplaySettings
  pluginSettings: PluginSettingsPayload
}

/** Shared plugin-settings result message emitted by both host bridges. */
export interface PluginSettingsResultMessage {
  type: 'pluginSettingsResult'
  action: PluginSettingsTransportAction
  pluginSettings?: PluginSettingsPayload
  provider?: PluginSettingsProviderTransport | null
  install?: PluginSettingsInstallTransportResult
  error?: PluginSettingsErrorPayload
}

/** Empty plugin-settings payload used when a host has no active SDK context. */
export function createEmptyPluginSettingsPayload(redaction: PluginSettingsRedactionPolicy): PluginSettingsPayload {
  return {
    capabilities: [],
    redaction,
  }
}

/**
 * Shared create-card payload used by REST and webview transport surfaces.
 *
 * This remains backward compatible with existing card creation flows while
 * allowing form-aware cards to be created without a second ad-hoc payload
 * shape.
 */

