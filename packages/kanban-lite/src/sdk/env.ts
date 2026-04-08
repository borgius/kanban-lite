import type { KanbanConfig } from '../shared/config'
import { normalizeConfigStorageSelection } from '../shared/config'
import { CONFIG_REPOSITORY_DOCUMENT_ID } from './configDocumentIdentity'

/** Version for the Cloudflare Worker bootstrap envelope consumed by deploy/runtime/test seams. */
export const CLOUDFLARE_WORKER_BOOTSTRAP_VERSION = 1

/** Explicit request-path budget for config-freshness reads in Worker hosts. */
export const CLOUDFLARE_WORKER_CONFIG_FRESHNESS_BUDGET = {
  steadyStateD1ReadsPerRequest: 0,
  maxReadsPerColdStartOrRefreshBoundary: 1,
} as const

/** Bootstrap-owned source for the current config revision. */
export type CloudflareWorkerConfigRevisionSource =
  | { kind: 'bootstrap' }
  | { kind: 'binding'; binding: string }

/** Explicit D1/R2/Queue-style binding handles passed to Worker-safe providers by the host. */
export interface CloudflareWorkerBindingHandles {
  [name: string]: string
}

/** Raw embedded config JSON carried inside the Worker bootstrap envelope. */
export interface CloudflareWorkerBootstrapConfig extends Record<string, unknown> {
  storageEngine?: KanbanConfig['storageEngine']
  sqlitePath?: KanbanConfig['sqlitePath']
  plugins?: KanbanConfig['plugins']
}

/** Bootstrap-owned `config.storage` topology for Worker hosts. */
export interface CloudflareWorkerConfigStorageTopology {
  documentId: string
  provider: string
  bindingHandles: CloudflareWorkerBindingHandles
  revisionSource: CloudflareWorkerConfigRevisionSource
}

/** Revision-handle seam exposed to Worker-safe providers. */
export interface CloudflareWorkerProviderRevisionAccess {
  readonly source: CloudflareWorkerConfigRevisionSource
  getBinding<T = unknown>(): T | undefined
}

/**
 * Typed host binding/context seam passed to Worker-safe providers.
 *
 * The context is derived from the shared bootstrap envelope plus host-provided
 * runtime bindings so providers never need to couple themselves to raw Worker
 * globals.
 */
export interface CloudflareWorkerProviderContext {
  readonly bootstrap: CloudflareWorkerBootstrap
  readonly config: CloudflareWorkerBootstrapConfig
  readonly configStorage: CloudflareWorkerConfigStorageTopology
  readonly bindingHandles: CloudflareWorkerBindingHandles
  readonly bindings: Readonly<Record<string, unknown>>
  readonly revision: CloudflareWorkerProviderRevisionAccess
  getBinding<T = unknown>(handleName: string): T | undefined
  requireBinding<T = unknown>(handleName: string): T
  requireD1<T = unknown>(handleName: string): T
  requireR2<T = unknown>(handleName: string): T
  requireQueue<T = unknown>(handleName: string): T
}

/** Request-path budgets enforced for Worker config freshness checks. */
export interface CloudflareWorkerConfigFreshnessBudget {
  steadyStateD1ReadsPerRequest: number
  maxReadsPerColdStartOrRefreshBoundary: number
}

/** Full Cloudflare Worker bootstrap envelope shared by deploy tooling, runtime bootstrap, and seam tests. */
export interface CloudflareWorkerBootstrap {
  version: number
  config: CloudflareWorkerBootstrapConfig
  topology: {
    configStorage: CloudflareWorkerConfigStorageTopology
  }
  budgets: {
    configFreshness: CloudflareWorkerConfigFreshnessBudget
  }
}

/** Partial input used when building a Cloudflare Worker bootstrap envelope. */
export interface CreateCloudflareWorkerBootstrapInput {
  config: CloudflareWorkerBootstrapConfig
  topology?: {
    configStorage?: {
      documentId?: string
      bindingHandles?: CloudflareWorkerBindingHandles
      revisionSource?: CloudflareWorkerConfigRevisionSource
    }
  }
}

function cloneBindingHandles(handles: CloudflareWorkerBindingHandles): CloudflareWorkerBindingHandles {
  return { ...handles }
}

function cloneConfigStorageTopology(
  topology: CloudflareWorkerConfigStorageTopology,
): CloudflareWorkerConfigStorageTopology {
  return {
    documentId: topology.documentId,
    provider: topology.provider,
    bindingHandles: cloneBindingHandles(topology.bindingHandles),
    revisionSource: normalizeRevisionSource(topology.revisionSource),
  }
}

function normalizeConfigDocumentId(documentId: unknown): string {
  if (documentId === undefined) return CONFIG_REPOSITORY_DOCUMENT_ID
  if (typeof documentId !== 'string' || !documentId.trim()) {
    throw new Error('Cloudflare Worker bootstrap topology.configStorage.documentId must be a non-empty string when provided.')
  }
  return documentId
}

function cloneConfig(config: CloudflareWorkerBootstrapConfig): CloudflareWorkerBootstrapConfig {
  return JSON.parse(JSON.stringify(config)) as CloudflareWorkerBootstrapConfig
}

function requireRuntimeBinding(
  runtimeBindings: Record<string, unknown>,
  bindingName: string,
  errorContext: string,
): unknown {
  if (!Object.prototype.hasOwnProperty.call(runtimeBindings, bindingName)) {
    throw new Error(`${errorContext} requires the runtime binding '${bindingName}', but it is not available in the current Worker env.`)
  }
  return runtimeBindings[bindingName]
}

function normalizeRevisionSource(source: unknown): CloudflareWorkerConfigRevisionSource {
  if (!source || typeof source !== 'object') {
    return { kind: 'bootstrap' }
  }

  const candidate = source as Record<string, unknown>
  if (candidate.kind === 'bootstrap') {
    return { kind: 'bootstrap' }
  }

  if (candidate.kind === 'binding' && typeof candidate.binding === 'string' && candidate.binding.trim()) {
    return { kind: 'binding', binding: candidate.binding }
  }

  throw new Error('Cloudflare Worker bootstrap revision source must be either { kind: "bootstrap" } or { kind: "binding", binding: string }.')
}

function normalizeBindingHandles(handles: unknown): CloudflareWorkerBindingHandles {
  if (!handles) return {}
  if (typeof handles !== 'object' || Array.isArray(handles)) {
    throw new Error('Cloudflare Worker bootstrap binding handles must be an object keyed by logical handle name.')
  }

  const normalized: CloudflareWorkerBindingHandles = {}
  for (const [name, value] of Object.entries(handles)) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`Cloudflare Worker bootstrap binding handle '${name}' must map to a non-empty binding name.`)
    }
    normalized[name] = value
  }
  return normalized
}

function normalizeConfigFreshnessBudget(budget: unknown): CloudflareWorkerConfigFreshnessBudget {
  if (!budget || typeof budget !== 'object') {
    throw new Error('Cloudflare Worker bootstrap must include a configFreshness budget.')
  }

  const candidate = budget as Record<string, unknown>
  const steadyStateD1ReadsPerRequest = Number(candidate.steadyStateD1ReadsPerRequest)
  const maxReadsPerColdStartOrRefreshBoundary = Number(candidate.maxReadsPerColdStartOrRefreshBoundary)

  if (!Number.isInteger(steadyStateD1ReadsPerRequest) || !Number.isInteger(maxReadsPerColdStartOrRefreshBoundary)) {
    throw new Error('Cloudflare Worker config-freshness budgets must be integers.')
  }

  if (steadyStateD1ReadsPerRequest !== 0) {
    throw new Error('Cloudflare Worker steady-state config-freshness budgets must keep D1 reads off the hot path (0 per request).')
  }

  if (maxReadsPerColdStartOrRefreshBoundary < 0 || maxReadsPerColdStartOrRefreshBoundary > 1) {
    throw new Error('Cloudflare Worker config-freshness budgets allow at most one D1 revision/config read on cold start or an explicit stale-refresh boundary.')
  }

  return {
    steadyStateD1ReadsPerRequest,
    maxReadsPerColdStartOrRefreshBoundary,
  }
}

/**
 * Resolves the effective `config.storage` provider id that a Worker host must
 * know before any remote config lookup can occur.
 */
export function inferCloudflareWorkerConfigStorageProvider(
  config: Pick<CloudflareWorkerBootstrapConfig, 'storageEngine' | 'sqlitePath' | 'plugins'>,
): string {
  return normalizeConfigStorageSelection(config).effective?.provider ?? 'localfs'
}

/**
 * Builds the shared Cloudflare Worker bootstrap envelope from embedded config
 * plus bootstrap-owned topology inputs.
 */
export function createCloudflareWorkerBootstrap(
  input: CreateCloudflareWorkerBootstrapInput,
): CloudflareWorkerBootstrap {
  return resolveCloudflareWorkerBootstrap({
    version: CLOUDFLARE_WORKER_BOOTSTRAP_VERSION,
    config: cloneConfig(input.config),
    topology: {
      configStorage: {
        documentId: input.topology?.configStorage?.documentId ?? CONFIG_REPOSITORY_DOCUMENT_ID,
        provider: inferCloudflareWorkerConfigStorageProvider(input.config),
        bindingHandles: cloneBindingHandles(input.topology?.configStorage?.bindingHandles ?? {}),
        revisionSource: input.topology?.configStorage?.revisionSource ?? { kind: 'bootstrap' },
      },
    },
    budgets: {
      configFreshness: { ...CLOUDFLARE_WORKER_CONFIG_FRESHNESS_BUDGET },
    },
  })
}

/**
 * Resolves the typed Worker provider context from the shared bootstrap
 * contract plus the host's current runtime bindings.
 */
export function createCloudflareWorkerProviderContext(
  bootstrap: CloudflareWorkerBootstrap,
  runtimeBindings: Record<string, unknown>,
): CloudflareWorkerProviderContext {
  const normalizedBootstrap = resolveCloudflareWorkerBootstrap(bootstrap)
  const configStorage = cloneConfigStorageTopology(normalizedBootstrap.topology.configStorage)
  const resolvedBindings: Record<string, unknown> = {}

  for (const [handleName, bindingName] of Object.entries(configStorage.bindingHandles)) {
    resolvedBindings[handleName] = requireRuntimeBinding(
      runtimeBindings,
      bindingName,
      `Cloudflare Worker binding handle '${handleName}'`,
    )
  }

  const revisionBinding = configStorage.revisionSource.kind === 'binding'
    ? requireRuntimeBinding(
        runtimeBindings,
        configStorage.revisionSource.binding,
        'Cloudflare Worker revision access',
      )
    : undefined
  const frozenBindings = Object.freeze({ ...resolvedBindings })

  const getBinding = <T = unknown>(handleName: string): T | undefined => {
    return frozenBindings[handleName] as T | undefined
  }

  const requireBinding = <T = unknown>(handleName: string): T => {
    const bindingName = configStorage.bindingHandles[handleName]
    if (!bindingName) {
      throw new Error(`Cloudflare Worker bootstrap does not declare a binding handle named '${handleName}'.`)
    }
    return requireRuntimeBinding(
      runtimeBindings,
      bindingName,
      `Cloudflare Worker binding handle '${handleName}'`,
    ) as T
  }

  return {
    bootstrap: normalizedBootstrap,
    config: cloneConfig(normalizedBootstrap.config),
    configStorage,
    bindingHandles: cloneBindingHandles(configStorage.bindingHandles),
    bindings: frozenBindings,
    revision: {
      source: normalizeRevisionSource(configStorage.revisionSource),
      getBinding<T = unknown>() {
        return revisionBinding as T | undefined
      },
    },
    getBinding,
    requireBinding,
    requireD1<T = unknown>(handleName: string): T {
      return requireBinding<T>(handleName)
    },
    requireR2<T = unknown>(handleName: string): T {
      return requireBinding<T>(handleName)
    },
    requireQueue<T = unknown>(handleName: string): T {
      return requireBinding<T>(handleName)
    },
  }
}

/**
 * Parses and validates a Cloudflare Worker bootstrap envelope while enforcing
 * the non-recursive topology and hot-path freshness-read budget contract.
 */
export function resolveCloudflareWorkerBootstrap(rawBootstrap: unknown): CloudflareWorkerBootstrap {
  let parsed = rawBootstrap
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed) as unknown
    } catch (error) {
      throw new Error(`Failed to parse Cloudflare Worker bootstrap JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Cloudflare Worker bootstrap must be an object.')
  }

  const candidate = parsed as Record<string, unknown>
  if (candidate.version !== CLOUDFLARE_WORKER_BOOTSTRAP_VERSION) {
    throw new Error(`Unsupported Cloudflare Worker bootstrap version: ${String(candidate.version)}`)
  }

  if (!candidate.config || typeof candidate.config !== 'object' || Array.isArray(candidate.config)) {
    throw new Error('Cloudflare Worker bootstrap must include an embedded config object.')
  }

  if (!candidate.topology || typeof candidate.topology !== 'object' || Array.isArray(candidate.topology)) {
    throw new Error('Cloudflare Worker bootstrap must include topology metadata.')
  }

  const topology = candidate.topology as Record<string, unknown>
  const configStorage = topology.configStorage
  if (!configStorage || typeof configStorage !== 'object' || Array.isArray(configStorage)) {
    throw new Error('Cloudflare Worker bootstrap must include topology.configStorage.')
  }

  const configStorageTopology = configStorage as Record<string, unknown>
  const config = cloneConfig(candidate.config as CloudflareWorkerBootstrapConfig)
  const provider = configStorageTopology.provider
  if (typeof provider !== 'string' || !provider.trim()) {
    throw new Error('Cloudflare Worker bootstrap topology.configStorage.provider must be a non-empty string.')
  }

  const inferredProvider = inferCloudflareWorkerConfigStorageProvider(config)
  if (provider !== inferredProvider) {
    throw new Error(`Cloudflare Worker bootstrap config.storage provider '${provider}' does not match the embedded config topology '${inferredProvider}'.`)
  }

  const budgets = candidate.budgets
  if (!budgets || typeof budgets !== 'object' || Array.isArray(budgets)) {
    throw new Error('Cloudflare Worker bootstrap must include request-path budgets.')
  }

  const normalizedConfigFreshness = normalizeConfigFreshnessBudget((budgets as Record<string, unknown>).configFreshness)

  return {
    version: CLOUDFLARE_WORKER_BOOTSTRAP_VERSION,
    config,
    topology: {
      configStorage: {
        documentId: normalizeConfigDocumentId(configStorageTopology.documentId),
        provider,
        bindingHandles: normalizeBindingHandles(configStorageTopology.bindingHandles),
        revisionSource: normalizeRevisionSource(configStorageTopology.revisionSource),
      },
    },
    budgets: {
      configFreshness: normalizedConfigFreshness,
    },
  }
}

/**
 * Rejects live Worker config writes that would change the bootstrap-owned
 * `config.storage` topology and therefore require a new bootstrap + redeploy.
 */
export function assertCloudflareWorkerBootstrapConfigMutation(
  bootstrap: CloudflareWorkerBootstrap,
  nextConfig: Pick<CloudflareWorkerBootstrapConfig, 'storageEngine' | 'sqlitePath' | 'plugins'>,
): void {
  const nextProvider = inferCloudflareWorkerConfigStorageProvider(nextConfig)
  if (nextProvider !== bootstrap.topology.configStorage.provider) {
    throw new Error(
      `Cloudflare Worker config.storage topology changed from '${bootstrap.topology.configStorage.provider}' to '${nextProvider}'. Update the Worker bootstrap and redeploy before applying this config change.`,
    )
  }
}
