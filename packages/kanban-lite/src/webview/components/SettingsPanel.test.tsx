import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type {
  CardDisplaySettings,
  PluginSettingsInstallTransportResult,
  PluginSettingsOptionsSchemaMetadata,
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

const AUTH_OPTIONS_SCHEMA: PluginSettingsOptionsSchemaMetadata = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      apiToken: { type: 'string', title: 'API token' },
      roles: {
        type: 'array',
        title: 'Roles',
           default: ['user', 'manager', 'admin'],
        items: { type: 'string', title: 'Role' },
      },
      users: {
        type: 'array',
        title: 'Local users',
        items: {
          type: 'object',
          properties: {
            username: { type: 'string', title: 'Username' },
            password: { type: 'string', title: 'Password hash' },
            role: { type: 'string', title: 'Role', enum: ['user', 'manager', 'admin'] },
          },
        },
      },
    },
  },
  uiSchema: {
    type: 'VerticalLayout',
    elements: [
      {
        type: 'Group',
        label: 'API access',
        elements: [
          {
            type: 'Control',
            scope: '#/properties/apiToken',
            label: 'API token',
          },
        ],
      },
      {
        type: 'Group',
        label: 'Role catalog',
        elements: [
          {
            type: 'Control',
            scope: '#/properties/roles',
            label: 'Roles',
            options: {
              showSortButtons: true,
            },
          },
        ],
      },
      {
        type: 'Group',
        label: 'Standalone local users',
        elements: [
          {
            type: 'Control',
            scope: '#/properties/users',
            label: 'Local users',
            options: {
              elementLabelProp: 'username',
              detail: {
                type: 'HorizontalLayout',
                elements: [
                  { type: 'Control', scope: '#/properties/username', label: 'Username' },
                  { type: 'Control', scope: '#/properties/password', label: 'Password hash' },
                  { type: 'Control', scope: '#/properties/role', label: 'Role' },
                ],
              },
            },
          },
        ],
      },
    ],
  },
  secrets: [
    { path: 'apiToken', redaction: { maskedValue: '••••••', writeOnly: true, targets: ['read', 'list', 'error'] } },
    { path: 'users.*.password', redaction: { maskedValue: '••••••', writeOnly: true, targets: ['read', 'list', 'error'] } },
  ],
}

const CARD_STORAGE_OPTIONS_SCHEMA: PluginSettingsOptionsSchemaMetadata = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      databasePath: { type: 'string', title: 'Database path' },
    },
  },
  secrets: [],
}

const AUTH_POLICY_OPTIONS_SCHEMA: PluginSettingsOptionsSchemaMetadata = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      matrix: {
        type: 'object',
        title: 'Role matrix',
        additionalProperties: {
          type: 'array',
          items: { type: 'string' },
        },
      },
    },
  },
  secrets: [],
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
          optionsSchema: CARD_STORAGE_OPTIONS_SCHEMA,
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
          optionsSchema: AUTH_OPTIONS_SCHEMA,
        },
      ],
    },
  ],
}

const PLUGIN_SETTINGS_SQLITE_SELECTED_FIXTURE: PluginSettingsPayload = {
  ...PLUGIN_SETTINGS_FIXTURE,
  capabilities: [
    {
      capability: 'card.storage',
      selected: {
        capability: 'card.storage',
        providerId: 'sqlite',
        source: 'config',
      },
      providers: [
        {
          capability: 'card.storage',
          providerId: 'markdown',
          packageName: 'markdown',
          discoverySource: 'builtin',
          isSelected: false,
        },
        {
          capability: 'card.storage',
          providerId: 'sqlite',
          packageName: 'kl-plugin-storage-sqlite',
          discoverySource: 'workspace',
          isSelected: true,
          optionsSchema: CARD_STORAGE_OPTIONS_SCHEMA,
        },
      ],
    },
    PLUGIN_SETTINGS_FIXTURE.capabilities[1],
  ],
}

const PLUGIN_SETTINGS_STORAGE_ONLY_FIXTURE: PluginSettingsPayload = {
  ...PLUGIN_SETTINGS_FIXTURE,
  capabilities: [PLUGIN_SETTINGS_SQLITE_SELECTED_FIXTURE.capabilities[0]],
}

const PLUGIN_SETTINGS_AUTH_PACKAGE_FIXTURE: PluginSettingsPayload = {
  ...PLUGIN_SETTINGS_FIXTURE,
  capabilities: [
    {
      capability: 'auth.identity',
      selected: {
        capability: 'auth.identity',
        providerId: 'kl-plugin-auth',
        source: 'config',
      },
      providers: [
        {
          capability: 'auth.identity',
          providerId: 'kl-plugin-auth',
          packageName: 'kl-plugin-auth',
          discoverySource: 'workspace',
          isSelected: true,
          optionsSchema: AUTH_OPTIONS_SCHEMA,
        },
        {
          capability: 'auth.identity',
          providerId: 'rbac',
          packageName: 'kl-plugin-auth',
          discoverySource: 'workspace',
          isSelected: false,
        },
      ],
    },
    {
      capability: 'auth.policy',
      selected: {
        capability: 'auth.policy',
        providerId: 'kl-plugin-auth',
        source: 'config',
      },
      providers: [
        {
          capability: 'auth.policy',
          providerId: 'kl-plugin-auth',
          packageName: 'kl-plugin-auth',
          discoverySource: 'workspace',
          isSelected: true,
          optionsSchema: AUTH_POLICY_OPTIONS_SCHEMA,
        },
        {
          capability: 'auth.policy',
          providerId: 'rbac',
          packageName: 'kl-plugin-auth',
          discoverySource: 'workspace',
          isSelected: false,
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
    ...AUTH_OPTIONS_SCHEMA,
    secrets: [
      { path: 'apiToken', redaction: PLUGIN_SETTINGS_FIXTURE.redaction },
      { path: 'users.*.password', redaction: PLUGIN_SETTINGS_FIXTURE.redaction },
    ],
  },
  options: {
    values: {
      apiToken: '••••••',
      roles: ['user', 'manager', 'admin'],
      users: [{ username: 'alice', password: '••••••', role: 'admin' }],
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
  optionsSchema: CARD_STORAGE_OPTIONS_SCHEMA,
  options: {
    values: {
      databasePath: '.kanban/kanban.db',
    },
    redactedPaths: [],
    redaction: PLUGIN_SETTINGS_FIXTURE.redaction,
  },
}

const INACTIVE_CARD_STORAGE_PROVIDER_FIXTURE: PluginSettingsProviderTransport = {
  capability: 'card.storage',
  providerId: 'sqlite',
  packageName: 'kl-plugin-storage-sqlite',
  discoverySource: 'workspace',
  selected: {
    capability: 'card.storage',
    providerId: 'markdown',
    source: 'default',
  },
  optionsSchema: CARD_STORAGE_OPTIONS_SCHEMA,
  options: null,
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
  applyPluginSchemaDefaults,
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

  it('renders the Plugin Options tab with provider switches and a selected plugin detail view', () => {
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
    expect(markup).toContain('Capabilities')
    expect(markup).toContain('markdown')
    expect(markup).toContain('kl-plugin-auth')
    expect(markup).toContain('auth.identity')
    expect(markup).toContain('Provider: local')
    expect(markup).toContain('Built-in')
    expect(markup).toContain('Dependency')
    expect(markup).toContain('role="switch"')
    expect(markup).not.toContain('Activate')
    expect(markup).toContain('Install package')
    expect(markup).not.toContain('Package name')
    expect(markup).not.toContain('Global install')
    expect(markup).not.toContain('Install safely')
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

    expect(authMarkup).toContain('auth.identity')
    expect(authMarkup).toContain('Provider: local')
    expect(authMarkup).toContain('Options')
    expect(authMarkup).toContain('API token')
    expect(authMarkup).toContain('Roles')
    expect(authMarkup).toContain('Local users')
    expect(authMarkup).toContain('Save options')
    expect(authMarkup).toContain('Stored secret values reopen masked')
    expect(authMarkup).toContain('card-jsonforms')
    expect(authMarkup).toContain('array-table-layout')
    expect(authMarkup).toContain('Add to Roles')
    expect(authMarkup).toContain('button-add')
    expect(authMarkup).toContain('button-up')
    expect(authMarkup).toContain('button-down')
    expect(authMarkup).toContain('button-delete')
    expect(authMarkup).toContain('Delete')

    const storageMarkup = renderToStaticMarkup(
      <SettingsPanel
        isOpen
        settings={{ ...DEFAULT_CARD_SETTINGS }}
        workspace={null}
        pluginSettings={PLUGIN_SETTINGS_STORAGE_ONLY_FIXTURE}
        pluginSettingsProvider={CARD_STORAGE_PROVIDER_FIXTURE}
        initialTab="pluginOptions"
        onClose={() => {}}
        onSave={() => {}}
      />
    )

    expect(storageMarkup).toContain('card.storage')
    expect(storageMarkup).toContain('Provider: sqlite')
    expect(storageMarkup).toContain('Options')
    expect(storageMarkup).toContain('Database path')
    expect(storageMarkup).not.toContain('Stored secret values reopen masked')
  })

  it('renders schema-driven provider options even when the provider is not currently enabled', () => {
    const markup = renderToStaticMarkup(
      <SettingsPanel
        isOpen
        settings={{ ...DEFAULT_CARD_SETTINGS }}
        workspace={null}
        pluginSettings={PLUGIN_SETTINGS_FIXTURE}
        pluginSettingsProvider={INACTIVE_CARD_STORAGE_PROVIDER_FIXTURE}
        initialTab="pluginOptions"
        onClose={() => {}}
        onSave={() => {}}
      />
    )

    expect(markup).toContain('kl-plugin-storage-sqlite')
    expect(markup).toContain('card.storage')
    expect(markup).toContain('Provider: sqlite · Off')
    expect(markup).toContain('Database path')
    expect(markup).toContain('Save to persist these options and switch this capability to the provider.')
  })

  it('styles table-array add and delete controls for primitive lists', () => {
    const css = readFileSync(new URL('../assets/main.css', import.meta.url), 'utf8')

    expect(css).toContain('.card-jsonforms .array-table-layout > header button')
    expect(css).toContain('.card-jsonforms .array-table-layout tbody td:last-child button')
  })

  it('groups plugin capabilities by namespace and keeps options outside the capability cards', () => {
    const markup = renderToStaticMarkup(
      <SettingsPanel
        isOpen
        settings={{ ...DEFAULT_CARD_SETTINGS }}
        workspace={null}
        pluginSettings={PLUGIN_SETTINGS_AUTH_PACKAGE_FIXTURE}
        pluginSettingsProvider={{
          ...AUTH_PROVIDER_FIXTURE,
          capability: 'auth.identity',
          providerId: 'kl-plugin-auth',
          packageName: 'kl-plugin-auth',
          selected: {
            capability: 'auth.identity',
            providerId: 'kl-plugin-auth',
            source: 'config',
          },
        }}
        initialTab="pluginOptions"
        onClose={() => {}}
        onSave={() => {}}
      />
    )

    expect(markup).toContain('2 capabilities')
    expect(markup).toContain('auth.identity')
    expect(markup).toContain('auth.policy')
    expect(markup).not.toContain('Provider: rbac')
    expect(markup).not.toContain('Role matrix')
    expect((markup.match(/Save options/g) ?? []).length).toBe(1)
    expect(markup.lastIndexOf('Options')).toBeGreaterThan(markup.indexOf('Capabilities'))
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

  it('applies default role catalogs when provider options omit them', () => {
    const data = applyPluginSchemaDefaults(AUTH_OPTIONS_SCHEMA.schema, {
      users: [{ username: 'alice', password: '••••••', role: 'admin' }],
    })

    expect(data.roles).toEqual(['user', 'manager', 'admin'])
    expect(data.users).toEqual([{ username: 'alice', password: '••••••', role: 'admin' }])
  })

  it('renders sanitized install feedback without dumping raw command details', () => {
    const markup = renderToStaticMarkup(
      <SettingsPanel
        isOpen
        settings={{ ...DEFAULT_CARD_SETTINGS }}
        workspace={null}
        pluginSettingsInstall={INSTALL_RESULT_FIXTURE}
        pluginSettingsError="Use an exact package name like kl-plugin-auth."
        initialTab="pluginOptions"
        onClose={() => {}}
        onSave={() => {}}
      />
    )

    expect(markup).toContain('Install plugin package')
    expect(markup).toContain('Package name')
    expect(markup).toContain('Global install')
    expect(markup).toContain('Install safely')
    expect(markup).toContain('Installed plugin package with lifecycle scripts disabled.')
    expect(markup).toContain('Use an exact package name like kl-plugin-auth.')
    expect(markup).not.toContain('--ignore-scripts')
  })
})
