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

/**
 * Returns true when the current runtime is a Cloudflare Workers isolate.
 * In that environment, timer-based scheduling is not viable because isolates
 * are short-lived and wake up only on inbound events. Native cron scheduling
 * is handled instead via the Worker `scheduled` export.
 */
export function isCloudflareWorkersEnvironment(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers'
}

/**
 * Pool of rare placeholder cron expressions used as no-op slots in the CF
 * Workers schedule pool. All fire only on Feb 29 (leap day), so they never
 * fire in practice. Must stay in sync with CRON_POOL_DEFAULTS in
 * deploy-cloudflare-worker.mjs.
 */
export const CRON_POOL_DEFAULTS = [
  '0 0 29 2 *',
  '1 0 29 2 *',
  '2 0 29 2 *',
  '3 0 29 2 *',
  '4 0 29 2 *',
  '5 0 29 2 *',
  '6 0 29 2 *',
  '7 0 29 2 *',
  '8 0 29 2 *',
  '9 0 29 2 *',
] as const

export interface CronCloudflareContext {
  readonly accountId: string
  readonly apiToken: string
  readonly scriptName: string
}

let _cfContext: CronCloudflareContext | null = null

/**
 * Inject Cloudflare credentials so that `syncCronSchedulesToCloudflare` can
 * call the CF Schedules API. Call this at the start of each Worker request
 * using values from the `env` parameter. Pass `null` to clear.
 */
export function setCronCloudflareContext(ctx: CronCloudflareContext | null): void {
  _cfContext = ctx
}

/**
 * Sync user cron expressions to the running Cloudflare Worker's schedule pool
 * via the CF Schedules REST API. The first N expressions fill the pool slots;
 * remaining slots are reset to the rare leap-day defaults. Silently skips if
 * no CF context has been injected via `setCronCloudflareContext`.
 */
export async function syncCronSchedulesToCloudflare(userExpressions: string[]): Promise<void> {
  const ctx = _cfContext
  if (!ctx?.accountId || !ctx?.apiToken || !ctx?.scriptName) return

  const userSlots = userExpressions.slice(0, CRON_POOL_DEFAULTS.length)
  const schedules = [
    ...userSlots,
    ...CRON_POOL_DEFAULTS.slice(userSlots.length),
  ].map((cron) => ({ cron }))

  const url = `https://api.cloudflare.com/client/v4/accounts/${ctx.accountId}/workers/scripts/${ctx.scriptName}/schedules`
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ctx.apiToken}`,
    },
    body: JSON.stringify(schedules),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`CF Schedules API error ${response.status}: ${body}`)
  }
}

/**
 * Emit events for every configured cron entry whose expression matches
 * `cronExpression`. Intended for use inside a Cloudflare Worker `scheduled`
 * handler where the platform supplies the triggered cron string.
 */
export function handleCloudflareScheduledEvent(
  workspaceRoot: string,
  cronExpression: string,
  bus: EventBus,
): void {
  const configuredEvents = readCronRuntimeEvents(workspaceRoot)
  for (const configuredEvent of configuredEvents) {
    const expression = resolveCronExpression(configuredEvent)
    if (expression === cronExpression) {
      bus.emit(configuredEvent.event, createCronEventPayload(configuredEvent))
    }
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

    if (isCloudflareWorkersEnvironment()) {
      // Cloudflare Workers isolates are short-lived and do not support
      // persistent timers. Cron scheduling is handled natively by the
      // platform via the Worker `scheduled` export and
      // handleCloudflareScheduledEvent(). Nothing to set up here.
      return
    }

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
