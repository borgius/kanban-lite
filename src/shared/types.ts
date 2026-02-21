// Kanban types

export type Priority = 'critical' | 'high' | 'medium' | 'low'
export type FeatureStatus = 'backlog' | 'todo' | 'in-progress' | 'review' | 'done'

export interface Comment {
  id: string
  author: string
  created: string
  content: string
}

export interface Feature {
  id: string
  status: FeatureStatus
  priority: Priority
  assignee: string | null
  dueDate: string | null
  created: string
  modified: string
  completedAt: string | null
  labels: string[]
  attachments: string[]
  comments: Comment[]
  order: string
  content: string
  filePath: string
}

// Parse title from the first # heading in markdown content, falling back to the first line
export function getTitleFromContent(content: string): string {
  const match = content.match(/^#\s+(.+)$/m)
  if (match) return match[1].trim()
  const firstLine = content.split('\n').map(l => l.trim()).find(l => l.length > 0)
  return firstLine || 'Untitled'
}

// Generate a filename-safe slug from a title
export function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single
    .replace(/^-|-$/g, '') // Trim hyphens from start/end
    .slice(0, 50) || 'feature' // Limit length, fallback
}

// Generate a filename from an incremental ID and a title
export function generateFeatureFilename(id: number, title: string): string {
  const slug = generateSlug(title)
  return `${id}-${slug}`
}

// Extract the numeric ID prefix from a filename or ID string like "42-build-dashboard"
export function extractNumericId(filenameOrId: string): number | null {
  const match = filenameOrId.match(/^(\d+)(?:-|$)/)
  return match ? parseInt(match[1], 10) : null
}

export interface KanbanColumn {
  id: string
  name: string
  color: string
}

export const DEFAULT_COLUMNS: KanbanColumn[] = [
  { id: 'backlog', name: 'Backlog', color: '#6b7280' },
  { id: 'todo', name: 'To Do', color: '#3b82f6' },
  { id: 'in-progress', name: 'In Progress', color: '#f59e0b' },
  { id: 'review', name: 'Review', color: '#8b5cf6' },
  { id: 'done', name: 'Done', color: '#22c55e' }
]

export interface CardDisplaySettings {
  showPriorityBadges: boolean
  showAssignee: boolean
  showDueDate: boolean
  showLabels: boolean
  showBuildWithAI: boolean
  showFileName: boolean
  compactMode: boolean
  markdownEditorMode: boolean
  defaultPriority: Priority
  defaultStatus: FeatureStatus
}

// Messages between extension and webview
export type ExtensionMessage =
  | { type: 'init'; features: Feature[]; columns: KanbanColumn[]; settings: CardDisplaySettings }
  | { type: 'featuresUpdated'; features: Feature[] }
  | { type: 'triggerCreateDialog' }
  | { type: 'featureContent'; featureId: string; content: string; frontmatter: FeatureFrontmatter; comments: Comment[] }
  | { type: 'showSettings'; settings: CardDisplaySettings }

// Frontmatter for editing
export interface FeatureFrontmatter {
  id: string
  status: FeatureStatus
  priority: Priority
  assignee: string | null
  dueDate: string | null
  created: string
  modified: string
  completedAt: string | null
  labels: string[]
  attachments: string[]
  order: string
}

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'createFeature'; data: { status: FeatureStatus; priority: Priority; content: string; assignee: string | null; dueDate: string | null; labels: string[] } }
  | { type: 'moveFeature'; featureId: string; newStatus: string; newOrder: number }
  | { type: 'deleteFeature'; featureId: string }
  | { type: 'updateFeature'; featureId: string; updates: Partial<Feature> }
  | { type: 'openFeature'; featureId: string }
  | { type: 'saveFeatureContent'; featureId: string; content: string; frontmatter: FeatureFrontmatter }
  | { type: 'closeFeature' }
  | { type: 'openFile'; featureId: string }
  | { type: 'addAttachment'; featureId: string }
  | { type: 'openAttachment'; featureId: string; attachment: string }
  | { type: 'removeAttachment'; featureId: string; attachment: string }
  | { type: 'openSettings' }
  | { type: 'saveSettings'; settings: CardDisplaySettings }
  | { type: 'addColumn'; column: { name: string; color: string } }
  | { type: 'editColumn'; columnId: string; updates: { name: string; color: string } }
  | { type: 'removeColumn'; columnId: string }
  | { type: 'addComment'; featureId: string; author: string; content: string }
  | { type: 'updateComment'; featureId: string; commentId: string; content: string }
  | { type: 'deleteComment'; featureId: string; commentId: string }
