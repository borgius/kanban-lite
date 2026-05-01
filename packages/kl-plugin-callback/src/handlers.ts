import * as childProcess from 'node:child_process'
import { createRequire } from 'node:module'
import * as path from 'node:path'
import { readConfig } from 'kanban-lite/sdk'
import type {
  AfterEventPayload,
  EventBus,
  KanbanSDK,
  PluginSettingsOptionsSchemaMetadata,
  SDKEventListenerPlugin,
} from 'kanban-lite/sdk'

export type {
  KanbanSDK,
  PluginSettingsOptionsSchemaMetadata,
  SDKEventListenerPlugin,
} from 'kanban-lite/sdk'

export type CallbackHandlerType = 'inline' | 'module' | 'process'

export interface CallbackHandlerConfig {
  /** Optional stable identifier for idempotency tracking in module handler callbacks. */
  readonly id?: string
  /** Human-friendly row label shown in shared plugin settings surfaces. */
  readonly name: string
  /** Whether the handler runs inline, loads a module file, or spawns a subprocess. */
  readonly type: CallbackHandlerType
  /** One or more committed after-events that should trigger this handler. */
  readonly events: readonly string[]
  /** Disable a handler without removing its configuration. */
  readonly enabled: boolean
  /** Inline JavaScript source used when `type === "inline"`. */
  readonly source?: string
  /** Relative or absolute path to a CommonJS or ESM module used when `type === "module"`. */
  readonly module?: string
  /** Named export from the module to invoke. Defaults to `"default"` when omitted. */
  readonly handler?: string
  /** Executable launched when `type === "process"`. */
  readonly command?: string
  /** Optional argv passed to the subprocess. */
  readonly args?: readonly string[]
  /** Optional working directory for subprocess execution. */
  readonly cwd?: string
}

export interface CallbackPluginOptions {
  readonly handlers?: readonly CallbackHandlerConfig[]
}

export interface CallbackProcessEnvelope {
  readonly event: AfterEventPayload<unknown>
}

export interface CallbackRuntimeContext {
  readonly workspaceRoot: string
  readonly sdk: KanbanSDK
}

export type CallbackPluginOptionsSchemaFactory = (sdk?: KanbanSDK) => PluginSettingsOptionsSchemaMetadata

export const CALLBACK_PROVIDER_ID = 'callbacks'
export const CALLBACK_PACKAGE_ID = 'kl-plugin-callback'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isCallbackHandlerType(value: unknown): value is CallbackHandlerType {
  return value === 'inline' || value === 'module' || value === 'process'
}

export function isAfterEventPayload(value: unknown): value is AfterEventPayload<unknown> {
  return isRecord(value)
    && isNonEmptyString(value.event)
    && 'data' in value
    && isNonEmptyString(value.timestamp)
}

function logCallbackFailure(handlerName: string, eventName: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  console.error(
    `[kl-plugin-callback] handler "${handlerName}" failed for event "${eventName}"`,
    message,
  )
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => isNonEmptyString(entry)).map((entry) => entry.trim())
}

function normalizeCallbackHandler(raw: unknown, index: number): CallbackHandlerConfig | null {
  if (!isRecord(raw)) {
    console.error(`[kl-plugin-callback] ignoring invalid handler at index ${index}`)
    return null
  }

  const name = isNonEmptyString(raw.name) ? raw.name.trim() : ''
  const type = raw.type
  const events = normalizeStringArray(raw.events)
  const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : true
  if (!name || !isCallbackHandlerType(type) || events.length === 0) {
    console.error(`[kl-plugin-callback] ignoring invalid handler at index ${index}`)
    return null
  }

  const normalized: CallbackHandlerConfig = {
    name,
    type,
    events,
    enabled,
    ...(isNonEmptyString(raw.id) ? { id: raw.id } : {}),
    ...(isNonEmptyString(raw.source) ? { source: raw.source } : {}),
    ...(isNonEmptyString(raw.module) ? { module: raw.module } : {}),
    ...(isNonEmptyString(raw.handler) ? { handler: raw.handler } : {}),
    ...(isNonEmptyString(raw.command) ? { command: raw.command } : {}),
    ...(Array.isArray(raw.args) ? { args: normalizeStringArray(raw.args) } : {}),
    ...(isNonEmptyString(raw.cwd) ? { cwd: raw.cwd } : {}),
  }

  return normalized
}

function readCallbackHandlers(workspaceRoot: string): CallbackHandlerConfig[] {
  const handlers = readConfig(workspaceRoot).plugins?.['callback.runtime']?.options?.handlers
  if (!Array.isArray(handlers)) return []

  return handlers
    .map((handler, index) => normalizeCallbackHandler(handler, index))
    .filter((handler): handler is CallbackHandlerConfig => handler !== null)
}

function matchesEventPattern(pattern: string, eventName: string): boolean {
  const candidate = pattern.trim()
  if (!candidate) return false
  if (candidate === '*' || candidate === '**') return true

  const patternSegments = candidate.split('.')
  const eventSegments = eventName.split('.')

  const matchSegments = (patternIndex: number, eventIndex: number): boolean => {
    while (patternIndex < patternSegments.length) {
      const segment = patternSegments[patternIndex]
      if (segment === '**') {
        if (patternIndex === patternSegments.length - 1) return true
        for (let nextEventIndex = eventIndex; nextEventIndex <= eventSegments.length; nextEventIndex += 1) {
          if (matchSegments(patternIndex + 1, nextEventIndex)) return true
        }
        return false
      }

      if (eventIndex >= eventSegments.length) return false
      if (segment !== '*' && segment !== eventSegments[eventIndex]) return false
      patternIndex += 1
      eventIndex += 1
    }

    return eventIndex === eventSegments.length
  }

  return matchSegments(0, 0)
}

function matchesHandlerEvent(handler: CallbackHandlerConfig, eventName: string): boolean {
  return handler.enabled && handler.events.some((pattern) => matchesEventPattern(pattern, eventName))
}

function resolveHandlerCwd(workspaceRoot: string, cwd?: string): string {
  if (!cwd) return workspaceRoot
  return path.isAbsolute(cwd) ? cwd : path.resolve(workspaceRoot, cwd)
}

function compileInlineHandler(source: string): (input: { event: AfterEventPayload<unknown>; sdk: KanbanSDK }) => unknown {
  const compiled = new Function(`return (${source})`)() as unknown
  if (typeof compiled !== 'function') {
    throw new Error('Inline handler source must evaluate to a function.')
  }
  return compiled as (input: { event: AfterEventPayload<unknown>; sdk: KanbanSDK }) => unknown
}

async function executeInlineHandler(
  handler: CallbackHandlerConfig,
  event: AfterEventPayload<unknown>,
  sdk: KanbanSDK | null,
): Promise<void> {
  if (!isNonEmptyString(handler.source)) {
    throw new Error('Inline handlers require a non-empty source string.')
  }
  if (!sdk) {
    throw new Error('Inline handlers require an attached SDK runtime context.')
  }

  const executable = compileInlineHandler(handler.source)
  await executable({ event, sdk })
}

async function executeModuleHandler(
  handler: CallbackHandlerConfig,
  event: AfterEventPayload<unknown>,
  workspaceRoot: string,
  sdk: KanbanSDK | null,
): Promise<void> {
  if (!isNonEmptyString(handler.module)) {
    throw new Error('Module handlers require a non-empty module path.')
  }
  if (!sdk) {
    throw new Error('Module handlers require an attached SDK runtime context.')
  }

  const modulePath = path.isAbsolute(handler.module)
    ? handler.module
    : path.resolve(workspaceRoot, handler.module)

  const moduleRequire = createRequire(modulePath)
  const loaded = moduleRequire(modulePath) as Record<string, unknown>
  const exportName = isNonEmptyString(handler.handler) ? handler.handler : 'default'
  const fn = loaded[exportName]

  if (typeof fn !== 'function') {
    throw new Error(`Module handler export "${exportName}" is not a function in ${modulePath}`)
  }

  const callback = {
    handlerId: isNonEmptyString(handler.id) ? handler.id : handler.name,
    eventId: event.timestamp,
  }

  await (fn as (input: { event: AfterEventPayload<unknown>; sdk: KanbanSDK; callback: typeof callback }) => unknown)({ event, sdk, callback })
}

async function executeProcessHandler(
  handler: CallbackHandlerConfig,
  event: AfterEventPayload<unknown>,
  workspaceRoot: string,
): Promise<void> {
  const command = handler.command
  if (!isNonEmptyString(command)) {
    throw new Error('Process handlers require a non-empty command.')
  }

  const envelope: CallbackProcessEnvelope = { event }
  const payload = JSON.stringify(envelope)

  await new Promise<void>((resolve, reject) => {
    const child = childProcess.spawn(command, [...(handler.args ?? [])], {
      cwd: resolveHandlerCwd(workspaceRoot, handler.cwd),
      shell: false,
      stdio: 'pipe',
    })

    let settled = false
    let stderr = ''

    const settle = (error?: Error): void => {
      if (settled) return
      settled = true
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    }

    child.stdout?.resume()
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString()
    })
    child.once('error', (error: Error) => {
      settle(error)
    })
    child.once('close', (code: number | null, signal: NodeJS.Signals | null) => {
      if (code === 0) {
        settle()
        return
      }

      const detail = stderr.trim()
      settle(new Error(
        detail || `Process handler exited with ${signal ? `signal ${signal}` : `code ${String(code)}`}.`,
      ))
    })

    if (!child.stdin) {
      settle(new Error('Process handler did not expose stdin.'))
      return
    }

    child.stdin.once('error', (error: Error) => {
      settle(error)
    })
    child.stdin.end(payload)
  })
}

export async function runMatchingHandlers(input: {
  workspaceRoot: string
  sdk: KanbanSDK | null
  event: AfterEventPayload<unknown>
}): Promise<void> {
  const handlers = readCallbackHandlers(input.workspaceRoot)
    .filter((handler) => matchesHandlerEvent(handler, input.event.event))

  for (const handler of handlers) {
    try {
      if (handler.type === 'inline') {
        await executeInlineHandler(handler, input.event, input.sdk)
      } else if (handler.type === 'module') {
        await executeModuleHandler(handler, input.event, input.workspaceRoot, input.sdk)
      } else {
        await executeProcessHandler(handler, input.event, input.workspaceRoot)
      }
    } catch (error) {
      logCallbackFailure(handler.name, input.event.event, error)
    }
  }
}


export * from './schema'
