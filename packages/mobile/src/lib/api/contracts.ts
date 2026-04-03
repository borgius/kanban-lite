export type JsonPrimitive = boolean | null | number | string
export type JsonValue = JsonObject | JsonPrimitive | JsonValue[]
export interface JsonObject {
  [key: string]: JsonValue | undefined
}

export type MobileTaskPriority = 'critical' | 'high' | 'medium' | 'low'

export interface MobileCardStateCursor extends JsonObject {
  cursor: string
  updatedAt?: string
}

export interface MobileCardOpenStateValue extends JsonObject {
  openedAt: string
  readThrough: MobileCardStateCursor | null
}

export interface MobileCardStateRecord<TValue extends JsonValue = JsonObject> extends JsonObject {
  actorId: string
  boardId: string
  cardId: string
  domain: string
  value: TValue
  updatedAt: string
}

export interface MobileCardUnreadSummary extends JsonObject {
  actorId: string
  boardId: string
  cardId: string
  latestActivity: MobileCardStateCursor | null
  readThrough: MobileCardStateCursor | null
  unread: boolean
}

export interface MobileCardStateStatus extends JsonObject {
  backend: 'builtin' | 'external' | 'none'
  availability: 'available' | 'identity-unavailable' | 'unavailable'
  configured: boolean
  errorCode?: string
}

export interface MobileCardStateError extends JsonObject {
  code: string
  availability: 'identity-unavailable' | 'unavailable'
  message: string
}

export interface MobileCardStateReadModel extends JsonObject {
  unread: MobileCardUnreadSummary | null
  open: MobileCardStateRecord<MobileCardOpenStateValue> | null
  status: MobileCardStateStatus
  error?: MobileCardStateError
}

export interface MobileCardStateMutation extends JsonObject {
  unread: MobileCardUnreadSummary
  cardState: MobileCardStateReadModel
}

export interface MobileCommentReadModel extends JsonObject {
  id: string
  author: string
  created: string
  content: string
  streaming?: boolean
}

export interface MobileCardFormAttachment extends JsonObject {
  name?: string
  schema?: JsonObject
  ui?: JsonObject
  data?: JsonObject
}

export type MobileFormDataMap = Record<string, JsonObject>

export interface MobileResolvedFormDescriptor extends JsonObject {
  id: string
  name?: string
  description?: string
  label: string
  schema: JsonObject
  ui?: JsonObject
  initialData: JsonObject
  fromConfig: boolean
}

export interface MobileTaskCommentPermissionRecord extends JsonObject {
  update: boolean
  delete: boolean
}

export interface MobileTaskCommentPermissions extends JsonObject {
  create: boolean
  update: boolean
  delete: boolean
  byId?: Record<string, MobileTaskCommentPermissionRecord>
}

export interface MobileTaskAttachmentPermissionRecord extends JsonObject {
  remove: boolean
}

export interface MobileTaskAttachmentPermissions extends JsonObject {
  add: boolean
  remove: boolean
  byName?: Record<string, MobileTaskAttachmentPermissionRecord>
}

export interface MobileTaskFormPermissionRecord extends JsonObject {
  submit: boolean
}

export interface MobileTaskFormPermissions extends JsonObject {
  submit: boolean
  byId?: Record<string, MobileTaskFormPermissionRecord>
}

export interface MobileTaskChecklistPermissions extends JsonObject {
  show: boolean
  add: boolean
  edit: boolean
  delete: boolean
  check: boolean
  uncheck: boolean
}

export interface MobileTaskCardActionPermissionRecord extends JsonObject {
  trigger: boolean
}

export interface MobileTaskCardActionPermissions extends JsonObject {
  trigger: boolean
  byKey?: Record<string, MobileTaskCardActionPermissionRecord>
}

export interface MobileTaskPermissions extends JsonObject {
  comment: MobileTaskCommentPermissions
  attachment: MobileTaskAttachmentPermissions
  form: MobileTaskFormPermissions
  checklist: MobileTaskChecklistPermissions
  cardAction: MobileTaskCardActionPermissions
}

export interface MobileTaskListItem extends JsonObject {
  version: number
  id: string
  boardId?: string
  status: string
  priority: MobileTaskPriority
  assignee: string | null
  dueDate: string | null
  created: string
  modified: string
  completedAt: string | null
  labels: string[]
  attachments: string[]
  tasks?: string[]
  comments: MobileCommentReadModel[]
  order: string
  content: string
  metadata?: JsonObject
  actions?: string[] | Record<string, string>
  forms?: MobileCardFormAttachment[]
  formData?: MobileFormDataMap
  cardState: MobileCardStateReadModel
  permissions: MobileTaskPermissions
}

export interface MobileTaskDetail extends MobileTaskListItem {
  resolvedForms: MobileResolvedFormDescriptor[]
}

export interface MobileChecklistStats extends JsonObject {
  total: number
  completed: number
  incomplete: number
}

export interface MobileChecklistItemReadModel extends JsonObject {
  index: number
  raw: string
  expectedRaw: string
  checked: boolean
  text: string
}

export interface MobileChecklistReadModel extends JsonObject {
  cardId: string
  boardId: string
  token: string
  summary: MobileChecklistStats
  items: MobileChecklistItemReadModel[]
}

export interface MobileHomeSnapshot extends JsonObject {
  workspaceId: string
  totalVisibleTasks: number
  tasks?: MobileTaskListItem[]
  activeTaskId?: string | null
}

export interface MobileTaskDetailSnapshot extends JsonObject {
  workspaceId: string
  task: MobileTaskDetail
}

export type MobileCacheSnapshots = Record<string, JsonValue | undefined> & {
  home?: MobileHomeSnapshot
  taskDetails?: Record<string, MobileTaskDetailSnapshot>
}
