import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { optionsSchemas as callbackOptionsSchemas } from '../../../../kl-plugin-callback/src/index'
import type {
  CardDisplaySettings,
  PluginSettingsInstallTransportResult,
  PluginSettingsOptionsSchemaMetadata,
  PluginSettingsPayload,
  PluginSettingsProviderTransport,
  SettingsSupport,
} from '../../shared/types'

vi.mock('./JsonFormsCodeEditorControl', () => ({
  JsonFormsCodeEditorControl: () => <div className="kl-jsonforms-code-editor" />,
  jsonFormsCodeEditorTester: (uischema: { options?: { editor?: string } } | undefined) => uischema?.options?.editor === 'code' ? 5 : -1,
}))

const DEFAULT_CARD_SETTINGS: CardDisplaySettings = {
  showPriorityBadges: true,
  showAssignee: true,
  showDueDate: true,
  showLabels: true,
  showBuildWithAI: true,
  showFileName: false,
  cardViewMode: 'large',
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
  drawerPosition: 'right',
}

const STANDALONE_SETTINGS_SUPPORT: SettingsSupport = {
  showBuildWithAI: false,
  markdownEditorMode: false,
  drawerPosition: true,
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
    description: 'SQLite provider options stay in config, while runtime secrets still belong in the environment.',
    additionalProperties: false,
    properties: {
      databasePath: {
        type: 'string',
        title: 'Database path',
        description: 'Relative or absolute path to the SQLite database file.',
      },
    },
  },
  secrets: [],
}

const AUTH_POLICY_OPTIONS_SCHEMA: PluginSettingsOptionsSchemaMetadata = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      permissions: {
        type: 'array',
        title: 'Role matrix',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            role: { type: 'string', title: 'Role' },
            actions: {
              type: 'array',
              title: 'Allowed actions',
              items: { type: 'string', title: 'Action' },
            },
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
        label: 'Role matrix',
        elements: [
          {
            type: 'Control',
            scope: '#/properties/permissions',
            label: 'Permission rules',
            options: {
              elementLabelProp: 'role',
              showSortButtons: true,
              detail: {
                type: 'VerticalLayout',
                elements: [
                  { type: 'Control', scope: '#/properties/role', label: 'Role' },
                  { type: 'Control', scope: '#/properties/actions', label: 'Allowed actions', options: { showSortButtons: true } },
                ],
              },
            },
          },
        ],
      },
    ],
  },
  secrets: [],
}

const CALLBACK_OPTIONS_SCHEMA: PluginSettingsOptionsSchemaMetadata = (() => {
  const metadata = callbackOptionsSchemas.callbacks()
  const handlers = (metadata.schema.properties as Record<string, Record<string, unknown>>).handlers
  const items = handlers.items as Record<string, unknown>
  const properties = items.properties as Record<string, Record<string, unknown>>
  const events = properties.events as Record<string, unknown>
  const eventItems = events.items as Record<string, unknown>

  eventItems.enum = ['task.created', 'task.updated', 'task.deleted']

  return metadata
})()

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

const PLUGIN_SETTINGS_CALLBACK_FIXTURE: PluginSettingsPayload = {
  redaction: PLUGIN_SETTINGS_FIXTURE.redaction,
  capabilities: [
    {
      capability: 'callback.runtime',
      selected: {
        capability: 'callback.runtime',
        providerId: 'callbacks',
        source: 'config',
      },
      providers: [
        {
          capability: 'callback.runtime',
          providerId: 'callbacks',
          packageName: 'kl-plugin-callback',
          discoverySource: 'workspace',
          isSelected: true,
          optionsSchema: CALLBACK_OPTIONS_SCHEMA,
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

const CALLBACK_PROVIDER_FIXTURE: PluginSettingsProviderTransport = {
  capability: 'callback.runtime',
  providerId: 'callbacks',
  packageName: 'kl-plugin-callback',
  discoverySource: 'workspace',
  selected: {
    capability: 'callback.runtime',
    providerId: 'callbacks',
    source: 'config',
  },
  optionsSchema: CALLBACK_OPTIONS_SCHEMA,
  options: {
    values: {
      handlers: [
        {
          name: 'inline-created',
          type: 'inline',
          events: ['task.created'],
          enabled: true,
          source: 'async ({ event, sdk }) => {\n  console.log(event.event, Boolean(sdk))\n}',
        },
        {
          name: 'process-created',
          type: 'process',
          events: ['task.created'],
          enabled: true,
          command: 'node',
          args: ['worker.cjs', '--stdin'],
          cwd: '.kanban/callbacks',
        },
      ],
    },
    redactedPaths: [],
    redaction: PLUGIN_SETTINGS_FIXTURE.redaction,
  },
}

const AUTH_POLICY_PROVIDER_FIXTURE: PluginSettingsProviderTransport = {
  capability: 'auth.policy',
  providerId: 'kl-plugin-auth',
  packageName: 'kl-plugin-auth',
  discoverySource: 'workspace',
  selected: {
    capability: 'auth.policy',
    providerId: 'kl-plugin-auth',
    source: 'config',
  },
  optionsSchema: AUTH_POLICY_OPTIONS_SCHEMA,
  options: {
    values: {
      permissions: [{ role: 'admin', actions: ['*'] }],
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
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-label="Settings"')
    expect(markup).toContain('aria-label="Close settings"')
    expect(markup).toContain('Capabilities')
    expect(markup).toContain('markdown')
    expect(markup).toContain('kl-plugin-auth')
    expect(markup).toContain('data-testid="plugin-package-kl-plugin-auth"')
    expect(markup).toContain('auth.identity')
    expect(markup).toContain('Provider: local')
    expect(markup).toContain('Built-in')
    expect(markup).toContain('Dependency')
    expect(markup).toContain('role="switch"')
    expect(markup).toContain('aria-label="Toggle auth.identity provider local"')
    expect(markup).not.toContain('Activate')
    expect(markup).toContain('Install package')
    expect(markup).not.toContain('Package name')
    expect(markup).not.toContain('Global install')
    expect(markup).not.toContain('Install safely')
  })

  it('renders settings controls for shared config fields and hides unsupported extension-only controls when requested', () => {
    const supportedMarkup = renderToStaticMarkup(
      <SettingsPanel
        isOpen
        settings={{ ...DEFAULT_CARD_SETTINGS, showBuildWithAI: false, markdownEditorMode: true }}
        workspace={null}
        onClose={() => {}}
        onSave={() => {}}
      />
    )

    expect(supportedMarkup).toContain('Show Build with AI')
    expect(supportedMarkup).toContain('Markdown Editor Mode')
    expect(supportedMarkup).toContain('Drawer Position')

    const unsupportedMarkup = renderToStaticMarkup(
      <SettingsPanel
        isOpen
        settings={{ ...DEFAULT_CARD_SETTINGS, showBuildWithAI: true, markdownEditorMode: true }}
        settingsSupport={STANDALONE_SETTINGS_SUPPORT}
        workspace={null}
        onClose={() => {}}
        onSave={() => {}}
      />
    )

    expect(unsupportedMarkup).not.toContain('Show Build with AI')
    expect(unsupportedMarkup).not.toContain('Markdown Editor Mode')
    expect(unsupportedMarkup).toContain('Drawer Position')
  })

  it('renders current-board title and action editors in the board settings tab', () => {
    const titleMarkup = renderToStaticMarkup(
      <SettingsPanel
        isOpen
        settings={{ ...DEFAULT_CARD_SETTINGS }}
        workspace={null}
        initialTab="board"
        initialBoardSubTab="title"
        boardMeta={{
          ticketId: { highlighted: true },
          region: { highlighted: false },
        }}
        boardTitle={['ticketId', 'region']}
        boardActions={{
          deploy: 'Deploy now',
          rollback: 'Rollback release',
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    )

    expect(titleMarkup).toContain('Title')
    expect(titleMarkup).toContain('Actions')
    expect(titleMarkup).toContain('Title Template')
    expect(titleMarkup).toContain('ticketId')
    expect(titleMarkup).toContain('region')

    const actionsMarkup = renderToStaticMarkup(
      <SettingsPanel
        isOpen
        settings={{ ...DEFAULT_CARD_SETTINGS }}
        workspace={null}
        initialTab="board"
        initialBoardSubTab="actions"
        boardMeta={{
          ticketId: { highlighted: true },
          region: { highlighted: false },
        }}
        boardTitle={['ticketId', 'region']}
        boardActions={{
          deploy: 'Deploy now',
          rollback: 'Rollback release',
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    )

    expect(actionsMarkup).toContain('Board Actions')
    expect(actionsMarkup).toContain('deploy')
    expect(actionsMarkup).toContain('Deploy now')
    expect(actionsMarkup).toContain('rollback')
    expect(actionsMarkup).toContain('Rollback release')
  })

  it('renders the remaining routed board settings sub-tabs', () => {
    const previousLabelDefs = storeState.labelDefs
    const previousCards = storeState.cards

    try {
      storeState.labelDefs = {
        urgent: { color: '#ef4444', group: 'Priority' },
      }
      storeState.cards = [{
        version: 1,
        id: 'card-1',
        status: 'backlog',
        priority: 'medium',
        assignee: null,
        dueDate: null,
        created: '2026-03-18T00:00:00.000Z',
        modified: '2026-03-18T00:00:00.000Z',
        completedAt: null,
        labels: ['urgent'],
        attachments: [],
        comments: [],
        order: 'a0',
        content: '# Card',
        filePath: '/tmp/card-1.md',
      }]

      const defaultsMarkup = renderToStaticMarkup(
        <SettingsPanel
          isOpen
          settings={{ ...DEFAULT_CARD_SETTINGS }}
          workspace={null}
          initialTab="board"
          initialBoardSubTab="defaults"
          onClose={() => {}}
          onSave={() => {}}
        />
      )

      expect(defaultsMarkup).toContain('Default Priority')
      expect(defaultsMarkup).toContain('Default Status')

      const labelsMarkup = renderToStaticMarkup(
        <SettingsPanel
          isOpen
          settings={{ ...DEFAULT_CARD_SETTINGS }}
          workspace={null}
          initialTab="board"
          initialBoardSubTab="labels"
          onClose={() => {}}
          onSave={() => {}}
        />
      )

      expect(labelsMarkup).toContain('Labels')
      expect(labelsMarkup).toContain('urgent')
      expect(labelsMarkup).toContain('Priority')

      const metadataMarkup = renderToStaticMarkup(
        <SettingsPanel
          isOpen
          settings={{ ...DEFAULT_CARD_SETTINGS }}
          workspace={null}
          initialTab="board"
          initialBoardSubTab="meta"
          boardMeta={{
            ticketId: { highlighted: true, description: 'Ticket number' },
          }}
          onClose={() => {}}
          onSave={() => {}}
        />
      )

      expect(metadataMarkup).toContain('Metadata Fields')
      expect(metadataMarkup).toContain('ticketId')
      expect(metadataMarkup).toContain('Add field')
    } finally {
      storeState.labelDefs = previousLabelDefs
      storeState.cards = previousCards
    }
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
    expect(authMarkup).toContain('data-testid="plugin-options-form-auth.identity-local"')
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
    expect(storageMarkup).toContain('data-testid="plugin-options-section-card.storage-sqlite"')
    expect(storageMarkup).toContain('data-testid="plugin-options-form-card.storage-sqlite"')
    expect(storageMarkup).toContain('SQLite provider options stay in config, while runtime secrets still belong in the environment.')
    expect(storageMarkup).toContain('Relative or absolute path to the SQLite database file.')
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

  it('renders mixed callback handlers through the shared plugin options JSON Forms path', () => {
    const markup = renderToStaticMarkup(
      <SettingsPanel
        isOpen
        settings={{ ...DEFAULT_CARD_SETTINGS }}
        workspace={null}
        pluginSettings={PLUGIN_SETTINGS_CALLBACK_FIXTURE}
        pluginSettingsProvider={CALLBACK_PROVIDER_FIXTURE}
        initialTab="pluginOptions"
        onClose={() => {}}
        onSave={() => {}}
      />
    )

    expect(markup).toContain('callback.runtime')
    expect(markup).toContain('Provider: callbacks')
    expect(markup).toContain('Callback handlers')
    expect(markup).toContain('Handlers')
    expect(markup).toContain('Inline JavaScript')
    expect(markup).toContain('Command')
    expect(markup).toContain('Arguments')
    expect(markup).toContain('Working directory')
    expect(markup).toContain('Add to Handlers')
    expect(markup).toContain('button-up')
    expect(markup).toContain('button-down')
    expect(markup).toContain('button-delete')
    expect(markup).toContain('card-jsonforms')
    expect(markup).toContain('shared CodeMirror-backed editor inside plugin settings')
    expect(markup).toContain('kl-jsonforms-code-editor')
  })

  it('prefers the routed capability-provider id when choosing the active plugin detail view', () => {
    const markup = renderToStaticMarkup(
      <SettingsPanel
        isOpen
        settings={{ ...DEFAULT_CARD_SETTINGS }}
        workspace={null}
        pluginSettings={PLUGIN_SETTINGS_FIXTURE}
        initialTab="pluginOptions"
        activePluginId="kl-plugin-storage-sqlite"
        onClose={() => {}}
        onSave={() => {}}
      />
    )

    expect(markup).toContain('kl-plugin-storage-sqlite')
    expect(markup).toContain('Provider: sqlite')
    expect(markup).not.toContain('Provider: local')
  })

  it('styles table-array add and delete controls for primitive lists', () => {
    const css = readFileSync(new URL('../assets/main.css', import.meta.url), 'utf8')

    expect(css).toContain('.card-jsonforms .array-table-layout > header button')
    expect(css).toContain('.card-jsonforms .array-table-layout tbody td:last-child button')
  })

  it('styles valid helper text separately from validation errors in shared plugin forms', () => {
    const css = readFileSync(new URL('../assets/main.css', import.meta.url), 'utf8')

    expect(css).toContain('.card-jsonforms .validation.input-description')
    expect(css).toContain('.card-jsonforms .validation.validation_error')
  })

  it('groups same-package providers under one entry and scopes options to the selected provider', () => {
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

    expect(markup).toContain('data-testid="plugin-package-kl-plugin-auth"')
    expect(markup).toContain('auth.identity')
    expect(markup).toContain('auth.policy')
    expect(markup).toContain('API token')
    expect(markup).not.toContain('Provider: rbac')
    expect((markup.match(/Save options/g) ?? []).length).toBe(1)
    expect(markup.lastIndexOf('Options')).toBeGreaterThan(markup.indexOf('Capabilities'))
  })

  it('groups same-package provider variants under one entry showing all capabilities', () => {
    const markup = renderToStaticMarkup(
      <SettingsPanel
        isOpen
        settings={{ ...DEFAULT_CARD_SETTINGS }}
        workspace={null}
        pluginSettings={PLUGIN_SETTINGS_AUTH_PACKAGE_FIXTURE}
        pluginSettingsProvider={AUTH_POLICY_PROVIDER_FIXTURE}
        initialTab="pluginOptions"
        activePluginId="kl-plugin-auth"
        onClose={() => {}}
        onSave={() => {}}
      />
    )

    expect(markup).toContain('data-testid="plugin-package-kl-plugin-auth"')
    expect(markup).toContain('auth.identity')
    expect(markup).toContain('auth.policy')
    expect(markup).toContain('Role matrix')
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

  it('renders arrays of string enums as toggle chips instead of a row-per-item table', () => {
    const ENUM_ARRAY_SCHEMA: PluginSettingsOptionsSchemaMetadata = {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          events: {
            type: 'array',
            title: 'Allowed events',
            uniqueItems: true,
            items: {
              type: 'string',
              title: 'Event',
              enum: ['task.created', 'task.updated', 'task.deleted'],
            },
          },
        },
      },
      secrets: [],
    }
    const ENUM_ARRAY_PROVIDER: PluginSettingsProviderTransport = {
      capability: 'callback.runtime',
      providerId: 'chips',
      packageName: 'kl-plugin-callback',
      discoverySource: 'workspace',
      selected: { capability: 'callback.runtime', providerId: 'chips', source: 'config' },
      optionsSchema: ENUM_ARRAY_SCHEMA,
      options: {
        values: { events: ['task.created', 'task.updated'] },
        redactedPaths: [],
        redaction: PLUGIN_SETTINGS_FIXTURE.redaction,
      },
    }
    const ENUM_ARRAY_PAYLOAD: PluginSettingsPayload = {
      redaction: PLUGIN_SETTINGS_FIXTURE.redaction,
      capabilities: [
        {
          capability: 'callback.runtime',
          selected: { capability: 'callback.runtime', providerId: 'chips', source: 'config' },
          providers: [
            {
              capability: 'callback.runtime',
              providerId: 'chips',
              packageName: 'kl-plugin-callback',
              discoverySource: 'workspace',
              isSelected: true,
              optionsSchema: ENUM_ARRAY_SCHEMA,
            },
          ],
        },
      ],
    }

    const markup = renderToStaticMarkup(
      <SettingsPanel
        isOpen
        settings={{ ...DEFAULT_CARD_SETTINGS }}
        workspace={null}
        pluginSettings={ENUM_ARRAY_PAYLOAD}
        pluginSettingsProvider={ENUM_ARRAY_PROVIDER}
        initialTab="pluginOptions"
        onClose={() => {}}
        onSave={() => {}}
      />
    )

    expect(markup).toContain('kl-jsonforms-enum-array')
    expect(markup).toContain('kl-jsonforms-enum-array__chip')
    expect(markup).toContain('kl-jsonforms-enum-array__chip--selected')
    expect(markup).toContain('task.created')
    expect(markup).toContain('task.updated')
    expect(markup).toContain('task.deleted')
    expect(markup).toContain('2 of 3')
    expect(markup).toContain('aria-pressed="true"')
    expect(markup).toContain('aria-pressed="false"')
    expect(markup).not.toContain('Add to Allowed events')
  })
})
