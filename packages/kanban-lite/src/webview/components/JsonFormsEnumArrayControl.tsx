import { useMemo, useState, useCallback, useId } from 'react'
import {
  and,
  isPrimitiveArrayControl,
  rankWith,
  schemaMatches,
  type ControlProps,
  type JsonSchema,
  type RankedTester,
} from '@jsonforms/core'
import { withJsonFormsControlProps } from '@jsonforms/react'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function coerceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const result: string[] = []
  for (const entry of value) {
    if (typeof entry === 'string') result.push(entry)
    else if (typeof entry === 'number' || typeof entry === 'boolean') result.push(String(entry))
  }
  return result
}

function getItemEnumOptions(schema: ControlProps['schema'] | undefined): string[] | null {
  if (!isRecord(schema)) return null
  const items = schema.items
  if (!isRecord(items)) return null
  if (!Array.isArray(items.enum)) return null
  const options = items.enum
    .filter((entry): entry is string | number | boolean =>
      typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean')
    .map(String)
  return options.length > 0 ? options : null
}

function getItemTitle(schema: ControlProps['schema'] | undefined): string | null {
  if (!isRecord(schema)) return null
  const items = schema.items
  if (!isRecord(items)) return null
  return typeof items.title === 'string' && items.title.trim().length > 0 ? items.title : null
}

const ENUM_ARRAY_FILTER_THRESHOLD = 8

function EnumArrayControlRenderer(props: ControlProps) {
  const { data, description, enabled, errors, handleChange, id, label, path, required, schema, visible, uischema } = props
  const selected = useMemo(() => coerceStringArray(data), [data])
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const options = useMemo(() => getItemEnumOptions(schema), [schema])
  const itemTitle = useMemo(() => getItemTitle(schema), [schema])
  const [filter, setFilter] = useState('')
  const filterId = useId()

  const toggleValue = useCallback((value: string) => {
    if (enabled === false) return
    if (selectedSet.has(value)) {
      handleChange(path, selected.filter((entry) => entry !== value))
    } else {
      const next = options
        ? options.filter((option) => option === value || selectedSet.has(option))
        : [...selected, value]
      handleChange(path, next)
    }
  }, [enabled, handleChange, options, path, selected, selectedSet])

  const clearAll = useCallback(() => {
    if (enabled === false || selected.length === 0) return
    handleChange(path, [])
  }, [enabled, handleChange, path, selected.length])

  if (visible === false) return null
  if (!options) return null

  const labelText = typeof label === 'string' ? label : ''
  const descriptionText = typeof description === 'string' ? description.trim() : ''
  const errorText = typeof errors === 'string' ? errors.trim() : ''
  const disabled = enabled === false
  const showFilter = options.length >= ENUM_ARRAY_FILTER_THRESHOLD
  const normalizedFilter = filter.trim().toLowerCase()
  const visibleOptions = normalizedFilter.length > 0
    ? options.filter((option) => option.toLowerCase().includes(normalizedFilter))
    : options
  const selectedCount = selected.length
  const totalCount = options.length
  const uiOptions = isRecord(uischema) && isRecord((uischema as { options?: unknown }).options)
    ? (uischema as { options?: Record<string, unknown> }).options as Record<string, unknown>
    : undefined
  const placeholder = typeof uiOptions?.placeholder === 'string' ? uiOptions.placeholder : null

  return (
    <div className="control kl-jsonforms-enum-array" data-testid={`enum-array-${path}`}>
      {labelText.length > 0 && (
        <label className="control-label" htmlFor={id}>
          {labelText}
          {required ? ' *' : ''}
        </label>
      )}

      <div className="kl-jsonforms-enum-array__summary">
        <span className="kl-jsonforms-enum-array__count" aria-live="polite">
          {selectedCount} of {totalCount} {itemTitle ? `${itemTitle.toLowerCase()}${totalCount === 1 ? '' : 's'}` : 'selected'}
        </span>
        {selectedCount > 0 && !disabled && (
          <button
            type="button"
            className="kl-jsonforms-enum-array__clear"
            onClick={clearAll}
          >
            Clear all
          </button>
        )}
      </div>

      {showFilter && (
        <input
          type="search"
          id={filterId}
          className="kl-jsonforms-enum-array__filter"
          placeholder={placeholder ?? `Filter ${itemTitle ? itemTitle.toLowerCase() + 's' : 'options'}…`}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          disabled={disabled}
        />
      )}

      <div
        className="kl-jsonforms-enum-array__chips"
        role="group"
        aria-label={labelText.length > 0 ? labelText : undefined}
        id={id}
      >
        {visibleOptions.length === 0 ? (
          <p className="kl-jsonforms-enum-array__empty">No matching options.</p>
        ) : visibleOptions.map((option) => {
          const isSelected = selectedSet.has(option)
          return (
            <button
              type="button"
              key={option}
              className={`kl-jsonforms-enum-array__chip${isSelected ? ' kl-jsonforms-enum-array__chip--selected' : ''}`}
              aria-pressed={isSelected}
              disabled={disabled}
              onClick={() => toggleValue(option)}
            >
              <span className="kl-jsonforms-enum-array__chip-indicator" aria-hidden="true">
                {isSelected ? '✓' : '+'}
              </span>
              <span className="kl-jsonforms-enum-array__chip-label">{option}</span>
            </button>
          )
        })}
      </div>

      {descriptionText.length > 0 && (
        <p className="description">{descriptionText}</p>
      )}

      {errorText.length > 0 && (
        <p className="validation_error">{errorText}</p>
      )}
    </div>
  )
}

export const jsonFormsEnumArrayTester: RankedTester = rankWith(
  1100,
  and(
    isPrimitiveArrayControl,
    schemaMatches((schema: JsonSchema) => {
      if (!isRecord(schema)) return false
      const items = (schema as Record<string, unknown>).items
      return isRecord(items) && Array.isArray((items as Record<string, unknown>).enum)
    }),
  ),
)

export const JsonFormsEnumArrayControl = withJsonFormsControlProps(EnumArrayControlRenderer)
