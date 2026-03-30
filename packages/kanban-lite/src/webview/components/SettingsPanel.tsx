import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { JsonForms } from '@jsonforms/react'
import { createAjv, type UISchemaElement } from '@jsonforms/core'
import { vanillaCells, vanillaRenderers } from '@jsonforms/vanilla-renderers'
import { X, ChevronDown, Plus, Pencil, Trash2 } from 'lucide-react'
import type { PluginCapabilityNamespace } from '../../shared/config'
import type {
  BoardBackgroundMode,
  BoardBackgroundPreset,
  CardDisplaySettings,
  Priority,
  CardStatus,
  WorkspaceInfo,
  LabelDefinition,
  PluginSettingsDiscoverySource,
  PluginSettingsInstallScope,
  PluginSettingsInstallTransportResult,
  PluginSettingsOptionsSchemaMetadata,
  PluginSettingsPayload,
  PluginSettingsProviderTransport,
  PluginSettingsSecretFieldMetadata,
} from '../../shared/types'
import { DELETED_STATUS_ID, LABEL_PRESET_COLORS, normalizeBoardBackgroundSettings } from '../../shared/types'
import { useStore } from '../store'
import { cn } from '../lib/utils'
import { DrawerResizeHandle } from './DrawerResizeHandle'

const pluginOptionsAjv = createAjv({ allErrors: true, strict: false })
const pluginSecretFieldHint = 'Stored secret values reopen masked. Leave the masked value unchanged to keep the current secret, or type a new value to replace it.'

const pluginDiscoverySourceLabels: Record<PluginSettingsDiscoverySource, string> = {
  builtin: 'Built-in',
  workspace: 'Workspace',
  dependency: 'Dependency',
  global: 'Global',
  sibling: 'Sibling',
}

export type SettingsTab = 'general' | 'defaults' | 'labels' | 'pluginOptions'

/** URL-safe slug → internal SettingsTab */
export const SETTINGS_TAB_FROM_SLUG: Record<string, SettingsTab> = {
  general: 'general',
  defaults: 'defaults',
  labels: 'labels',
  plugins: 'pluginOptions',
}

/** Internal SettingsTab → URL-safe slug */
export const SETTINGS_TAB_TO_SLUG: Record<SettingsTab, string> = {
  general: 'general',
  defaults: 'defaults',
  labels: 'labels',
  pluginOptions: 'plugins',
}

const settingsTabLabels: Record<SettingsTab, string> = {
  general: 'General',
  defaults: 'Defaults',
  labels: 'Labels',
  pluginOptions: 'Plugin Options',
}

const priorityConfig: { value: Priority; label: string; dot: string }[] = [
  { value: 'critical', label: 'Critical', dot: 'bg-red-500' },
  { value: 'high', label: 'High', dot: 'bg-orange-500' },
  { value: 'medium', label: 'Medium', dot: 'bg-yellow-500' },
  { value: 'low', label: 'Low', dot: 'bg-green-500' }
]

const backgroundModeOptions: { value: BoardBackgroundMode; label: string }[] = [
  { value: 'fancy', label: 'Fancy' },
  { value: 'plain', label: 'Plain' },
]

const fancyBackgroundOptions: { value: BoardBackgroundPreset; label: string }[] = [
  { value: 'aurora', label: 'Aurora Glow' },
  { value: 'sunset', label: 'Sunset Blend' },
  { value: 'meadow', label: 'Meadow Mist' },
  { value: 'nebula', label: 'Nebula Bloom' },
  { value: 'lagoon', label: 'Lagoon Light' },
  { value: 'candy', label: 'Candy Pop' },
  { value: 'ember', label: 'Ember Sky' },
  { value: 'violet', label: 'Violet Pulse' },
]

const plainBackgroundOptions: { value: BoardBackgroundPreset; label: string }[] = [
  { value: 'paper', label: 'Paper White' },
  { value: 'mist', label: 'Mist Blue' },
  { value: 'sand', label: 'Soft Sand' },
]

interface SettingsPanelProps {
  isOpen: boolean
  settings: CardDisplaySettings
  workspace?: WorkspaceInfo | null
  pluginSettings?: PluginSettingsPayload | null
  pluginSettingsProvider?: PluginSettingsProviderTransport | null
  pluginSettingsInstall?: PluginSettingsInstallTransportResult | null
  pluginSettingsError?: string | null
  onClose: () => void
  onSave: (settings: CardDisplaySettings) => void
  onReadPluginSettingsProvider?: (capability: PluginCapabilityNamespace, providerId: string) => void
  onSelectPluginSettingsProvider?: (capability: PluginCapabilityNamespace, providerId: string) => void
  onUpdatePluginSettingsOptions?: (capability: PluginCapabilityNamespace, providerId: string, options: Record<string, unknown>) => void
  onInstallPluginSettingsPackage?: (packageName: string, scope: PluginSettingsInstallScope) => void
  onSetLabel?: (name: string, definition: LabelDefinition) => void
  onRenameLabel?: (oldName: string, newName: string) => void
  onDeleteLabel?: (name: string) => void
  onPluginOptionsTabActivated?: () => void
  onTabChange?: (tab: SettingsTab) => void
  initialTab?: SettingsTab
}

export function SettingsPanel({
  isOpen,
  settings,
  workspace,
  pluginSettings,
  pluginSettingsProvider,
  pluginSettingsInstall,
  pluginSettingsError,
  onClose,
  onSave,
  onReadPluginSettingsProvider,
  onSelectPluginSettingsProvider,
  onUpdatePluginSettingsOptions,
  onInstallPluginSettingsPackage,
  onSetLabel,
  onRenameLabel,
  onDeleteLabel,
  onPluginOptionsTabActivated,
  onTabChange,
  initialTab,
}: SettingsPanelProps) {
  if (!isOpen) return null
  return (
    <SettingsPanelContent
      settings={settings}
      workspace={workspace}
      pluginSettings={pluginSettings}
      pluginSettingsProvider={pluginSettingsProvider}
      pluginSettingsInstall={pluginSettingsInstall}
      pluginSettingsError={pluginSettingsError}
      onClose={onClose}
      onSave={onSave}
      onReadPluginSettingsProvider={onReadPluginSettingsProvider}
      onSelectPluginSettingsProvider={onSelectPluginSettingsProvider}
      onUpdatePluginSettingsOptions={onUpdatePluginSettingsOptions}
      onInstallPluginSettingsPackage={onInstallPluginSettingsPackage}
      onSetLabel={onSetLabel}
      onRenameLabel={onRenameLabel}
      onDeleteLabel={onDeleteLabel}
      onPluginOptionsTabActivated={onPluginOptionsTabActivated}
      onTabChange={onTabChange}
      initialTab={initialTab}
    />
  )
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0'
      )}
      style={{
        background: checked
          ? 'var(--vscode-button-background)'
          : 'var(--vscode-badge-background, #6b7280)'
      }}
    >
      <span
        className="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform"
        style={{
          transform: checked ? 'translateX(18px)' : 'translateX(3px)'
        }}
      />
    </button>
  )
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="py-3">
      <h3
        className="px-4 pb-2 text-xs font-semibold uppercase tracking-wider"
        style={{ color: 'var(--vscode-descriptionForeground)' }}
      >
        {title}
      </h3>
      <div>{children}</div>
    </div>
  )
}

function SettingsToggle({ label, description, checked, onChange }: {
  label: string
  description?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div
      className="flex items-center justify-between gap-4 px-4 py-2 transition-colors cursor-pointer"
      onClick={() => onChange(!checked)}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--vscode-list-hoverBackground)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm" style={{ color: 'var(--vscode-foreground)' }}>{label}</div>
        {description && (
          <div className="text-xs mt-0.5" style={{ color: 'var(--vscode-descriptionForeground)' }}>{description}</div>
        )}
      </div>
      <ToggleSwitch checked={checked} onChange={onChange} />
    </div>
  )
}

function SettingsInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-1.5">
      <div className="text-sm" style={{ color: 'var(--vscode-descriptionForeground)' }}>{label}</div>
      <div
        className="text-xs font-mono truncate max-w-[60%] text-right"
        style={{ color: 'var(--vscode-foreground)', opacity: 0.7 }}
        title={value}
      >
        {value}
      </div>
    </div>
  )
}

type PluginProviderFocusState = {
  capability: PluginCapabilityNamespace
  providerId: string
}

type PluginOptionsValidationError = {
  instancePath?: string
  message?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function clonePluginOptionsRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? structuredClone(value) as Record<string, unknown> : {}
}

function escapeJsonPointerSegment(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1')
}

export function createPluginOptionsUiSchema(schema: Record<string, unknown>): UISchemaElement {
  const properties = isRecord(schema.properties) ? Object.keys(schema.properties) : []

  return {
    type: 'VerticalLayout',
    elements: properties.map((property) => ({
      type: 'Control',
      scope: `#/properties/${escapeJsonPointerSegment(property)}`,
    })),
  }
}

function tokenizePluginSecretPath(value: string): string[] {
  return value.split('.').map(segment => segment.trim()).filter(Boolean)
}

function matchesPluginSecretPath(pattern: string, path: string[]): boolean {
  const patternSegments = tokenizePluginSecretPath(pattern)
  return patternSegments.length === path.length
    && patternSegments.every((segment, index) => segment === '*' || segment === path[index])
}

function applyPluginSecretSchemaHintsToNode(
  node: unknown,
  path: string[],
  secretPaths: readonly string[],
): void {
  if (!isRecord(node)) return

  if (secretPaths.some((secretPath) => matchesPluginSecretPath(secretPath, path))) {
    node.format = 'password'
    if (typeof node.description === 'string' && node.description.trim().length > 0) {
      if (!node.description.includes(pluginSecretFieldHint)) {
        node.description = `${node.description} ${pluginSecretFieldHint}`.trim()
      }
    } else {
      node.description = pluginSecretFieldHint
    }
  }

  if (isRecord(node.properties)) {
    for (const [key, child] of Object.entries(node.properties)) {
      applyPluginSecretSchemaHintsToNode(child, [...path, key], secretPaths)
    }
  }

  if (isRecord(node.items)) {
    applyPluginSecretSchemaHintsToNode(node.items, [...path, '*'], secretPaths)
  } else if (Array.isArray(node.items)) {
    node.items.forEach((child, index) => {
      applyPluginSecretSchemaHintsToNode(child, [...path, String(index)], secretPaths)
    })
  }
}

export function applyPluginSecretSchemaHints(
  schema: Record<string, unknown>,
  secrets: readonly PluginSettingsSecretFieldMetadata[],
): Record<string, unknown> {
  const nextSchema = structuredClone(schema) as Record<string, unknown>
  applyPluginSecretSchemaHintsToNode(nextSchema, [], secrets.map(secret => secret.path))
  return nextSchema
}

function validatePluginOptions(
  schema: Record<string, unknown>,
  data: Record<string, unknown>,
): PluginOptionsValidationError[] {
  const validate = pluginOptionsAjv.compile(schema)
  const valid = validate(data)
  return valid ? [] : ((validate.errors ?? []) as PluginOptionsValidationError[])
}

function getCapabilityEntry(
  pluginSettings: PluginSettingsPayload | null | undefined,
  capability: PluginCapabilityNamespace,
) {
  return pluginSettings?.capabilities.find((entry) => entry.capability === capability) ?? null
}

function getProviderRow(
  pluginSettings: PluginSettingsPayload | null | undefined,
  selection: PluginProviderFocusState | null,
) {
  if (!selection) return null
  return getCapabilityEntry(pluginSettings, selection.capability)?.providers.find(
    provider => provider.providerId === selection.providerId,
  ) ?? null
}

interface PluginListEntry {
  key: string
  label: string
  discoverySource: PluginSettingsDiscoverySource
  capabilities: Array<{
    capability: PluginCapabilityNamespace
    providerId: string
    isSelected: boolean
    optionsSchema?: PluginSettingsOptionsSchemaMetadata
  }>
  hasSelectedCapability: boolean
}

function derivePluginList(pluginSettings: PluginSettingsPayload | null | undefined): PluginListEntry[] {
  if (!pluginSettings?.capabilities) return []

  const map = new Map<string, PluginListEntry>()

  for (const capEntry of pluginSettings.capabilities) {
    for (const provider of capEntry.providers) {
      const key = provider.packageName
      let entry = map.get(key)
      if (!entry) {
        entry = {
          key,
          label: provider.packageName,
          discoverySource: provider.discoverySource,
          capabilities: [],
          hasSelectedCapability: false,
        }
        map.set(key, entry)
      }
      entry.capabilities.push({
        capability: capEntry.capability,
        providerId: provider.providerId,
        isSelected: provider.isSelected,
        optionsSchema: provider.optionsSchema,
      })
      if (provider.isSelected) {
        entry.hasSelectedCapability = true
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    if (a.discoverySource === 'builtin' && b.discoverySource !== 'builtin') return -1
    if (a.discoverySource !== 'builtin' && b.discoverySource === 'builtin') return 1
    return a.label.localeCompare(b.label)
  })
}

function PluginSettingsBadge({
  children,
  tone = 'default',
}: {
  children: React.ReactNode
  tone?: 'default' | 'selected'
}) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={tone === 'selected'
        ? {
            background: 'var(--vscode-button-background)',
            color: 'var(--vscode-button-foreground)',
          }
        : {
            background: 'var(--vscode-badge-background)',
            color: 'var(--vscode-badge-foreground)',
          }}
    >
      {children}
    </span>
  )
}

function createPluginProviderOptionsEditorKey(provider: PluginSettingsProviderTransport): string {
  return JSON.stringify({
    capability: provider.capability,
    providerId: provider.providerId,
    schema: provider.optionsSchema?.schema ?? null,
    uiSchema: provider.optionsSchema?.uiSchema ?? null,
    options: provider.options?.values ?? null,
  })
}

function PluginProviderOptionsEditor({
  provider,
  schema,
  uiSchema,
  onUpdatePluginSettingsOptions,
}: {
  provider: PluginSettingsProviderTransport
  schema: Record<string, unknown>
  uiSchema: UISchemaElement
  onUpdatePluginSettingsOptions?: (capability: PluginCapabilityNamespace, providerId: string, options: Record<string, unknown>) => void
}) {
  const [optionData, setOptionData] = useState<Record<string, unknown>>(() => clonePluginOptionsRecord(provider.options?.values))
  const [optionErrors, setOptionErrors] = useState<PluginOptionsValidationError[]>(() => validatePluginOptions(
    schema,
    clonePluginOptionsRecord(provider.options?.values),
  ))

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="text-sm font-medium" style={{ color: 'var(--vscode-foreground)' }}>
          {provider.providerId}
        </div>
        <div className="text-xs" style={{ color: 'var(--vscode-descriptionForeground)' }}>
          Package: {provider.packageName}
        </div>
      </div>

      {(provider.optionsSchema?.secrets?.length ?? 0) > 0 && (
        <div
          className="rounded-lg px-3 py-3 text-xs"
          style={{
            background: 'var(--vscode-editorWidget-background, var(--vscode-sideBar-background))',
            color: 'var(--vscode-descriptionForeground)',
            border: '1px solid var(--vscode-panel-border)',
          }}
        >
          {pluginSecretFieldHint}
        </div>
      )}

      <div className="card-jsonforms">
        <JsonForms
          schema={schema}
          uischema={uiSchema}
          data={optionData}
          renderers={vanillaRenderers}
          cells={vanillaCells}
          ajv={pluginOptionsAjv}
          onChange={({ data, errors }) => {
            const nextData = clonePluginOptionsRecord(data)
            setOptionData(nextData)
            setOptionErrors(Array.isArray(errors) ? (errors as PluginOptionsValidationError[]) : [])
          }}
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="text-xs" style={{ color: 'var(--vscode-descriptionForeground)' }}>
          {optionErrors.length > 0
            ? `Fix ${optionErrors.length} validation issue${optionErrors.length === 1 ? '' : 's'} before saving.`
            : 'Save to persist the provider selection and its redacted option payload.'}
        </div>
        <button
          type="button"
          disabled={!onUpdatePluginSettingsOptions || optionErrors.length > 0}
          onClick={() => onUpdatePluginSettingsOptions?.(
            provider.capability,
            provider.providerId,
            optionData,
          )}
          className="rounded-md px-3 py-2 text-sm font-medium disabled:cursor-default disabled:opacity-60"
          style={{
            background: 'var(--vscode-button-background)',
            color: 'var(--vscode-button-foreground)',
          }}
        >
          Save options
        </button>
      </div>
    </div>
  )
}

function PluginOptionsSection({
  pluginSettings,
  pluginSettingsProvider,
  pluginSettingsInstall,
  pluginSettingsError,
  onReadPluginSettingsProvider,
  onSelectPluginSettingsProvider,
  onUpdatePluginSettingsOptions,
  onInstallPluginSettingsPackage,
}: {
  pluginSettings?: PluginSettingsPayload | null
  pluginSettingsProvider?: PluginSettingsProviderTransport | null
  pluginSettingsInstall?: PluginSettingsInstallTransportResult | null
  pluginSettingsError?: string | null
  onReadPluginSettingsProvider?: (capability: PluginCapabilityNamespace, providerId: string) => void
  onSelectPluginSettingsProvider?: (capability: PluginCapabilityNamespace, providerId: string) => void
  onUpdatePluginSettingsOptions?: (capability: PluginCapabilityNamespace, providerId: string, options: Record<string, unknown>) => void
  onInstallPluginSettingsPackage?: (packageName: string, scope: PluginSettingsInstallScope) => void
}) {
  const plugins = useMemo(() => derivePluginList(pluginSettings), [pluginSettings])
  const [activePluginKey, setActivePluginKey] = useState<string | null>(null)
  const [installPackageName, setInstallPackageName] = useState('')
  const [installGlobally, setInstallGlobally] = useState(false)
  const [leftPanelPct, setLeftPanelPct] = useState(35)
  const splitContainerRef = useRef<HTMLDivElement>(null)
  const [showInstall, setShowInstall] = useState(false)

  const handleSplitDragStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    const container = splitContainerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()

    const onMove = (moveEvent: PointerEvent) => {
      const pct = Math.min(80, Math.max(20, ((moveEvent.clientX - rect.left) / rect.width) * 100))
      setLeftPanelPct(pct)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [])

  const activePlugin = useMemo(
    () => (showInstall ? null : plugins.find(p => p.key === activePluginKey) ?? null),
    [plugins, activePluginKey, showInstall],
  )

  // Auto-load provider details when a plugin is selected
  useEffect(() => {
    if (!activePlugin) return
    const capWithSchema = activePlugin.capabilities.find(c => c.optionsSchema)
    if (capWithSchema) {
      onReadPluginSettingsProvider?.(capWithSchema.capability, capWithSchema.providerId)
    }
  }, [activePlugin?.key]) // eslint-disable-line react-hooks/exhaustive-deps

  const activeProviderDetails = useMemo(() => {
    if (!activePlugin || !pluginSettingsProvider) return null
    const match = activePlugin.capabilities.find(
      c => c.capability === pluginSettingsProvider.capability && c.providerId === pluginSettingsProvider.providerId,
    )
    if (!match) return null
    return pluginSettingsProvider
  }, [activePlugin, pluginSettingsProvider])

  const providerOptionsSchema = useMemo(() => {
    if (!activeProviderDetails?.optionsSchema) return null
    return applyPluginSecretSchemaHints(
      activeProviderDetails.optionsSchema.schema,
      activeProviderDetails.optionsSchema.secrets,
    )
  }, [activeProviderDetails])

  const providerUiSchema = useMemo(() => {
    if (!activeProviderDetails?.optionsSchema) return null
    return (activeProviderDetails.optionsSchema.uiSchema ?? createPluginOptionsUiSchema(activeProviderDetails.optionsSchema.schema)) as UISchemaElement
  }, [activeProviderDetails])

  const installTips = useMemo(() => {
    const tips = [
      'Use an exact npm package name like kl-plugin-auth or another kl-* provider package.',
      'In-product installs always disable lifecycle scripts. Install manually if the package requires them.',
    ]

    if (pluginSettingsError?.toLowerCase().includes('exact')) {
      tips.unshift('Version specifiers, scoped packages, paths, URLs, whitespace, and extra flags are rejected by the SDK-backed installer.')
    }

    return tips
  }, [pluginSettingsError])

  return (
    <div className="space-y-4 px-4 py-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--vscode-foreground)' }}>
          Plugin providers
        </h3>
        <p className="text-xs" style={{ color: 'var(--vscode-descriptionForeground)' }}>
          Select a plugin to view its capabilities and configure options, or install a new package.
        </p>
      </div>

      <div ref={splitContainerRef} className="flex items-stretch gap-0" style={{ minHeight: '300px' }}>
        {/* Left panel: flat plugin list */}
        <div className="overflow-y-auto pr-1" style={{ width: `${leftPanelPct}%`, minWidth: 0 }}>
          <div
            className="rounded-xl border overflow-hidden"
            style={{
              borderColor: 'var(--vscode-panel-border)',
              background: 'var(--vscode-editorWidget-background, transparent)',
            }}
          >
            {plugins.length === 0 ? (
              <div
                className="px-3 py-3 text-sm"
                style={{ color: 'var(--vscode-descriptionForeground)' }}
              >
                No plugins discovered yet.
              </div>
            ) : plugins.map((plugin, idx) => (
              <div
                key={plugin.key}
                className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none"
                style={{
                  ...(activePluginKey === plugin.key && !showInstall
                    ? {
                        background: 'var(--vscode-list-activeSelectionBackground)',
                        color: 'var(--vscode-list-activeSelectionForeground)',
                      }
                    : { background: 'transparent' }),
                  ...(idx > 0 ? { borderTop: '1px solid var(--vscode-panel-border)' } : {}),
                }}
                onClick={() => { setActivePluginKey(plugin.key); setShowInstall(false) }}
                onMouseEnter={e => { if (activePluginKey !== plugin.key || showInstall) e.currentTarget.style.background = 'var(--vscode-list-hoverBackground)' }}
                onMouseLeave={e => { if (activePluginKey !== plugin.key || showInstall) e.currentTarget.style.background = 'transparent' }}
              >
                <span
                  className="text-sm font-medium flex-1 truncate"
                  style={activePluginKey === plugin.key && !showInstall ? undefined : { color: 'var(--vscode-foreground)' }}
                >
                  {plugin.label}
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  <PluginSettingsBadge>{pluginDiscoverySourceLabels[plugin.discoverySource]}</PluginSettingsBadge>
                  {plugin.hasSelectedCapability && <PluginSettingsBadge tone="selected">Active</PluginSettingsBadge>}
                </div>
              </div>
            ))}

            {/* Install package entry */}
            <div
              className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none"
              style={{
                borderTop: plugins.length > 0 ? '1px solid var(--vscode-panel-border)' : undefined,
                ...(showInstall
                  ? {
                      background: 'var(--vscode-list-activeSelectionBackground)',
                      color: 'var(--vscode-list-activeSelectionForeground)',
                    }
                  : { background: 'transparent' }),
              }}
              onClick={() => { setShowInstall(true); setActivePluginKey(null) }}
              onMouseEnter={e => { if (!showInstall) e.currentTarget.style.background = 'var(--vscode-list-hoverBackground)' }}
              onMouseLeave={e => { if (!showInstall) e.currentTarget.style.background = 'transparent' }}
            >
              <Plus size={13} className="shrink-0" style={showInstall ? undefined : { color: 'var(--vscode-descriptionForeground)' }} />
              <span
                className="text-sm font-medium flex-1"
                style={showInstall ? undefined : { color: 'var(--vscode-descriptionForeground)' }}
              >
                Install package
              </span>
            </div>
          </div>
        </div>

        {/* Drag handle */}
        <div
          className="w-1.5 shrink-0 cursor-col-resize mx-1 rounded transition-colors"
          style={{ background: 'var(--vscode-panel-border)' }}
          onPointerDown={handleSplitDragStart}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--vscode-focusBorder, var(--vscode-button-background))' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'var(--vscode-panel-border)' }}
        />

        {/* Right panel */}
        <div
          className="rounded-xl border overflow-hidden flex flex-col"
          style={{
            width: `${100 - leftPanelPct}%`,
            minWidth: 0,
            borderColor: 'var(--vscode-panel-border)',
            background: 'var(--vscode-editorWidget-background, transparent)',
          }}
        >
          {pluginSettingsError && (
            <div
              className="mx-4 mt-4 rounded-lg px-3 py-2 text-xs"
              style={{
                background: 'var(--vscode-inputValidation-errorBackground, rgba(190, 73, 73, 0.15))',
                color: 'var(--vscode-errorForeground, #f14c4c)',
                border: '1px solid var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground, #f14c4c))',
              }}
            >
              {pluginSettingsError}
            </div>
          )}

          {activePlugin ? (
            /* Plugin detail view */
            <div className="flex flex-col flex-1 overflow-y-auto">
              {/* Plugin header */}
              <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--vscode-panel-border)' }}>
                <h4 className="text-sm font-semibold" style={{ color: 'var(--vscode-foreground)' }}>
                  {activePlugin.label}
                </h4>
                <div className="flex items-center gap-2 mt-1">
                  <PluginSettingsBadge>{pluginDiscoverySourceLabels[activePlugin.discoverySource]}</PluginSettingsBadge>
                  <span className="text-xs" style={{ color: 'var(--vscode-descriptionForeground)' }}>
                    {activePlugin.capabilities.length} {activePlugin.capabilities.length === 1 ? 'capability' : 'capabilities'}
                  </span>
                </div>
              </div>

              {/* Capabilities list */}
              <div className="px-4 py-3 space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--vscode-descriptionForeground)' }}>
                  Capabilities
                </div>
                {activePlugin.capabilities.map(cap => {
                  return (
                    <div
                      key={`${cap.capability}:${cap.providerId}`}
                      className="rounded-lg border"
                      style={{
                        borderColor: 'var(--vscode-panel-border)',
                      }}
                    >
                      <div
                        className="flex items-center gap-2 px-3 py-2"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium" style={{ color: 'var(--vscode-foreground)' }}>
                            {cap.capability}
                          </div>
                          <div className="text-xs" style={{ color: 'var(--vscode-descriptionForeground)' }}>
                            Provider: {cap.providerId}
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={cap.isSelected || !onSelectPluginSettingsProvider}
                          onClick={(e) => {
                            e.stopPropagation()
                            onSelectPluginSettingsProvider?.(cap.capability, cap.providerId)
                          }}
                          className="rounded-md px-3 py-1 text-xs font-medium transition-colors disabled:cursor-default disabled:opacity-70"
                          style={cap.isSelected
                            ? {
                                background: 'var(--vscode-button-secondaryBackground, var(--vscode-badge-background))',
                                color: 'var(--vscode-button-secondaryForeground, var(--vscode-foreground))',
                              }
                            : {
                                background: 'var(--vscode-button-background)',
                                color: 'var(--vscode-button-foreground)',
                              }}
                        >
                          {cap.isSelected ? 'Active' : 'Activate'}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Plugin options (loaded at plugin level) */}
              {activeProviderDetails && providerOptionsSchema && providerUiSchema && (
                <div className="px-4 py-3" style={{ borderTop: '1px solid var(--vscode-panel-border)' }}>
                  <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--vscode-descriptionForeground)' }}>
                    Options
                  </div>
                  <PluginProviderOptionsEditor
                    key={createPluginProviderOptionsEditorKey(activeProviderDetails)}
                    provider={activeProviderDetails}
                    schema={providerOptionsSchema}
                    uiSchema={providerUiSchema}
                    onUpdatePluginSettingsOptions={onUpdatePluginSettingsOptions}
                  />
                </div>
              )}
            </div>
          ) : (
            /* Install form */
            <div className="space-y-4 px-4 py-4">
              <h4 className="text-sm font-semibold" style={{ color: 'var(--vscode-foreground)' }}>
                Install plugin package
              </h4>

              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  const packageName = installPackageName.trim()
                  if (!packageName) return
                  onInstallPluginSettingsPackage?.(packageName, installGlobally ? 'global' : 'workspace')
                }}
              >
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--vscode-descriptionForeground)' }}>
                    Package name
                  </label>
                  <input
                    type="text"
                    value={installPackageName}
                    onChange={(event) => setInstallPackageName(event.target.value)}
                    placeholder="kl-plugin-auth"
                    className="w-full rounded-md border px-3 py-2 text-sm"
                    style={{
                      borderColor: 'var(--vscode-input-border, var(--vscode-panel-border))',
                      background: 'var(--vscode-input-background)',
                      color: 'var(--vscode-input-foreground)',
                    }}
                  />
                </div>

                <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--vscode-foreground)' }}>
                  <input
                    type="checkbox"
                    checked={installGlobally}
                    onChange={(event) => setInstallGlobally(event.target.checked)}
                  />
                  Global install
                </label>

                <button
                  type="submit"
                  disabled={!onInstallPluginSettingsPackage || installPackageName.trim().length === 0}
                  className="rounded-md px-3 py-2 text-sm font-medium disabled:cursor-default disabled:opacity-60"
                  style={{
                    background: 'var(--vscode-button-background)',
                    color: 'var(--vscode-button-foreground)',
                  }}
                >
                  Install safely
                </button>

                {pluginSettingsInstall && (
                  <div
                    className="rounded-lg px-3 py-2 text-xs"
                    style={{
                      background: 'var(--vscode-inputOption-activeBackground, rgba(51, 153, 255, 0.12))',
                      color: 'var(--vscode-foreground)',
                      border: '1px solid var(--vscode-panel-border)',
                    }}
                  >
                    {pluginSettingsInstall.message}
                  </div>
                )}

                <div
                  className="rounded-lg px-3 py-3 text-xs"
                  style={{
                    background: 'var(--vscode-editorWidget-background, var(--vscode-sideBar-background))',
                    color: 'var(--vscode-descriptionForeground)',
                    border: '1px solid var(--vscode-panel-border)',
                  }}
                >
                  <div className="font-semibold" style={{ color: 'var(--vscode-foreground)' }}>
                    npm naming tip
                  </div>
                  <ul className="mt-2 list-disc space-y-1 pl-4">
                    {installTips.map((tip) => (
                      <li key={tip}>{tip}</li>
                    ))}
                  </ul>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SettingsDropdown({ label, value, options, onChange }: {
  label: string
  value: string
  options: { value: string; label: string; dot?: string; dotColor?: string }[]
  onChange: (value: string) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const current = options.find(o => o.value === value)

  return (
    <div
      className="flex items-center justify-between gap-4 px-4 py-2 transition-colors"
      onMouseEnter={e => e.currentTarget.style.background = 'var(--vscode-list-hoverBackground)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <div className="text-sm" style={{ color: 'var(--vscode-foreground)' }}>{label}</div>
      <div className="relative">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 px-2 py-1 text-xs font-medium rounded transition-colors"
          style={{ color: 'var(--vscode-foreground)' }}
        >
          {current?.dot && <span className={cn('w-2 h-2 rounded-full shrink-0', current.dot)} />}
          {!current?.dot && current?.dotColor && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: current.dotColor }} />}
          <span>{current?.label}</span>
          <ChevronDown size={12} style={{ color: 'var(--vscode-descriptionForeground)' }} />
        </button>
        {isOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
            <div
              className="absolute top-full right-0 mt-1 z-20 rounded-lg shadow-lg py-1 min-w-[140px]"
              style={{
                background: 'var(--vscode-dropdown-background)',
                border: '1px solid var(--vscode-dropdown-border, var(--vscode-panel-border))',
              }}
            >
              {options.map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value)
                    setIsOpen(false)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors"
                  style={{
                    color: 'var(--vscode-dropdown-foreground)',
                    background: option.value === value ? 'var(--vscode-list-activeSelectionBackground)' : undefined,
                  }}
                  onMouseEnter={e => {
                    if (option.value !== value) e.currentTarget.style.background = 'var(--vscode-list-hoverBackground)'
                  }}
                  onMouseLeave={e => {
                    if (option.value !== value) e.currentTarget.style.background = 'transparent'
                  }}
                >
                  {option.dot && <span className={cn('w-2 h-2 rounded-full shrink-0', option.dot)} />}
                  {!option.dot && option.dotColor && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: option.dotColor }} />}
                  <span className="flex-1 text-left">{option.label}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function SettingsSlider({ label, description, value, min, max, step, unit, onChange }: {
  label: string
  description?: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  onChange: (v: number) => void
}) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div
      className="flex items-center justify-between gap-4 px-4 py-2 transition-colors"
      onMouseEnter={e => e.currentTarget.style.background = 'var(--vscode-list-hoverBackground)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm" style={{ color: 'var(--vscode-foreground)' }}>{label}</div>
        {description && (
          <div className="text-xs mt-0.5" style={{ color: 'var(--vscode-descriptionForeground)' }}>{description}</div>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="settings-slider"
          style={{
            background: `linear-gradient(to right, var(--vscode-button-background) ${pct}%, var(--vscode-badge-background, #6b7280) ${pct}%)`,
          }}
        />
        <span
          className="text-xs font-mono w-12 text-right tabular-nums"
          style={{ color: 'var(--vscode-foreground)' }}
        >
          {value}{unit || '%'}
        </span>
      </div>
    </div>
  )
}

function ColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  const [isOpen, setIsOpen] = useState(false)
  const [customHex, setCustomHex] = useState('')

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-5 h-5 rounded-full border border-white/20 cursor-pointer shrink-0"
        style={{ backgroundColor: value }}
      />
      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div
            className="absolute top-full left-0 mt-1 z-20 rounded-lg shadow-lg p-2 min-w-[180px]"
            style={{
              background: 'var(--vscode-dropdown-background)',
              border: '1px solid var(--vscode-dropdown-border, var(--vscode-panel-border))',
            }}
          >
            <div className="grid grid-cols-6 gap-1.5 mb-2">
              {LABEL_PRESET_COLORS.map(c => (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => { onChange(c.hex); setIsOpen(false) }}
                  className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
                  style={{
                    backgroundColor: c.hex,
                    borderColor: value === c.hex ? 'white' : 'transparent'
                  }}
                  title={c.name}
                />
              ))}
            </div>
            <div className="flex gap-1">
              <input
                type="text"
                placeholder="#hex"
                value={customHex}
                onChange={e => setCustomHex(e.target.value)}
                className="flex-1 px-2 py-1 text-xs rounded"
                style={{
                  background: 'var(--vscode-input-background)',
                  color: 'var(--vscode-input-foreground)',
                  border: '1px solid var(--vscode-input-border, transparent)',
                }}
              />
              <button
                type="button"
                onClick={() => {
                  if (/^#[0-9a-fA-F]{6}$/.test(customHex)) {
                    onChange(customHex)
                    setIsOpen(false)
                    setCustomHex('')
                  }
                }}
                className="px-2 py-1 text-xs rounded"
                style={{
                  background: 'var(--vscode-button-background)',
                  color: 'var(--vscode-button-foreground)',
                }}
              >
                OK
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function LabelsSection({ onSetLabel, onRenameLabel, onDeleteLabel }: {
  onSetLabel?: (name: string, definition: LabelDefinition) => void
  onRenameLabel?: (oldName: string, newName: string) => void
  onDeleteLabel?: (name: string) => void
}) {
  const labelDefs = useStore(s => s.labelDefs)
  const cards = useStore(s => s.cards)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(LABEL_PRESET_COLORS[0].hex)
  const [newGroup, setNewGroup] = useState('')
  const [renamingLabel, setRenamingLabel] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)

  // Merge config labels + orphan labels from cards
  const allLabels = useMemo(() => {
    const labels = new Map<string, LabelDefinition | undefined>()
    for (const [name, def] of Object.entries(labelDefs)) {
      labels.set(name, def)
    }
    for (const f of cards) {
      for (const l of f.labels) {
        if (!labels.has(l)) labels.set(l, undefined)
      }
    }
    return labels
  }, [labelDefs, cards])

  // Group labels
  const groupedLabels = useMemo(() => {
    const groups: Record<string, { name: string; def?: LabelDefinition }[]> = {}
    allLabels.forEach((def, name) => {
      const group = def?.group || 'Other'
      if (!groups[group]) groups[group] = []
      groups[group].push({ name, def })
    })
    const sorted: [string, typeof groups[string]][] = Object.entries(groups).sort(([a], [b]) => {
      if (a === 'Other') return 1
      if (b === 'Other') return -1
      return a.localeCompare(b)
    })
    return sorted
  }, [allLabels])

  // Existing group names for autocomplete
  const existingGroups = useMemo(() => {
    const groups = new Set<string>()
    Object.values(labelDefs).forEach(def => {
      if (def.group) groups.add(def.group)
    })
    return Array.from(groups).sort()
  }, [labelDefs])

  const getCardCount = (labelName: string) =>
    cards.filter(f => f.labels.includes(labelName)).length

  const handleAdd = () => {
    const trimmed = newName.trim()
    if (!trimmed) return
    onSetLabel?.(trimmed, { color: newColor, group: newGroup || undefined })
    setNewName('')
    setNewColor(LABEL_PRESET_COLORS[0].hex)
    setNewGroup('')
  }

  const handleRename = (oldName: string) => {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== oldName) {
      onRenameLabel?.(oldName, trimmed)
    }
    setRenamingLabel(null)
    setRenameValue('')
  }

  const handleDelete = (name: string) => {
    onDeleteLabel?.(name)
    setConfirmingDelete(null)
  }

  const inputStyle = {
    background: 'var(--vscode-input-background)',
    color: 'var(--vscode-input-foreground)',
    border: '1px solid var(--vscode-input-border, transparent)',
  }

  return (
    <div className="px-4 space-y-3">
      {groupedLabels.map(([group, labels]) => (
        <div key={group}>
          <div
            className="text-[10px] font-semibold uppercase tracking-wider mb-1.5"
            style={{ color: 'var(--vscode-descriptionForeground)' }}
          >
            {group}
          </div>
          <div className="space-y-1">
            {labels.map(({ name, def }) => (
              <div
                key={name}
                className="flex items-center gap-2 px-2 py-1.5 rounded group/label transition-colors"
                onMouseEnter={e => e.currentTarget.style.background = 'var(--vscode-list-hoverBackground)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <ColorPicker
                  value={def?.color || '#6b7280'}
                  onChange={color => onSetLabel?.(name, { ...def, color, group: def?.group })}
                />
                {renamingLabel === name ? (
                  <input
                    type="text"
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleRename(name)
                      if (e.key === 'Escape') { setRenamingLabel(null); setRenameValue('') }
                    }}
                    onBlur={() => handleRename(name)}
                    autoFocus
                    className="flex-1 px-1.5 py-0.5 text-xs rounded min-w-0"
                    style={inputStyle}
                  />
                ) : (
                  <span className="flex-1 text-xs truncate" style={{ color: 'var(--vscode-foreground)' }}>
                    {name}
                  </span>
                )}
                {def?.group && renamingLabel !== name && (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
                    style={{
                      background: 'var(--vscode-badge-background)',
                      color: 'var(--vscode-badge-foreground)',
                    }}
                  >
                    {def.group}
                  </span>
                )}
                {confirmingDelete === name ? (
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[10px]" style={{ color: 'var(--vscode-errorForeground, #f44)' }}>
                      {getCardCount(name)} card{getCardCount(name) !== 1 ? 's' : ''}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDelete(name)}
                      className="px-1.5 py-0.5 text-[10px] rounded"
                      style={{
                        background: 'var(--vscode-inputValidation-errorBackground, #5a1d1d)',
                        color: 'var(--vscode-errorForeground, #f44)',
                      }}
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingDelete(null)}
                      className="px-1.5 py-0.5 text-[10px] rounded"
                      style={{ color: 'var(--vscode-descriptionForeground)' }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover/label:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => { setRenamingLabel(name); setRenameValue(name) }}
                      className="p-1 rounded transition-colors"
                      style={{ color: 'var(--vscode-descriptionForeground)' }}
                      onMouseEnter={e => e.currentTarget.style.color = 'var(--vscode-foreground)'}
                      onMouseLeave={e => e.currentTarget.style.color = 'var(--vscode-descriptionForeground)'}
                      title="Rename label"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingDelete(name)}
                      className="p-1 rounded transition-colors"
                      style={{ color: 'var(--vscode-descriptionForeground)' }}
                      onMouseEnter={e => e.currentTarget.style.color = 'var(--vscode-errorForeground, #f44)'}
                      onMouseLeave={e => e.currentTarget.style.color = 'var(--vscode-descriptionForeground)'}
                      title="Delete label"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Add new label form */}
      <div
        className="rounded-lg p-2 space-y-2"
        style={{
          background: 'var(--vscode-input-background)',
          border: '1px solid var(--vscode-input-border, transparent)',
        }}
      >
        <div className="flex items-center gap-2">
          <ColorPicker value={newColor} onChange={setNewColor} />
          <input
            type="text"
            placeholder="New label name..."
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
            className="flex-1 px-1.5 py-1 text-xs rounded bg-transparent min-w-0"
            style={{
              color: 'var(--vscode-input-foreground)',
              outline: 'none',
            }}
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Group (optional)"
            value={newGroup}
            onChange={e => setNewGroup(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
            list="label-groups"
            className="flex-1 px-1.5 py-1 text-xs rounded"
            style={inputStyle}
          />
          <datalist id="label-groups">
            {existingGroups.map(g => <option key={g} value={g} />)}
          </datalist>
          <button
            type="button"
            onClick={handleAdd}
            disabled={!newName.trim()}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors disabled:opacity-40"
            style={{
              background: 'var(--vscode-button-background)',
              color: 'var(--vscode-button-foreground)',
            }}
          >
            <Plus size={12} />
            Add
          </button>
        </div>
      </div>
    </div>
  )
}

function SettingsPanelContent({
  settings,
  workspace,
  pluginSettings,
  pluginSettingsProvider,
  pluginSettingsInstall,
  pluginSettingsError,
  onClose,
  onSave,
  onReadPluginSettingsProvider,
  onSelectPluginSettingsProvider,
  onUpdatePluginSettingsOptions,
  onInstallPluginSettingsPackage,
  onSetLabel,
  onRenameLabel,
  onDeleteLabel,
  onPluginOptionsTabActivated,
  onTabChange,
  initialTab,
}: Omit<SettingsPanelProps, 'isOpen'>) {
  const [local, setLocal] = useState<CardDisplaySettings>(settings)
  const [activeTab, setActiveTabRaw] = useState<SettingsTab>(initialTab ?? 'general')

  const setActiveTab = useCallback((tab: SettingsTab) => {
    setActiveTabRaw(tab)
    onTabChange?.(tab)
  }, [onTabChange])

  // Sync activeTab when initialTab changes from URL navigation
  useEffect(() => {
    if (initialTab && initialTab !== activeTab) {
      setActiveTabRaw(initialTab)
      if (initialTab === 'pluginOptions') {
        onPluginOptionsTabActivated?.()
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab])
  const [advancedOpen, setAdvancedOpen] = useState(false)

  useEffect(() => {
    if ((initialTab ?? 'general') === 'pluginOptions') {
      onPluginOptionsTabActivated?.()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const columns = useStore(s => s.columns)
  const effectiveDrawerWidth = useStore(s => s.effectiveDrawerWidth)
  const setDrawerWidthPreview = useStore(s => s.setDrawerWidthPreview)
  const clearDrawerWidthPreview = useStore(s => s.clearDrawerWidthPreview)
  const statusOptions = useMemo(
    () => columns.filter(c => c.id !== DELETED_STATUS_ID).map(c => ({ value: c.id, label: c.name, dotColor: c.color })),
    [columns]
  )
  const backgroundPresetOptions = useMemo(
    () => local.boardBackgroundMode === 'plain' ? plainBackgroundOptions : fancyBackgroundOptions,
    [local.boardBackgroundMode]
  )

  useEffect(() => { setLocal(settings) }, [settings])

  const update = (patch: Partial<CardDisplaySettings>) => {
    const next = { ...local, ...patch }
    setLocal(next)
    onSave(next)
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [onClose])

  const isDrawer = (local.panelMode ?? 'drawer') === 'drawer'

  return (
    <div className={`fixed inset-0 z-50 flex ${isDrawer ? 'justify-end pointer-events-none' : 'items-center justify-center p-4'}`}>
      {!isDrawer && <div className="absolute inset-0 bg-black/50" onClick={onClose} />}
      <div
        className={isDrawer
          ? 'relative h-full shadow-xl flex flex-col animate-in slide-in-from-right duration-200 pointer-events-auto'
          : 'relative w-full max-w-2xl max-h-[85vh] shadow-xl flex flex-col rounded-xl animate-in zoom-in-95 fade-in duration-200'}
        style={isDrawer
          ? { width: `${effectiveDrawerWidth}%`, background: 'var(--vscode-editor-background)', borderLeft: '1px solid var(--vscode-panel-border)' }
          : { background: 'var(--vscode-editor-background)', border: '1px solid var(--vscode-panel-border)' }}
        {...(isDrawer ? { 'data-panel-drawer': '' } : {})}
      >
        <DrawerResizeHandle
          panelMode={isDrawer ? 'drawer' : 'popup'}
          onPreview={setDrawerWidthPreview}
          onCommit={(width) => {
            clearDrawerWidthPreview()
            const next = { ...local, drawerWidth: width }
            setLocal(next)
            onSave(next)
          }}
          onCancel={clearDrawerWidthPreview}
        />
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid var(--vscode-panel-border)' }}
        >
          <h2 className="font-medium" style={{ color: 'var(--vscode-foreground)' }}>Settings</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded transition-colors"
            style={{ color: 'var(--vscode-descriptionForeground)' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--vscode-list-hoverBackground)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab Bar */}
        <div
          className="flex"
          style={{ borderBottom: '1px solid var(--vscode-panel-border)' }}
        >
          {(['general', 'defaults', 'labels', 'pluginOptions'] as const).map(tab => (
            <button
              key={tab}
              type="button"
              onClick={() => {
                setActiveTab(tab)
                if (tab === 'pluginOptions') {
                  onPluginOptionsTabActivated?.()
                }
              }}
              className="px-4 py-2.5 text-xs font-medium transition-colors relative"
              style={{
                color: activeTab === tab
                  ? 'var(--vscode-foreground)'
                  : 'var(--vscode-descriptionForeground)',
                background: 'transparent',
              }}
            >
              {settingsTabLabels[tab]}
              {activeTab === tab && (
                <span
                  className="absolute bottom-0 left-0 right-0 h-0.5"
                  style={{ background: 'var(--vscode-button-background)' }}
                />
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {activeTab === 'general' && (
            <>
              <SettingsSection title="Card Display">
                <SettingsToggle
                  label="Show Priority Badges"
                  description="Display priority indicators on card cards"
                  checked={local.showPriorityBadges}
                  onChange={v => update({ showPriorityBadges: v })}
                />
                <SettingsToggle
                  label="Show Assignee"
                  description="Display assigned person on card cards"
                  checked={local.showAssignee}
                  onChange={v => update({ showAssignee: v })}
                />
                <SettingsToggle
                  label="Show Due Date"
                  description="Display due dates on card cards"
                  checked={local.showDueDate}
                  onChange={v => update({ showDueDate: v })}
                />
                <SettingsToggle
                  label="Show Labels"
                  description="Display labels on card cards and in editors"
                  checked={local.showLabels}
                  onChange={v => update({ showLabels: v })}
                />
                <SettingsToggle
                  label="Show Filename"
                  description="Display the source markdown filename on cards"
                  checked={local.showFileName}
                  onChange={v => update({ showFileName: v })}
                />
                <SettingsToggle
                  label="Compact Mode"
                  description="Use compact card layout to show more cards"
                  checked={local.compactMode}
                  onChange={v => update({ compactMode: v })}
                />
                <SettingsToggle
                  label="Show Deleted Column"
                  description="Display the Deleted column to manage soft-deleted cards"
                  checked={local.showDeletedColumn}
                  onChange={v => update({ showDeletedColumn: v })}
                />
              </SettingsSection>
              <div style={{ borderTop: '1px solid var(--vscode-panel-border)' }} />
              <SettingsSection title="Layout">
                <SettingsDropdown
                  label="Panel Style"
                  value={local.panelMode ?? 'drawer'}
                  options={[
                    { value: 'drawer', label: 'Right-side Drawer' },
                    { value: 'popup', label: 'Centered Popup' },
                  ]}
                  onChange={v => update({ panelMode: v as 'popup' | 'drawer' })}
                />
                {(local.panelMode ?? 'drawer') === 'drawer' && (
                  <SettingsSlider
                    label="Drawer Width"
                    description="Width of the right-side drawer as a percentage of the viewport"
                    value={local.drawerWidth ?? 50}
                    min={20}
                    max={80}
                    step={5}
                    onChange={v => update({ drawerWidth: v })}
                  />
                )}
                <SettingsDropdown
                  label="Background Style"
                  value={local.boardBackgroundMode}
                  options={backgroundModeOptions}
                  onChange={v => {
                    const background = normalizeBoardBackgroundSettings(v as BoardBackgroundMode)
                    update(background)
                  }}
                />
                <SettingsDropdown
                  label="Background Preset"
                  value={local.boardBackgroundPreset}
                  options={backgroundPresetOptions}
                  onChange={v => {
                    const background = normalizeBoardBackgroundSettings(local.boardBackgroundMode, v as BoardBackgroundPreset)
                    update(background)
                  }}
                />
              </SettingsSection>
              <div style={{ borderTop: '1px solid var(--vscode-panel-border)' }} />
              <SettingsSection title="Zoom">
                <SettingsSlider
                  label="Board Zoom"
                  description="Scale text size on the board view"
                  value={local.boardZoom}
                  min={75}
                  max={150}
                  step={5}
                  onChange={v => update({ boardZoom: v })}
                />
                <SettingsSlider
                  label="Card Detail Zoom"
                  description="Scale text size in the card detail panel"
                  value={local.cardZoom}
                  min={75}
                  max={150}
                  step={5}
                  onChange={v => update({ cardZoom: v })}
                />
              </SettingsSection>
            {workspace && (
              <>
                <div style={{ borderTop: '1px solid var(--vscode-panel-border)' }} />
                <div
                  className="flex items-center justify-between px-4 py-3 cursor-pointer"
                  onClick={() => setAdvancedOpen(o => !o)}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--vscode-list-hoverBackground)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--vscode-descriptionForeground)' }}>
                    Advanced
                  </h3>
                  <ChevronDown
                    size={14}
                    className={`transition-transform ${advancedOpen ? 'rotate-180' : ''}`}
                    style={{ color: 'var(--vscode-descriptionForeground)' }}
                  />
                </div>
                {advancedOpen && (
                  <>
                    <SettingsInfo label="Project Path" value={workspace.projectPath} />
                    <SettingsInfo label="Kanban Directory" value={workspace.kanbanDirectory} />
                    <SettingsInfo label="Server Port" value={String(workspace.port)} />
                    <SettingsInfo label="Config Version" value={String(workspace.configVersion)} />
                  </>
                )}
              </>
            )}
            </>
          )}

          {activeTab === 'defaults' && (
            <SettingsSection title="Defaults">
              <SettingsDropdown
                label="Default Priority"
                value={local.defaultPriority}
                options={priorityConfig}
                onChange={v => update({ defaultPriority: v as Priority })}
              />
              <SettingsDropdown
                label="Default Status"
                value={local.defaultStatus}
                options={statusOptions}
                onChange={v => update({ defaultStatus: v as CardStatus })}
              />
            </SettingsSection>
          )}

          {activeTab === 'labels' && (
            <SettingsSection title="Labels">
              <LabelsSection
                onSetLabel={onSetLabel}
                onRenameLabel={onRenameLabel}
                onDeleteLabel={onDeleteLabel}
              />
            </SettingsSection>
          )}

          {activeTab === 'pluginOptions' && (
            <PluginOptionsSection
              pluginSettings={pluginSettings}
              pluginSettingsProvider={pluginSettingsProvider}
              pluginSettingsInstall={pluginSettingsInstall}
              pluginSettingsError={pluginSettingsError}
              onReadPluginSettingsProvider={onReadPluginSettingsProvider}
              onSelectPluginSettingsProvider={onSelectPluginSettingsProvider}
              onUpdatePluginSettingsOptions={onUpdatePluginSettingsOptions}
              onInstallPluginSettingsPackage={onInstallPluginSettingsPackage}
            />
          )}
        </div>

        {/* Footer */}
        <div
          className="px-4 py-2"
          style={{ borderTop: '1px solid var(--vscode-panel-border)' }}
        >
          <p className="text-xs" style={{ color: 'var(--vscode-descriptionForeground)' }}>
            Settings are saved automatically and apply to all connected clients.
          </p>
        </div>
      </div>
    </div>
  )
}
