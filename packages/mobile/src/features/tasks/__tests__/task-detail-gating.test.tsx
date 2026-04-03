import { describe, expect, it } from 'vitest'

import { MobileApiClientError, type MobileTaskDetail } from '../../../lib/api/client'
import type { MobileCacheSnapshots } from '../../sync/cache-store'
import {
  buildTaskDetailShellModel,
  canUseTaskDetailCacheFallback,
  isTaskUnavailableError,
  readCachedTaskDetailSnapshot,
} from '../task-permissions'

function createTaskPermissions(
  overrides: Partial<MobileTaskDetail['permissions']> = {},
): MobileTaskDetail['permissions'] {
  return {
    comment: {
      create: true,
      update: true,
      delete: true,
      byId: {},
      ...(overrides.comment ?? {}),
    },
    attachment: {
      add: true,
      remove: true,
      byName: {},
      ...(overrides.attachment ?? {}),
    },
    form: {
      submit: true,
      byId: {},
      ...(overrides.form ?? {}),
    },
    checklist: {
      show: true,
      add: true,
      edit: true,
      delete: true,
      check: true,
      uncheck: true,
      ...(overrides.checklist ?? {}),
    },
    cardAction: {
      trigger: true,
      byKey: {},
      ...(overrides.cardAction ?? {}),
    },
  }
}

function createTaskDetail(overrides: Partial<MobileTaskDetail> = {}): MobileTaskDetail {
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
    attachments: ['panel.jpg', 'notes.pdf'],
    tasks: ['- [ ] Inspect panel', '- [x] Close gate'],
    comments: [
      {
        id: 'comment-1',
        author: 'worker',
        created: '2026-04-02T08:30:00.000Z',
        content: 'Waiting on access.',
      },
      {
        id: 'comment-2',
        author: 'supervisor',
        created: '2026-04-02T08:45:00.000Z',
        content: 'Use the north gate.',
      },
    ],
    order: 'a0',
    content: '# Inspect panel\n\nConfirm the relay enclosure is sealed.',
    metadata: {
      site: 'North Yard',
    },
    actions: {
      dispatch: 'Dispatch crew',
      escalate: 'Escalate',
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
      handoff: {
        recipient: 'Casey',
      },
    },
    cardState: {
      unread: null,
      open: null,
      status: {
        backend: 'builtin',
        availability: 'available',
        configured: true,
      },
    },
    permissions: createTaskPermissions({
      comment: {
        byId: {
          'comment-1': {
            update: true,
            delete: false,
          },
          'comment-2': {
            update: false,
            delete: true,
          },
        },
      },
      attachment: {
        byName: {
          'panel.jpg': {
            remove: true,
          },
          'notes.pdf': {
            remove: false,
          },
        },
      },
      form: {
        byId: {
          inspection: {
            submit: true,
          },
          handoff: {
            submit: false,
          },
        },
      },
      checklist: {
        show: true,
        add: true,
        edit: true,
        delete: true,
        check: true,
        uncheck: false,
      },
      cardAction: {
        trigger: true,
        byKey: {
          dispatch: {
            trigger: true,
          },
          escalate: {
            trigger: false,
          },
        },
      },
    }),
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
            note: {
              type: 'string',
            },
          },
        },
        ui: {
          type: 'VerticalLayout',
          elements: [],
        },
        initialData: {
          passed: false,
          note: 'Needs second check',
        },
        fromConfig: true,
      },
      {
        id: 'handoff',
        name: 'Handoff',
        description: 'Handoff summary',
        label: 'Handoff',
        schema: {
          type: 'object',
          properties: {
            recipient: {
              type: 'string',
            },
          },
        },
        ui: {
          type: 'VerticalLayout',
          elements: [],
        },
        initialData: {
          recipient: 'Casey',
        },
        fromConfig: true,
      },
    ],
    ...overrides,
  }
}

describe('MF11 task-detail gating', () => {
  it('builds the centralized control matrix from server-owned permissions and resolved forms', () => {
    const model = buildTaskDetailShellModel(createTaskDetail())

    expect(model.title).toBe('Inspect panel')
    expect(model.primaryAction).toMatchObject({
      kind: 'form',
      key: 'form:inspection',
      label: 'Submit form',
    })
    expect(model.secondaryActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'checklist', label: 'Add checklist item' }),
        expect.objectContaining({ kind: 'attachment', label: 'Take photo' }),
        expect.objectContaining({ kind: 'comment', label: 'Add comment' }),
        expect.objectContaining({ kind: 'card-action', label: 'Dispatch crew' }),
      ]),
    )
    expect(model.comments).toMatchObject({
      visible: true,
      canCreate: true,
    })
    expect(model.comments.items).toEqual([
      expect.objectContaining({
        id: 'comment-1',
        canUpdate: true,
        canDelete: false,
      }),
      expect.objectContaining({
        id: 'comment-2',
        canUpdate: false,
        canDelete: true,
      }),
    ])

    expect(model.attachments).toMatchObject({
      visible: true,
      canAdd: true,
    })
    expect(model.attachments.items).toEqual([
      expect.objectContaining({ name: 'panel.jpg', canRemove: true }),
      expect.objectContaining({ name: 'notes.pdf', canRemove: false }),
    ])

    expect(model.forms).toMatchObject({
      visible: true,
      hasSubmitControls: true,
    })
    expect(model.forms.items).toEqual([
      expect.objectContaining({
        id: 'inspection',
        canSubmit: true,
        fieldCount: 2,
        label: 'Inspection',
      }),
      expect.objectContaining({
        id: 'handoff',
        canSubmit: false,
        fieldCount: 1,
        label: 'Handoff',
      }),
    ])

    expect(model.checklist).toMatchObject({
      visible: true,
      canAdd: true,
      canEdit: true,
      canDelete: true,
    })
    expect(model.checklist.items).toEqual([
      expect.objectContaining({
        index: 0,
        checked: false,
        canToggle: true,
        toggleAction: 'check',
        canEdit: true,
        canDelete: true,
      }),
      expect.objectContaining({
        index: 1,
        checked: true,
        canToggle: false,
        toggleAction: 'uncheck',
        canEdit: true,
        canDelete: true,
      }),
    ])

    expect(model.actions).toMatchObject({
      visible: true,
      hasTriggers: true,
    })
    expect(model.actions.items).toEqual([
      expect.objectContaining({
        key: 'dispatch',
        label: 'Dispatch crew',
        canTrigger: true,
      }),
    ])
  })

  it('keeps denied controls hidden while preserving read-only task content where policy allows visibility', () => {
    const model = buildTaskDetailShellModel(
      createTaskDetail({
        attachments: ['panel.jpg'],
        comments: [
          {
            id: 'comment-1',
            author: 'worker',
            created: '2026-04-02T08:30:00.000Z',
            content: 'Read-only note.',
          },
        ],
        permissions: createTaskPermissions({
          comment: {
            create: false,
            update: false,
            delete: false,
            byId: {
              'comment-1': {
                update: false,
                delete: false,
              },
            },
          },
          attachment: {
            add: false,
            remove: false,
            byName: {
              'panel.jpg': {
                remove: false,
              },
            },
          },
          form: {
            submit: false,
            byId: {
              inspection: {
                submit: false,
              },
              handoff: {
                submit: false,
              },
            },
          },
          checklist: {
            show: false,
            add: false,
            edit: false,
            delete: false,
            check: false,
            uncheck: false,
          },
          cardAction: {
            trigger: false,
            byKey: {
              dispatch: {
                trigger: false,
              },
            },
          },
        }),
      }),
    )

    expect(model.comments).toMatchObject({
      visible: true,
      canCreate: false,
    })
    expect(model.comments.items[0]).toMatchObject({
      canUpdate: false,
      canDelete: false,
    })
    expect(model.attachments).toMatchObject({
      visible: true,
      canAdd: false,
    })
    expect(model.attachments.items[0]).toMatchObject({
      canRemove: false,
    })
    expect(model.forms).toMatchObject({
      visible: true,
      hasSubmitControls: false,
    })
    expect(model.forms.items.every((form) => form.canSubmit === false)).toBe(true)
    expect(model.checklist).toMatchObject({
      visible: false,
      items: [],
    })
    expect(model.actions).toMatchObject({
      visible: false,
      hasTriggers: false,
      items: [],
    })
    expect(model.primaryAction).toBeNull()
    expect(model.secondaryActions).toEqual([])
  })

  it('centralizes hidden-as-not-found and hard-failure helpers so mismatched cache snapshots never leak', () => {
    const snapshots: MobileCacheSnapshots = {
      taskDetails: {
        'task-1': {
          workspaceId: 'workspace_123',
          task: createTaskDetail(),
        },
      },
    }

    expect(
      readCachedTaskDetailSnapshot(snapshots, {
        taskId: 'task-1',
        workspaceId: 'workspace_123',
      }),
    ).toMatchObject({
      id: 'task-1',
    })

    expect(
      readCachedTaskDetailSnapshot(snapshots, {
        taskId: 'task-1',
        workspaceId: 'workspace_999',
      }),
    ).toBeNull()
    expect(
      readCachedTaskDetailSnapshot(
        {
          taskDetails: {
            'task-1': {
              workspaceId: 'workspace_123',
              task: createTaskDetail({ id: 'task-99' }),
            },
          },
        },
        {
          taskId: 'task-1',
          workspaceId: 'workspace_123',
        },
      ),
    ).toBeNull()

    expect(isTaskUnavailableError(new MobileApiClientError(404, 'Task not found'))).toBe(true)
    expect(isTaskUnavailableError(new MobileApiClientError(500, 'Boom'))).toBe(false)
    expect(isTaskUnavailableError(new Error('Task not found'))).toBe(false)

    expect(canUseTaskDetailCacheFallback(new MobileApiClientError(404, 'Task not found'))).toBe(false)
    expect(canUseTaskDetailCacheFallback(new MobileApiClientError(401, 'Expired'))).toBe(false)
    expect(canUseTaskDetailCacheFallback(new MobileApiClientError(403, 'Forbidden'))).toBe(false)
    expect(canUseTaskDetailCacheFallback(new MobileApiClientError(500, 'Boom'))).toBe(true)
    expect(canUseTaskDetailCacheFallback(new Error('Offline'))).toBe(true)
  })
})