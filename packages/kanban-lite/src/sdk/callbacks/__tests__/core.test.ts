import * as path from 'node:path'
import { describe, expect, it } from 'vitest'

import { createDurableCallbackHandlerRevision } from '../contract'
import {
  assertCallableCallbackModuleExport,
  buildCallbackExecutionPlan,
  buildCallbackHandlerRevisionInput,
  matchesCallbackEventPattern,
  normalizeCallbackHandlers,
  resolveCallbackModuleTarget,
} from '../core'

describe('shared callback core', () => {
  it('normalizes handlers, preserves stable ids, and refuses duplicate durable identities', () => {
    const diagnostics: string[] = []

    const handlers = normalizeCallbackHandlers([
      {
        name: 'legacy-duplicate',
        type: 'inline',
        events: ['task.created'],
        enabled: true,
        source: 'function () {}',
      },
      {
        name: 'legacy-duplicate',
        type: 'inline',
        events: ['task.created'],
        enabled: true,
        source: 'function () {}',
      },
      {
        id: 'stable-explicit-id',
        name: 'explicit-a',
        type: 'inline',
        events: ['task.created'],
        enabled: true,
        source: 'function () {}',
      },
      {
        id: 'stable-explicit-id',
        name: 'explicit-b',
        type: 'inline',
        events: ['task.created'],
        enabled: true,
        source: 'function () {}',
      },
      {
        id: 'unique-explicit-id',
        name: 'unique-handler',
        type: 'inline',
        events: [' task.created ', 'task.created'],
        source: 'function () {}',
      },
      'bad-row',
    ], {
      onError(message) {
        diagnostics.push(message)
      },
    })

    expect(handlers).toHaveLength(1)
    expect(handlers[0]).toMatchObject({
      id: 'unique-explicit-id',
      name: 'unique-handler',
      type: 'inline',
      enabled: true,
      events: ['task.created', 'task.created'],
    })
    expect(diagnostics).toEqual(expect.arrayContaining([
      'ignoring invalid handler at index 5',
      expect.stringContaining('refusing durable callback claims for legacy handler "legacy-duplicate"'),
      expect.stringContaining('refusing durable callback claims for configured handler "explicit-a"'),
      expect.stringContaining('refusing durable callback claims for configured handler "explicit-b"'),
    ]))
  })

  it('fails closed on malformed enabled module rows but tolerates disabled malformed module rows', () => {
    expect(() => normalizeCallbackHandlers([
      {
        id: 'missing-module',
        name: 'missing-module',
        type: 'module',
        events: ['task.created'],
        enabled: true,
        handler: 'onTaskCreated',
      },
    ])).toThrow('Enabled callback.runtime module handlers require non-empty module and handler strings.')

    expect(normalizeCallbackHandlers([
      {
        id: 'disabled-missing-module',
        name: 'disabled-missing-module',
        type: 'module',
        events: ['task.created'],
        enabled: false,
        handler: 'onTaskCreated',
      },
      {
        id: 'enabled-inline',
        name: 'enabled-inline',
        type: 'inline',
        events: ['task.created'],
        enabled: true,
        source: 'function () {}',
      },
    ])).toMatchObject([
      {
        id: 'enabled-inline',
        name: 'enabled-inline',
      },
    ])
  })

  it('matches event masks and preserves handler order in execution plans', () => {
    const handlers = normalizeCallbackHandlers([
      {
        id: 'task-star',
        name: 'task-star',
        type: 'inline',
        events: ['task.*'],
        enabled: true,
        source: 'function () {}',
      },
      {
        id: 'double-star',
        name: 'double-star',
        type: 'inline',
        events: ['**'],
        enabled: true,
        source: 'function () {}',
      },
      {
        id: 'disabled-specific',
        name: 'disabled-specific',
        type: 'inline',
        events: ['task.created'],
        enabled: false,
        source: 'function () {}',
      },
      {
        id: 'comment-only',
        name: 'comment-only',
        type: 'inline',
        events: ['comment.created'],
        enabled: true,
        source: 'function () {}',
      },
      {
        id: 'task-deep',
        name: 'task-deep',
        type: 'inline',
        events: ['task.**'],
        enabled: true,
        source: 'function () {}',
      },
    ])

    expect(matchesCallbackEventPattern('task.*', 'task.created')).toBe(true)
    expect(matchesCallbackEventPattern('task.**', 'task.created.deep')).toBe(true)
    expect(matchesCallbackEventPattern('task.created', 'task.updated')).toBe(false)
    expect(matchesCallbackEventPattern('', 'task.created')).toBe(false)

    expect(buildCallbackExecutionPlan(handlers, 'task.created').map((handler) => handler.id)).toEqual([
      'task-star',
      'double-star',
      'task-deep',
    ])
  })

  it('keeps configured module specifiers stable while allowing host-specific runtime resolution', () => {
    expect(resolveCallbackModuleTarget(' ./callbacks/task-created ', {
      workspaceRoot: '/workspace/project',
    })).toEqual({
      configuredSpecifier: './callbacks/task-created',
      runtimeSpecifier: path.resolve('/workspace/project', './callbacks/task-created'),
    })

    expect(resolveCallbackModuleTarget(' callback-package/handlers ', {
      workspaceRoot: '/workspace/project',
    })).toEqual({
      configuredSpecifier: 'callback-package/handlers',
      runtimeSpecifier: 'callback-package/handlers',
    })

    const revisionA = createDurableCallbackHandlerRevision(buildCallbackHandlerRevisionInput({
      type: 'module',
      events: ['task.updated', 'task.created', 'task.created'],
      module: ' ./callbacks/task-created ',
      handler: ' onTaskCreated ',
    }))
    const revisionB = createDurableCallbackHandlerRevision(buildCallbackHandlerRevisionInput({
      type: 'module',
      events: ['task.created', 'task.updated'],
      module: './callbacks/task-created',
      handler: 'onTaskCreated',
    }))

    expect(revisionA).toBe(revisionB)
  })

  it('uses shared export validation with an explicit Node-only bare default opt-in', () => {
    const namedDefault = assertCallableCallbackModuleExport(
      { default: () => 'default-ok', onTaskCreated: () => 'named-ok' },
      './callbacks/task-created',
      'default',
    )
    expect(namedDefault()).toBe('default-ok')

    const bareDefault = function bareDefault(): string {
      return 'bare-default-ok'
    }

    expect(() => assertCallableCallbackModuleExport(
      bareDefault,
      './callbacks/task-created',
      'default',
    )).toThrow(
      "Configured callback.runtime module './callbacks/task-created' does not export the callable named handler 'default'.",
    )

    expect(assertCallableCallbackModuleExport(
      bareDefault,
      './callbacks/task-created',
      'default',
      { allowBareFunctionDefault: true },
    )()).toBe('bare-default-ok')

    const inherited = Object.create({
      onTaskCreated() {
        return 'prototype-only'
      },
    }) as Record<string, unknown>

    expect(() => assertCallableCallbackModuleExport(
      inherited,
      './callbacks/task-created',
      'onTaskCreated',
    )).toThrow(
      "Configured callback.runtime module './callbacks/task-created' does not export the callable named handler 'onTaskCreated'.",
    )
  })
})
