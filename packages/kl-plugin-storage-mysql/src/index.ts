import type {
  CardStoragePlugin,
  PluginSettingsOptionsSchemaMetadata,
} from 'kanban-lite/sdk'

import { resolveMysqlConnectionConfig } from './internal/connection.js'
import { createMysqlOptionsSchema } from './internal/options-schema.js'
import { MysqlStorageEngine } from './internal/storage-engine.js'

export type {
  AttachmentStoragePlugin,
  Card,
  CardStateCursor,
  CardStateKey,
  CardStateModuleContext,
  CardStateProvider,
  CardStateProviderManifest,
  CardStateReadThroughInput,
  CardStateRecord,
  CardStateUnreadKey,
  CardStateValue,
  CardStateWriteInput,
  CardStoragePlugin,
  Priority,
  StorageEngine,
} from 'kanban-lite/sdk'

export type { MysqlConnectionConfig } from './internal/connection.js'
export type {
  Comment,
  ConfigStorageModuleContext,
  ConfigStorageProviderManifest,
  ConfigStorageProviderPlugin,
} from './internal/shared.js'

export { createCardStateProvider } from './internal/card-state.js'
export {
  __setMysqlConfigStorageRunnerForTests,
  createConfigStorageProvider,
} from './internal/config-storage.js'
export {
  attachmentStoragePlugin,
  createMysqlAttachmentPlugin,
  MysqlStorageEngine,
} from './internal/storage-engine.js'

// ---------------------------------------------------------------------------
// Named plugin exports (required by kanban-lite plugin loader contract)
// ---------------------------------------------------------------------------

/**
 * kanban-lite `card.storage` plugin for MySQL.
 *
 * Provider id: `mysql`
 * Install: `npm install kl-plugin-storage-mysql mysql2`
 *
 * @example `.kanban.json`
 * ```json
 * {
 *   "plugins": {
 *     "card.storage": {
 *       "provider": "mysql",
 *       "options": {
 *         "host": "localhost",
 *         "user": "kanban",
 *         "password": "secret",
 *         "database": "kanban_db"
 *       }
 *     }
 *   }
 * }
 * ```
 */
export const cardStoragePlugin: CardStoragePlugin = {
  manifest: { id: 'mysql', provides: ['card.storage'] as const },
  createEngine(kanbanDir: string, options?: Record<string, unknown>): MysqlStorageEngine {
    return new MysqlStorageEngine(kanbanDir, resolveMysqlConnectionConfig(options))
  },
  nodeCapabilities: {
    isFileBacked: false,
    getLocalCardPath(): string | null {
      return null
    },
    getWatchGlob(): string | null {
      return null
    },
  },
}

/** Standard package manifest for engine discovery. */
export const pluginManifest = {
  id: 'kl-plugin-storage-mysql',
  capabilities: {
    'card.storage': ['mysql'] as const,
    'config.storage': ['mysql'] as const,
    'attachment.storage': ['mysql'] as const,
    'card.state': ['mysql'] as const,
  },
} as const

/** Options schemas keyed by provider id for plugin-settings discovery. */
export const optionsSchemas: Record<string, () => PluginSettingsOptionsSchemaMetadata> = {
  mysql: createMysqlOptionsSchema,
}
