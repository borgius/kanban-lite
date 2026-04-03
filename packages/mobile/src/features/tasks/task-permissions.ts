import { MobileApiClientError } from '../../lib/api/client'
import type {
  JsonObject,
  MobileTaskDetail,
  MobileTaskPriority,
} from '../../lib/api/contracts'
import type { MobileCacheSnapshots } from '../sync/cache-store'

export interface TaskDetailCommentShellItem {
  author: string
  canDelete: boolean
  canUpdate: boolean
  content: string
  created: string
  id: string
}

export interface TaskDetailAttachmentShellItem {
  canRemove: boolean
  name: string
}

export interface TaskDetailFormShellItem {
  canSubmit: boolean
  description?: string
  fieldCount: number
  fromConfig: boolean
  id: string
  initialData: JsonObject
  label: string
  schema: JsonObject
}

export interface TaskDetailChecklistShellItem {
  canDelete: boolean
  canEdit: boolean
  canToggle: boolean
  checked: boolean
  index: number
  raw: string
  text: string
  toggleAction: 'check' | 'uncheck'
}

export interface TaskDetailActionShellItem {
  canTrigger: true
  key: string
  label: string
}

export interface TaskDetailDockAction {
  kind: 'attachment' | 'card-action' | 'checklist' | 'comment' | 'form'
  key: string
  label: string
}

export interface TaskDetailShellModel {
  actions: {
    hasTriggers: boolean
    items: TaskDetailActionShellItem[]
    visible: boolean
  }
  assignee: string | null
  attachments: {
    canAdd: boolean
    items: TaskDetailAttachmentShellItem[]
    visible: boolean
  }
  bodyLines: string[]
  checklist: {
    canAdd: boolean
    canDelete: boolean
    canEdit: boolean
    items: TaskDetailChecklistShellItem[]
    visible: boolean
  }
  comments: {
    canCreate: boolean
    items: TaskDetailCommentShellItem[]
    visible: boolean
  }
  dueDate: string | null
  forms: {
    hasSubmitControls: boolean
    items: TaskDetailFormShellItem[]
    visible: boolean
  }
  id: string
  primaryAction: TaskDetailDockAction | null
  priority: MobileTaskPriority
  secondaryActions: TaskDetailDockAction[]
  site: string | null
  status: string
  title: string
}

function extractTitle(content: string): string {
  const lines = content.split(/\r?\n/)

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }

    const heading = trimmed.match(/^#+\s+(.*)$/)
    if (heading?.[1]) {
      return heading[1].trim()
    }

    return trimmed
  }

  return 'Untitled task'
}

function extractBodyLines(content: string): string[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (lines.length === 0) {
    return []
  }

  const [first, ...rest] = lines
  const bodyLines = /^#+\s+/.test(first) ? rest : lines.slice(1)
  return bodyLines.slice(0, 3)
}

function extractSite(metadata: MobileTaskDetail['metadata']): string | null {
  const site = metadata?.site
  return typeof site === 'string' && site.trim().length > 0 ? site.trim() : null
}

function countSchemaFields(schema: JsonObject): number {
  const properties = schema.properties
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    return 0
  }

  return Object.keys(properties).length
}

function parseChecklistItems(task: MobileTaskDetail): TaskDetailChecklistShellItem[] {
  if (!task.permissions.checklist.show) {
    return []
  }

  const lines = task.tasks ?? []
  const items: TaskDetailChecklistShellItem[] = []

  for (const line of lines) {
    const match = line.match(/^- \[([ xX])\]\s+(.*)$/)
    if (!match) {
      continue
    }

    const checked = match[1]?.toLowerCase() === 'x'
    const index = items.length
    items.push({
      canDelete: task.permissions.checklist.delete,
      canEdit: task.permissions.checklist.edit,
      canToggle: checked
        ? task.permissions.checklist.uncheck
        : task.permissions.checklist.check,
      checked,
      index,
      raw: line,
      text: match[2]?.trim() ?? '',
      toggleAction: checked ? 'uncheck' : 'check',
    })
  }

  return items
}

function toActionEntries(task: MobileTaskDetail): Array<{ key: string, label: string }> {
  if (Array.isArray(task.actions)) {
    return task.actions.map((action) => ({
      key: action,
      label: action,
    }))
  }

  if (!task.actions || typeof task.actions !== 'object') {
    return []
  }

  return Object.entries(task.actions).map(([key, value]) => ({
    key,
    label: typeof value === 'string' && value.trim().length > 0 ? value.trim() : key,
  }))
}

function createDockActions(input: {
  actionItems: TaskDetailActionShellItem[]
  attachmentCanAdd: boolean
  checklistCanAdd: boolean
  checklistItems: TaskDetailChecklistShellItem[]
  commentCanCreate: boolean
  formItems: TaskDetailFormShellItem[]
}): {
  primaryAction: TaskDetailDockAction | null
  secondaryActions: TaskDetailDockAction[]
} {
  const candidates: TaskDetailDockAction[] = []
  const firstSubmittableForm = input.formItems.find((form) => form.canSubmit)

  if (firstSubmittableForm) {
    candidates.push({
      kind: 'form',
      key: `form:${firstSubmittableForm.id}`,
      label: 'Submit form',
    })
  }

  if (
    input.checklistCanAdd
    || input.checklistItems.some((item) => item.canToggle || item.canEdit || item.canDelete)
  ) {
    candidates.push({
      kind: 'checklist',
      key: 'checklist:update',
      label: input.checklistCanAdd ? 'Add checklist item' : 'Update checklist',
    })
  }

  if (input.attachmentCanAdd) {
    candidates.push({
      kind: 'attachment',
      key: 'attachment:take-photo',
      label: 'Take photo',
    })
  }

  if (input.commentCanCreate) {
    candidates.push({
      kind: 'comment',
      key: 'comment:add',
      label: 'Add comment',
    })
  }

  candidates.push(
    ...input.actionItems.map((action) => ({
      kind: 'card-action' as const,
      key: `card-action:${action.key}`,
      label: action.label,
    })),
  )

  return {
    primaryAction: candidates[0] ?? null,
    secondaryActions: candidates.slice(1),
  }
}

export function buildTaskDetailShellModel(task: MobileTaskDetail): TaskDetailShellModel {
  const commentItems = task.comments.map((comment) => ({
    author: comment.author,
    canDelete:
      task.permissions.comment.byId?.[comment.id]?.delete
      ?? task.permissions.comment.delete,
    canUpdate:
      task.permissions.comment.byId?.[comment.id]?.update
      ?? task.permissions.comment.update,
    content: comment.content,
    created: comment.created,
    id: comment.id,
  }))

  const attachmentItems = task.attachments.map((name) => ({
    canRemove:
      task.permissions.attachment.byName?.[name]?.remove
      ?? task.permissions.attachment.remove,
    name,
  }))

  const formItems = task.resolvedForms.map((form) => ({
    canSubmit: task.permissions.form.byId?.[form.id]?.submit ?? task.permissions.form.submit,
    description: form.description,
    fieldCount: countSchemaFields(form.schema),
    fromConfig: form.fromConfig,
    id: form.id,
    initialData: form.initialData,
    label: form.label,
    schema: form.schema,
  }))

  const checklistItems = parseChecklistItems(task)
  const actionItems = toActionEntries(task)
    .filter((action) => (task.permissions.cardAction.byKey?.[action.key]?.trigger ?? task.permissions.cardAction.trigger))
    .map((action) => ({
      canTrigger: true as const,
      key: action.key,
      label: action.label,
    }))
  const dockActions = createDockActions({
    actionItems,
    attachmentCanAdd: task.permissions.attachment.add,
    checklistCanAdd: task.permissions.checklist.add,
    checklistItems,
    commentCanCreate: task.permissions.comment.create,
    formItems,
  })

  return {
    actions: {
      hasTriggers: actionItems.length > 0,
      items: actionItems,
      visible: actionItems.length > 0,
    },
    assignee: task.assignee,
    attachments: {
      canAdd: task.permissions.attachment.add,
      items: attachmentItems,
      visible: attachmentItems.length > 0 || task.permissions.attachment.add,
    },
    bodyLines: extractBodyLines(task.content),
    checklist: {
      canAdd: task.permissions.checklist.add,
      canDelete: task.permissions.checklist.delete,
      canEdit: task.permissions.checklist.edit,
      items: checklistItems,
      visible: task.permissions.checklist.show,
    },
    comments: {
      canCreate: task.permissions.comment.create,
      items: commentItems,
      visible: commentItems.length > 0 || task.permissions.comment.create,
    },
    dueDate: task.dueDate,
    forms: {
      hasSubmitControls: formItems.some((form) => form.canSubmit),
      items: formItems,
      visible: formItems.length > 0,
    },
    id: task.id,
    primaryAction: dockActions.primaryAction,
    priority: task.priority,
    secondaryActions: dockActions.secondaryActions,
    site: extractSite(task.metadata),
    status: task.status,
    title: extractTitle(task.content),
  }
}

export function readCachedTaskDetailSnapshot(
  snapshots: MobileCacheSnapshots | undefined,
  input: {
    taskId: string
    workspaceId: string
  },
): MobileTaskDetail | null {
  const snapshot = snapshots?.taskDetails?.[input.taskId]

  if (!snapshot) {
    return null
  }

  if (snapshot.workspaceId !== input.workspaceId) {
    return null
  }

  if (snapshot.task.id !== input.taskId) {
    return null
  }

  return snapshot.task
}

export function isTaskUnavailableError(error: unknown): boolean {
  return error instanceof MobileApiClientError && error.status === 404
}

export function isProtectedTaskAccessError(error: unknown): error is MobileApiClientError {
  return error instanceof MobileApiClientError && (error.status === 401 || error.status === 403)
}

export function canUseTaskDetailCacheFallback(error: unknown): boolean {
  return !isTaskUnavailableError(error) && !isProtectedTaskAccessError(error)
}