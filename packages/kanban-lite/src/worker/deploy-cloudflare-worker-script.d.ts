declare module '../../../../scripts/deploy-cloudflare-worker.mjs' {
  export function buildCloudflareWorkerBootstrap(
    input: import('../sdk/env').CreateCloudflareWorkerBootstrapInput,
  ): Promise<import('../sdk/env').CloudflareWorkerBootstrap>

  export function buildCloudflareCallbackModuleBundlePlan(input: {
    config: Record<string, unknown>
    configPath: string
  }): Promise<{
    entries: Array<{
      module: string
      handlers: string[]
      source: string
    }>
  }>

  export function validateCloudflareCallbackModuleBundlePlan(
    tempDir: string,
    entries: Array<{
      module: string
      handlers: string[]
      source: string
    }>,
  ): Promise<void>

  export function createGeneratedWorker(tempDir: string, options: {
    name: string
    config: Record<string, unknown>
    configPath: string
    plugins: string[]
    kanbanDir: string
    compatibilityDate: string
    configStorageBindingHandles?: Record<string, string>
    configStorageRevisionBinding?: string
    d1Bindings?: Record<string, string>
    r2Bindings?: Record<string, string>
    queueProducers?: Record<string, string>
    createResources?: boolean
    callbackQueue?: string
    callbackMaxBatchSize?: number
    callbackMaxBatchTimeout?: number
    callbackMaxRetries?: number
    callbackDeadLetterQueue?: string
  }): Promise<string>

  export function createGeneratedWranglerConfig(tempDir: string, options: {
    name: string
    config: Record<string, unknown>
    compatibilityDate: string
    customDomains?: string[]
    customDomainZoneName?: string
    configStorageBindingHandles?: Record<string, string>
    configStorageRevisionBinding?: string
    resolvedD1Bindings?: Record<string, { name: string; id: string }>
    resolvedR2Bindings?: Record<string, string>
    resolvedQueueProducers?: Record<string, string>
    callbackQueue?: string
    callbackMaxBatchSize?: number
    callbackMaxBatchTimeout?: number
    callbackMaxRetries?: number
    callbackDeadLetterQueue?: string
  }): Promise<string>
}
