import type {
  StandaloneHttpPlugin,
  StandaloneHttpPluginRegistrationOptions,
  StandaloneOpenApiDocFragment,
} from '../../../sdk/plugins'
import { KANBAN_OPENAPI_SPEC } from './spec'
import { mergeStandaloneOpenApiDocs, type OpenApiSpecWithPaths } from './normalize'

const WEBHOOK_STANDALONE_PLUGIN_ID = 'webhooks'

const WEBHOOK_STANDALONE_API_DOCS = {
  tags: [
    {
      name: 'Webhooks',
      description: 'Webhook registration endpoints. These routes are registered by the active standalone webhook plugin while preserving the public `/api/webhooks` contract.',
    },
  ],
  paths: {
    '/api/webhooks': {
      get: {
        tags: ['Webhooks'],
        summary: 'List webhooks',
        description: 'Returns all registered webhooks. Runtime ownership stays on the active standalone webhook plugin, which preserves this public path.',
        responses: { 200: { description: 'Webhook list.' }, 401: { description: 'Authentication required.' }, 403: { description: 'Forbidden.' } },
      },
      post: {
        tags: ['Webhooks'],
        summary: 'Create webhook',
        description: 'Registers a new webhook endpoint through the active standalone webhook plugin.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['url', 'events'],
                properties: {
                  url: { type: 'string', description: 'Target HTTP(S) URL.' },
                  events: { type: 'array', items: { type: 'string' }, description: 'Subscribed event names, or `["*"]` for all events.' },
                  secret: { type: 'string', description: 'Optional HMAC signing secret.' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Webhook created.' },
          400: { description: 'Validation error.' },
          401: { description: 'Authentication required.' },
          403: { description: 'Forbidden.' },
        },
      },
    },
    '/api/webhooks/{id}': {
      put: {
        tags: ['Webhooks'],
        summary: 'Update webhook',
        description: 'Updates an existing webhook by id through the active standalone webhook plugin.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Webhook identifier.',
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  url: { type: 'string', description: 'Updated HTTP(S) URL.' },
                  events: { type: 'array', items: { type: 'string' }, description: 'Updated event filter list.' },
                  secret: { type: 'string', description: 'Updated HMAC signing secret.' },
                  active: { type: 'boolean', description: 'Whether the webhook is active.' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Webhook updated.' },
          401: { description: 'Authentication required.' },
          403: { description: 'Forbidden.' },
          404: { description: 'Webhook not found.' },
        },
      },
      delete: {
        tags: ['Webhooks'],
        summary: 'Delete webhook',
        description: 'Deletes a webhook by id through the active standalone webhook plugin.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Webhook identifier.',
          },
        ],
        responses: {
          200: { description: 'Webhook deleted.' },
          401: { description: 'Authentication required.' },
          403: { description: 'Forbidden.' },
          404: { description: 'Webhook not found.' },
        },
      },
    },
  },
} as const

export function collectStandalonePluginOpenApiDocs(
  plugins: readonly StandaloneHttpPlugin[],
  options: StandaloneHttpPluginRegistrationOptions,
): StandaloneOpenApiDocFragment[] {
  const fragments = plugins.flatMap((plugin) => plugin.getOpenApiDocs?.(options) ?? [])

  if (
    plugins.some((plugin) => plugin.manifest.id === WEBHOOK_STANDALONE_PLUGIN_ID)
    && !fragments.some((fragment) => fragment.paths['/api/webhooks'] || fragment.paths['/api/webhooks/{id}'])
  ) {
    fragments.push(WEBHOOK_STANDALONE_API_DOCS)
  }

  return fragments
}

export function buildStandaloneOpenApiSpec(
  fragments: ReadonlyArray<StandaloneOpenApiDocFragment> = [],
): OpenApiSpecWithPaths {
  return mergeStandaloneOpenApiDocs(
    KANBAN_OPENAPI_SPEC as OpenApiSpecWithPaths,
    fragments,
  )
}
