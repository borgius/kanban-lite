/**
 * Request-scoped `readConfig()` cache.
 *
 * A single HTTP request (webview-sync, WebSocket init broadcast, etc.)
 * routinely triggers 5–10 `readConfig(workspaceRoot)` calls: `getSettings`,
 * `listColumns`, `listBoards`, `getLabels`, `getMinimizedColumns`, the
 * `buildBaseInitMessage` body, per-handler `config.defaultBoard` lookups,
 * and so on. Each read can be a provider round-trip (e.g. Cloudflare KV) plus
 * JSON parsing, `.env` loading, `${VAR}` placeholder resolution, and a full
 * defaults merge. Coalescing them into one read per scope is a large
 * latency win on remote backends.
 *
 * Implementation notes:
 * - The cache is opt-in via `withConfigReadCache(fn)` so existing callers
 *   outside scoped request bodies are unaffected.
 * - Cache hits return `structuredClone(value)` to preserve the mutation-safe
 *   contract asserted by `config.test.ts` (each call returns fresh column
 *   objects).
 * - `writeConfig` calls `invalidateConfigReadCache()` so subsequent reads in
 *   the same scope see the new value.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import type { KanbanConfig } from './types'

interface ConfigReadCache {
  entry: KanbanConfig | undefined
  hasEntry: boolean
}

const storage = new AsyncLocalStorage<ConfigReadCache>()

/**
 * Runs `fn` inside a scope where repeated `readConfig()` calls share a single
 * cached result. Safe to nest: inner scopes get their own cache so mutations
 * remain scoped.
 */
export function withConfigReadCache<T>(fn: () => T | Promise<T>): Promise<T> {
  return Promise.resolve(storage.run({ entry: undefined, hasEntry: false }, fn))
}

/** @internal Returns the active cache, if any. */
export function peekConfigReadCache(): ConfigReadCache | undefined {
  return storage.getStore()
}

/** @internal Stores `value` as the cached read for the active scope. */
export function primeConfigReadCache(value: KanbanConfig): void {
  const cache = storage.getStore()
  if (!cache) return
  cache.entry = value
  cache.hasEntry = true
}

/**
 * Invalidates the current request-scoped cache so the next `readConfig()`
 * call re-reads from the provider. Called automatically by `writeConfig`.
 */
export function invalidateConfigReadCache(): void {
  const cache = storage.getStore()
  if (!cache) return
  cache.entry = undefined
  cache.hasEntry = false
}
