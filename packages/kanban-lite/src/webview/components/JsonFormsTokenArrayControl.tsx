import { useMemo, useCallback } from 'react'
import {
  and,
  composePaths,
  createDefaultValue,
  findUISchema,
  optionIs,
  rankWith,
  type ArrayControlProps,
  type RankedTester,
  isObjectArrayControl,
} from '@jsonforms/core'
import { JsonFormsDispatch, withJsonFormsArrayControlProps } from '@jsonforms/react'

/**
 * Generates a `klr-<32 hex chars>` token string using the browser's
 * cryptographically secure random UUID generator.
 */
function generateAuthToken(): string {
  return `klr-${crypto.randomUUID().replace(/-/g, '')}`
}

function TokenArrayControlRenderer(props: ArrayControlProps) {
  const {
    addItem,
    composePaths: _composePaths,
    data,
    enabled,
    errors,
    findUISchema: _findUISchema,
    label,
    moveDown,
    moveUp,
    path,
    removeItems,
    renderers,
    cells,
    rootSchema,
    schema,
    uischema,
    uischemas,
    visible,
  } = props

  const childUiSchema = useMemo(
    () =>
      findUISchema(
        uischemas ?? [],
        schema,
        uischema.scope,
        path,
        undefined,
        uischema,
        rootSchema,
      ),
    [uischemas, schema, uischema.scope, path, uischema, rootSchema],
  )

  const count = Array.isArray(data) ? data.length : 0

  const handleAdd = useCallback(() => {
    const defaults = createDefaultValue(schema, rootSchema) as Record<string, unknown>
    addItem(path, { ...defaults, token: generateAuthToken() })()
  }, [addItem, path, schema, rootSchema])

  if (!visible) return null

  return (
    <div className="array-control-layout control">
      <header className="array-layout-toolbar">
        <label>{label}</label>
        <button
          type="button"
          className="button array-control-add"
          disabled={!enabled}
          onClick={handleAdd}
        >
          Add to {label}
        </button>
      </header>

      {errors && errors.length > 0 && (
        <div className="array.control.validation array.control.validation.error">
          {errors}
        </div>
      )}

      <div className="children">
        {count > 0 ? (
          Array.from({ length: count }, (_, index) => {
            const childPath = composePaths(path, `${index}`)
            return (
              <div key={childPath}>
                <JsonFormsDispatch
                  schema={schema}
                  uischema={childUiSchema ?? uischema}
                  path={childPath}
                  renderers={renderers}
                  cells={cells}
                />
                <div className="array-list-item-toolbar">
                  {moveUp && (
                    <button
                      type="button"
                      className="button-up"
                      disabled={!enabled || index === 0}
                      aria-label="Move up"
                      onClick={() => moveUp(path, index)()}
                    >
                      ↑
                    </button>
                  )}
                  {moveDown && (
                    <button
                      type="button"
                      className="button-down"
                      disabled={!enabled || index >= count - 1}
                      aria-label="Move down"
                      onClick={() => moveDown(path, index)()}
                    >
                      ↓
                    </button>
                  )}
                  <button
                    type="button"
                    className="button-delete"
                    disabled={!enabled}
                    aria-label="Remove item"
                    onClick={() => removeItems?.(path, [index])()}
                  >
                    ×
                  </button>
                </div>
              </div>
            )
          })
        ) : null}
      </div>
    </div>
  )
}

export const jsonFormsTokenArrayTester: RankedTester = rankWith(
  10,
  and(
    isObjectArrayControl,
    optionIs('generateToken', true),
  ),
)

export const JsonFormsTokenArrayControl = withJsonFormsArrayControlProps(
  TokenArrayControlRenderer as React.ComponentType<ArrayControlProps>,
)
