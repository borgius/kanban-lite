import type { Priority } from '../shared/types'

export interface CreateCardInput {
  content: string
  status?: string
  priority?: Priority
  assignee?: string | null
  dueDate?: string | null
  labels?: string[]
  attachments?: string[]
  boardId?: string
}
