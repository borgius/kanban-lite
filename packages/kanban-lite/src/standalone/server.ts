import * as http from 'http'
import * as fs from 'fs'
import * as path from 'path'
import Fastify from 'fastify'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import { configPath, readConfig } from '../shared/config'
import type { StandaloneHttpHandler, StandaloneHttpPlugin } from '../sdk'
import { createRouteMatcher, type StandaloneRequestContext, type StandaloneRouteHandler } from './internal/common'
import { KANBAN_OPENAPI_SPEC } from './internal/openapi-spec'
import { handleCardFileRoute, setupStandaloneLifecycle } from './internal/lifecycle'
import { createStandaloneRuntime, indexHtml } from './internal/runtime'
import { handleBoardRoutes } from './internal/routes/boards'
import { handleSystemRoutes } from './internal/routes/system'
import { handleTaskRoutes } from './internal/routes/tasks'
import { getRequestAuthContext, mergeRequestAuthContext, setRequestAuthContext } from './authUtils'
import { attachWebSocketHandlers } from './internal/websocket'
import { matchRoute, type IncomingMessageWithRawBody } from './httpUtils'

type OpenApiTag = { name: string; description?: string }
type OpenApiOperation = Record<string, unknown>
type OpenApiPaths = Record<string, Record<string, OpenApiOperation>>
type OpenApiSpecWithPaths = typeof KANBAN_OPENAPI_SPEC & {
  tags?: OpenApiTag[]
  paths: OpenApiPaths
}

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

function buildStandaloneOpenApiSpec(plugins: readonly StandaloneHttpPlugin[]): OpenApiSpecWithPaths {
  if (!plugins.some((plugin) => plugin.manifest.id === WEBHOOK_STANDALONE_PLUGIN_ID)) {
    return KANBAN_OPENAPI_SPEC as OpenApiSpecWithPaths
  }

  const baseSpec = KANBAN_OPENAPI_SPEC as OpenApiSpecWithPaths
  const mergedTags = [...(baseSpec.tags ?? [])]
  const seenTagNames = new Set(mergedTags.map((tag) => tag.name))
  for (const tag of WEBHOOK_STANDALONE_API_DOCS.tags) {
    if (!seenTagNames.has(tag.name)) {
      mergedTags.push(tag)
      seenTagNames.add(tag.name)
    }
  }

  return {
    ...baseSpec,
    tags: mergedTags,
    paths: {
      ...baseSpec.paths,
      ...WEBHOOK_STANDALONE_API_DOCS.paths,
    },
  }
}

async function dispatchRequest(request: StandaloneRequestContext, handlers: StandaloneRouteHandler[]): Promise<void> {
  for (const handler of handlers) {
    if (await handler(request)) return
  }
}

function isApiRequestPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/')
}

function isPageRequest(method: string, pathname: string): boolean {
  return (method === 'GET' || method === 'HEAD') && !isApiRequestPath(pathname)
}

function collectStandaloneHttpHandlers(
  requestType: 'middleware' | 'routes',
  ctx: ReturnType<typeof createStandaloneRuntime>['ctx'],
): StandaloneHttpHandler[] {
  const plugins = ctx.sdk.capabilities?.standaloneHttpPlugins ?? []
  const registrationOptions = {
    workspaceRoot: ctx.workspaceRoot,
    kanbanDir: ctx.absoluteKanbanDir,
    capabilities: ctx.sdk.capabilities?.providers ?? {
      'card.storage': { provider: 'markdown' },
      'attachment.storage': { provider: 'localfs' },
    },
    authCapabilities: ctx.sdk.capabilities?.authProviders ?? {
      'auth.identity': { provider: 'noop' },
      'auth.policy': { provider: 'noop' },
    },
    webhookCapabilities: ctx.sdk.capabilities?.webhookProviders ?? null,
  } as const

  return plugins.flatMap((plugin) => {
    const handlers = requestType === 'middleware'
      ? plugin.registerMiddleware?.(registrationOptions)
      : plugin.registerRoutes?.(registrationOptions)
    return handlers ? [...handlers] : []
  })
}

function createRequestContext(
  ctx: ReturnType<typeof createStandaloneRuntime>['ctx'],
  req: IncomingMessageWithRawBody,
  res: http.ServerResponse,
  resolvedWebviewDir: string,
  resolvedIndexHtml: string,
): StandaloneRequestContext {
  const url = new URL(req.url || '/', `http://${req.headers.host}`)
  const pathname = url.pathname
  const method = req.method || 'GET'
  return {
    ctx,
    sdk: ctx.sdk,
    workspaceRoot: ctx.workspaceRoot,
    kanbanDir: ctx.absoluteKanbanDir,
    req,
    res,
    url,
    pathname,
    method,
    resolvedWebviewDir,
    indexHtml: resolvedIndexHtml,
    route: createRouteMatcher(method, pathname, matchRoute),
    isApiRequest: isApiRequestPath(pathname),
    isPageRequest: isPageRequest(method, pathname),
    getAuthContext: () => getRequestAuthContext(req),
    setAuthContext: (auth) => setRequestAuthContext(req, auth),
    mergeAuthContext: (auth) => mergeRequestAuthContext(req, auth),
  }
}

function resolveSwaggerUiStaticDir(): string | undefined {
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
  const fastify = Fastify({ logger: false, forceCloseConnections: true })
  const swaggerUiStaticDir = resolveSwaggerUiStaticDir()
  const swaggerUiLogoPath = swaggerUiStaticDir ? path.join(swaggerUiStaticDir, 'logo.svg') : undefined
  const swaggerUiLogo = swaggerUiLogoPath && fs.existsSync(swaggerUiLogoPath)
    ? { type: 'image/svg+xml', content: fs.readFileSync(swaggerUiLogoPath) }
    : null

  const runtime = createStandaloneRuntime(kanbanDir, webviewDir, fastify.server)
  const { ctx, resolvedWebviewDir } = runtime

  const config = readConfig(ctx.workspaceRoot)
  let resolvedIndexHtml = indexHtml
  let customHead = config.customHeadHtml || ''
  if (config.customHeadHtmlFile) {
    try {
      const filePath = path.resolve(ctx.workspaceRoot, config.customHeadHtmlFile)
      customHead = fs.readFileSync(filePath, 'utf-8')
    } catch { /* file not found, fall back to customHeadHtml */ }
  }
  if (customHead) {
    resolvedIndexHtml = indexHtml.replace('</head>', `${customHead}\n</head>`)
  }
  const standaloneHttpPlugins = ctx.sdk.capabilities?.standaloneHttpPlugins ?? []
  const standaloneOpenApiSpec = buildStandaloneOpenApiSpec(standaloneHttpPlugins)

  // OpenAPI spec and interactive docs (served before the catch-all so Fastify prefers these routes)
  fastify.register(swagger, { openapi: standaloneOpenApiSpec as any })
  fastify.register(swaggerUi, {
    routePrefix: '/api/docs',
    uiConfig: { docExpansion: 'list', deepLinking: false },
    logo: swaggerUiLogo,
    ...(swaggerUiStaticDir ? { baseDir: swaggerUiStaticDir } : {}),
  })

  // Buffer all request bodies so existing handlers can read them via req._rawBody
  fastify.removeAllContentTypeParsers()
  fastify.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body as Buffer)
  })

  const middlewareHandlers = collectStandaloneHttpHandlers('middleware', ctx) as StandaloneRouteHandler[]
  const pluginRouteHandlers = collectStandaloneHttpHandlers('routes', ctx) as StandaloneRouteHandler[]

  const handlers: StandaloneRouteHandler[] = [
    ...pluginRouteHandlers,
    handleBoardRoutes,
    handleTaskRoutes,
    handleCardFileRoute,
    handleSystemRoutes,
  ]

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

    const requestContext = createRequestContext(ctx, req, reply.raw, resolvedWebviewDir, resolvedIndexHtml)

    await dispatchRequest(requestContext, middlewareHandlers)
    if (!reply.sent && !reply.raw.writableEnded) {
      await dispatchRequest(requestContext, handlers)
    }

    // Handlers write directly to res; tell Fastify not to touch the response
    reply.hijack()
  })

  attachWebSocketHandlers(ctx)
  setupStandaloneLifecycle(ctx, fastify.server)

  const effectiveConfigPath = resolvedConfigPath ?? configPath(path.dirname(ctx.absoluteKanbanDir))

  fastify.listen({ port, host: '0.0.0.0' }, (err) => {
    if (err) {
      console.error('Failed to start server:', err)
      process.exit(1)
    }
    console.log(`Kanban board running at http://localhost:${port}`)
    console.log(`API available at http://localhost:${port}/api`)
    console.log(`Kanban config: ${effectiveConfigPath}`)
    console.log(`Kanban directory: ${ctx.absoluteKanbanDir}`)
  })

  return fastify.server
}
