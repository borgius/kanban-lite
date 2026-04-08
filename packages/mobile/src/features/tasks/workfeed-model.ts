import type { MobileHomeSnapshot } from '../../lib/api/contracts'
import {
  type MobileApiClient,
  type MobileTaskListItem,
  type MobileTaskPermissions,
} from '../../lib/api/client'
import { type MobileTaskPriority } from '../../lib/api/contracts'
import { type CacheStore } from '../sync/cache-store'
import { type AuthSessionState, type MobileSessionStorage } from '../auth/session-store'

export type VisibleWorkfeedPhase = 'blocked' | 'empty' | 'error' | 'loading' | 'ready'
export type VisibleWorkfeedSource = 'cache' | 'live' | 'none'
export type DueBucket = 'next' | 'none' | 'overdue' | 'today'
export type LandingStatus = 'blocked' | 'none' | 'ready' | 'unavailable'

export interface VisibleChecklistPreview {
  completed: number
  incomplete: number
  total: number
}

export interface VisibleTaskPreview {
  assignee: string | null
  dueBucket: DueBucket
  dueDate: string | null
  id: string
  modified: string
  permissions: MobileTaskPermissions
  preview: {
    attachments: number
    checklist: VisibleChecklistPreview | null
    comments: number
    forms: number
  }
  priority: MobileTaskPriority
  site: string | null
  status: string
  title: string
  unread: boolean
}

export interface VisibleWorkfeedSection {
  count: number
  key: string
  tasks: VisibleTaskPreview[]
  title: string
}

export interface VisibleWorkfeedCounts {
  dueNext: number
  dueNow: number
  dueToday: number
  needsAttention: number
  overdue: number
  recentlyUpdated: number
  totalVisibleTasks: number
  upNext: number
}

export interface VisibleWorkfeedModel {
  counts: VisibleWorkfeedCounts
  due: {
    sections: VisibleWorkfeedSection[]
  }
  errorMessage: string | null
  landing: {
    activeTaskId: string | null
    pendingTarget: string | null
    requestedTaskId: string | null
    status: LandingStatus
  }
  myWork: {
    sections: VisibleWorkfeedSection[]
  }
  phase: VisibleWorkfeedPhase
  source: VisibleWorkfeedSource
  tasks: VisibleTaskPreview[]
  workspaceId: string | null
}

export interface BuildVisibleWorkfeedInput {
  errorMessage?: string | null
  now?: Date
  pendingTarget?: string | null
  phase?: VisibleWorkfeedPhase
  protectedReady: boolean
  source?: VisibleWorkfeedSource
  tasks: MobileTaskListItem[]
  workspaceId: string | null
}

export interface CreateVisibleHomeSnapshotInput {
  pendingTarget?: string | null
  tasks: MobileTaskListItem[]
  workspaceId: string
}

export interface UseVisibleWorkfeedOptions {
  authState: Pick<
    AuthSessionState,
    'isProtectedReady' | 'pendingTarget' | 'phase' | 'sessionStatus'
  >
  cacheStore?: CacheStore
  createClient?: (input: { token: string; workspaceOrigin: string }) => MobileApiClient
  now?: () => Date
  onProtectedError?: (status: 401 | 403) => Promise<void> | void
  sessionStorage?: MobileSessionStorage
}

export interface UseVisibleWorkfeedResult extends VisibleWorkfeedModel {
  reload: () => Promise<void>
}

export interface WorkfeedLoadState {
  errorMessage: string | null
  phase: VisibleWorkfeedPhase
  source: VisibleWorkfeedSource
  tasks: MobileTaskListItem[]
}

function createEmptyCounts(): VisibleWorkfeedCounts {
  return {
    dueNext: 0,
    dueNow: 0,
    dueToday: 0,
    needsAttention: 0,
    overdue: 0,
    recentlyUpdated: 0,
    totalVisibleTasks: 0,
    upNext: 0,
  }
}

function createBlockedModel(input: BuildVisibleWorkfeedInput): VisibleWorkfeedModel {
  const requestedTaskId = resolvePendingTaskId(input.pendingTarget ?? null)

  return {
    counts: createEmptyCounts(),
    due: { sections: [] },
    errorMessage: input.errorMessage ?? null,
    landing: {
      activeTaskId: null,
      pendingTarget: input.pendingTarget ?? null,
      requestedTaskId,
      status: 'blocked',
    },
    myWork: { sections: [] },
    phase: 'blocked',
    source: input.source ?? 'none',
    tasks: [],
    workspaceId: input.workspaceId,
  }
}

function createSection(
  key: string,
  title: string,
  tasks: VisibleTaskPreview[],
): VisibleWorkfeedSection | null {
  if (tasks.length === 0) {
    return null
  }

  return {
    count: tasks.length,
    key,
    tasks,
    title,
  }
}

function resolvePendingTaskId(pendingTarget: string | null): string | null {
  const trimmed = pendingTarget?.trim() ?? ''
  if (!trimmed) {
    return null
  }

  const match = trimmed.match(/\/(?:cards|tasks)\/([^/?#]+)/i)
  if (!match?.[1]) {
    return null
  }

  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function dueBucketFor(task: MobileTaskListItem, today: string): DueBucket {
  if (!task.dueDate) {
    return 'none'
  }

  if (task.dueDate < today) {
    return 'overdue'
  }

  if (task.dueDate === today) {
    return 'today'
  }

  return 'next'
}

function dueRank(bucket: DueBucket): number {
  switch (bucket) {
    case 'overdue':
      return 0
    case 'today':
      return 1
    case 'next':
      return 2
    case 'none':
    default:
      return 3
  }
}

function compareIsoDescending(left: string, right: string): number {
  if (left === right) {
    return 0
  }

  return left > right ? -1 : 1
}

function compareByDueUrgency(left: VisibleTaskPreview, right: VisibleTaskPreview): number {
  const bucketDifference = dueRank(left.dueBucket) - dueRank(right.dueBucket)
  if (bucketDifference !== 0) {
    return bucketDifference
  }

  const leftDue = left.dueDate ?? '9999-12-31'
  const rightDue = right.dueDate ?? '9999-12-31'
  if (leftDue !== rightDue) {
    return leftDue.localeCompare(rightDue)
  }

  return compareIsoDescending(left.modified, right.modified)
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

function extractSite(metadata: MobileTaskListItem['metadata']): string | null {
  const site = metadata?.site
  return typeof site === 'string' && site.trim().length > 0 ? site.trim() : null
}

function toChecklistPreview(task: MobileTaskListItem): VisibleChecklistPreview | null {
  if (!task.permissions.checklist.show) {
    return null
  }

  const checklistLines = (task.tasks ?? []).filter((line) => /^- \[[ xX]\]\s+/.test(line))
  if (checklistLines.length === 0) {
    return null
  }

  const completed = checklistLines.filter((line) => /^- \[[xX]\]\s+/.test(line)).length
  const total = checklistLines.length

  return {
    completed,
    incomplete: total - completed,
    total,
  }
}

function countForms(task: MobileTaskListItem): number {
  const formCount = task.forms?.length ?? 0
  const formDataCount = task.formData ? Object.keys(task.formData).length : 0
  return Math.max(formCount, formDataCount)
}

function toTaskPreview(task: MobileTaskListItem, today: string): VisibleTaskPreview {
  return {
    assignee: task.assignee,
    dueBucket: dueBucketFor(task, today),
    dueDate: task.dueDate,
    id: task.id,
    modified: task.modified,
    permissions: task.permissions,
    preview: {
      attachments: task.attachments.length,
      checklist: toChecklistPreview(task),
      comments: task.comments.length,
      forms: countForms(task),
    },
    priority: task.priority,
    site: extractSite(task.metadata),
    status: task.status,
    title: extractTitle(task.content),
    unread: task.cardState.unread?.unread === true,
  }
}

function createCounts(tasks: VisibleTaskPreview[]): VisibleWorkfeedCounts {
  const overdue = tasks.filter((task) => task.dueBucket === 'overdue').length
  const dueToday = tasks.filter((task) => task.dueBucket === 'today').length
  const dueNext = tasks.filter((task) => task.dueBucket === 'next').length
  const needsAttention = tasks.filter((task) => task.unread).length
  const upNext = tasks.filter(
    (task) => task.dueBucket === 'next' || task.dueBucket === 'none',
  ).length

  return {
    dueNext,
    dueNow: overdue + dueToday,
    dueToday,
    needsAttention,
    overdue,
    recentlyUpdated: Math.min(tasks.length, 3),
    totalVisibleTasks: tasks.length,
    upNext,
  }
}

export function createVisibleHomeSnapshot(
  input: CreateVisibleHomeSnapshotInput,
): MobileHomeSnapshot {
  return {
    activeTaskId: resolvePendingTaskId(input.pendingTarget ?? null)
      ? input.tasks.some(
          (task) => task.id === resolvePendingTaskId(input.pendingTarget ?? null),
        )
        ? resolvePendingTaskId(input.pendingTarget ?? null)
        : null
      : null,
    tasks: input.tasks,
    totalVisibleTasks: input.tasks.length,
    workspaceId: input.workspaceId,
  }
}

export function buildVisibleWorkfeedModel(
  input: BuildVisibleWorkfeedInput,
): VisibleWorkfeedModel {
  if (!input.protectedReady || input.phase === 'blocked') {
    return createBlockedModel(input)
  }

  const today = toDateOnly(input.now ?? new Date())
  const tasks = input.tasks.map((task) => toTaskPreview(task, today))
  const source = input.source ?? 'live'
  const requestedTaskId = resolvePendingTaskId(input.pendingTarget ?? null)
  const landingConfirmedByLiveData = source === 'live' && input.phase !== 'loading'
  const activeTaskId =
    landingConfirmedByLiveData && requestedTaskId
      ? tasks.find((task) => task.id === requestedTaskId)?.id ?? null
      : null

  const needsAttentionTasks = [...tasks]
    .filter((task) => task.unread)
    .sort(compareByDueUrgency)
  const dueNowTasks = [...tasks]
    .filter((task) => task.dueBucket === 'overdue' || task.dueBucket === 'today')
    .sort(compareByDueUrgency)
  const upNextTasks = [...tasks]
    .filter((task) => task.dueBucket === 'next' || task.dueBucket === 'none')
    .sort(compareByDueUrgency)
  const recentlyUpdatedTasks = [...tasks]
    .sort((left, right) => compareIsoDescending(left.modified, right.modified))
    .slice(0, 3)

  const overdueTasks = [...tasks]
    .filter((task) => task.dueBucket === 'overdue')
    .sort(compareByDueUrgency)
  const todayTasks = [...tasks]
    .filter((task) => task.dueBucket === 'today')
    .sort(compareByDueUrgency)
  const nextTasks = [...tasks]
    .filter((task) => task.dueBucket === 'next')
    .sort(compareByDueUrgency)

  const myWorkSections = [
    createSection('needs-attention', 'Needs attention', needsAttentionTasks),
    createSection('due-now', 'Due now', dueNowTasks),
    createSection('up-next', 'Up next', upNextTasks),
    createSection('recently-updated', 'Recently updated', recentlyUpdatedTasks),
  ].filter((section): section is VisibleWorkfeedSection => section !== null)

  const dueSections = [
    createSection('overdue', 'Overdue', overdueTasks),
    createSection('today', 'Today', todayTasks),
    createSection('next', 'Tomorrow / next', nextTasks),
  ].filter((section): section is VisibleWorkfeedSection => section !== null)

  return {
    counts: createCounts(tasks),
    due: {
      sections: dueSections,
    },
    errorMessage: input.errorMessage ?? null,
    landing: {
      activeTaskId,
      pendingTarget: input.pendingTarget ?? null,
      requestedTaskId,
      status:
        requestedTaskId === null
          ? 'none'
          : landingConfirmedByLiveData
            ? activeTaskId
              ? 'ready'
              : 'unavailable'
            : 'blocked',
    },
    myWork: {
      sections: myWorkSections,
    },
    phase: input.phase ?? (tasks.length > 0 ? 'ready' : 'empty'),
    source,
    tasks,
    workspaceId: input.workspaceId,
  }
}

