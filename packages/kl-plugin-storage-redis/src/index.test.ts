import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  __setRedisConfigStorageRunnerForTests,
  createCardStateProvider,
  createConfigStorageProvider,
  pluginManifest,
} from './index'

const runtimeRequire = createRequire(import.meta.url)
const redisModulePath = runtimeRequire.resolve('ioredis')
const originalRedisModule = runtimeRequire(redisModulePath) as { default: unknown }

afterEach(() => {
  const cachedModule = runtimeRequire.cache[redisModulePath]
  if (cachedModule) {
    cachedModule.exports = originalRedisModule
  }
  __setRedisConfigStorageRunnerForTests(null)
  vi.restoreAllMocks()
})

describe('kl-plugin-storage-redis config.storage provider', () => {
  it('advertises config.storage in the package manifest', () => {
    expect(pluginManifest.capabilities['config.storage']).toEqual(['redis'])
  })

  it('round-trips workspace config with the same connection options payload used by card.storage', () => {
    const commands: Array<{
      action: 'read' | 'write'
      connection: {
        host?: string
        port?: number
        password?: string
        db?: number
        keyPrefix?: string
      }
      documentId: string
      document?: Record<string, unknown>
    }> = []
    let storedDocument: Record<string, unknown> | null = null

    __setRedisConfigStorageRunnerForTests((command) => {
      commands.push(structuredClone(command))

      if (command.action === 'write') {
        storedDocument = structuredClone(command.document ?? null) as Record<string, unknown> | null
        return null
      }

      return storedDocument
    })

    const provider = createConfigStorageProvider({
      workspaceRoot: '/tmp/workspace',
      documentId: 'workspace-config',
      provider: 'redis',
      backend: 'external',
      options: {
        host: 'redis.test',
        port: 6380,
        password: 'secret',
        db: 2,
        keyPrefix: 'cfg',
      },
    })

    const document: Record<string, unknown> = {
      version: 2,
      defaultBoard: 'default',
      plugins: {
        'config.storage': {
          provider: 'localfs',
          options: { scope: 'bootstrap' },
        },
      },
    }

    provider.writeConfigDocument(document)

    expect(provider.readConfigDocument()).toEqual(document)
    expect(commands).toEqual([
      {
        action: 'write',
        connection: {
          host: 'redis.test',
          port: 6380,
          password: 'secret',
          db: 2,
          keyPrefix: 'cfg',
        },
        documentId: 'workspace-config',
        document,
      },
      {
        action: 'read',
        connection: {
          host: 'redis.test',
          port: 6380,
          password: 'secret',
          db: 2,
          keyPrefix: 'cfg',
        },
        documentId: 'workspace-config',
      },
    ])
  })
})

describe('kl-plugin-storage-redis card.state provider', () => {
  it('does not create a Redis client until the first card.state operation', () => {
    const RedisCtor = vi.fn(function FakeRedis() {
      return {
        hget: vi.fn(),
        hset: vi.fn(),
        hgetall: vi.fn(),
        hdel: vi.fn(),
        del: vi.fn(),
        keys: vi.fn(),
        quit: vi.fn(),
        status: 'wait',
      }
    })

    const cachedModule = runtimeRequire.cache[redisModulePath]
    if (!cachedModule) {
      throw new Error('Expected ioredis to be resolvable for test stubbing.')
    }
    cachedModule.exports = { default: RedisCtor }

    const provider = createCardStateProvider({
      workspaceRoot: '/tmp/workspace',
      kanbanDir: '/tmp/workspace/.kanban',
      provider: 'redis',
      backend: 'external',
      options: {},
    })

    expect(provider.manifest).toEqual({ id: 'redis', provides: ['card.state'] })
    expect(RedisCtor).not.toHaveBeenCalled()
  })

  it('creates the Redis client lazily with lazyConnect on first use', async () => {
    const hget = vi.fn().mockResolvedValue(null)
    const RedisCtor = vi.fn(function FakeRedis() {
      return {
        hget,
        hset: vi.fn(),
        hgetall: vi.fn(),
        hdel: vi.fn(),
        del: vi.fn(),
        keys: vi.fn(),
        quit: vi.fn(),
        status: 'wait',
      }
    })

    const cachedModule = runtimeRequire.cache[redisModulePath]
    if (!cachedModule) {
      throw new Error('Expected ioredis to be resolvable for test stubbing.')
    }
    cachedModule.exports = { default: RedisCtor }

    const provider = createCardStateProvider({
      workspaceRoot: '/tmp/workspace',
      kanbanDir: '/tmp/workspace/.kanban',
      provider: 'redis',
      backend: 'external',
      options: {
        host: 'redis.test',
        port: 6380,
        password: 'secret',
        db: 2,
        keyPrefix: 'cards',
      },
    })

    await expect(provider.getCardState({
      actorId: 'actor-1',
      boardId: 'default',
      cardId: 'card-1',
      domain: 'unread',
    })).resolves.toBeNull()

    expect(RedisCtor).toHaveBeenCalledTimes(1)
    expect(RedisCtor).toHaveBeenCalledWith({
      host: 'redis.test',
      port: 6380,
      password: 'secret',
      db: 2,
      lazyConnect: true,
    })
    expect(hget).toHaveBeenCalledWith('cards:card_state:actor-1:default:card-1:unread', 'data')
  })
})
