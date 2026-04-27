import type {
  AuthContext,
  AuthIdentity,
  AuthIdentityPlugin,
  PluginSettingsOptionsSchemaMetadata,
} from 'kanban-lite/sdk'

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
type JwtClaims = Record<string, JsonValue | undefined>
type AccessJwk = JsonWebKey & { readonly kid?: string }

export interface CloudflareAccessIdentityOptions {
  readonly teamName?: string
  readonly issuer?: string
  readonly audience?: string | readonly string[]
  readonly jwksUrl?: string
  readonly jwks?: readonly AccessJwk[]
  readonly jwksTtlSeconds?: number
  readonly leewaySeconds?: number
  readonly subjectClaim?: string
  readonly emailClaim?: string
  readonly groupsClaim?: string
  readonly rolesClaim?: string
  readonly defaultRoles?: readonly string[]
  readonly roleMappings?: Readonly<Record<string, readonly string[]>>
}

interface JwtHeader {
  readonly alg?: string
  readonly kid?: string
  readonly typ?: string
}

interface CachedJwks {
  readonly keys: readonly AccessJwk[]
  readonly expiresAt: number
}

const DEFAULT_JWKS_TTL_SECONDS = 300
const MAX_JWKS_TTL_SECONDS = 3600
const DEFAULT_LEEWAY_SECONDS = 60

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function stringArrayOrUndefined(value: unknown): string[] | undefined {
  if (typeof value === 'string' && value.trim().length > 0) return [value.trim()]
  if (!Array.isArray(value)) return undefined
  const values = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean)
  return values.length > 0 ? values : undefined
}

function stringRecordArrayOrUndefined(value: unknown): Record<string, string[]> | undefined {
  if (!isRecord(value)) return undefined
  const entries = Object.entries(value)
    .map(([key, mapped]) => [key.trim(), stringArrayOrUndefined(mapped)] as const)
    .filter((entry): entry is readonly [string, string[]] => entry[0].length > 0 && Array.isArray(entry[1]))
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function normalizeOptions(options?: Record<string, unknown>): Required<Omit<
  CloudflareAccessIdentityOptions,
  'teamName' | 'issuer' | 'audience' | 'jwksUrl' | 'jwks' | 'roleMappings'
>> & {
  readonly teamName?: string
  readonly issuer?: string
  readonly audience: readonly string[]
  readonly jwksUrl?: string
  readonly jwks?: readonly AccessJwk[]
  readonly roleMappings: Readonly<Record<string, readonly string[]>>
} {
  const teamName = stringOrUndefined(options?.teamName)
  const issuer = stringOrUndefined(options?.issuer)
  const audience = stringArrayOrUndefined(options?.audience) ?? []
  const jwksUrl = stringOrUndefined(options?.jwksUrl)
  const jwks = Array.isArray(options?.jwks)
    ? options.jwks.filter((entry): entry is AccessJwk => isRecord(entry))
    : undefined
  const jwksTtlSecondsValue = typeof options?.jwksTtlSeconds === 'number' && Number.isFinite(options.jwksTtlSeconds)
    ? Math.max(0, Math.min(MAX_JWKS_TTL_SECONDS, options.jwksTtlSeconds))
    : DEFAULT_JWKS_TTL_SECONDS
  const leewaySecondsValue = typeof options?.leewaySeconds === 'number' && Number.isFinite(options.leewaySeconds)
    ? Math.max(0, Math.min(300, options.leewaySeconds))
    : DEFAULT_LEEWAY_SECONDS

  return {
    ...(teamName ? { teamName } : {}),
    ...(issuer ? { issuer } : {}),
    audience,
    ...(jwksUrl ? { jwksUrl } : {}),
    ...(jwks ? { jwks } : {}),
    jwksTtlSeconds: jwksTtlSecondsValue,
    leewaySeconds: leewaySecondsValue,
    subjectClaim: stringOrUndefined(options?.subjectClaim) ?? 'sub',
    emailClaim: stringOrUndefined(options?.emailClaim) ?? 'email',
    groupsClaim: stringOrUndefined(options?.groupsClaim) ?? 'groups',
    rolesClaim: stringOrUndefined(options?.rolesClaim) ?? 'roles',
    defaultRoles: stringArrayOrUndefined(options?.defaultRoles) ?? [],
    roleMappings: stringRecordArrayOrUndefined(options?.roleMappings) ?? {},
  }
}

function resolveIssuer(options: { readonly teamName?: string; readonly issuer?: string }): string | null {
  if (options.issuer) return options.issuer.replace(/\/+$/, '')
  if (options.teamName) return `https://${options.teamName}.cloudflareaccess.com`
  return null
}

function resolveJwksUrl(issuer: string, configured?: string): string {
  return configured ?? `${issuer}/cdn-cgi/access/certs`
}

function decodeBase64Url(input: string): Uint8Array {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=')
  const decoded = atob(padded)
  const bytes = new Uint8Array(decoded.length)
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index)
  }
  return bytes
}

function parseJwtPart<T extends object>(part: string): T | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(decodeBase64Url(part))) as unknown
    return isRecord(parsed) ? parsed as T : null
  } catch {
    return null
  }
}

function getClaimString(claims: JwtClaims, name: string): string | undefined {
  const value = claims[name]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function getClaimStrings(claims: JwtClaims, name: string): string[] {
  const value = claims[name]
  if (typeof value === 'string' && value.length > 0) return [value]
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
}

function getClaimNumber(claims: JwtClaims, name: string): number | undefined {
  const value = claims[name]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function hasAudience(claims: JwtClaims, acceptedAudiences: readonly string[]): boolean {
  if (acceptedAudiences.length === 0) return false
  const audience = claims.aud
  const tokenAudiences = typeof audience === 'string'
    ? [audience]
    : Array.isArray(audience)
      ? audience.filter((entry): entry is string => typeof entry === 'string')
      : []
  return acceptedAudiences.some((accepted) => tokenAudiences.includes(accepted))
}

function validateClaims(
  claims: JwtClaims,
  issuer: string,
  audiences: readonly string[],
  leewaySeconds: number,
): boolean {
  const now = Math.floor(Date.now() / 1000)
  if (getClaimString(claims, 'iss') !== issuer) return false
  if (!hasAudience(claims, audiences)) return false

  const expiresAt = getClaimNumber(claims, 'exp')
  if (expiresAt === undefined || expiresAt <= now - leewaySeconds) return false

  const notBefore = getClaimNumber(claims, 'nbf')
  if (notBefore !== undefined && notBefore > now + leewaySeconds) return false

  const issuedAt = getClaimNumber(claims, 'iat')
  if (issuedAt !== undefined && issuedAt > now + leewaySeconds) return false

  return true
}

async function importVerificationKey(jwk: AccessJwk): Promise<CryptoKey | null> {
  if (jwk.kty !== 'RSA') return null
  // Cloudflare Access JWKS entries may omit alg; the JWT header still must be RS256.
  if (jwk.alg !== undefined && jwk.alg !== 'RS256') return null
  try {
    return await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    )
  } catch {
    return null
  }
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))]
}

function normalizeToken(rawToken?: string): string | null {
  if (!rawToken) return null
  const trimmed = rawToken.trim()
  if (!trimmed) return null
  return trimmed.toLowerCase().startsWith('bearer ')
    ? trimmed.slice(7).trim()
    : trimmed
}

function toIdentity(
  claims: JwtClaims,
  options: ReturnType<typeof normalizeOptions>,
): AuthIdentity | null {
  const subject = getClaimString(claims, options.subjectClaim)
    ?? getClaimString(claims, options.emailClaim)
  if (!subject) return null

  const groups = getClaimStrings(claims, options.groupsClaim)
  const claimedRoles = getClaimStrings(claims, options.rolesClaim)
  const mappedRoles = [...groups, ...claimedRoles].flatMap((value) => options.roleMappings[value] ?? [])
  const roles = uniqueStrings([...options.defaultRoles, ...claimedRoles, ...mappedRoles])

  return {
    subject,
    ...(roles.length > 0 ? { roles } : {}),
    ...(groups.length > 0 ? { groups: uniqueStrings(groups) } : {}),
  }
}

export function createCloudflareAccessOptionsSchema(): PluginSettingsOptionsSchemaMetadata {
  return {
    schema: {
      type: 'object',
      title: 'Cloudflare Access identity options',
      description: 'Validate Cloudflare Access JWT assertions. Configure either a team name or exact issuer plus the Access application audience.',
      additionalProperties: false,
      required: ['audience'],
      anyOf: [
        { required: ['teamName'] },
        { required: ['issuer'] },
      ],
      properties: {
        teamName: {
          type: 'string',
          title: 'Team name',
          description: 'Cloudflare Access team subdomain. For team "acme", the issuer is https://acme.cloudflareaccess.com.',
        },
        issuer: {
          type: 'string',
          title: 'Issuer',
          description: 'Exact expected issuer URL. Overrides team name when set.',
        },
        audience: {
          title: 'Audience',
          description: 'Cloudflare Access application audience tag or list of accepted tags.',
          anyOf: [
            { type: 'string', minLength: 1 },
            { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
          ],
        },
        jwksUrl: {
          type: 'string',
          title: 'JWKS URL',
          description: 'Optional override for the Cloudflare Access certificates endpoint.',
        },
        subjectClaim: {
          type: 'string',
          title: 'Subject claim',
          default: 'sub',
          description: 'JWT claim used as the kanban-lite identity subject.',
        },
        emailClaim: {
          type: 'string',
          title: 'Email claim',
          default: 'email',
          description: 'Fallback subject claim when the subject claim is not present.',
        },
        groupsClaim: {
          type: 'string',
          title: 'Groups claim',
          default: 'groups',
          description: 'JWT claim containing group memberships.',
        },
        rolesClaim: {
          type: 'string',
          title: 'Roles claim',
          default: 'roles',
          description: 'JWT claim containing role names.',
        },
        defaultRoles: {
          type: 'array',
          title: 'Default roles',
          description: 'Roles assigned to every successfully validated Access identity.',
          default: [],
          items: { type: 'string', minLength: 1 },
        },
        roleMappings: {
          type: 'object',
          title: 'Role mappings',
          description: 'Map Access group or role values to additional kanban-lite roles.',
          additionalProperties: {
            type: 'array',
            items: { type: 'string', minLength: 1 },
          },
        },
        jwksTtlSeconds: {
          type: 'number',
          title: 'JWKS cache TTL seconds',
          default: DEFAULT_JWKS_TTL_SECONDS,
          minimum: 0,
          maximum: MAX_JWKS_TTL_SECONDS,
          description: 'Bounded cache duration for fetched Cloudflare Access signing keys.',
        },
        leewaySeconds: {
          type: 'number',
          title: 'Clock leeway seconds',
          default: DEFAULT_LEEWAY_SECONDS,
          minimum: 0,
          maximum: 300,
          description: 'Small clock skew allowance for exp, nbf, and iat checks.',
        },
      },
    },
    uiSchema: {
      type: 'VerticalLayout',
      elements: [
        {
          type: 'Group',
          label: 'Cloudflare Access application',
          elements: [
            { type: 'Control', scope: '#/properties/teamName', label: 'Team name' },
            { type: 'Control', scope: '#/properties/issuer', label: 'Issuer override' },
            { type: 'Control', scope: '#/properties/audience', label: 'Audience' },
            { type: 'Control', scope: '#/properties/jwksUrl', label: 'JWKS URL override' },
          ],
        },
        {
          type: 'Group',
          label: 'Identity claims',
          elements: [
            { type: 'Control', scope: '#/properties/subjectClaim', label: 'Subject claim' },
            { type: 'Control', scope: '#/properties/emailClaim', label: 'Email fallback claim' },
            { type: 'Control', scope: '#/properties/groupsClaim', label: 'Groups claim' },
            { type: 'Control', scope: '#/properties/rolesClaim', label: 'Roles claim' },
          ],
        },
        {
          type: 'Group',
          label: 'Role resolution',
          elements: [
            { type: 'Control', scope: '#/properties/defaultRoles', label: 'Default roles' },
            { type: 'Control', scope: '#/properties/roleMappings', label: 'Role mappings' },
          ],
        },
        {
          type: 'Group',
          label: 'Validation cache',
          elements: [
            { type: 'Control', scope: '#/properties/jwksTtlSeconds', label: 'JWKS cache TTL seconds' },
            { type: 'Control', scope: '#/properties/leewaySeconds', label: 'Clock leeway seconds' },
          ],
        },
      ],
    },
    secrets: [],
  }
}

export function createAuthIdentityPlugin(
  rawOptions?: Record<string, unknown>,
  providerId = 'cloudflare',
): AuthIdentityPlugin {
  const options = normalizeOptions(rawOptions)
  let cache: CachedJwks | null = options.jwks
    ? { keys: options.jwks, expiresAt: Number.POSITIVE_INFINITY }
    : null

  async function loadJwks(issuer: string, forceRefresh: boolean): Promise<readonly AccessJwk[]> {
    const now = Date.now()
    if (!forceRefresh && cache && cache.expiresAt > now) return cache.keys
    if (options.jwks && options.jwks.length > 0) return options.jwks

    const response = await fetch(resolveJwksUrl(issuer, options.jwksUrl))
    if (!response.ok) return []
    const payload = await response.json() as unknown
    const keys = isRecord(payload) && Array.isArray(payload.keys)
      ? payload.keys.filter((entry): entry is AccessJwk => isRecord(entry))
      : []
    cache = {
      keys,
      expiresAt: now + options.jwksTtlSeconds * 1000,
    }
    return keys
  }

  async function verifyWithKeys(
    signingInput: string,
    signature: Uint8Array,
    kid: string,
    issuer: string,
  ): Promise<boolean> {
    for (const forceRefresh of [false, true]) {
      const jwks = await loadJwks(issuer, forceRefresh)
      const jwk = jwks.find((key) => key.kid === kid)
      if (!jwk) continue
      const key = await importVerificationKey(jwk)
      if (!key) continue
      return crypto.subtle.verify(
        { name: 'RSASSA-PKCS1-v1_5' },
        key,
        signature.buffer as ArrayBuffer,
        new TextEncoder().encode(signingInput),
      )
    }
    return false
  }

  return {
    manifest: { id: providerId, provides: ['auth.identity'] },
    optionsSchema: createCloudflareAccessOptionsSchema,
    async resolveIdentity(context: AuthContext): Promise<AuthIdentity | null> {
      const issuer = resolveIssuer(options)
      const token = normalizeToken(context.token)
      if (!issuer || !token) return null

      const parts = token.split('.')
      if (parts.length !== 3 || parts.some((part) => part.length === 0)) return null

      const header = parseJwtPart<JwtHeader>(parts[0])
      const claims = parseJwtPart<JwtClaims>(parts[1])
      if (!header || !claims) return null
      if (header.alg !== 'RS256' || !header.kid) return null
      if (!validateClaims(claims, issuer, options.audience, options.leewaySeconds)) return null

      let signature: Uint8Array
      try {
        signature = decodeBase64Url(parts[2])
      } catch {
        return null
      }

      const verified = await verifyWithKeys(
        `${parts[0]}.${parts[1]}`,
        signature,
        header.kid,
        issuer,
      )
      return verified ? toIdentity(claims, options) : null
    },
  }
}

export const authIdentityPlugins: Record<string, AuthIdentityPlugin> = {
  cloudflare: createAuthIdentityPlugin(),
}
