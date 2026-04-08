import { spawnSync } from 'node:child_process'
import type {
  AttachmentStoragePlugin,
  Card,
  CardStateCursor,
  CardStateKey,
  CardStateModuleContext,
  CardStateProvider,
  CardStateReadThroughInput,
  CardStateRecord,
  CardStateUnreadKey,
  CardStateWriteInput,
  CardStoragePlugin,
  PluginSettingsOptionsSchemaMetadata,
  PluginSettingsRedactionPolicy,
  StorageEngine,
} from 'kanban-lite/sdk'
import {
  RedisStorageEngine,
  resolveRedisConnectionConfig,
  loadRedisDriver,
  type RedisClient,
  type RedisConnectionConfig,
  type ConfigStorageModuleContext,
  type ConfigStorageProviderPlugin,
  type ConfigStorageProviderManifest,
} from './engine'

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

// ---------------------------------------------------------------------------
// Local structural interfaces — avoids deep imports from kanban-lite internals.
// Validated by runtime shape checks in the kanban-lite plugin loader.
// ---------------------------------------------------------------------------

export type Comment = Card['comments'][number]

export {
  RedisStorageEngine,
  resolveRedisConnectionConfig,
  loadRedisDriver,
  type RedisClient,
  type RedisConnectionConfig,
} from './engine'

export function createRedisAttachmentPlugin(engine: StorageEngine): AttachmentStoragePlugin {
  if (engine.type !== 'redis') {
    throw new Error(
      'kl-plugin-storage-redis: attachment plugin requires an active redis card.storage engine.',
    )
  }
  const redisEngine = engine as RedisStorageEngine
  return {
    manifest: { id: 'redis', provides: ['attachment.storage'] as const },
    getCardDir(card: Card): string | null {
      return redisEngine.getCardDir(card)
    },
    async copyAttachment(sourcePath: string, card: Card): Promise<void> {
      await redisEngine.copyAttachment(sourcePath, card)
    },
  }
}

// ---------------------------------------------------------------------------
// Named plugin exports (required by kanban-lite plugin loader contract)
// ---------------------------------------------------------------------------

/**
 * kanban-lite `card.storage` plugin for Redis.
 *
 * Provider id: `redis`
 * Install: `npm install kl-plugin-storage-redis ioredis`
 *
 * @example `.kanban.json`
 * ```json
 * {
 *   "plugins": {
 *     "card.storage": {
 *       "provider": "redis",
 *       "options": {
 *         "host": "localhost",
 *         "port": 6379,
 *         "db": 0
 *       }
 *     }
 *   }
 * }
 * ```
 */
export const cardStoragePlugin: CardStoragePlugin = {
  manifest: { id: 'redis', provides: ['card.storage'] as const },
  createEngine(kanbanDir: string, options?: Record<string, unknown>): RedisStorageEngine {
    return new RedisStorageEngine(kanbanDir, resolveRedisConnectionConfig(options))
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

/**
 * kanban-lite `attachment.storage` plugin for Redis.
 *
 * Stores attachments in the local filesystem at
 * `.kanban/boards/{boardId}/{status}/attachments/`.
 *
 * When using this plugin explicitly, the active `card.storage` must also be
 * `redis`; otherwise the plugin will throw at attachment-copy time.
 */
export const attachmentStoragePlugin: AttachmentStoragePlugin = {
  manifest: { id: 'redis', provides: ['attachment.storage'] as const },
  async copyAttachment(_sourcePath: string, _card: Card): Promise<void> {
    throw new Error(
      'kl-plugin-storage-redis: attachmentStoragePlugin.copyAttachment() cannot be called directly. ' +
      'Use createRedisAttachmentPlugin(engine) to obtain a wired attachment plugin instance.',
    )
  },
}

// ---------------------------------------------------------------------------
// card.state provider (merged into storage package)
// ---------------------------------------------------------------------------

function _csIsRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function _csIsCardStateCursor(value: unknown): value is CardStateCursor {
  return _csIsRecord(value)
    && typeof value.cursor === 'string'
    && (value.updatedAt === undefined || typeof value.updatedAt === 'string')
}

function _csGetUpdatedAt(updatedAt?: string): string {
  return updatedAt ?? new Date().toISOString()
}

function _csRedisKey(keyPrefix: string, input: CardStateKey | (CardStateUnreadKey & { domain?: string })): string {
  const domain = 'domain' in input ? input.domain : 'unread'
  return `${keyPrefix}:card_state:${input.actorId}:${input.boardId}:${input.cardId}:${domain}`
}

/**
 * Creates the Redis-backed `card.state` provider.
 *
 * Card-state data is stored in the same Redis instance as card storage
 * using `{keyPrefix}:card_state:{actorId}:{boardId}:{cardId}:{domain}` keys.
 */
export function createCardStateProvider(context: CardStateModuleContext): CardStateProvider {
  let client: RedisClient | null = null
  const getClient = (): RedisClient => {
    if (!client) {
      const Redis = loadRedisDriver()
      client = new Redis.default({
        host: (context.options?.['host'] as string | undefined) ?? 'localhost',
        port: typeof context.options?.['port'] === 'number' ? context.options['port'] : 6379,
        password: context.options?.['password'] as string | undefined,
        db: typeof context.options?.['db'] === 'number' ? context.options['db'] : 0,
        lazyConnect: true,
      })
    }
    return client
  }
  const keyPrefix = (context.options?.['keyPrefix'] as string | undefined) ?? 'kanban'

  return {
    manifest: Object.freeze({ id: 'redis', provides: ['card.state'] as const }),
    async getCardState(input: CardStateKey): Promise<CardStateRecord | null> {
      const client = getClient()
      const raw = await client.hget(_csRedisKey(keyPrefix, input), 'data')
      if (!raw) return null
      try {
        const parsed = JSON.parse(raw) as { value: unknown; updatedAt: string }
        if (!_csIsRecord(parsed.value)) return null
        return { actorId: input.actorId, boardId: input.boardId, cardId: input.cardId, domain: input.domain, value: parsed.value, updatedAt: parsed.updatedAt }
      } catch { return null }
    },
    async setCardState(input: CardStateWriteInput): Promise<CardStateRecord> {
      const client = getClient()
      const updatedAt = _csGetUpdatedAt(input.updatedAt)
      const data = JSON.stringify({ value: input.value, updatedAt })
      await client.hset(_csRedisKey(keyPrefix, input), 'data', data)
      return { actorId: input.actorId, boardId: input.boardId, cardId: input.cardId, domain: input.domain, value: input.value, updatedAt }
    },
    async getUnreadCursor(input: CardStateUnreadKey): Promise<CardStateCursor | null> {
      const record = await this.getCardState({ ...input, domain: 'unread' })
      return record && _csIsCardStateCursor(record.value) ? record.value : null
    },
    async markUnreadReadThrough(input: CardStateReadThroughInput): Promise<CardStateRecord<CardStateCursor>> {
      const updatedAt = _csGetUpdatedAt(input.cursor.updatedAt)
      const value: CardStateCursor = { cursor: input.cursor.cursor, updatedAt }
      await this.setCardState({ actorId: input.actorId, boardId: input.boardId, cardId: input.cardId, domain: 'unread', value, updatedAt })
      return { actorId: input.actorId, boardId: input.boardId, cardId: input.cardId, domain: 'unread', value, updatedAt }
    },
  }
}

// ---------------------------------------------------------------------------
// config.storage provider (merged into storage package)
// ---------------------------------------------------------------------------

type RedisConfigStorageCommand =
  | {
      action: 'read'
      connection: RedisConnectionConfig
      documentId: string
    }
  | {
      action: 'write'
      connection: RedisConnectionConfig
      documentId: string
      document: Record<string, unknown>
    }

type RedisConfigStorageRunner = (command: RedisConfigStorageCommand) => Record<string, unknown> | null

const REDIS_CONFIG_STORAGE_HASH_SUFFIX = ':config_documents'

function runRedisConfigStorageCommand(command: RedisConfigStorageCommand): Record<string, unknown> | null {
  const script = `
const fs = require('node:fs');
const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
const Redis = require('ioredis').default;

(async () => {
  const connection = payload.connection ?? {};
  const client = new Redis({
    host: connection.host ?? 'localhost',
    port: connection.port ?? 6379,
    password: connection.password,
    db: connection.db ?? 0,
    lazyConnect: true,
  });

  try {
    const keyPrefix = connection.keyPrefix ?? 'kanban';
    const configKey = keyPrefix + ${JSON.stringify(REDIS_CONFIG_STORAGE_HASH_SUFFIX)};

    if (payload.action === 'read') {
      const rawDocument = await client.hget(configKey, payload.documentId);
      process.stdout.write(rawDocument ?? 'null');
      return;
    }

    await client.hset(configKey, payload.documentId, JSON.stringify(payload.document ?? {}));
    process.stdout.write('null');
  } finally {
    await client.quit();
  }
})().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
`

  const result = spawnSync(process.execPath, ['-e', script], {
    input: JSON.stringify(command),
    encoding: 'utf8',
  })

  if (result.status !== 0) {
    const details = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n')
    throw new Error(
      `kl-plugin-storage-redis: unable to ${command.action} workspace config via Redis.`
      + (details ? `\n${details}` : ''),
    )
  }

  const rawOutput = result.stdout.trim()
  if (!rawOutput || rawOutput === 'null') return null

  const parsed = JSON.parse(rawOutput) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('kl-plugin-storage-redis: Redis config storage returned an invalid config document.')
  }

  return parsed as Record<string, unknown>
}

let redisConfigStorageRunner: RedisConfigStorageRunner = runRedisConfigStorageCommand

export function __setRedisConfigStorageRunnerForTests(
  runner: RedisConfigStorageRunner | null,
): void {
  redisConfigStorageRunner = runner ?? runRedisConfigStorageCommand
}

export function createConfigStorageProvider(context: ConfigStorageModuleContext): ConfigStorageProviderPlugin {
  const connection = resolveRedisConnectionConfig(context.options)

  return {
    manifest: { id: 'redis', provides: ['config.storage'] as const },
    readConfigDocument(): Record<string, unknown> | null {
      return redisConfigStorageRunner({
        action: 'read',
        connection,
        documentId: context.documentId,
      })
    },
    writeConfigDocument(document: Record<string, unknown>): void {
      redisConfigStorageRunner({
        action: 'write',
        connection,
        documentId: context.documentId,
        document,
      })
    },
  }
}

/** Standard package manifest for engine discovery. */
export const pluginManifest = {
  id: 'kl-plugin-storage-redis',
  capabilities: {
    'card.storage': ['redis'] as const,
    'config.storage': ['redis'] as const,
    'attachment.storage': ['redis'] as const,
    'card.state': ['redis'] as const,
  },
} as const

// ---------------------------------------------------------------------------
// Options schema — plugin-settings discovery
// ---------------------------------------------------------------------------

const REDIS_SECRET_REDACTION: PluginSettingsRedactionPolicy = {
  maskedValue: '••••••',
  writeOnly: true,
  targets: ['read', 'list', 'error'],
}

function createRedisOptionsSchema(): PluginSettingsOptionsSchemaMetadata {
  return {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        host: {
          type: 'string',
          title: 'Host',
          description: 'Redis server hostname.',
          default: 'localhost',
        },
        port: {
          type: 'number',
          title: 'Port',
          description: 'Redis server port.',
          default: 6379,
        },
        password: {
          type: 'string',
          title: 'Password',
          description: 'Redis password.',
        },
        db: {
          type: 'number',
          title: 'Database index',
          description: 'Redis database index.',
          default: 0,
        },
        keyPrefix: {
          type: 'string',
          title: 'Key prefix',
          description: 'Prefix for Redis keys.',
          default: 'kanban',
        },
      },
    },
    secrets: [
      { path: 'password', redaction: REDIS_SECRET_REDACTION },
    ],
  }
}

/** Options schemas keyed by provider id for plugin-settings discovery. */
export const optionsSchemas: Record<string, () => PluginSettingsOptionsSchemaMetadata> = {
  redis: createRedisOptionsSchema,
}
