import { describe, expect, it } from 'vitest'

import {
  assertCloudflareCallbackModuleRegistry,
  getConfiguredCallbackModuleHandlers,
} from '../cloudflare'

describe('cloudflare callback module helpers', () => {
  it('fails closed on malformed enabled module rows through the shared callback core', () => {
    expect(() => getConfiguredCallbackModuleHandlers({
      plugins: {
        'callback.runtime': {
          provider: 'cloudflare',
          options: {
            handlers: [
              {
                id: 'bad-module',
                name: 'bad-module',
                type: 'module',
                events: ['task.created'],
                enabled: true,
                handler: 'onTaskCreated',
              },
            ],
          },
        },
      },
    })).toThrow('Enabled Cloudflare callback.runtime module handler at index 0 requires non-empty module and handler strings.')
  })

  it('keeps Node-only bare defaults and inherited exports out of the Cloudflare module registry contract', () => {
    const config = {
      plugins: {
        'callback.runtime': {
          provider: 'cloudflare',
          options: {
            handlers: [
              {
                id: 'default-handler',
                name: 'default-handler',
                type: 'module',
                events: ['task.created'],
                enabled: true,
                module: './callbacks/task-created',
                handler: 'default',
              },
              {
                id: 'named-handler',
                name: 'named-handler',
                type: 'module',
                events: ['task.created'],
                enabled: true,
                module: './callbacks/task-created',
                handler: 'onTaskCreated',
              },
            ],
          },
        },
      },
    } satisfies Record<string, unknown>

    expect(() => assertCloudflareCallbackModuleRegistry(config, {
      './callbacks/task-created': function bareDefault(): string {
        return 'node-only-default'
      },
    })).toThrow(
      "Configured callback.runtime module './callbacks/task-created' does not export the callable named handler 'default'.",
    )

    expect(() => assertCloudflareCallbackModuleRegistry(config, {
      './callbacks/task-created': Object.assign(
        Object.create({
          onTaskCreated() {
            return 'prototype-only'
          },
        }),
        {
          default() {
            return 'default-ok'
          },
        },
      ),
    })).toThrow(
      "Configured callback.runtime module './callbacks/task-created' does not export the callable named handler 'onTaskCreated'.",
    )
  })
})
