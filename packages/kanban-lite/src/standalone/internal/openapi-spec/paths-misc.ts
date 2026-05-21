import {
  pluginCapabilityParam,
  pluginProviderIdParam,
  labelNameParam,
} from './params'

const logsFilterSchema = {
  type: 'object' as const,
  description: 'Persisted log-panel filter preferences.',
  properties: {
    limit: {
      description: 'Maximum number of log entries to display, or `all` for no limit.',
      oneOf: [
        { type: 'integer' as const },
        { type: 'string' as const, enum: ['all'] as const },
      ],
    },
    order: {
      type: 'string' as const,
      enum: ['asc', 'desc'] as const,
      description: 'Log sort order.',
    },
    disabledSources: {
      type: 'array' as const,
      items: { type: 'string' as const },
      description: 'Log sources hidden from the view.',
    },
    show: {
      type: 'object' as const,
      description: 'Per-column visibility toggles for the log view.',
      properties: {
        timestamp: { type: 'boolean' as const, description: 'Show the timestamp column when true.' },
        source: { type: 'boolean' as const, description: 'Show the source column when true.' },
        objects: { type: 'boolean' as const, description: 'Show structured JSON payloads when true.' },
      },
    },
  },
}

const settingsUpdateBodySchema = {
  type: 'object' as const,
  description: 'Any subset of `CardDisplaySettings`. Only provided fields are changed.',
  properties: {
    showPriorityBadges: { type: 'boolean' as const, description: 'Show colored priority badges on task cards.' },
    showAssignee: { type: 'boolean' as const, description: 'Show assignee names on task cards.' },
    showDueDate: { type: 'boolean' as const, description: 'Show due dates on task cards.' },
    showLabels: { type: 'boolean' as const, description: 'Show labels/tags on task cards.' },
    showBuildWithAI: { type: 'boolean' as const, description: 'Show the Build with AI action where supported.' },
    showFileName: { type: 'boolean' as const, description: 'Show the source filename on task cards.' },
    cardViewMode: {
      type: 'string' as const,
      enum: ['compact', 'normal', 'large', 'xlarge', 'xxlarge'] as const,
      description: 'Card detail density preset used on the board surface.',
    },
    markdownEditorMode: { type: 'boolean' as const, description: 'Use the markdown editor when editing task content.' },
    showDeletedColumn: { type: 'boolean' as const, description: 'Show the hidden Deleted column in the board UI.' },
    defaultPriority: {
      type: 'string' as const,
      enum: ['critical', 'high', 'medium', 'low'] as const,
      description: 'Default priority assigned to newly created tasks.',
    },
    defaultStatus: { type: 'string' as const, description: 'Default status/column assigned to newly created tasks.' },
    boardZoom: { type: 'number' as const, description: 'Board zoom percentage (75–150).' },
    cardZoom: { type: 'number' as const, description: 'Card detail zoom percentage (75–150).' },
    columnWidth: { type: 'number' as const, description: 'Preferred board column width in pixels.' },
    boardBackgroundMode: {
      type: 'string' as const,
      enum: ['fancy', 'plain'] as const,
      description: 'Whether the board uses a fancy or plain background preset.',
    },
    boardBackgroundPreset: {
      type: 'string' as const,
      enum: ['aurora', 'sunset', 'meadow', 'nebula', 'lagoon', 'candy', 'ember', 'violet', 'paper', 'mist', 'sand'] as const,
      description: 'Selected board background preset within the active background mode.',
    },
    panelMode: {
      type: 'string' as const,
      enum: ['popup', 'drawer'] as const,
      description: 'Whether task details open as a popup or a drawer.',
    },
    drawerWidth: { type: 'number' as const, description: 'Drawer width as a percentage of the viewport when drawer mode is active.' },
    drawerPosition: {
      type: 'string' as const,
      enum: ['right', 'left', 'top', 'bottom'] as const,
      description: 'Drawer anchor edge when panel mode is `drawer`.',
    },
    logsFilter: logsFilterSchema,
  },
}

export const miscPaths = {
    '/api/health': {
      get: {
        tags: ['Workspace'],
        summary: 'Get server health',
        description: 'Returns a lightweight standalone runtime health payload including the default/current board context and workspace root.',
        responses: { 200: { description: 'Standalone health status payload.' } },
      },
    },
    '/api/webview-sync': {
      post: {
        tags: ['Workspace'],
        summary: 'Sync webview messages',
        description: 'Replays one or more serialized webview messages through the standalone server so browser clients can hydrate with the same SDK-backed mutation semantics as the extension host.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  message: { description: 'Single serialized webview message payload.' },
                  messages: {
                    type: 'array',
                    description: 'Ordered array of serialized webview message payloads.',
                    items: {},
                  },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Normalized synced webview messages.' },
          400: { description: 'Invalid or empty webview message payload.' },
        },
      },
    },
    '/api/columns': {
      get: {
        tags: ['Columns'],
        summary: 'List columns',
        description: 'Returns the ordered column definitions for the default board.',
        responses: { 200: { description: 'Column list.' } },
      },
      post: {
        tags: ['Columns'],
        summary: 'Add column',
        description: "Creates a new column on the default board. New columns are appended to the end of the board's current column order.",
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string', description: 'Display name.' },
                  color: { type: 'string', description: 'Hex color (default: `#6b7280`).' },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Created.' }, 400: { description: 'Validation error.' } },
      },
    },
    '/api/columns/reorder': {
      put: {
        tags: ['Columns'],
        summary: 'Reorder columns',
        description: 'Reorders the columns for the specified board (or default board if `boardId` is omitted).',
        parameters: [{ name: 'boardId', in: 'query' as const, schema: { type: 'string' as const }, description: 'Target board ID (uses default if omitted).' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['columnIds'],
                properties: {
                  columnIds: { type: 'array', items: { type: 'string' }, description: 'Ordered array of column IDs.' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Reordered columns.' }, 400: { description: 'Error.' } },
      },
    },
    '/api/columns/minimized': {
      put: {
        tags: ['Columns'],
        summary: 'Set minimized columns',
        description: 'Sets which columns are minimized for the specified board (or default board if `boardId` is omitted).',
        parameters: [{ name: 'boardId', in: 'query' as const, schema: { type: 'string' as const }, description: 'Target board ID (uses default if omitted).' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['columnIds'],
                properties: {
                  columnIds: { type: 'array', items: { type: 'string' }, description: 'IDs of columns to minimize.' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Updated minimized columns.' }, 400: { description: 'Error.' } },
      },
    },
    '/api/columns/{id}': {
      put: {
        tags: ['Columns'],
        summary: 'Update column',
        description: "Updates a column's display name and/or color on the default board.",
        parameters: [{ name: 'id', in: 'path' as const, required: true as const, schema: { type: 'string' as const }, description: 'Column identifier.' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'New display name.' },
                  color: { type: 'string', description: 'New hex color.' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Updated column.' }, 404: { description: 'Not found.' } },
      },
      delete: {
        tags: ['Columns'],
        summary: 'Delete column',
        description: 'Deletes a column on the default board. Fails if the column still contains tasks.',
        parameters: [{ name: 'id', in: 'path' as const, required: true as const, schema: { type: 'string' as const }, description: 'Column identifier.' }],
        responses: { 200: { description: 'Deleted.' }, 400: { description: 'Column not empty.' } },
      },
    },
    // ------------------------------------------------------------------
    // Settings
    // ------------------------------------------------------------------
    '/api/settings': {
      get: {
        tags: ['Settings'],
        summary: 'Get settings',
        description: "Returns the workspace's current display and behavior settings used by the UI surfaces.",
        responses: { 200: { description: 'Settings object.' } },
      },
      put: {
        tags: ['Settings'],
        summary: 'Update settings',
        description: 'Updates workspace display settings and immediately broadcasts the change to connected WebSocket clients.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: settingsUpdateBodySchema,
            },
          },
        },
        responses: { 200: { description: 'Updated settings.' }, 400: { description: 'Error.' } },
      },
    },
    '/api/plugin-settings': {
      get: {
        tags: ['Plugins'],
        summary: 'List plugin providers',
        description: 'Returns the capability-grouped plugin inventory with selected-provider state and shared redaction metadata. `config.storage` rows include configured-versus-effective resolution details, including explicit failure or degraded/read-only state when the SDK reports one. Secret values are never included in this list payload. When auth is active, callers must be authenticated and allowed to perform `plugin-settings.read`; redaction supplements authorization rather than replacing it.',
        responses: {
          200: { description: 'Capability-grouped plugin inventory.' },
          401: { description: 'Authentication required.' },
          403: { description: 'Authenticated caller is not allowed to perform `plugin-settings.read`.' },
          500: { description: 'Unable to list plugin settings.' },
        },
      },
    },
    '/api/plugin-settings/{capability}/{providerId}': {
      get: {
        tags: ['Plugins'],
        summary: 'Read plugin settings',
        description: 'Returns the redacted plugin-settings read model for one provider. `config.storage` reads include configured-versus-effective resolution details so clients can distinguish explicit configured state from the current effective provider and any surfaced failure/degraded mode. Persisted secret fields are masked and surfaced only as write-only placeholders. When auth is active, callers must be authenticated and allowed to perform `plugin-settings.read`; allowed reads remain redacted.',
        parameters: [pluginCapabilityParam, pluginProviderIdParam],
        responses: {
          200: { description: 'Redacted provider read model.' },
          401: { description: 'Authentication required.' },
          403: { description: 'Authenticated caller is not allowed to perform `plugin-settings.read`.' },
          404: { description: 'Provider not found for the requested capability.' },
          500: { description: 'Unable to read plugin settings.' },
        },
      },
    },
    '/api/plugin-settings/{capability}/{providerId}/select': {
      put: {
        tags: ['Plugins'],
        summary: 'Select plugin provider',
        description: 'Persists the selected provider for one capability. Existing authorization wrappers remain in force for this privileged mutation. For `config.storage`, Worker topology-changing updates are rejected as explicit runtime-mutation errors instead of silently swapping the effective provider.',
        parameters: [pluginCapabilityParam, pluginProviderIdParam],
        responses: {
          200: { description: 'Updated redacted provider read model after selection.' },
          400: { description: 'Rejected runtime mutation or invalid request payload.' },
          403: { description: 'Forbidden.' },
          404: { description: 'Provider not found for the requested capability.' },
          500: { description: 'Unable to persist the selected provider.' },
        },
      },
    },
    '/api/plugin-settings/{capability}/{providerId}/options': {
      put: {
        tags: ['Plugins'],
        summary: 'Update plugin options',
        description: 'Persists provider options and returns the redacted provider read model. Secret placeholders may be submitted unchanged to preserve existing stored secrets. `config.storage` responses continue to surface configured-versus-effective resolution and any explicit failure/degraded state reported by the SDK.',
        parameters: [pluginCapabilityParam, pluginProviderIdParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object' as const,
                properties: {
                  options: {
                    type: 'object' as const,
                    description: 'Provider options payload to persist under the selected capability/provider pair.',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Updated redacted provider read model after persisting options.' },
          400: { description: 'Invalid options payload or rejected runtime mutation.' },
          403: { description: 'Forbidden.' },
          404: { description: 'Provider not found for the requested capability.' },
          500: { description: 'Unable to persist plugin options.' },
        },
      },
    },
    '/api/plugin-settings/install': {
      post: {
        tags: ['Plugins'],
        summary: 'Install plugin package',
        description: 'Runs the guarded in-product installer for exact unscoped `kl-*` package names only. Responses surface redacted diagnostics and never expose raw installer stdout/stderr.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object' as const,
                required: ['packageName', 'scope'],
                properties: {
                  packageName: { type: 'string' as const, description: 'Exact unscoped `kl-*` package name.' },
                  scope: { type: 'string' as const, enum: ['workspace', 'global'] as const, description: 'Install destination.' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Redacted install result.' },
          400: { description: 'Rejected input or redacted install failure.' },
          403: { description: 'Forbidden.' },
          500: { description: 'Unexpected installer error.' },
        },
      },
    },
    // ------------------------------------------------------------------
    // Labels
    // ------------------------------------------------------------------
    '/api/labels': {
      get: {
        tags: ['Labels'],
        summary: 'List labels',
        description: 'Returns all label definitions with their colors and groups.',
        responses: { 200: { description: 'Label map.' } },
      },
    },
    '/api/labels/{name}': {
      put: {
        tags: ['Labels'],
        summary: 'Set label',
        description: 'Creates or updates a label definition (color and optional group).',
        parameters: [labelNameParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['color'],
                properties: {
                  color: { type: 'string', description: 'Hex color string.' },
                  group: { type: 'string', description: 'Optional group name.' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Updated label map.' }, 400: { description: 'Error.' } },
      },
      patch: {
        tags: ['Labels'],
        summary: 'Rename label',
        description: 'Renames a label and cascades the change to all cards that use it.',
        parameters: [labelNameParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['newName'],
                properties: { newName: { type: 'string', description: 'New label name.' } },
              },
            },
          },
        },
        responses: { 200: { description: 'Updated label map after rename.' }, 400: { description: 'Error.' } },
      },
      delete: {
        tags: ['Labels'],
        summary: 'Delete label',
        description: 'Deletes a label definition and removes it from all cards that reference it.',
        parameters: [labelNameParam],
        responses: { 200: { description: 'Deleted.' }, 400: { description: 'Error.' } },
      },
    },
    // ------------------------------------------------------------------
    // Workspace
    // ------------------------------------------------------------------
    '/api/card-state/status': {
      get: {
        tags: ['Workspace'],
        summary: 'Get card-state status',
        description: 'Returns the active `card.state` provider status for the standalone runtime, including backend family, availability, the stable auth-absent default actor contract, and whether a configured `auth.identity` provider is currently causing `identity-unavailable` failures.',
        responses: { 200: { description: 'Card-state provider status.' } },
      },
    },
    '/api/workspace': {
      get: {
        tags: ['Workspace'],
        summary: 'Get workspace info',
        description: 'Returns workspace-level connection metadata plus resolved storage, auth, webhook, and `card.state` provider information, including filesystem watcher support and the configured-versus-effective `config.storage` resolution state.',
        responses: { 200: { description: 'Workspace info.' } },
      },
    },
    '/api/auth': {
      get: {
        tags: ['Workspace'],
        summary: 'Get auth status',
        description: 'Returns auth provider metadata plus safe request-scoped token diagnostics for the current standalone HTTP request.',
        responses: { 200: { description: 'Auth status.' } },
      },
    },
    '/api/storage': {
      get: {
        tags: ['Workspace'],
        summary: 'Get storage status',
        description: 'Returns the active storage providers plus host-facing file/watch metadata and the configured-versus-effective `config.storage` resolution, including explicit failure or degraded/read-only state when present.',
        responses: { 200: { description: 'Storage status.' } },
      },
    },
    '/api/events': {
      get: {
        tags: ['Workspace'],
        summary: 'List available events',
        description: 'Returns discoverable SDK events, including built-in before/after events and any plugin-declared additions. Supports filtering by phase and wildcard mask.',
        parameters: [
          {
            name: 'type',
            in: 'query' as const,
            schema: { type: 'string' as const, enum: ['before', 'after', 'all'] as const },
            description: 'Optional event phase filter. Defaults to `all`.',
          },
          {
            name: 'mask',
            in: 'query' as const,
            schema: { type: 'string' as const },
            description: 'Optional EventEmitter2-style wildcard mask such as `task.*` or `comment.**`.',
          },
        ],
        responses: {
          200: {
            description: 'Available event descriptors.',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/AvailableEventDescriptor' },
                },
              },
            },
          },
          400: { description: 'Invalid type filter.' },
        },
      },
    },
    '/api/storage/migrate-to-sqlite': {
      post: {
        tags: ['Workspace'],
        summary: 'Migrate to SQLite',
        description: 'Migrates cards from the built-in markdown provider to the first-party `sqlite` compatibility provider (`kl-plugin-storage-sqlite`) and updates compatibility config fields in `.kanban.json`. This endpoint does not migrate into arbitrary external providers.',
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  sqlitePath: { type: 'string', description: 'Optional database path relative to workspace root.' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Migration result.' }, 400: { description: 'Error.' } },
      },
    },
    '/api/storage/migrate-to-markdown': {
      post: {
        tags: ['Workspace'],
        summary: 'Migrate to Markdown',
        description: 'Migrates cards from the built-in SQLite provider back to markdown files and updates compatibility config fields. Existing source data is left in place as a manual backup.',
        responses: { 200: { description: 'Migration result.' }, 400: { description: 'Error.' } },
      },
    },
    '/api/resolve-path': {
      get: {
        tags: ['Workspace'],
        summary: 'Resolve path',
        description: 'Resolves a workspace-relative, absolute, or `~`-prefixed path to its canonical absolute filesystem path.',
        parameters: [
          { name: 'path', in: 'query' as const, required: true as const, schema: { type: 'string' as const }, description: 'Path to resolve.' },
        ],
        responses: { 200: { description: 'Resolved absolute path.' }, 400: { description: 'Path parameter missing.' } },
      },
    },
}
