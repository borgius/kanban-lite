import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

import {
  createMobileApiClient,
  type MobileChecklistReadModel,
  type MobileCommentReadModel,
  type MobileTaskDetail,
  type MobileTaskListItem,
} from '../client'
import {
  DEFAULT_SESSION_NAMESPACE,
  createCacheStore,
  createMemoryCacheStorage,
  type CacheNamespace,
  type MobileCacheSnapshots,
} from '../../../features/sync/cache-store'
import type {
  MobileSessionStatus,
  ResolvedMobileBootstrap,
} from '../../../features/auth/session-store'
import type { ChecklistReadModel as ServerChecklistReadModel } from '../../../../../kanban-lite/src/sdk/modules/checklist'
import type {
  MobileSessionStatus as ServerMobileSessionStatus,
  ResolveMobileBootstrapResult,
} from '../../../../../kanban-lite/src/sdk/types'
import type { StandaloneCardReadModel } from '../../../../../kanban-lite/src/standalone/internal/common'

type Extends<Left, Right> = Left extends Right ? true : false
type Assert<T extends true> = T

type ServerTaskListReadModel = Omit<StandaloneCardReadModel, 'resolvedForms'>

const TYPE_CONTRACT_ASSERTIONS = {
  bootstrapMatchesServer: true as Assert<Extends<ResolvedMobileBootstrap, ResolveMobileBootstrapResult>>,
  serverBootstrapMatchesClient: true as Assert<Extends<ResolveMobileBootstrapResult, ResolvedMobileBootstrap>>,
  sessionMatchesServer: true as Assert<Extends<MobileSessionStatus, ServerMobileSessionStatus>>,
  serverSessionMatchesClient: true as Assert<Extends<ServerMobileSessionStatus, MobileSessionStatus>>,
  taskListMatchesServer: true as Assert<Extends<MobileTaskListItem, ServerTaskListReadModel>>,
  taskDetailMatchesServer: true as Assert<Extends<MobileTaskDetail, StandaloneCardReadModel>>,
  checklistMatchesServer: true as Assert<Extends<MobileChecklistReadModel, ServerChecklistReadModel>>,
} as const

void TYPE_CONTRACT_ASSERTIONS

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url))
const MOBILE_ROOT = path.resolve(TEST_DIR, '../../../..')
const PACKAGE_JSON_PATH = path.join(MOBILE_ROOT, 'package.json')
const NOW = new Date('2026-04-02T12:00:00.000Z')

const namespace: CacheNamespace = {
  workspaceOrigin: 'https://field.example.com',
  workspaceId: 'workspace_123',
  subject: 'worker',
  sessionNamespace: DEFAULT_SESSION_NAMESPACE,
}

function createTaskPermissions() {
  return {
    comment: {
      create: true,
      update: true,
      delete: false,
      byId: {
        'comment-1': {
          update: true,
          delete: false,
        },
      },
    },
    attachment: {
      add: true,
      remove: true,
      byName: {
        'panel.jpg': {
          remove: true,
        },
      },
    },
    form: {
      submit: true,
      byId: {
        inspection: {
          submit: true,
        },
      },
    },
    checklist: {
      show: true,
      add: true,
      edit: true,
      delete: false,
      check: true,
      uncheck: true,
    },
    cardAction: {
      trigger: true,
      byKey: {
        dispatch: {
          trigger: true,
        },
      },
    },
  }
}

function createTaskListItem(overrides: Partial<MobileTaskListItem> = {}): MobileTaskListItem {
  return {
    version: 1,
    id: 'task-1',
    boardId: 'default',
    status: 'in-progress',
    priority: 'high',
    assignee: 'worker',
    dueDate: '2026-04-03',
    created: '2026-04-01T10:00:00.000Z',
    modified: '2026-04-02T09:00:00.000Z',
    completedAt: null,
    labels: ['urgent'],
    attachments: ['panel.jpg'],
    tasks: ['- [ ] Inspect panel'],
    comments: [
      {
        id: 'comment-1',
        author: 'worker',
        created: '2026-04-02T08:30:00.000Z',
        content: 'Waiting on access.',
      },
    ],
    order: 'a0',
    content: '# Inspect panel',
    metadata: {
      site: 'North Yard',
    },
    actions: {
      dispatch: 'Dispatch crew',
    },
    forms: [
      {
        name: 'inspection',
        schema: {
          type: 'object',
          properties: {
            passed: {
              type: 'boolean',
            },
          },
        },
        data: {
          passed: false,
        },
      },
    ],
    formData: {
      inspection: {
        passed: false,
      },
    },
    cardState: {
      unread: {
        actorId: 'worker',
        boardId: 'default',
        cardId: 'task-1',
        latestActivity: {
          cursor: 'cursor-2',
          updatedAt: '2026-04-02T09:00:00.000Z',
        },
        readThrough: {
          cursor: 'cursor-1',
          updatedAt: '2026-04-02T08:00:00.000Z',
        },
        unread: true,
      },
      open: {
        actorId: 'worker',
        boardId: 'default',
        cardId: 'task-1',
        domain: 'card.open',
        value: {
          openedAt: '2026-04-02T09:00:00.000Z',
          readThrough: {
            cursor: 'cursor-1',
            updatedAt: '2026-04-02T08:00:00.000Z',
          },
        },
        updatedAt: '2026-04-02T09:00:00.000Z',
      },
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

function createTaskDetail(overrides: Partial<MobileTaskDetail> = {}): MobileTaskDetail {
  return {
    ...createTaskListItem(),
    resolvedForms: [
      {
        id: 'inspection',
        name: 'Inspection',
        description: 'Field inspection checklist',
        label: 'Inspection',
        schema: {
          type: 'object',
          properties: {
            passed: {
              type: 'boolean',
            },
          },
        },
        ui: {
          type: 'VerticalLayout',
          elements: [],
        },
        initialData: {
          passed: false,
        },
        fromConfig: true,
      },
    ],
    ...overrides,
  }
}

function createChecklist(overrides: Partial<MobileChecklistReadModel> = {}): MobileChecklistReadModel {
  return {
    cardId: 'task-1',
    boardId: 'default',
    token: 'checklist-token-1',
    summary: {
      total: 1,
      completed: 0,
      incomplete: 1,
    },
    items: [
      {
        index: 0,
        raw: '- [ ] Inspect panel',
        expectedRaw: '- [ ] Inspect panel',
        checked: false,
        text: 'Inspect panel',
      },
    ],
    ...overrides,
  }
}

function createComment(overrides: Partial<MobileCommentReadModel> = {}): MobileCommentReadModel {
  return {
    id: 'comment-1',
    author: 'worker',
    created: '2026-04-02T08:30:00.000Z',
    content: 'Waiting on access.',
    ...overrides,
  }
}

function createJsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

describe('mobile client contract', () => {
  it('declares a real mobile build script that type-checks and exports the Expo app', () => {
    const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8')) as {
      scripts?: Record<string, string>
    }
    const buildScript = packageJson.scripts?.build ?? ''

    expect(buildScript).toContain('expo export')
    expect(buildScript).toContain('--output-dir dist')
  })

  it('returns typed task list and detail DTOs with server-owned permissions and resolved forms intact', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createJsonResponse([createTaskListItem()]))
      .mockResolvedValueOnce(createJsonResponse(createTaskDetail()))

    const client = createMobileApiClient({
      workspaceOrigin: 'https://Field.Example.com/mobile/',
      token: 'opaque-worker-token',
      fetchImplementation,
    })

    const tasks = await client.listTasks({ status: 'in-progress' })
    const detail = await client.getTask('task-1')
    const [task] = tasks

    expect(task).toBeDefined()
    if (!task) {
      throw new Error('Expected one task in the list payload')
    }

    expect(fetchImplementation).toHaveBeenNthCalledWith(
      1,
      'https://field.example.com/api/tasks?status=in-progress',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer opaque-worker-token',
        }),
      }),
    )
    expect(task.permissions.checklist.show).toBe(true)
    expect(task.cardState.unread?.unread).toBe(true)
    expect(detail.resolvedForms[0]?.id).toBe('inspection')
    expect(detail.permissions.form.byId?.inspection?.submit).toBe(true)
  })

  it('round-trips typed workspace-scoped home/detail snapshots through the cache store', async () => {
    const storage = createMemoryCacheStorage()
    const store = createCacheStore({
      storage,
      now: () => NOW,
    })

    const snapshots: MobileCacheSnapshots = {
      home: {
        workspaceId: namespace.workspaceId,
        totalVisibleTasks: 1,
        tasks: [createTaskListItem()],
        activeTaskId: 'task-1',
      },
      taskDetails: {
        'task-1': {
          workspaceId: namespace.workspaceId,
          task: createTaskDetail(),
        },
      },
    }

    await store.replaceSnapshots(namespace, snapshots)
    const hydrated = await store.hydrate({
      namespace,
      sessionValidated: true,
    })

    expect(hydrated.kind).toBe('hydrated')
    if (hydrated.kind !== 'hydrated') {
      throw new Error('Expected hydrated cache result')
    }

    expect(hydrated.envelope.snapshots.home).toMatchObject({
      workspaceId: 'workspace_123',
      totalVisibleTasks: 1,
      tasks: [
        {
          id: 'task-1',
          permissions: {
            checklist: {
              show: true,
            },
          },
        },
      ],
    })
    expect(hydrated.envelope.snapshots.taskDetails).toMatchObject({
      'task-1': {
        workspaceId: 'workspace_123',
        task: {
          resolvedForms: [
            {
              id: 'inspection',
            },
          ],
        },
      },
    })
  })

  it('keeps checklist endpoints typed against the shipped read model', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createJsonResponse(createChecklist()))

    const client = createMobileApiClient({
      workspaceOrigin: 'https://field.example.com',
      token: 'opaque-worker-token',
      fetchImplementation,
    })

    const checklist = await client.getChecklist('task-1')
    const [firstItem] = checklist.items

    expect(firstItem).toBeDefined()
    if (!firstItem) {
      throw new Error('Expected one checklist item')
    }

    expect(firstItem).toMatchObject({
      index: 0,
      checked: false,
      text: 'Inspect panel',
    })
  })

  it('exposes comment update and delete wrappers against the shipped REST routes', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createJsonResponse(createComment({
        content: 'Updated access note.',
      })))
      .mockResolvedValueOnce(createJsonResponse({ deleted: true }))

    const client = createMobileApiClient({
      workspaceOrigin: 'https://field.example.com',
      token: 'opaque-worker-token',
      fetchImplementation,
    })

    const updated = await client.updateComment('task-1', 'comment-1', {
      content: 'Updated access note.',
    })
    const deleted = await client.deleteComment('task-1', 'comment-1')

    expect(updated).toMatchObject({
      id: 'comment-1',
      content: 'Updated access note.',
    })
    expect(deleted).toEqual({ deleted: true })
    expect(fetchImplementation).toHaveBeenNthCalledWith(
      1,
      'https://field.example.com/api/tasks/task-1/comments/comment-1',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          content: 'Updated access note.',
        }),
      }),
    )
    expect(fetchImplementation).toHaveBeenNthCalledWith(
      2,
      'https://field.example.com/api/tasks/task-1/comments/comment-1',
      expect.objectContaining({
        method: 'DELETE',
      }),
    )
  })
})
