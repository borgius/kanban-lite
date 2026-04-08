import * as path from 'node:path'

import { createDurableCallbackHandlerRevision } from './contract'

export type CallbackHandlerType = 'module' | 'inline' | 'process'

export interface CallbackHandlerConfig {
  /** Stable handler identifier used for durable callback claims and idempotency. */
  readonly id: string
  /** Human-friendly row label shown in shared plugin settings surfaces. */
  readonly name: string
  /** Whether the handler uses the shared module contract, trusted inline code, or a subprocess. */
  readonly type: CallbackHandlerType
  /** One or more committed after-events that should trigger this handler. */
  readonly events: readonly string[]
  /** Disable a handler without removing its configuration. */
  readonly enabled: boolean
  /** Shared cross-host module specifier used when `type === "module"`. */
  readonly module?: string
  /** Named export invoked from `module` when `type === "module"`. */
  readonly handler?: string
  /** Inline JavaScript source used when `type === "inline"`. */
  readonly source?: string
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

export interface CallbackModuleTarget {
  /** Canonical configured module specifier that remains stable across hosts. */
  readonly configuredSpecifier: string
  /** Host-specific runtime lookup request, such as a workspace-resolved Node path. */
  readonly runtimeSpecifier: string
}

export interface NormalizeCallbackHandlersOptions {
  /** Receives non-fatal validation issues for ignored or duplicate handlers. */
  readonly onError?: (message: string) => void
}

export interface AssertCallableCallbackModuleExportOptions {
  /**
   * Node-only compatibility escape hatch for CommonJS modules that export the
   * handler function directly via `module.exports = function () {}`.
   */
  readonly allowBareFunctionDefault?: boolean
}

/** Supported callback row execution modes shared across runtime hosts. */
export const CALLBACK_HANDLER_TYPES = ['module', 'inline', 'process'] as const

type CallbackHandlerIdentitySource = 'configured' | 'legacy-derived'

interface NormalizedCallbackHandlerConfig extends CallbackHandlerConfig {
  readonly identitySource: CallbackHandlerIdentitySource
}

interface CallbackHandlerRevisionFingerprintSource {
  readonly type: CallbackHandlerType
  readonly events: readonly string[]
  readonly module?: string
  readonly handler?: string
  readonly source?: string
  readonly command?: string
  readonly args?: readonly string[]
  readonly cwd?: string
}

const CALLBACK_LEGACY_HANDLER_ID_PREFIX = 'legacy-handler'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isCallbackHandlerType(value: unknown): value is CallbackHandlerType {
  return value === 'module' || value === 'inline' || value === 'process'
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => isNonEmptyString(entry)).map((entry) => entry.trim())
}

function normalizeCallbackEventPatterns(events: readonly string[]): string[] {
  return [...new Set(events.map((event) => event.trim()).filter((event) => event.length > 0))]
    .sort((left, right) => left.localeCompare(right))
}

/**
 * Builds the stable fingerprint payload used for durable callback handler
 * revisions and legacy content-derived ids.
 */
export function buildCallbackHandlerRevisionInput(
  handler: CallbackHandlerRevisionFingerprintSource,
): Record<string, unknown> {
  if (handler.type === 'module') {
    return {
      type: handler.type,
      events: normalizeCallbackEventPatterns(handler.events),
      module: resolveCallbackModuleTarget(handler.module ?? '').configuredSpecifier,
      handler: handler.handler?.trim() ?? '',
    }
  }

  if (handler.type === 'inline') {
    return {
      type: handler.type,
      events: normalizeCallbackEventPatterns(handler.events),
      source: handler.source?.trim() ?? '',
    }
  }

  return {
    type: handler.type,
    events: normalizeCallbackEventPatterns(handler.events),
    command: handler.command?.trim() ?? '',
    args: [...(handler.args ?? [])],
    cwd: handler.cwd?.trim() ?? '',
  }
}

function buildLegacyCallbackHandlerIdentityInput(
  handler: Omit<CallbackHandlerConfig, 'id'>,
): Record<string, unknown> {
  return {
    name: handler.name,
    enabled: handler.enabled,
    ...buildCallbackHandlerRevisionInput(handler),
  }
}

function createLegacyCallbackHandlerId(handler: Omit<CallbackHandlerConfig, 'id'>): string {
  return `${CALLBACK_LEGACY_HANDLER_ID_PREFIX}-${createDurableCallbackHandlerRevision(
    buildLegacyCallbackHandlerIdentityInput(handler),
  ).replace(/^sha256:/, '')}`
}

function normalizeCallbackHandler(
  raw: unknown,
  index: number,
  options?: NormalizeCallbackHandlersOptions,
): NormalizedCallbackHandlerConfig | null {
  if (!isRecord(raw)) {
    options?.onError?.(`ignoring invalid handler at index ${index}`)
    return null
  }

  const name = isNonEmptyString(raw.name) ? raw.name.trim() : ''
  const type = raw.type
  const events = normalizeStringArray(raw.events)
  const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : true

  if (!name || !isCallbackHandlerType(type) || events.length === 0) {
    options?.onError?.(`ignoring invalid handler at index ${index}`)
    return null
  }

  const moduleSpecifier = isNonEmptyString(raw.module) ? raw.module.trim() : ''
  const exportName = isNonEmptyString(raw.handler) ? raw.handler.trim() : ''

  if (type === 'module' && enabled && (!moduleSpecifier || !exportName)) {
    throw new Error('Enabled callback.runtime module handlers require non-empty module and handler strings.')
  }

  const normalizedWithoutId: Omit<CallbackHandlerConfig, 'id'> = {
    name,
    type,
    events,
    enabled,
    ...(type === 'module' && moduleSpecifier && exportName
      ? {
          module: resolveCallbackModuleTarget(moduleSpecifier).configuredSpecifier,
          handler: exportName,
        }
      : {}),
    ...(type === 'inline' && isNonEmptyString(raw.source) ? { source: raw.source } : {}),
    ...(type === 'process' && isNonEmptyString(raw.command) ? { command: raw.command } : {}),
    ...(Array.isArray(raw.args) ? { args: normalizeStringArray(raw.args) } : {}),
    ...(isNonEmptyString(raw.cwd) ? { cwd: raw.cwd } : {}),
  }

  if (type === 'module' && (!normalizedWithoutId.module || !normalizedWithoutId.handler)) {
    options?.onError?.(`ignoring invalid handler at index ${index}`)
    return null
  }

  const explicitId = isNonEmptyString(raw.id) ? raw.id.trim() : null
  return {
    ...normalizedWithoutId,
    id: explicitId ?? createLegacyCallbackHandlerId(normalizedWithoutId),
    identitySource: explicitId ? 'configured' : 'legacy-derived',
  }
}

/**
 * Normalizes raw callback rows into durable-ready handler configs.
 *
 * Generic malformed rows are ignored via {@link NormalizeCallbackHandlersOptions.onError},
 * while malformed enabled `type: "module"` rows fail closed because they must
 * remain portable across Node and Cloudflare callback runtimes.
 */
export function normalizeCallbackHandlers(
  rawHandlers: unknown,
  options?: NormalizeCallbackHandlersOptions,
): CallbackHandlerConfig[] {
  if (!Array.isArray(rawHandlers)) return []

  const normalizedHandlers = rawHandlers
    .map((handler, index) => normalizeCallbackHandler(handler, index, options))
    .filter((handler): handler is NormalizedCallbackHandlerConfig => handler !== null)

  const normalizedIdentityCounts = new Map<string, number>()
  for (const handler of normalizedHandlers) {
    normalizedIdentityCounts.set(handler.id, (normalizedIdentityCounts.get(handler.id) ?? 0) + 1)
  }

  return normalizedHandlers.filter((handler) => {
    if ((normalizedIdentityCounts.get(handler.id) ?? 0) <= 1) return true

    if (handler.identitySource === 'configured') {
      options?.onError?.(
        `refusing durable callback claims for configured handler "${handler.name}" because multiple handlers resolve to configured id "${handler.id}". Keep configured handler ids unique to keep durable callback claims deterministic.`,
      )
      return false
    }

    options?.onError?.(
      `refusing durable callback claims for legacy handler "${handler.name}" because multiple handlers resolve to derived id "${handler.id}". Add an explicit id to each handler to keep durable callback claims deterministic.`,
    )
    return false
  })
}

/** Matches a callback event mask such as `task.*` or `task.**` against an event name. */
export function matchesCallbackEventPattern(pattern: string, eventName: string): boolean {
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

/**
 * Returns the ordered handler execution plan for a committed after-event.
 *
 * The original handler order is preserved so hosts can share deterministic
 * matching semantics while keeping transport-specific execution separate.
 */
export function buildCallbackExecutionPlan(
  handlers: readonly CallbackHandlerConfig[],
  eventName: string,
): CallbackHandlerConfig[] {
  return handlers.filter(
    (handler) => handler.enabled && handler.events.some((pattern) => matchesCallbackEventPattern(pattern, eventName)),
  )
}

/**
 * Resolves a shared callback module specifier into a stable configured identity
 * plus the host-specific runtime lookup request.
 *
 * Relative specifiers stay unchanged as configuration identity while Node can
 * still resolve them from the workspace root at execution time.
 */
export function resolveCallbackModuleTarget(
  moduleSpecifier: string,
  options?: { readonly workspaceRoot?: string },
): CallbackModuleTarget {
  const configuredSpecifier = isNonEmptyString(moduleSpecifier) ? moduleSpecifier.trim() : ''
  if (!configuredSpecifier) {
    throw new Error('Module handlers require a non-empty module specifier.')
  }

  const runtimeSpecifier = options?.workspaceRoot && (
    configuredSpecifier.startsWith('.') || path.isAbsolute(configuredSpecifier)
  )
    ? path.resolve(options.workspaceRoot, configuredSpecifier)
    : configuredSpecifier

  return {
    configuredSpecifier,
    runtimeSpecifier,
  }
}

type CallbackModuleExecutable = (...args: never[]) => unknown

/**
 * Resolves and validates the callable export for a configured callback module.
 *
 * By default this requires an own callable export on the loaded module object.
 * Node may explicitly opt into the legacy CommonJS `module.exports = function`
 * default behavior through `allowBareFunctionDefault`.
 */
export function assertCallableCallbackModuleExport<TExecutable extends CallbackModuleExecutable>(
  candidate: unknown,
  moduleSpecifier: string,
  exportName: string,
  options?: AssertCallableCallbackModuleExportOptions,
): TExecutable {
  const resolvedModuleSpecifier = isNonEmptyString(moduleSpecifier) ? moduleSpecifier.trim() : moduleSpecifier
  const resolvedExportName = isNonEmptyString(exportName) ? exportName.trim() : ''

  if (!resolvedExportName) {
    throw new Error('Module handlers require a non-empty named export.')
  }

  if (options?.allowBareFunctionDefault && resolvedExportName === 'default' && typeof candidate === 'function') {
    return candidate as TExecutable
  }

  if ((typeof candidate === 'function' || isRecord(candidate))
    && Object.prototype.hasOwnProperty.call(Object(candidate), resolvedExportName)) {
    const executable = (Object(candidate) as Record<string, unknown>)[resolvedExportName]
    if (typeof executable === 'function') {
      return executable as TExecutable
    }
  }

  throw new Error(
    `Configured callback.runtime module '${resolvedModuleSpecifier}' does not export the callable named handler '${resolvedExportName}'.`,
  )
}
