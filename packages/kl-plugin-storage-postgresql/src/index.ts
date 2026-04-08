import type {
  CardStoragePlugin,
  PluginSettingsOptionsSchemaMetadata,
} from 'kanban-lite/sdk'

import { resolvePostgresqlConnectionConfig } from './internal/connection.js'
import { createPostgresqlOptionsSchema } from './internal/options-schema.js'
import { PostgresqlStorageEngine } from './internal/storage-engine.js'

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

export type { PostgresqlConnectionConfig } from './internal/connection.js'
export type {
  Comment,
  ConfigStorageModuleContext,
  ConfigStorageProviderManifest,
  ConfigStorageProviderPlugin,
} from './internal/shared.js'

export { createCardStateProvider } from './internal/card-state.js'
export {
  __setPostgresqlConfigStorageRunnerForTests,
  createConfigStorageProvider,
} from './internal/config-storage.js'
export {
  attachmentStoragePlugin,
  createPostgresqlAttachmentPlugin,
  PostgresqlStorageEngine,
} from './internal/storage-engine.js'

// ---------------------------------------------------------------------------
// Named plugin exports (required by kanban-lite plugin loader contract)
// ---------------------------------------------------------------------------

/**
 * kanban-lite `card.storage` plugin for PostgreSQL.
 *
 * Provider id: `postgresql`
 * Install: `npm install kl-plugin-storage-postgresql pg`
 *
 * @example `.kanban.json`
 * ```json
 * {
 *   "plugins": {
 *     "card.storage": {
 *       "provider": "postgresql",
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
  manifest: { id: 'postgresql', provides: ['card.storage'] as const },
  createEngine(kanbanDir: string, options?: Record<string, unknown>): PostgresqlStorageEngine {
    return new PostgresqlStorageEngine(kanbanDir, resolvePostgresqlConnectionConfig(options))
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
  id: 'kl-plugin-storage-postgresql',
  capabilities: {
    'card.storage': ['postgresql'] as const,
    'config.storage': ['postgresql'] as const,
    'attachment.storage': ['postgresql'] as const,
    'card.state': ['postgresql'] as const,
  },
} as const

/** Options schemas keyed by provider id for plugin-settings discovery. */
export const optionsSchemas: Record<string, () => PluginSettingsOptionsSchemaMetadata> = {
  postgresql: createPostgresqlOptionsSchema,
}
