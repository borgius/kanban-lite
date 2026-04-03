import React from 'react'
import type { ReactTestRenderer } from 'react-test-renderer'
import TestRenderer, { act } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SESSION_STORAGE_KEY } from '../../auth/session-store'
import type { MobileApiClient, MobileTaskDetail } from '../../../lib/api/client'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean; React?: typeof React }).IS_REACT_ACT_ENVIRONMENT = true
;(globalThis as unknown as { React?: typeof React }).React = React

const harness = vi.hoisted(() => ({
  authentication: {
    provider: 'local' as const,
    browserLoginTransport: 'cookie-session' as const,
    mobileSessionTransport: 'opaque-bearer' as const,
    sessionKind: 'local-mobile-session-v1' as const,
  },
  client: {
    getTask: vi.fn(),
    getChecklist: vi.fn(),
    addChecklistItem: vi.fn(),
    editChecklistItem: vi.fn(),
    deleteChecklistItem: vi.fn(),
    checkChecklistItem: vi.fn(),
    uncheckChecklistItem: vi.fn(),
    submitForm: vi.fn(),
    triggerAction: vi.fn(),
  },
  controller: {
    initialize: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
  },
  replace: vi.fn(),
  sessionState: {
    phase: 'authenticated',
    statusMessage: null,
    workspaceInput: '',
    resolvedWorkspaceOrigin: 'https://field.example.com',
    pendingTarget: null,
    banner: null,
    sessionStatus: {
      workspaceOrigin: 'https://field.example.com',
      workspaceId: 'workspace_123',
      subject: 'worker',
      roles: ['user'],
      expiresAt: null,
      authentication: undefined as unknown,
    },
    isProtectedReady: true,
  },
}))

harness.sessionState.sessionStatus.authentication = harness.authentication

vi.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'task-1' }),
  useRouter: () => ({ replace: harness.replace }),
}))

vi.mock('@react-navigation/native', () => ({
  useTheme: () => ({
    colors: {
      background: '#0b1020',
      border: '#27314a',
      card: '#11182b',
      primary: '#5cb8ff',
      text: '#f5f7fb',
    },
  }),
}))

vi.mock('react-native', async () => {
  const ReactModule = await vi.importActual<typeof import('react')>('react')

  const createHost = (name: string) => {
    return ({ children, ...props }: { children?: React.ReactNode }) => ReactModule.createElement(
      name,
      props,
      children,
    )
  }

  return {
    ActivityIndicator: createHost('ActivityIndicator'),
    Alert: {
      alert: vi.fn(),
    },
    Modal: createHost('Modal'),
    Pressable: createHost('Pressable'),
    RefreshControl: createHost('RefreshControl'),
    ScrollView: createHost('ScrollView'),
    StyleSheet: {
      create: <T extends Record<string, unknown>>(value: T) => value,
    },
    Text: createHost('Text'),
    TextInput: createHost('TextInput'),
    View: createHost('View'),
  }
})

vi.mock('expo-document-picker', () => ({
  getDocumentAsync: vi.fn().mockResolvedValue({ canceled: true }),
}))

vi.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: vi.fn().mockResolvedValue({ granted: false }),
  launchCameraAsync: vi.fn().mockResolvedValue({ canceled: true }),
}))

vi.mock('../../attachments/durable-drafts', () => ({
  AttachmentDraftError: class AttachmentDraftError extends Error {},
  deleteDurableAttachmentDraft: vi.fn().mockResolvedValue(undefined),
  prepareDurableAttachmentDraft: vi.fn(),
  readAttachmentDraftAsBase64: vi.fn(),
}))

vi.mock('expo-secure-store', () => {
  const data = new Map<string, string>()

  return {
    deleteItemAsync: vi.fn(async (key: string) => {
      data.delete(key)
    }),
    getItemAsync: vi.fn(async (key: string) => data.get(key) ?? null),
    setItemAsync: vi.fn(async (key: string, value: string) => {
      data.set(key, value)
    }),
    __reset: () => {
      data.clear()
    },
  }
})

vi.mock('react-native-safe-area-context', async () => {
  const ReactModule = await vi.importActual<typeof import('react')>('react')

  return {
    SafeAreaView: ({ children, ...props }: { children?: React.ReactNode }) => ReactModule.createElement(
      'SafeAreaView',
      props,
      children,
    ),
  }
})

vi.mock('../../auth/session-store', async () => {
  const actual = await vi.importActual<typeof import('../../auth/session-store')>('../../auth/session-store')

  return {
    ...actual,
    useSessionController: () => ({
      controller: harness.controller,
      state: harness.sessionState,
    }),
  }
})

vi.mock('../../../lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/api/client')>('../../../lib/api/client')

  return {
    ...actual,
    createMobileApiClient: () => harness.client as unknown as MobileApiClient,
  }
})

function createStoredSessionJson(): string {
  return JSON.stringify({
    version: 1,
    workspaceOrigin: 'https://field.example.com',
    workspaceId: 'workspace_123',
    subject: 'worker',
    roles: ['user'],
    expiresAt: null,
    session: {
      kind: 'local-mobile-session-v1',
      token: 'opaque-worker-token',
    },
  })
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
    attachments: [],
    tasks: [],
    comments: [],
    order: 'a0',
    content: '# Inspect panel\n\nConfirm the relay enclosure is sealed.',
    metadata: {
      site: 'North Yard',
    },
    actions: {},
    forms: [],
    formData: {
      inspection: {
        note: '',
        passed: false,
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
    permissions: {
      comment: {
        create: false,
        update: false,
        delete: false,
        byId: {},
      },
      attachment: {
        add: false,
        remove: false,
        byName: {},
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
        show: false,
        add: false,
        edit: false,
        delete: false,
        check: false,
        uncheck: false,
      },
      cardAction: {
        trigger: false,
        byKey: {},
      },
    },
    resolvedForms: [
      {
        id: 'inspection',
        name: 'Inspection',
        description: 'Field inspection checklist',
        label: 'Inspection',
        schema: {
          type: 'object',
          required: ['note'],
          properties: {
            note: {
              type: 'string',
              title: 'Inspection note',
            },
            passed: {
              type: 'boolean',
              title: 'Passed',
            },
          },
        },
        ui: {
          type: 'VerticalLayout',
          elements: [
            {
              type: 'Control',
              scope: '#/properties/note',
              options: {
                multi: true,
              },
            },
            {
              type: 'Control',
              scope: '#/properties/passed',
            },
          ],
        },
        initialData: {
          note: '',
          passed: false,
        },
        fromConfig: true,
      },
    ],
    ...overrides,
  }
}

function createChecklistReadModel(overrides: Record<string, unknown> = {}) {
  return {
    cardId: 'task-1',
    boardId: 'default',
    token: 'checklist-token-1',
    summary: {
      total: 2,
      completed: 1,
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
      {
        index: 1,
        raw: '- [x] Close gate',
        expectedRaw: '- [x] Close gate',
        checked: true,
        text: 'Close gate',
      },
    ],
    ...overrides,
  }
}

async function renderScreen(): Promise<ReactTestRenderer> {
  const module = await import('../../../../app/tasks/[id]')
  let renderer: ReactTestRenderer | null = null

  await act(async () => {
    renderer = TestRenderer.create(React.createElement(module.default))
  })

  await flushScreen()

  if (!renderer) {
    throw new Error('Expected renderer to be created')
  }

  return renderer
}

async function flushScreen(): Promise<void> {
  await act(async () => {
    vi.runAllTimers()
    await Promise.resolve()
    await Promise.resolve()
  })
}

function findProps(renderer: ReactTestRenderer, testID: string): Record<string, unknown> {
  return renderer.root.findByProps({ testID }).props as Record<string, unknown>
}

function findPropsByTestIdPrefix(renderer: ReactTestRenderer, testIDPrefix: string): Record<string, unknown> {
  const root = renderer.root as unknown as {
    find: (predicate: (node: { props: Record<string, unknown> }) => boolean) => { props: Record<string, unknown> }
  }

  return root.find((node) => (
    typeof node.props.testID === 'string'
    && node.props.testID.startsWith(testIDPrefix)
  )).props as Record<string, unknown>
}

async function press(renderer: ReactTestRenderer, testID: string): Promise<void> {
  await act(async () => {
    const props = findProps(renderer, testID)
    const onPress = props.onPress as (() => void) | undefined
    onPress?.()
  })
}

async function changeText(renderer: ReactTestRenderer, testID: string, value: string): Promise<void> {
  await act(async () => {
    const props = findProps(renderer, testID)
    const onChangeText = props.onChangeText as ((nextValue: string) => void) | undefined
    onChangeText?.(value)
  })
}

async function pressByPrefix(renderer: ReactTestRenderer, testIDPrefix: string): Promise<void> {
  await act(async () => {
    const props = findPropsByTestIdPrefix(renderer, testIDPrefix)
    const onPress = props.onPress as (() => void) | undefined
    onPress?.()
  })
}

async function confirmLastAlert(actionText: string): Promise<void> {
  const reactNative = await import('react-native') as unknown as {
    Alert: {
      alert: {
        mock: {
          calls: unknown[][]
        }
      }
    }
  }
  const calls = reactNative.Alert.alert.mock.calls
  const lastCall = calls.at(-1)
  if (!lastCall) {
    throw new Error('Expected Alert.alert to have been called')
  }

  const buttons = (lastCall[2] as Array<{ onPress?: () => void; text?: string }> | undefined) ?? []
  const action = buttons.find((button) => button.text === actionText)
  if (!action?.onPress) {
    throw new Error(`Expected alert button "${actionText}" to exist`)
  }

  await act(async () => {
    action.onPress?.()
  })
}

async function refreshScreen(renderer: ReactTestRenderer): Promise<void> {
  await act(async () => {
    const root = renderer.root as unknown as {
      find: (predicate: (node: { props: Record<string, unknown>; type: unknown }) => boolean) => { props: Record<string, unknown> }
    }
    const scrollView = root.find((node) => (
      node.type === 'ScrollView'
      && Boolean(node.props.refreshControl)
    ))
    const refreshControl = scrollView.props.refreshControl as React.ReactElement<{ onRefresh?: () => void }>
    refreshControl.props.onRefresh?.()
  })
  await flushScreen()
}

describe('mobile task detail resolved-form submit path', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(async () => {
    vi.useFakeTimers()
    harness.client.getTask.mockReset()
    harness.client.getChecklist.mockReset()
    harness.client.addChecklistItem.mockReset()
    harness.client.editChecklistItem.mockReset()
    harness.client.deleteChecklistItem.mockReset()
    harness.client.checkChecklistItem.mockReset()
    harness.client.uncheckChecklistItem.mockReset()
    harness.client.submitForm.mockReset()
    harness.client.triggerAction.mockReset()
    harness.controller.initialize.mockClear()
    harness.controller.logout.mockClear()
    harness.replace.mockReset()

    const reactNative = await import('react-native') as unknown as {
      Alert: {
        alert: {
          mockReset: () => void
        }
      }
    }
    reactNative.Alert.alert.mockReset()

    const secureStore = await import('expo-secure-store') as unknown as {
      __reset: () => void
      setItemAsync: (key: string, value: string) => Promise<void>
    }
    secureStore.__reset()
    await secureStore.setItemAsync(SESSION_STORAGE_KEY, createStoredSessionJson())
  })

  afterEach(async () => {
    if (renderer) {
      await act(async () => {
        renderer?.unmount()
      })
    }
    renderer = null
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('opens the dock-selected form, blocks invalid submit, submits the resolved payload, and refreshes task detail', async () => {
    harness.client.getTask
      .mockResolvedValueOnce(createTaskDetail())
      .mockResolvedValueOnce(createTaskDetail({
        formData: {
          inspection: {
            note: 'Panel sealed.',
            passed: false,
          },
        },
        resolvedForms: [
          {
            ...createTaskDetail().resolvedForms[0],
            initialData: {
              note: 'Panel sealed.',
              passed: false,
            },
          },
        ],
      }))
    harness.client.submitForm.mockResolvedValue({
      boardId: 'default',
      card: {
        id: 'task-1',
      },
      form: {
        id: 'inspection',
      },
      data: {
        note: 'Panel sealed.',
        passed: false,
      },
    })

    renderer = await renderScreen()

    await press(renderer, 'task-detail-dock-primary')

    expect(
      findProps(renderer, 'form-sheet-submit:inspection').disabled,
    ).toBe(true)

    await changeText(renderer, 'form-sheet-input:inspection:note', 'Panel sealed.')

    expect(
      findProps(renderer, 'form-sheet-submit:inspection').disabled,
    ).toBe(false)

    await press(renderer, 'form-sheet-submit:inspection')
    await flushScreen()

    expect(harness.client.submitForm).toHaveBeenCalledWith('task-1', 'inspection', {
      data: {
        note: 'Panel sealed.',
        passed: false,
      },
    })
    expect(harness.client.getTask).toHaveBeenCalledTimes(2)
  })

  it('saves a local form draft on retryable submit failure and never silently replays it', async () => {
    harness.client.getTask.mockResolvedValue(createTaskDetail())
    harness.client.submitForm.mockRejectedValue(new Error('Network offline.'))

    renderer = await renderScreen()

    await press(renderer, 'task-detail-dock-primary')
    await changeText(renderer, 'form-sheet-input:inspection:note', 'Hold for reconnect.')
    await press(renderer, 'form-sheet-submit:inspection')
    await flushScreen()

    expect(harness.client.submitForm).toHaveBeenCalledTimes(1)
    expect(harness.client.getTask).toHaveBeenCalledTimes(1)
    expect(renderer.root.findByProps({ testID: 'task-form-draft:inspection' })).toBeDefined()

    await flushScreen()
    expect(harness.client.submitForm).toHaveBeenCalledTimes(1)
  })

  it('runs checklist add, check, uncheck, edit, and delete flows against the live client and refreshes after each success', async () => {
    const task = createTaskDetail({
      actions: {},
      permissions: {
        ...createTaskDetail().permissions,
        checklist: {
          show: true,
          add: true,
          edit: true,
          delete: true,
          check: true,
          uncheck: true,
        },
        form: {
          submit: false,
          byId: {},
        },
      },
      resolvedForms: [],
      tasks: ['- [ ] Inspect panel', '- [x] Close gate'],
    })

    harness.client.getTask.mockResolvedValue(task)
    harness.client.getChecklist.mockResolvedValue(createChecklistReadModel())
    harness.client.addChecklistItem.mockResolvedValue(createChecklistReadModel({
      token: 'checklist-token-2',
      summary: {
        total: 3,
        completed: 1,
        incomplete: 2,
      },
      items: [
        ...createChecklistReadModel().items,
        {
          index: 2,
          raw: '- [ ] Lock panel',
          expectedRaw: '- [ ] Lock panel',
          checked: false,
          text: 'Lock panel',
        },
      ],
    }))
    harness.client.checkChecklistItem.mockResolvedValue(createChecklistReadModel())
    harness.client.uncheckChecklistItem.mockResolvedValue(createChecklistReadModel())
    harness.client.editChecklistItem.mockResolvedValue(createChecklistReadModel())
    harness.client.deleteChecklistItem.mockResolvedValue(createChecklistReadModel({
      token: 'checklist-token-3',
      summary: {
        total: 1,
        completed: 1,
        incomplete: 0,
      },
      items: [
        createChecklistReadModel().items[1],
      ],
    }))

    renderer = await renderScreen()

    await changeText(renderer, 'task-checklist-input', 'Lock panel')
    await press(renderer, 'task-checklist-submit')
    await flushScreen()

    expect(harness.client.addChecklistItem).toHaveBeenCalledWith('task-1', {
      text: 'Lock panel',
      expectedToken: 'checklist-token-1',
    })

    await press(renderer, 'task-checklist-toggle:0')
    await flushScreen()
    expect(harness.client.checkChecklistItem).toHaveBeenCalledWith('task-1', 0, {
      expectedRaw: '- [ ] Inspect panel',
    })

    await press(renderer, 'task-checklist-toggle:1')
    await flushScreen()
    expect(harness.client.uncheckChecklistItem).toHaveBeenCalledWith('task-1', 1, {
      expectedRaw: '- [x] Close gate',
    })

    await press(renderer, 'task-checklist-edit:0')
    await changeText(renderer, 'task-checklist-input', 'Inspect main panel')
    await press(renderer, 'task-checklist-submit')
    await flushScreen()
    expect(harness.client.editChecklistItem).toHaveBeenCalledWith('task-1', 0, {
      text: 'Inspect main panel',
      expectedRaw: '- [ ] Inspect panel',
    })

    await press(renderer, 'task-checklist-delete:0')
    await confirmLastAlert('Delete')
    await flushScreen()
    expect(harness.client.deleteChecklistItem).toHaveBeenCalledWith('task-1', 0, {
      expectedRaw: '- [ ] Inspect panel',
    })

    expect(harness.client.getTask).toHaveBeenCalledTimes(6)
  })

  it('queues checklist drafts on retryable failure and only resends them when the worker explicitly asks', async () => {
    harness.client.getTask.mockResolvedValue(createTaskDetail({
      actions: {},
      permissions: {
        ...createTaskDetail().permissions,
        checklist: {
          show: true,
          add: true,
          edit: true,
          delete: true,
          check: true,
          uncheck: true,
        },
        form: {
          submit: false,
          byId: {},
        },
      },
      resolvedForms: [],
      tasks: ['- [ ] Inspect panel'],
    }))
    harness.client.getChecklist.mockResolvedValue(createChecklistReadModel({
      summary: {
        total: 1,
        completed: 0,
        incomplete: 1,
      },
      items: [createChecklistReadModel().items[0]],
    }))
    harness.client.addChecklistItem
      .mockRejectedValueOnce(new Error('Network offline.'))
      .mockResolvedValueOnce(createChecklistReadModel({
        token: 'checklist-token-2',
        summary: {
          total: 2,
          completed: 0,
          incomplete: 2,
        },
        items: [
          createChecklistReadModel().items[0],
          {
            index: 1,
            raw: '- [ ] Needs reconnect',
            expectedRaw: '- [ ] Needs reconnect',
            checked: false,
            text: 'Needs reconnect',
          },
        ],
      }))

    renderer = await renderScreen()

    await changeText(renderer, 'task-checklist-input', 'Needs reconnect')
    await press(renderer, 'task-checklist-submit')
    await flushScreen()

    expect(harness.client.addChecklistItem).toHaveBeenCalledTimes(1)
    expect(findPropsByTestIdPrefix(renderer, 'task-checklist-draft-send:')).toBeDefined()

    await flushScreen()
    expect(harness.client.addChecklistItem).toHaveBeenCalledTimes(1)

    await pressByPrefix(renderer, 'task-checklist-draft-send:')
    await flushScreen()

    expect(harness.client.addChecklistItem).toHaveBeenCalledTimes(2)
    expect(harness.client.getTask).toHaveBeenCalledTimes(2)
  })

  it('marks checklist conflicts for explicit review and retry with the latest server state', async () => {
    harness.client.getTask
      .mockResolvedValueOnce(createTaskDetail({
        actions: {},
        permissions: {
          ...createTaskDetail().permissions,
          checklist: {
            show: true,
            add: true,
            edit: true,
            delete: true,
            check: true,
            uncheck: true,
          },
          form: {
            submit: false,
            byId: {},
          },
        },
        resolvedForms: [],
        tasks: ['- [ ] Inspect panel'],
      }))
      .mockResolvedValueOnce(createTaskDetail({
        actions: {},
        permissions: {
          ...createTaskDetail().permissions,
          checklist: {
            show: true,
            add: true,
            edit: true,
            delete: true,
            check: true,
            uncheck: true,
          },
          form: {
            submit: false,
            byId: {},
          },
        },
        resolvedForms: [],
        tasks: ['- [ ] Inspect panel updated'],
      }))
      .mockResolvedValueOnce(createTaskDetail({
        actions: {},
        permissions: {
          ...createTaskDetail().permissions,
          checklist: {
            show: true,
            add: true,
            edit: true,
            delete: true,
            check: true,
            uncheck: true,
          },
          form: {
            submit: false,
            byId: {},
          },
        },
        resolvedForms: [],
        tasks: ['- [ ] Inspect panel updated'],
      }))
    harness.client.checkChecklistItem
      .mockRejectedValueOnce(new Error('Network offline.'))
      .mockRejectedValueOnce(new Error('Checklist item is stale: expectedRaw does not match current value'))
      .mockResolvedValueOnce(createChecklistReadModel({
        token: 'checklist-token-2',
        summary: {
          total: 1,
          completed: 1,
          incomplete: 0,
        },
        items: [
          {
            index: 0,
            raw: '- [x] Inspect panel updated',
            expectedRaw: '- [x] Inspect panel updated',
            checked: true,
            text: 'Inspect panel updated',
          },
        ],
      }))

    renderer = await renderScreen()

    await press(renderer, 'task-checklist-toggle:0')
    await flushScreen()

    await pressByPrefix(renderer, 'task-checklist-draft-send:')
    await flushScreen()

    expect(findPropsByTestIdPrefix(renderer, 'task-checklist-draft-review:')).toBeDefined()

    await pressByPrefix(renderer, 'task-checklist-draft-review:')
    await flushScreen()

    await pressByPrefix(renderer, 'task-checklist-draft-send:')
    await flushScreen()

    expect(harness.client.checkChecklistItem).toHaveBeenNthCalledWith(3, 'task-1', 0, {
      expectedRaw: '- [ ] Inspect panel updated',
    })
  })

  it('keeps card actions online-only and disables them when the screen falls back to validated cache', async () => {
    const actionTask = createTaskDetail({
      actions: {
        dispatch: 'Dispatch crew',
      },
      permissions: {
        ...createTaskDetail().permissions,
        attachment: {
          add: false,
          remove: false,
          byName: {},
        },
        cardAction: {
          trigger: true,
          byKey: {
            dispatch: {
              trigger: true,
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
        comment: {
          create: false,
          update: false,
          delete: false,
          byId: {},
        },
        form: {
          submit: false,
          byId: {},
        },
      },
      resolvedForms: [],
      tasks: [],
    })

    harness.client.getTask
      .mockResolvedValueOnce(actionTask)
      .mockResolvedValueOnce(actionTask)
      .mockRejectedValueOnce(new Error('Network offline.'))
    harness.client.triggerAction.mockResolvedValue(undefined)

    renderer = await renderScreen()

    await press(renderer, 'task-detail-dock-primary')
    await flushScreen()

    expect(harness.client.triggerAction).toHaveBeenCalledWith('task-1', 'dispatch')
    expect(harness.client.getTask).toHaveBeenCalledTimes(2)

    await refreshScreen(renderer)

    expect(findProps(renderer, 'task-detail-dock-primary').disabled).toBe(true)
    expect(findProps(renderer, 'task-card-action:dispatch').disabled).toBe(true)
    expect(harness.client.triggerAction).toHaveBeenCalledTimes(1)
  })
})
