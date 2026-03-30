/**
 * MySQL provider ownership moved out of core.
 *
 * Core keeps the `mysql` compatibility id through `PROVIDER_ALIASES` in
 * `src/sdk/plugins/index.ts`, which resolves to the external package
 * `kl-plugin-storage-mysql` at runtime.
 *
 * This file intentionally contains no provider implementation.
 */
export {}
