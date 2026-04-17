import * as fs from 'node:fs'
import * as path from 'path'
import { createRequire } from 'node:module'
import { getRuntimeHost } from '../../shared/env'
import type { CloudflareWorkerProviderContext } from '../env'

export const runtimeRequire = createRequire(
  typeof __filename === 'string' && __filename
    ? __filename
    : path.join(process.cwd(), '__kanban-runtime__.cjs')
)

/**
 * Walks up from `startDir` looking for a `pnpm-workspace.yaml` file that
 * marks the workspace root.  Returns the first matching ancestor directory,
 * or `null` when running outside the monorepo (e.g., after a standalone npm
 * install by a user).
 *
 * @internal
 */
function findWorkspaceRoot(startDir: string): string | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { existsSync } = require('node:fs') as typeof import('node:fs')
  let dir = startDir
  for (let i = 0; i < 10; i++) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
  return null
}

/**
 * The pnpm workspace root directory, resolved once at module load time.
 *
 * - Inside the monorepo checkout: the absolute path to the repository root
 *   (contains `pnpm-workspace.yaml`).
 * - Outside the monorepo (standalone npm install): `null`.
 *
 * Used by the plugin loader to probe `packages/{name}` as the primary
 * workspace-local resolution path during the staged monorepo migration.
 *
 * @internal
 */
export const WORKSPACE_ROOT: string | null = findWorkspaceRoot(
  path.dirname(
    typeof __filename === 'string' && __filename
      ? __filename
      : path.join(process.cwd(), '__kanban-runtime__.cjs'),
  ),
)

export function getCloudflareWorkerProviderContext(): CloudflareWorkerProviderContext | null {
  return getRuntimeHost()?.getCloudflareWorkerProviderContext?.() ?? null
}

// ---------------------------------------------------------------------------
// Error detection helpers
// ---------------------------------------------------------------------------

function messageIncludesPathHint(message: string, hint: string): boolean {
  const normalizedMessage = message.replace(/\\/g, '/')
  const normalizedHint = hint.replace(/\\/g, '/')
  return normalizedMessage.includes(`'${hint}'`)
    || normalizedMessage.includes(`"${hint}"`)
    || normalizedMessage.includes(hint)
    || normalizedMessage.includes(normalizedHint)
}

export function isRecoverableMissingModuleError(err: unknown, ...hints: string[]): err is NodeJS.ErrnoException {
  const code = (err as NodeJS.ErrnoException)?.code
  const message = typeof (err as Error)?.message === 'string' ? (err as Error).message : ''
  // Standard Node.js missing-module codes
  const isKnownCode = ['MODULE_NOT_FOUND', 'ENOENT', 'ENOTDIR'].includes(code ?? '')
  // Cloudflare Workers throws "No such module 'bundle/…'" without a standard error code
  const isCloudflareModuleNotFound = !code && message.startsWith('No such module ')
  return (isKnownCode || isCloudflareModuleNotFound)
    && hints.some((hint) => hint.length > 0 && messageIncludesPathHint(message, hint))
}

function resolveInstalledModuleEntry(request: string): string | null {
  if (typeof runtimeRequire.resolve !== 'function') {
    return null
  }

  try {
    return runtimeRequire.resolve(request)
  } catch (err: unknown) {
    if (!isRecoverableMissingModuleError(err, request, path.join('node_modules', request))) throw err
    return null
  }
}

function isStaleResolvedModuleEntry(resolvedPath: string, err: unknown): boolean {
  if (!isRecoverableMissingModuleError(err, resolvedPath, path.dirname(resolvedPath))) {
    return false
  }
  return !fs.existsSync(resolvedPath) || !fs.existsSync(path.dirname(resolvedPath))
}

/**
 * Tries to load an external plugin from the global npm node_modules directory.
 * The global prefix is derived from the Node.js binary path ({@link process.execPath}).
 * On Unix-like systems the global node_modules directory is `{prefix}/lib/node_modules`;
 * on Windows it is `{prefix}/node_modules`.
 *
 * @internal
 */
function tryLoadGlobalPackage(request: string): unknown {
  const npmPrefix = path.resolve(process.execPath, '..', '..')
  const globalNodeModules = process.platform === 'win32'
    ? path.join(npmPrefix, 'node_modules')
    : path.join(npmPrefix, 'lib', 'node_modules')
  const globalRequire = createRequire(path.join(globalNodeModules, '_kanban_sentinel_.js'))
  return globalRequire(request)
}

export function loadExternalModule(request: string): unknown {
  const hostedModule = getRuntimeHost()?.resolveExternalModule?.(request)
  if (hostedModule !== undefined) return hostedModule

  // 1. Standard npm resolution (installed package or pnpm workspace symlink).
  //    Some worker runtimes expose createRequire() without require.resolve().
  //    In that case fall back to a direct require() probe before workspace
  //    lookup so installed dependencies still win over monorepo fallbacks.
  if (typeof runtimeRequire.resolve !== 'function') {
    try {
      return runtimeRequire(request)
    } catch (err: unknown) {
      if (!isRecoverableMissingModuleError(err, request, path.join('node_modules', request))) throw err
    }
  }

  const resolvedInstalledEntry = resolveInstalledModuleEntry(request)
  if (resolvedInstalledEntry) {
    try {
      return runtimeRequire(resolvedInstalledEntry)
    } catch (err: unknown) {
      if (!isStaleResolvedModuleEntry(resolvedInstalledEntry, err)) throw err
    }
  }

  // 2. Workspace-local packages/{request} (monorepo layout).
  if (WORKSPACE_ROOT) {
    const workspacePackagePath = path.resolve(WORKSPACE_ROOT, 'packages', request)
    try {
      return runtimeRequire(workspacePackagePath)
    } catch (workspaceErr: unknown) {
      if (!isRecoverableMissingModuleError(workspaceErr, workspacePackagePath)) throw workspaceErr
    }
  }

  // 3. Globally installed npm package (npm install -g ...).
  try {
    return tryLoadGlobalPackage(request)
  } catch (err: unknown) {
    if (!isRecoverableMissingModuleError(err, request)) throw err
  }

  // 4. Legacy sibling path ../request.
  const siblingPackagePath = path.resolve(process.cwd(), '..', request)
  try {
    return runtimeRequire(siblingPackagePath)
  } catch (siblingErr: unknown) {
    if (isRecoverableMissingModuleError(siblingErr, siblingPackagePath)) {
      throw new Error(`Plugin package "${request}" is not installed. Run: npm install ${request}`)
    }
    throw siblingErr
  }
}

/**
 * Resolves a `callback.runtime` module through the standard runtime-host-first
 * external module seam.
 *
 * This keeps callback providers on the public SDK contract instead of reaching
 * into plugin-loader internals directly.
 */
export function resolveCallbackRuntimeModule(request: string): unknown {
  return loadExternalModule(request)
}

// ---------------------------------------------------------------------------
// Source-aware external module loading (used by plugin-discovery)
// ---------------------------------------------------------------------------

/** Discovery source for an externally loaded module (excludes 'builtin'). */
export type ExternalPluginDiscoverySource = 'workspace' | 'dependency' | 'global' | 'sibling'

/** Result of loading an external module with its discovery source. */
export interface ResolvedExternalModule {
  module: unknown
  source: ExternalPluginDiscoverySource
}

export function resolveExternalModuleWithSource(request: string): ResolvedExternalModule {
  const hostedModule = getRuntimeHost()?.resolveExternalModule?.(request)
  if (hostedModule !== undefined) {
    return { module: hostedModule, source: 'dependency' }
  }

  if (WORKSPACE_ROOT) {
    const workspacePackagePath = path.resolve(WORKSPACE_ROOT, 'packages', request)
    try {
      return { module: runtimeRequire(workspacePackagePath), source: 'workspace' }
    } catch (workspaceErr: unknown) {
      if (!isRecoverableMissingModuleError(workspaceErr, workspacePackagePath)) throw workspaceErr
    }
  }

  try {
    return { module: runtimeRequire(request), source: 'dependency' }
  } catch (err: unknown) {
    if (!isRecoverableMissingModuleError(err, request, path.join('node_modules', request))) throw err
  }

  try {
    return { module: tryLoadGlobalPackage(request), source: 'global' }
  } catch (err: unknown) {
    if (!isRecoverableMissingModuleError(err, request)) throw err
  }

  const siblingPackagePath = path.resolve(process.cwd(), '..', request)
  try {
    return { module: runtimeRequire(siblingPackagePath), source: 'sibling' }
  } catch (siblingErr: unknown) {
    if (isRecoverableMissingModuleError(siblingErr, siblingPackagePath)) {
      throw new Error(`Plugin package "${request}" is not installed. Run: npm install ${request}`)
    }
    throw siblingErr
  }
}

export function tryResolveExternalModuleWithSource(request: string): ResolvedExternalModule | null {
  try {
    return resolveExternalModuleWithSource(request)
  } catch {
    return null
  }
}
