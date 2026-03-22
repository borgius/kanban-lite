/**
 * Browser-safe, dependency-free helpers for preparing form data with
 * `${path}` placeholder interpolation against a full card context.
 *
 * These helpers are the shared contract between the SDK (`resolveCardForms`)
 * and the webview (`resolveCardFormDescriptors`), ensuring server-side and
 * client-side prepared initial data stay in sync.
 *
 * **Interpolation rule:** Placeholders that cannot be resolved (missing or
 * `undefined` keys) are replaced with an **empty string**. This keeps form
 * fields blank rather than showing a raw `${path}` fragment to the user.
 *
 * **Security note:** Placeholder resolution is purely a path-lookup over the
 * card context object. No JavaScript expressions are evaluated; arbitrary code
 * execution via template values is not possible.
 *
 * @module formDataPreparation
 */

/**
 * Flat card context exposed to `${path}` placeholder resolution during form
 * data preparation.
 *
 * All standard card fields are present at the top level. `metadata` supports
 * dot-notation access (e.g. `${metadata.owner}`). The index signature allows
 * forward-compatible access to additional card fields without a type change.
 *
 * `filePath` is intentionally excluded to avoid leaking filesystem layout
 * into stored or rendered form data values.
 */
export interface CardInterpolationContext {
  /** Card identifier. */
  id: string
  /** Parent board identifier. */
  boardId: string
  /** Current column/status (e.g. `'in-progress'`). */
  status: string
  /** Priority level (e.g. `'high'`). */
  priority: string
  /** Assignee name, or `null` if unassigned. */
  assignee: string | null
  /** ISO 8601 due date, or `null` if none. */
  dueDate: string | null
  /** ISO 8601 creation timestamp. */
  created?: string
  /** ISO 8601 last-modified timestamp. */
  modified?: string
  /** ISO 8601 completion timestamp, or `null` if not completed. */
  completedAt?: string | null
  /** Tags/labels attached to the card. */
  labels?: string[]
  /** Attachment filenames associated with the card (not filesystem paths). */
  attachments?: string[]
  /** Fractional index controlling sort order within a column. */
  order?: string
  /** Markdown body content of the card. */
  content?: string
  /** Named actions available on the card. */
  actions?: string[] | Record<string, string>
  /** Forms attached to the card. */
  forms?: unknown[]
  /** Per-form persisted data keyed by resolved form ID. */
  formData?: Record<string, unknown>
  /**
   * Arbitrary card metadata; supports dot-notation paths in templates
   * (e.g. `${metadata.owner}`).
   */
  metadata?: Record<string, unknown>
  /** Index signature for forward-compatible access to additional card fields. */
  [key: string]: unknown
}

/**
 * Resolves a dot-notation path against an object.
 * Returns `undefined` when any path segment is missing or the traversal
 * encounters a non-object node.
 */
function resolvePath(path: string, obj: Record<string, unknown>): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc != null && typeof acc === 'object' && !Array.isArray(acc)) {
      return (acc as Record<string, unknown>)[key]
    }
    return undefined
  }, obj)
}

/**
 * Resolves `${path}` placeholders in a template string against a card
 * interpolation context.
 *
 * - Dot-notation paths are supported for nested access (e.g. `${metadata.owner}`).
 * - Non-string leaf values are coerced to strings via `String()`.
 * - Placeholders whose paths do not resolve (missing or `undefined` keys) are
 *   replaced with an **empty string**.
 *
 * This helper is expression-free (no `eval`, no `new Function`) and safe for
 * both Node.js and browser bundle environments.
 *
 * @param template - A string potentially containing `${path}` placeholders.
 * @param ctx - The card interpolation context providing lookup values.
 * @returns The resolved string with all matched placeholders replaced.
 *
 * @example
 * resolveTemplateString('Card by ${assignee}', ctx)
 * // => 'Card by alice'
 *
 * @example
 * resolveTemplateString('Owner: ${metadata.owner}', ctx)
 * // => 'Owner: bob'
 *
 * @example
 * resolveTemplateString('${unknown.field}', ctx)
 * // => ''  (unresolved → empty string)
 */
export function resolveTemplateString(
  template: string,
  ctx: CardInterpolationContext,
): string {
  return template.replace(/\$\{([^}]+)\}/g, (_, path: string) => {
    const value = resolvePath(path.trim(), ctx as Record<string, unknown>)
    return value == null ? '' : String(value)
  })
}

/**
 * Processes a single value through interpolation, dispatching by type.
 * Strings → placeholder-resolved; arrays → element-wise; objects → recursive;
 * other scalars → unchanged.
 */
function interpolateValue(value: unknown, ctx: CardInterpolationContext): unknown {
  if (typeof value === 'string') {
    return resolveTemplateString(value, ctx)
  }
  if (Array.isArray(value)) {
    return value.map(item => interpolateValue(item, ctx))
  }
  if (value !== null && typeof value === 'object') {
    return prepareFormData(value as Record<string, unknown>, ctx)
  }
  return value
}

/**
 * Recursively prepares a form data object by resolving `${path}` placeholders
 * in all string leaf values against the provided card context.
 *
 * - **String leaves:** placeholders resolved via {@link resolveTemplateString}.
 * - **Array elements:** each element is processed recursively.
 * - **Nested objects:** processed recursively.
 * - **Non-string scalars** (numbers, booleans, `null`): passed through unchanged.
 *
 * Returns a **new** object; the input is never mutated.
 *
 * This is the shared preparation helper used by both the SDK
 * (`resolveCardForms`) and the webview (`resolveCardFormDescriptors`) to
 * guarantee parity between server-side and client-side prepared initial data.
 *
 * @param value - The form data record to prepare (e.g. config defaults or
 *   stored `card.formData[id]`, which may be partial at rest).
 * @param ctx - The card interpolation context built via
 *   {@link buildCardInterpolationContext}.
 * @returns A new record with all string leaves resolved.
 *
 * @example
 * prepareFormData({ title: '${id} - Bug', severity: 'high' }, ctx)
 * // => { title: '42 - Bug', severity: 'high' }
 *
 * @example
 * prepareFormData({ nested: { owner: '${metadata.owner}' } }, ctx)
 * // => { nested: { owner: 'bob' } }
 */
export function prepareFormData(
  value: Record<string, unknown>,
  ctx: CardInterpolationContext,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) {
    result[k] = interpolateValue(v, ctx)
  }
  return result
}

/**
 * Builds a {@link CardInterpolationContext} from a card and its parent board ID.
 *
 * This is the canonical factory for the context object passed to
 * {@link prepareFormData} and {@link resolveTemplateString}. It includes all
 * card fields that are safe and useful for template interpolation.
 *
 * `filePath` is intentionally excluded to avoid leaking filesystem paths into
 * form data values.
 *
 * @param card - The card to build context from.
 * @param boardId - The board the card belongs to.
 * @returns A flat interpolation context with all standard card fields.
 *
 * @example
 * const ctx = buildCardInterpolationContext(card, 'default')
 * const prepared = prepareFormData(storedFormData, ctx)
 */
export function buildCardInterpolationContext(
  card: {
    id: string
    status: string
    priority: string
    assignee: string | null
    dueDate: string | null
    created?: string
    modified?: string
    completedAt?: string | null
    labels?: string[]
    attachments?: string[]
    order?: string
    content?: string
    actions?: string[] | Record<string, string>
    forms?: unknown[]
    formData?: Record<string, unknown>
    metadata?: Record<string, unknown>
  },
  boardId: string,
): CardInterpolationContext {
  return {
    id: card.id,
    boardId,
    status: card.status,
    priority: card.priority,
    assignee: card.assignee,
    dueDate: card.dueDate,
    created: card.created,
    modified: card.modified,
    completedAt: card.completedAt,
    labels: card.labels,
    attachments: card.attachments,
    order: card.order,
    content: card.content,
    actions: card.actions,
    forms: card.forms,
    formData: card.formData,
    metadata: card.metadata,
  }
}
