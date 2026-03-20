/**
 * SQLite provider ownership moved out of core.
 *
 * Core keeps the `sqlite` compatibility id through `PROVIDER_ALIASES` in
 * `src/sdk/plugins/index.ts`, which resolves to the external package
 * `kl-sqlite-storage` at runtime.
 *
 * This file intentionally contains no provider implementation.
 */
export {}
