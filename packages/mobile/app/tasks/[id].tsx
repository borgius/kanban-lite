import { useTheme } from '@react-navigation/native'
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import {
  AttachmentDraftError,
  deleteDurableAttachmentDraft,
  prepareDurableAttachmentDraft,
  readAttachmentDraftAsBase64,
} from '../../src/features/attachments/durable-drafts'
import {
  type RecordedVoiceCommentClip,
  VoiceCommentRecorderSheet,
} from '../../src/features/comments/VoiceCommentRecorderSheet'
import {
  type VoiceCommentPlaybackAuth,
  VoiceCommentPlayer,
} from '../../src/features/comments/VoiceCommentPlayer'
import {
  buildVoiceCommentContent,
  parseVoiceCommentContent,
  type VoiceCommentAttachmentRef,
} from '../../src/features/comments/voice-comments'
import {
  createExpoSessionStorage,
  readStoredSession,
  useSessionController,
} from '../../src/features/auth/session-store'
import {
  DEFAULT_SESSION_NAMESPACE,
  type AttachmentDraftRecord,
  type CacheNamespace,
  type ChecklistDraftRecord,
  type CommentDraftRecord,
  type FormDraftRecord,
  createCacheStore,
  createExpoCacheStorage,
  hydrateWithPurgeCleanup,
  type PersistedEnvelopeV1,
  readNamespaceAttachmentDrafts,
} from '../../src/features/sync/cache-store'
import {
  buildTaskDetailShellModel,
  canUseTaskDetailCacheFallback,
  isProtectedTaskAccessError,
  isTaskUnavailableError,
  readCachedTaskDetailSnapshot,
  type TaskDetailDockAction,
  type TaskDetailActionShellItem,
  type TaskDetailAttachmentShellItem,
  type TaskDetailChecklistShellItem,
  type TaskDetailCommentShellItem,
  type TaskDetailFormShellItem,
} from '../../src/features/tasks/task-permissions'
import {
  createMobileApiClient,
  MobileApiClientError,
  type MobileApiClient,
  type MobileCommentReadModel,
  type MobileTaskDetail,
  type JsonObject,
  type JsonValue,
} from '../../src/lib/api/client'

type DetailPhase = 'blocked' | 'error' | 'loading' | 'ready' | 'unavailable'
type DetailSource = 'cache' | 'live' | 'none'

interface DetailLoadState {
  errorMessage: string | null
  phase: DetailPhase
  source: DetailSource
  task: MobileTaskDetail | null
}

interface ShellColors {
  background: string
  border: string
  card: string
  primary: string
  text: string
}

interface InlineBannerState {
  message: string
  title: string
  tone: 'error' | 'notice'
}

interface PendingVoiceCommentDraft {
  durationMs?: number
  fileName: string
  mimeType: string
  sizeBytes: number
  uri: string
}

type StoredSessionRecord = NonNullable<Awaited<ReturnType<typeof readStoredSession>>>

function normalizeTaskId(rawId: string | string[] | undefined): string | null {
  const value = Array.isArray(rawId) ? rawId[0] : rawId
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

function formatDueDate(dueDate: string | null): string {
  return dueDate ?? 'No due date'
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '—'
  }

  if (typeof value === 'string') {
    return value.trim().length > 0 ? value : '—'
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  if (Array.isArray(value)) {
    return value.length === 0 ? '—' : `${value.length} item${value.length === 1 ? '' : 's'}`
  }

  if (typeof value === 'object') {
    const count = Object.keys(value as Record<string, unknown>).length
    return count === 0 ? '—' : `${count} field${count === 1 ? '' : 's'}`
  }

  return '—'
}

function summaryEntries(record: Record<string, unknown>): Array<[string, string]> {
  return Object.entries(record)
    .slice(0, 3)
    .map(([key, value]) => [key, formatValue(value)])
}

function buildCacheNamespace(session: StoredSessionRecord): CacheNamespace {
  return {
    sessionNamespace: DEFAULT_SESSION_NAMESPACE,
    subject: session.subject,
    workspaceId: session.workspaceId,
    workspaceOrigin: session.workspaceOrigin,
  }
}

function buildDraftId(prefix: 'comment'): string
function buildDraftId(prefix: 'attachment'): string
function buildDraftId(prefix: 'checklist'): string
function buildDraftId(prefix: 'form'): string
function buildDraftId(prefix: 'attachment' | 'checklist' | 'comment' | 'form'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function selectTaskDrafts(
  envelope: PersistedEnvelopeV1 | null,
  taskId: string | null,
): {
  attachmentDrafts: AttachmentDraftRecord[]
  checklistDrafts: ChecklistDraftRecord[]
  commentDrafts: CommentDraftRecord[]
  formDrafts: FormDraftRecord[]
} {
  if (!envelope || !taskId) {
    return {
      attachmentDrafts: [],
      checklistDrafts: [],
      commentDrafts: [],
      formDrafts: [],
    }
  }

  return {
    attachmentDrafts: envelope.attachments.items.filter((draft) => draft.taskId === taskId),
    checklistDrafts: envelope.drafts.checklists.filter((draft) => draft.taskId === taskId),
    commentDrafts: envelope.drafts.comments.filter((draft) => draft.taskId === taskId),
    formDrafts: envelope.drafts.forms.filter((draft) => draft.taskId === taskId),
  }
}

function resolveMutationErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  return fallback
}

function shouldStoreAsLocalDraft(error: unknown): boolean {
  if (isProtectedTaskAccessError(error)) {
    return false
  }

  if (error instanceof MobileApiClientError) {
    return error.status >= 500
  }

  return true
}

function createPendingDraftBanner(
  commentDrafts: CommentDraftRecord[],
  attachmentDrafts: AttachmentDraftRecord[],
  checklistDrafts: ChecklistDraftRecord[],
  formDrafts: FormDraftRecord[],
): InlineBannerState | null {
  if (
    commentDrafts.length === 0
    && attachmentDrafts.length === 0
    && checklistDrafts.length === 0
    && formDrafts.length === 0
  ) {
    return null
  }

  const hasReviewState = [...commentDrafts, ...attachmentDrafts, ...checklistDrafts, ...formDrafts].some((draft) => (
    draft.status === 'conflict' || draft.status === 'failed'
  ))

  if (hasReviewState) {
    return {
      title: 'Drafts need review',
      message: 'Some local work needs attention before you resend it.',
      tone: 'error',
    }
  }

  return {
    title: 'Saved on this device',
    message: 'Saved on this device. Review before sending.',
    tone: 'notice',
  }
}

function describeCommentDraftNote(draft: CommentDraftRecord): string {
  if (draft.lastError?.message) {
    return draft.lastError.message
  }

  if (draft.status === 'sending') {
    return 'Sending this comment draft…'
  }

  if (draft.operation === 'update') {
    return 'Local edit pending. Review before sending.'
  }

  return 'Saved on this device. Review before sending.'
}

function describeCommentDraftActionLabel(draft: CommentDraftRecord): string {
  if (draft.status === 'sending') {
    return 'Sending…'
  }

  if (draft.status === 'draft') {
    return draft.operation === 'update' ? 'Send edit' : 'Send comment'
  }

  return 'Resend'
}

function describeAttachmentDraftNote(draft: AttachmentDraftRecord): string {
  if (draft.lastError?.message) {
    return draft.lastError.message
  }

  if (draft.status === 'sending') {
    return 'Uploading this draft…'
  }

  return 'Saved on this device. Review before sending.'
}

function describeAttachmentDraftActionLabel(draft: AttachmentDraftRecord): string {
  if (draft.status === 'sending') {
    return 'Uploading…'
  }

  return draft.status === 'draft' ? 'Upload draft' : 'Resend upload'
}

function describeFormDraftNote(draft: FormDraftRecord): string {
  if (draft.lastError?.message) {
    return draft.lastError.message
  }

  if (draft.status === 'sending') {
    return 'Sending this form draft…'
  }

  return 'Saved on this device. Review before sending.'
}

function describeFormDraftActionLabel(draft: FormDraftRecord): string {
  if (draft.status === 'sending') {
    return 'Sending…'
  }

  return draft.status === 'draft' ? 'Send draft' : 'Resend draft'
}

function isChecklistConflictError(error: unknown): boolean {
  if (error instanceof MobileApiClientError && (error.status === 409 || error.status === 412)) {
    return true
  }

  const message = error instanceof Error ? error.message : ''
  return /checklist item is stale|checklist is stale|expectedraw does not match|expectedtoken does not match/i.test(message)
}

function buildChecklistConflictMessage(): string {
  return 'This task changed somewhere else. Review latest, then retry with latest or discard this local change.'
}

function describeChecklistDraftTitle(draft: ChecklistDraftRecord): string {
  switch (draft.action) {
    case 'add':
      return 'Pending checklist item'
    case 'delete':
      return 'Pending removal'
    case 'edit':
      return 'Pending edit'
    case 'check':
      return 'Pending check'
    case 'uncheck':
      return 'Pending reopen'
    default:
      return 'Pending checklist change'
  }
}

function describeChecklistDraftNote(draft: ChecklistDraftRecord): string {
  if (draft.lastError?.message) {
    return draft.lastError.message
  }

  if (draft.status === 'sending') {
    return 'Sending this checklist change…'
  }

  switch (draft.action) {
    case 'add':
      return 'Saved on this device. Review before sending.'
    case 'delete':
      return 'Pending removal saved on this device. Review before sending.'
    case 'edit':
      return 'Local edit pending. Review before sending.'
    case 'check':
    case 'uncheck':
      return 'Pending checklist update. Review before sending.'
    default:
      return 'Saved on this device. Review before sending.'
  }
}

function describeChecklistDraftActionLabel(draft: ChecklistDraftRecord): string {
  if (draft.status === 'sending') {
    return 'Sending…'
  }

  if (draft.status === 'conflict') {
    return 'Retry with latest'
  }

  if (draft.status !== 'draft') {
    return 'Resend'
  }

  switch (draft.action) {
    case 'add':
      return 'Send item'
    case 'delete':
      return 'Send removal'
    case 'edit':
      return 'Send edit'
    case 'check':
      return 'Send check'
    case 'uncheck':
      return 'Send reopen'
    default:
      return 'Send change'
  }
}

function describeChecklistPendingNote(draft: ChecklistDraftRecord): string {
  switch (draft.action) {
    case 'delete':
      return 'Pending removal saved below.'
    case 'edit':
      return 'Local edit pending below.'
    case 'check':
      return 'Pending check saved below.'
    case 'uncheck':
      return 'Pending reopen saved below.'
    default:
      return 'Local checklist change pending below.'
  }
}

function describeChecklistDraftValue(draft: ChecklistDraftRecord): string {
  if (draft.text && draft.text.trim().length > 0) {
    return draft.text.trim()
  }

  if (draft.expectedRaw) {
    const match = draft.expectedRaw.match(/^- \[[ xX]\]\s+(.*)$/)
    if (match?.[1]) {
      return match[1].trim()
    }
    return draft.expectedRaw
  }

  return 'Checklist item'
}

function findChecklistRawByIndex(task: MobileTaskDetail | null, index: number | null): string | null {
  if (!task || index === null) {
    return null
  }

  let checklistIndex = 0
  for (const line of task.tasks ?? []) {
    if (!/^- \[[ xX]\]\s+/.test(line)) {
      continue
    }

    if (checklistIndex === index) {
      return line
    }

    checklistIndex += 1
  }

  return null
}

function applyCommentMutationToTask(
  task: MobileTaskDetail,
  comment: MobileCommentReadModel,
  operation: 'create' | 'update',
): MobileTaskDetail {
  return {
    ...task,
    comments:
      operation === 'update'
        ? task.comments.map((item) => (item.id === comment.id ? comment : item))
        : [...task.comments, comment],
  }
}

function removeCommentFromTask(task: MobileTaskDetail, commentId: string): MobileTaskDetail {
  return {
    ...task,
    comments: task.comments.filter((comment) => comment.id !== commentId),
  }
}

function addAttachmentToTask(task: MobileTaskDetail, filename: string): MobileTaskDetail {
  if (task.attachments.includes(filename)) {
    return task
  }

  return {
    ...task,
    attachments: [...task.attachments, filename],
  }
}

function removeCommentAndLinkedVoiceAttachmentFromTask(task: MobileTaskDetail, commentId: string): MobileTaskDetail {
  const deletedComment = task.comments.find((comment) => comment.id === commentId) ?? null
  const voiceAttachment = deletedComment ? parseVoiceCommentContent(deletedComment.content).voiceAttachment : null

  if (!voiceAttachment) {
    return removeCommentFromTask(task, commentId)
  }

  const remainingComments = task.comments.filter((comment) => comment.id !== commentId)

  const linkedAttachmentStillReferenced = remainingComments.some((comment) => (
    parseVoiceCommentContent(comment.content).voiceAttachment?.filename === voiceAttachment.filename
  ))

  return {
    ...task,
    attachments: linkedAttachmentStillReferenced
      ? task.attachments
      : task.attachments.filter((attachment) => attachment !== voiceAttachment.filename),
    comments: remainingComments,
  }
}

interface FormSheetDefinition {
  canSubmit: boolean
  description?: string
  id: string
  initialData: JsonObject
  label: string
  schema: JsonObject
  ui?: JsonObject
}

interface FormFieldDescriptor {
  kind: 'boolean' | 'enum' | 'number' | 'text' | 'unsupported'
  key: string
  label: string
  multiline: boolean
  options: JsonValue[]
  required: boolean
}

interface FormValidationIssue {
  fieldKey: string
  message: string
}

function isJsonObjectValue(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cloneJsonObject(value: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject
}

function toFieldLabel(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/^./, (value) => value.toUpperCase())
}

function parsePropertyScope(scope: string): string | null {
  const match = scope.match(/^#\/properties\/([^/]+)$/)
  return match?.[1] ?? null
}

function collectFormUiHints(
  node: JsonObject | undefined,
  hints: Map<string, { multiline: boolean }>,
  order: string[],
): void {
  if (!node) {
    return
  }

  const scope = typeof node.scope === 'string' ? parsePropertyScope(node.scope) : null
  if (scope) {
    if (!order.includes(scope)) {
      order.push(scope)
    }

    const options = isJsonObjectValue(node.options) ? node.options : null
    hints.set(scope, {
      multiline: options?.multi === true,
    })
  }

  const elements = Array.isArray(node.elements) ? node.elements : []
  for (const element of elements) {
    if (isJsonObjectValue(element)) {
      collectFormUiHints(element, hints, order)
    }
  }
}

function buildFormFieldDescriptors(form: FormSheetDefinition): FormFieldDescriptor[] {
  const properties = isJsonObjectValue(form.schema.properties) ? form.schema.properties : null
  if (!properties) {
    return []
  }

  const requiredFields = Array.isArray(form.schema.required)
    ? form.schema.required.filter((value): value is string => typeof value === 'string')
    : []
  const hints = new Map<string, { multiline: boolean }>()
  const order: string[] = []

  collectFormUiHints(form.ui, hints, order)

  for (const key of Object.keys(properties)) {
    if (!order.includes(key)) {
      order.push(key)
    }
  }

  return order.flatMap((key) => {
    const property = properties[key]
    if (!isJsonObjectValue(property)) {
      return []
    }

    const type = typeof property.type === 'string' ? property.type : null
    const enumValues = Array.isArray(property.enum) ? property.enum : []
    const kind = enumValues.length > 0
      ? 'enum'
      : type === 'boolean'
        ? 'boolean'
        : type === 'integer' || type === 'number'
          ? 'number'
          : type === 'string' || type === null
            ? 'text'
            : 'unsupported'

    return [{
      kind,
      key,
      label: typeof property.title === 'string' && property.title.trim().length > 0
        ? property.title.trim()
        : toFieldLabel(key),
      multiline: hints.get(key)?.multiline === true,
      options: enumValues,
      required: requiredFields.includes(key),
    } satisfies FormFieldDescriptor]
  })
}

function validateFormData(fields: FormFieldDescriptor[], data: JsonObject): FormValidationIssue[] {
  const issues: FormValidationIssue[] = []

  for (const field of fields) {
    const value = data[field.key]
    const isEmpty = value === null
      || value === undefined
      || (typeof value === 'string' && value.trim().length === 0)

    if (field.required && isEmpty) {
      issues.push({
        fieldKey: field.key,
        message: `${field.label} is required.`,
      })
      continue
    }

    if (isEmpty) {
      continue
    }

    if (field.kind === 'boolean' && typeof value !== 'boolean') {
      issues.push({
        fieldKey: field.key,
        message: `Choose Yes or No for ${field.label}.`,
      })
      continue
    }

    if (field.kind === 'enum' && !field.options.some((option) => option === value)) {
      issues.push({
        fieldKey: field.key,
        message: `${field.label} must use one of the server-provided options.`,
      })
      continue
    }

    if (field.kind === 'number') {
      if (typeof value === 'number') {
        continue
      }

      if (typeof value === 'string' && value.trim().length > 0 && !Number.isNaN(Number(value))) {
        continue
      }

      issues.push({
        fieldKey: field.key,
        message: `${field.label} must be a number.`,
      })
      continue
    }

    if (field.kind === 'text' && typeof value !== 'string') {
      issues.push({
        fieldKey: field.key,
        message: `${field.label} must be text.`,
      })
    }
  }

  return issues
}

function coerceFormSubmitData(fields: FormFieldDescriptor[], data: JsonObject): JsonObject {
  const next = cloneJsonObject(data)

  for (const field of fields) {
    if (field.kind !== 'number') {
      continue
    }

    const value = next[field.key]
    if (typeof value !== 'string') {
      continue
    }

    const trimmed = value.trim()
    if (trimmed.length === 0) {
      continue
    }

    const parsed = Number(trimmed)
    if (!Number.isNaN(parsed)) {
      next[field.key] = parsed
    }
  }

  return next
}

function FormValidationCard({
  colors,
  issues,
}: {
  colors: ShellColors
  issues: FormValidationIssue[]
}) {
  if (issues.length === 0) {
    return null
  }

  return (
    <View style={[styles.rowCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
      <Text style={[styles.rowTitle, { color: colors.text }]}>Fix {issues.length} validation issue{issues.length === 1 ? '' : 's'} before submitting.</Text>
      {issues.map((issue) => (
        <Text key={issue.fieldKey} style={[styles.noteText, { color: colors.text }]}>• {issue.message}</Text>
      ))}
    </View>
  )
}

function FormSheet({
  colors,
  draftData,
  errorMessage,
  form,
  hasLiveConnection,
  onClose,
  onSubmit,
  submitting,
}: {
  colors: ShellColors
  draftData?: JsonObject | null
  errorMessage?: string | null
  form: FormSheetDefinition
  hasLiveConnection: boolean
  onClose: () => void
  onSubmit: (data: JsonObject) => void
  submitting: boolean
}) {
  const editorKey = useMemo(
    () => `${form.id}:${JSON.stringify(draftData ?? form.initialData)}`,
    [draftData, form.id, form.initialData],
  )

  return (
    <ResolvedFormSheetBody
      key={editorKey}
      colors={colors}
      draftData={draftData}
      errorMessage={errorMessage}
      form={form}
      hasLiveConnection={hasLiveConnection}
      onClose={onClose}
      onSubmit={onSubmit}
      submitting={submitting}
    />
  )
}

function ResolvedFormSheetBody({
  colors,
  draftData,
  errorMessage,
  form,
  hasLiveConnection,
  onClose,
  onSubmit,
  submitting,
}: {
  colors: ShellColors
  draftData?: JsonObject | null
  errorMessage?: string | null
  form: FormSheetDefinition
  hasLiveConnection: boolean
  onClose: () => void
  onSubmit: (data: JsonObject) => void
  submitting: boolean
}) {
  const [data, setData] = useState<JsonObject>(() => cloneJsonObject(draftData ?? form.initialData))
  const fields = useMemo(() => buildFormFieldDescriptors(form), [form])
  const issues = useMemo(() => validateFormData(fields, data), [data, fields])
  const submitDisabled = submitting || (hasLiveConnection && issues.length > 0)
  const primaryLabel = hasLiveConnection ? 'Submit form' : 'Save draft'

  return (
    <View style={styles.formSheetBackdrop}>
      <Pressable onPress={onClose} style={StyleSheet.absoluteFill} testID={`form-sheet-close:${form.id}`} />
      <View style={[styles.formSheet, { backgroundColor: colors.card, borderColor: colors.border }]} testID={`form-sheet:${form.id}`}>
        <ScrollView contentContainerStyle={styles.formSheetContent}>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>Resolved mobile form</Text>
          <Text style={[styles.title, { color: colors.text }]}>{form.label}</Text>
          {form.description ? (
            <Text style={[styles.bodyText, { color: colors.text }]}>{form.description}</Text>
          ) : null}
          {errorMessage ? (
            <View style={[styles.rowCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <Text style={[styles.rowTitle, { color: colors.text }]}>{errorMessage}</Text>
            </View>
          ) : null}
          {hasLiveConnection ? <FormValidationCard colors={colors} issues={issues} /> : null}
          {!hasLiveConnection ? (
            <Text style={[styles.noteText, { color: colors.text }]}>Saved on this device. Review before sending.</Text>
          ) : null}

          {fields.length === 0 ? (
            <View style={[styles.rowCard, { borderColor: colors.border }]}>
              <Text style={[styles.bodyText, { color: colors.text }]}>This form has no editable root-level fields in the current mobile slice.</Text>
            </View>
          ) : fields.map((field) => {
            const value = data[field.key]
            const issue = issues.find((candidate) => candidate.fieldKey === field.key)

            return (
              <View key={field.key} style={[styles.rowCard, { borderColor: colors.border }]}>
                <Text style={[styles.rowTitle, { color: colors.text }]}>
                  {field.label}
                  {field.required ? ' *' : ''}
                </Text>
                {field.kind === 'text' || field.kind === 'number' ? (
                  <TextInput
                    editable={form.canSubmit}
                    multiline={field.multiline}
                    onChangeText={(nextValue) => {
                      setData((current) => ({
                        ...current,
                        [field.key]: nextValue,
                      }))
                    }}
                    placeholder={field.label}
                    placeholderTextColor={`${colors.text}88`}
                    style={[
                      styles.textInput,
                      {
                        backgroundColor: colors.background,
                        borderColor: colors.border,
                        color: colors.text,
                        minHeight: field.multiline ? 120 : 56,
                      },
                    ]}
                    testID={`form-sheet-input:${form.id}:${field.key}`}
                    textAlignVertical={field.multiline ? 'top' : 'center'}
                    value={typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value)}
                  />
                ) : null}

                {field.kind === 'boolean' ? (
                  <View style={styles.inlineActions}>
                    {[true, false].map((option) => {
                      const selected = value === option
                      return (
                        <ActionButton
                          key={`${field.key}:${String(option)}`}
                          colors={colors}
                          disabled={!form.canSubmit}
                          label={option ? 'Yes' : 'No'}
                          onPress={() => {
                            setData((current) => ({
                              ...current,
                              [field.key]: option,
                            }))
                          }}
                          testID={`form-sheet-boolean:${form.id}:${field.key}:${String(option)}`}
                          tone={selected ? 'primary' : 'secondary'}
                        />
                      )
                    })}
                  </View>
                ) : null}

                {field.kind === 'enum' ? (
                  <View style={styles.inlineActions}>
                    {field.options.map((option) => {
                      const selected = value === option
                      return (
                        <ActionButton
                          key={`${field.key}:${String(option)}`}
                          colors={colors}
                          disabled={!form.canSubmit}
                          label={String(option)}
                          onPress={() => {
                            setData((current) => ({
                              ...current,
                              [field.key]: option,
                            }))
                          }}
                          testID={`form-sheet-enum:${form.id}:${field.key}:${String(option)}`}
                          tone={selected ? 'primary' : 'secondary'}
                        />
                      )
                    })}
                  </View>
                ) : null}

                {field.kind === 'unsupported' ? (
                  <Text style={[styles.noteText, { color: colors.text }]}>This field type stays read-only in the current mobile slice.</Text>
                ) : null}
                {issue ? (
                  <Text style={[styles.noteText, { color: colors.text }]}>{issue.message}</Text>
                ) : null}
              </View>
            )
          })}
        </ScrollView>

        <View style={[styles.formSheetFooter, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <ActionButton colors={colors} label="Close" onPress={onClose} />
          {form.canSubmit ? (
            <ActionButton
              colors={colors}
              disabled={submitDisabled}
              label={primaryLabel}
              onPress={() => {
                onSubmit(coerceFormSubmitData(fields, data))
              }}
              testID={`form-sheet-submit:${form.id}`}
              tone="primary"
            />
          ) : null}
        </View>
      </View>
    </View>
  )
}

function SurfaceSection({
  children,
  colors,
  title,
}: {
  children: ReactNode
  colors: ShellColors
  title: string
}) {
  return (
    <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>
      {children}
    </View>
  )
}

function MetadataChip({
  colors,
  label,
}: {
  colors: ShellColors
  label: string
}) {
  return (
    <View style={[styles.chip, { borderColor: colors.border }]}>
      <Text style={[styles.chipText, { color: colors.text }]}>{label}</Text>
    </View>
  )
}

function ActionButton({
  colors,
  disabled = false,
  label,
  onPress,
  testID,
  tone = 'secondary',
}: {
  colors: ShellColors
  disabled?: boolean
  label: string
  onPress: () => void
  testID?: string
  tone?: 'primary' | 'secondary'
}) {
  const isPrimary = tone === 'primary'

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={[
        styles.actionButton,
        {
          backgroundColor: isPrimary ? `${colors.primary}18` : colors.card,
          borderColor: isPrimary ? colors.primary : colors.border,
          opacity: disabled ? 0.55 : 1,
        },
      ]}
    >
      <Text style={[styles.actionButtonText, { color: colors.text }]}>{label}</Text>
    </Pressable>
  )
}

function CommentRow({
  colors,
  deleteDisabled,
  item,
  onDelete,
  onEdit,
  playbackAuth,
  pendingUpdate,
  taskId,
}: {
  colors: ShellColors
  deleteDisabled: boolean
  item: TaskDetailCommentShellItem
  onDelete: (item: TaskDetailCommentShellItem) => void
  onEdit: (item: TaskDetailCommentShellItem) => void
  playbackAuth: VoiceCommentPlaybackAuth | null
  pendingUpdate: boolean
  taskId: string | null
}) {
  const parsedContent = parseVoiceCommentContent(item.content)
  const note = parsedContent.note.trim()

  return (
    <View style={[styles.rowCard, { borderColor: colors.border }]}>
      <Text style={[styles.rowTitle, { color: colors.text }]}>{item.author}</Text>
      <Text style={[styles.rowMeta, { color: colors.text }]}>{item.created}</Text>
      {parsedContent.voiceAttachment && taskId && playbackAuth ? (
        <VoiceCommentPlayer
          colors={colors}
          durationMs={parsedContent.voiceAttachment.durationMs}
          fileName={parsedContent.voiceAttachment.filename}
          playbackAuth={playbackAuth}
          taskId={taskId}
        />
      ) : parsedContent.voiceAttachment ? (
        <Text style={[styles.noteText, { color: colors.text }]}>Voice comment attached.</Text>
      ) : null}
      {note.length > 0 ? (
        <Text style={[styles.bodyText, { color: colors.text }]}>{note}</Text>
      ) : parsedContent.voiceAttachment ? (
        <Text style={[styles.noteText, { color: colors.text }]}>Voice comment only.</Text>
      ) : (
        <Text style={[styles.bodyText, { color: colors.text }]}>{item.content}</Text>
      )}
      {pendingUpdate ? (
        <Text style={[styles.noteText, { color: colors.text }]}>Local edit pending below.</Text>
      ) : null}
      <View style={styles.inlineActions}>
        {item.canUpdate ? (
          <ActionButton colors={colors} label="Edit comment" onPress={() => onEdit(item)} />
        ) : null}
        {item.canDelete ? (
          <ActionButton
            colors={colors}
            disabled={deleteDisabled}
            label="Delete comment"
            onPress={() => onDelete(item)}
          />
        ) : null}
      </View>
      {item.canDelete && deleteDisabled ? (
        <Text style={[styles.noteText, { color: colors.text }]}>Needs a live connection.</Text>
      ) : null}
    </View>
  )
}

function CommentDraftRow({
  colors,
  discardDisabled,
  draft,
  onDiscard,
  onSend,
  playbackAuth,
  sendDisabled,
  taskId,
}: {
  colors: ShellColors
  discardDisabled: boolean
  draft: CommentDraftRecord
  onDiscard: (draftId: string) => void
  onSend: (draft: CommentDraftRecord) => void
  playbackAuth: VoiceCommentPlaybackAuth | null
  sendDisabled: boolean
  taskId: string | null
}) {
  const parsedContent = parseVoiceCommentContent(draft.content)
  const note = parsedContent.note.trim()

  return (
    <View style={[styles.rowCard, { borderColor: colors.border }]}>
      <Text style={[styles.rowTitle, { color: colors.text }]}>
        {draft.operation === 'update' ? 'Edit pending' : 'Pending comment'}
      </Text>
      <Text style={[styles.rowMeta, { color: colors.text }]}>{draft.author}</Text>
      {parsedContent.voiceAttachment && taskId && playbackAuth ? (
        <VoiceCommentPlayer
          colors={colors}
          durationMs={parsedContent.voiceAttachment.durationMs}
          fileName={parsedContent.voiceAttachment.filename}
          playbackAuth={playbackAuth}
          taskId={taskId}
        />
      ) : parsedContent.voiceAttachment ? (
        <Text style={[styles.noteText, { color: colors.text }]}>Voice comment attached.</Text>
      ) : null}
      {note.length > 0 ? (
        <Text style={[styles.bodyText, { color: colors.text }]}>{note}</Text>
      ) : parsedContent.voiceAttachment ? (
        <Text style={[styles.noteText, { color: colors.text }]}>Voice comment only.</Text>
      ) : (
        <Text style={[styles.bodyText, { color: colors.text }]}>{draft.content}</Text>
      )}
      <Text style={[styles.noteText, { color: colors.text }]}>{describeCommentDraftNote(draft)}</Text>
      <View style={styles.inlineActions}>
        <ActionButton
          colors={colors}
          disabled={sendDisabled || draft.status === 'sending'}
          label={describeCommentDraftActionLabel(draft)}
          onPress={() => onSend(draft)}
          tone="primary"
        />
        <ActionButton
          colors={colors}
          disabled={discardDisabled}
          label="Discard draft"
          onPress={() => onDiscard(draft.draftId)}
        />
      </View>
    </View>
  )
}

function AttachmentRow({
  colors,
  removeDisabled,
  item,
  onRemove,
  playbackAuth,
  taskId,
  voiceAttachment,
}: {
  colors: ShellColors
  removeDisabled: boolean
  item: TaskDetailAttachmentShellItem
  onRemove: (item: TaskDetailAttachmentShellItem) => void
  playbackAuth: VoiceCommentPlaybackAuth | null
  taskId: string | null
  voiceAttachment: VoiceCommentAttachmentRef | null
}) {
  return (
    <View style={[styles.rowCard, { borderColor: colors.border }]}>
      <Text style={[styles.rowTitle, { color: colors.text }]}>{item.name}</Text>
      {voiceAttachment && taskId && playbackAuth ? (
        <VoiceCommentPlayer
          colors={colors}
          durationMs={voiceAttachment.durationMs}
          fileName={voiceAttachment.filename}
          playbackAuth={playbackAuth}
          taskId={taskId}
        />
      ) : null}
      {voiceAttachment ? (
        <Text style={[styles.noteText, { color: colors.text }]}>Linked voice comment attachment.</Text>
      ) : null}
      {item.canRemove ? (
        <View style={styles.inlineActions}>
          <ActionButton
            colors={colors}
            disabled={removeDisabled}
            label="Remove attachment"
            onPress={() => onRemove(item)}
          />
        </View>
      ) : null}
      {item.canRemove && removeDisabled ? (
        <Text style={[styles.noteText, { color: colors.text }]}>Needs a live connection.</Text>
      ) : null}
    </View>
  )
}

function AttachmentDraftRow({
  colors,
  discardDisabled,
  draft,
  onDiscard,
  onSend,
  sendDisabled,
}: {
  colors: ShellColors
  discardDisabled: boolean
  draft: AttachmentDraftRecord
  onDiscard: (draftId: string) => void
  onSend: (draft: AttachmentDraftRecord) => void
  sendDisabled: boolean
}) {
  const canSend = draft.lastError?.code !== 'missing_local_file'

  return (
    <View style={[styles.rowCard, { borderColor: colors.border }]}>
      <Text style={[styles.rowTitle, { color: colors.text }]}>{draft.fileName}</Text>
      <Text style={[styles.rowMeta, { color: colors.text }]}>Pending attachment</Text>
      <Text style={[styles.noteText, { color: colors.text }]}>{describeAttachmentDraftNote(draft)}</Text>
      <View style={styles.inlineActions}>
        {canSend ? (
          <ActionButton
            colors={colors}
            disabled={sendDisabled || draft.status === 'sending'}
            label={describeAttachmentDraftActionLabel(draft)}
            onPress={() => onSend(draft)}
            tone="primary"
          />
        ) : null}
        <ActionButton
          colors={colors}
          disabled={discardDisabled}
          label="Discard draft"
          onPress={() => onDiscard(draft.draftId)}
        />
      </View>
    </View>
  )
}

function FormRow({
  colors,
  item,
  onOpen,
  pendingDraft,
}: {
  colors: ShellColors
  item: TaskDetailFormShellItem
  onOpen?: (() => void) | undefined
  pendingDraft: boolean
}) {
  return (
    <View style={[styles.rowCard, { borderColor: colors.border }]}>
      <Text style={[styles.rowTitle, { color: colors.text }]}>{item.label}</Text>
      {item.description ? (
        <Text style={[styles.bodyText, { color: colors.text }]}>{item.description}</Text>
      ) : null}
      <View style={styles.chipRow}>
        <MetadataChip colors={colors} label={`${item.fieldCount} field${item.fieldCount === 1 ? '' : 's'}`} />
        <MetadataChip colors={colors} label={item.fromConfig ? 'Server resolved' : 'Inline form'} />
      </View>
      {summaryEntries(item.initialData).length > 0 ? (
        <View style={styles.formSummaryList}>
          {summaryEntries(item.initialData).map(([key, value]) => (
            <Text
              key={`${item.id}:${key}`}
              style={[styles.rowMeta, { color: colors.text }]}
              testID={`task-form-summary:${item.id}:${key}`}
            >
              {key}: {value}
            </Text>
          ))}
        </View>
      ) : null}
      {item.canSubmit && onOpen ? (
        <View style={styles.inlineActions}>
          <ActionButton
            colors={colors}
            label={pendingDraft ? 'Review draft' : 'Open form'}
            onPress={onOpen}
          />
        </View>
      ) : null}
      <Text style={[styles.noteText, { color: colors.text }]}>
        {item.canSubmit
          ? pendingDraft
            ? 'A local draft exists for this form. Review it before sending.'
            : 'Submission moves to the sticky bottom action dock so the shell keeps one obvious next step.'
          : 'Read-only summary for this caller.'}
      </Text>
    </View>
  )
}

function FormDraftRow({
  colors,
  draft,
  onDiscard,
  onReview,
  onSend,
  sendDisabled,
  sendVisible,
}: {
  colors: ShellColors
  draft: FormDraftRecord
  onDiscard: (draftId: string) => void
  onReview: (draft: FormDraftRecord) => void
  onSend: (draft: FormDraftRecord) => void
  sendDisabled: boolean
  sendVisible: boolean
}) {
  return (
    <View style={[styles.rowCard, { borderColor: colors.border }]} testID={`task-form-draft:${draft.formId}`}>
      <Text style={[styles.rowTitle, { color: colors.text }]}>Pending form draft</Text>
      <Text style={[styles.rowMeta, { color: colors.text }]}>{draft.formId}</Text>
      {summaryEntries(draft.data).length > 0 ? (
        <View style={styles.formSummaryList}>
          {summaryEntries(draft.data).map(([key, value]) => (
            <Text key={`${draft.draftId}:${key}`} style={[styles.rowMeta, { color: colors.text }]}>
              {key}: {value}
            </Text>
          ))}
        </View>
      ) : null}
      <Text style={[styles.noteText, { color: colors.text }]}>{describeFormDraftNote(draft)}</Text>
      <View style={styles.inlineActions}>
        <ActionButton
          colors={colors}
          label="Review draft"
          onPress={() => onReview(draft)}
        />
        {sendVisible ? (
          <ActionButton
            colors={colors}
            disabled={sendDisabled || draft.status === 'sending'}
            label={describeFormDraftActionLabel(draft)}
            onPress={() => onSend(draft)}
            tone="primary"
          />
        ) : null}
        <ActionButton
          colors={colors}
          disabled={draft.status === 'sending'}
          label="Discard draft"
          onPress={() => onDiscard(draft.draftId)}
        />
      </View>
    </View>
  )
}

function ChecklistDraftRow({
  colors,
  draft,
  onDiscard,
  onReviewLatest,
  onSend,
  sendDisabled,
}: {
  colors: ShellColors
  draft: ChecklistDraftRecord
  onDiscard: (draftId: string) => void
  onReviewLatest: () => void
  onSend: (draft: ChecklistDraftRecord) => void
  sendDisabled: boolean
}) {
  return (
    <View style={[styles.rowCard, { borderColor: colors.border }]} testID={`task-checklist-draft:${draft.draftId}`}>
      <Text style={[styles.rowTitle, { color: colors.text }]}>{describeChecklistDraftTitle(draft)}</Text>
      <Text style={[styles.bodyText, { color: colors.text }]}>{describeChecklistDraftValue(draft)}</Text>
      <Text style={[styles.noteText, { color: colors.text }]}>{describeChecklistDraftNote(draft)}</Text>
      <View style={styles.inlineActions}>
        <ActionButton
          colors={colors}
          disabled={sendDisabled || draft.status === 'sending'}
          label={describeChecklistDraftActionLabel(draft)}
          onPress={() => onSend(draft)}
          testID={`task-checklist-draft-send:${draft.draftId}`}
          tone="primary"
        />
        {draft.status === 'conflict' ? (
          <ActionButton
            colors={colors}
            label="Review latest"
            onPress={onReviewLatest}
            testID={`task-checklist-draft-review:${draft.draftId}`}
          />
        ) : null}
        <ActionButton
          colors={colors}
          disabled={draft.status === 'sending'}
          label="Discard draft"
          onPress={() => onDiscard(draft.draftId)}
          testID={`task-checklist-draft-discard:${draft.draftId}`}
        />
      </View>
    </View>
  )
}

function ChecklistRow({
  colors,
  item,
  onDelete,
  onEdit,
  onToggle,
  pendingDraft,
  toggleBusy,
}: {
  colors: ShellColors
  item: TaskDetailChecklistShellItem
  onDelete: (item: TaskDetailChecklistShellItem) => void
  onEdit: (item: TaskDetailChecklistShellItem) => void
  onToggle: (item: TaskDetailChecklistShellItem) => void
  pendingDraft: ChecklistDraftRecord | null
  toggleBusy: boolean
}) {
  const disableMutations = pendingDraft !== null || toggleBusy

  return (
    <View style={[styles.rowCard, { borderColor: colors.border }]}>
      <Text style={[styles.rowTitle, { color: colors.text }]}>
        {item.checked ? '☑' : '☐'} {item.text}
      </Text>
      <View style={styles.inlineActions}>
        {item.canToggle ? (
          <ActionButton
            colors={colors}
            disabled={disableMutations}
            label={item.toggleAction === 'check' ? 'Check item' : 'Uncheck item'}
            onPress={() => onToggle(item)}
            testID={`task-checklist-toggle:${item.index}`}
          />
        ) : null}
        {item.canEdit ? (
          <ActionButton
            colors={colors}
            disabled={disableMutations}
            label="Edit item"
            onPress={() => onEdit(item)}
            testID={`task-checklist-edit:${item.index}`}
          />
        ) : null}
        {item.canDelete ? (
          <ActionButton
            colors={colors}
            disabled={disableMutations}
            label="Delete item"
            onPress={() => onDelete(item)}
            testID={`task-checklist-delete:${item.index}`}
          />
        ) : null}
      </View>
      {pendingDraft ? (
        <Text style={[styles.noteText, { color: colors.text }]}>{describeChecklistPendingNote(pendingDraft)}</Text>
      ) : null}
    </View>
  )
}

function ActionRow({
  colors,
  disabled,
  item,
  onPress,
}: {
  colors: ShellColors
  disabled: boolean
  item: TaskDetailActionShellItem
  onPress: (item: TaskDetailActionShellItem) => void
}) {
  return (
    <View style={[styles.rowCard, { borderColor: colors.border }]}>
      <Text style={[styles.rowTitle, { color: colors.text }]}>{item.label}</Text>
      <View style={styles.inlineActions}>
        <ActionButton
          colors={colors}
          disabled={disabled}
          label={item.label}
          onPress={() => onPress(item)}
          testID={`task-card-action:${item.key}`}
        />
      </View>
      {disabled ? (
        <Text style={[styles.noteText, { color: colors.text }]}>Needs a live connection.</Text>
      ) : null}
    </View>
  )
}

function StickyActionDock({
  colors,
  onPrimaryActionPress,
  primaryActionDisabled = false,
  primaryActionNote,
  primaryAction,
  secondaryActions,
}: {
  colors: ShellColors
  onPrimaryActionPress?: ((action: TaskDetailDockAction) => void) | undefined
  primaryActionDisabled?: boolean
  primaryActionNote?: string | null
  primaryAction: TaskDetailDockAction | null
  secondaryActions: TaskDetailDockAction[]
}) {
  if (!primaryAction && secondaryActions.length === 0) {
    return null
  }

  return (
    <View style={[styles.actionDock, { backgroundColor: colors.background, borderColor: colors.border }]}>
      {primaryAction ? (
        <Pressable
          disabled={!onPrimaryActionPress || primaryActionDisabled}
          onPress={() => {
            if (onPrimaryActionPress) {
              onPrimaryActionPress(primaryAction)
            }
          }}
          style={[
            styles.actionDockPrimary,
            { backgroundColor: `${colors.primary}18`, borderColor: colors.primary },
          ]}
          testID="task-detail-dock-primary"
        >
          <Text style={[styles.actionDockPrimaryText, { color: colors.text }]}>{primaryAction.label}</Text>
        </Pressable>
      ) : null}
      {primaryActionNote ? (
        <Text style={[styles.noteText, { color: colors.text }]}>{primaryActionNote}</Text>
      ) : null}
      {secondaryActions.length > 0 ? (
        <View style={styles.actionDockSecondaryBlock}>
          <Text style={[styles.actionDockSecondaryTitle, { color: colors.text }]}>Other available actions</Text>
          <Text style={[styles.actionDockSecondaryText, { color: colors.text }]}>
            {secondaryActions.map((action) => action.label).join(' • ')}
          </Text>
        </View>
      ) : null}
    </View>
  )
}

function NeutralShell({
  colors,
  body,
  title,
}: {
  body: string
  colors: ShellColors
  title: string
}) {
  return (
    <SafeAreaView
      edges={['top', 'left', 'right', 'bottom']}
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      <View style={[styles.neutralShell, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={[styles.neutralTitle, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.neutralBody, { color: colors.text }]}>{body}</Text>
      </View>
    </SafeAreaView>
  )
}

export default function TaskDetailScreen() {
  const { colors } = useTheme()
  const router = useRouter()
  const params = useLocalSearchParams<{ id?: string | string[] }>()
  const taskId = useMemo(() => normalizeTaskId(params.id), [params.id])
  const { controller, state } = useSessionController()
  const cacheStore = useMemo(
    () => createCacheStore({ storage: createExpoCacheStorage() }),
    [],
  )
  const sessionStorage = useMemo(() => createExpoSessionStorage(), [])
  const [loadState, setLoadState] = useState<DetailLoadState>({
    errorMessage: null,
    phase: 'blocked',
    source: 'none',
    task: null,
  })
  const [attachmentDrafts, setAttachmentDrafts] = useState<AttachmentDraftRecord[]>([])
  const [checklistComposerValue, setChecklistComposerValue] = useState('')
  const [checklistDrafts, setChecklistDrafts] = useState<ChecklistDraftRecord[]>([])
  const [commentComposerValue, setCommentComposerValue] = useState('')
  const [commentVoiceDraft, setCommentVoiceDraft] = useState<PendingVoiceCommentDraft | null>(null)
  const [commentDrafts, setCommentDrafts] = useState<CommentDraftRecord[]>([])
  const [editingChecklistIndex, setEditingChecklistIndex] = useState<number | null>(null)
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editingCommentValue, setEditingCommentValue] = useState('')
  const [editingCommentVoiceAttachment, setEditingCommentVoiceAttachment] = useState<VoiceCommentAttachmentRef | null>(null)
  const [formDrafts, setFormDrafts] = useState<FormDraftRecord[]>([])
  const [activeFormId, setActiveFormId] = useState<string | null>(null)
  const [formSheetErrorMessage, setFormSheetErrorMessage] = useState<string | null>(null)
  const [inlineBanner, setInlineBanner] = useState<InlineBannerState | null>(null)
  const [busyActionKey, setBusyActionKey] = useState<string | null>(null)
  const [playbackAuth, setPlaybackAuth] = useState<VoiceCommentPlaybackAuth | null>(null)
  const [voiceRecorderVisible, setVoiceRecorderVisible] = useState(false)
  const commentVoiceDraftRef = useRef<PendingVoiceCommentDraft | null>(null)
  const loadIdRef = useRef(0)

  const applyDraftEnvelope = useCallback((envelope: PersistedEnvelopeV1 | null) => {
    const next = selectTaskDrafts(envelope, taskId)
    setAttachmentDrafts(next.attachmentDrafts)
    setChecklistDrafts(next.checklistDrafts)
    setCommentDrafts(next.commentDrafts)
    setFormDrafts(next.formDrafts)
  }, [taskId])

  const clearChecklistEditor = useCallback(() => {
    setChecklistComposerValue('')
    setEditingChecklistIndex(null)
  }, [])

  const discardPendingVoiceDraft = useCallback(async () => {
    const activeDraft = commentVoiceDraftRef.current
    commentVoiceDraftRef.current = null
    setCommentVoiceDraft(null)
    if (!activeDraft) {
      return
    }

    try {
      await deleteDurableAttachmentDraft(activeDraft.uri)
    } catch {
      // Best-effort cleanup for local voice clips.
    }
  }, [])

  const clearCommentEditor = useCallback(() => {
    setCommentComposerValue('')
    setEditingCommentId(null)
    setEditingCommentValue('')
    setEditingCommentVoiceAttachment(null)
    setVoiceRecorderVisible(false)
    void discardPendingVoiceDraft()
  }, [discardPendingVoiceDraft])

  useEffect(() => {
    commentVoiceDraftRef.current = commentVoiceDraft
  }, [commentVoiceDraft])

  useEffect(() => {
    return () => {
      const activeDraft = commentVoiceDraftRef.current
      commentVoiceDraftRef.current = null
      if (activeDraft) {
        void deleteDurableAttachmentDraft(activeDraft.uri)
      }
    }
  }, [])

  const hydrateCache = useCallback(
    async (namespace: CacheNamespace) => hydrateWithPurgeCleanup(
      cacheStore,
      {
        namespace,
        sessionValidated: true,
      },
      {
        deleteDurableAttachment: deleteDurableAttachmentDraft,
      },
    ),
    [cacheStore],
  )

  const readTaskContext = useCallback(async () => {
    if (!taskId || !state.sessionStatus) {
      throw new Error('ERR_MOBILE_SESSION_REQUIRED')
    }

    const storedSession = await readStoredSession(sessionStorage)
    if (
      !storedSession
      || storedSession.workspaceOrigin !== state.sessionStatus.workspaceOrigin
      || storedSession.workspaceId !== state.sessionStatus.workspaceId
      || storedSession.subject !== state.sessionStatus.subject
    ) {
      throw new Error('ERR_MOBILE_SESSION_REQUIRED')
    }

    return {
      client: createMobileApiClient({
        token: storedSession.session.token,
        workspaceOrigin: storedSession.workspaceOrigin,
      }),
      namespace: buildCacheNamespace(storedSession),
      storedSession,
    }
  }, [sessionStorage, state.sessionStatus, taskId])

  useEffect(() => {
    let cancelled = false

    if (!state.sessionStatus) {
      setPlaybackAuth(null)
      return () => {
        cancelled = true
      }
    }

    void (async () => {
      try {
        const storedSession = await readStoredSession(sessionStorage)
        if (cancelled) {
          return
        }

        if (
          !storedSession
          || storedSession.workspaceOrigin !== state.sessionStatus.workspaceOrigin
          || storedSession.workspaceId !== state.sessionStatus.workspaceId
          || storedSession.subject !== state.sessionStatus.subject
        ) {
          setPlaybackAuth(null)
          return
        }

        setPlaybackAuth({
          token: storedSession.session.token,
          workspaceOrigin: storedSession.workspaceOrigin,
        })
      } catch {
        if (!cancelled) {
          setPlaybackAuth(null)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [sessionStorage, state.sessionStatus])

  const syncTaskDrafts = useCallback(async (namespace: CacheNamespace) => {
    const hydrated = await hydrateCache(namespace)

    if (hydrated.kind === 'hydrated') {
      applyDraftEnvelope(hydrated.envelope)
      return hydrated.envelope
    }

    applyDraftEnvelope(null)
    return null
  }, [applyDraftEnvelope, hydrateCache])

  const persistTaskSnapshot = useCallback(async (
    namespace: CacheNamespace,
    task: MobileTaskDetail,
    source: DetailSource = 'live',
  ) => {
    const hydrated = await hydrateCache(namespace)
    const existingTaskDetails = hydrated.kind === 'hydrated'
      ? hydrated.envelope.snapshots.taskDetails ?? {}
      : {}

    try {
      await cacheStore.replaceSnapshots(namespace, {
        taskDetails: {
          ...existingTaskDetails,
          [task.id]: {
            task,
            workspaceId: namespace.workspaceId,
          },
        },
      })
    } catch {
      // Live task state should remain usable even if local snapshot persistence fails.
    }

    setLoadState({
      errorMessage: null,
      phase: 'ready',
      source,
      task,
    })
  }, [cacheStore, hydrateCache])

  const refreshTaskFromServer = useCallback(async (input: {
    client: MobileApiClient
    namespace: CacheNamespace
  }) => {
    if (!taskId) {
      return null
    }

    const liveTask = await input.client.getTask(taskId)
    await persistTaskSnapshot(input.namespace, liveTask, 'live')
    await syncTaskDrafts(input.namespace)
    return liveTask
  }, [persistTaskSnapshot, syncTaskDrafts, taskId])

  const loadTask = useCallback(async () => {
    if (!taskId || !state.isProtectedReady || !state.sessionStatus) {
      applyDraftEnvelope(null)
      clearChecklistEditor()
      clearCommentEditor()
      setActiveFormId(null)
      setFormSheetErrorMessage(null)
      setInlineBanner(null)
      setLoadState({
        errorMessage: null,
        phase: 'blocked',
        source: 'none',
        task: null,
      })
      return
    }

    const currentLoadId = loadIdRef.current + 1
    loadIdRef.current = currentLoadId
    const isCurrent = () => loadIdRef.current === currentLoadId

    const storedSession = await readStoredSession(sessionStorage)
    if (!isCurrent()) {
      return
    }

    if (
      !storedSession
      || storedSession.workspaceOrigin !== state.sessionStatus.workspaceOrigin
      || storedSession.workspaceId !== state.sessionStatus.workspaceId
      || storedSession.subject !== state.sessionStatus.subject
    ) {
      applyDraftEnvelope(null)
      setLoadState({
        errorMessage: 'ERR_MOBILE_SESSION_REQUIRED',
        phase: 'error',
        source: 'none',
        task: null,
      })
      return
    }

    const namespace = buildCacheNamespace(storedSession)

    const hydrated = await hydrateCache(namespace)
    applyDraftEnvelope(hydrated.kind === 'hydrated' ? hydrated.envelope : null)

    const cachedTask =
      hydrated.kind === 'hydrated'
        ? readCachedTaskDetailSnapshot(hydrated.envelope.snapshots, {
            taskId,
            workspaceId: namespace.workspaceId,
          })
        : null

    setLoadState({
      errorMessage: null,
      phase: 'loading',
      source: cachedTask ? 'cache' : 'none',
      task: null,
    })

    try {
      const client: MobileApiClient = createMobileApiClient({
        token: storedSession.session.token,
        workspaceOrigin: storedSession.workspaceOrigin,
      })
      const liveTask = await client.getTask(taskId)
      if (!isCurrent()) {
        return
      }

      const existingTaskDetails = hydrated.kind === 'hydrated'
        ? hydrated.envelope.snapshots.taskDetails ?? {}
        : {}

      try {
        await cacheStore.replaceSnapshots(namespace, {
          taskDetails: {
            ...existingTaskDetails,
            [taskId]: {
              task: liveTask,
              workspaceId: namespace.workspaceId,
            },
          },
        })
      } catch {
        // Keep rendering the live task even when cache snapshot persistence fails.
      }

      if (!isCurrent()) {
        return
      }

      setLoadState({
        errorMessage: null,
        phase: 'ready',
        source: 'live',
        task: liveTask,
      })
    } catch (error) {
      if (!isCurrent()) {
        return
      }

      if (isTaskUnavailableError(error)) {
        applyDraftEnvelope(null)
        setLoadState({
          errorMessage: null,
          phase: 'unavailable',
          source: 'none',
          task: null,
        })
        return
      }

      if (isProtectedTaskAccessError(error)) {
        await controller.logout({ reason: 'session-revoked', status: error.status })

        if (!isCurrent()) {
          return
        }

        applyDraftEnvelope(null)
        setLoadState({
          errorMessage: error.message,
          phase: 'blocked',
          source: 'none',
          task: null,
        })
        return
      }

      if (cachedTask && canUseTaskDetailCacheFallback(error)) {
        setLoadState({
          errorMessage: error instanceof Error ? error.message : 'Unable to refresh task detail.',
          phase: 'ready',
          source: 'cache',
          task: cachedTask,
        })
        return
      }

      setLoadState({
        errorMessage: error instanceof Error ? error.message : 'Unable to load task detail.',
        phase: 'error',
        source: 'none',
        task: null,
      })
    }
  }, [
    applyDraftEnvelope,
    cacheStore,
    clearChecklistEditor,
    clearCommentEditor,
    controller,
    hydrateCache,
    sessionStorage,
    state.isProtectedReady,
    state.sessionStatus,
    taskId,
  ])

  useEffect(() => {
    if (!taskId) {
      loadIdRef.current += 1
      return
    }

    if (!state.isProtectedReady || !state.sessionStatus) {
      loadIdRef.current += 1
      return
    }

    const timeoutId = setTimeout(() => {
      void loadTask()
    }, 0)

    return () => {
      clearTimeout(timeoutId)
      loadIdRef.current += 1
    }
  }, [loadTask, state.isProtectedReady, state.sessionStatus, taskId])

  const shell = useMemo(
    () => (loadState.task ? buildTaskDetailShellModel(loadState.task) : null),
    [loadState.task],
  )

  const pendingDraftBanner = useMemo(
    () => createPendingDraftBanner(commentDrafts, attachmentDrafts, checklistDrafts, formDrafts),
    [attachmentDrafts, checklistDrafts, commentDrafts, formDrafts],
  )

  const hasLiveConnection = loadState.source === 'live'
  const commentDraftsByCommentId = useMemo(() => {
    return new Map(
      commentDrafts
        .filter((draft) => draft.operation === 'update' && draft.commentId)
        .map((draft) => [draft.commentId as string, draft]),
    )
  }, [commentDrafts])
  const checklistDraftsByItemIndex = useMemo(() => {
    const next = new Map<number, ChecklistDraftRecord>()
    for (const draft of checklistDrafts) {
      if (draft.itemIndex === null || next.has(draft.itemIndex)) {
        continue
      }

      next.set(draft.itemIndex, draft)
    }

    return next
  }, [checklistDrafts])
  const formDraftsByFormId = useMemo(() => {
    return new Map(formDrafts.map((draft) => [draft.formId, draft]))
  }, [formDrafts])
  const activeForm = useMemo(() => {
    if (!activeFormId || !shell) {
      return null
    }

    const shellForm = shell.forms.items.find((item) => item.id === activeFormId)
    if (!shellForm) {
      return null
    }

    const descriptor = loadState.task?.resolvedForms.find((item) => item.id === activeFormId)
    return {
      canSubmit: shellForm.canSubmit,
      description: shellForm.description,
      id: shellForm.id,
      initialData: shellForm.initialData,
      label: shellForm.label,
      schema: shellForm.schema,
      ui: descriptor?.ui,
    }
  }, [activeFormId, loadState.task?.resolvedForms, shell])

  const shellColors: ShellColors = {
    background: colors.background,
    border: colors.border,
    card: colors.card,
    primary: colors.primary,
    text: colors.text,
  }

  const handleProtectedMutationFailure = useCallback(async (error: unknown) => {
    if (!isProtectedTaskAccessError(error)) {
      return false
    }

    await controller.logout({ reason: 'session-revoked', status: error.status })
    return true
  }, [controller])

  const openFormSheet = useCallback((formId: string) => {
    setActiveFormId(formId)
    setFormSheetErrorMessage(null)
    setInlineBanner(null)
  }, [])

  const closeFormSheet = useCallback(() => {
    setActiveFormId(null)
    setFormSheetErrorMessage(null)
  }, [])

  const saveFormDraft = useCallback(async (input: {
    data: JsonObject
    formId: string
    namespace: CacheNamespace
  }) => {
    if (!taskId) {
      return
    }

    const existingDraftId = formDraftsByFormId.get(input.formId)?.draftId
    const envelope = await cacheStore.queueDraft(input.namespace, {
      kind: 'form',
      draftId: existingDraftId ?? buildDraftId('form'),
      taskId,
      formId: input.formId,
      data: input.data,
    })

    applyDraftEnvelope(envelope)
    closeFormSheet()
    setInlineBanner({
      title: 'Saved on this device',
      message: 'Saved on this device. Review before sending.',
      tone: 'notice',
    })
  }, [
    applyDraftEnvelope,
    cacheStore,
    closeFormSheet,
    formDraftsByFormId,
    taskId,
  ])

  const saveChecklistDraft = useCallback(async (input: {
    action: ChecklistDraftRecord['action']
    expectedRaw?: string | null
    expectedToken?: string | null
    itemIndex?: number | null
    namespace: CacheNamespace
    text?: string | null
  }) => {
    if (!taskId) {
      return
    }

    const envelope = await cacheStore.queueDraft(input.namespace, {
      kind: 'checklist',
      draftId: buildDraftId('checklist'),
      taskId,
      action: input.action,
      itemIndex: input.itemIndex ?? null,
      text: input.text?.trim().length ? input.text.trim() : null,
      expectedRaw: input.expectedRaw ?? null,
      expectedToken: input.expectedToken ?? null,
    })

    applyDraftEnvelope(envelope)
    clearChecklistEditor()
    setInlineBanner({
      title: 'Saved on this device',
      message: 'Checklist change saved on this device. Review before sending.',
      tone: 'notice',
    })
  }, [
    applyDraftEnvelope,
    cacheStore,
    clearChecklistEditor,
    taskId,
  ])

  const handleSubmitForm = useCallback(async (input: {
    data: JsonObject
    formId: string
  }) => {
    if (!taskId) {
      return
    }

    setBusyActionKey(`form:submit:${input.formId}`)
    setFormSheetErrorMessage(null)
    setInlineBanner(null)

    try {
      const context = await readTaskContext()

      if (!hasLiveConnection) {
        await saveFormDraft({
          data: input.data,
          formId: input.formId,
          namespace: context.namespace,
        })
        return
      }

      try {
        await context.client.submitForm(taskId, input.formId, {
          data: input.data,
        })

        const existingDraft = formDraftsByFormId.get(input.formId)
        if (existingDraft) {
          await cacheStore.discardDraft(context.namespace, existingDraft.draftId)
          await syncTaskDrafts(context.namespace)
        }

        closeFormSheet()
        await refreshTaskFromServer(context)
      } catch (error) {
        if (await handleProtectedMutationFailure(error)) {
          return
        }

        if (shouldStoreAsLocalDraft(error)) {
          await saveFormDraft({
            data: input.data,
            formId: input.formId,
            namespace: context.namespace,
          })
          return
        }

        setFormSheetErrorMessage(resolveMutationErrorMessage(error, 'Unable to submit this form.'))
      }
    } catch (error) {
      setFormSheetErrorMessage(resolveMutationErrorMessage(error, 'Unable to submit this form.'))
    } finally {
      setBusyActionKey(null)
    }
  }, [
    cacheStore,
    closeFormSheet,
    formDraftsByFormId,
    handleProtectedMutationFailure,
    hasLiveConnection,
    readTaskContext,
    refreshTaskFromServer,
    saveFormDraft,
    syncTaskDrafts,
    taskId,
  ])

  const handleOpenChecklistAdd = useCallback(() => {
    clearChecklistEditor()
    setInlineBanner(null)
  }, [clearChecklistEditor])

  const handleOpenChecklistEdit = useCallback((item: TaskDetailChecklistShellItem) => {
    setChecklistComposerValue(item.text)
    setEditingChecklistIndex(item.index)
    setInlineBanner(null)
  }, [])

  const handleSubmitChecklist = useCallback(async () => {
    if (!taskId) {
      return
    }

    const text = checklistComposerValue.trim()
    if (text.length === 0) {
      return
    }

    const editingItem = editingChecklistIndex === null
      ? null
      : shell?.checklist.items.find((item) => item.index === editingChecklistIndex) ?? null
    const isEditing = editingItem !== null
    const actionKey = isEditing ? `checklist:edit:${editingItem.index}` : 'checklist:add'

    setBusyActionKey(actionKey)
    setInlineBanner(null)

    try {
      const context = await readTaskContext()
      let expectedToken: string | null = null

      if (!hasLiveConnection) {
        await saveChecklistDraft({
          action: isEditing ? 'edit' : 'add',
          expectedRaw: editingItem?.raw ?? null,
          expectedToken: null,
          itemIndex: editingItem?.index ?? null,
          namespace: context.namespace,
          text,
        })
        return
      }

      try {
        if (isEditing && editingItem) {
          await context.client.editChecklistItem(taskId, editingItem.index, {
            text,
            expectedRaw: editingItem.raw,
          })
        } else {
          const checklist = await context.client.getChecklist(taskId)
          expectedToken = checklist.token
          await context.client.addChecklistItem(taskId, {
            text,
            expectedToken,
          })
        }

        clearChecklistEditor()
        await refreshTaskFromServer(context)
      } catch (error) {
        if (await handleProtectedMutationFailure(error)) {
          return
        }

        if (isChecklistConflictError(error)) {
          await refreshTaskFromServer(context)
          setInlineBanner({
            title: 'Checklist changed',
            message: buildChecklistConflictMessage(),
            tone: 'error',
          })
          return
        }

        if (shouldStoreAsLocalDraft(error)) {
          await saveChecklistDraft({
            action: isEditing ? 'edit' : 'add',
            expectedRaw: editingItem?.raw ?? null,
            expectedToken,
            itemIndex: editingItem?.index ?? null,
            namespace: context.namespace,
            text,
          })
          return
        }

        setInlineBanner({
          title: isEditing ? 'Checklist item not updated' : 'Checklist item not added',
          message: resolveMutationErrorMessage(
            error,
            isEditing ? 'Unable to update this checklist item.' : 'Unable to add this checklist item.',
          ),
          tone: 'error',
        })
      }
    } catch (error) {
      setInlineBanner({
        title: editingChecklistIndex === null ? 'Checklist item not added' : 'Checklist item not updated',
        message: resolveMutationErrorMessage(
          error,
          editingChecklistIndex === null
            ? 'Unable to add this checklist item.'
            : 'Unable to update this checklist item.',
        ),
        tone: 'error',
      })
    } finally {
      setBusyActionKey(null)
    }
  }, [
    checklistComposerValue,
    clearChecklistEditor,
    editingChecklistIndex,
    handleProtectedMutationFailure,
    hasLiveConnection,
    readTaskContext,
    refreshTaskFromServer,
    saveChecklistDraft,
    shell?.checklist.items,
    taskId,
  ])

  const handleToggleChecklistItem = useCallback(async (item: TaskDetailChecklistShellItem) => {
    if (!taskId) {
      return
    }

    setBusyActionKey(`checklist:${item.toggleAction}:${item.index}`)
    setInlineBanner(null)

    try {
      const context = await readTaskContext()

      if (!hasLiveConnection) {
        await saveChecklistDraft({
          action: item.toggleAction,
          expectedRaw: item.raw,
          itemIndex: item.index,
          namespace: context.namespace,
          text: item.text,
        })
        return
      }

      try {
        if (item.toggleAction === 'check') {
          await context.client.checkChecklistItem(taskId, item.index, {
            expectedRaw: item.raw,
          })
        } else {
          await context.client.uncheckChecklistItem(taskId, item.index, {
            expectedRaw: item.raw,
          })
        }

        await refreshTaskFromServer(context)
      } catch (error) {
        if (await handleProtectedMutationFailure(error)) {
          return
        }

        if (isChecklistConflictError(error)) {
          await refreshTaskFromServer(context)
          setInlineBanner({
            title: 'Checklist changed',
            message: buildChecklistConflictMessage(),
            tone: 'error',
          })
          return
        }

        if (shouldStoreAsLocalDraft(error)) {
          await saveChecklistDraft({
            action: item.toggleAction,
            expectedRaw: item.raw,
            itemIndex: item.index,
            namespace: context.namespace,
            text: item.text,
          })
          return
        }

        setInlineBanner({
          title: 'Checklist not updated',
          message: resolveMutationErrorMessage(error, 'Unable to update this checklist item.'),
          tone: 'error',
        })
      }
    } catch (error) {
      setInlineBanner({
        title: 'Checklist not updated',
        message: resolveMutationErrorMessage(error, 'Unable to update this checklist item.'),
        tone: 'error',
      })
    } finally {
      setBusyActionKey(null)
    }
  }, [
    handleProtectedMutationFailure,
    hasLiveConnection,
    readTaskContext,
    refreshTaskFromServer,
    saveChecklistDraft,
    taskId,
  ])

  const performDeleteChecklistItem = useCallback(async (item: TaskDetailChecklistShellItem) => {
    if (!taskId) {
      return
    }

    setBusyActionKey(`checklist:delete:${item.index}`)
    setInlineBanner(null)

    try {
      const context = await readTaskContext()
      try {
        await context.client.deleteChecklistItem(taskId, item.index, {
          expectedRaw: item.raw,
        })
        await refreshTaskFromServer(context)
      } catch (error) {
        if (await handleProtectedMutationFailure(error)) {
          return
        }

        if (isChecklistConflictError(error)) {
          await refreshTaskFromServer(context)
          setInlineBanner({
            title: 'Checklist changed',
            message: buildChecklistConflictMessage(),
            tone: 'error',
          })
          return
        }

        if (shouldStoreAsLocalDraft(error)) {
          await saveChecklistDraft({
            action: 'delete',
            expectedRaw: item.raw,
            itemIndex: item.index,
            namespace: context.namespace,
            text: item.text,
          })
          return
        }

        setInlineBanner({
          title: 'Checklist item not deleted',
          message: resolveMutationErrorMessage(error, 'Unable to delete this checklist item.'),
          tone: 'error',
        })
      }
    } catch (error) {
      setInlineBanner({
        title: 'Checklist item not deleted',
        message: resolveMutationErrorMessage(error, 'Unable to delete this checklist item.'),
        tone: 'error',
      })
    } finally {
      setBusyActionKey(null)
    }
  }, [
    handleProtectedMutationFailure,
    readTaskContext,
    refreshTaskFromServer,
    saveChecklistDraft,
    taskId,
  ])

  const handleDeleteChecklistItem = useCallback((item: TaskDetailChecklistShellItem) => {
    if (!hasLiveConnection) {
      void (async () => {
        try {
          const context = await readTaskContext()
          await saveChecklistDraft({
            action: 'delete',
            expectedRaw: item.raw,
            itemIndex: item.index,
            namespace: context.namespace,
            text: item.text,
          })
        } catch (error) {
          setInlineBanner({
            title: 'Checklist item not deleted',
            message: resolveMutationErrorMessage(error, 'Unable to save this checklist removal locally.'),
            tone: 'error',
          })
        }
      })()
      return
    }

    Alert.alert(
      'Delete checklist item?',
      'This removes the synced checklist item from the task.',
      [
        {
          style: 'cancel',
          text: 'Cancel',
        },
        {
          style: 'destructive',
          text: 'Delete',
          onPress: () => {
            void performDeleteChecklistItem(item)
          },
        },
      ],
    )
  }, [hasLiveConnection, performDeleteChecklistItem, readTaskContext, saveChecklistDraft])

  const handleReviewChecklistDraft = useCallback(async () => {
    setInlineBanner(null)

    try {
      const context = await readTaskContext()
      await refreshTaskFromServer(context)
    } catch (error) {
      setInlineBanner({
        title: 'Couldn’t refresh checklist',
        message: resolveMutationErrorMessage(error, 'Unable to review the latest checklist state.'),
        tone: 'error',
      })
    }
  }, [readTaskContext, refreshTaskFromServer])

  const handleResendChecklistDraft = useCallback(async (draft: ChecklistDraftRecord) => {
    if (!taskId) {
      return
    }

    if (!hasLiveConnection) {
      setInlineBanner({
        title: 'Connection required',
        message: 'Reconnect to send this draft.',
        tone: 'error',
      })
      return
    }

    setBusyActionKey(`checklist:send:${draft.draftId}`)
    setInlineBanner(null)

    try {
      const context = await readTaskContext()
      const claim = await cacheStore.claimExplicitResend(context.namespace, draft.draftId)
      if (!claim.claimed) {
        await syncTaskDrafts(context.namespace)
        return
      }

      await syncTaskDrafts(context.namespace)

      try {
        const useLatest = draft.status === 'conflict'

        switch (draft.action) {
          case 'add': {
            const text = draft.text?.trim() ?? ''
            const expectedToken = useLatest || !draft.expectedToken
              ? (await context.client.getChecklist(taskId)).token
              : draft.expectedToken

            await context.client.addChecklistItem(taskId, {
              text,
              expectedToken,
            })
            break
          }
          case 'edit': {
            const index = draft.itemIndex
            const expectedRaw = useLatest
              ? findChecklistRawByIndex(loadState.task, index)
              : draft.expectedRaw
            if (index === null || !expectedRaw) {
              throw new Error(buildChecklistConflictMessage())
            }

            await context.client.editChecklistItem(taskId, index, {
              text: draft.text ?? '',
              expectedRaw,
            })
            break
          }
          case 'delete': {
            const index = draft.itemIndex
            const expectedRaw = useLatest
              ? findChecklistRawByIndex(loadState.task, index)
              : draft.expectedRaw
            if (index === null || !expectedRaw) {
              throw new Error(buildChecklistConflictMessage())
            }

            await context.client.deleteChecklistItem(taskId, index, {
              expectedRaw,
            })
            break
          }
          case 'check': {
            const index = draft.itemIndex
            const expectedRaw = useLatest
              ? findChecklistRawByIndex(loadState.task, index)
              : draft.expectedRaw
            if (index === null || !expectedRaw) {
              throw new Error(buildChecklistConflictMessage())
            }

            await context.client.checkChecklistItem(taskId, index, {
              expectedRaw,
            })
            break
          }
          case 'uncheck': {
            const index = draft.itemIndex
            const expectedRaw = useLatest
              ? findChecklistRawByIndex(loadState.task, index)
              : draft.expectedRaw
            if (index === null || !expectedRaw) {
              throw new Error(buildChecklistConflictMessage())
            }

            await context.client.uncheckChecklistItem(taskId, index, {
              expectedRaw,
            })
            break
          }
          default:
            break
        }

        await cacheStore.resolveExplicitResend(context.namespace, draft.draftId, {
          outcome: 'sent',
        })
        await syncTaskDrafts(context.namespace)
        await refreshTaskFromServer(context)
      } catch (error) {
        if (await handleProtectedMutationFailure(error)) {
          await cacheStore.resolveExplicitResend(context.namespace, draft.draftId, {
            outcome: 'failed',
            error: {
              code: 'session_revoked',
              message: 'Session expired. Sign in again.',
            },
          })
          await syncTaskDrafts(context.namespace)
          return
        }

        const conflict = isChecklistConflictError(error) || resolveMutationErrorMessage(error, '').includes(buildChecklistConflictMessage())
        await cacheStore.resolveExplicitResend(context.namespace, draft.draftId, {
          outcome: conflict ? 'conflict' : 'failed',
          error: {
            code: conflict
              ? 'checklist_conflict'
              : error instanceof MobileApiClientError
                ? `http_${error.status}`
                : 'send_failed',
            message: conflict
              ? buildChecklistConflictMessage()
              : resolveMutationErrorMessage(error, 'Unable to send this checklist change.'),
          },
        })
        await syncTaskDrafts(context.namespace)
        if (conflict) {
          await refreshTaskFromServer(context)
        }
        setInlineBanner({
          title: conflict ? 'Checklist changed' : 'Checklist not sent',
          message: conflict
            ? buildChecklistConflictMessage()
            : resolveMutationErrorMessage(error, 'Unable to send this checklist change.'),
          tone: 'error',
        })
      }
    } catch (error) {
      setInlineBanner({
        title: 'Checklist not sent',
        message: resolveMutationErrorMessage(error, 'Unable to send this checklist change.'),
        tone: 'error',
      })
    } finally {
      setBusyActionKey(null)
    }
  }, [
    cacheStore,
    handleProtectedMutationFailure,
    hasLiveConnection,
    loadState.task,
    readTaskContext,
    refreshTaskFromServer,
    syncTaskDrafts,
    taskId,
  ])

  const saveCommentDraft = useCallback(async (input: {
    author: string
    commentId?: string | null
    content: string
    namespace: CacheNamespace
    operation: 'create' | 'update'
  }) => {
    if (!taskId) {
      return
    }

    const existingDraftId = input.operation === 'update' && input.commentId
      ? commentDraftsByCommentId.get(input.commentId)?.draftId
      : null

    const envelope = await cacheStore.queueDraft(
      input.namespace,
      input.operation === 'update' && input.commentId
        ? {
            kind: 'comment',
            draftId: existingDraftId ?? buildDraftId('comment'),
            taskId,
            author: input.author,
            content: input.content,
            operation: 'update',
            commentId: input.commentId,
          }
        : {
            kind: 'comment',
            draftId: buildDraftId('comment'),
            taskId,
            author: input.author,
            content: input.content,
            operation: 'create',
          },
    )

    applyDraftEnvelope(envelope)
    clearCommentEditor()
    setInlineBanner({
      title: 'Saved on this device',
      message: 'Saved on this device. Review before sending.',
      tone: 'notice',
    })
  }, [
    applyDraftEnvelope,
    cacheStore,
    clearCommentEditor,
    commentDraftsByCommentId,
    taskId,
  ])

  const handleOpenVoiceRecorder = useCallback(() => {
    if (!hasLiveConnection) {
      setInlineBanner({
        title: 'Connection required',
        message: 'Voice comments need a live connection so the audio clip and comment stay in sync.',
        tone: 'error',
      })
      return
    }

    setInlineBanner(null)
    setVoiceRecorderVisible(true)
  }, [hasLiveConnection])

  const handleAttachVoiceComment = useCallback(async (clip: RecordedVoiceCommentClip) => {
    if (!taskId) {
      return
    }

    setBusyActionKey('comment:voice:attach')
    setInlineBanner(null)

    try {
      const context = await readTaskContext()
      const previousDraft = commentVoiceDraftRef.current
      const durableDraft = await prepareDurableAttachmentDraft({
        namespace: context.namespace,
        taskId,
        source: {
          fileName: clip.fileName,
          mimeType: clip.mimeType,
          uri: clip.uri,
        },
        existingDrafts: [],
      })

      setCommentVoiceDraft({
        durationMs: clip.durationMs,
        fileName: durableDraft.fileName,
        mimeType: durableDraft.mimeType,
        sizeBytes: durableDraft.sizeBytes,
        uri: durableDraft.uri,
      })
      setVoiceRecorderVisible(false)

      if (previousDraft) {
        try {
          await deleteDurableAttachmentDraft(previousDraft.uri)
        } catch {
          // Best-effort cleanup for the replaced local recording.
        }
      }
    } catch (error) {
      if (error instanceof AttachmentDraftError) {
        setInlineBanner({
          title: 'Voice comment not saved',
          message: error.message,
          tone: 'error',
        })
        return
      }

      if (await handleProtectedMutationFailure(error)) {
        return
      }

      setInlineBanner({
        title: 'Voice comment not saved',
        message: resolveMutationErrorMessage(error, 'Unable to keep this recording on the device.'),
        tone: 'error',
      })
    } finally {
      setBusyActionKey(null)
    }
  }, [handleProtectedMutationFailure, readTaskContext, taskId])

  const handleSubmitComment = useCallback(async () => {
    const isEditing = editingCommentId !== null
    const note = (isEditing ? editingCommentValue : commentComposerValue).trim()
    const voiceAttachment = isEditing
      ? editingCommentVoiceAttachment
      : commentVoiceDraft
        ? {
            filename: commentVoiceDraft.fileName,
            mimeType: commentVoiceDraft.mimeType,
            durationMs: commentVoiceDraft.durationMs,
          }
        : null
    const content = voiceAttachment
      ? buildVoiceCommentContent({
          voiceAttachment,
          note,
        })
      : note

    if (!taskId || (note.length === 0 && !voiceAttachment)) {
      return
    }

    const actionKey = isEditing ? `comment:update:${editingCommentId}` : 'comment:create'
    const createNeedsLiveVoiceUpload = !isEditing && commentVoiceDraft !== null
    setBusyActionKey(actionKey)
    setInlineBanner(null)

    try {
      const context = await readTaskContext()
      const existingComment = isEditing && editingCommentId
        ? loadState.task?.comments.find((comment) => comment.id === editingCommentId) ?? null
        : null

      const draftAuthor = existingComment?.author ?? context.storedSession.subject

      if (!hasLiveConnection) {
        if (createNeedsLiveVoiceUpload) {
          setInlineBanner({
            title: 'Connection required',
            message: 'Reconnect to send this voice comment. The recording is still on this device.',
            tone: 'error',
          })
          return
        }

        await saveCommentDraft({
          author: draftAuthor,
          commentId: editingCommentId,
          content,
          namespace: context.namespace,
          operation: isEditing ? 'update' : 'create',
        })
        return
      }

      let uploadedVoiceFilename: string | null = null

      try {
        if (createNeedsLiveVoiceUpload && commentVoiceDraft) {
          let base64Data: string
          try {
            base64Data = await readAttachmentDraftAsBase64(commentVoiceDraft.uri)
          } catch {
            await discardPendingVoiceDraft()
            setInlineBanner({
              title: 'Voice recording missing',
              message: 'The saved recording copy is missing. Record the voice comment again.',
              tone: 'error',
            })
            return
          }

          await context.client.uploadAttachments(taskId, {
            files: [
              {
                name: commentVoiceDraft.fileName,
                data: base64Data,
              },
            ],
          })
          uploadedVoiceFilename = commentVoiceDraft.fileName
        }

        const savedComment = isEditing && editingCommentId
          ? await context.client.updateComment(taskId, editingCommentId, { content })
          : await context.client.createComment(taskId, {
              author: context.storedSession.subject,
              content,
            })

        const existingEditDraft = isEditing && editingCommentId
          ? commentDraftsByCommentId.get(editingCommentId)
          : null
        if (existingEditDraft) {
          await cacheStore.discardDraft(context.namespace, existingEditDraft.draftId)
          await syncTaskDrafts(context.namespace)
        }

        clearCommentEditor()

        if (loadState.task) {
          const nextTask = applyCommentMutationToTask(
            loadState.task,
            savedComment,
            isEditing ? 'update' : 'create',
          )

          await persistTaskSnapshot(
            context.namespace,
            uploadedVoiceFilename ? addAttachmentToTask(nextTask, uploadedVoiceFilename) : nextTask,
            'live',
          )
        } else {
          await refreshTaskFromServer(context)
        }
      } catch (error) {
        let cleanupWarning: string | null = null
        if (uploadedVoiceFilename) {
          try {
            await context.client.removeAttachment(taskId, uploadedVoiceFilename)
          } catch {
            cleanupWarning = 'The uploaded audio clip may still be attached and might need manual removal.'
          }
        }

        if (await handleProtectedMutationFailure(error)) {
          return
        }

        if (!createNeedsLiveVoiceUpload && shouldStoreAsLocalDraft(error)) {
          await saveCommentDraft({
            author: draftAuthor,
            commentId: editingCommentId,
            content,
            namespace: context.namespace,
            operation: isEditing ? 'update' : 'create',
          })
          return
        }

        const messageParts = [resolveMutationErrorMessage(error, 'Unable to save this comment.')]
        if (createNeedsLiveVoiceUpload) {
          messageParts.push('The recording is still on this device so you can retry.')
        }
        if (cleanupWarning) {
          messageParts.push(cleanupWarning)
        }

        setInlineBanner({
          title: 'Comment not saved',
          message: messageParts.join(' '),
          tone: 'error',
        })
      }
    } catch (error) {
      setInlineBanner({
        title: 'Comment not saved',
        message: resolveMutationErrorMessage(error, 'Unable to save this comment.'),
        tone: 'error',
      })
    } finally {
      setBusyActionKey(null)
    }
  }, [
    cacheStore,
    clearCommentEditor,
    commentComposerValue,
    commentVoiceDraft,
    commentDraftsByCommentId,
    discardPendingVoiceDraft,
    editingCommentId,
    editingCommentValue,
    editingCommentVoiceAttachment,
    handleProtectedMutationFailure,
    hasLiveConnection,
    loadState.task,
    persistTaskSnapshot,
    readTaskContext,
    refreshTaskFromServer,
    saveCommentDraft,
    syncTaskDrafts,
    taskId,
  ])

  const handleStartEditComment = useCallback((item: TaskDetailCommentShellItem) => {
    const existingDraft = commentDraftsByCommentId.get(item.id)
    const parsedContent = parseVoiceCommentContent(existingDraft?.content ?? item.content)
    void discardPendingVoiceDraft()
    setCommentComposerValue('')
    setEditingCommentId(item.id)
    setEditingCommentValue(parsedContent.note)
    setEditingCommentVoiceAttachment(parsedContent.voiceAttachment)
    setVoiceRecorderVisible(false)
    setInlineBanner(null)
  }, [commentDraftsByCommentId, discardPendingVoiceDraft])

  const performDeleteComment = useCallback(async (item: TaskDetailCommentShellItem) => {
    if (!taskId) {
      return
    }

    setBusyActionKey(`comment:delete:${item.id}`)
    setInlineBanner(null)

    try {
      const context = await readTaskContext()
      await context.client.deleteComment(taskId, item.id)

      const relatedDraft = commentDraftsByCommentId.get(item.id)
      if (relatedDraft) {
        await cacheStore.discardDraft(context.namespace, relatedDraft.draftId)
        await syncTaskDrafts(context.namespace)
      }

      if (editingCommentId === item.id) {
        clearCommentEditor()
      }

      if (loadState.task) {
        await persistTaskSnapshot(
          context.namespace,
          removeCommentAndLinkedVoiceAttachmentFromTask(loadState.task, item.id),
          'live',
        )
      } else {
        await refreshTaskFromServer(context)
      }
    } catch (error) {
      if (await handleProtectedMutationFailure(error)) {
        return
      }

      setInlineBanner({
        title: 'Comment not deleted',
        message: resolveMutationErrorMessage(error, 'Unable to delete this comment.'),
        tone: 'error',
      })
    } finally {
      setBusyActionKey(null)
    }
  }, [
    cacheStore,
    clearCommentEditor,
    commentDraftsByCommentId,
    editingCommentId,
    handleProtectedMutationFailure,
    loadState.task,
    persistTaskSnapshot,
    readTaskContext,
    refreshTaskFromServer,
    syncTaskDrafts,
    taskId,
  ])

  const handleDeleteComment = useCallback((item: TaskDetailCommentShellItem) => {
    if (!hasLiveConnection) {
      setInlineBanner({
        title: 'Connection required',
        message: 'Needs a live connection.',
        tone: 'error',
      })
      return
    }

    const voiceAttachment = parseVoiceCommentContent(item.content).voiceAttachment

    Alert.alert(
      'Delete comment?',
      voiceAttachment
        ? 'This removes the synced comment and its linked voice attachment from the task.'
        : 'This removes the synced comment from the task.',
      [
        {
          style: 'cancel',
          text: 'Cancel',
        },
        {
          style: 'destructive',
          text: 'Delete',
          onPress: () => {
            void performDeleteComment(item)
          },
        },
      ],
    )
  }, [hasLiveConnection, performDeleteComment])

  const queueAttachmentSource = useCallback(async (source: {
    fileName?: string | null
    mimeType?: string | null
    sizeBytes?: number | null
    uri: string
  }) => {
    if (!taskId) {
      return
    }

    const context = await readTaskContext()
    const existingDrafts = await readNamespaceAttachmentDrafts(cacheStore, context.namespace, {
      deleteDurableAttachment: deleteDurableAttachmentDraft,
    })
    const draft = await prepareDurableAttachmentDraft({
      namespace: context.namespace,
      taskId,
      source,
      existingDrafts,
    })

    const envelope = await cacheStore.queueAttachmentDraft(context.namespace, draft)
    applyDraftEnvelope(envelope)
    setInlineBanner({
      title: 'Saved on this device',
      message: 'Saved on this device. Review before sending.',
      tone: 'notice',
    })
  }, [applyDraftEnvelope, cacheStore, readTaskContext, taskId])

  const handleCaptureAttachment = useCallback(async (mode: 'file' | 'photo' | 'scan') => {
    setBusyActionKey(`attachment:pick:${mode}`)
    setInlineBanner(null)

    try {
      if (mode === 'file') {
        const result = await DocumentPicker.getDocumentAsync({
          copyToCacheDirectory: true,
          multiple: false,
          type: '*/*',
        })
        if (result.canceled) {
          return
        }

        const asset = result.assets?.[0]
        if (!asset) {
          return
        }

        await queueAttachmentSource({
          uri: asset.uri,
          fileName: asset.name,
          mimeType: asset.mimeType ?? 'application/octet-stream',
          sizeBytes: asset.size ?? null,
        })
        return
      }

      const permission = await ImagePicker.requestCameraPermissionsAsync()
      if (!permission.granted) {
        setInlineBanner({
          title: 'Camera access needed',
          message: 'Allow camera access to capture this attachment.',
          tone: 'error',
        })
        return
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: mode === 'scan',
        mediaTypes: ['images'],
        quality: 1,
      })
      if (result.canceled) {
        return
      }

      const asset = result.assets?.[0]
      if (!asset) {
        return
      }

      await queueAttachmentSource({
        uri: asset.uri,
        fileName: asset.fileName ?? (mode === 'scan' ? 'scan.jpg' : 'photo.jpg'),
        mimeType: asset.mimeType ?? 'image/jpeg',
        sizeBytes: asset.fileSize ?? null,
      })
    } catch (error) {
      if (error instanceof AttachmentDraftError) {
        setInlineBanner({
          title: 'Attachment not saved',
          message: error.message,
          tone: 'error',
        })
        return
      }

      if (await handleProtectedMutationFailure(error)) {
        return
      }

      setInlineBanner({
        title: 'Attachment not saved',
        message: resolveMutationErrorMessage(error, 'Unable to save this attachment locally.'),
        tone: 'error',
      })
    } finally {
      setBusyActionKey(null)
    }
  }, [handleProtectedMutationFailure, queueAttachmentSource])

  const handleDiscardDraft = useCallback(async (draftId: string) => {
    const activeDraft = [...commentDrafts, ...attachmentDrafts, ...checklistDrafts, ...formDrafts].find((draft) => draft.draftId === draftId)
    const sendInFlight =
      activeDraft?.status === 'sending'
      || busyActionKey === `comment:send:${draftId}`
      || busyActionKey === `attachment:send:${draftId}`
      || busyActionKey === `checklist:send:${draftId}`
      || busyActionKey === `form:send:${draftId}`

    if (sendInFlight) {
      setInlineBanner({
        title: 'Draft still sending',
        message: 'Wait for this send to finish before discarding the draft.',
        tone: 'error',
      })
      return
    }

    setBusyActionKey(`draft:discard:${draftId}`)
    setInlineBanner(null)

    try {
      const context = await readTaskContext()
      const discarded = await cacheStore.discardDraft(context.namespace, draftId)
      if (discarded.removedAttachmentUri) {
        await deleteDurableAttachmentDraft(discarded.removedAttachmentUri)
      }

      await syncTaskDrafts(context.namespace)

      if (
        discarded.draft?.kind === 'comment'
        && discarded.draft.operation === 'update'
        && discarded.draft.commentId === editingCommentId
      ) {
        clearCommentEditor()
      }

      if (
        discarded.draft?.kind === 'checklist'
        && discarded.draft.itemIndex !== null
        && discarded.draft.itemIndex === editingChecklistIndex
      ) {
        clearChecklistEditor()
      }

      if (discarded.draft?.kind === 'form' && discarded.draft.formId === activeFormId) {
        closeFormSheet()
      }
    } catch (error) {
      if (await handleProtectedMutationFailure(error)) {
        return
      }

      setInlineBanner({
        title: 'Draft not discarded',
        message: resolveMutationErrorMessage(error, 'Unable to discard this local draft.'),
        tone: 'error',
      })
    } finally {
      setBusyActionKey(null)
    }
  }, [
    attachmentDrafts,
    activeFormId,
    busyActionKey,
    cacheStore,
    checklistDrafts,
    clearChecklistEditor,
    clearCommentEditor,
    closeFormSheet,
    commentDrafts,
    editingChecklistIndex,
    editingCommentId,
    formDrafts,
    handleProtectedMutationFailure,
    readTaskContext,
    syncTaskDrafts,
  ])

  const handleResendCommentDraft = useCallback(async (draft: CommentDraftRecord) => {
    if (!taskId) {
      return
    }

    if (!hasLiveConnection) {
      setInlineBanner({
        title: 'Connection required',
        message: 'Reconnect to send this draft.',
        tone: 'error',
      })
      return
    }

    setBusyActionKey(`comment:send:${draft.draftId}`)
    setInlineBanner(null)

    try {
      const context = await readTaskContext()
      const claim = await cacheStore.claimExplicitResend(context.namespace, draft.draftId)
      if (!claim.claimed) {
        await syncTaskDrafts(context.namespace)
        return
      }

      await syncTaskDrafts(context.namespace)

      try {
        const savedComment = draft.operation === 'update' && draft.commentId
          ? await context.client.updateComment(taskId, draft.commentId, { content: draft.content })
          : await context.client.createComment(taskId, {
              author: draft.author,
              content: draft.content,
            })

        await cacheStore.resolveExplicitResend(context.namespace, draft.draftId, {
          outcome: 'sent',
        })
        await syncTaskDrafts(context.namespace)

        if (loadState.task) {
          await persistTaskSnapshot(
            context.namespace,
            applyCommentMutationToTask(loadState.task, savedComment, draft.operation),
            'live',
          )
        } else {
          await refreshTaskFromServer(context)
        }
      } catch (error) {
        if (await handleProtectedMutationFailure(error)) {
          await cacheStore.resolveExplicitResend(context.namespace, draft.draftId, {
            outcome: 'failed',
            error: {
              code: 'session_revoked',
              message: 'Session expired. Sign in again.',
            },
          })
          return
        }

        await cacheStore.resolveExplicitResend(context.namespace, draft.draftId, {
          outcome: 'failed',
          error: {
            code: error instanceof MobileApiClientError ? `http_${error.status}` : 'send_failed',
            message: resolveMutationErrorMessage(error, 'Unable to send this comment draft.'),
          },
        })
        await syncTaskDrafts(context.namespace)
        setInlineBanner({
          title: 'Comment not sent',
          message: resolveMutationErrorMessage(error, 'Unable to send this comment draft.'),
          tone: 'error',
        })
      }
    } catch (error) {
      setInlineBanner({
        title: 'Comment not sent',
        message: resolveMutationErrorMessage(error, 'Unable to send this comment draft.'),
        tone: 'error',
      })
    } finally {
      setBusyActionKey(null)
    }
  }, [
    cacheStore,
    handleProtectedMutationFailure,
    hasLiveConnection,
    loadState.task,
    persistTaskSnapshot,
    readTaskContext,
    refreshTaskFromServer,
    syncTaskDrafts,
    taskId,
  ])

  const handleResendFormDraft = useCallback(async (draft: FormDraftRecord) => {
    if (!taskId) {
      return
    }

    if (!hasLiveConnection) {
      setInlineBanner({
        title: 'Connection required',
        message: 'Reconnect to send this draft.',
        tone: 'error',
      })
      return
    }

    setBusyActionKey(`form:send:${draft.draftId}`)
    setInlineBanner(null)

    try {
      const context = await readTaskContext()
      const claim = await cacheStore.claimExplicitResend(context.namespace, draft.draftId)
      if (!claim.claimed) {
        await syncTaskDrafts(context.namespace)
        return
      }

      await syncTaskDrafts(context.namespace)

      try {
        await context.client.submitForm(taskId, draft.formId, {
          data: draft.data,
        })

        await cacheStore.resolveExplicitResend(context.namespace, draft.draftId, {
          outcome: 'sent',
        })
        await syncTaskDrafts(context.namespace)
        closeFormSheet()
        await refreshTaskFromServer(context)
      } catch (error) {
        if (await handleProtectedMutationFailure(error)) {
          await cacheStore.resolveExplicitResend(context.namespace, draft.draftId, {
            outcome: 'failed',
            error: {
              code: 'session_revoked',
              message: 'Session expired. Sign in again.',
            },
          })
          return
        }

        await cacheStore.resolveExplicitResend(context.namespace, draft.draftId, {
          outcome: 'failed',
          error: {
            code: error instanceof MobileApiClientError ? `http_${error.status}` : 'send_failed',
            message: resolveMutationErrorMessage(error, 'Unable to send this form draft.'),
          },
        })
        await syncTaskDrafts(context.namespace)
        setInlineBanner({
          title: 'Form not sent',
          message: resolveMutationErrorMessage(error, 'Unable to send this form draft.'),
          tone: 'error',
        })
      }
    } catch (error) {
      setInlineBanner({
        title: 'Form not sent',
        message: resolveMutationErrorMessage(error, 'Unable to send this form draft.'),
        tone: 'error',
      })
    } finally {
      setBusyActionKey(null)
    }
  }, [
    cacheStore,
    closeFormSheet,
    handleProtectedMutationFailure,
    hasLiveConnection,
    readTaskContext,
    refreshTaskFromServer,
    syncTaskDrafts,
    taskId,
  ])

  const handleSendAttachmentDraft = useCallback(async (draft: AttachmentDraftRecord) => {
    if (!taskId) {
      return
    }

    if (!hasLiveConnection) {
      setInlineBanner({
        title: 'Connection required',
        message: 'Reconnect to send this draft.',
        tone: 'error',
      })
      return
    }

    setBusyActionKey(`attachment:send:${draft.draftId}`)
    setInlineBanner(null)

    try {
      const context = await readTaskContext()

      let base64Data: string
      try {
        base64Data = await readAttachmentDraftAsBase64(draft.uri)
      } catch {
        await cacheStore.markAttachmentMissingLocalFile(context.namespace, draft.draftId)
        await syncTaskDrafts(context.namespace)
        setInlineBanner({
          title: 'Draft file missing',
          message: 'The durable local attachment copy is missing. Remove or recapture it.',
          tone: 'error',
        })
        return
      }

      const claim = await cacheStore.claimExplicitResend(context.namespace, draft.draftId)
      if (!claim.claimed) {
        await syncTaskDrafts(context.namespace)
        return
      }

      await syncTaskDrafts(context.namespace)

      try {
        await context.client.uploadAttachments(taskId, {
          files: [
            {
              name: draft.fileName,
              data: base64Data,
            },
          ],
        })

        const resolved = await cacheStore.resolveExplicitResend(context.namespace, draft.draftId, {
          outcome: 'sent',
        })
        if (resolved.removedAttachmentUri) {
          await deleteDurableAttachmentDraft(resolved.removedAttachmentUri)
        }
        await syncTaskDrafts(context.namespace)
        await refreshTaskFromServer(context)
      } catch (error) {
        if (await handleProtectedMutationFailure(error)) {
          await cacheStore.resolveExplicitResend(context.namespace, draft.draftId, {
            outcome: 'failed',
            error: {
              code: 'session_revoked',
              message: 'Session expired. Sign in again.',
            },
          })
          return
        }

        await cacheStore.resolveExplicitResend(context.namespace, draft.draftId, {
          outcome: 'failed',
          error: {
            code: error instanceof MobileApiClientError ? `http_${error.status}` : 'send_failed',
            message: resolveMutationErrorMessage(error, 'Unable to upload this attachment draft.'),
          },
        })
        await syncTaskDrafts(context.namespace)
        setInlineBanner({
          title: 'Attachment not sent',
          message: resolveMutationErrorMessage(error, 'Unable to upload this attachment draft.'),
          tone: 'error',
        })
      }
    } catch (error) {
      setInlineBanner({
        title: 'Attachment not sent',
        message: resolveMutationErrorMessage(error, 'Unable to upload this attachment draft.'),
        tone: 'error',
      })
    } finally {
      setBusyActionKey(null)
    }
  }, [
    cacheStore,
    handleProtectedMutationFailure,
    hasLiveConnection,
    readTaskContext,
    refreshTaskFromServer,
    syncTaskDrafts,
    taskId,
  ])

  const performRemoveAttachment = useCallback(async (item: TaskDetailAttachmentShellItem) => {
    if (!taskId) {
      return
    }

    setBusyActionKey(`attachment:remove:${item.name}`)
    setInlineBanner(null)

    try {
      const context = await readTaskContext()
      await context.client.removeAttachment(taskId, item.name)
      await refreshTaskFromServer(context)
    } catch (error) {
      if (await handleProtectedMutationFailure(error)) {
        return
      }

      setInlineBanner({
        title: 'Attachment not removed',
        message: resolveMutationErrorMessage(error, 'Unable to remove this attachment.'),
        tone: 'error',
      })
    } finally {
      setBusyActionKey(null)
    }
  }, [
    handleProtectedMutationFailure,
    readTaskContext,
    refreshTaskFromServer,
    taskId,
  ])

  const handleRemoveAttachment = useCallback((item: TaskDetailAttachmentShellItem) => {
    if (!hasLiveConnection) {
      setInlineBanner({
        title: 'Connection required',
        message: 'Needs a live connection.',
        tone: 'error',
      })
      return
    }

    Alert.alert(
      'Remove attachment?',
      'This removes the synced attachment from the task.',
      [
        {
          style: 'cancel',
          text: 'Cancel',
        },
        {
          style: 'destructive',
          text: 'Remove',
          onPress: () => {
            void performRemoveAttachment(item)
          },
        },
      ],
    )
  }, [hasLiveConnection, performRemoveAttachment])

  const handleTriggerCardAction = useCallback(async (item: TaskDetailActionShellItem) => {
    if (!taskId) {
      return
    }

    if (!hasLiveConnection) {
      setInlineBanner({
        title: 'Connection required',
        message: 'Needs a live connection.',
        tone: 'error',
      })
      return
    }

    setBusyActionKey(`card-action:${item.key}`)
    setInlineBanner(null)

    try {
      const context = await readTaskContext()
      await context.client.triggerAction(taskId, item.key)
      await refreshTaskFromServer(context)
    } catch (error) {
      if (await handleProtectedMutationFailure(error)) {
        return
      }

      setInlineBanner({
        title: 'Action not sent',
        message: resolveMutationErrorMessage(error, 'Unable to trigger this action.'),
        tone: 'error',
      })
    } finally {
      setBusyActionKey(null)
    }
  }, [
    handleProtectedMutationFailure,
    hasLiveConnection,
    readTaskContext,
    refreshTaskFromServer,
    taskId,
  ])

  const activeBanner = loadState.source === 'cache' && loadState.errorMessage
    ? null
    : inlineBanner ?? pendingDraftBanner
  const handlePrimaryDockAction = shell?.primaryAction
    ? (action: TaskDetailDockAction) => {
        if (action.kind === 'form') {
          const formId = action.key.replace(/^form:/, '')
          if (formId.length > 0) {
            openFormSheet(formId)
          }
          return
        }

        if (action.kind === 'checklist') {
          if (shell.checklist.canAdd) {
            handleOpenChecklistAdd()
            return
          }

          setInlineBanner({
            title: 'Checklist ready',
            message: 'Use the checklist items below to update this checklist.',
            tone: 'notice',
          })
          return
        }

        if (action.kind === 'card-action') {
          const actionKey = action.key.replace(/^card-action:/, '')
          const actionItem = shell.actions.items.find((candidate) => candidate.key === actionKey)
          if (actionItem) {
            void handleTriggerCardAction(actionItem)
          }
        }
      }
    : undefined
  const primaryActionDisabled = shell?.primaryAction?.kind === 'card-action'
    ? !hasLiveConnection || busyActionKey === `card-action:${shell.primaryAction.key.replace(/^card-action:/, '')}`
    : false
  const primaryActionNote = shell?.primaryAction?.kind === 'card-action' && !hasLiveConnection
    ? 'Needs a live connection.'
    : null
  const linkedVoiceAttachmentsByName = new Map<string, VoiceCommentAttachmentRef>()
  for (const comment of shell?.comments.items ?? []) {
    const voiceAttachment = parseVoiceCommentContent(comment.content).voiceAttachment
    if (voiceAttachment) {
      linkedVoiceAttachmentsByName.set(voiceAttachment.filename, voiceAttachment)
    }
  }
  const createCommentHasVoice = commentVoiceDraft !== null
  const createCommentNote = commentComposerValue.trim()
  const createCommentSubmitDisabled = (
    (createCommentNote.length === 0 && !createCommentHasVoice)
    || busyActionKey === 'comment:create'
    || (createCommentHasVoice && !hasLiveConnection)
  )
  const editCommentNote = editingCommentValue.trim()
  const editCommentSubmitDisabled = (
    (editCommentNote.length === 0 && !editingCommentVoiceAttachment)
    || (editingCommentId !== null && busyActionKey === `comment:update:${editingCommentId}`)
  )

  if (!taskId) {
    return (
      <SafeAreaView
        edges={['top', 'left', 'right', 'bottom']}
        style={[styles.screen, { backgroundColor: colors.background }]}
      >
        <View style={styles.scrollContent}>
          <SurfaceSection colors={shellColors} title="Task unavailable">
            <Text style={[styles.bodyText, { color: colors.text }]}>This task link is missing its identifier, so the shell cannot load a protected task.</Text>
            <View style={styles.footerRow}>
              <Pressable
                onPress={() => router.replace('/(app)')}
                style={[styles.navigationButton, { borderColor: colors.border }]}
              >
                <Text style={[styles.navigationButtonText, { color: colors.text }]}>Back to workfeed</Text>
              </Pressable>
            </View>
          </SurfaceSection>
        </View>
      </SafeAreaView>
    )
  }

  if (
    state.phase === 'restoring'
    || state.phase === 'signing-in'
    || loadState.phase === 'blocked'
    || loadState.phase === 'loading'
  ) {
    return (
      <NeutralShell
        body={
          loadState.source === 'cache'
            ? 'A cached snapshot exists, but the shell stays neutral until live visibility confirms that this task is still available.'
            : 'Protected task content stays hidden until the current workspace and caller are revalidated.'
        }
        colors={shellColors}
        title={state.statusMessage ?? 'Checking task access…'}
      />
    )
  }

  if (loadState.phase === 'unavailable') {
    return (
      <SafeAreaView
        edges={['top', 'left', 'right', 'bottom']}
        style={[styles.screen, { backgroundColor: colors.background }]}
      >
        <View style={styles.scrollContent}>
          <SurfaceSection colors={shellColors} title="Task unavailable">
            <Text style={[styles.bodyText, { color: colors.text }]}>
              This task is hidden or no longer available for the current caller, so cached detail stays suppressed and the shell renders a safe not-found state instead.
            </Text>
            <View style={styles.footerRow}>
              <Pressable
                onPress={() => router.replace('/(app)')}
                style={[styles.navigationButton, { borderColor: colors.border }]}
              >
                <Text style={[styles.navigationButtonText, { color: colors.text }]}>Back to workfeed</Text>
              </Pressable>
            </View>
          </SurfaceSection>
        </View>
      </SafeAreaView>
    )
  }

  if (loadState.phase === 'error' || !shell) {
    return (
      <SafeAreaView
        edges={['top', 'left', 'right', 'bottom']}
        style={[styles.screen, { backgroundColor: colors.background }]}
      >
        <View style={styles.scrollContent}>
          <SurfaceSection colors={shellColors} title="Couldn’t load task detail">
            <Text style={[styles.bodyText, { color: colors.text }]}>
              {loadState.errorMessage ?? 'Unable to load this task right now.'}
            </Text>
            <View style={styles.footerRow}>
              <Pressable
                onPress={() => void loadTask()}
                style={[styles.navigationButton, { borderColor: colors.border }]}
              >
                <Text style={[styles.navigationButtonText, { color: colors.text }]}>Retry</Text>
              </Pressable>
            </View>
          </SurfaceSection>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView
      edges={['top', 'left', 'right', 'bottom']}
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      <ScrollView
        contentContainerStyle={[styles.scrollContent, styles.scrollContentWithDock]}
        refreshControl={(
          <RefreshControl
            onRefresh={() => void loadTask()}
            refreshing={loadState.phase === 'loading' && loadState.source !== 'none'}
            testID="task-detail-refresh"
            tintColor={colors.primary}
          />
        )}
      >
        <View style={styles.headerBlock}>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>MF13 task detail runtime</Text>
          <Text style={[styles.title, { color: colors.text }]}>{shell.title}</Text>
          {shell.bodyLines.map((line) => (
            <Text key={`${shell.id}:${line}`} style={[styles.bodyText, { color: colors.text }]}>
              {line}
            </Text>
          ))}
        </View>

        <View style={styles.chipRow}>
          <MetadataChip colors={shellColors} label={`Status ${shell.status}`} />
          <MetadataChip colors={shellColors} label={`Priority ${shell.priority}`} />
          <MetadataChip colors={shellColors} label={`Due ${formatDueDate(shell.dueDate)}`} />
          <MetadataChip colors={shellColors} label={`Assignee ${shell.assignee ?? 'Unassigned'}`} />
          {shell.site ? <MetadataChip colors={shellColors} label={shell.site} /> : null}
          <MetadataChip colors={shellColors} label={`Source ${loadState.source}`} />
        </View>

        {loadState.source === 'cache' && loadState.errorMessage ? (
          <View style={[styles.banner, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.bannerTitle, { color: colors.primary }]}>Showing validated cache</Text>
            <Text style={[styles.bodyText, { color: colors.text }]}>{loadState.errorMessage}</Text>
          </View>
        ) : activeBanner ? (
          <View style={[styles.banner, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.bannerTitle, { color: activeBanner.tone === 'notice' ? colors.primary : colors.text }]}>
              {activeBanner.title}
            </Text>
            <Text style={[styles.bodyText, { color: colors.text }]}>{activeBanner.message}</Text>
          </View>
        ) : null}

        {shell.comments.visible ? (
          <SurfaceSection colors={shellColors} title="Comments">
            {editingCommentId ? (
              <View style={[styles.rowCard, { borderColor: colors.border }]}>
                <Text style={[styles.rowTitle, { color: colors.text }]}>Edit comment</Text>
                <TextInput
                  multiline
                  onChangeText={setEditingCommentValue}
                  placeholder="Update your task note"
                  placeholderTextColor={`${colors.text}88`}
                  style={[
                    styles.textInput,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                      color: colors.text,
                    },
                  ]}
                  testID="task-comment-edit-input"
                  textAlignVertical="top"
                  value={editingCommentValue}
                />
                {editingCommentVoiceAttachment ? (
                  <View style={styles.voiceCommentStack}>
                    {taskId && playbackAuth ? (
                      <VoiceCommentPlayer
                        colors={shellColors}
                        durationMs={editingCommentVoiceAttachment.durationMs}
                        fileName={editingCommentVoiceAttachment.filename}
                        playbackAuth={playbackAuth}
                        taskId={taskId}
                      />
                    ) : (
                      <Text style={[styles.noteText, { color: colors.text }]}>Voice comment attached.</Text>
                    )}
                    <Text style={[styles.noteText, { color: colors.text }]}>The audio clip stays attached. Delete and re-add the comment to replace the recording.</Text>
                  </View>
                ) : null}
                <View style={styles.inlineActions}>
                  <ActionButton
                    colors={shellColors}
                    disabled={editCommentSubmitDisabled}
                    label={hasLiveConnection ? 'Save edit' : 'Save draft'}
                    onPress={() => {
                      void handleSubmitComment()
                    }}
                    testID="task-comment-edit-submit"
                    tone="primary"
                  />
                  <ActionButton colors={shellColors} label="Cancel" onPress={clearCommentEditor} />
                </View>
                {!hasLiveConnection ? (
                  <Text style={[styles.noteText, { color: colors.text }]}>Saved on this device. Review before sending.</Text>
                ) : null}
              </View>
            ) : shell.comments.canCreate ? (
              <View style={[styles.rowCard, { borderColor: colors.border }]}>
                <Text style={[styles.rowTitle, { color: colors.text }]}>Add comment</Text>
                <TextInput
                  multiline
                  onChangeText={setCommentComposerValue}
                  placeholder="Add a note for this task"
                  placeholderTextColor={`${colors.text}88`}
                  style={[
                    styles.textInput,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                      color: colors.text,
                    },
                  ]}
                  testID="task-comment-input"
                  textAlignVertical="top"
                  value={commentComposerValue}
                />
                {commentVoiceDraft ? (
                  <View style={styles.voiceCommentStack}>
                    <VoiceCommentPlayer
                      colors={shellColors}
                      durationMs={commentVoiceDraft.durationMs}
                      localUri={commentVoiceDraft.uri}
                    />
                    <Text style={[styles.noteText, { color: colors.text }]}>Voice comment ready. The clip stays local until you send this comment.</Text>
                  </View>
                ) : null}
                <View style={styles.inlineActions}>
                  <ActionButton
                    colors={shellColors}
                    disabled={createCommentSubmitDisabled}
                    label={hasLiveConnection ? 'Send comment' : 'Save draft'}
                    onPress={() => {
                      void handleSubmitComment()
                    }}
                    testID="task-comment-submit"
                    tone="primary"
                  />
                  <ActionButton
                    colors={shellColors}
                    disabled={busyActionKey === 'comment:voice:attach' || !hasLiveConnection}
                    label={commentVoiceDraft ? 'Replace voice' : 'Record voice'}
                    onPress={handleOpenVoiceRecorder}
                    testID="task-comment-voice-open"
                  />
                  {commentVoiceDraft ? (
                    <ActionButton
                      colors={shellColors}
                      label="Remove voice"
                      onPress={() => {
                        void discardPendingVoiceDraft()
                      }}
                      testID="task-comment-voice-remove"
                    />
                  ) : null}
                </View>
                {!hasLiveConnection ? (
                  <Text style={[styles.noteText, { color: colors.text }]}>Saved on this device. Review before sending.</Text>
                ) : commentVoiceDraft ? (
                  <Text style={[styles.noteText, { color: colors.text }]}>Voice comments upload when you send the comment.</Text>
                ) : null}
              </View>
            ) : null}

            {commentDrafts.map((draft) => (
              <CommentDraftRow
                key={draft.draftId}
                colors={shellColors}
                discardDisabled={
                  draft.status === 'sending'
                  || busyActionKey === `comment:send:${draft.draftId}`
                }
                draft={draft}
                onDiscard={(draftId) => {
                  void handleDiscardDraft(draftId)
                }}
                onSend={(commentDraft) => {
                  void handleResendCommentDraft(commentDraft)
                }}
                playbackAuth={playbackAuth}
                sendDisabled={!hasLiveConnection || busyActionKey === `comment:send:${draft.draftId}`}
                taskId={taskId}
              />
            ))}

            {shell.comments.items.length === 0 && commentDrafts.length === 0 ? (
              <Text style={[styles.noteText, { color: colors.text }]}>No comments yet.</Text>
            ) : (
              shell.comments.items.map((comment) => (
                <CommentRow
                  key={comment.id}
                  colors={shellColors}
                  deleteDisabled={!hasLiveConnection || busyActionKey === `comment:delete:${comment.id}`}
                  item={comment}
                  onDelete={handleDeleteComment}
                  onEdit={handleStartEditComment}
                  playbackAuth={playbackAuth}
                  pendingUpdate={commentDraftsByCommentId.has(comment.id)}
                  taskId={taskId}
                />
              ))
            )}
          </SurfaceSection>
        ) : null}

        {shell.attachments.visible ? (
          <SurfaceSection colors={shellColors} title="Attachments">
            {shell.attachments.canAdd ? (
              <View style={[styles.rowCard, { borderColor: colors.border }]}>
                <Text style={[styles.rowTitle, { color: colors.text }]}>Add attachment</Text>
                <Text style={[styles.noteText, { color: colors.text }]}>Capture or pick a file, then review before sending.</Text>
                <View style={styles.inlineActions}>
                  <ActionButton
                    colors={shellColors}
                    disabled={busyActionKey?.startsWith('attachment:pick:') ?? false}
                    label="Take photo"
                    onPress={() => {
                      void handleCaptureAttachment('photo')
                    }}
                    tone="primary"
                  />
                  <ActionButton
                    colors={shellColors}
                    disabled={busyActionKey?.startsWith('attachment:pick:') ?? false}
                    label="Scan document"
                    onPress={() => {
                      void handleCaptureAttachment('scan')
                    }}
                  />
                  <ActionButton
                    colors={shellColors}
                    disabled={busyActionKey?.startsWith('attachment:pick:') ?? false}
                    label="Choose file"
                    onPress={() => {
                      void handleCaptureAttachment('file')
                    }}
                  />
                </View>
              </View>
            ) : null}

            {attachmentDrafts.map((draft) => (
              <AttachmentDraftRow
                key={draft.draftId}
                colors={shellColors}
                discardDisabled={
                  draft.status === 'sending'
                  || busyActionKey === `attachment:send:${draft.draftId}`
                }
                draft={draft}
                onDiscard={(draftId) => {
                  void handleDiscardDraft(draftId)
                }}
                onSend={(attachmentDraft) => {
                  void handleSendAttachmentDraft(attachmentDraft)
                }}
                sendDisabled={!hasLiveConnection || busyActionKey === `attachment:send:${draft.draftId}`}
              />
            ))}

            {shell.attachments.items.length === 0 && attachmentDrafts.length === 0 ? (
              <Text style={[styles.noteText, { color: colors.text }]}>No attachments on this task.</Text>
            ) : (
              shell.attachments.items.map((attachment) => (
                <AttachmentRow
                  key={attachment.name}
                  colors={shellColors}
                  item={attachment}
                  onRemove={handleRemoveAttachment}
                  playbackAuth={playbackAuth}
                  removeDisabled={!hasLiveConnection || busyActionKey === `attachment:remove:${attachment.name}`}
                  taskId={taskId}
                  voiceAttachment={linkedVoiceAttachmentsByName.get(attachment.name) ?? null}
                />
              ))
            )}
          </SurfaceSection>
        ) : null}

        {shell.forms.visible ? (
          <SurfaceSection colors={shellColors} title="Forms">
            {formDrafts.map((draft) => (
              <FormDraftRow
                key={draft.draftId}
                colors={shellColors}
                draft={draft}
                onDiscard={(draftId) => {
                  void handleDiscardDraft(draftId)
                }}
                onReview={(formDraft) => {
                  openFormSheet(formDraft.formId)
                }}
                onSend={(formDraft) => {
                  void handleResendFormDraft(formDraft)
                }}
                sendDisabled={!hasLiveConnection || busyActionKey === `form:send:${draft.draftId}`}
                sendVisible={shell.forms.items.some((item) => item.id === draft.formId && item.canSubmit)}
              />
            ))}
            {shell.forms.items.map((form) => (
              <FormRow
                key={form.id}
                colors={shellColors}
                item={form}
                onOpen={form.canSubmit ? () => openFormSheet(form.id) : undefined}
                pendingDraft={formDraftsByFormId.has(form.id)}
              />
            ))}
          </SurfaceSection>
        ) : null}

        {shell.checklist.visible ? (
          <SurfaceSection colors={shellColors} title="Checklist">
            {(shell.checklist.canAdd || editingChecklistIndex !== null) ? (
              <View style={[styles.rowCard, { borderColor: colors.border }]}>
                <Text style={[styles.rowTitle, { color: colors.text }]}>
                  {editingChecklistIndex === null ? 'Add checklist item' : 'Edit checklist item'}
                </Text>
                <TextInput
                  multiline
                  onChangeText={setChecklistComposerValue}
                  placeholder={editingChecklistIndex === null ? 'Add a checklist item' : 'Update this checklist item'}
                  placeholderTextColor={`${colors.text}88`}
                  style={[
                    styles.textInput,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                      color: colors.text,
                    },
                  ]}
                  testID="task-checklist-input"
                  textAlignVertical="top"
                  value={checklistComposerValue}
                />
                <View style={styles.inlineActions}>
                  <ActionButton
                    colors={shellColors}
                    disabled={
                      checklistComposerValue.trim().length === 0
                      || (
                        editingChecklistIndex === null
                          ? busyActionKey === 'checklist:add'
                          : busyActionKey === `checklist:edit:${editingChecklistIndex}`
                      )
                    }
                    label={
                      hasLiveConnection
                        ? editingChecklistIndex === null
                          ? 'Add item'
                          : 'Save item'
                        : 'Save draft'
                    }
                    onPress={() => {
                      void handleSubmitChecklist()
                    }}
                    testID="task-checklist-submit"
                    tone="primary"
                  />
                  {editingChecklistIndex !== null ? (
                    <ActionButton colors={shellColors} label="Cancel" onPress={clearChecklistEditor} />
                  ) : null}
                </View>
                {!hasLiveConnection ? (
                  <Text style={[styles.noteText, { color: colors.text }]}>Checklist change saved locally until you explicitly resend it.</Text>
                ) : null}
              </View>
            ) : null}

            {checklistDrafts.map((draft) => (
              <ChecklistDraftRow
                key={draft.draftId}
                colors={shellColors}
                draft={draft}
                onDiscard={(draftId) => {
                  void handleDiscardDraft(draftId)
                }}
                onReviewLatest={() => {
                  void handleReviewChecklistDraft()
                }}
                onSend={(checklistDraft) => {
                  void handleResendChecklistDraft(checklistDraft)
                }}
                sendDisabled={!hasLiveConnection || busyActionKey === `checklist:send:${draft.draftId}`}
              />
            ))}

            {shell.checklist.items.length === 0 && checklistDrafts.length === 0 ? (
              <Text style={[styles.noteText, { color: colors.text }]}>Checklist is visible but empty.</Text>
            ) : (
              shell.checklist.items.map((item) => (
                <ChecklistRow
                  key={`${shell.id}:checklist:${item.index}`}
                  colors={shellColors}
                  item={item}
                  onDelete={handleDeleteChecklistItem}
                  onEdit={handleOpenChecklistEdit}
                  onToggle={handleToggleChecklistItem}
                  pendingDraft={checklistDraftsByItemIndex.get(item.index) ?? null}
                  toggleBusy={
                    busyActionKey === `checklist:${item.toggleAction}:${item.index}`
                    || busyActionKey === `checklist:delete:${item.index}`
                    || busyActionKey === `checklist:edit:${item.index}`
                  }
                />
              ))
            )}
          </SurfaceSection>
        ) : null}

        {shell.actions.visible ? (
          <SurfaceSection colors={shellColors} title="Actions">
            {shell.actions.items.map((action) => (
              <ActionRow
                key={action.key}
                colors={shellColors}
                disabled={!hasLiveConnection || busyActionKey === `card-action:${action.key}`}
                item={action}
                onPress={(actionItem) => {
                  void handleTriggerCardAction(actionItem)
                }}
              />
            ))}
          </SurfaceSection>
        ) : null}

        <View style={styles.footerRow}>
          <Pressable
            onPress={() => router.replace('/(app)')}
            style={[styles.navigationButton, { borderColor: colors.border }]}
          >
            <Text style={[styles.navigationButtonText, { color: colors.text }]}>Back to workfeed</Text>
          </Pressable>
        </View>
      </ScrollView>
      <StickyActionDock
        colors={shellColors}
        onPrimaryActionPress={handlePrimaryDockAction}
        primaryActionDisabled={primaryActionDisabled}
        primaryActionNote={primaryActionNote}
        primaryAction={shell.primaryAction}
        secondaryActions={shell.secondaryActions}
      />
      {activeForm ? (
        <FormSheet
          colors={shellColors}
          draftData={formDraftsByFormId.get(activeForm.id)?.data ?? null}
          errorMessage={formSheetErrorMessage}
          form={activeForm}
          hasLiveConnection={hasLiveConnection}
          onClose={closeFormSheet}
          onSubmit={(data) => {
            void handleSubmitForm({
              data,
              formId: activeForm.id,
            })
          }}
          submitting={busyActionKey === `form:submit:${activeForm.id}`}
        />
      ) : null}
      {voiceRecorderVisible ? (
        <VoiceCommentRecorderSheet
          colors={shellColors}
          onAttach={(clip) => {
            void handleAttachVoiceComment(clip)
          }}
          onClose={() => {
            setVoiceRecorderVisible(false)
          }}
        />
      ) : null}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  actionButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  actionDock: {
    borderTopWidth: 1,
    gap: 12,
    paddingBottom: 16,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  actionDockPrimary: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  actionDockPrimaryText: {
    fontSize: 16,
    fontWeight: '700',
  },
  actionDockSecondaryBlock: {
    gap: 4,
  },
  actionDockSecondaryText: {
    fontSize: 13,
    lineHeight: 18,
    opacity: 0.82,
  },
  actionDockSecondaryTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  banner: {
    borderRadius: 20,
    borderWidth: 1,
    gap: 8,
    padding: 18,
  },
  bannerTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  bodyText: {
    fontSize: 15,
    lineHeight: 22,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  eyebrow: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  footerRow: {
    marginTop: 8,
  },
  formSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    gap: 16,
    maxHeight: '88%',
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 20,
  },
  formSheetBackdrop: {
    backgroundColor: 'rgba(3, 8, 20, 0.68)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  formSheetContent: {
    gap: 12,
    paddingBottom: 20,
  },
  formSheetFooter: {
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 12,
    paddingTop: 14,
  },
  formSummaryList: {
    gap: 4,
  },
  headerBlock: {
    gap: 10,
  },
  inlineActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  navigationButton: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  navigationButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  neutralBody: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  neutralShell: {
    alignItems: 'center',
    borderRadius: 24,
    borderWidth: 1,
    gap: 14,
    margin: 24,
    padding: 24,
  },
  neutralTitle: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  noteText: {
    fontSize: 14,
    lineHeight: 20,
  },
  rowCard: {
    borderRadius: 16,
    borderWidth: 1,
    gap: 8,
    padding: 14,
  },
  rowMeta: {
    fontSize: 13,
    opacity: 0.8,
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  screen: {
    flex: 1,
  },
  scrollContent: {
    gap: 16,
    padding: 20,
  },
  scrollContentWithDock: {
    paddingBottom: 24,
  },
  section: {
    borderRadius: 24,
    borderWidth: 1,
    gap: 14,
    padding: 18,
  },
  sectionTitle: {
    fontSize: 19,
    fontWeight: '700',
  },
  textInput: {
    borderRadius: 16,
    borderWidth: 1,
    fontSize: 15,
    lineHeight: 22,
    minHeight: 120,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  title: {
    fontSize: 30,
    fontWeight: '800',
    lineHeight: 36,
  },
  voiceCommentStack: {
    gap: 10,
  },
})
