import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type {
  CardDisplaySettings,
  PluginSettingsInstallTransportResult,
  PluginSettingsPayload,
  PluginSettingsProviderTransport,
} from '../../shared/types'

const DEFAULT_CARD_SETTINGS: CardDisplaySettings = {
  showPriorityBadges: true,
  showAssignee: true,
  showDueDate: true,
  showLabels: true,
  showBuildWithAI: true,
  showFileName: false,
  compactMode: false,
  markdownEditorMode: false,
  showDeletedColumn: false,
  defaultPriority: 'medium',
  defaultStatus: 'backlog',
  boardZoom: 100,
  cardZoom: 100,
  boardBackgroundMode: 'fancy',
  boardBackgroundPreset: 'aurora',
  panelMode: 'drawer',
  drawerWidth: 50,
}

const storeState = {
  labelDefs: {},
  cards: [],
  columns: [],
  effectiveDrawerWidth: 62,
  setDrawerWidthPreview: vi.fn(),
  clearDrawerWidthPreview: vi.fn(),
}

const PLUGIN_SETTINGS_FIXTURE: PluginSettingsPayload = {
  redaction: {
    maskedValue: '••••••',
    writeOnly: true,
    targets: ['read', 'list', 'error'],
  },
  capabilities: [
    {
      capability: 'card.storage',
      selected: {
        capability: 'card.storage',
        providerId: 'markdown',
        source: 'default',
      },
      providers: [
        {
          capability: 'card.storage',
          providerId: 'markdown',
          packageName: 'markdown',
          discoverySource: 'builtin',
          isSelected: true,
        },
        {
          capability: 'card.storage',
          providerId: 'sqlite',
          packageName: 'kl-plugin-storage-sqlite',
          discoverySource: 'workspace',
          isSelected: false,
        },
      ],
    },
    {
      capability: 'auth.identity',
      selected: {
        capability: 'auth.identity',
        providerId: 'local',
        source: 'config',
      },
      providers: [
        {
          capability: 'auth.identity',
          providerId: 'local',
          packageName: 'kl-plugin-auth',
          discoverySource: 'dependency',
          isSelected: true,
        },
      ],
    },
  ],
}

const AUTH_PROVIDER_FIXTURE: PluginSettingsProviderTransport = {
  capability: 'auth.identity',
  providerId: 'local',
  packageName: 'kl-plugin-auth',
  discoverySource: 'dependency',
  selected: {
    capability: 'auth.identity',
    providerId: 'local',
    source: 'config',
  },
  optionsSchema: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        apiToken: { type: 'string', title: 'API token' },
        users: {
          type: 'array',
          title: 'Local users',
          items: {
            type: 'object',
            properties: {
              username: { type: 'string', title: 'Username' },
              password: { type: 'string', title: 'Password hash' },
            },
          },
        },
      },
    },
    secrets: [
      { path: 'apiToken', redaction: PLUGIN_SETTINGS_FIXTURE.redaction },
      { path: 'users.*.password', redaction: PLUGIN_SETTINGS_FIXTURE.redaction },
    ],
  },
  options: {
    values: {
      apiToken: '••••••',
      users: [{ username: 'alice', password: '••••••' }],
    },
    redactedPaths: ['apiToken', 'users.0.password'],
    redaction: PLUGIN_SETTINGS_FIXTURE.redaction,
  },
}

const CARD_STORAGE_PROVIDER_FIXTURE: PluginSettingsProviderTransport = {
  capability: 'card.storage',
  providerId: 'sqlite',
  packageName: 'kl-plugin-storage-sqlite',
  discoverySource: 'workspace',
  selected: {
    capability: 'card.storage',
    providerId: 'sqlite',
    source: 'config',
  },
  optionsSchema: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        databasePath: { type: 'string', title: 'Database path' },
      },
    },
    secrets: [],
  },
  options: {
    values: {
      databasePath: '.kanban/kanban.db',
    },
    redactedPaths: [],
    redaction: PLUGIN_SETTINGS_FIXTURE.redaction,
  },
}

const INSTALL_RESULT_FIXTURE: PluginSettingsInstallTransportResult = {
  packageName: 'kl-plugin-auth',
  scope: 'workspace',
  command: {
    command: 'npm',
    args: ['install', '--ignore-scripts', 'kl-plugin-auth'],
    cwd: '/tmp/workspace',
    shell: false,
  },
  stdout: '',
  stderr: '',
  message: 'Installed plugin package with lifecycle scripts disabled.',
  redaction: PLUGIN_SETTINGS_FIXTURE.redaction,
}

vi.mock('../store', () => ({
  useStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
}))

import {
  SettingsPanel,
  applyPluginSecretSchemaHints,
} from './SettingsPanel'

describe('SettingsPanel drawer resize integration', () => {
  it('renders a resize handle in drawer mode and uses the effective drawer width', () => {
    const markup = renderToStaticMarkup(
      <SettingsPanel
        isOpen
        settings={{ ...DEFAULT_CARD_SETTINGS, panelMode: 'drawer', drawerWidth: 50 }}
        workspace={null}
        onClose={() => {}}
        onSave={() => {}}
      />
    )

    expect(markup).toContain('data-panel-resize-handle')
    expect(markup).toContain('width:62%')
    expect(markup).toContain('Background Style')
    expect(markup).toContain('Background Preset')
  })

  it('does not render a resize handle in popup mode', () => {
    const markup = renderToStaticMarkup(
      <SettingsPanel
        isOpen
        settings={{ ...DEFAULT_CARD_SETTINGS, panelMode: 'popup' }}
        workspace={null}
        onClose={() => {}}
        onSave={() => {}}
      />
    )

    expect(markup).not.toContain('data-panel-resize-handle')
  })

  it('renders the Plugin Options tab with capability-grouped provider rows and selected-state badges', () => {
    const markup = renderToStaticMarkup(
      <SettingsPanel
        isOpen
        settings={{ ...DEFAULT_CARD_SETTINGS }}
        workspace={null}
        pluginSettings={PLUGIN_SETTINGS_FIXTURE}
        initialTab="pluginOptions"
        onClose={() => {}}
        onSave={() => {}}
        onSelectPluginSettingsProvider={() => {}}
      />
    )

    expect(markup).toContain('Plugin providers')
    expect(markup).toContain('card.storage')
    expect(markup).toContain('auth.identity')
    expect(markup).toContain('Selected provider: markdown (default)')
    expect(markup).toContain('Selected provider: local (config)')
    expect(markup).toContain('markdown')
    expect(markup).toContain('sqlite')
    expect(markup).toContain('kl-plugin-storage-sqlite')
    expect(markup).toContain('Built-in')
    expect(markup).toContain('Workspace')
    expect(markup).toContain('Dependency')
    expect(markup).toContain('Selected')
    expect(markup).toContain('Open')
    expect(markup).toContain('Install plugin package')
    expect(markup).toContain('Package name')
    expect(markup).toContain('Global install')
    expect(markup).toContain('Install safely')
    expect(markup).toContain('kl-plugin-auth or another kl-* provider package')
  })

  it('renders schema-driven provider options for auth and storage providers', () => {
    const authMarkup = renderToStaticMarkup(
      <SettingsPanel
        isOpen
        settings={{ ...DEFAULT_CARD_SETTINGS }}
        workspace={null}
        pluginSettings={PLUGIN_SETTINGS_FIXTURE}
        pluginSettingsProvider={AUTH_PROVIDER_FIXTURE}
        initialTab="pluginOptions"
        onClose={() => {}}
        onSave={() => {}}
      />
    )

    expect(authMarkup).toContain('Provider options')
    expect(authMarkup).toContain('API token')
    expect(authMarkup).toContain('Local users')
    expect(authMarkup).toContain('Save options')
    expect(authMarkup).toContain('Stored secret values reopen masked')
    expect(authMarkup).toContain('card-jsonforms')

    const storageMarkup = renderToStaticMarkup(
      <SettingsPanel
        isOpen
        settings={{ ...DEFAULT_CARD_SETTINGS }}
        workspace={null}
        pluginSettings={PLUGIN_SETTINGS_FIXTURE}
        pluginSettingsProvider={CARD_STORAGE_PROVIDER_FIXTURE}
        initialTab="pluginOptions"
        onClose={() => {}}
        onSave={() => {}}
      />
    )

    expect(storageMarkup).toContain('Database path')
    expect(storageMarkup).not.toContain('Stored secret values reopen masked')
  })

  it('annotates masked secret schema fields without redisplaying raw values', () => {
    const schema = applyPluginSecretSchemaHints(
      AUTH_PROVIDER_FIXTURE.optionsSchema!.schema,
      AUTH_PROVIDER_FIXTURE.optionsSchema!.secrets,
    )
    const properties = schema.properties as Record<string, Record<string, unknown>>
    const userItems = (properties.users.items as Record<string, unknown>).properties as Record<string, Record<string, unknown>>

    expect(properties.apiToken.format).toBe('password')
    expect(String(properties.apiToken.description)).toContain('Stored secret values reopen masked')
    expect(userItems.password.format).toBe('password')
  })

  it('renders sanitized install feedback without dumping raw command details', () => {
    const markup = renderToStaticMarkup(
      <SettingsPanel
        isOpen
        settings={{ ...DEFAULT_CARD_SETTINGS }}
        workspace={null}
        pluginSettings={PLUGIN_SETTINGS_FIXTURE}
        pluginSettingsInstall={INSTALL_RESULT_FIXTURE}
        pluginSettingsError="Use an exact package name like kl-plugin-auth."
        initialTab="pluginOptions"
        onClose={() => {}}
        onSave={() => {}}
      />
    )

    expect(markup).toContain('Installed plugin package with lifecycle scripts disabled.')
    expect(markup).toContain('Use an exact package name like kl-plugin-auth.')
    expect(markup).not.toContain('--ignore-scripts')
  })
})
