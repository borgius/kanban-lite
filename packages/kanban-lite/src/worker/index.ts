import * as path from 'node:path'
import { Buffer } from 'node:buffer'
import { KanbanSDK, installRuntimeHost, getRuntimeHost } from '../sdk'
import type { RuntimeHost } from '../sdk'
import { createStandaloneRouteDispatcher } from '../standalone/dispatch'
import { getIndexHtml } from '../standalone/internal/runtime'
import type { StandaloneContext } from '../standalone/context'
import type { IncomingMessageWithRawBody } from '../standalone/httpUtils'

type WorkerConfigInput = Record<string, unknown>
type WorkerModuleRegistry = Record<string, unknown>

export interface CloudflareWorkerRuntimeEnv {
  KANBAN_DIR?: string
  KANBAN_CONFIG?: string | WorkerConfigInput
  KANBAN_MODULES?: WorkerModuleRegistry
  ASSETS?: { fetch(request: Request): Promise<Response> }
}

export interface CloudflareWorkerFetchHandlerOptions {
  kanbanDir?: string
  config?: WorkerConfigInput
  moduleRegistry?: WorkerModuleRegistry
  runtimeHost?: RuntimeHost
  basePath?: string
  webviewDir?: string
}

type NodeLikeResponse = {
  statusCode: number
  writableEnded: boolean
  writeHead: (statusCode: number, headers?: Record<string, string>) => NodeLikeResponse
  setHeader: (name: string, value: string) => NodeLikeResponse
  removeHeader: (name: string) => NodeLikeResponse
  getHeader: (name: string) => string | undefined
  getHeaders: () => Record<string, string>
  write: (chunk: string | Uint8Array) => boolean
  end: (chunk?: string | Uint8Array) => NodeLikeResponse
}

function parseWorkerConfig(rawConfig: CloudflareWorkerRuntimeEnv['KANBAN_CONFIG'] | WorkerConfigInput | undefined): WorkerConfigInput | undefined {
  if (!rawConfig) return undefined
  if (typeof rawConfig === 'string') {
    return JSON.parse(rawConfig) as WorkerConfigInput
  }
  return rawConfig
}

function createWorkerRuntimeHost(config: WorkerConfigInput | undefined, moduleRegistry: WorkerModuleRegistry, upstreamHost?: RuntimeHost): RuntimeHost {
  return {
    readConfig(workspaceRoot, filePath) {
      return config ?? upstreamHost?.readConfig?.(workspaceRoot, filePath)
    },
    writeConfig(workspaceRoot, filePath, nextConfig) {
      if (upstreamHost?.writeConfig?.(workspaceRoot, filePath, nextConfig)) return true
      throw new Error('Cloudflare Workers runtime does not support writing .kanban.json without a custom runtimeHost.writeConfig override.')
    },
    loadWorkspaceEnv(workspaceRoot) {
      return upstreamHost?.loadWorkspaceEnv?.(workspaceRoot) ?? true
    },
    resolveExternalModule(request) {
      if (Object.prototype.hasOwnProperty.call(moduleRegistry, request)) {
        return moduleRegistry[request]
      }
      return upstreamHost?.resolveExternalModule?.(request)
    },
  }
}

function createWorkerContext(kanbanDir: string): StandaloneContext {
  const absoluteKanbanDir = path.resolve(kanbanDir)
  const workspaceRoot = path.dirname(absoluteKanbanDir)
  const sdk = new KanbanSDK(absoluteKanbanDir)
    return {
      absoluteKanbanDir,
      workspaceRoot,
      sdk,
      wss: { clients: new Set() } as StandaloneContext['wss'],
    cards: [],
    migrating: false,
    suppressWatcherEventsUntil: 0,
    currentEditingCardId: null,
    clientEditingCardIds: new Map(),
    clientAuthContexts: new Map(),
    lastWrittenContent: '',
    currentBoardId: undefined,
    tempFilePath: undefined,
    tempFileCardId: undefined,
    tempFileAuthContext: undefined,
    tempFileWatcher: undefined,
    tempFileWriting: false,
  }
}

function createNodeLikeResponse(): { response: NodeLikeResponse; toResponse: () => Response } {
  const headers = new Headers()
  const chunks: Uint8Array[] = []
  const response: NodeLikeResponse = {
    statusCode: 200,
    writableEnded: false,
    writeHead(statusCode, nextHeaders) {
      response.statusCode = statusCode
      for (const [name, value] of Object.entries(nextHeaders ?? {})) {
        headers.set(name, value)
      }
      return response
    },
    setHeader(name, value) {
      headers.set(name, value)
      return response
    },
    removeHeader(name) {
      headers.delete(name)
      return response
    },
    getHeader(name) {
      return headers.get(name) ?? undefined
    },
    getHeaders() {
      return Object.fromEntries(headers.entries())
    },
    write(chunk) {
      const data = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : new Uint8Array(chunk)
      chunks.push(data)
      return true
    },
    end(chunk) {
      if (chunk !== undefined) {
        response.write(chunk)
      }
      response.writableEnded = true
      return response
    },
  }
  return {
    response,
    toResponse() {
      const size = chunks.reduce((total, chunk) => total + chunk.length, 0)
      const body = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) {
        body.set(chunk, offset)
        offset += chunk.length
      }
      return new Response(body, { status: response.statusCode, headers })
    },
  }
}

async function toIncomingMessage(request: Request): Promise<IncomingMessageWithRawBody> {
  const body = request.method === 'GET' || request.method === 'HEAD'
    ? undefined
    : Buffer.from(await request.arrayBuffer())
  return {
    method: request.method,
    url: request.url,
    headers: Object.fromEntries([...request.headers.entries()].map(([key, value]) => [key.toLowerCase(), value])),
    _rawBody: body,
  } as IncomingMessageWithRawBody
}

export function createCloudflareWorkerFetchHandler(options: CloudflareWorkerFetchHandlerOptions = {}) {
  let dispatcher: ReturnType<typeof createStandaloneRouteDispatcher> | null = null

  return async function fetch(request: Request, env?: CloudflareWorkerRuntimeEnv): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
      return new Response('WebSocket upgrades are not supported by this Cloudflare Workers entrypoint yet.', {
        status: 501,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }

    const url = new URL(request.url)
    const basePath = options.basePath ?? ''
    const isApiRequest = url.pathname === '/api' || url.pathname.startsWith('/api/')
    if (!isApiRequest && /\.[^./]+$/.test(url.pathname) && env?.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request)
      if (assetResponse.status !== 404) return assetResponse
    }

    const config = options.config ?? parseWorkerConfig(env?.KANBAN_CONFIG)
    const moduleRegistry = options.moduleRegistry ?? env?.KANBAN_MODULES ?? {}
    const upstreamHost = options.runtimeHost ?? getRuntimeHost() ?? undefined
    installRuntimeHost(createWorkerRuntimeHost(config, moduleRegistry, upstreamHost))

    if (!dispatcher) {
      const kanbanDir = options.kanbanDir ?? env?.KANBAN_DIR ?? '.kanban'
      const ctx = createWorkerContext(kanbanDir)
      dispatcher = createStandaloneRouteDispatcher(ctx, options.webviewDir ?? '', getIndexHtml(basePath), basePath)
    }

    const req = await toIncomingMessage(request)
    const { response, toResponse } = createNodeLikeResponse()
    await dispatcher.handle(req, response as unknown as import('node:http').ServerResponse)
    return toResponse()
  }
}

const workerFetch = createCloudflareWorkerFetchHandler()

export default {
  fetch: workerFetch,
}
