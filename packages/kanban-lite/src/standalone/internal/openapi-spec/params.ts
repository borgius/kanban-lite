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

export const createTaskBodySchema = {
  type: 'object' as const,
  required: ['content' as const],
  properties: {
    content: { type: 'string' as const, description: 'Markdown content. Task title is derived from the first `# heading`.' },
    status: { type: 'string' as const, description: 'Initial status (defaults to board default).' },
    priority: { type: 'string' as const, enum: ['critical', 'high', 'medium', 'low'] as const, description: 'Priority level (default: `medium`).' },
    assignee: { type: 'string' as const, description: 'Assigned team member.' },
    dueDate: { type: 'string' as const, description: 'Due date (ISO 8601).' },
    labels: { type: 'array' as const, items: { type: 'string' as const }, description: 'Labels/tags.' },
    tasks: { type: 'array' as const, items: { type: 'string' as const }, description: 'Optional seeded checklist items. Each entry must be a single-line Markdown task string or plain text that can be canonicalized into one.' },
    metadata: { type: 'object' as const, description: 'Arbitrary user-defined key/value metadata.' },
    forms: { type: 'array' as const, description: 'Attached forms — named workspace references (`{ "name": "..." }`) or inline definitions.' },
    formData: { type: 'object' as const, description: 'Per-form saved data keyed by resolved form ID.' },
    actions: { type: 'array' as const, description: 'Action names or map of key → title available on this card.' },
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
        cursor: { type: 'string' as const },
        updatedAt: { type: 'string' as const },
      },
    },
  },
}

export const checklistCreateBodySchema = {
  type: 'object' as const,
  required: ['text' as const, 'expectedToken' as const],
  properties: {
    text: { type: 'string' as const, description: 'Single-line checklist item text. Markdown task markers are optional on input and are canonicalized.' },
    expectedToken: { type: 'string' as const, description: 'Checklist-wide optimistic-concurrency token returned by the latest checklist read model. Required for checklist adds to avoid lost updates.' },
  },
}

export const checklistEditBodySchema = {
  type: 'object' as const,
  required: ['text' as const],
  properties: {
    text: { type: 'string' as const, description: 'Single-line checklist item text. Markdown task markers are optional on input and are canonicalized.' },
    expectedRaw: { type: 'string' as const, description: 'Optional optimistic-concurrency guard that must match the caller-visible raw checklist line before the edit is applied.' },
  },
}

export const checklistExpectedRawBodySchema = {
  type: 'object' as const,
  properties: {
    expectedRaw: { type: 'string' as const, description: 'Optional optimistic-concurrency guard that must match the caller-visible raw checklist line before the mutation is applied.' },
  },
}

