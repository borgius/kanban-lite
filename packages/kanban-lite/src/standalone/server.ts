import * as http from 'http'
import * as fs from 'fs'
import * as path from 'path'
import Fastify from 'fastify'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import { configPath } from '../shared/config'
import type { StandaloneHttpHandler } from '../sdk'
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
    indexHtml,
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

  // OpenAPI spec and interactive docs (served before the catch-all so Fastify prefers these routes)
  fastify.register(swagger, { openapi: KANBAN_OPENAPI_SPEC as any })
  fastify.register(swaggerUi, {
    routePrefix: '/api/docs',
    uiConfig: { docExpansion: 'list', deepLinking: false },
    ...(swaggerUiStaticDir ? { baseDir: swaggerUiStaticDir } : {}),
    logo: swaggerUiLogo,
  })

  // Buffer all request bodies so existing handlers can read them via req._rawBody
  fastify.removeAllContentTypeParsers()
  fastify.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body as Buffer)
  })

  const runtime = createStandaloneRuntime(kanbanDir, webviewDir, fastify.server)
  const { ctx, resolvedWebviewDir } = runtime
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

    const requestContext = createRequestContext(ctx, req, reply.raw, resolvedWebviewDir)

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
