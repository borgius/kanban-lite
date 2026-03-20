import * as http from 'http'
import { createRouteMatcher, type StandaloneRequestContext, type StandaloneRouteHandler } from './internal/common'
import { handleCardFileRoute, setupStandaloneLifecycle } from './internal/lifecycle'
import { createStandaloneRuntime, indexHtml } from './internal/runtime'
import { handleBoardRoutes } from './internal/routes/boards'
import { handleSystemRoutes } from './internal/routes/system'
import { handleTaskRoutes } from './internal/routes/tasks'
import { attachWebSocketHandlers } from './internal/websocket'
import { matchRoute } from './httpUtils'

async function dispatchRequest(request: StandaloneRequestContext, handlers: StandaloneRouteHandler[]): Promise<void> {
  for (const handler of handlers) {
    if (await handler(request)) return
  }
}

export function startServer(kanbanDir: string, port: number, webviewDir?: string): http.Server {
  const runtime = createStandaloneRuntime(kanbanDir, webviewDir)
  const { server, ctx, resolvedWebviewDir } = runtime

  const handlers: StandaloneRouteHandler[] = [
    handleBoardRoutes,
    handleTaskRoutes,
    handleCardFileRoute,
    handleSystemRoutes,
  ]

  server.on('request', async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`)
    const pathname = url.pathname
    const method = req.method || 'GET'

    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400'
      })
      res.end()
      return
    }

    await dispatchRequest({
      ctx,
      req,
      res,
      url,
      pathname,
      method,
      resolvedWebviewDir,
      indexHtml,
      route: createRouteMatcher(method, pathname, matchRoute),
    }, handlers)
  })

  attachWebSocketHandlers(ctx)
  setupStandaloneLifecycle(ctx, server)

  server.listen(port, () => {
    console.log(`Kanban board running at http://localhost:${port}`)
    console.log(`API available at http://localhost:${port}/api`)
    console.log(`Kanban directory: ${ctx.absoluteKanbanDir}`)
  })

  return server
}
