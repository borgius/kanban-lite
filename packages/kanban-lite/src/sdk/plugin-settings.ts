/**
 * Plugin settings contract: exported types, constants, error classes, and
 * install-request helpers consumed by the SDK, CLI, MCP server, REST API,
 * and extension surfaces.
 *
 * @internal This module is re-exported from `KanbanSDK.ts` for public access.
 */
import * as childProcess from 'node:child_process'
import type {
  PluginSettingsErrorPayload,
  PluginSettingsInstallRequest,
  PluginSettingsInstallScope,
  PluginSettingsRedactionPolicy,
  PluginSettingsRedactionTarget,
} from '../shared/types'
import type { PluginCapabilityNamespace } from '../shared/config'
import { AuthError } from './types'
import { PluginSettingsStoreError } from './plugins'

/** Shared plugin secret redaction targets that every surface must honor. */
export const PLUGIN_SETTINGS_REDACTION_TARGETS = ['read', 'list', 'error'] as const satisfies readonly PluginSettingsRedactionTarget[]

/** Default write-only secret masking policy for plugin settings contracts. */
export const DEFAULT_PLUGIN_SETTINGS_REDACTION: PluginSettingsRedactionPolicy = {
  maskedValue: '••••••',
  writeOnly: true,
  targets: PLUGIN_SETTINGS_REDACTION_TARGETS,
}

/** Supported install scopes for in-product plugin installation requests. */
export const PLUGIN_SETTINGS_INSTALL_SCOPES = ['workspace', 'global'] as const satisfies readonly PluginSettingsInstallScope[]

/** Exact package-name matcher for install requests accepted by the plugin settings contract. */
export const EXACT_PLUGIN_SETTINGS_PACKAGE_NAME_PATTERN = /^kl-[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Stable validation error codes for plugin settings contract violations. */
export type PluginSettingsValidationErrorCode =
  | 'invalid-plugin-install-package-name'
  | 'invalid-plugin-install-scope'

/** Error thrown when plugin settings SDK operations fail with a redacted payload. */
export class PluginSettingsOperationError extends Error {
  readonly payload: PluginSettingsErrorPayload

  constructor(payload: PluginSettingsErrorPayload) {
    super(payload.message)
    this.name = 'PluginSettingsOperationError'
    this.payload = payload
  }
}

/** Error thrown when a plugin settings contract validation boundary rejects input. */
export class PluginSettingsValidationError extends Error {
  readonly code: PluginSettingsValidationErrorCode

  constructor(code: PluginSettingsValidationErrorCode, message: string) {
    super(message)
    this.name = 'PluginSettingsValidationError'
    this.code = code
  }
}

/** Fixed argv install command emitted by the SDK-owned plugin installer. */
export interface PluginSettingsInstallCommand {
  command: 'npm'
  args: string[]
  cwd: string
  shell: false
}

/** Structured success payload returned by guarded plugin install requests. */
export interface PluginSettingsInstallResult {
  packageName: string
  scope: PluginSettingsInstallScope
  command: PluginSettingsInstallCommand
  stdout: string
  stderr: string
  message: string
  redaction: PluginSettingsRedactionPolicy
}

interface PluginSettingsInstallExecutionResult {
  exitCode: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
}

export const PLUGIN_SETTINGS_INSTALL_SUCCESS_MESSAGE = 'Installed plugin package with lifecycle scripts disabled.'
export const PLUGIN_SETTINGS_INSTALL_FAILURE_MESSAGE = 'Unable to install plugin package. In-product installs disable lifecycle scripts; install the package manually if it requires lifecycle scripts.'

export function createPluginSettingsInstallCommand(
  request: PluginSettingsInstallRequest,
  workspaceRoot: string,
): PluginSettingsInstallCommand {
  return {
    command: 'npm',
    args: request.scope === 'global'
      ? ['install', '--global', '--ignore-scripts', request.packageName]
      : ['install', '--ignore-scripts', request.packageName],
    cwd: workspaceRoot,
    shell: false,
  }
}

export function createPluginSettingsManualInstallCommand(
  request: PluginSettingsInstallRequest,
  workspaceRoot: string,
): PluginSettingsInstallCommand {
  return {
    command: 'npm',
    args: request.scope === 'global'
      ? ['install', '--global', request.packageName]
      : ['install', request.packageName],
    cwd: workspaceRoot,
    shell: false,
  }
}

export function redactPluginSettingsInstallOutput(value: string): string {
  let redacted = value.replace(/\r\n/g, '\n')

  redacted = redacted.replace(
    /([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^/\s:@]+):([^@\s/]+)@/g,
    '$1[REDACTED]:[REDACTED]@',
  )
  redacted = redacted.replace(/(authorization\s*:\s*bearer\s+)[^\s]+/gi, '$1[REDACTED]')
  redacted = redacted.replace(/(authorization\s*:\s*basic\s+)[^\s]+/gi, '$1[REDACTED]')
  redacted = redacted.replace(
    /((_authToken|npm[_-]?auth[_-]?token|token|password|passwd|secret)\s*[=:]\s*)("?)[^"\s]+(\3)/gi,
    '$1$3[REDACTED]$4',
  )

  return redacted.trim()
}

export function runPluginSettingsInstallCommand(
  command: PluginSettingsInstallCommand,
): Promise<PluginSettingsInstallExecutionResult> {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(command.command, command.args, {
      cwd: command.cwd,
      shell: command.shell,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString()
    })

    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString()
    })

    child.once('error', reject)
    child.once('close', (exitCode, signal) => {
      resolve({ exitCode, signal, stdout, stderr })
    })
  })
}

/** Returns `true` when `value` is a supported plugin install scope. */
export function isPluginSettingsInstallScope(value: unknown): value is PluginSettingsInstallScope {
  return typeof value === 'string' && (PLUGIN_SETTINGS_INSTALL_SCOPES as readonly string[]).includes(value)
}

/** Returns `true` when `value` is an exact unscoped `kl-*` npm package name. */
export function isExactPluginSettingsPackageName(value: unknown): value is string {
  return typeof value === 'string' && EXACT_PLUGIN_SETTINGS_PACKAGE_NAME_PATTERN.test(value)
}

/**
 * Validates the SDK install request contract for plugin settings flows.
 *
 * Only exact unscoped `kl-*` package names are accepted. Version specifiers,
 * paths, URLs, shell fragments, whitespace-delimited arguments, and other
 * npm wrapper syntax are rejected at this boundary before any subprocess work
 * is attempted.
 */
export function validatePluginSettingsInstallRequest(input: {
  packageName: unknown
  scope: unknown
}): PluginSettingsInstallRequest {
  if (!isPluginSettingsInstallScope(input.scope)) {
    throw new PluginSettingsValidationError(
      'invalid-plugin-install-scope',
      'Plugin install requests must declare an explicit install scope of "workspace" or "global".',
    )
  }

  if (!isExactPluginSettingsPackageName(input.packageName)) {
    throw new PluginSettingsValidationError(
      'invalid-plugin-install-package-name',
      'Plugin install requests must use an exact unscoped kl-* package name with no version specifier, flag, URL, path, whitespace, or shell fragment.',
    )
  }

  return {
    packageName: input.packageName,
    scope: input.scope,
  }
}

/** Applies the shared plugin secret redaction policy to surfaced error payloads. */
export function createPluginSettingsErrorPayload(input: {
  code: string
  message: string
  capability?: PluginCapabilityNamespace
  providerId?: string
  details?: Record<string, unknown>
  redaction?: PluginSettingsRedactionPolicy
}): PluginSettingsErrorPayload {
  return {
    code: input.code,
    message: input.message,
    capability: input.capability,
    providerId: input.providerId,
    details: input.details,
    redaction: input.redaction ?? DEFAULT_PLUGIN_SETTINGS_REDACTION,
  }
}

export function toPluginSettingsOperationError(input: {
  error: unknown
  fallbackCode: string
  fallbackMessage: string
  capability?: PluginCapabilityNamespace
  providerId?: string
}): PluginSettingsOperationError {
  if (input.error instanceof AuthError) {
    throw input.error
  }

  if (input.error instanceof PluginSettingsOperationError) {
    return input.error
  }

  if (input.error instanceof PluginSettingsStoreError) {
    return new PluginSettingsOperationError(createPluginSettingsErrorPayload({
      code: input.error.code,
      message: input.error.message,
      capability: input.capability,
      providerId: input.providerId,
      details: input.error.details,
    }))
  }

  if (input.error instanceof PluginSettingsValidationError) {
    return new PluginSettingsOperationError(createPluginSettingsErrorPayload({
      code: input.error.code,
      message: input.error.message,
      capability: input.capability,
      providerId: input.providerId,
    }))
  }

  return new PluginSettingsOperationError(createPluginSettingsErrorPayload({
    code: input.fallbackCode,
    message: input.fallbackMessage,
    capability: input.capability,
    providerId: input.providerId,
  }))
}
