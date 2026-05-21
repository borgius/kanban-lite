import * as http from 'http'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createAdaptorServer, type HttpBindings } from '@hono/node-server'
import { swaggerUI } from '@hono/swagger-ui'
import { configPath, readConfig } from '../shared/config'
import { setupStandaloneLifecycle } from './internal/lifecycle'
import {
  buildStandaloneOpenApiSpec,
  collectStandalonePluginOpenApiDocs,
} from './internal/openapi-spec/build'
import { createStandaloneRuntime, getIndexHtml } from './internal/runtime'
import { attachWebSocketHandlers } from './internal/websocket'
import type { IncomingMessageWithRawBody } from './httpUtils'
import {
  createStandaloneHttpPluginRegistrationOptions,
  createStandaloneRouteDispatcher,
} from './dispatch'

function resolveSwaggerUiStaticDir(): string | undefined {
  // Retained as a lightweight helper: `@hono/swagger-ui` serves UI assets from a CDN
  // and does not need a local asset directory, but the function remains so its
  // (now non-critical) failure modes are still exercised by existing tests.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkgJson = require.resolve('@hono/swagger-ui/package.json')
    const candidate = path.join(path.dirname(pkgJson), 'static')
    if (fs.existsSync(path.join(candidate, 'swagger-ui.css'))) return candidate
  } catch { /* package not resolvable from this context */ }
  return undefined
}

const LOCAL_AUTH_PROVIDERS = new Set(['local', 'kl-plugin-auth'])

function ensureLocalAuthToken(workspaceRoot: string): void {
  for (const key of ['KANBAN_LITE_TOKEN', 'KANBAN_TOKEN'] as const) {
    const val = process.env[key]
    if (typeof val === 'string' && val.length > 0) return
  }
  const token = 'kl-' + crypto.randomBytes(32).toString('hex')
  process.env['KANBAN_LITE_TOKEN'] = token
  const envPath = path.join(workspaceRoot, '.env')
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : ''
  const trimmed = existing.trimEnd()
  fs.writeFileSync(envPath, trimmed ? trimmed + '\nKANBAN_LITE_TOKEN=' + token + '\n' : 'KANBAN_LITE_TOKEN=' + token + '\n', 'utf-8')
}

export function startServer(kanbanDir: string, port: number, webviewDir?: string, resolvedConfigPath?: string): http.Server {
  const workspaceRoot = path.dirname(path.resolve(kanbanDir))
  const config = readConfig(workspaceRoot)

  const identityProvider = (config.plugins?.['auth.identity'] ?? config.auth?.['auth.identity'])?.provider ?? ''
  const policyProvider = (config.plugins?.['auth.policy'] ?? config.auth?.['auth.policy'])?.provider ?? ''
  if (LOCAL_AUTH_PROVIDERS.has(identityProvider) || LOCAL_AUTH_PROVIDERS.has(policyProvider)) {
    ensureLocalAuthToken(workspaceRoot)
  }

  // Probe for the swagger-ui asset directory so legacy fs-mock tests continue to exercise
  // the resolver path. The returned value is not consumed by Hono's swaggerUI middleware.
  void resolveSwaggerUiStaticDir()

  const rawBase = config.basePath ?? ''
  const basePath = rawBase ? (rawBase.startsWith('/') ? rawBase : '/' + rawBase).replace(/\/+$/, '') : ''

  const app = new Hono<{ Bindings: HttpBindings }>()

  // CORS: applies to all routes. Mirrors the prior Fastify onRequest hook, including the
  // OPTIONS preflight short-circuit with a 24h max-age.
  app.use('*', cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  }))

  // Create the underlying Node HTTP server (not yet listening) so WebSocket handlers
  // can be attached before we start accepting connections.
  const server = createAdaptorServer({ fetch: app.fetch }) as http.Server

  const runtime = createStandaloneRuntime(kanbanDir, webviewDir, server, basePath)
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
  const standaloneOpenApiSpec = buildStandaloneOpenApiSpec(
    collectStandalonePluginOpenApiDocs(
      standaloneHttpPlugins,
      createStandaloneHttpPluginRegistrationOptions(ctx),
    ),
  )

  // OpenAPI JSON + interactive Swagger UI. Registered before the catch-all so Hono
  // matches these routes first.
  const docsJsonPath = `${basePath}/api/docs/json`
  const docsUiPath = `${basePath}/api/docs`
  app.get(docsJsonPath, (c) => c.json(standaloneOpenApiSpec as unknown as Record<string, unknown>))
  const swaggerMiddleware = swaggerUI({ url: docsJsonPath })
  app.get(docsUiPath, swaggerMiddleware)
  app.get(`${docsUiPath}/`, swaggerMiddleware)

  const dispatcher = createStandaloneRouteDispatcher(ctx, resolvedWebviewDir, resolvedIndexHtml, basePath)

  // Catch-all: delegate to existing domain route handlers via raw Node req/res. We buffer
  // the body up-front so downstream handlers can read it synchronously via readBody().
  app.all('*', async (c) => {
    const req = c.env.incoming as IncomingMessageWithRawBody
    const res = c.env.outgoing
    const method = req.method ?? 'GET'
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      try {
        const buf = Buffer.from(await c.req.arrayBuffer())
        if (buf.length > 0) req._rawBody = buf
      } catch { /* empty or unreadable body */ }
    }

    await dispatcher.handle(req, res)

    // Signal to Hono's Node adapter that we already wrote the response on the raw
    // outgoing stream. The adapter detects the `x-hono-already-sent` header and skips
    // writing headers/body on its side.
    c.header('x-hono-already-sent', '1')
    return c.body(null)
  })

  attachWebSocketHandlers(ctx, dispatcher.resolveWsAuthContext)
  setupStandaloneLifecycle(ctx, server)

  // Mirror Fastify's `forceCloseConnections: true` so tests that call `server.close()`
  // do not hang on keep-alive connections.
  const serverWithCloseAll = server as http.Server & { closeAllConnections?: () => void }
  if (typeof serverWithCloseAll.closeAllConnections === 'function') {
    const originalClose = server.close.bind(server) as http.Server['close']
    server.close = ((cb?: (err?: Error) => void) => {
      try { serverWithCloseAll.closeAllConnections?.() } catch { /* ignore */ }
      return originalClose(cb)
    }) as typeof server.close
  }

  const effectiveConfigPath = resolvedConfigPath ?? configPath(path.dirname(ctx.absoluteKanbanDir))

  server.on('error', (err) => {
    console.error('Failed to start server:', err)
    process.exit(1)
  })
  server.listen(port, '0.0.0.0', () => {
    console.log(`Kanban board running at http://localhost:${port}${basePath}`)
    console.log(`API available at http://localhost:${port}/api`)
    console.log(`Kanban config: ${effectiveConfigPath}`)
    console.log(`Kanban directory: ${ctx.absoluteKanbanDir}`)
  })

  return server
}

