import * as fs from 'node:fs'
import * as path from 'node:path'
import type { KanbanConfig } from './config'

export interface RuntimeHost {
  readConfig?(workspaceRoot: string, filePath: string): Record<string, unknown> | undefined
  writeConfig?(workspaceRoot: string, filePath: string, config: KanbanConfig): boolean
  loadWorkspaceEnv?(workspaceRoot: string): boolean
  resolveExternalModule?(request: string): unknown
}

const LOADED_ENV_FILES = new Set<string>()
let runtimeHost: RuntimeHost | null = null

function parseEnvValue(rawValue: string): string {
  const trimmed = rawValue.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    const unwrapped = trimmed.slice(1, -1)
    return trimmed.startsWith('"') ? unwrapped.replace(/\\n/g, '\n') : unwrapped
  }
  return trimmed
}

export function installRuntimeHost(host: RuntimeHost | null): void {
  runtimeHost = host
}

export function getRuntimeHost(): RuntimeHost | null {
  return runtimeHost
}

export function resetRuntimeHost(): void {
  runtimeHost = null
}

/**
 * Loads workspace-local environment variables from `<workspaceRoot>/.env`.
 *
 * Existing `process.env` values win, so explicit shell/CI variables still override
 * local defaults. The same file is parsed at most once per process.
 */
export function loadWorkspaceEnv(workspaceRoot: string): void {
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
