import * as path from 'path'
import { MarkdownStorageEngine } from './markdown'
import { SqliteStorageEngine } from './sqlite'
import type { StorageEngine, StorageEngineType, BootstrapConfig } from './types'

export { MarkdownStorageEngine } from './markdown'
export { SqliteStorageEngine } from './sqlite'
export type { StorageEngine, StorageEngineType, BootstrapConfig } from './types'

/**
 * Options for {@link createStorageEngine}.
 */
export interface CreateEngineOptions {
  /**
   * Override the engine type. When omitted the bootstrap config is read from
   * the minimal `.kanban.json` file at the workspace root.
   */
  storageEngine?: StorageEngineType
  /**
   * Path to the SQLite database file when using the `'sqlite'` engine.
   * If relative, it is resolved from `path.dirname(kanbanDir)` (workspace root).
   * @default '.kanban/kanban.db'
   */
  sqlitePath?: string
}

/**
 * Creates the appropriate {@link StorageEngine} for the given kanban directory.
 *
 * Resolution order for the engine type:
 * 1. `options.storageEngine` (explicit override)
 * 2. `storageEngine` field in `.kanban.json` (bootstrap config)
 * 3. `'markdown'` (default — backward-compatible)
 *
 * @param kanbanDir - Absolute path to the `.kanban` directory.
 * @param options   - Optional overrides for engine selection.
 * @returns An uninitialised {@link StorageEngine} instance. Call `.init()` before use.
 *
 * @example
 * ```ts
 * const engine = createStorageEngine('/path/to/.kanban')
 * await engine.init()
 * ```
 *
 * @example
 * ```ts
 * // Force SQLite
 * const engine = createStorageEngine('/path/to/.kanban', { storageEngine: 'sqlite' })
 * await engine.init()
 * ```
 */
export function createStorageEngine(
  kanbanDir: string,
  options: CreateEngineOptions = {}
): StorageEngine {
  const workspaceRoot = path.dirname(kanbanDir)
  const bootstrap = readBootstrapConfig(workspaceRoot)

  const engineType = options.storageEngine ?? bootstrap.storageEngine ?? 'markdown'
  const rawSqlitePath = options.sqlitePath ?? bootstrap.sqlitePath ?? '.kanban/kanban.db'
  const absoluteDbPath = path.isAbsolute(rawSqlitePath)
    ? rawSqlitePath
    : path.join(workspaceRoot, rawSqlitePath)

  switch (engineType) {
    case 'sqlite':
      return new SqliteStorageEngine(kanbanDir, absoluteDbPath)
    case 'markdown':
    default:
      return new MarkdownStorageEngine(kanbanDir)
  }
}

/**
 * Reads only the storage-engine bootstrap fields (`storageEngine`, `sqlitePath`)
 * from `.kanban.json` without full validation or migration.
 *
 * This is intentionally kept minimal — it must be readable *before* the storage
 * engine is created. Returns an empty object if the file is absent or unreadable
 * (defaults kick in at the factory level).
 *
 * @param workspaceRoot - Absolute path to the workspace root directory.
 * @returns The parsed {@link BootstrapConfig}, or `{}` on error.
 */
export function readBootstrapConfig(workspaceRoot: string): BootstrapConfig {
  try {
    const fs = require('fs') as typeof import('fs')
    const configFile = path.join(workspaceRoot, '.kanban.json')
    const raw = JSON.parse(fs.readFileSync(configFile, 'utf-8')) as Record<string, unknown>
    return {
      storageEngine: raw.storageEngine as StorageEngineType | undefined,
      sqlitePath: raw.sqlitePath as string | undefined,
    }
  } catch {
    return {}
  }
}
