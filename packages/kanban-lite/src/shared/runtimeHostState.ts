import type { RuntimeHost } from './env'

let runtimeHost: RuntimeHost | null = null

export function installSharedRuntimeHost(host: RuntimeHost | null): void {
  runtimeHost = host
}

export function getSharedRuntimeHost(): RuntimeHost | null {
  return runtimeHost
}

export function resetSharedRuntimeHost(): void {
  runtimeHost = null
}
