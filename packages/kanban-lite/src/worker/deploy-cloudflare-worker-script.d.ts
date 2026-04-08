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
    callbackQueue?: string
    callbackMaxBatchSize?: number
    callbackMaxBatchTimeout?: number
    callbackMaxRetries?: number
    callbackDeadLetterQueue?: string
  }): Promise<string>
}
