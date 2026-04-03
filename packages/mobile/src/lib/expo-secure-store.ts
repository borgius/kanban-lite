const EXPO_SECURE_STORE_INVALID_KEY_MESSAGE =
  'Invalid key provided to SecureStore. Keys must not be empty and contain only alphanumeric characters, ".", "-", and "_".'

const EXPO_SECURE_STORE_KEY_PREFIX = 'kanban-lite.mobile.secure.v1'

/**
 * Maps logical mobile storage keys onto Expo SecureStore-safe physical keys.
 *
 * SecureStore rejects characters such as `/`, `:`, and `%`, but the mobile app's
 * logical storage namespaces intentionally include those separators. Encoding the
 * key once here keeps higher-level session/cache code unchanged while ensuring the
 * underlying physical key only uses characters SecureStore accepts.
 */
export function toExpoSecureStoreKey(key: string): string {
  if (key.length === 0) {
    throw new Error(EXPO_SECURE_STORE_INVALID_KEY_MESSAGE)
  }

  return `${EXPO_SECURE_STORE_KEY_PREFIX}.${Array.from(
    key,
    (character) => character.codePointAt(0)?.toString(16) ?? '0',
  ).join('.')}`
}

/**
 * Creates a lazily loaded Expo SecureStore-backed string storage adapter that
 * accepts arbitrary logical keys and encodes them into SecureStore-safe keys.
 *
 * When SecureStore is unavailable (e.g. web environment), reads return `null`
 * and writes/deletes are silently skipped, preventing uncaught native errors.
 */
export function createExpoSecureStoreStorage(): {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
} {
  let availablePromise: Promise<boolean> | undefined

  async function checkAvailable(): Promise<boolean> {
    availablePromise ??= import('expo-secure-store')
      .then((s) => s.isAvailableAsync())
      .catch(() => false)
    return availablePromise
  }

  // Web fallback: use localStorage when SecureStore is unavailable
  function webKey(key: string): string {
    return toExpoSecureStoreKey(key)
  }

  return {
    async getItem(key) {
      if (!(await checkAvailable())) {
        try { return typeof localStorage !== 'undefined' ? localStorage.getItem(webKey(key)) : null } catch { return null }
      }
      const secureStore = await import('expo-secure-store')
      return secureStore.getItemAsync(toExpoSecureStoreKey(key))
    },
    async setItem(key, value) {
      if (!(await checkAvailable())) {
        try { if (typeof localStorage !== 'undefined') localStorage.setItem(webKey(key), value) } catch { /* ignore */ }
        return
      }
      const secureStore = await import('expo-secure-store')
      await secureStore.setItemAsync(toExpoSecureStoreKey(key), value)
    },
    async removeItem(key) {
      if (!(await checkAvailable())) {
        try { if (typeof localStorage !== 'undefined') localStorage.removeItem(webKey(key)) } catch { /* ignore */ }
        return
      }
      const secureStore = await import('expo-secure-store')
      await secureStore.deleteItemAsync(toExpoSecureStoreKey(key))
    },
  }
}
