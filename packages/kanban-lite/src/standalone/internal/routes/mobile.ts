import { jsonError, jsonOk, readBody } from '../../httpUtils'
import type { StandaloneRequestContext } from '../common'

const mobileAuthenticationSchema = {
  type: 'object',
  required: ['provider', 'browserLoginTransport', 'mobileSessionTransport', 'sessionKind'],
  properties: {
    provider: { type: 'string', enum: ['local'], description: 'Fixed mobile auth provider scope for v1.' },
    browserLoginTransport: { type: 'string', enum: ['cookie-session'], description: 'Browser-only login transport reused by `/auth/login`.' },
    mobileSessionTransport: { type: 'string', enum: ['opaque-bearer'], description: 'Opaque bearer transport persisted by the mobile app.' },
    sessionKind: { type: 'string', enum: ['local-mobile-session-v1'], description: 'Stable mobile session kind returned by the standalone login exchange.' },
  },
} as const

const mobileSessionStatusSchema = {
  type: 'object',
  required: ['workspaceOrigin', 'workspaceId', 'subject', 'roles', 'expiresAt', 'authentication'],
  properties: {
    workspaceOrigin: { type: 'string', description: 'Canonical workspace origin bound to the validated mobile session.' },
    workspaceId: { type: 'string', description: 'Stable workspace identifier safe for cache, draft, and restore namespace keys.' },
    subject: { type: 'string', description: 'Resolved authenticated subject.' },
    roles: { type: 'array', items: { type: 'string' }, description: 'Normalized role list safe to use for cache namespacing.' },
    expiresAt: { type: 'string', nullable: true, description: 'Optional expiry hint surfaced for UX only.' },
    authentication: mobileAuthenticationSchema,
  },
} as const

export const MOBILE_STANDALONE_API_DOCS = {
  tags: [
    {
      name: 'Mobile',
      description: 'Minimal mobile bootstrap and opaque local-session contract for the Expo field app.',
    },
  ],
  paths: {
    '/api/mobile/bootstrap': {
      post: {
        tags: ['Mobile'],
        summary: 'Resolve mobile workspace bootstrap',
        description: 'Normalizes a typed workspace origin, deep link, or QR payload into the canonical local-auth mobile bootstrap contract. When a one-time bootstrap token is present, the response keeps the client on the token-redemption branch instead of inventing a second login abstraction.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['workspaceOrigin'],
                properties: {
                  workspaceOrigin: { type: 'string', description: 'Typed workspace origin, app base URL, or canonical link origin.' },
                  bootstrapToken: { type: 'string', description: 'Optional one-time bootstrap token carried by a deep link or QR code.' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Canonical workspace bootstrap metadata.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean' },
                    data: {
                      type: 'object',
                      required: ['workspaceOrigin', 'workspaceId', 'authentication', 'bootstrapToken', 'nextStep'],
                      properties: {
                        workspaceOrigin: { type: 'string' },
                        workspaceId: { type: 'string' },
                        authentication: mobileAuthenticationSchema,
                        bootstrapToken: {
                          type: 'object',
                          properties: {
                            provided: { type: 'boolean' },
                            mode: { type: 'string', enum: ['none', 'one-time'] },
                          },
                        },
                        nextStep: { type: 'string', enum: ['local-login', 'redeem-bootstrap-token'] },
                      },
                    },
                  },
                },
              },
            },
          },
          400: { description: 'Invalid workspace origin or request payload.' },
        },
      },
    },
    '/api/mobile/session': {
      post: {
        tags: ['Mobile'],
        summary: 'Create a mobile opaque bearer session',
        description: 'Available when the local standalone auth provider is active. Exchanges local credentials or a validated one-time bootstrap token for a server-backed opaque mobile bearer session without reusing the browser cookie transport.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['workspaceOrigin'],
                properties: {
                  workspaceOrigin: { type: 'string', description: 'Workspace origin to bind to the created mobile session.' },
                  username: { type: 'string', description: 'Local username for direct mobile login.' },
                  password: { type: 'string', description: 'Local password for direct mobile login.' },
                  bootstrapToken: { type: 'string', description: 'One-time bootstrap token to redeem instead of sending credentials.' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Opaque mobile session created successfully.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        session: {
                          type: 'object',
                          required: ['kind', 'token'],
                          properties: {
                            kind: { type: 'string', enum: ['local-mobile-session-v1'] },
                            token: { type: 'string', description: 'Opaque bearer token stored by the mobile app.' },
                          },
                        },
                        status: mobileSessionStatusSchema,
                      },
                    },
                  },
                },
              },
            },
          },
          400: { description: 'Invalid payload or missing required fields.' },
          401: { description: 'Invalid credentials or bootstrap token.' },
          403: { description: 'Bootstrap token or session is not valid for the requested workspace.' },
        },
      },
      get: {
        tags: ['Mobile'],
        summary: 'Validate a stored mobile session',
        description: 'Validates a previously issued opaque mobile bearer token for cold-start and resume gating. Shared automation tokens and browser cookie sessions are not accepted here.',
        parameters: [
          {
            name: 'workspaceOrigin',
            in: 'query',
            required: true,
            schema: { type: 'string' },
            description: 'Workspace origin expected by the mobile cache namespace.',
          },
        ],
        responses: {
          200: {
            description: 'Mobile session is valid for the requested workspace.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean' },
                    data: mobileSessionStatusSchema,
                  },
                },
              },
            },
          },
          400: { description: 'Missing or invalid workspaceOrigin query parameter.' },
          401: { description: 'Opaque mobile bearer token is missing, invalid, or expired.' },
          403: { description: 'Session belongs to a different workspace namespace.' },
        },
      },
      delete: {
        tags: ['Mobile'],
        summary: 'Revoke a stored mobile session',
        description: 'Revokes the current opaque mobile bearer token for mobile logout. Shared automation tokens and browser cookie sessions are not accepted here.',
        responses: {
          200: {
            description: 'Mobile session revoked successfully.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean' },
                  },
                },
              },
            },
          },
          401: { description: 'Opaque mobile bearer token is missing, invalid, or expired.' },
        },
      },
    },
  },
} as const

export async function handleMobileRoutes(request: StandaloneRequestContext): Promise<boolean> {
  const { ctx, route, req, res } = request

  const params = route('POST', '/api/mobile/bootstrap')
  if (!params) return false

  try {
    const body = await readBody(req)
    const workspaceOrigin = typeof body.workspaceOrigin === 'string' ? body.workspaceOrigin.trim() : ''
    if (workspaceOrigin.length === 0) {
      jsonError(res, 400, 'workspaceOrigin is required')
      return true
    }

    const payload = await ctx.sdk.resolveMobileBootstrap({
      workspaceOrigin,
      bootstrapToken: typeof body.bootstrapToken === 'string' ? body.bootstrapToken : null,
    })
    jsonOk(res, payload)
  } catch (error) {
    jsonError(res, 400, error instanceof Error ? error.message : String(error))
  }
  return true
}