import { createClient } from '@openauthjs/openauth/client'
import { InvalidRefreshTokenError, InvalidAccessTokenError } from '@openauthjs/openauth/error'
import type {
  AuthContext,
  AuthIdentity,
  AuthIdentityPlugin,
  KanbanSDK,
  PluginSettingsOptionsSchemaMetadata,
} from 'kanban-lite/sdk'
import { subjects } from './openauth-subjects'

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface OpenAuthIdentityOptions {
  issuer: string
  clientId: string
  roleMapping?: {
    claim?: string
    default?: string
  }
}

export function resolveOpenAuthIdentityOptions(
  raw?: Record<string, unknown>,
): OpenAuthIdentityOptions | null {
  if (!raw || typeof raw !== 'object') return null
  const issuer = typeof raw.issuer === 'string' && raw.issuer.length > 0 ? raw.issuer : null
  const clientId = typeof raw.clientId === 'string' && raw.clientId.length > 0 ? raw.clientId : null
  if (!issuer || !clientId) return null

  const roleMappingRaw = raw.roleMapping as Record<string, unknown> | undefined
  const roleMapping = roleMappingRaw && typeof roleMappingRaw === 'object'
    ? {
        claim: typeof roleMappingRaw.claim === 'string' ? roleMappingRaw.claim : undefined,
        default: typeof roleMappingRaw.default === 'string' ? roleMappingRaw.default : 'user',
      }
    : { default: 'user' }

  return { issuer, clientId, roleMapping }
}

// ---------------------------------------------------------------------------
// Role extraction
// ---------------------------------------------------------------------------

function extractRoles(
  properties: Record<string, unknown>,
  roleMapping: OpenAuthIdentityOptions['roleMapping'],
): string[] {
  const claimKey = roleMapping?.claim ?? 'role'
  const value = properties[claimKey]
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string' && v.length > 0)
  }
  if (typeof value === 'string' && value.length > 0) return [value]
  return roleMapping?.default ? [roleMapping.default] : []
}

// ---------------------------------------------------------------------------
// Core verify using OpenAuth client.verify(subjects, token, { refresh })
// ---------------------------------------------------------------------------

export async function resolveOpenAuthIdentity(
  context: AuthContext,
  options: OpenAuthIdentityOptions,
): Promise<AuthIdentity | null> {
  const token = context.token
  if (!token || typeof token !== 'string' || token.length === 0) return null

  const refreshToken = (context as Record<string, unknown>).refreshToken as string | undefined

  try {
    const client = createClient({
      clientID: options.clientId,
      issuer: options.issuer,
    })

    // OpenAuth API: client.verify(subjects, accessToken, { refresh? })
    // - subjects is the schema created via createSubjects()
    // - Automatically decodes the JWT and validates the subject type
    // - If refresh token is provided, auto-refreshes expired access tokens
    const verified = await client.verify(subjects, token, {
      refresh: refreshToken,
    })

    if (verified.err) return null

    const props = verified.subject.properties as Record<string, unknown>
    const userID = props.userID ?? props.userId ?? props.id
    const subjectId = typeof userID === 'string' && userID.length > 0
      ? userID
      : 'openauth-user'

    const roles = extractRoles(props, options.roleMapping)
    const identity: AuthIdentity = { subject: subjectId }
    if (roles.length > 0) identity.roles = roles
    return identity
  } catch (err) {
    if (err instanceof InvalidRefreshTokenError || err instanceof InvalidAccessTokenError) {
      return null
    }
    return null
  }
}

// ---------------------------------------------------------------------------
// Options schema for plugin settings UI
// ---------------------------------------------------------------------------

export function createOpenAuthIdentityOptionsSchema(
  _sdk?: KanbanSDK,
): PluginSettingsOptionsSchemaMetadata {
  return {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        issuer: {
          type: 'string',
          title: 'OpenAuth issuer URL',
          description: 'The URL of your OpenAuth server (e.g. https://auth.example.com).',
        },
        clientId: {
          type: 'string',
          title: 'Client ID',
          description: 'OAuth client identifier for this Kanban Lite instance.',
        },
        callbackPath: {
          type: 'string',
          title: 'Callback path',
          description: 'Path that receives the OAuth callback (default: /auth/openauth/callback).',
          default: '/auth/openauth/callback',
        },
        roleMapping: {
          type: 'object',
          title: 'Role mapping',
          description: 'Configure how OpenAuth subject claims map to kanban-lite roles.',
          additionalProperties: false,
          properties: {
            claim: {
              type: 'string',
              title: 'Subject claim for roles',
              description: 'Property name in the subject containing the role (default: "role").',
              default: 'role',
            },
            default: {
              type: 'string',
              title: 'Default role',
              description: 'Fallback role assigned when the claim is missing or empty.',
              default: 'user',
            },
          },
        },
      },
      required: ['issuer', 'clientId'],
    },
    uiSchema: {
      type: 'VerticalLayout',
      elements: [
        {
          type: 'Group',
          label: 'OpenAuth server',
          elements: [
            { type: 'Control', scope: '#/properties/issuer' },
            { type: 'Control', scope: '#/properties/clientId' },
            { type: 'Control', scope: '#/properties/callbackPath' },
          ],
        },
        {
          type: 'Group',
          label: 'Role mapping',
          elements: [
            { type: 'Control', scope: '#/properties/roleMapping/properties/claim' },
            { type: 'Control', scope: '#/properties/roleMapping/properties/default' },
          ],
        },
      ],
    },
    secrets: [],
  }
}

// ---------------------------------------------------------------------------
// Plugin instances
// ---------------------------------------------------------------------------

export const OPENAUTH_IDENTITY_PLUGIN: AuthIdentityPlugin = {
  manifest: { id: 'openauth', provides: ['auth.identity'] },
  optionsSchema: createOpenAuthIdentityOptionsSchema,
  async resolveIdentity(context: AuthContext): Promise<AuthIdentity | null> {
    const options = resolveOpenAuthIdentityOptions(
      (context as Record<string, unknown>).__pluginOptions as Record<string, unknown> | undefined,
    )
    if (!options) return null
    return resolveOpenAuthIdentity(context, options)
  },
}

export function createOpenAuthIdentityPlugin(
  rawOptions?: Record<string, unknown>,
): AuthIdentityPlugin {
  const options = resolveOpenAuthIdentityOptions(rawOptions)

  return {
    manifest: { id: 'openauth', provides: ['auth.identity'] },
    optionsSchema: createOpenAuthIdentityOptionsSchema,
    async resolveIdentity(context: AuthContext): Promise<AuthIdentity | null> {
      const resolved = options ?? resolveOpenAuthIdentityOptions(
        (context as Record<string, unknown>).__pluginOptions as Record<string, unknown> | undefined,
      )
      if (!resolved) return null
      return resolveOpenAuthIdentity(context, resolved)
    },
  }
}
