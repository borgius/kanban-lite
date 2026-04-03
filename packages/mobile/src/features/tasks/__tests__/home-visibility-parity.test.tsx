import { describe, expect, it } from 'vitest'

import type { MobileTaskListItem } from '../../../lib/api/client'
import {
  DEFAULT_SESSION_NAMESPACE,
  createCacheStore,
  createMemoryCacheStorage,
  type CacheNamespace,
} from '../../sync/cache-store'
import {
  buildVisibleWorkfeedModel,
  createVisibleHomeSnapshot,
} from '../useVisibleWorkfeed'

const NOW = new Date('2026-04-02T12:00:00.000Z')

function createTaskPermissions(overrides: Partial<MobileTaskListItem['permissions']> = {}) {
  return {
    comment: {
      create: true,
      update: false,
      delete: false,
      byId: {},
      ...(overrides.comment ?? {}),
    },
    attachment: {
      add: true,
      remove: false,
      byName: {},
      ...(overrides.attachment ?? {}),
    },
    form: {
      submit: false,
      byId: {},
      ...(overrides.form ?? {}),
    },
    checklist: {
      show: true,
      add: false,
      edit: false,
      delete: false,
      check: false,
      uncheck: false,
      ...(overrides.checklist ?? {}),
    },
    cardAction: {
      trigger: false,
      byKey: {},
      ...(overrides.cardAction ?? {}),
    },
  }
}

function createTask(
  id: string,
  overrides: Partial<MobileTaskListItem> = {},
): MobileTaskListItem {
  return {
    version: 1,
    id,
    boardId: 'default',
    status: 'in-progress',
    priority: 'high',
    assignee: 'worker',
    dueDate: '2026-04-02',
    created: '2026-04-01T09:00:00.000Z',
    modified: '2026-04-02T10:30:00.000Z',
    completedAt: null,
    labels: [],
    attachments: [],
    tasks: [],
    comments: [],
    order: 'a0',
    content: '# Untitled task',
    metadata: {},
    actions: {},
    forms: [],
    formData: {},
    cardState: {
      unread: null,
      open: null,
      status: {
        backend: 'builtin',
        availability: 'available',
        configured: true,
      },
    },
    permissions: createTaskPermissions(),
    ...overrides,
  }
}

function createNamespace(subject: string): CacheNamespace {
  return {
    workspaceOrigin: 'https://field.example.com',
    workspaceId: 'workspace_123',
    subject,
    sessionNamespace: DEFAULT_SESSION_NAMESPACE,
  }
}

function collectTaskTitles(model: ReturnType<typeof buildVisibleWorkfeedModel>): string[] {
  const sections = [...model.myWork.sections, ...model.due.sections]
  const titles = new Map<string, string>()

  for (const section of sections) {
    for (const task of section.tasks) {
      titles.set(task.id, task.title)
    }
  }

  return [...titles.values()]
}

describe('MF10 home visibility parity', () => {
  it('keeps the shell neutral until protected restore or deep-link validation succeeds', () => {
    const model = buildVisibleWorkfeedModel({
      protectedReady: false,
      pendingTarget: '/cards/manager-only',
      tasks: [
        createTask('manager-only', {
          content: '# Hidden manager task',
          comments: [{ id: 'comment-1', author: 'manager', created: '2026-04-02T10:00:00.000Z', content: 'Secret' }],
        }),
      ],
      workspaceId: 'workspace_123',
      now: NOW,
    })

    expect(model.phase).toBe('blocked')
    expect(model.counts.totalVisibleTasks).toBe(0)
    expect(model.myWork.sections).toEqual([])
    expect(model.due.sections).toEqual([])
    expect(model.landing).toMatchObject({
      requestedTaskId: 'manager-only',
      activeTaskId: null,
      status: 'blocked',
    })
  })

  it('derives counts, sections, preview affordances, and landing only from the caller-visible task DTOs across roles', () => {
    const sharedVisibleTask = createTask('task-visible', {
      assignee: 'worker',
      dueDate: '2026-04-02',
      content: '# Inspect north panel',
      metadata: { site: 'North Yard' },
      attachments: ['panel.jpg'],
      comments: [
        {
          id: 'comment-1',
          author: 'worker',
          created: '2026-04-02T09:15:00.000Z',
          content: 'Waiting on gate code.',
        },
      ],
      tasks: ['- [x] Arrive on site', '- [ ] Inspect panel'],
      forms: [{ name: 'inspection', schema: { type: 'object' }, data: { passed: false } }],
      permissions: createTaskPermissions({
        form: {
          submit: true,
          byId: {
            inspection: {
              submit: true,
            },
          },
        },
      }),
      cardState: {
        unread: {
          actorId: 'worker',
          boardId: 'default',
          cardId: 'task-visible',
          latestActivity: {
            cursor: 'cursor-2',
            updatedAt: '2026-04-02T10:30:00.000Z',
          },
          readThrough: {
            cursor: 'cursor-1',
            updatedAt: '2026-04-02T08:00:00.000Z',
          },
          unread: true,
        },
        open: null,
        status: {
          backend: 'builtin',
          availability: 'available',
          configured: true,
        },
      },
    })
    const managerOnlyTask = createTask('manager-only', {
      assignee: 'manager',
      dueDate: '2026-04-01',
      content: '# Approve service window',
      metadata: { site: 'South Yard' },
      modified: '2026-04-02T11:45:00.000Z',
      permissions: createTaskPermissions({
        checklist: {
          show: false,
          add: false,
          edit: false,
          delete: false,
          check: false,
          uncheck: false,
        },
        cardAction: {
          trigger: true,
          byKey: {
            dispatch: {
              trigger: true,
            },
          },
        },
      }),
      actions: {
        dispatch: 'Dispatch crew',
      },
      comments: [],
      attachments: [],
      tasks: ['- [ ] Approve window'],
      forms: [],
    })

    const workerModel = buildVisibleWorkfeedModel({
      protectedReady: true,
      pendingTarget: '/cards/manager-only',
      source: 'live',
      tasks: [sharedVisibleTask],
      workspaceId: 'workspace_123',
      now: NOW,
    })
    const managerModel = buildVisibleWorkfeedModel({
      protectedReady: true,
      pendingTarget: '/cards/manager-only',
      source: 'live',
      tasks: [sharedVisibleTask, managerOnlyTask],
      workspaceId: 'workspace_123',
      now: NOW,
    })

    expect(workerModel.phase).toBe('ready')
    expect(workerModel.counts).toMatchObject({
      totalVisibleTasks: 1,
      dueNow: 1,
      overdue: 0,
      dueToday: 1,
    })
    expect(workerModel.landing).toMatchObject({
      requestedTaskId: 'manager-only',
      activeTaskId: null,
      status: 'unavailable',
    })
    expect(collectTaskTitles(workerModel)).toEqual(['Inspect north panel'])
    expect(workerModel.myWork.sections.map((section) => section.title)).toEqual(['Needs attention', 'Due now', 'Recently updated'])
    expect(workerModel.due.sections.map((section) => section.title)).toEqual(['Today'])
    expect(workerModel.myWork.sections[0]?.tasks[0]).toMatchObject({
      id: 'task-visible',
      preview: {
        comments: 1,
        attachments: 1,
        forms: 1,
        checklist: {
          total: 2,
          completed: 1,
          incomplete: 1,
        },
      },
      permissions: {
        checklist: {
          show: true,
        },
      },
    })

    expect(managerModel.phase).toBe('ready')
    expect(managerModel.counts).toMatchObject({
      totalVisibleTasks: 2,
      dueNow: 2,
      overdue: 1,
      dueToday: 1,
    })
    expect(managerModel.landing).toMatchObject({
      requestedTaskId: 'manager-only',
      activeTaskId: 'manager-only',
      status: 'ready',
    })
    expect(collectTaskTitles(managerModel)).toEqual([
      'Inspect north panel',
      'Approve service window',
    ])
    expect(managerModel.due.sections.map((section) => section.title)).toEqual(['Overdue', 'Today'])
    expect(managerModel.due.sections[0]?.tasks[0]).toMatchObject({
      id: 'manager-only',
      preview: {
        comments: 0,
        attachments: 0,
        forms: 0,
        checklist: null,
      },
      permissions: {
        checklist: {
          show: false,
        },
        cardAction: {
          trigger: true,
        },
      },
    })
  })

  it('keeps cached work visible but refuses to promote a pending target until live visibility confirms it', () => {
    const cachedModel = buildVisibleWorkfeedModel({
      protectedReady: true,
      pendingTarget: '/cards/task-visible',
      phase: 'ready',
      source: 'cache',
      errorMessage: 'Unable to refresh visible work.',
      tasks: [
        createTask('task-visible', {
          content: '# Inspect north panel',
        }),
      ],
      workspaceId: 'workspace_123',
      now: NOW,
    })

    expect(cachedModel.phase).toBe('ready')
    expect(cachedModel.source).toBe('cache')
    expect(cachedModel.counts.totalVisibleTasks).toBe(1)
    expect(collectTaskTitles(cachedModel)).toEqual(['Inspect north panel'])
    expect(cachedModel.landing).toMatchObject({
      requestedTaskId: 'task-visible',
      activeTaskId: null,
      status: 'blocked',
    })
  })

  it('hydrates only the caller-scoped cached subset on offline reopen', async () => {
    const workerTask = createTask('task-visible', {
      content: '# Inspect north panel',
    })
    const managerTask = createTask('manager-only', {
      content: '# Approve service window',
      dueDate: '2026-04-01',
    })
    const storage = createMemoryCacheStorage()
    const store = createCacheStore({
      storage,
      now: () => NOW,
    })
    const workerNamespace = createNamespace('worker')
    const managerNamespace = createNamespace('manager')

    await store.replaceSnapshots(workerNamespace, {
      home: createVisibleHomeSnapshot({
        workspaceId: workerNamespace.workspaceId,
        pendingTarget: '/cards/manager-only',
        tasks: [workerTask],
      }),
    })
    await store.replaceSnapshots(managerNamespace, {
      home: createVisibleHomeSnapshot({
        workspaceId: managerNamespace.workspaceId,
        pendingTarget: '/cards/manager-only',
        tasks: [workerTask, managerTask],
      }),
    })

    const hydratedWorker = await store.hydrate({
      namespace: workerNamespace,
      sessionValidated: true,
    })
    const hydratedManager = await store.hydrate({
      namespace: managerNamespace,
      sessionValidated: true,
    })

    expect(hydratedWorker.kind).toBe('hydrated')
    expect(hydratedManager.kind).toBe('hydrated')
    if (hydratedWorker.kind !== 'hydrated' || hydratedManager.kind !== 'hydrated') {
      throw new Error('Expected hydrated cache results for both caller scopes')
    }

    expect(hydratedWorker.envelope.snapshots.home).toMatchObject({
      workspaceId: 'workspace_123',
      totalVisibleTasks: 1,
      activeTaskId: null,
      tasks: [{ id: 'task-visible' }],
    })
    expect(hydratedManager.envelope.snapshots.home).toMatchObject({
      workspaceId: 'workspace_123',
      totalVisibleTasks: 2,
      activeTaskId: 'manager-only',
      tasks: [{ id: 'task-visible' }, { id: 'manager-only' }],
    })
  })
})