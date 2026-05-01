import { CronExpressionParser } from 'cron-parser'
import { readConfig } from 'kanban-lite/sdk'
import type {
  EventBus,
  SDKEventListenerPlugin,
  SDKPluginEventDeclaration,
} from 'kanban-lite/sdk'

export interface CronRuntimeEventConfig {
  readonly name: string
  readonly cron?: string
  readonly schedule?: string
  readonly event: string
}

const MAX_TIMEOUT_MS = 2_147_483_647

export const CRON_PROVIDER_ID = 'cron'
export const CRON_PACKAGE_ID = 'kl-plugin-cron'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function resolveCronExpression(event: Pick<CronRuntimeEventConfig, 'cron' | 'schedule'>): string {
  if (isNonEmptyString(event.cron)) return event.cron.trim()
  if (isNonEmptyString(event.schedule)) return event.schedule.trim()
  return ''
}

function normalizeCronRuntimeEvent(raw: unknown, index: number): CronRuntimeEventConfig | null {
  if (!isRecord(raw)) {
    console.error(`[kl-plugin-cron] ignoring invalid cron event at index ${index}`)
    return null
  }

  const name = isNonEmptyString(raw.name) ? raw.name.trim() : ''
  const event = isNonEmptyString(raw.event) ? raw.event.trim() : ''
  const cron = isNonEmptyString(raw.cron) ? raw.cron.trim() : undefined
  const schedule = isNonEmptyString(raw.schedule) ? raw.schedule.trim() : undefined
  const expression = resolveCronExpression({ cron, schedule })

  if (!name || !event || !expression) {
    console.error(`[kl-plugin-cron] ignoring invalid cron event at index ${index}`)
    return null
  }

  try {
    CronExpressionParser.parse(expression)
  } catch (error) {
    console.error(
      `[kl-plugin-cron] ignoring invalid cron expression for "${name}":`,
      error instanceof Error ? error.message : String(error),
    )
    return null
  }

  return {
    name,
    event,
    ...(cron ? { cron } : {}),
    ...(schedule ? { schedule } : {}),
  }
}

export function readCronRuntimeEvents(workspaceRoot: string): CronRuntimeEventConfig[] {
  const configuredEvents = readConfig(workspaceRoot).plugins?.['cron.runtime']?.options?.events
  if (!Array.isArray(configuredEvents)) return []

  return configuredEvents
    .map((entry, index) => normalizeCronRuntimeEvent(entry, index))
    .filter((entry): entry is CronRuntimeEventConfig => entry !== null)
}

export function getCronRuntimeEventDeclarations(workspaceRoot: string): SDKPluginEventDeclaration[] {
  const seenEvents = new Set<string>()
  const declarations: SDKPluginEventDeclaration[] = []

  for (const configuredEvent of readCronRuntimeEvents(workspaceRoot)) {
    if (seenEvents.has(configuredEvent.event)) continue
    seenEvents.add(configuredEvent.event)
    declarations.push({
      event: configuredEvent.event,
      phase: 'after',
      resource: 'cron',
      label: configuredEvent.name,
      apiAfter: true,
    })
  }

  return declarations
}

function createCronEventPayload(configuredEvent: CronRuntimeEventConfig): {
  type: string
  data: {
    event: string
    data: { name: string; schedule: string }
    timestamp: string
    meta: Record<string, string>
  }
  timestamp: string
  meta: Record<string, string>
} {
  const timestamp = new Date().toISOString()
  const schedule = resolveCronExpression(configuredEvent)
  const meta = {
    source: 'cron.runtime',
    providerId: CRON_PROVIDER_ID,
  }

  return {
    type: configuredEvent.event,
    data: {
      event: configuredEvent.event,
      data: {
        name: configuredEvent.name,
        schedule,
      },
      timestamp,
      meta,
    },
    timestamp,
    meta,
  }
}

function getNextDelayMs(expression: string, currentDate: Date): number {
  const nextRun = CronExpressionParser.parse(expression, { currentDate }).next().toDate()
  return Math.max(0, nextRun.getTime() - currentDate.getTime())
}

export class CronListenerPlugin implements SDKEventListenerPlugin {
  readonly manifest = {
    id: CRON_PACKAGE_ID,
    provides: ['event.listener'] as const,
  }

  private readonly _workspaceRoot: string
  private readonly _timers = new Map<string, ReturnType<typeof setTimeout>>()
  private _isRegistered = false

  constructor(workspaceRoot: string) {
    this._workspaceRoot = workspaceRoot
  }

  register(bus: EventBus): void {
    if (this._isRegistered) return
    this._isRegistered = true

    for (const configuredEvent of readCronRuntimeEvents(this._workspaceRoot)) {
      if (this._timers.has(configuredEvent.name)) continue
      this._scheduleConfiguredEvent(bus, configuredEvent)
    }
  }

  unregister(): void {
    this._isRegistered = false
    for (const timer of this._timers.values()) {
      clearTimeout(timer)
    }
    this._timers.clear()
  }

  private _scheduleConfiguredEvent(bus: EventBus, configuredEvent: CronRuntimeEventConfig): void {
    if (!this._isRegistered) return

    const expression = resolveCronExpression(configuredEvent)
    let delayMs = MAX_TIMEOUT_MS
    let isTruncatedDelay = false

    try {
      const nextDelayMs = getNextDelayMs(expression, new Date())
      isTruncatedDelay = nextDelayMs > MAX_TIMEOUT_MS
      delayMs = Math.min(nextDelayMs, MAX_TIMEOUT_MS)
    } catch (error) {
      console.error(
        `[kl-plugin-cron] unable to schedule "${configuredEvent.name}":`,
        error instanceof Error ? error.message : String(error),
      )
      return
    }

    const existing = this._timers.get(configuredEvent.name)
    if (existing) clearTimeout(existing)

    const timer = setTimeout(() => {
      this._timers.delete(configuredEvent.name)
      if (!this._isRegistered) return

      if (isTruncatedDelay) {
        this._scheduleConfiguredEvent(bus, configuredEvent)
        return
      }

      bus.emit(configuredEvent.event, createCronEventPayload(configuredEvent))
      this._scheduleConfiguredEvent(bus, configuredEvent)
    }, delayMs)

    this._timers.set(configuredEvent.name, timer)
  }
}
