import type { Priority, CardTask, CardFormAttachment, CardFormDataMap } from './card'

export interface LabelDefinition {
  color: string
  group?: string
}

export const LABEL_PRESET_COLORS: { name: string; hex: string }[] = [
  { name: 'red', hex: '#e11d48' },
  { name: 'orange', hex: '#ea580c' },
  { name: 'amber', hex: '#d97706' },
  { name: 'yellow', hex: '#ca8a04' },
  { name: 'lime', hex: '#65a30d' },
  { name: 'green', hex: '#16a34a' },
  { name: 'teal', hex: '#0d9488' },
  { name: 'cyan', hex: '#0891b2' },
  { name: 'blue', hex: '#2563eb' },
  { name: 'indigo', hex: '#4f46e5' },
  { name: 'violet', hex: '#7c3aed' },
  { name: 'pink', hex: '#db2777' },
]

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
  id: string
  /**
   * Human-readable form name used for tab headings and display.
   * Falls back to a capitalized config key for reusable forms or to the
   * inline schema title / resolved id for inline forms.
   *
   * Optional for backward compatibility with external consumers. Always
   * populated by SDK resolution at runtime.
   */
  name?: string
  /**
   * Human-readable description shown in the card form header.
   * Defaults to an empty string.
   *
   * Optional for backward compatibility with external consumers. Always
   * populated by SDK resolution at runtime.
   */
  description?: string
  /**
   * Legacy alias for {@link name} kept for downstream compatibility.
   */
  label: string
  /** Resolved JSON Schema for AJV validation and JSON Forms rendering. */
  schema: Record<string, unknown>
  /** Resolved JSON Forms UI schema, if any. */
  ui?: Record<string, unknown>
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
  initialData: Record<string, unknown>
  /** `true` when this descriptor was sourced from a named config form. */
  fromConfig: boolean
}

/** Per-comment task permissions resolved by the server for the current caller. */
export interface TaskCommentPermissionRecord {
  /** `true` when the caller may update this specific comment. */
  update: boolean
  /** `true` when the caller may delete this specific comment. */
  delete: boolean
}

/** Comment capability envelope resolved by the server for the current caller. */
export interface TaskCommentPermissionsReadModel {
  /** `true` when the caller may add a new comment to the task. */
  create: boolean
  /** `true` when at least one visible comment can be updated. */
  update: boolean
  /** `true` when at least one visible comment can be deleted. */
  delete: boolean
  /** Per-comment permissions keyed by visible comment id. */
  byId?: Record<string, TaskCommentPermissionRecord>
}

/** Per-attachment task permissions resolved by the server for the current caller. */
export interface TaskAttachmentPermissionRecord {
  /** `true` when the caller may remove this specific attachment. */
  remove: boolean
}

/** Attachment capability envelope resolved by the server for the current caller. */
export interface TaskAttachmentPermissionsReadModel {
  /** `true` when the caller may add a new attachment to the task. */
  add: boolean
  /** `true` when at least one visible attachment can be removed. */
  remove: boolean
  /** Per-attachment permissions keyed by visible attachment name/path. */
  byName?: Record<string, TaskAttachmentPermissionRecord>
}

/** Per-form task permissions resolved by the server for the current caller. */
export interface TaskFormPermissionRecord {
  /** `true` when the caller may submit this specific resolved form. */
  submit: boolean
}

/** Form capability envelope resolved by the server for the current caller. */
export interface TaskFormPermissionsReadModel {
  /** `true` when at least one visible resolved form can be submitted. */
  submit: boolean
  /** Per-form permissions keyed by resolved form id. */
  byId?: Record<string, TaskFormPermissionRecord>
}

/** Checklist capability envelope resolved by the server for the current caller. */
export interface TaskChecklistPermissionsReadModel {
  /** `true` when the checklist should be shown to the caller. */
  show: boolean
  /** `true` when the caller may append checklist items. */
  add: boolean
  /** `true` when the caller may edit existing checklist items. */
  edit: boolean
  /** `true` when the caller may delete existing checklist items. */
  delete: boolean
  /** `true` when the caller may mark checklist items complete. */
  check: boolean
  /** `true` when the caller may mark checklist items incomplete. */
  uncheck: boolean
}

/** Per-card-action task permissions resolved by the server for the current caller. */
export interface TaskCardActionPermissionRecord {
  /** `true` when the caller may trigger this specific named card action. */
  trigger: boolean
}

/** Card-action capability envelope resolved by the server for the current caller. */
export interface TaskCardActionPermissionsReadModel {
  /** `true` when at least one visible named card action can be triggered. */
  trigger: boolean
  /** Per-card-action permissions keyed by action key/name. */
  byKey?: Record<string, TaskCardActionPermissionRecord>
}

/**
 * Server-owned capability envelope for a task read model.
 *
 * Host surfaces should serialize this object directly so callers can render
 * task UI affordances without re-implementing policy logic on the client.
 */
export interface TaskPermissionsReadModel {
  /** Comment affordances for the current caller. */
  comment: TaskCommentPermissionsReadModel
  /** Attachment affordances for the current caller. */
  attachment: TaskAttachmentPermissionsReadModel
  /** Form affordances for the current caller. */
  form: TaskFormPermissionsReadModel
  /** Checklist affordances for the current caller. */
  checklist: TaskChecklistPermissionsReadModel
  /** Named card-action affordances for the current caller. */
  cardAction: TaskCardActionPermissionsReadModel
}

/**
 * YAML frontmatter fields stored at the top of each card's markdown file.
 *
 * These fields are parsed from and serialized back to the frontmatter block
 * when reading/writing card files.
 */
export interface CardFrontmatter {
  /** Card frontmatter schema version. 0 = legacy (pre-versioning). */
  version: number
  /** Unique card identifier. */
  id: string
  /** Board this card belongs to. Present when multiple boards exist. */
  boardId?: string
  /** Current column/status of the card. */
  status: string
  /** Priority level of the card. */
  priority: Priority
  /** Assignee name, or `null` if unassigned. */
  assignee: string | null
  /** ISO 8601 due date, or `null` if none. */
  dueDate: string | null
  /** ISO 8601 creation timestamp. */
  created: string
  /** ISO 8601 last-modified timestamp. */
  modified: string
  /** ISO 8601 completion timestamp, or `null` if not completed. */
  completedAt: string | null
  /** Tags/labels attached to the card. */
  labels: string[]
  /** File paths of attachments. */
  attachments: string[]
  /** Rich checklist task items stored on the card. */
  tasks?: CardTask[]
  /** Fractional index (base-62) for ordering within a column. */
  order: string
  /** Arbitrary user-defined metadata stored as YAML in the frontmatter. */
  metadata?: Record<string, unknown>
  /** Named actions that can be triggered via the action webhook. Either an array of action keys or a map of action key → display title. */
  actions?: string[] | Record<string, string>
  /** Forms attached to this card (named config-form references or inline definitions). */
  forms?: CardFormAttachment[]
  /**
   * Per-form persisted data keyed by the resolved form `id`.
   * Using a form-keyed map prevents field collisions when multiple forms
   * share property names across different tabs.
   */
  formData?: CardFormDataMap
}

/**
 * Read-only workspace information displayed in the settings panel.
 */
export interface WorkspaceInfo {
  projectPath: string
  kanbanDirectory: string
  port: number
  configVersion: number
}

/** Discovery locations surfaced for plugin provider inventory rows. */

