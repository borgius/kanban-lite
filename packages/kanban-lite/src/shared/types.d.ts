import type { PluginCapabilityNamespace } from './config';
/** Current card frontmatter schema version. Increment when the format changes. */
export declare const CARD_FORMAT_VERSION = 1;
/**
 * Priority level for a kanban card.
 * Cards are ranked from most urgent (`'critical'`) to least urgent (`'low'`).
 *
 * @example
 * const p: Priority = 'high'
 */
export type Priority = 'critical' | 'high' | 'medium' | 'low';
/**
 * Sort option for {@link KanbanSDK.listCards}.
 * - `'created:asc'` — oldest cards first
 * - `'created:desc'` — newest cards first
 * - `'modified:asc'` — least recently modified first
 * - `'modified:desc'` — most recently modified first
 *
 * When omitted, cards are sorted by their fractional `order` index (board order).
 */
export type CardSortOption = 'created:asc' | 'created:desc' | 'modified:asc' | 'modified:desc';
/**
 * String alias representing a column or status identifier.
 * Corresponds to the `id` field of a {@link KanbanColumn} (e.g. `'backlog'`, `'in-progress'`).

/** Transport-safe unread cursor used by UI read models. */
export interface CardStateCursorTransport {
    cursor: string;
    updatedAt?: string;
}
/** Transport-safe open-state payload for UI read models. */
export interface CardOpenStateValueTransport {
    openedAt: string;
    readThrough: CardStateCursorTransport | null;
}
/** Transport-safe generic card-state record. */
export interface CardStateRecordTransport<TValue = Record<string, unknown>> {
    actorId: string;
    boardId: string;
    cardId: string;
    domain: string;
    value: TValue;
    updatedAt: string;
}
/** Side-effect-free unread summary emitted to UI hosts. */
export interface CardUnreadSummaryTransport {
    actorId: string;
    boardId: string;
    cardId: string;
    latestActivity: CardStateCursorTransport | null;
    readThrough: CardStateCursorTransport | null;
    unread: boolean;
}
/** Minimal card-state runtime status surfaced to UI hosts. */
export interface CardStateStatusTransport {
    backend: 'builtin' | 'external' | 'none';
    availability: 'available' | 'identity-unavailable' | 'unavailable';
    configured: boolean;
    errorCode?: string;
}
/** Machine-readable UI error for card-state read/open failures. */
export interface CardStateErrorTransport {
    code: string;
    availability: 'identity-unavailable' | 'unavailable';
    message: string;
}
/** Read-only card-state metadata attached to UI card read models. */
export interface CardStateReadModelTransport {
    unread: CardUnreadSummaryTransport | null;
    open: CardStateRecordTransport<CardOpenStateValueTransport> | null;
    status: CardStateStatusTransport;
    error?: CardStateErrorTransport;
}
export type CardStatus = string;
/**
 * A single log entry attached to a kanban card.
 *
 * Logs are stored in a dedicated `<cardId>.log` text file.
 * Each line has the format: `timestamp [source] text {json}`
 */
export interface LogEntry {
    /** ISO 8601 timestamp of when the log was created. */
    timestamp: string;
    /** Source/origin of the log entry (e.g. `'default'`, `'system'`, `'ci'`). */
    source: string;
    /** Human-readable log message text. Supports inline markdown (bold, italic, emoji). */
    text: string;
    /** Optional structured data object, stored as compacted JSON. */
    object?: Record<string, unknown>;
}
/**
 * A comment attached to a kanban card.
 */
export interface Comment {
    /** Unique identifier for the comment. */
    id: string;
    /** Display name of the comment author. */
    author: string;
    /** ISO 8601 timestamp of when the comment was created. */
    created: string;
    /** Markdown body of the comment. */
    content: string;
    /**
     * When `true`, the comment is currently being streamed by an agent and has
     * not yet been fully written. The content field contains whatever has
     * accumulated so far. This field is stripped before persisting to storage.
     */
    streaming?: boolean;
}
/**
 * A kanban card with all associated metadata.
 *
 * Cards are persisted as markdown files with YAML frontmatter inside the
 * `.kanban/{status}/` directory structure.
 */
export interface Card {
    /** Card frontmatter schema version. 0 = legacy (pre-versioning). */
    version: number;
    /** Unique identifier for the card (e.g. `'42-build-dashboard'`). */
    id: string;
    /** Board this card belongs to. Omitted when only one board exists. */
    boardId?: string;
    /** Current column/status of the card. */
    status: CardStatus;
    /** Priority level of the card. */
    priority: Priority;
    /** Assignee name, or `null` if unassigned. */
    assignee: string | null;
    /** ISO 8601 due date string, or `null` if no due date is set. */
    dueDate: string | null;
    /** ISO 8601 timestamp of when the card was created. */
    created: string;
    cardState?: CardStateReadModelTransport;
    /** ISO 8601 timestamp of the last modification. */
    modified: string;
    /** ISO 8601 timestamp of when the card was moved to done, or `null`. */
    completedAt: string | null;
    /** Tags/labels attached to the card. */
    labels: string[];
    /** File paths of attachments associated with the card. */
    attachments: string[];
    /** Discussion comments on the card. */
    comments: Comment[];
    /** Fractional index (base-62) controlling sort order within a column. */
    order: string;
    /** Markdown body content of the card. */
    content: string;
    /** Arbitrary user-defined metadata stored as YAML in the frontmatter. */
    metadata?: Record<string, unknown>;
    /** Named actions that can be triggered via the action webhook. Either an array of action keys or a map of action key → display title. */
    actions?: string[] | Record<string, string>;
    /** Forms attached to this card (named config-form references or inline definitions). */
    forms?: CardFormAttachment[];
    /**
     * Per-form persisted data keyed by the resolved form `id`.
     *
     * Entries **may be partial at rest** — they may contain only a subset of the
     * form schema properties (e.g. fields the user has previously submitted or
     * pre-seeded values). The full canonical object is produced at runtime by
     * `resolveCardForms()` (SDK) or `resolveCardFormDescriptors()` (webview),
     * which merge config defaults, attachment defaults, and this stored value,
     * then apply the metadata overlay. Submit results always persist the full
     * canonical merged payload back to `card.formData[formId]`.
     */
    formData?: CardFormDataMap;
    /** Absolute path to the card's markdown file on disk. */
    filePath: string;
}
/**
 * Summary information for a kanban board.
 */
export interface BoardInfo {
    /** Unique identifier for the board. */
    id: string;
    /** Human-readable board name. */
    name: string;
    /** Optional description of the board's purpose. */
    description?: string;
    columns?: KanbanColumn[];
    /** Named board-level actions available in the toolbar. Map of action key to display title. */
    actions?: Record<string, string>;
    /** Named metadata field definitions; keys with `highlighted: true` are shown on card previews. */
    metadata?: Record<string, import('./config').BoardMetaFieldDef>;
    /** Metadata keys whose rendered values prefix card display titles in user-visible surfaces. */
    title?: string[];
    /** Reusable named workspace forms available for attachment/resolution on this board. */
    forms?: Record<string, import('./config').FormDefinition>;
}
/**
 * Extracts a title from markdown content by finding the first `# heading`.
 * Falls back to the first non-empty line if no heading is found,
 * or `'Untitled'` if the content is empty.
 *
 * @param content - Raw markdown string to extract the title from.
 * @returns The extracted title string.
 *
 * @example
 * getTitleFromContent('# My Card\nSome body text')
 * // => 'My Card'
 *
 * @example
 * getTitleFromContent('Just a line of text')
 * // => 'Just a line of text'
 */
export declare function getTitleFromContent(content: string): string;
/**
 * Returns the user-visible card title for a board by prefixing selected
 * metadata values ahead of the raw markdown-derived title.
 *
 * This helper is display-only. It does **not** modify stored markdown,
 * filename generation, or rename behavior.
 *
 * @param content - Raw markdown card content.
 * @param metadata - Optional card metadata object.
 * @param titleFields - Ordered metadata keys whose non-empty rendered values should prefix the title.
 * @returns The raw markdown title, optionally prefixed by configured metadata values.
 *
 * @example
 * getDisplayTitleFromContent('# Ship release', { ticket: 'REL-42', sprint: 'Q1' }, ['ticket', 'sprint'])
 * // => 'REL-42 Q1 Ship release'
 *
 * @example
 * getDisplayTitleFromContent('# Ship release', { ticket: 'REL-42' }, ['missing', 'ticket'])
 * // => 'REL-42 Ship release'
 */
export declare function getDisplayTitleFromContent(content: string, metadata?: Record<string, unknown>, titleFields?: readonly string[]): string;
/**
 * Creates a filename-safe slug from a title string.
 *
 * The slug is lowercased, stripped of special characters, limited to 50
 * characters, and falls back to `'card'` if the result would be empty.
 *
 * @param title - The human-readable title to slugify.
 * @returns A URL/filename-safe slug string.
 *
 * @example
 * generateSlug('Build Dashboard UI')
 * // => 'build-dashboard-ui'
 *
 * @example
 * generateSlug('Hello, World!!!')
 * // => 'hello-world'
 */
export declare function generateSlug(title: string): string;
/**
 * Converts a stable form key such as `'bug-report'` into a human-friendly
 * display name such as `'Bug Report'`.
 *
 * This is used as the default display name for reusable config-backed forms
 * when `FormDefinition.name` is omitted.
 *
 * @param formKey - Stable config form key or resolved form identifier.
 * @returns A human-readable title-cased name.
 */
export declare function formatFormDisplayName(formKey: string): string;
/**
 * Generates a card filename from an incremental numeric ID and a title.
 *
 * The filename is composed of the ID prefix followed by a slugified title
 * (e.g. `'42-build-dashboard'`).
 *
 * @param id - The numeric card ID.
 * @param title - The human-readable card title.
 * @returns A filename string in the format `'{id}-{slug}'`.
 *
 * @example
 * generateCardFilename(42, 'Build Dashboard')
 * // => '42-build-dashboard'
 */
export declare function generateCardFilename(id: number, title: string): string;
/**
 * Extracts the numeric ID prefix from a filename or card ID string.
 *
 * Looks for a leading sequence of digits optionally followed by a hyphen
 * (e.g. `'42-build-dashboard'` yields `42`).
 *
 * @param filenameOrId - A filename or card ID string such as `'42-build-dashboard'`.
 * @returns The parsed numeric ID, or `null` if no numeric prefix is found.
 *
 * @example
 * extractNumericId('42-build-dashboard')
 * // => 42
 *
 * @example
 * extractNumericId('no-number')
 * // => null
 */
export declare function extractNumericId(filenameOrId: string): number | null;
/**
 * Definition of a kanban board column.
 */
export interface KanbanColumn {
    /** Unique identifier used as the card status value (e.g. `'in-progress'`). */
    id: string;
    /** Human-readable column name displayed in the UI (e.g. `'In Progress'`). */
    name: string;
    /** CSS color string for the column header (e.g. `'#f59e0b'`). */
    color: string;
}
/**
 * The default set of five kanban columns provided when no custom columns
 * are configured: Backlog, To Do, In Progress, Review, and Done.
 *
 * @example
 * // Use as the initial column configuration
 * const config = { columns: [...DEFAULT_COLUMNS] }
 */
export declare const DEFAULT_COLUMNS: KanbanColumn[];
export declare const DELETED_STATUS_ID = "deleted";
export declare const DELETED_COLUMN: KanbanColumn;
export declare const BOARD_BACKGROUND_MODES: readonly ["fancy", "plain"];
export type BoardBackgroundMode = (typeof BOARD_BACKGROUND_MODES)[number];
export declare const FANCY_BOARD_BACKGROUND_PRESETS: readonly ["aurora", "sunset", "meadow", "nebula", "lagoon", "candy", "ember", "violet"];
export type FancyBoardBackgroundPreset = (typeof FANCY_BOARD_BACKGROUND_PRESETS)[number];
export declare const PLAIN_BOARD_BACKGROUND_PRESETS: readonly ["paper", "mist", "sand"];
export type PlainBoardBackgroundPreset = (typeof PLAIN_BOARD_BACKGROUND_PRESETS)[number];
export type BoardBackgroundPreset = FancyBoardBackgroundPreset | PlainBoardBackgroundPreset;
export declare const DEFAULT_BOARD_BACKGROUND_MODE: BoardBackgroundMode;
export declare const DEFAULT_FANCY_BOARD_BACKGROUND_PRESET: FancyBoardBackgroundPreset;
export declare const DEFAULT_PLAIN_BOARD_BACKGROUND_PRESET: PlainBoardBackgroundPreset;
export declare function getDefaultBoardBackgroundPreset(mode: BoardBackgroundMode): BoardBackgroundPreset;
export declare function isBoardBackgroundPresetForMode(mode: BoardBackgroundMode, preset: BoardBackgroundPreset): boolean;
export declare function normalizeBoardBackgroundSettings(mode?: BoardBackgroundMode, preset?: BoardBackgroundPreset): {
    boardBackgroundMode: BoardBackgroundMode;
    boardBackgroundPreset: BoardBackgroundPreset;
};
/**
 * UI display preferences controlling which card fields are visible and
 * how the board renders cards.
 */
export interface CardDisplaySettings {
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
    /** Whether to display the hidden Deleted column on the board. */
    showDeletedColumn: boolean;
    /** The default priority assigned to newly created cards. */
    defaultPriority: Priority;
    /** The default column/status assigned to newly created cards. */
    defaultStatus: string;
    /** Zoom level for the board view as a percentage (75–150). Default 100. */
    boardZoom: number;
    /** Zoom level for the card detail panel as a percentage (75–150). Default 100. */
    cardZoom: number;
    /** Whether the board canvas uses a plain or fancy background preset. Default `fancy`. */
    boardBackgroundMode: BoardBackgroundMode;
    /** Selected board background preset within the active background mode. */
    boardBackgroundPreset: BoardBackgroundPreset;
    /** Whether panels open as a centered popup or a right-side drawer. Default 'drawer'. */
    panelMode?: 'popup' | 'drawer';
    /** Width of the right-side drawer as a percentage of the viewport (20–80). Default 50. */
    drawerWidth?: number;
    /** Persisted log panel filter preferences. */
    logsFilter?: {
        limit: number | 'all';
        order: 'asc' | 'desc';
        /** Sources hidden from the log view (stored as array, default includes 'system'). */
        disabledSources: string[];
        show: {
            timestamp: boolean;
            source: boolean;
            objects: boolean;
        };
    };
}
export interface LabelDefinition {
    color: string;
    group?: string;
}
export declare const LABEL_PRESET_COLORS: {
    name: string;
    hex: string;
}[];
/**
 * A form attached to a card, referencing a named workspace-config form
 * and/or declaring an inline card-local form definition.
 *
 * Either `name` (to reference a config-level form) or `schema` (for an inline
 * definition) must be present. When both are given, the inline `schema` takes
 * precedence over the config-level schema, but other config fields (e.g.
 * `data`) still act as the base layer for the merge order.
 */
export interface CardFormAttachment {
    /**
     * Name of a reusable form declared in `KanbanConfig.forms`.
     * When present, the resolved descriptor sources schema/ui/data from config
     * unless overridden by inline fields on this attachment.
     */
    name?: string;
    /**
     * Inline JSON Schema for a card-local form.
     * Required when no `name` is provided.
     */
    schema?: Record<string, unknown>;
    /** Optional JSON Forms UI schema for layout/rendering hints. */
    ui?: Record<string, unknown>;
    /**
     * Optional attachment-level default data merged after the config-level
     * `FormDefinition.data` and before persisted `Card.formData` values.
     */
    data?: Record<string, unknown>;
}
/**
 * Per-form persisted data map used in {@link Card.formData} and transport payloads.
 *
 * Keys are resolved form IDs; values are the stored form field records.
 *
 * **Partial-at-rest semantics:** Individual form records may omit fields — they
 * represent only the stored delta, not the full canonical form state. The
 * prepared runtime object (`ResolvedFormDescriptor.initialData`) is always the
 * full canonical shape produced by merging config defaults, attachment defaults,
 * this stored record, and card metadata. String values in stored records may
 * contain `${path}` placeholders that are resolved at preparation time via
 * `prepareFormData()` from `src/shared/formDataPreparation`.
 */
export type CardFormDataMap = Record<string, Record<string, unknown>>;
/**
 * Normalized runtime descriptor for a form attached to a card.
 *
 * Produced by SDK resolution from a {@link CardFormAttachment} combined with
 * the backing config {@link FormDefinition} (if any). All downstream layers
 * — REST API, CLI, MCP, and the webview — work with this shape rather than
 * the raw attachment or config definition directly.
 */
export interface ResolvedFormDescriptor {
    /**
     * Stable identifier for this form on the card.
     * - For named config forms: equals the config form name.
     * - For inline forms: a deterministic slug derived from the schema `title`
     *   property, falling back to a positional index (e.g. `'form-0'`).
     */
    id: string;
    /**
     * Human-readable form name used for tab headings and display.
     * Falls back to a capitalized config key for reusable forms or to the
     * inline schema title / resolved id for inline forms.
     *
     * Optional for backward compatibility with external consumers. Always
     * populated by SDK resolution at runtime.
     */
    name?: string;
    /**
     * Human-readable description shown in the card form header.
     * Defaults to an empty string.
     *
     * Optional for backward compatibility with external consumers. Always
     * populated by SDK resolution at runtime.
     */
    description?: string;
    /**
     * Legacy alias for {@link name} kept for downstream compatibility.
     */
    label: string;
    /** Resolved JSON Schema for AJV validation and JSON Forms rendering. */
    schema: Record<string, unknown>;
    /** Resolved JSON Forms UI schema, if any. */
    ui?: Record<string, unknown>;
    /**
     * Fully prepared initial data for the form — always the **canonical full
     * object**, never a partial stored snapshot.
     *
     * Produced by merging (lowest → highest priority):
     * 1. Config-level `FormDefinition.data` (workspace defaults)
     * 2. Attachment-level `CardFormAttachment.data` (card-scoped defaults)
     * 3. `Card.formData[id]` (persisted per-card data, which may be partial at rest)
     * 4. `Card.metadata` fields whose keys appear in the schema `properties`
     *
     * Before the merge, string values in each source layer are prepared via
     * `prepareFormData()` (from `src/shared/formDataPreparation`), which resolves
     * `${path}` placeholders against the full card interpolation context.
     */
    initialData: Record<string, unknown>;
    /** `true` when this descriptor was sourced from a named config form. */
    fromConfig: boolean;
}
/**
 * YAML frontmatter fields stored at the top of each card's markdown file.
 *
 * These fields are parsed from and serialized back to the frontmatter block
 * when reading/writing card files.
 */
export interface CardFrontmatter {
    /** Card frontmatter schema version. 0 = legacy (pre-versioning). */
    version: number;
    /** Unique card identifier. */
    id: string;
    /** Board this card belongs to. Present when multiple boards exist. */
    boardId?: string;
    /** Current column/status of the card. */
    status: string;
    /** Priority level of the card. */
    priority: Priority;
    /** Assignee name, or `null` if unassigned. */
    assignee: string | null;
    /** ISO 8601 due date, or `null` if none. */
    dueDate: string | null;
    /** ISO 8601 creation timestamp. */
    created: string;
    /** ISO 8601 last-modified timestamp. */
    modified: string;
    /** ISO 8601 completion timestamp, or `null` if not completed. */
    completedAt: string | null;
    /** Tags/labels attached to the card. */
    labels: string[];
    /** File paths of attachments. */
    attachments: string[];
    /** Fractional index (base-62) for ordering within a column. */
    order: string;
    /** Arbitrary user-defined metadata stored as YAML in the frontmatter. */
    metadata?: Record<string, unknown>;
    /** Named actions that can be triggered via the action webhook. Either an array of action keys or a map of action key → display title. */
    actions?: string[] | Record<string, string>;
    /** Forms attached to this card (named config-form references or inline definitions). */
    forms?: CardFormAttachment[];
    /**
     * Per-form persisted data keyed by the resolved form `id`.
     * Using a form-keyed map prevents field collisions when multiple forms
     * share property names across different tabs.
     */
    formData?: CardFormDataMap;
}
/**
 * Read-only workspace information displayed in the settings panel.
 */
export interface WorkspaceInfo {
    projectPath: string;
    kanbanDirectory: string;
    port: number;
    configVersion: number;
}
/** Discovery locations surfaced for plugin provider inventory rows. */
export type PluginSettingsDiscoverySource = 'builtin' | 'workspace' | 'dependency' | 'global' | 'sibling';
/** Origin of the currently selected provider for a capability row. */
export type PluginSettingsSelectionSource = 'config' | 'legacy' | 'default' | 'none';
/** Surfaces that must never echo raw secret values back to callers. */
export type PluginSettingsRedactionTarget = 'read' | 'list' | 'error';
/** Supported install destinations for in-product plugin installation flows. */
export type PluginSettingsInstallScope = 'workspace' | 'global';
/** Shared secret redaction policy reused across SDK, REST, CLI, MCP, and host transports. */
export interface PluginSettingsRedactionPolicy {
    maskedValue: string;
    writeOnly: true;
    targets: readonly PluginSettingsRedactionTarget[];
}
/** Metadata for a single secret field declared by a provider options schema. */
export interface PluginSettingsSecretFieldMetadata {
    path: string;
    redaction: PluginSettingsRedactionPolicy;
}
/** Transport-safe provider options schema plus secret-field annotations. */
export interface PluginSettingsOptionsSchemaMetadata {
    schema: Record<string, unknown>;
    uiSchema?: Record<string, unknown>;
    secrets: PluginSettingsSecretFieldMetadata[];
}
/** Selected-provider state for a capability. Enablement is represented only by provider selection. */
export interface PluginSettingsSelectedState {
    capability: PluginCapabilityNamespace;
    providerId: string | null;
    source: PluginSettingsSelectionSource;
}
/** Provider inventory row surfaced inside a capability group. */
export interface PluginSettingsProviderRow {
    capability: PluginCapabilityNamespace;
    providerId: string;
    packageName: string;
    discoverySource: PluginSettingsDiscoverySource;
    isSelected: boolean;
    optionsSchema?: PluginSettingsOptionsSchemaMetadata;
}
/** Capability-group row for plugin settings inventory and selection surfaces. */
export interface PluginSettingsCapabilityRow {
    capability: PluginCapabilityNamespace;
    selected: PluginSettingsSelectedState;
    providers: PluginSettingsProviderRow[];
}
/** Shared plugin settings payload shape used by SDK-facing hosts and transports. */
export interface PluginSettingsPayload {
    capabilities: PluginSettingsCapabilityRow[];
    redaction: PluginSettingsRedactionPolicy;
}
/** Redacted provider options readback for plugin settings detail/list flows. */
export interface PluginSettingsRedactedValues {
    values: Record<string, unknown>;
    redactedPaths: string[];
    redaction: PluginSettingsRedactionPolicy;
}
/** Redacted provider detail payload reused by SDK, REST, CLI, MCP, and hosts. */
export interface PluginSettingsReadPayload {
    capability: PluginCapabilityNamespace;
    providerId: string;
    selected: PluginSettingsSelectedState;
    options: PluginSettingsRedactedValues | null;
}
/** Canonical redacted error payload for plugin settings operations. */
export interface PluginSettingsErrorPayload {
    code: string;
    message: string;
    capability?: PluginCapabilityNamespace;
    providerId?: string;
    details?: Record<string, unknown>;
    redaction: PluginSettingsRedactionPolicy;
}
/** Install request contract accepted by SDK-facing plugin management surfaces. */
export interface PluginSettingsInstallRequest {
    packageName: string;
    scope: PluginSettingsInstallScope;
}
/** Host-transport provider detail payload reused across VS Code and standalone bridges. */
export interface PluginSettingsProviderTransport extends PluginSettingsReadPayload, Pick<PluginSettingsProviderRow, 'packageName' | 'discoverySource' | 'optionsSchema'> {
}
/** Fixed npm argv install command surfaced through plugin host transports. */
export interface PluginSettingsInstallCommandTransport {
    command: 'npm';
    args: string[];
    cwd: string;
    shell: false;
}
/** Redacted install success payload surfaced through plugin host transports. */
export interface PluginSettingsInstallTransportResult {
    packageName: string;
    scope: PluginSettingsInstallScope;
    command: PluginSettingsInstallCommandTransport;
    stdout: string;
    stderr: string;
    message: string;
    redaction: PluginSettingsRedactionPolicy;
}
/** Plugin-settings actions routed through shared host/webview bridges. */
export type PluginSettingsTransportAction = 'read' | 'select' | 'updateOptions' | 'install';
/** Shared settings payload emitted when the settings modal opens. */
export interface ShowSettingsMessage {
    type: 'showSettings';
    settings: CardDisplaySettings;
    pluginSettings: PluginSettingsPayload;
}
/** Shared plugin-settings result message emitted by both host bridges. */
export interface PluginSettingsResultMessage {
    type: 'pluginSettingsResult';
    action: PluginSettingsTransportAction;
    pluginSettings?: PluginSettingsPayload;
    provider?: PluginSettingsProviderTransport | null;
    install?: PluginSettingsInstallTransportResult;
    error?: PluginSettingsErrorPayload;
}
/** Empty plugin-settings payload used when a host has no active SDK context. */
export declare function createEmptyPluginSettingsPayload(redaction: PluginSettingsRedactionPolicy): PluginSettingsPayload;
/**
 * Shared create-card payload used by REST and webview transport surfaces.
 *
 * This remains backward compatible with existing card creation flows while
 * allowing form-aware cards to be created without a second ad-hoc payload
 * shape.
 */
export interface CreateCardPayload {
    status: string;
    priority: Priority;
    content: string;
    assignee: string | null;
    dueDate: string | null;
    labels: string[];
    metadata?: Record<string, unknown>;
    actions?: string[] | Record<string, string>;
    forms?: CardFormAttachment[];
    formData?: CardFormDataMap;
}
/**
 * Webview transport request for submitting a form attached to a card.
 */
export interface SubmitFormMessage {
    type: 'submitForm';
    cardId: string;
    formId: string;
    data: Record<string, unknown>;
    callbackKey: string;
    boardId?: string;
}
/**
 * Transport-safe result for a successful form submission.
 * Mirrors the SDK `submitForm` contract while keeping shared types decoupled
 * from the SDK module graph.
 */
export interface SubmitFormTransportResult {
    boardId: string;
    card: Omit<Card, 'filePath'>;
    form: ResolvedFormDescriptor;
    data: Record<string, unknown>;
}
/**
 * Standalone transport lifecycle status emitted to the frontend.
 *
 * This is produced by the standalone shim only; the native VS Code webview
 * path does not emit these messages.
 */
export interface ConnectionStatusMessage {
    type: 'connectionStatus';
    connected: boolean;
    reconnecting: boolean;
    fatal: boolean;
    retryCount?: number;
    maxRetries?: number;
    retryDelayMs?: number;
    reason?: string;
}
export type ExtensionMessage = {
    type: 'init';
    cards: Card[];
    columns: KanbanColumn[];
    settings: CardDisplaySettings;
    boards?: BoardInfo[];
    currentBoard?: string;
    workspace?: WorkspaceInfo;
    labels?: Record<string, LabelDefinition>;
    minimizedColumnIds?: string[];
} | ConnectionStatusMessage | {
    type: 'cardsUpdated';
    cards: Card[];
} | {
    type: 'triggerCreateDialog';
} | {
    type: 'cardContent';
    cardId: string;
    content: string;
    frontmatter: CardFrontmatter;
    comments: Comment[];
    logs?: LogEntry[];
} | ShowSettingsMessage | PluginSettingsResultMessage | {
    type: 'labelsUpdated';
    labels: Record<string, LabelDefinition>;
} | {
    type: 'actionResult';
    callbackKey: string;
    error?: string;
} | {
    type: 'boardActionResult';
    callbackKey: string;
    error?: string;
} | {
    type: 'submitFormResult';
    callbackKey: string;
    result?: SubmitFormTransportResult;
    error?: string;
} | {
    type: 'logsUpdated';
    cardId: string;
    logs: import('./types').LogEntry[];
} | {
    type: 'boardLogsUpdated';
    boardId: string;
    logs: import('./types').LogEntry[];
} | {
    type: 'commentStreamStart';
    cardId: string;
    commentId: string;
    author: string;
    created: string;
} | {
    type: 'commentChunk';
    cardId: string;
    commentId: string;
    chunk: string;
} | {
    type: 'commentStreamDone';
    cardId: string;
    commentId: string;
} | {
    type: 'cardStates';
    states: Record<string, CardStateReadModelTransport>;
};
export type WebviewMessage = {
    type: 'ready';
} | {
    type: 'createCard';
    data: CreateCardPayload;
} | {
    type: 'moveCard';
    cardId: string;
    newStatus: string;
    newOrder: number;
} | {
    type: 'deleteCard';
    cardId: string;
} | {
    type: 'updateCard';
    cardId: string;
    updates: Partial<Card>;
} | {
    type: 'openCard';
    cardId: string;
} | {
    type: 'saveCardContent';
    cardId: string;
    content: string;
    frontmatter: CardFrontmatter;
} | {
    type: 'closeCard';
} | {
    type: 'openFile';
    cardId: string;
} | {
    type: 'addAttachment';
    cardId: string;
} | {
    type: 'openAttachment';
    cardId: string;
    attachment: string;
} | {
    type: 'removeAttachment';
    cardId: string;
    attachment: string;
} | {
    type: 'openSettings';
} | {
    type: 'loadPluginSettings';
} | {
    type: 'readPluginSettings';
    capability: PluginCapabilityNamespace;
    providerId: string;
} | {
    type: 'selectPluginSettingsProvider';
    capability: PluginCapabilityNamespace;
    providerId: string;
} | {
    type: 'updatePluginSettingsOptions';
    capability: PluginCapabilityNamespace;
    providerId: string;
    options: Record<string, unknown>;
} | {
    type: 'installPluginSettingsPackage';
    packageName: string;
    scope: PluginSettingsInstallScope;
} | {
    type: 'saveSettings';
    settings: CardDisplaySettings;
} | {
    type: 'addColumn';
    column: {
        name: string;
        color: string;
    };
} | {
    type: 'editColumn';
    columnId: string;
    updates: {
        name: string;
        color: string;
    };
} | {
    type: 'removeColumn';
    columnId: string;
} | {
    type: 'reorderColumns';
    columnIds: string[];
    boardId?: string;
} | {
    type: 'setMinimizedColumns';
    columnIds: string[];
    boardId?: string;
} | {
    type: 'addComment';
    cardId: string;
    author: string;
    content: string;
} | {
    type: 'updateComment';
    cardId: string;
    commentId: string;
    content: string;
} | {
    type: 'deleteComment';
    cardId: string;
    commentId: string;
} | {
    type: 'switchBoard';
    boardId: string;
} | {
    type: 'createBoard';
    name: string;
} | {
    type: 'permanentDeleteCard';
    cardId: string;
} | {
    type: 'restoreCard';
    cardId: string;
} | {
    type: 'purgeDeletedCards';
} | {
    type: 'transferCard';
    cardId: string;
    toBoard: string;
    targetStatus: string;
} | {
    type: 'setLabel';
    name: string;
    definition: LabelDefinition;
} | {
    type: 'renameLabel';
    oldName: string;
    newName: string;
} | {
    type: 'deleteLabel';
    name: string;
} | {
    type: 'triggerAction';
    cardId: string;
    action: string;
    callbackKey: string;
} | {
    type: 'triggerBoardAction';
    boardId: string;
    actionKey: string;
    callbackKey: string;
} | SubmitFormMessage | {
    type: 'addLog';
    cardId: string;
    text: string;
    source?: string;
    object?: Record<string, unknown>;
    timestamp?: string;
} | {
    type: 'clearLogs';
    cardId: string;
} | {
    type: 'getLogs';
    cardId: string;
} | {
    type: 'addBoardLog';
    text: string;
    source?: string;
    object?: Record<string, unknown>;
    timestamp?: string;
} | {
    type: 'clearBoardLogs';
} | {
    type: 'getBoardLogs';
} | {
    type: 'getCardStates';
    cardIds: string[];
};
