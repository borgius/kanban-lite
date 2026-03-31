import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createCardStateProvider } from './index'

const runtimeRequire = createRequire(import.meta.url)
const redisModulePath = runtimeRequire.resolve('ioredis')
const originalRedisModule = runtimeRequire(redisModulePath) as { default: unknown }

afterEach(() => {
  const cachedModule = runtimeRequire.cache[redisModulePath]
  if (cachedModule) {
    cachedModule.exports = originalRedisModule
  }
  vi.restoreAllMocks()
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