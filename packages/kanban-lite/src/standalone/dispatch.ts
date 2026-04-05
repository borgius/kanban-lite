import * as http from 'http'
import type { StandaloneHttpHandler, StandaloneHttpPlugin } from '../sdk'
import { extractAuthContext, getRequestAuthContext, mergeRequestAuthContext, setRequestAuthContext } from './authUtils'
import type { StandaloneContext } from './context'
import { createRouteMatcher, type StandaloneRequestContext, type StandaloneRouteHandler } from './internal/common'
import { handleCardFileRoute } from './internal/lifecycle'
import { handleBoardRoutes } from './internal/routes/boards'
import { handleMobileRoutes } from './internal/routes/mobile'
import { handleSystemRoutes } from './internal/routes/system'
import { handleTaskRoutes } from './internal/routes/tasks'
import { matchRoute, type IncomingMessageWithRawBody } from './httpUtils'

function dispatchRequest(request: StandaloneRequestContext, handlers: StandaloneRouteHandler[]): Promise<void> {
  return handlers.reduce<Promise<boolean>>(async (handledPromise, handler) => {
    if (await handledPromise) return true
    return handler(request)
  }, Promise.resolve(false)).then(() => undefined)
}

function isApiRequestPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/')
}

function isPageRequest(method: string, pathname: string): boolean {
  return (method === 'GET' || method === 'HEAD') && !isApiRequestPath(pathname)
}

function collectStandaloneHttpHandlers(
  requestType: 'middleware' | 'routes',
  ctx: StandaloneContext,
): StandaloneHttpHandler[] {
  const plugins = ctx.sdk.capabilities?.standaloneHttpPlugins ?? []
  const registrationOptions = {
    sdk: ctx.sdk,
    workspaceRoot: ctx.workspaceRoot,
    kanbanDir: ctx.absoluteKanbanDir,
    capabilities: ctx.sdk.capabilities?.providers ?? {
      'card.storage': { provider: 'localfs' },
      'attachment.storage': { provider: 'localfs' },
    },
    authCapabilities: ctx.sdk.capabilities?.authProviders ?? {
      'auth.identity': { provider: 'noop' },
      'auth.policy': { provider: 'noop' },
      'auth.visibility': { provider: 'none' },
    },
    webhookCapabilities: ctx.sdk.capabilities?.webhookProviders ?? null,
  } as const

  return plugins.flatMap((plugin: StandaloneHttpPlugin) => {
    const handlers = requestType === 'middleware'
      ? plugin.registerMiddleware?.(registrationOptions)
      : plugin.registerRoutes?.(registrationOptions)
    return handlers ? [...handlers] : []
  })
}

function normalizeRequestUrl(req: IncomingMessageWithRawBody, basePath: string): void {
  if (!basePath) return
  const rawUrl = req.url ?? '/'
  if (rawUrl === basePath) {
    req.url = '/'
    return
  }
  if (rawUrl.startsWith(basePath + '/') || rawUrl.startsWith(basePath + '?')) {
    req.url = rawUrl.slice(basePath.length)
  }
}

function createRequestContext(
  ctx: StandaloneContext,
  req: IncomingMessageWithRawBody,
  res: http.ServerResponse,
  resolvedWebviewDir: string,
  resolvedIndexHtml: string,
): StandaloneRequestContext {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
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

export interface StandaloneRouteDispatcher {
  readonly middlewareHandlers: StandaloneRouteHandler[]
  readonly routeHandlers: StandaloneRouteHandler[]
  handle(req: IncomingMessageWithRawBody, res: http.ServerResponse): Promise<void>
  resolveWsAuthContext(req: http.IncomingMessage): Promise<ReturnType<typeof extractAuthContext>>
}

export function createStandaloneRouteDispatcher(
  ctx: StandaloneContext,
  resolvedWebviewDir: string,
  resolvedIndexHtml: string,
  basePath = '',
): StandaloneRouteDispatcher {
  const middlewareHandlers = collectStandaloneHttpHandlers('middleware', ctx) as StandaloneRouteHandler[]
  const pluginRouteHandlers = collectStandaloneHttpHandlers('routes', ctx) as StandaloneRouteHandler[]
  const routeHandlers: StandaloneRouteHandler[] = [
    ...pluginRouteHandlers,
    handleMobileRoutes,
    handleBoardRoutes,
    handleTaskRoutes,
    handleCardFileRoute,
    handleSystemRoutes,
  ]

  return {
    middlewareHandlers,
    routeHandlers,
    async handle(req, res) {
      normalizeRequestUrl(req, basePath)
      const requestContext = createRequestContext(ctx, req, res, resolvedWebviewDir, resolvedIndexHtml)
      await dispatchRequest(requestContext, middlewareHandlers)
      if (!res.writableEnded) {
        await dispatchRequest(requestContext, routeHandlers)
      }
    },
    async resolveWsAuthContext(req) {
      const silentRes = (() => {
        const r: Record<string, unknown> = {
          writableEnded: false,
          writeHead() { return r },
          setHeader() { return r },
          removeHeader() { return r },
          getHeader() { return undefined },
          getHeaders() { return {} },
          end(..._args: unknown[]) { (r as { writableEnded: boolean }).writableEnded = true; return r },
          write() { return false },
        }
        return r as unknown as http.ServerResponse
      })()
      const reqWithBody = req as IncomingMessageWithRawBody
      normalizeRequestUrl(reqWithBody, basePath)
      const requestContext = createRequestContext(ctx, reqWithBody, silentRes, resolvedWebviewDir, resolvedIndexHtml)
      for (const handler of middlewareHandlers) {
        if (await handler(requestContext)) break
      }
      return extractAuthContext(req)
    },
  }
}
