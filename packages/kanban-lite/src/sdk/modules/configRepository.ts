import * as fs from 'node:fs'
import { createRequire } from 'node:module'
import * as path from 'node:path'
import type { ProviderRef } from '../../shared/config'
import {
  getRuntimeHost,
  type RuntimeHostConfigDocument,
  type RuntimeHostConfigRepositoryReadResult,
} from '../../shared/env'
import { getConfigRepositoryDocumentId } from '../configDocumentIdentity'
import type { ConfigStorageModuleContext, ConfigStorageProviderPlugin } from '../plugins'

const CONFIG_DOCUMENT_FILENAME = '.kanban.json'

const runtimeRequire = createRequire(
  typeof __filename === 'string' && __filename
    ? __filename
    : path.join(process.cwd(), '__kanban-config-repository__.cjs'),
)

export type ConfigRepositoryDocument = RuntimeHostConfigDocument

export interface ConfigRepositoryReadOptions {
  allowSeedFallbackOnProviderError?: boolean
}

export type ConfigRepositoryReadResult =
  | { status: 'ok'; filePath: string; value: ConfigRepositoryDocument }
  | { status: 'missing'; filePath: string }
  | { status: 'error'; filePath: string; reason: 'read' | 'parse'; cause: unknown }

export type ConfigRepositoryWriteResult =
  | { status: 'ok'; filePath: string }
  | { status: 'error'; filePath: string; cause: unknown }

type ResolvedConfigStorageRepositoryProvider = {
  provider: ConfigStorageProviderPlugin
  context: ConfigStorageModuleContext
}

type ConfigStorageProviderResolver = (
  ref: ProviderRef,
  workspaceRoot: string,
  documentId: string,
) => ResolvedConfigStorageRepositoryProvider

let configStorageProviderResolver: ConfigStorageProviderResolver | null = null

export class ConfigRepositoryProviderError extends Error {
  readonly providerId: string
  readonly cause: unknown

  constructor(providerId: string, message: string, cause: unknown) {
    super(message)
    this.name = 'ConfigRepositoryProviderError'
    this.providerId = providerId
    this.cause = cause
  }
}

export function installConfigStorageProviderResolver(
  resolver: ConfigStorageProviderResolver | null,
): void {
  configStorageProviderResolver = resolver
}

function isConfigRepositoryDocument(value: unknown): value is ConfigRepositoryDocument {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function getConfigRepositoryFilePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, CONFIG_DOCUMENT_FILENAME)
}

function readHostedConfigRepositoryDocument(
  workspaceRoot: string,
  filePath: string,
): ConfigRepositoryReadResult | null {
  const hostedRaw = getRuntimeHost()?.readConfig?.(workspaceRoot, filePath)
  if (hostedRaw === undefined) {
    return null
  }

  if (!isConfigRepositoryDocument(hostedRaw)) {
    return {
      status: 'error',
      filePath,
      reason: 'parse',
      cause: new Error('Runtime host returned an invalid config document.'),
    }
  }

  return {
    status: 'ok',
    filePath,
    value: structuredClone(hostedRaw),
  }
}

function readFileConfigRepositoryDocument(filePath: string): ConfigRepositoryReadResult {
  let rawText: string
  try {
    rawText = fs.readFileSync(filePath, 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
      return { status: 'missing', filePath }
    }

    return { status: 'error', filePath, reason: 'read', cause: error }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch (error) {
    return { status: 'error', filePath, reason: 'parse', cause: error }
  }

  if (!isConfigRepositoryDocument(parsed)) {
    return {
      status: 'error',
      filePath,
      reason: 'parse',
      cause: new Error('Config document must be a JSON object.'),
    }
  }

  return {
    status: 'ok',
    filePath,
    value: parsed,
  }
}

export function readSeedConfigRepositoryDocument(
  workspaceRoot: string,
  filePath: string,
): ConfigRepositoryReadResult {
  const hostedResult = readHostedConfigRepositoryDocument(workspaceRoot, filePath)
  if (hostedResult) {
    return hostedResult
  }

  return readFileConfigRepositoryDocument(filePath)
}

function normalizeExplicitConfigStorageProviderRef(document: ConfigRepositoryDocument | undefined): ProviderRef | null {
  if (!document) return null

  const plugins = document.plugins
  if (!isConfigRepositoryDocument(plugins)) return null

  const configured = plugins['config.storage']
  if (!isConfigRepositoryDocument(configured) || typeof configured.provider !== 'string') {
    return null
  }

  const normalizedProvider = configured.provider === 'markdown' ? 'localfs' : configured.provider
  const options = isConfigRepositoryDocument(configured.options) ? structuredClone(configured.options) : undefined
  return options === undefined
    ? { provider: normalizedProvider }
    : { provider: normalizedProvider, options }
}

function applyExplicitConfigStorageProviderRef(
  document: ConfigRepositoryDocument,
  explicitConfigStorage: ProviderRef,
): ConfigRepositoryDocument {
  const nextDocument = structuredClone(document)
  const nextPlugins = isConfigRepositoryDocument(nextDocument.plugins)
    ? structuredClone(nextDocument.plugins)
    : {}

  nextPlugins['config.storage'] = explicitConfigStorage.options === undefined
    ? { provider: explicitConfigStorage.provider }
    : {
        provider: explicitConfigStorage.provider,
        options: structuredClone(explicitConfigStorage.options),
      }

  nextDocument.plugins = nextPlugins
  return nextDocument
}

function getConfigStorageProviderResolver(): ConfigStorageProviderResolver | null {
  if (configStorageProviderResolver) {
    return configStorageProviderResolver
  }

  try {
    const pluginsModule = runtimeRequire('../plugins') as {
      resolveConfigStorageProviderForRepository?: ConfigStorageProviderResolver
    }
    return typeof pluginsModule.resolveConfigStorageProviderForRepository === 'function'
      ? pluginsModule.resolveConfigStorageProviderForRepository
      : null
  } catch {
    return null
  }
}

function createConfigRepositoryProviderError(providerId: string, error: unknown): ConfigRepositoryProviderError {
  const message = error instanceof Error
    ? error.message
    : `Configured config.storage provider '${providerId}' could not be used.`
  return new ConfigRepositoryProviderError(providerId, message, error)
}

function createMissingConfigRepositoryDocumentError(providerId: string): ConfigRepositoryProviderError {
  return new ConfigRepositoryProviderError(
    providerId,
    'Configured config.storage provider did not return a config document.',
    null,
  )
}

function normalizeRuntimeHostConfigRepositoryError(
  result: Extract<RuntimeHostConfigRepositoryReadResult, { status: 'error' }>,
): unknown {
  return result.providerId
    ? createConfigRepositoryProviderError(result.providerId, result.cause)
    : result.cause
}

function createRuntimeHostMissingConfigRepositoryDocumentError(
  providerId?: string,
): unknown {
  return providerId
    ? createMissingConfigRepositoryDocumentError(providerId)
    : new Error('Runtime host authoritative config repository did not return a config document.')
}

function readConfigRepositoryDocumentFromRuntimeHost(
  workspaceRoot: string,
  filePath: string,
): ConfigRepositoryReadResult | null {
  let hostResult: RuntimeHostConfigRepositoryReadResult | undefined
  try {
    hostResult = getRuntimeHost()?.readConfigRepositoryDocument?.(workspaceRoot, filePath)
  } catch (error) {
    return { status: 'error', filePath, reason: 'read', cause: error }
  }
  if (hostResult === undefined) {
    return null
  }

  if (hostResult.status === 'ok') {
    if (!isConfigRepositoryDocument(hostResult.value)) {
      return {
        status: 'error',
        filePath,
        reason: 'parse',
        cause: hostResult.providerId
          ? new ConfigRepositoryProviderError(
              hostResult.providerId,
              'Config storage provider returned an invalid config document.',
              hostResult.value,
            )
          : new Error('Runtime host returned an invalid config document.'),
      }
    }

    return {
      status: 'ok',
      filePath,
      value: structuredClone(hostResult.value),
    }
  }

  if (hostResult.status === 'missing') {
    return {
      status: 'error',
      filePath,
      reason: 'read',
      cause: createRuntimeHostMissingConfigRepositoryDocumentError(hostResult.providerId),
    }
  }

  return {
    status: 'error',
    filePath,
    reason: hostResult.reason,
    cause: normalizeRuntimeHostConfigRepositoryError(hostResult),
  }
}

function writeConfigRepositoryDocumentToRuntimeHost(
  workspaceRoot: string,
  filePath: string,
  document: ConfigRepositoryDocument,
): ConfigRepositoryWriteResult | null {
  const host = getRuntimeHost()
  if (!host?.writeConfigRepositoryDocument) {
    return null
  }

  try {
    host.assertCanWriteConfig?.(
      workspaceRoot,
      filePath,
      structuredClone(document),
    )

    const result = host.writeConfigRepositoryDocument(
      workspaceRoot,
      filePath,
      structuredClone(document),
    )

    if (result === undefined) {
      return null
    }

    if (result.status === 'ok') {
      return { status: 'ok', filePath }
    }

    return {
      status: 'error',
      filePath,
      cause: result.providerId
        ? createConfigRepositoryProviderError(result.providerId, result.cause)
        : result.cause,
    }
  } catch (error) {
    return { status: 'error', filePath, cause: error }
  }
}

function readConfigRepositoryDocumentFromProvider(
  providerRef: ProviderRef,
  workspaceRoot: string,
  documentId: string,
  filePath: string,
): ConfigRepositoryReadResult | null {
  const resolver = getConfigStorageProviderResolver()
  if (!resolver || providerRef.provider === 'localfs') return null

  let resolvedProvider: ResolvedConfigStorageRepositoryProvider
  try {
    resolvedProvider = resolver(providerRef, workspaceRoot, documentId)
  } catch (error) {
    return {
      status: 'error',
      filePath,
      reason: 'read',
      cause: createConfigRepositoryProviderError(providerRef.provider, error),
    }
  }

  try {
    const rawDocument = resolvedProvider.provider.readConfigDocument()
    if (rawDocument == null) {
      return { status: 'missing', filePath }
    }

    if (!isConfigRepositoryDocument(rawDocument)) {
      return {
        status: 'error',
        filePath,
        reason: 'parse',
        cause: new ConfigRepositoryProviderError(
          providerRef.provider,
          'Config storage provider returned an invalid config document.',
          rawDocument,
        ),
      }
    }

    return {
      status: 'ok',
      filePath,
      value: applyExplicitConfigStorageProviderRef(rawDocument, providerRef),
    }
  } catch (error) {
    return {
      status: 'error',
      filePath,
      reason: 'read',
      cause: createConfigRepositoryProviderError(providerRef.provider, error),
    }
  }
}

function writeConfigRepositoryDocumentToProvider(
  providerRef: ProviderRef,
  workspaceRoot: string,
  documentId: string,
  filePath: string,
  document: ConfigRepositoryDocument,
): ConfigRepositoryWriteResult | null {
  const resolver = getConfigStorageProviderResolver()
  if (!resolver || providerRef.provider === 'localfs') return null

  try {
    getRuntimeHost()?.assertCanWriteConfig?.(
      workspaceRoot,
      filePath,
      structuredClone(document),
    )

    const resolvedProvider = resolver(providerRef, workspaceRoot, documentId)
    resolvedProvider.provider.writeConfigDocument(applyExplicitConfigStorageProviderRef(document, providerRef))
    return { status: 'ok', filePath }
  } catch (error) {
    return {
      status: 'error',
      filePath,
      cause: createConfigRepositoryProviderError(providerRef.provider, error),
    }
  }
}

/**
 * Reads the raw workspace config document from the shared config repository.
 *
 * This preserves unresolved env placeholders and unknown fields so callers that
 * need to mutate the persisted document (for example plugin-settings flows) can
 * round-trip the original structure without materializing runtime-only values.
 * Recovery fallback to the local/bootstrap seed is intentionally limited to
 * explicit control-plane/bootstrap callers via `allowSeedFallbackOnProviderError`;
 * generic runtime config reads stay fail-closed for explicit non-localfs
 * provider failures or missing remote documents.
 */
export function readConfigRepositoryDocument(
  workspaceRoot: string,
  options?: ConfigRepositoryReadOptions,
): ConfigRepositoryReadResult {
  const filePath = getConfigRepositoryFilePath(workspaceRoot)
  const documentId = getConfigRepositoryDocumentId()
  const runtimeHostResult = readConfigRepositoryDocumentFromRuntimeHost(workspaceRoot, filePath)
  const seedResult = runtimeHostResult && !options?.allowSeedFallbackOnProviderError
    ? readFileConfigRepositoryDocument(filePath)
    : readSeedConfigRepositoryDocument(workspaceRoot, filePath)

  if (runtimeHostResult) {
    if (runtimeHostResult.status === 'error' && seedResult.status === 'ok' && options?.allowSeedFallbackOnProviderError) {
      return seedResult
    }

    return runtimeHostResult
  }

  const explicitConfigStorage = seedResult.status === 'ok'
    ? normalizeExplicitConfigStorageProviderRef(seedResult.value)
    : null
  if (!explicitConfigStorage || explicitConfigStorage.provider === 'localfs') {
    return seedResult
  }

  const providerResult = readConfigRepositoryDocumentFromProvider(
    explicitConfigStorage,
    workspaceRoot,
    documentId,
    filePath,
  )
  if (!providerResult) {
    return seedResult
  }

  if (providerResult.status === 'missing') {
    if (seedResult.status === 'ok' && options?.allowSeedFallbackOnProviderError) {
      return seedResult
    }

    return {
      status: 'error',
      filePath,
      reason: 'read',
      cause: createMissingConfigRepositoryDocumentError(explicitConfigStorage.provider),
    }
  }

  if (providerResult.status === 'error' && seedResult.status === 'ok' && options?.allowSeedFallbackOnProviderError) {
    return seedResult
  }

  return providerResult
}

/**
 * Writes the raw workspace config document through the shared config repository.
 *
 * Runtime hosts may intercept writes for provider-backed config storage. When no
 * runtime host handles the request, the built-in local `.kanban.json` file is
 * used as the fallback persistence backend.
 */
export function writeConfigRepositoryDocument(
  workspaceRoot: string,
  config: ConfigRepositoryDocument,
): ConfigRepositoryWriteResult {
  const filePath = getConfigRepositoryFilePath(workspaceRoot)
  const documentId = getConfigRepositoryDocumentId()
  const nextConfig = structuredClone(config)
  const runtimeHostResult = writeConfigRepositoryDocumentToRuntimeHost(
    workspaceRoot,
    filePath,
    nextConfig,
  )
  if (runtimeHostResult) {
    return runtimeHostResult
  }

  const explicitConfigStorage = normalizeExplicitConfigStorageProviderRef(nextConfig)

  if (explicitConfigStorage && explicitConfigStorage.provider !== 'localfs') {
    const providerResult = writeConfigRepositoryDocumentToProvider(
      explicitConfigStorage,
      workspaceRoot,
      documentId,
      filePath,
      nextConfig,
    )
    if (providerResult) return providerResult
  }

  try {
    getRuntimeHost()?.assertCanWriteConfig?.(
      workspaceRoot,
      filePath,
      structuredClone(nextConfig),
    )

    if (getRuntimeHost()?.writeConfig?.(workspaceRoot, filePath, nextConfig)) {
      return { status: 'ok', filePath }
    }

    fs.writeFileSync(filePath, JSON.stringify(nextConfig, null, 2) + '\n', 'utf-8')
    return { status: 'ok', filePath }
  } catch (error) {
    return { status: 'error', filePath, cause: error }
  }
}
