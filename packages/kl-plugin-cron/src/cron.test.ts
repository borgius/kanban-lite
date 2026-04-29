import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { EventBus } from 'kanban-lite/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CronListenerPlugin,
  getCronRuntimeEventDeclarations,
  optionsSchemas,
  pluginManifest,
} from './index'

function createTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kl-plugin-cron-'))
}

function writeConfig(workspaceRoot: string, config: Record<string, unknown>): void {
  fs.writeFileSync(path.join(workspaceRoot, '.kanban.json'), JSON.stringify(config, null, 2), 'utf-8')
}

describe('cron plugin manifest', () => {
  it('advertises the cron provider for cron.runtime', () => {
    expect(pluginManifest.id).toBe('kl-plugin-cron')
    expect(pluginManifest.capabilities['cron.runtime']).toEqual(['cron'])
    expect(pluginManifest.integrations).toContain('event.listener')
  })
})

describe('cron options schema', () => {
  it('uses an explicit array uiSchema and validates cron strings before save', async () => {
    const metadata = optionsSchemas.cron()
    const eventsControl = ((metadata.uiSchema as {
      elements?: Array<{ elements?: Array<{ options?: { showSortButtons?: boolean; elementLabelProp?: string } }> }>
    }).elements ?? [])[0]?.elements?.[0]

    expect(eventsControl?.options?.showSortButtons).toBe(true)
    expect(eventsControl?.options?.elementLabelProp).toBe('name')

    expect(() => metadata.beforeSave?.({
      events: [{ name: 'Broken', cron: 'not a cron', event: 'schedule.broken' }],
    }, {
      capability: 'cron.runtime',
      providerId: 'cron',
      sdk: {} as never,
      isActivating: true,
    })).toThrow(/Invalid cron expression/)
  })
})

describe('cron runtime scheduling', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('emits configured cron events once per tick, dedupes duplicate register calls, and clears timers on unregister', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-01T00:00:00.000Z'))

    const workspaceRoot = createTempWorkspace()
    writeConfig(workspaceRoot, {
      plugins: {
        'cron.runtime': {
          provider: 'cron',
          options: {
            events: [
              { name: 'Every second', cron: '* * * * * *', event: 'schedule.every-second' },
            ],
          },
        },
      },
    })

    const bus = new EventBus()
    const plugin = new CronListenerPlugin(workspaceRoot)
    const received: string[] = []
    const unsubscribe = bus.onAny((eventName) => {
      received.push(eventName)
    })

    try {
      expect(getCronRuntimeEventDeclarations(workspaceRoot)).toEqual([
        {
          event: 'schedule.every-second',
          phase: 'after',
          resource: 'cron',
          label: 'Every second',
          apiAfter: true,
        },
      ])

      plugin.register(bus)
      plugin.register(bus)

      await vi.advanceTimersByTimeAsync(1000)
      expect(received).toEqual(['schedule.every-second'])

      plugin.unregister()
      await vi.advanceTimersByTimeAsync(2000)
      expect(received).toEqual(['schedule.every-second'])
    } finally {
      unsubscribe()
      plugin.unregister()
      fs.rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })
})
