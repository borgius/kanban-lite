import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ConfigStorageFailure, KanbanConfig } from './config'
import type { CloudflareWorkerProviderContext } from '../sdk/env'
import {
  getSharedRuntimeHost,
  installSharedRuntimeHost,
  resetSharedRuntimeHost,
} from './runtimeHostState'

export interface RuntimeHostRawConfigDocument extends Record<string, unknown> {
  version?: 1 | KanbanConfig['version']
  defaultBoard?: KanbanConfig['defaultBoard']
  kanbanDirectory?: KanbanConfig['kanbanDirectory']
  boards?: Record<string, unknown>
  storageEngine?: KanbanConfig['storageEngine']
  sqlitePath?: KanbanConfig['sqlitePath']
  plugins?: KanbanConfig['plugins']
}

export type RuntimeHostConfigDocument = KanbanConfig | RuntimeHostRawConfigDocument
export type RuntimeHostConfigSelection = Pick<RuntimeHostRawConfigDocument, 'storageEngine' | 'sqlitePath' | 'plugins'>

export type RuntimeHostConfigRepositoryReadResult =
  | { status: 'ok'; value: RuntimeHostConfigDocument; providerId?: string }
  | { status: 'missing'; providerId?: string }
  | { status: 'error'; reason: 'read' | 'parse'; cause: unknown; providerId?: string }

export type RuntimeHostConfigRepositoryWriteResult =
  | { status: 'ok'; providerId?: string }
  | { status: 'error'; cause: unknown; providerId?: string }

export interface RuntimeHostActiveCardScope {
  workspaceRoot: string
  kanbanDir: string
}

export interface RuntimeHostActiveCardState {
  cardId: string
  boardId: string
  updatedAt: string
}

export interface RuntimeHost {
  readConfig?(workspaceRoot: string, filePath: string): RuntimeHostConfigDocument | undefined
  writeConfig?(workspaceRoot: string, filePath: string, config: RuntimeHostConfigDocument): boolean
  readConfigRepositoryDocument?(
    workspaceRoot: string,
    filePath: string,
  ): RuntimeHostConfigRepositoryReadResult | undefined
  writeConfigRepositoryDocument?(
    workspaceRoot: string,
    filePath: string,
    config: RuntimeHostConfigDocument,
  ): RuntimeHostConfigRepositoryWriteResult | undefined
  assertCanWriteConfig?(workspaceRoot: string, filePath: string, config: RuntimeHostConfigDocument): void
  getConfigStorageFailure?(
    workspaceRoot: string,
    config: RuntimeHostConfigSelection,
  ): ConfigStorageFailure | null | undefined
  loadWorkspaceEnv?(workspaceRoot: string): boolean
  resolveExternalModule?(request: string): unknown
  readActiveCardState?(
    scope: RuntimeHostActiveCardScope,
  ): RuntimeHostActiveCardState | null | Promise<RuntimeHostActiveCardState | null>
  writeActiveCardState?(
    scope: RuntimeHostActiveCardScope,
    state: RuntimeHostActiveCardState,
  ): void | Promise<void>
  clearActiveCardState?(scope: RuntimeHostActiveCardScope): void | Promise<void>
  getCloudflareWorkerProviderContext?(): CloudflareWorkerProviderContext | null | undefined
}

const LOADED_ENV_FILES = new Set<string>()

function parseEnvValue(rawValue: string): string {
  const trimmed = rawValue.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    const unwrapped = trimmed.slice(1, -1)
    return trimmed.startsWith('"') ? unwrapped.replace(/\\n/g, '\n') : unwrapped
  }
  return trimmed
}

export function installRuntimeHost(host: RuntimeHost | null): void {
  installSharedRuntimeHost(host)
}

export function getRuntimeHost(): RuntimeHost | null {
  return getSharedRuntimeHost()
}

export function resetRuntimeHost(): void {
  resetSharedRuntimeHost()
}

/**
 * Loads workspace-local environment variables from `<workspaceRoot>/.env`.
 *
 * Existing `process.env` values win, so explicit shell/CI variables still override
 * local defaults. The same file is parsed at most once per process.
 */
export function loadWorkspaceEnv(workspaceRoot: string): void {
  const runtimeHost = getRuntimeHost()
  if (runtimeHost?.loadWorkspaceEnv?.(workspaceRoot)) return

  const envFilePath = path.join(workspaceRoot, '.env')
  if (LOADED_ENV_FILES.has(envFilePath)) return

  let content: string
  try {
    content = fs.readFileSync(envFilePath, 'utf-8')
  } catch {
    return
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const normalizedLine = trimmed.startsWith('export ') ? trimmed.slice('export '.length) : trimmed
    const equalsIndex = normalizedLine.indexOf('=')
    if (equalsIndex <= 0) continue

    const key = normalizedLine.slice(0, equalsIndex).trim()
    if (!key || process.env[key] !== undefined) continue

    const rawValue = normalizedLine.slice(equalsIndex + 1)
    process.env[key] = parseEnvValue(rawValue)
  }

  LOADED_ENV_FILES.add(envFilePath)
}
