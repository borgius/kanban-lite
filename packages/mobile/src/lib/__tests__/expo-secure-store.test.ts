import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createExpoSecureStoreStorage,
  toExpoSecureStoreKey,
} from '../expo-secure-store'

vi.mock('expo-secure-store', () => {
  const data = new Map<string, string>()

  return {
    isAvailableAsync: vi.fn(async () => true),
    deleteItemAsync: vi.fn(async (key: string) => {
      data.delete(key)
    }),
    getItemAsync: vi.fn(async (key: string) => data.get(key) ?? null),
    setItemAsync: vi.fn(async (key: string, value: string) => {
      data.set(key, value)
    }),
    __dump: () => Object.fromEntries(data.entries()),
    __reset: () => {
      data.clear()
    },
  }
})

describe('Expo SecureStore adapter', () => {
  beforeEach(async () => {
    const secureStore = await import('expo-secure-store') as unknown as {
      __reset: () => void
    }

    secureStore.__reset()
    vi.clearAllMocks()
  })

  it('encodes logical keys into SecureStore-safe physical keys', () => {
    const encoded = toExpoSecureStoreKey(
      'kanban-lite/mobile-sync-cache-v1:https://field.example.com:workspace_123:worker',
    )

    expect(encoded).toMatch(/^[A-Za-z0-9._-]+$/)
    expect(encoded).not.toContain('/')
    expect(encoded).not.toContain(':')
    expect(encoded).not.toContain('%')
  })

  it('round-trips values through encoded physical keys', async () => {
    const storage = createExpoSecureStoreStorage()
    const logicalKey =
      'kanban-lite/mobile-sync-cache-v1:https://field.example.com:workspace_123:worker'

    await storage.setItem(logicalKey, '{"ok":true}')

    expect(await storage.getItem(logicalKey)).toBe('{"ok":true}')

    const secureStore = await import('expo-secure-store') as unknown as {
      __dump: () => Record<string, string>
      deleteItemAsync: ReturnType<typeof vi.fn>
      setItemAsync: ReturnType<typeof vi.fn>
    }

    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      toExpoSecureStoreKey(logicalKey),
      '{"ok":true}',
    )
    expect(secureStore.__dump()).toEqual({
      [toExpoSecureStoreKey(logicalKey)]: '{"ok":true}',
    })

    await storage.removeItem(logicalKey)

    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith(
      toExpoSecureStoreKey(logicalKey),
    )
    expect(await storage.getItem(logicalKey)).toBeNull()
  })

  it('returns null and skips writes when SecureStore is unavailable (web)', async () => {
    const secureStore = await import('expo-secure-store') as unknown as {
      isAvailableAsync: ReturnType<typeof vi.fn>
      getItemAsync: ReturnType<typeof vi.fn>
      setItemAsync: ReturnType<typeof vi.fn>
      deleteItemAsync: ReturnType<typeof vi.fn>
    }

    secureStore.isAvailableAsync.mockResolvedValueOnce(false)

    const storage = createExpoSecureStoreStorage()
    const key = 'kanban-lite/mobile-sync-cache-v1:https://example.com:ws1'

    expect(await storage.getItem(key)).toBeNull()
    await storage.setItem(key, 'data')
    await storage.removeItem(key)

    expect(secureStore.getItemAsync).not.toHaveBeenCalled()
    expect(secureStore.setItemAsync).not.toHaveBeenCalled()
    expect(secureStore.deleteItemAsync).not.toHaveBeenCalled()
  })
})
