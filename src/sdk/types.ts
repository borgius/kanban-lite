import type { FeatureStatus, KanbanColumn, Priority } from '../shared/types'

export interface CreateCardInput {
  content: string
  status?: FeatureStatus
  priority?: Priority
  assignee?: string | null
  dueDate?: string | null
  labels?: string[]
  attachments?: string[]
}

export interface BoardConfig {
  columns: KanbanColumn[]
}
