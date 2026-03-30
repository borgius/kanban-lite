import { useEffect, useMemo, useRef, useState } from 'react'
import { JsonForms } from '@jsonforms/react'
import { createAjv, type UISchemaElement } from '@jsonforms/core'
import { vanillaCells, vanillaRenderers } from '@jsonforms/vanilla-renderers'
import type { BoardInfo, CardFrontmatter, ExtensionMessage, ResolvedFormDescriptor, SubmitFormTransportResult } from '../../shared/types'
import { formatFormDisplayName } from '../../shared/types'
import { buildCardInterpolationContext, prepareFormData } from '../../shared/formDataPreparation'
import { cn } from '../lib/utils'
import { getVsCodeApi } from '../vsCodeApi'

const vscode = getVsCodeApi()
const formAjv = createAjv({ allErrors: true, strict: false })

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function cloneRecord(value: Record<string, unknown> | undefined): Record<string, unknown> {
  return value ? { ...value } : {}
}

function getSchemaProperties(schema: Record<string, unknown>): Set<string> {
  return isRecord(schema.properties)
    ? new Set(Object.keys(schema.properties))
    : new Set<string>()
}

function getMetadataOverlay(frontmatter: Pick<CardFrontmatter, 'metadata'>, schema: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(frontmatter.metadata)) return {}

  const properties = getSchemaProperties(schema)
  if (properties.size === 0) return {}

  return Object.fromEntries(
    Object.entries(frontmatter.metadata).filter(([key]) => properties.has(key))
  )
}

function getInlineFormLabel(schema: Record<string, unknown>, fallbackId: string): string {
  return typeof schema.title === 'string' && schema.title.trim().length > 0
    ? schema.title.trim()
    : fallbackId
}

function getConfigFormName(formKey: string, configForm: { name?: string } | undefined): string {
  return typeof configForm?.name === 'string' && configForm.name.trim().length > 0
    ? configForm.name.trim()
    : formatFormDisplayName(formKey)
}

function getConfigFormDescription(configForm: { description?: string } | undefined): string {
  return typeof configForm?.description === 'string'
    ? configForm.description.trim()
    : ''
}

function createInlineFormIdResolver(): (name: string | undefined, schema: Record<string, unknown> | undefined, index: number) => string {
  const usedIds = new Set<string>()

  return (name: string | undefined, schema: Record<string, unknown> | undefined, index: number): string => {
    const slugSource = typeof schema?.title === 'string' && schema.title.trim().length > 0
      ? schema.title.trim()
      : `form-${index}`
    const slugifiedSource = slugSource
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50)
    const baseId = name ?? (slugifiedSource || `form-${index}`)

    let candidate = baseId
    let suffix = 2

    while (usedIds.has(candidate)) {
      candidate = `${baseId}-${suffix++}`
    }

    usedIds.add(candidate)
    return candidate
  }
}

export function resolveCardFormDescriptors(
  frontmatter: Pick<CardFrontmatter, 'forms' | 'formData' | 'metadata' | 'id' | 'boardId' | 'status' | 'priority' | 'assignee' | 'dueDate' | 'created' | 'modified' | 'completedAt' | 'labels' | 'attachments' | 'order' | 'actions'> & { content?: string },
  board?: BoardInfo,
): ResolvedFormDescriptor[] {
  const attachments = frontmatter.forms ?? []
  const workspaceForms = board?.forms ?? {}
  const resolveInlineId = createInlineFormIdResolver()
  const interpolationCtx = buildCardInterpolationContext(frontmatter, frontmatter.boardId ?? board?.id ?? '')

  return attachments.flatMap((attachment, index) => {
    const configForm = attachment.name ? workspaceForms[attachment.name] : undefined
    const schema = isRecord(attachment.schema)
      ? attachment.schema
      : isRecord(configForm?.schema)
        ? configForm.schema
        : undefined

    if (!schema) return []

    const formId = resolveInlineId(attachment.name, schema, index)
    const name = attachment.name
      ? getConfigFormName(attachment.name, configForm)
      : getInlineFormLabel(schema, formatFormDisplayName(formId))
    const description = attachment.name
      ? getConfigFormDescription(configForm)
      : ''

    const rawData = {
      ...cloneRecord(configForm?.data),
      ...cloneRecord(isRecord(attachment.data) ? attachment.data : undefined),
      ...cloneRecord(frontmatter.formData?.[formId]),
    }

    return [{
      id: formId,
      name,
      description,
      label: name,
      schema,
      ...(isRecord(attachment.ui)
        ? { ui: attachment.ui }
        : isRecord(configForm?.ui)
          ? { ui: configForm.ui }
          : {}),
      initialData: {
        ...prepareFormData(rawData, interpolationCtx),
        ...getMetadataOverlay(frontmatter, schema),
      },
      fromConfig: Boolean(attachment.name && configForm),
    } satisfies ResolvedFormDescriptor]
  })
}

type FormValidationError = {
  instancePath?: string
  message?: string
  params?: Record<string, unknown>
}

type SuccessfulSubmissionState = {
  formId: string
  dataSignature: string
}

export function validateFormData(schema: Record<string, unknown>, data: Record<string, unknown>): FormValidationError[] {
  const validate = formAjv.compile(schema)
  const valid = validate(data)
  return valid ? [] : ((validate.errors ?? []) as FormValidationError[])
}

export function formatFormValidationError(error: FormValidationError): string {
  const missingProperty = typeof error.params?.missingProperty === 'string'
    ? error.params.missingProperty
    : ''
  const target = missingProperty || error.instancePath || '/'
  const message = error.message || 'is invalid'
  return `${target} ${message}`.trim()
}

export function shouldPreserveFormSuccessMessage(
  formId: string,
  initialDataSignature: string,
  submission: SuccessfulSubmissionState | null,
): boolean {
  return submission?.formId === formId && submission.dataSignature === initialDataSignature
}

interface CardFormTabProps {
  cardId: string
  boardId?: string
  form: ResolvedFormDescriptor
  className?: string
  onSubmitted?: (result: SubmitFormTransportResult) => void
}

export function CardFormTab({ cardId, boardId, form, className, onSubmitted }: CardFormTabProps) {
  const initialDataSignature = useMemo(() => JSON.stringify(form.initialData), [form.initialData])
  const [data, setData] = useState<Record<string, unknown>>(() => cloneRecord(form.initialData))
  const [errors, setErrors] = useState<FormValidationError[]>(() => validateFormData(form.schema, cloneRecord(form.initialData)))
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const pendingListenerRef = useRef<((event: MessageEvent<ExtensionMessage>) => void) | null>(null)
  const lastSuccessfulSubmissionRef = useRef<SuccessfulSubmissionState | null>(null)

  useEffect(() => {
    const nextData = cloneRecord(form.initialData)
    setData(nextData)
    setErrors(validateFormData(form.schema, nextData))
    setSubmitError(null)
    setSuccessMessage((current) => shouldPreserveFormSuccessMessage(form.id, initialDataSignature, lastSuccessfulSubmissionRef.current)
      ? current ?? `Saved ${form.name}`
      : null)
  }, [form.id, form.name, form.schema, form.initialData, initialDataSignature])

  useEffect(() => {
    return () => {
      if (pendingListenerRef.current) {
        window.removeEventListener('message', pendingListenerRef.current)
        pendingListenerRef.current = null
      }
    }
  }, [])

  const handleSubmit = async () => {
    const currentErrors = validateFormData(form.schema, data)
    setErrors(currentErrors)
    setSubmitError(null)
    setSuccessMessage(null)

    if (currentErrors.length > 0 || isSubmitting) {
      return
    }

    const callbackKey = `submit-form-${cardId}-${form.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setIsSubmitting(true)

    try {
      const result = await new Promise<SubmitFormTransportResult>((resolve, reject) => {
        const handleMessage = (event: MessageEvent<ExtensionMessage>) => {
          const message = event.data
          if (!message || message.type !== 'submitFormResult' || message.callbackKey !== callbackKey) {
            return
          }

          window.removeEventListener('message', handleMessage)
          pendingListenerRef.current = null

          if (message.error) {
            reject(new Error(message.error))
            return
          }

          if (!message.result) {
            reject(new Error('Form submission failed without a result payload'))
            return
          }

          resolve(message.result)
        }

        pendingListenerRef.current = handleMessage
        window.addEventListener('message', handleMessage)
        vscode.postMessage({
          type: 'submitForm',
          cardId,
          formId: form.id,
          data,
          callbackKey,
          ...(boardId ? { boardId } : {}),
        })
      })

      const persistedData = isRecord(result.card.formData?.[form.id])
        ? result.card.formData?.[form.id]
        : result.data
      const normalizedData = cloneRecord(persistedData)
      lastSuccessfulSubmissionRef.current = {
        formId: form.id,
        dataSignature: JSON.stringify(normalizedData),
      }
      setData(normalizedData)
      setErrors(validateFormData(form.schema, normalizedData))
      setSuccessMessage(`Saved ${form.name}`)
      onSubmitted?.(result)
    } catch (error) {
      lastSuccessfulSubmissionRef.current = null
      setSubmitError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  const hasValidationErrors = errors.length > 0

  return (
    <div className={cn('flex h-full flex-col', className)}>
      <div
        className="flex items-center justify-between gap-3 px-4 py-3"
        style={{ borderBottom: '1px solid var(--vscode-panel-border)' }}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold" style={{ color: 'var(--vscode-foreground)' }}>
              {form.name}
            </h3>
            {form.fromConfig && (
              <span
                className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                style={{
                  background: 'var(--vscode-badge-background)',
                  color: 'var(--vscode-badge-foreground)',
                }}
              >
                Shared
              </span>
            )}
          </div>
          {form.description && (
            <p className="mt-1 text-xs" style={{ color: 'var(--vscode-descriptionForeground)' }}>
              {form.description}
            </p>
          )}
          {hasValidationErrors && (
            <p className="mt-1 text-xs font-medium" style={{ color: 'var(--vscode-errorForeground)' }}>
              {`Fix ${errors.length} validation error${errors.length === 1 ? '' : 's'} before submitting.`}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={hasValidationErrors || isSubmitting}
          className="rounded px-3 py-1.5 text-xs font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            background: 'var(--vscode-button-background)',
            color: 'var(--vscode-button-foreground)',
          }}
          title={hasValidationErrors ? 'Resolve validation errors before submitting' : undefined}
        >
          {isSubmitting ? 'Submitting…' : 'Submit'}
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="card-jsonforms p-4">
          <JsonForms
            schema={form.schema}
            uischema={form.ui as UISchemaElement | undefined}
            data={data}
            renderers={vanillaRenderers}
            cells={vanillaCells}
            ajv={formAjv}
            validationMode="ValidateAndShow"
            onChange={({ data: nextData, errors: nextErrors }) => {
              const normalizedData = isRecord(nextData) ? nextData : {}
              lastSuccessfulSubmissionRef.current = null
              setData(normalizedData)
              setErrors((nextErrors ?? []) as FormValidationError[])
              setSubmitError(null)
              setSuccessMessage(null)
            }}
          />
        </div>

        {(submitError || successMessage || hasValidationErrors) && (
          <div className="space-y-2 px-4 pb-4">
            {submitError && (
              <div
                className="rounded px-3 py-2 text-xs"
                style={{
                  background: 'color-mix(in srgb, var(--vscode-errorForeground) 12%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--vscode-errorForeground) 40%, transparent)',
                  color: 'var(--vscode-errorForeground)',
                }}
              >
                {submitError}
              </div>
            )}

            {successMessage && !submitError && (
              <div
                className="rounded px-3 py-2 text-xs"
                style={{
                  background: 'color-mix(in srgb, var(--vscode-testing-iconPassed) 12%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--vscode-testing-iconPassed) 40%, transparent)',
                  color: 'var(--vscode-testing-iconPassed)',
                }}
              >
                {successMessage}
              </div>
            )}

            {hasValidationErrors && (
              <div
                className="rounded px-3 py-2"
                style={{
                  background: 'var(--vscode-inputValidation-warningBackground, color-mix(in srgb, var(--vscode-editorWarning-foreground, #d7ba7d) 10%, transparent))',
                  border: '1px solid var(--vscode-inputValidation-warningBorder, var(--vscode-editorWarning-foreground, #d7ba7d))',
                }}
              >
                <p className="mb-2 text-xs font-medium" style={{ color: 'var(--vscode-foreground)' }}>
                  Validation issues
                </p>
                <ul className="space-y-1 pl-4 text-xs" style={{ color: 'var(--vscode-foreground)' }}>
                  {errors.map((error) => (
                    <li key={JSON.stringify(error)} className="list-disc">
                      {formatFormValidationError(error)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
