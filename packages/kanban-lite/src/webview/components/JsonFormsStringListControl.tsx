import { useMemo, useCallback, useRef, useEffect } from 'react'
import {
  and,
  isPrimitiveArrayControl,
  not,
  rankWith,
  schemaMatches,
  type ControlProps,
  type JsonSchema,
  type RankedTester,
} from '@jsonforms/core'
import { withJsonFormsControlProps } from '@jsonforms/react'
import { Plus, Trash2 } from 'lucide-react'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function coerceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => typeof entry === 'string' ? entry : entry == null ? '' : String(entry))
}

interface ItemConstraints {
  title: string | null
  description: string | null
  minLength: number | null
  maxLength: number | null
  pattern: string | null
  placeholder: string | null
  format: string | null
}

function getItemConstraints(schema: ControlProps['schema'] | undefined): ItemConstraints {
  const items = isRecord(schema) ? schema.items : null
  const safe = isRecord(items) ? items : {}
  return {
    title: typeof safe.title === 'string' && safe.title.trim().length > 0 ? safe.title : null,
    description: typeof safe.description === 'string' && safe.description.trim().length > 0 ? safe.description : null,
    minLength: typeof safe.minLength === 'number' ? safe.minLength : null,
    maxLength: typeof safe.maxLength === 'number' ? safe.maxLength : null,
    pattern: typeof safe.pattern === 'string' && safe.pattern.length > 0 ? safe.pattern : null,
    placeholder: typeof safe.examples === 'object' && Array.isArray(safe.examples) && typeof safe.examples[0] === 'string'
      ? safe.examples[0] as string
      : null,
    format: typeof safe.format === 'string' && safe.format.length > 0 ? safe.format : null,
  }
}

function pluralizeItem(title: string | null, count: number): string {
  const base = (title ?? 'item').toLowerCase()
  if (count === 1) return base
  if (/(s|x|z|ch|sh)$/.test(base)) return `${base}es`
  if (/[^aeiou]y$/.test(base)) return `${base.slice(0, -1)}ies`
  return `${base}s`
}

function validateRow(value: string, constraints: ItemConstraints): string | null {
  const trimmed = value
  if (constraints.minLength != null && trimmed.length < constraints.minLength) {
    return constraints.minLength === 1
      ? 'Value is required'
      : `Must be at least ${constraints.minLength} characters`
  }
  if (constraints.maxLength != null && trimmed.length > constraints.maxLength) {
    return `Must be at most ${constraints.maxLength} characters`
  }
  if (constraints.pattern && trimmed.length > 0) {
    try {
      const re = new RegExp(constraints.pattern)
      if (!re.test(trimmed)) return 'Invalid format'
    } catch {
      /* ignore bad user-supplied pattern */
    }
  }
  return null
}

function StringListControlRenderer(props: ControlProps) {
  const { data, description, enabled, errors, handleChange, id, label, path, required, schema, visible, uischema } = props
  const items = useMemo(() => coerceStringArray(data), [data])
  const constraints = useMemo(() => getItemConstraints(schema), [schema])
  const arrayRequired = isRecord(schema) && typeof schema.minItems === 'number' ? schema.minItems : null
  const disabled = enabled === false
  const uiOptions = isRecord(uischema) && isRecord((uischema as { options?: unknown }).options)
    ? (uischema as { options?: Record<string, unknown> }).options as Record<string, unknown>
    : {}
  const placeholderOption = typeof uiOptions.placeholder === 'string'
    ? uiOptions.placeholder
    : constraints.placeholder
  const addLabelOption = typeof uiOptions.addLabel === 'string' ? uiOptions.addLabel : null

  const rowErrors = useMemo(
    () => items.map((value) => validateRow(value, constraints)),
    [items, constraints],
  )

  const focusLastRef = useRef(false)
  const lastInputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (focusLastRef.current && lastInputRef.current) {
      lastInputRef.current.focus()
      focusLastRef.current = false
    }
  }, [items.length])

  const updateItem = useCallback((index: number, value: string) => {
    const next = items.slice()
    next[index] = value
    handleChange(path, next)
  }, [items, handleChange, path])

  const removeItem = useCallback((index: number) => {
    const next = items.slice()
    next.splice(index, 1)
    handleChange(path, next)
  }, [items, handleChange, path])

  const addItem = useCallback(() => {
    if (disabled) return
    focusLastRef.current = true
    handleChange(path, [...items, ''])
  }, [items, handleChange, path, disabled])

  if (visible === false) return null

  const labelText = typeof label === 'string' ? label : ''
  const descriptionText = typeof description === 'string' ? description.trim() : ''
  const arrayErrorText = typeof errors === 'string' ? errors.trim() : ''
  const itemTitle = constraints.title
  const addLabel = addLabelOption ?? `Add ${itemTitle ? itemTitle.toLowerCase() : 'item'}`
  const countLabel = items.length === 0
    ? `No ${pluralizeItem(itemTitle, 2)} yet`
    : `${items.length} ${pluralizeItem(itemTitle, items.length)}`
  const isEmpty = items.length === 0
  const minReq = arrayRequired ?? (required ? 1 : null)

  return (
    <div className="control kl-jsonforms-string-list" data-testid={`string-list-${path}`}>
      <div className="kl-jsonforms-string-list__header">
        <div className="kl-jsonforms-string-list__heading">
          {labelText.length > 0 && (
            <label className="control-label" htmlFor={id}>
              {labelText}
              {required ? ' *' : ''}
            </label>
          )}
          <span className="kl-jsonforms-string-list__count">{countLabel}</span>
        </div>
        <button
          type="button"
          className="kl-jsonforms-string-list__add"
          onClick={addItem}
          disabled={disabled}
        >
          <Plus size={12} aria-hidden="true" />
          <span>{addLabel}</span>
        </button>
      </div>

      {descriptionText.length > 0 && (
        <p className="description kl-jsonforms-string-list__description">{descriptionText}</p>
      )}

      <div id={id} className="kl-jsonforms-string-list__rows" role="list">
        {isEmpty ? (
          <button
            type="button"
            className="kl-jsonforms-string-list__empty"
            onClick={addItem}
            disabled={disabled}
          >
            <Plus size={14} aria-hidden="true" />
            <span>
              {itemTitle
                ? `Add your first ${itemTitle.toLowerCase()}`
                : 'Add your first entry'}
            </span>
            {minReq != null && minReq > 0 && (
              <span className="kl-jsonforms-string-list__empty-hint">
                at least {minReq} required
              </span>
            )}
          </button>
        ) : items.map((value, index) => {
          const rowError = rowErrors[index]
          const isLast = index === items.length - 1
          const rowInputId = `${id}-row-${index}`
          return (
            <div
              key={index}
              role="listitem"
              className={`kl-jsonforms-string-list__row${rowError ? ' kl-jsonforms-string-list__row--error' : ''}`}
            >
              <span className="kl-jsonforms-string-list__row-index" aria-hidden="true">
                {index + 1}
              </span>
              <div className="kl-jsonforms-string-list__row-field">
                <input
                  id={rowInputId}
                  ref={isLast ? lastInputRef : undefined}
                  type="text"
                  className="kl-jsonforms-string-list__row-input"
                  value={value}
                  placeholder={placeholderOption ?? (itemTitle ? itemTitle : '')}
                  disabled={disabled}
                  aria-invalid={rowError ? 'true' : undefined}
                  aria-describedby={rowError ? `${rowInputId}-error` : undefined}
                  onChange={(event) => updateItem(index, event.target.value)}
                />
                {rowError && (
                  <p id={`${rowInputId}-error`} className="kl-jsonforms-string-list__row-error">
                    {rowError}
                  </p>
                )}
              </div>
              <button
                type="button"
                className="kl-jsonforms-string-list__row-remove"
                onClick={() => removeItem(index)}
                disabled={disabled}
                aria-label={`Remove ${itemTitle ? itemTitle.toLowerCase() : 'item'} ${index + 1}`}
                title="Remove"
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </div>
          )
        })}
      </div>

      {arrayErrorText.length > 0 && !isEmpty && (
        <p className="validation_error kl-jsonforms-string-list__array-error">
          {arrayErrorText}
        </p>
      )}
    </div>
  )
}

const hasEnumItems = schemaMatches((schema: JsonSchema) => {
  if (!isRecord(schema)) return false
  const items = (schema as Record<string, unknown>).items
  return isRecord(items) && Array.isArray((items as Record<string, unknown>).enum)
})

const hasStringItems = schemaMatches((schema: JsonSchema) => {
  if (!isRecord(schema)) return false
  const items = (schema as Record<string, unknown>).items
  if (!isRecord(items)) return false
  const type = (items as Record<string, unknown>).type
  return type === 'string' || (Array.isArray(type) && type.includes('string'))
})

export const jsonFormsStringListTester: RankedTester = rankWith(
  1050,
  and(isPrimitiveArrayControl, hasStringItems, not(hasEnumItems)),
)

export const JsonFormsStringListControl = withJsonFormsControlProps(StringListControlRenderer)
