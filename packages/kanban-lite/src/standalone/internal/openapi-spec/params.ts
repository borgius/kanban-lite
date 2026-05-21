export const boardIdParam = {
  name: 'boardId',
  in: 'path' as const,
  required: true as const,
  schema: { type: 'string' as const },
  description: 'Board identifier',
}

export const taskIdParam = {
  name: 'id',
  in: 'path' as const,
  required: true as const,
  schema: { type: 'string' as const },
  description: 'Task/card identifier (supports partial ID matching)',
}

export const actionParam = {
  name: 'action',
  in: 'path' as const,
  required: true as const,
  schema: { type: 'string' as const },
  description: 'Action key',
}

export const formIdParam = {
  name: 'formId',
  in: 'path' as const,
  required: true as const,
  schema: { type: 'string' as const },
  description: 'Form identifier',
}

export const filenameParam = {
  name: 'filename',
  in: 'path' as const,
  required: true as const,
  schema: { type: 'string' as const },
  description: 'Attachment filename',
}

export const commentIdParam = {
  name: 'commentId',
  in: 'path' as const,
  required: true as const,
  schema: { type: 'string' as const },
  description: 'Comment identifier',
}

export const checklistIndexParam = {
  name: 'index',
  in: 'path' as const,
  required: true as const,
  schema: { type: 'integer' as const, minimum: 0 },
  description: 'Zero-based checklist item index',
}

export const labelNameParam = {
  name: 'name',
  in: 'path' as const,
  required: true as const,
  schema: { type: 'string' as const },
  description: 'Label name (URL-encoded)',
}

export const pluginCapabilityParam = {
  name: 'capability',
  in: 'path' as const,
  required: true as const,
  schema: { type: 'string' as const },
  description: 'Plugin capability namespace (for example `auth.identity`, `card.storage`, or `config.storage`).',
}

export const pluginProviderIdParam = {
  name: 'providerId',
  in: 'path' as const,
  required: true as const,
  schema: { type: 'string' as const },
  description: 'Plugin provider identifier within the selected capability.',
}

export const listTasksQueryParams = [
  { name: 'q', in: 'query' as const, schema: { type: 'string' as const }, description: 'Free-text search. May include inline `meta.field: value` tokens.' },
  { name: 'fuzzy', in: 'query' as const, schema: { type: 'boolean' as const }, description: 'Enable fuzzy matching for free-text search and metadata tokens.' },
  { name: 'status', in: 'query' as const, schema: { type: 'string' as const }, description: 'Filter by status.' },
  { name: 'priority', in: 'query' as const, schema: { type: 'string' as const, enum: ['critical', 'high', 'medium', 'low'] as const }, description: 'Filter by priority.' },
  { name: 'assignee', in: 'query' as const, schema: { type: 'string' as const }, description: 'Filter by assignee name.' },
  { name: 'label', in: 'query' as const, schema: { type: 'string' as const }, description: 'Filter by label.' },
  { name: 'labelGroup', in: 'query' as const, schema: { type: 'string' as const }, description: 'Filter by label group name.' },
  { name: 'includeDeleted', in: 'query' as const, schema: { type: 'boolean' as const }, description: 'Include soft-deleted tasks.' },
  { name: 'meta.<field>', in: 'query' as const, schema: { type: 'string' as const }, description: 'Field-scoped metadata filter. Repeat for multiple metadata fields.' },
]

const cardFormAttachmentBodySchema = {
  type: 'object' as const,
  description: 'Named workspace-form reference or inline form definition attached to the card.',
  properties: {
    name: { type: 'string' as const, description: 'Name of a reusable workspace form declared under `forms.<name>`.' },
    schema: { type: 'object' as const, description: 'Inline JSON Schema for a card-local form. Required when `name` is omitted.' },
    ui: { type: 'object' as const, description: 'Optional JSON Forms UI schema for layout and rendering hints.' },
    data: { type: 'object' as const, description: 'Optional attachment-level default data merged before persisted `formData`.' },
  },
}

const cardFormDataEntrySchema = {
  type: 'object' as const,
  description: 'Persisted field values for one resolved form ID.',
  additionalProperties: true,
}

const cardFormDataBodySchema = {
  type: 'object' as const,
  description: 'Per-form saved data keyed by resolved form ID.',
  additionalProperties: cardFormDataEntrySchema,
}

const cardActionsBodySchema = {
  description: 'Per-card actions, either as an ordered list of action keys or a map of action key → display title.',
  oneOf: [
    {
      type: 'array' as const,
      items: { type: 'string' as const },
    },
    {
      type: 'object' as const,
      additionalProperties: { type: 'string' as const },
    },
  ],
}

const taskMutableFieldProperties = {
  status: { type: 'string' as const, description: 'Target status column. Defaults to the board default when omitted on create.' },
  priority: { type: 'string' as const, enum: ['critical', 'high', 'medium', 'low'] as const, description: 'Priority level.' },
  assignee: { type: 'string' as const, description: 'Assigned team member.' },
  dueDate: { type: 'string' as const, description: 'Due date (ISO 8601).' },
  labels: { type: 'array' as const, items: { type: 'string' as const }, description: 'Labels/tags.' },
  metadata: { type: 'object' as const, description: 'Arbitrary user-defined key/value metadata.', additionalProperties: true },
  actions: cardActionsBodySchema,
  forms: {
    type: 'array' as const,
    items: cardFormAttachmentBodySchema,
    description: 'Attached forms — named workspace references or inline definitions.',
  },
  formData: cardFormDataBodySchema,
}

export const createTaskBodySchema = {
  type: 'object' as const,
  required: ['content' as const],
  properties: {
    content: { type: 'string' as const, description: 'Markdown content. Task title is derived from the first `# heading`.' },
    ...taskMutableFieldProperties,
    tasks: { type: 'array' as const, items: { type: 'string' as const }, description: 'Optional seeded checklist items. Each entry must be a single-line Markdown task string or plain text that can be canonicalized into one.' },
  },
}

export const updateTaskBodySchema = {
  type: 'object' as const,
  description: 'Any subset of mutable task fields. Omitted fields remain unchanged.',
  properties: {
    content: { type: 'string' as const, description: 'Full Markdown content that replaces the existing task body.' },
    ...taskMutableFieldProperties,
  },
}

export const logEntryBodySchema = {
  type: 'object' as const,
  required: ['text' as const],
  properties: {
    text: { type: 'string' as const, description: 'Log message text (supports Markdown).' },
    source: { type: 'string' as const, description: 'Source/origin label (default: `"default"`).' },
    object: { type: 'object' as const, description: 'Optional structured data stored as JSON.' },
    timestamp: { type: 'string' as const, description: 'ISO 8601 timestamp (auto-generated if omitted).' },
  },
}

export const cardStateReadBodySchema = {
  type: 'object' as const,
  properties: {
    readThrough: {
      type: 'object' as const,
      description: 'Optional explicit unread cursor to acknowledge instead of the latest activity.',
      properties: {
        cursor: { type: 'string' as const, description: 'Opaque unread cursor token previously returned by card-state read models.' },
        updatedAt: { type: 'string' as const, description: 'Timestamp paired with the unread cursor token.' },
      },
    },
  },
}

export const checklistCreateBodySchema = {
  type: 'object' as const,
  required: ['title' as const, 'expectedToken' as const],
  properties: {
    title: { type: 'string' as const, description: 'Single-line checklist item title. Markdown task markers are optional on input and are canonicalized.' },
    description: { type: 'string' as const, description: 'Optional secondary checklist description stored alongside the checklist title.' },
    expectedToken: { type: 'string' as const, description: 'Checklist-wide optimistic-concurrency token returned by the latest checklist read model. Required for checklist adds to avoid lost updates.' },
  },
}

export const checklistEditBodySchema = {
  type: 'object' as const,
  required: ['title' as const],
  properties: {
    title: { type: 'string' as const, description: 'Single-line checklist item title. Markdown task markers are optional on input and are canonicalized.' },
    description: { type: 'string' as const, description: 'Optional secondary checklist description stored alongside the checklist title.' },
    modifiedAt: { type: 'string' as const, description: 'Optional optimistic-concurrency guard that must match the latest stored checklist item mutation timestamp before the edit is applied.' },
  },
}

export const checklistModifiedAtBodySchema = {
  type: 'object' as const,
  properties: {
    modifiedAt: { type: 'string' as const, description: 'Optional optimistic-concurrency guard that must match the latest stored checklist item mutation timestamp before the mutation is applied.' },
  },
}

