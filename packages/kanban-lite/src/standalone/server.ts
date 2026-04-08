import * as http from 'http'
import * as fs from 'fs'
import * as path from 'path'
import Fastify from 'fastify'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import { configPath, readConfig } from '../shared/config'
import type { StandaloneHttpPlugin } from '../sdk'
import { KANBAN_OPENAPI_SPEC } from './internal/openapi-spec'
import { setupStandaloneLifecycle } from './internal/lifecycle'
import { createStandaloneRuntime, getIndexHtml } from './internal/runtime'
import { MOBILE_STANDALONE_API_DOCS } from './internal/routes/mobile'
import { attachWebSocketHandlers } from './internal/websocket'
import type { IncomingMessageWithRawBody } from './httpUtils'
import { createStandaloneRouteDispatcher } from './dispatch'

type OpenApiTag = { name: string; description?: string }
type OpenApiOperation = Record<string, unknown>
type OpenApiPaths = Record<string, Record<string, OpenApiOperation>>
type OpenApiDocFragment = { tags?: ReadonlyArray<OpenApiTag>; paths: OpenApiPaths }
type OpenApiSpecWithPaths = Omit<typeof KANBAN_OPENAPI_SPEC, 'tags' | 'paths'> & {
  tags?: OpenApiTag[]
  paths: OpenApiPaths
}

const WEBHOOK_STANDALONE_PLUGIN_ID = 'webhooks'
const BUILTIN_STANDALONE_API_DOCS = [MOBILE_STANDALONE_API_DOCS] as const

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

function mergeStandaloneOpenApiDocs(
  baseSpec: OpenApiSpecWithPaths,
  fragments: ReadonlyArray<OpenApiDocFragment>,
): OpenApiSpecWithPaths {
  const mergedTags: OpenApiTag[] = [...(baseSpec.tags ?? [])]
  const seenTagNames = new Set(mergedTags.map((tag) => tag.name))

  for (const fragment of fragments) {
    for (const tag of fragment.tags ?? []) {
      if (!seenTagNames.has(tag.name)) {
        mergedTags.push(tag)
        seenTagNames.add(tag.name)
      }
    }
  }

  return {
    ...baseSpec,
    tags: mergedTags,
    paths: {
      ...baseSpec.paths,
      ...Object.assign({}, ...fragments.map((fragment) => fragment.paths)),
    },
  }
}

function buildStandaloneOpenApiSpec(plugins: readonly StandaloneHttpPlugin[]): OpenApiSpecWithPaths {
  const baseSpec = KANBAN_OPENAPI_SPEC as OpenApiSpecWithPaths
  const fragments: OpenApiDocFragment[] = [...BUILTIN_STANDALONE_API_DOCS]

  if (plugins.some((plugin) => plugin.manifest.id === WEBHOOK_STANDALONE_PLUGIN_ID)) {
    fragments.push(WEBHOOK_STANDALONE_API_DOCS)
  }

  return mergeStandaloneOpenApiDocs(baseSpec, fragments)
}

function resolveSwaggerUiStaticDir(): string | undefined {
  // Try require.resolve first — works correctly with pnpm's virtual store and any package manager.
  try {
    const pkgJson = require.resolve('@fastify/swagger-ui/package.json')
    const candidate = path.join(path.dirname(pkgJson), 'static')
    if (fs.existsSync(path.join(candidate, 'swagger-ui.css'))) return candidate
  } catch { /* package not resolvable from this context */ }

  const candidates = [
    path.join(process.cwd(), 'node_modules', '@fastify', 'swagger-ui', 'static'),
    path.join(__dirname, '..', '..', 'node_modules', '@fastify', 'swagger-ui', 'static'),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'swagger-ui.css'))) return candidate
  }

  return undefined
}

export function startServer(kanbanDir: string, port: number, webviewDir?: string, resolvedConfigPath?: string): http.Server {
  const workspaceRoot = path.dirname(path.resolve(kanbanDir))
  const config = readConfig(workspaceRoot)
  const fastify = Fastify({ logger: config.logLevel ? { level: config.logLevel } : false, forceCloseConnections: true })
  const swaggerUiStaticDir = resolveSwaggerUiStaticDir()
  const swaggerUiLogoPath = swaggerUiStaticDir ? path.join(swaggerUiStaticDir, 'logo.svg') : undefined
  const swaggerUiLogo = swaggerUiLogoPath && fs.existsSync(swaggerUiLogoPath)
    ? { type: 'image/svg+xml', content: fs.readFileSync(swaggerUiLogoPath) }
    : undefined

  const rawBase = config.basePath ?? ''
  const basePath = rawBase ? (rawBase.startsWith('/') ? rawBase : '/' + rawBase).replace(/\/+$/, '') : ''

  const runtime = createStandaloneRuntime(kanbanDir, webviewDir, fastify.server, basePath)
  const { ctx, resolvedWebviewDir } = runtime

  let resolvedIndexHtml = getIndexHtml(basePath)
  let customHead = config.customHeadHtml || ''
  if (config.customHeadHtmlFile) {
    try {
      const filePath = path.resolve(ctx.workspaceRoot, config.customHeadHtmlFile)
      customHead = fs.readFileSync(filePath, 'utf-8')
    } catch { /* file not found, fall back to customHeadHtml */ }
  }
  if (customHead) {
    resolvedIndexHtml = resolvedIndexHtml.replace('</head>', `${customHead}\n</head>`)
  }
  const standaloneHttpPlugins = ctx.sdk.capabilities?.standaloneHttpPlugins ?? []
  const standaloneOpenApiSpec = buildStandaloneOpenApiSpec(standaloneHttpPlugins)

  // OpenAPI spec and interactive docs (served before the catch-all so Fastify prefers these routes)
  fastify.register(swagger, { openapi: standaloneOpenApiSpec as unknown as Record<string, unknown> })
  fastify.register(swaggerUi, {
    routePrefix: `${basePath}/api/docs`,
    uiConfig: { docExpansion: 'list', deepLinking: false },
    ...(swaggerUiLogo ? { logo: swaggerUiLogo } : {}),
    ...(swaggerUiStaticDir ? { baseDir: swaggerUiStaticDir } : {}),
  })

  // Buffer all request bodies so existing handlers can read them via req._rawBody
  fastify.removeAllContentTypeParsers()
  fastify.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body as Buffer)
  })

  const dispatcher = createStandaloneRouteDispatcher(ctx, resolvedWebviewDir, resolvedIndexHtml, basePath)

  // Set CORS headers on every response
  fastify.addHook('onRequest', async (_request, reply) => {
    reply.header('Access-Control-Allow-Origin', '*')
    reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    if (_request.method === 'OPTIONS') {
      reply.header('Access-Control-Max-Age', '86400')
      await reply.code(204).send()
    }
  })

  // Catch-all: delegate to existing domain route handlers via raw req/res
  fastify.all('/*', async (request, reply) => {
    // Inject pre-buffered body so existing readBody() works without re-reading the stream
    const req = request.raw as IncomingMessageWithRawBody
    if (request.body instanceof Buffer && request.body.length > 0) {
      req._rawBody = request.body
    }

    // Strip base path prefix so internal route handlers see root-relative paths
    if (basePath) {
      const rawUrl = req.url ?? '/'
      if (rawUrl === basePath) {
        req.url = '/'
      } else if (rawUrl.startsWith(basePath + '/') || rawUrl.startsWith(basePath + '?')) {
        req.url = rawUrl.slice(basePath.length)
      }
    }

    await dispatcher.handle(req, reply.raw)
    if (!reply.sent && !reply.raw.writableEnded) {
      reply.hijack()
      return
    }

    // Handlers write directly to res; tell Fastify not to touch the response
    reply.hijack()
  })

  attachWebSocketHandlers(ctx, dispatcher.resolveWsAuthContext)
  setupStandaloneLifecycle(ctx, fastify.server)

  const effectiveConfigPath = resolvedConfigPath ?? configPath(path.dirname(ctx.absoluteKanbanDir))

  fastify.listen({ port, host: '0.0.0.0' }, (err) => {
    if (err) {
      console.error('Failed to start server:', err)
      process.exit(1)
    }
    console.log(`Kanban board running at http://localhost:${port}${basePath}`)
    console.log(`API available at http://localhost:${port}/api`)
    console.log(`Kanban config: ${effectiveConfigPath}`)
    console.log(`Kanban directory: ${ctx.absoluteKanbanDir}`)
  })

  return fastify.server
}
