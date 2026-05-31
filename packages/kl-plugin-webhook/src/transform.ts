import type { WebhookHeader } from 'kanban-lite/sdk'
import { debugLog } from './helpers'

/**
 * Payload post-processing helpers for `kl-plugin-webhook`.
 *
 * Two capabilities live here:
 *
 * 1. **jq transform** — an optional jq expression configured per webhook is
 *    applied to the JSON delivery envelope before it is sent. jq runs through
 *    [`jq-web`](https://github.com/stainless-api/jq-web), a WebAssembly build of
 *    jq that works in Node.js, the browser, and Cloudflare Workers.
 * 2. **env/secret injection** — custom header values may embed `${ENV_VAR}`
 *    placeholders that are resolved from the delivery runtime environment at
 *    send time, so env-backed secrets are never persisted in `.kanban.json`.
 */

type JqInstance = {
  json(input: unknown, filter: string): unknown | Promise<unknown>
}

let _jqInstance: Promise<JqInstance> | null = null

/**
 * Lazily loads and caches a jq-web instance.
 *
 * Supports both the original `jq-web` API (the module export is a thenable that
 * resolves to an object with a `json` method) and the
 * [`stainless-api/jq-web`](https://github.com/stainless-api/jq-web) fork (the
 * default export is an async init function that returns the instance). The fork
 * is the recommended dependency for Cloudflare Worker runtimes.
 */
async function loadJq(): Promise<JqInstance> {
  if (!_jqInstance) {
    _jqInstance = (async (): Promise<JqInstance> => {
      const mod = await importJqModule()
      const candidate = (mod as { default?: unknown })?.default ?? mod
      // stainless-api/jq-web: default export is an init function.
      if (typeof candidate === 'function') {
        return (await (candidate as () => Promise<JqInstance>)()) as JqInstance
      }
      // Already a ready instance (e.g. resolved CommonJS export).
      if (isJqInstance(candidate)) {
        return candidate
      }
      // fiatjaf/jq-web: module export is a thenable resolving to the instance.
      return (await (candidate as Promise<JqInstance>)) as JqInstance
    })().catch((err) => {
      _jqInstance = null
      throw err
    })
  }
  return _jqInstance
}

function isJqInstance(value: unknown): value is JqInstance {
  return Boolean(value) && typeof (value as { json?: unknown }).json === 'function'
}

/**
 * Loads the `jq-web` module across runtimes. In Node.js the package is a
 * CommonJS module whose export is a thenable instance, so it is loaded through
 * the native `require` (the plugin ships a CommonJS build) to avoid ESM
 * namespace interop pitfalls. In ESM-only runtimes (browser bundlers,
 * Cloudflare Workers, the stainless-api fork) `require` is unavailable and a
 * dynamic `import()` is used instead.
 */
async function importJqModule(): Promise<unknown> {
  const nodeRequire =
    typeof require === 'function' ? (require as (id: string) => unknown) : undefined
  if (nodeRequire) {
    try {
      return nodeRequire('jq-web')
    } catch {
      // Resolution failed under CommonJS — fall through to dynamic import.
    }
  }
  return import('jq-web')
}

/**
 * Applies a jq expression to a payload object and returns the transformed value.
 *
 * The input is the parsed JSON delivery envelope. The returned value becomes the
 * new delivery body. Throws when jq-web cannot be loaded or the expression is
 * invalid so callers can decide how to handle the failure.
 *
 * @param input - The payload object to transform.
 * @param expression - A jq filter expression (e.g. `'{ text: .event }'`).
 */
export async function applyJqTransform(input: unknown, expression: string): Promise<unknown> {
  const jq = await loadJq()
  // jq.json may return synchronously or as a promise depending on the build.
  return await jq.json(input, expression)
}

const ENV_PLACEHOLDER = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g

/**
 * Resolves `${ENV_VAR}` placeholders in a string against the provided
 * environment map, using the same lookup convention as the core config loader
 * (`resolveConfigEnvVars`): the `KL_`-prefixed variant is checked first so
 * operators can scope secrets to this process without clashing with bare
 * third-party variable names (e.g. `${GITHUB_TOKEN}` checks `KL_GITHUB_TOKEN`
 * then `GITHUB_TOKEN`).
 *
 * Unlike the config loader, an unknown variable resolves to an empty string
 * (with a debug log) instead of throwing, so a single missing secret never
 * drops a webhook delivery.
 *
 * @param value - The raw string that may contain `${ENV_VAR}` placeholders.
 * @param env - Environment map (defaults to `process.env`).
 */
export function resolveEnvPlaceholders(
  value: string,
  env: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {}
): string {
  return value.replace(ENV_PLACEHOLDER, (_match, name: string) => {
    const prefixedKey = name.startsWith('KL_') ? name : `KL_${name}`
    const resolved = env[prefixedKey] ?? env[name]
    if (resolved === undefined) {
      debugLog(`[kl-plugin-webhook] header env placeholder \${${name}} is not set; resolving to empty string`)
      return ''
    }
    return resolved
  })
}

/**
 * Converts a webhook's configured extra headers into a plain header map with
 * `${ENV_VAR}` placeholders resolved. Entries with blank names are skipped.
 *
 * @param headers - Configured header entries (name/value pairs).
 * @param env - Environment map used for placeholder resolution.
 */
export function resolveWebhookHeaders(
  headers: WebhookHeader[] | undefined,
  env: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {}
): Record<string, string> {
  const resolved: Record<string, string> = {}
  if (!Array.isArray(headers)) return resolved
  for (const header of headers) {
    const name = typeof header?.name === 'string' ? header.name.trim() : ''
    if (!name) continue
    const rawValue = typeof header?.value === 'string' ? header.value : ''
    resolved[name] = resolveEnvPlaceholders(rawValue, env)
  }
  return resolved
}

/**
 * A representative webhook delivery envelope used to preview and test jq
 * transform expressions before saving a webhook. Mirrors the shape produced by
 * {@link fireWebhooks} for a `task.created` event.
 */
export const SAMPLE_WEBHOOK_PAYLOAD = {
  event: 'task.created',
  timestamp: '2026-02-24T12:00:00.000Z',
  actor: { subject: 'user:alice', roles: ['admin'] },
  boardId: 'board-1',
  meta: { source: 'api' },
  data: {
    id: 'card-42',
    title: 'Investigate webhook delivery',
    status: 'in-progress',
    priority: 'high',
    boardId: 'board-1',
    assignee: 'alice',
    metadata: { company: 'Acme', estimate: 3 },
  },
} as const
