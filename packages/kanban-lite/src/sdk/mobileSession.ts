import * as crypto from 'node:crypto'
import * as path from 'node:path'
import type {
  InspectMobileSessionInput,
  MobileAuthenticationContract,
  MobileSessionStatus,
  ResolveMobileBootstrapInput,
  ResolveMobileBootstrapResult,
} from './types'

/** Fixed mobile/local auth contract shared by bootstrap and session inspection helpers. */
export const MOBILE_AUTHENTICATION_CONTRACT: Readonly<MobileAuthenticationContract> = Object.freeze({
  provider: 'local',
  browserLoginTransport: 'cookie-session',
  mobileSessionTransport: 'opaque-bearer',
  sessionKind: 'local-mobile-session-v1',
})

/** Returns a fresh mutable copy of the fixed mobile/local auth contract. */
export function cloneMobileAuthenticationContract(): MobileAuthenticationContract {
  return { ...MOBILE_AUTHENTICATION_CONTRACT }
}

/** Builds the stable mobile workspace namespace identifier for a workspace root. */
export function buildMobileWorkspaceId(workspaceRoot: string): string {
  const normalizedWorkspaceRoot = path.resolve(workspaceRoot).replace(/\\/g, '/')
  const portableWorkspaceRoot = process.platform === 'win32'
    ? normalizedWorkspaceRoot.toLowerCase()
    : normalizedWorkspaceRoot
  const hash = crypto.createHash('sha256').update(portableWorkspaceRoot).digest('hex').slice(0, 12)
  return `workspace_${hash}`
}

function normalizeRequiredText(value: string, fieldName: string): string {
  const normalized = value.trim()
  if (!normalized) {
    throw new Error(`${fieldName} is required`)
  }
  return normalized
}

function normalizeMobileWorkspaceOrigin(workspaceOrigin: string): string {
  const normalized = normalizeRequiredText(workspaceOrigin, 'workspaceOrigin')
  try {
    return new URL(normalized).origin
  } catch {
    throw new Error('workspaceOrigin must be an absolute URL')
  }
}

function normalizeMobileRoles(roles?: string[]): string[] {
  if (!Array.isArray(roles)) return []

  const normalized: string[] = []
  const seen = new Set<string>()
  for (const role of roles) {
    const trimmed = role.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    normalized.push(trimmed)
  }
  return normalized
}

/** Resolves the canonical mobile bootstrap contract for a workspace entry attempt. */
export function resolveMobileBootstrap(
  workspaceRoot: string,
  input: ResolveMobileBootstrapInput,
): ResolveMobileBootstrapResult {
  const workspaceOrigin = normalizeMobileWorkspaceOrigin(input.workspaceOrigin)
  const bootstrapToken = typeof input.bootstrapToken === 'string' ? input.bootstrapToken.trim() : ''
  const hasBootstrapToken = bootstrapToken.length > 0

  return {
    workspaceOrigin,
    workspaceId: buildMobileWorkspaceId(workspaceRoot),
    authentication: cloneMobileAuthenticationContract(),
    bootstrapToken: {
      provided: hasBootstrapToken,
      mode: hasBootstrapToken ? 'one-time' : 'none',
    },
    nextStep: hasBootstrapToken ? 'redeem-bootstrap-token' : 'local-login',
  }
}

/** Builds the safe mobile session-status payload for validated session metadata. */
export function inspectMobileSession(
  workspaceRoot: string,
  input: InspectMobileSessionInput,
): MobileSessionStatus {
  return {
    workspaceOrigin: normalizeMobileWorkspaceOrigin(input.workspaceOrigin),
    workspaceId: buildMobileWorkspaceId(workspaceRoot),
    subject: normalizeRequiredText(input.subject, 'subject'),
    roles: normalizeMobileRoles(input.roles),
    expiresAt: input.expiresAt ?? null,
    authentication: cloneMobileAuthenticationContract(),
  }
}
