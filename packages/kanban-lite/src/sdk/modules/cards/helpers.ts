import * as fs from 'fs/promises'
import * as path from 'path'
import { createAjv } from '@jsonforms/core'
import type Ajv from 'ajv'
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'
import type { Card, CardFormAttachment, CardSortOption, CardTask, ResolvedFormDescriptor, TaskPermissionsReadModel } from '../../../shared/types'
import { getTitleFromContent, generateCardFilename, extractNumericId, DELETED_STATUS_ID, CARD_FORMAT_VERSION, generateSlug, formatFormDisplayName } from '../../../shared/types'
import { readConfig, allocateCardId, syncCardIdCounter } from '../../../shared/config'
import { buildCardInterpolationContext, prepareFormData } from '../../../shared/formDataPreparation'
import { getCardFilePath } from '../../fileUtils'
import { matchesCardSearch } from '../../metaUtils'
import type { AuthIdentity, AuthVisibilityFilterInput } from '../../plugins'
import { sanitizeCard } from '../../types'
import type { AuthContext, CreateCardInput, FormSubmitEvent, SubmitFormInput, SubmitFormResult } from '../../types'
import type { SDKContext } from '../context'
import { buildChecklistTask, buildChecklistToken, isReservedChecklistLabel, normalizeCardChecklistState, normalizeChecklistTasks, projectCardChecklistState } from '../checklist'
import { appendActivityLog } from '../logs'
import { getRuntimeHost, type RuntimeHostActiveCardState } from '../../../shared/env'


export interface ActiveCardState extends RuntimeHostActiveCardState {}

const IGNORABLE_ACTIVE_CARD_STATE_ERROR_CODES = new Set([
  'EPERM',
  'EROFS',
  'ENOSYS',
  'ERR_ACCESS_DENIED',
])

const IGNORABLE_ACTIVE_CARD_STATE_ERROR_PATTERN = /operation not permitted|read-only file system|access denied|not implemented/i

export function getActiveCardStateFilePath(ctx: SDKContext): string {
  return path.join(ctx.kanbanDir, '.active-card.json')
}

function getRuntimeHostActiveCardScope(ctx: SDKContext): { workspaceRoot: string; kanbanDir: string } {
  return {
    workspaceRoot: ctx.workspaceRoot,
    kanbanDir: ctx.kanbanDir,
  }
}

function normalizeActiveCardState(value: unknown): ActiveCardState | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const candidate = value as Partial<ActiveCardState>
  if (typeof candidate.cardId !== 'string' || typeof candidate.boardId !== 'string') {
    return null
  }

  return {
    cardId: candidate.cardId,
    boardId: candidate.boardId,
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : new Date().toISOString(),
  }
}

function shouldIgnoreActiveCardStatePersistenceError(error: unknown): boolean {
  const code = typeof (error as { code?: unknown } | null)?.code === 'string'
    ? (error as { code: string }).code
    : ''

  if (IGNORABLE_ACTIVE_CARD_STATE_ERROR_CODES.has(code)) {
    return true
  }

  const message = error instanceof Error ? error.message : String(error)
  return IGNORABLE_ACTIVE_CARD_STATE_ERROR_PATTERN.test(message)
}

export const formAjv: Ajv = createAjv({ allErrors: true, strict: false })

function isCodegenRestrictedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /code generation from strings disallowed|unsafe-eval|disallowed for this context/i.test(message)
}

function joinSchemaPath(basePath: string, key: string | number): string {
  return basePath === '/' ? `/${key}` : `${basePath}/${key}`
}

function jsonValueEquals(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function validateFormSchemaWithoutCodegen(
  schema: Record<string, unknown>,
  value: unknown,
  path = '/',
): string[] {
  const errors: string[] = []

  if ('const' in schema && !jsonValueEquals(value, schema.const)) {
    errors.push(`${path} must equal ${JSON.stringify(schema.const)}`)
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0 && !schema.enum.some((entry) => jsonValueEquals(entry, value))) {
    errors.push(`${path} must be one of ${schema.enum.map((entry) => JSON.stringify(entry)).join(', ')}`)
  }

  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    const matchingSchemas = schema.oneOf.filter((candidate) => isRecord(candidate) && validateFormSchemaWithoutCodegen(candidate, value, path).length === 0)
    if (matchingSchemas.length !== 1) {
      errors.push(`${path} must match exactly one allowed option`)
    }
  }

  const schemaType = typeof schema.type === 'string' ? schema.type : undefined
  switch (schemaType) {
    case 'object': {
      if (!isRecord(value)) {
        errors.push(`${path} must be object`)
        return errors
      }

      const properties = isRecord(schema.properties) ? schema.properties : {}
      const required = Array.isArray(schema.required)
        ? schema.required.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        : []

      for (const key of required) {
        if (value[key] === undefined) {
          errors.push(`${joinSchemaPath(path, key)} is required`)
        }
      }

      for (const [key, propertySchema] of Object.entries(properties)) {
        if (!isRecord(propertySchema) || value[key] === undefined) continue
        errors.push(...validateFormSchemaWithoutCodegen(propertySchema, value[key], joinSchemaPath(path, key)))
      }

      if (schema.additionalProperties === false) {
        const allowedKeys = new Set(Object.keys(properties))
        for (const key of Object.keys(value)) {
          if (!allowedKeys.has(key)) {
            errors.push(`${joinSchemaPath(path, key)} is not allowed`)
          }
        }
      }
      return errors
    }

    case 'array': {
      if (!Array.isArray(value)) {
        errors.push(`${path} must be array`)
        return errors
      }

      if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
        errors.push(`${path} must contain at least ${schema.minItems} items`)
      }
      if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
        errors.push(`${path} must contain no more than ${schema.maxItems} items`)
      }

      if (isRecord(schema.items)) {
        value.forEach((entry, index) => {
          errors.push(...validateFormSchemaWithoutCodegen(schema.items as Record<string, unknown>, entry, joinSchemaPath(path, index)))
        })
      }
      return errors
    }

    case 'string': {
      if (typeof value !== 'string') {
        errors.push(`${path} must be string`)
        return errors
      }
      if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
        errors.push(`${path} must NOT have fewer than ${schema.minLength} characters`)
      }
      if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
        errors.push(`${path} must NOT have more than ${schema.maxLength} characters`)
      }
      if (typeof schema.pattern === 'string' && !(new RegExp(schema.pattern).test(value))) {
        errors.push(`${path} must match pattern ${schema.pattern}`)
      }
      return errors
    }

    case 'number': {
      if (typeof value !== 'number' || Number.isNaN(value)) {
        errors.push(`${path} must be number`)
        return errors
      }
      if (typeof schema.minimum === 'number' && value < schema.minimum) {
        errors.push(`${path} must be >= ${schema.minimum}`)
      }
      if (typeof schema.maximum === 'number' && value > schema.maximum) {
        errors.push(`${path} must be <= ${schema.maximum}`)
      }
      return errors
    }

    case 'integer': {
      if (typeof value !== 'number' || Number.isNaN(value) || !Number.isInteger(value)) {
        errors.push(`${path} must be integer`)
        return errors
      }
      if (typeof schema.minimum === 'number' && value < schema.minimum) {
        errors.push(`${path} must be >= ${schema.minimum}`)
      }
      if (typeof schema.maximum === 'number' && value > schema.maximum) {
        errors.push(`${path} must be <= ${schema.maximum}`)
      }
      return errors
    }

    case 'boolean': {
      if (typeof value !== 'boolean') {
        errors.push(`${path} must be boolean`)
      }
      return errors
    }

    case 'null': {
      if (value !== null) {
        errors.push(`${path} must be null`)
      }
      return errors
    }

    default:
      return errors
  }
}

export function validateFormData(schema: Record<string, unknown>, value: unknown): string | null {
  try {
    const validate = formAjv.compile(schema)
    const valid = validate(value)
    if (valid) return null
    return formatValidationErrors(validate.errors)
  } catch (error) {
    if (!isCodegenRestrictedError(error)) {
      throw error
    }

    const fallbackErrors = validateFormSchemaWithoutCodegen(schema, value)
    return fallbackErrors.length > 0 ? fallbackErrors.join('; ') : null
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function cloneRecord(value: Record<string, unknown> | undefined): Record<string, unknown> {
  return value ? { ...value } : {}
}

type AuthScopedCardsContext = SDKContext & {
  readonly _currentAuthContext?: AuthContext
}

export function requireExpectedModifiedAt(current: CardTask, modifiedAt: string | undefined): void {
  if (typeof modifiedAt !== 'string' || modifiedAt.trim().length === 0) {
    throw new Error('Checklist mutations for existing items require modifiedAt')
  }

  if (modifiedAt !== current.modifiedAt) {
    throw new Error('Checklist item is stale: modifiedAt does not match current value')
  }
}

export function requireExpectedChecklistToken(currentTasks: readonly CardTask[] | undefined, expectedToken: string | undefined): void {
  if (typeof expectedToken !== 'string' || expectedToken.trim().length === 0) {
    throw new Error('Checklist additions require expectedToken from the latest checklist read model')
  }

  if (expectedToken !== buildChecklistToken(currentTasks)) {
    throw new Error('Checklist is stale: expectedToken does not match current checklist state')
  }
}

const CARD_EDIT_ACTIVITY_FIELDS = new Set<keyof Card>([
  'content',
  'priority',
  'assignee',
  'dueDate',
  'labels',
  'metadata',
])

export function getQualifyingCardEditFields(updates: Partial<Card>, original: Card): string[] {
  return Object.keys(updates).filter((key) => {
    if (!CARD_EDIT_ACTIVITY_FIELDS.has(key as keyof Card)) return false
    const prev = original[key as keyof Card]
    const next = updates[key as keyof Card]
    return JSON.stringify(prev) !== JSON.stringify(next)
  })
}

export function hasSameReservedChecklistLabels(left: readonly string[], right: readonly string[]): boolean {
  const leftReserved = new Set(left.filter((label) => isReservedChecklistLabel(label)))
  const rightReserved = new Set(right.filter((label) => isReservedChecklistLabel(label)))

  if (leftReserved.size !== rightReserved.size) {
    return false
  }

  for (const label of leftReserved) {
    if (!rightReserved.has(label)) {
      return false
    }
  }

  return true
}

export async function assertChecklistReservedLabelUpdateAllowed(ctx: SDKContext, card: Card, labels: readonly string[]): Promise<void> {
  const visibleReservedLabels = (await canShowChecklist(ctx))
    ? card.labels.filter((label) => isReservedChecklistLabel(label))
    : []

  if (!hasSameReservedChecklistLabels(labels, visibleReservedLabels)) {
    throw new Error('Checklist-derived labels cannot be edited directly')
  }
}

export function getSchemaProperties(schema: Record<string, unknown>): Set<string> {
  return isRecord(schema.properties)
    ? new Set(Object.keys(schema.properties))
    : new Set<string>()
}

export function getMetadataOverlay(card: Omit<Card, 'filePath'>, schema: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(card.metadata)) return {}

  const properties = getSchemaProperties(schema)
  if (properties.size === 0) return {}

  return Object.fromEntries(
    Object.entries(card.metadata).filter(([key]) => properties.has(key))
  )
}

export function getInlineFormLabel(schema: Record<string, unknown>, fallbackId: string): string {
  return typeof schema.title === 'string' && schema.title.trim().length > 0
    ? schema.title.trim()
    : fallbackId
}

export function getConfigFormName(formKey: string, configForm: { name?: string } | undefined): string {
  return typeof configForm?.name === 'string' && configForm.name.trim().length > 0
    ? configForm.name.trim()
    : formatFormDisplayName(formKey)
}

export function getConfigFormDescription(configForm: { description?: string } | undefined): string {
  return typeof configForm?.description === 'string'
    ? configForm.description.trim()
    : ''
}

export function createInlineFormIdResolver(): (attachment: CardFormAttachment, index: number) => string {
  const usedIds = new Set<string>()

  return (attachment: CardFormAttachment, index: number): string => {
    const schema = isRecord(attachment.schema) ? attachment.schema : undefined
    const baseId = attachment.name
      ?? (schema && typeof schema.title === 'string' && schema.title.trim().length > 0
        ? generateSlug(schema.title)
        : `form-${index}`)

    let candidate = baseId || `form-${index}`
    let suffix = 2
    while (usedIds.has(candidate)) {
      candidate = `${baseId}-${suffix++}`
    }
    usedIds.add(candidate)
    return candidate
  }
}

export function resolveCardForms(ctx: SDKContext, card: Omit<Card, 'filePath'>): ResolvedFormDescriptor[] {
  const config = readConfig(ctx.workspaceRoot)
  const workspaceForms = config.forms ?? {}
  const attachments = card.forms ?? []
  const resolveInlineId = createInlineFormIdResolver()

  return attachments.flatMap((attachment, index) => {
    const configForm = attachment.name ? workspaceForms[attachment.name] : undefined
    const schema = isRecord(attachment.schema)
      ? attachment.schema
      : isRecord(configForm?.schema)
        ? configForm.schema
        : undefined

    if (!schema) return []

    const formId = resolveInlineId(attachment, index)
    const name = attachment.name
      ? getConfigFormName(attachment.name, configForm)
      : getInlineFormLabel(schema, formatFormDisplayName(formId))
    const description = attachment.name
      ? getConfigFormDescription(configForm)
      : ''

    const interpolationCtx = buildCardInterpolationContext(
      card,
      card.boardId || ctx._resolveBoardId(undefined),
    )
    const rawData = {
      ...cloneRecord(configForm?.data),
      ...cloneRecord(isRecord(attachment.data) ? attachment.data : undefined),
      ...cloneRecord(card.formData?.[formId]),
    }
    const initialData = {
      ...prepareFormData(rawData, interpolationCtx),
      ...getMetadataOverlay(card, schema),
    }

    const descriptor: ResolvedFormDescriptor = {
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
      initialData,
      fromConfig: Boolean(attachment.name && configForm),
    }

    return [descriptor]
  })
}

export function formatValidationErrors(errors: unknown): string {
  if (!Array.isArray(errors) || errors.length === 0) {
    return 'Invalid form submission'
  }

  return errors
    .map((error) => {
      if (!isRecord(error)) return 'validation error'
      const instancePath = typeof error.instancePath === 'string' ? error.instancePath : ''
      const missingProperty = isRecord(error.params) && typeof error.params.missingProperty === 'string'
        ? error.params.missingProperty
        : ''
      const target = missingProperty || instancePath || '/'
      const message = typeof error.message === 'string' ? error.message : 'is invalid'
      return `${target} ${message}`.trim()
    })
    .join('; ')
}

export function normalizeResolvedRoles(identity: AuthIdentity | null): string[] {
  if (!Array.isArray(identity?.roles)) return []

  return identity.roles
    .filter((role): role is string => typeof role === 'string' && role.trim().length > 0)
    .map((role) => role.trim())
}

export function buildVisibilityAuthContext(
  auth: AuthContext,
  identity: AuthIdentity | null,
  roles: readonly string[],
): AuthContext {
  const restAuth = { ...auth }
  delete restAuth.identity
  if (!identity?.subject) return restAuth

  const groups = Array.isArray(identity.groups)
    ? identity.groups
      .filter((group): group is string => typeof group === 'string' && group.trim().length > 0)
      .map((group) => group.trim())
    : []

  return {
    ...restAuth,
    identity: {
      subject: identity.subject,
      roles: [...roles],
      ...(groups.length > 0 ? { groups } : {}),
    },
  }
}

export async function applyCardVisibilityFilter(ctx: SDKContext, cards: Card[]): Promise<Card[]> {
  const capabilities = ctx.capabilities
  const visibilityProvider = capabilities?.authVisibility
  if (!visibilityProvider || cards.length === 0) {
    return cards
  }

  const activeAuthContext = (ctx as AuthScopedCardsContext)._currentAuthContext ?? {}
  if (Object.keys(activeAuthContext).length === 0) {
    return cards
  }

  const identity = await capabilities.authIdentity.resolveIdentity(activeAuthContext)
  const roles = normalizeResolvedRoles(identity)
  const input: AuthVisibilityFilterInput = {
    identity,
    roles,
    auth: buildVisibilityAuthContext(activeAuthContext, identity, roles),
  }

  return visibilityProvider.filterVisibleCards(cards, input)
}

export async function canShowChecklist(ctx: SDKContext): Promise<boolean> {
  const capabilities = ctx.capabilities
  if (!capabilities) {
    return true
  }

  const activeAuthContext = (ctx as AuthScopedCardsContext)._currentAuthContext ?? {}

  try {
    const identity = await capabilities.authIdentity.resolveIdentity(activeAuthContext)
    const decision = await capabilities.authPolicy.checkPolicy(identity, 'card.checklist.show', activeAuthContext)
    return decision.allowed
  } catch {
    return false
  }
}

export function buildTaskPermissionAuthContext(ctx: SDKContext, card: Omit<Card, 'filePath'>, overrides: Partial<AuthContext> = {}): AuthContext {
  const currentAuth = (ctx as AuthScopedCardsContext)._currentAuthContext ?? {}
  return {
    ...currentAuth,
    boardId: card.boardId || ctx._resolveBoardId(undefined),
    cardId: card.id,
    ...overrides,
  }
}

export function getCardActionKeys(actions: Card['actions'] | undefined): string[] {
  const keys = Array.isArray(actions)
    ? actions
    : isRecord(actions)
      ? Object.keys(actions)
      : []

  return [...new Set(
    keys
      .filter((value): value is string => typeof value === 'string')
      .map(value => value.trim())
      .filter(value => value.length > 0),
  )]
}

/**
 * Builds the server-owned task permission read model for the current caller.
 *
 * This keeps policy evaluation on the server so downstream surfaces can render
 * task affordances without re-implementing auth checks on the client.
 */
export async function buildTaskPermissionsReadModel(ctx: SDKContext, card: Omit<Card, 'filePath'>): Promise<TaskPermissionsReadModel> {
  const baseContext = buildTaskPermissionAuthContext(ctx, card)
  const commentEntries = await Promise.all((card.comments ?? []).map(async (comment) => {
    const authContext = buildTaskPermissionAuthContext(ctx, card, { commentId: comment.id })
    return [comment.id, {
      update: await ctx.canPerformAction('comment.update', authContext),
      delete: await ctx.canPerformAction('comment.delete', authContext),
    }] as const
  }))

  const attachmentEntries = await Promise.all((card.attachments ?? []).map(async (attachment) => {
    const authContext = buildTaskPermissionAuthContext(ctx, card, { attachment })
    return [attachment, {
      remove: await ctx.canPerformAction('attachment.remove', authContext),
    }] as const
  }))

  const resolvedForms = resolveCardForms(ctx, card)
  const formEntries = await Promise.all(resolvedForms.map(async (form) => {
    const authContext = buildTaskPermissionAuthContext(ctx, card, { formId: form.id })
    return [form.id, {
      submit: await ctx.canPerformAction('form.submit', authContext),
    }] as const
  }))

  const actionEntries = await Promise.all(getCardActionKeys(card.actions).map(async (actionKey) => {
    const authContext = buildTaskPermissionAuthContext(ctx, card, { actionKey })
    return [actionKey, {
      trigger: await ctx.canPerformAction('card.action.trigger', authContext),
    }] as const
  }))

  const commentById = Object.fromEntries(commentEntries)
  const attachmentByName = Object.fromEntries(attachmentEntries)
  const formById = Object.fromEntries(formEntries)
  const actionByKey = Object.fromEntries(actionEntries)

  const commentPermissions = Object.values(commentById)
  const attachmentPermissions = Object.values(attachmentByName)
  const formPermissions = Object.values(formById)
  const actionPermissions = Object.values(actionByKey)

  return {
    comment: {
      create: await ctx.canPerformAction('comment.create', baseContext),
      update: commentPermissions.some(entry => entry.update),
      delete: commentPermissions.some(entry => entry.delete),
      ...(commentEntries.length > 0 ? { byId: commentById } : {}),
    },
    attachment: {
      add: await ctx.canPerformAction('attachment.add', baseContext),
      remove: attachmentPermissions.some(entry => entry.remove),
      ...(attachmentEntries.length > 0 ? { byName: attachmentByName } : {}),
    },
    form: {
      submit: formPermissions.some(entry => entry.submit),
      ...(formEntries.length > 0 ? { byId: formById } : {}),
    },
    checklist: {
      show: await ctx.canPerformAction('card.checklist.show', baseContext),
      add: await ctx.canPerformAction('card.checklist.add', baseContext),
      edit: await ctx.canPerformAction('card.checklist.edit', baseContext),
      delete: await ctx.canPerformAction('card.checklist.delete', baseContext),
      check: await ctx.canPerformAction('card.checklist.check', baseContext),
      uncheck: await ctx.canPerformAction('card.checklist.uncheck', baseContext),
    },
    cardAction: {
      trigger: actionPermissions.some(entry => entry.trigger),
      ...(actionEntries.length > 0 ? { byKey: actionByKey } : {}),
    },
    metadata: {
      update: await ctx.canPerformAction('card.update', baseContext),
    },
  }
}

export async function readActiveCardState(ctx: SDKContext): Promise<ActiveCardState | null> {
  const runtimeHost = getRuntimeHost()
  if (runtimeHost?.readActiveCardState) {
    return normalizeActiveCardState(
      await runtimeHost.readActiveCardState(getRuntimeHostActiveCardScope(ctx)),
    )
  }

  try {
    const raw = await fs.readFile(getActiveCardStateFilePath(ctx), 'utf-8')
    return normalizeActiveCardState(JSON.parse(raw))
  } catch {
    return null
  }
}

export async function writeActiveCardState(ctx: SDKContext, state: ActiveCardState): Promise<void> {
  const runtimeHost = getRuntimeHost()
  if (runtimeHost?.writeActiveCardState) {
    await runtimeHost.writeActiveCardState(getRuntimeHostActiveCardScope(ctx), state)
    return
  }

  try {
    await fs.mkdir(ctx.kanbanDir, { recursive: true })
    await fs.writeFile(getActiveCardStateFilePath(ctx), JSON.stringify(state, null, 2), 'utf-8')
  } catch (error) {
    if (!shouldIgnoreActiveCardStatePersistenceError(error)) {
      throw error
    }
  }
}

export async function clearPersistedActiveCardState(ctx: SDKContext): Promise<void> {
  const runtimeHost = getRuntimeHost()
  if (runtimeHost?.clearActiveCardState) {
    await runtimeHost.clearActiveCardState(getRuntimeHostActiveCardScope(ctx))
    return
  }

  try {
    await fs.unlink(getActiveCardStateFilePath(ctx))
  } catch {
    // ignore missing files
  }
}


