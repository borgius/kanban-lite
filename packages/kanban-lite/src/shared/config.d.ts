import type { KanbanColumn, CardDisplaySettings, Priority, LabelDefinition } from './types';
/** Capability namespaces supported by the storage plugin system. */
export type CapabilityNamespace = 'card.storage' | 'attachment.storage';
/** Provider selection for a capability namespace. */
export interface ProviderRef {
    /** Provider id (for built-ins this is e.g. `'localfs'`, `'sqlite'`, `'mysql'`). */
    provider: string;
    /** Provider-specific configuration passed through to the plugin implementation. */
    options?: Record<string, unknown>;
}
/** Partial capability selections from config or constructor overrides. */
export type CapabilitySelections = Partial<Record<CapabilityNamespace, ProviderRef>>;
/** Fully normalized capability selections used at runtime. */
export type ResolvedCapabilities = Record<CapabilityNamespace, ProviderRef>;
/** Capability namespace supported by the card-state provider system. */
export type CardStateCapabilityNamespace = 'card.state';
/** Partial card-state capability selections from config. */
export type CardStateCapabilitySelections = Partial<Record<CardStateCapabilityNamespace, ProviderRef>>;
/** Fully normalized card-state capability selections used at runtime. */
export type ResolvedCardStateCapabilities = Record<CardStateCapabilityNamespace, ProviderRef>;
/** Capability namespaces supported by the auth plugin system. */
export type AuthCapabilityNamespace = 'auth.identity' | 'auth.policy';
/** Partial auth capability selections from config or constructor overrides. */
export type AuthCapabilitySelections = Partial<Record<AuthCapabilityNamespace, ProviderRef>>;
/** Fully normalized auth capability selections used at runtime. */
export type ResolvedAuthCapabilities = Record<AuthCapabilityNamespace, ProviderRef>;
/** Capability namespace for the webhook delivery provider. */
export type WebhookCapabilityNamespace = 'webhook.delivery';
/** Partial webhook capability selections from config or constructor overrides. */
export type WebhookCapabilitySelections = Partial<Record<WebhookCapabilityNamespace, ProviderRef>>;
/** Fully normalized webhook capability selections used at runtime. */
export type ResolvedWebhookCapabilities = Record<WebhookCapabilityNamespace, ProviderRef>;
/** Capability namespaces surfaced by the plugin settings inventory and selection flows. */
export type PluginCapabilityNamespace = CapabilityNamespace | CardStateCapabilityNamespace | AuthCapabilityNamespace | WebhookCapabilityNamespace;
/** Stable ordered capability list reused by plugin settings hosts and tests. */
export declare const PLUGIN_CAPABILITY_NAMESPACES: readonly PluginCapabilityNamespace[];
/** Partial plugin capability selections keyed by the full plugin settings namespace set. */
export type PluginCapabilitySelections = Partial<Record<PluginCapabilityNamespace, ProviderRef>>;
/** Integration surfaces a plugin package may contribute beyond capability providers. */
export type PluginIntegrationNamespace = 'standalone.http' | 'cli' | 'mcp.tools' | 'sdk.extension' | 'event.listener';
/**
 * Standard package-level manifest that every first-party plugin exports as
 * `pluginManifest`.  The engine reads this for fast, reliable capability
 * discovery instead of duck-typing individual exports.
 */
export interface KLPluginPackageManifest {
    /** Package identifier — typically the npm package name. */
    readonly id: string;
    /**
     * Capabilities provided, keyed by namespace.
     * Value is an array of provider IDs offered for that capability.
     */
    readonly capabilities: Partial<Record<PluginCapabilityNamespace, readonly string[]>>;
    /**
     * Optional integration surfaces this package contributes.
     */
    readonly integrations?: readonly PluginIntegrationNamespace[];
}
/**
 * A registered webhook endpoint that receives event notifications.
 *
 * Webhooks are stored in the workspace `.kanban.json` config file and
 * are fired asynchronously whenever a matching event occurs.
 */
export interface Webhook {
    /** Unique identifier (e.g., `'wh_a1b2c3d4e5f67890'`). */
    id: string;
    /** The HTTP(S) URL that receives POST requests with event payloads. */
    url: string;
    /** Event names to subscribe to (e.g., `['task.created']`), or `['*']` for all events. */
    events: string[];
    /** Optional HMAC-SHA256 signing key for payload verification. */
    secret?: string;
    /** Whether this webhook is active. Inactive webhooks are skipped during delivery. */
    active: boolean;
}
/**
 * Configuration for a single kanban board.
 *
 * Each board has its own set of columns and default status/priority values.
 * Boards are stored as entries in the {@link KanbanConfig.boards} record.
 */
export interface BoardConfig {
    /** Human-readable name of the board. */
    name: string;
    /** Optional description of the board's purpose. */
    description?: string;
    /** Ordered list of columns displayed on this board. */
    columns: KanbanColumn[];
    /**
     * @deprecated Card IDs are now allocated from the workspace-level
     * `nextCardId` counter to ensure uniqueness across all boards.
     * This field is kept for backward compatibility with existing config files
     * and is no longer incremented during card creation.
     */
    nextCardId: number;
    /** Default column/status for newly created cards on this board. */
    defaultStatus: string;
    /** Default priority for newly created cards on this board. */
    defaultPriority: Priority;
    /** Named board-level actions available in the toolbar. Map of action key to display title. */
    actions?: Record<string, string>;
    /** Metadata keys that are always shown in the card detail panel (before the Advanced section). */
    metadata?: string[];
    /** Metadata keys whose rendered values prefix card display titles in user-visible surfaces. */
    title?: string[];
    /** Column IDs currently minimized (shown as a narrow rail) on this board. */
    minimizedColumnIds?: string[];
}
/**
 * A reusable named form definition stored in the workspace config.
 *
 * When declared under {@link KanbanConfig.forms}, a form is available for
 * attachment to any card on any board in the workspace. Card-local
 * attachments may override or extend these definitions per card.
 *
 * Merge order for initial data (lowest → highest priority):
 * 1. `FormDefinition.data` — workspace-level defaults from this interface
 * 2. `CardFormAttachment.data` — card-scoped attachment defaults
 * 3. `Card.formData[id]` — per-card persisted form data (may be partial at rest)
 * 4. `Card.metadata` — card metadata fields whose keys appear in the schema
 *
 * Sources 1–3 are preprocessed with `${path}` placeholder interpolation against
 * the full card context before the merge. Placeholders that cannot be resolved
 * (missing or `undefined` keys) are replaced with an empty string.
 */
export interface FormDefinition {
    /**
     * Human-readable form name shown in the UI.
     * Defaults to a capitalized version of the form key when omitted.
     */
    name?: string;
    /**
     * Optional explanatory text shown in the card form header.
     * Defaults to an empty string.
     */
    description?: string;
    /** JSON Schema object describing the data shape for AJV validation. */
    schema: Record<string, unknown>;
    /** Optional JSON Forms UI schema for layout/rendering hints. */
    ui?: Record<string, unknown>;
    /**
     * Optional default field values applied as the base layer when computing
     * initial form state before card-level data and metadata are merged in.
     */
    data?: Record<string, unknown>;
}
/**
 * Root configuration object for the kanban workspace (v2 format).
 *
 * Supports multiple boards via the {@link boards} record. When read from
 * disk, v1 configs are automatically migrated to this v2 format.
 * Persisted as `.kanban.json` in the workspace root.
 */
export interface KanbanConfig {
    /** Schema version, always `2` for the current format. */
    version: 2;
    /** Map of board IDs to their configurations. */
    boards: Record<string, BoardConfig>;
    /** ID of the board to use when none is explicitly specified. */
    defaultBoard: string;
    /** Directory (relative to workspace root) where card files are stored. */
    kanbanDirectory: string;
    /** AI agent identifier used for the "Build with AI" feature. */
    aiAgent: string;
    /** Global default priority for new cards (used as fallback). */
    defaultPriority: Priority;
    /** Global default status/column for new cards (used as fallback). */
    defaultStatus: string;
    /** Whether to show colored priority badges on cards. */
    showPriorityBadges: boolean;
    /** Whether to display the assignee on cards. */
    showAssignee: boolean;
    /** Whether to display the due date on cards. */
    showDueDate: boolean;
    /** Whether to display labels/tags on cards. */
    showLabels: boolean;
    /** Whether to show the "Build with AI" action on cards. */
    showBuildWithAI: boolean;
    /** Whether to display the source filename on cards. */
    showFileName: boolean;
    /** Whether to use a compact card layout with reduced spacing. */
    compactMode: boolean;
    /** Whether to use the markdown editor when editing card content. */
    markdownEditorMode: boolean;
    /** Whether to show the deleted column in the UI. */
    showDeletedColumn: boolean;
    /** Zoom level for the board view (75–150). */
    boardZoom: number;
    /** Zoom level for the card detail panel (75–150). */
    cardZoom: number;
    /** Whether the board canvas uses a plain or fancy background preset. */
    boardBackgroundMode: import('./types').BoardBackgroundMode;
    /** Selected board background preset within the active background mode. */
    boardBackgroundPreset: import('./types').BoardBackgroundPreset;
    /** Port number for the standalone HTTP server. */
    port: number;
    /** Registered webhook endpoints for event notifications. */
    webhooks?: Webhook[];
    /** Label definitions keyed by label name, with color and optional group. */
    labels?: Record<string, LabelDefinition>;
    /**
     * @deprecated Removed in favour of the webhook plugin. Register a webhook
     * for the `card.action.triggered` event instead.
     */
    actionWebhookUrl?: string;
    /**
     * Global auto-increment card ID counter shared across all boards.
     * Ensures every card gets a unique numeric ID regardless of which board
     * it is created on.
     */
    nextCardId: number;
    /** Whether panels open as a centered popup or a right-side drawer. */
    panelMode?: 'popup' | 'drawer';
    /** Width of the right-side drawer as a percentage of the viewport (20–80). Default 50. */
    drawerWidth?: number;
    /** Persisted log panel filter preferences. */
    logsFilter?: {
        limit: number | 'all';
        order: 'asc' | 'desc';
        disabledSources: string[];
        show: {
            timestamp: boolean;
            source: boolean;
            objects: boolean;
        };
    };
    /**
      * Legacy card-storage selector kept for backward compatibility.
      * - `'markdown'` (legacy alias for the default `localfs` provider) — cards stored as individual `.md` files
      * - `'sqlite'` — cards/comments stored in a SQLite database file
      *
      * Prefer {@link plugins} for new configuration. When both forms are present,
      * `plugins['card.storage']` takes precedence at runtime.
     */
    storageEngine?: 'markdown' | 'sqlite';
    /**
      * Path to the SQLite database file when `storageEngine` is `'sqlite'`.
     * Relative paths are resolved from the workspace root.
     * @default '.kanban/kanban.db'
      *
      * This field is also kept for backward compatibility. Prefer
      * `plugins['card.storage'].options.sqlitePath` in new configs.
     */
    sqlitePath?: string;
    /**
      * Optional capability-based storage provider selections.
     * When present, these override legacy `storageEngine` / `sqlitePath` for the
     * matching namespaces while preserving backward-compatible defaults for any
     * omitted namespaces (`localfs` for `card.storage` and `attachment.storage`).
       *
       * Built-in attachment providers `sqlite` and `mysql` are additive opt-ins.
       * They require the matching `card.storage` provider and do not change the
       * legacy omitted-default behavior, which remains `attachment.storage: localfs`.
       *
       * Auth capabilities (`auth.identity`, `auth.policy`) can also be declared
       * here using the npm package name as the provider id (e.g.
       * `"provider": "kl-plugin-auth"`). When present they take precedence over
       * any value in the legacy {@link auth} key.
     */
    plugins?: PluginCapabilitySelections;
    /**
     * Legacy auth provider selections.
     * @deprecated Prefer declaring `auth.identity` and `auth.policy` inside the
     * `plugins` key using the package name as provider id. This field is still
     * supported for backward compatibility but `plugins` takes precedence.
     */
    auth?: AuthCapabilitySelections;
    /**
     * Named reusable form definitions available on all boards in the workspace.
     * Cards attach forms by name via {@link Card.forms} and store their own
     * submitted data under {@link Card.formData}.
     *
     * @example
     * { "bug-report": { schema: { type: "object", properties: { title: { type: "string" } } } } }
     */
    forms?: Record<string, import('./config').FormDefinition>;
    /**
     * Optional webhook provider selection.
     * @deprecated Prefer declaring `webhook.delivery` inside the `plugins` key.
     * This field is still supported for backward compatibility but `plugins` takes precedence.
     */
    webhookPlugin?: WebhookCapabilitySelections;
    /** Raw HTML string injected into the standalone board's `<head>` element. Useful for analytics snippets, custom CSS, or guided-tour scripts. Only applies to the standalone server UI. */
    customHeadHtml?: string;
    /** Path to an HTML file (relative to workspace root) whose content is injected into the standalone board's `<head>` element. Takes precedence over `customHeadHtml`. */
    customHeadHtmlFile?: string;
    /**
     * Optional URL base path prefix for subfolder reverse-proxy deployments
     * (e.g. `'/kanban'`). Must start with `/` and have no trailing slash.
     * When set, all asset URLs, the WebSocket endpoint, and API routes are
     * served under this prefix. Only applies to the standalone server.
     */
    basePath?: string;
}
/**
 * Default configuration used when no `.kanban.json` file exists or when
 * fields are missing from an existing config. Includes a single `'default'`
 * board with the standard five columns.
 */
export declare const DEFAULT_CONFIG: KanbanConfig;
/**
 * The filename used for the kanban configuration file: `'.kanban.json'`.
 */
export declare const CONFIG_FILENAME = ".kanban.json";
/**
 * Returns the absolute path to the `.kanban.json` config file for a workspace.
 *
 * @param workspaceRoot - Absolute path to the workspace root directory.
 * @returns Absolute path to the config file.
 *
 * @example
 * configPath('/home/user/my-project')
 * // => '/home/user/my-project/.kanban.json'
 */
export declare function configPath(workspaceRoot: string): string;
/**
 * Reads the kanban config from disk. If the file is missing or unreadable,
 * returns the default config. If the file contains a v1 config, it is
 * automatically migrated to v2 format and persisted back to disk.
 *
 * Any `${VAR_NAME}` placeholders found in string values are resolved against
 * `process.env` before the config is returned. If a referenced environment
 * variable is not set the process will throw a descriptive error rather than
 * silently falling back to defaults, because an unresolved secret is never a
 * safe default.
 *
 * @param workspaceRoot - Absolute path to the workspace root directory.
 * @returns The parsed (and possibly migrated) kanban configuration.
 *
 * @example
 * const config = readConfig('/home/user/my-project')
 * console.log(config.defaultBoard) // => 'default'
 */
export declare function readConfig(workspaceRoot: string): KanbanConfig;
/**
 * Writes the kanban config to disk as pretty-printed JSON.
 *
 * @param workspaceRoot - Absolute path to the workspace root directory.
 * @param config - The kanban configuration to persist.
 *
 * @example
 * const config = readConfig('/home/user/my-project')
 * config.defaultBoard = 'sprint-1'
 * writeConfig('/home/user/my-project', config)
 */
export declare function writeConfig(workspaceRoot: string, config: KanbanConfig): void;
/**
 * Returns the default board ID from the workspace config.
 *
 * @param workspaceRoot - Absolute path to the workspace root directory.
 * @returns The default board ID string (e.g. `'default'`).
 *
 * @example
 * const boardId = getDefaultBoardId('/home/user/my-project')
 * // => 'default'
 */
export declare function getDefaultBoardId(workspaceRoot: string): string;
/**
 * Returns the configuration for a specific board. If `boardId` is omitted,
 * the default board is used.
 *
 * @param workspaceRoot - Absolute path to the workspace root directory.
 * @param boardId - Optional board ID. Defaults to the workspace's default board.
 * @returns The board configuration object.
 * @throws {Error} If the resolved board ID does not exist in the config.
 *
 * @example
 * const board = getBoardConfig('/home/user/my-project', 'sprint-1')
 * console.log(board.name) // => 'Sprint 1'
 *
 * @example
 * // Uses default board
 * const board = getBoardConfig('/home/user/my-project')
 */
export declare function getBoardConfig(workspaceRoot: string, boardId?: string): BoardConfig;
/**
 * Allocates the next card ID for a board by reading and incrementing the
 * board's `nextCardId` counter. The updated config is persisted to disk.
 *
 * @param workspaceRoot - Absolute path to the workspace root directory.
 * @param boardId - Optional board ID. Defaults to the workspace's default board.
 * @returns The newly allocated numeric card ID.
 * @throws {Error} If the resolved board ID does not exist in the config.
 *
 * @example
 * const id = allocateCardId('/home/user/my-project')
 * // => 1 (first call), 2 (second call), etc.
 */
export declare function allocateCardId(workspaceRoot: string, boardId?: string): number;
/**
 * Synchronizes the board's `nextCardId` counter to be greater than all
 * existing card IDs. This prevents ID collisions when cards have been
 * created outside the normal allocation flow (e.g. manual file creation).
 *
 * Does nothing if `existingIds` is empty or the counter is already ahead.
 *
 * @param workspaceRoot - Absolute path to the workspace root directory.
 * @param boardId - The board ID to synchronize.
 * @param existingIds - Array of numeric card IDs currently present on the board.
 *
 * @example
 * syncCardIdCounter('/home/user/my-project', 'default', [1, 5, 12])
 * // Board's nextCardId is now at least 13
 */
export declare function syncCardIdCounter(workspaceRoot: string, boardId: string, existingIds: number[]): void;
/**
 * Extracts {@link CardDisplaySettings} from a {@link KanbanConfig} by
 * picking out the global display-related fields.
 *
 * @param config - The kanban configuration to extract settings from.
 * @returns A `CardDisplaySettings` object with the current display preferences.
 *
 * @example
 * const config = readConfig('/home/user/my-project')
 * const settings = configToSettings(config)
 * console.log(settings.compactMode) // => true
 */
export declare function configToSettings(config: KanbanConfig): CardDisplaySettings;
/**
 * Merges {@link CardDisplaySettings} back into a {@link KanbanConfig},
 * returning a new config object with the display fields updated.
 *
 * @param config - The existing kanban configuration to update.
 * @param settings - The display settings to merge into the config.
 * @returns A new `KanbanConfig` with the display settings applied.
 *
 * @example
 * const config = readConfig('/home/user/my-project')
 * const updated = settingsToConfig(config, { ...configToSettings(config), compactMode: true })
 * writeConfig('/home/user/my-project', updated)
 */
export declare function settingsToConfig(config: KanbanConfig, settings: CardDisplaySettings): KanbanConfig;
/**
 * Normalizes auth capability selections into a complete runtime capability map.
 *
 * Omitted auth providers default to the `noop` compatibility ids. When the
 * external `kl-plugin-auth` package is installed those ids resolve there;
 * otherwise core keeps a built-in compatibility fallback so behavior is
 * unchanged when auth is not configured.
 *
 * The input object is never mutated.
 */
export declare function normalizeAuthCapabilities(config: Pick<KanbanConfig, 'auth' | 'plugins'>): ResolvedAuthCapabilities;
/**
 * Normalizes card-state capability selections into a complete runtime capability map.
 *
 * `card.state` is first-class and defaults to the built-in `localfs` provider
 * when omitted from `.kanban.json`.
 *
 * The input object is never mutated.
 */
export declare function normalizeCardStateCapabilities(config: Pick<KanbanConfig, 'plugins'>): ResolvedCardStateCapabilities;
/**
 * Normalizes legacy storage settings plus capability-based plugin selections
 * into a complete runtime capability map.
 *
 * Precedence:
 * 1. Explicit `plugins[namespace]`
 * 2. Legacy `storageEngine` / `sqlitePath` for `card.storage`
 * 3. Backward-compatible defaults (`localfs` + `localfs`)
 *
 * Explicit built-in `attachment.storage` providers such as `sqlite` and
 * `mysql` remain opt-in. Omitting `attachment.storage` never auto-switches
 * it away from the legacy `localfs` default.
 *
 * The input object is never mutated.
 */
export declare function normalizeStorageCapabilities(config: Pick<KanbanConfig, 'storageEngine' | 'sqlitePath' | 'plugins'>): ResolvedCapabilities;
/**
 * Normalizes webhook capability selections into a complete runtime capability map.
 *
 * When no explicit provider is configured, defaults to `{ provider: 'webhooks' }`, which
 * maps to the `kl-plugin-webhook` external package via `WEBHOOK_PROVIDER_ALIASES`.
 * Core no longer provides a built-in webhook delivery fallback; hosts must install
 * that package anywhere webhook CRUD or runtime delivery is expected to work.
 *
 * The input object is never mutated.
 */
export declare function normalizeWebhookCapabilities(config: Pick<KanbanConfig, 'webhookPlugin' | 'plugins'>): ResolvedWebhookCapabilities;
