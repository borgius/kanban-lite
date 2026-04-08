import * as path from 'node:path'
import { Buffer } from 'node:buffer'
import {
  hasCloudflareCallbackModuleHandlers,
  KanbanSDK,
  parseCloudflareCallbackQueueMessageEnvelope,
} from '../sdk'
import { createStandaloneRouteDispatcher } from '../standalone/dispatch'
import { getIndexHtml } from '../standalone/internal/runtime'
import type { StandaloneContext } from '../standalone/context'
import type { IncomingMessageWithRawBody } from '../standalone/httpUtils'
import type {
  WorkerEntrypointState,
  NodeLikeResponse,
  CloudflareWorkerRuntimeEnv,
  CloudflareWorkerFetchHandlerOptions,
  CloudflareWorkerQueueHandlerOptions,
  CloudflareWorkerQueueBatch,
  CloudflareWorkerExecutionContext,
} from './worker-types'
export type {
  CloudflareWorkerRuntimeEnv,
  CloudflareWorkerFetchHandlerOptions,
  CloudflareWorkerQueueHandlerOptions,
  CloudflareWorkerQueueMessage,
  CloudflareWorkerQueueBatch,
  CloudflareWorkerExecutionContext,
} from './worker-types'
import {
  getWorkerPaths,
  getCallbackRuntimeProviderId,
  loadWorkerCallbackQueueConsumer,
} from './worker-utils'
import { resolveWorkerRuntimeHostHandle, installWorkerRuntimeHost } from './worker-runtime'

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
  return createCloudflareWorkerEntrypoint(options).fetch
}

export function createCloudflareWorkerQueueHandler(options: CloudflareWorkerQueueHandlerOptions = {}) {
  return createCloudflareWorkerEntrypoint(options).queue
}

function createCloudflareWorkerEntrypoint(options: CloudflareWorkerFetchHandlerOptions = {}) {
  const state: WorkerEntrypointState = {
    dispatcher: null,
    workerRuntimeHost: null,
    bootstrap: null,
    moduleRegistry: {},
  }

  const fetch = async (request: Request, env?: CloudflareWorkerRuntimeEnv): Promise<Response> => {
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

    try {
      const { kanbanDir, workspaceRoot } = getWorkerPaths(options, env)
      const workerRuntimeHost = resolveWorkerRuntimeHostHandle(options, env, workspaceRoot, state)

      await workerRuntimeHost.refreshCommittedConfig()
      installWorkerRuntimeHost(workerRuntimeHost.runtimeHost)

      if (!state.dispatcher || workerRuntimeHost.needsDispatcherRefresh()) {
        const ctx = createWorkerContext(kanbanDir)
        state.dispatcher = createStandaloneRouteDispatcher(ctx, options.webviewDir ?? '', getIndexHtml(basePath), basePath)
        workerRuntimeHost.markDispatcherReady()
      }

      const req = await toIncomingMessage(request)
      const { response, toResponse } = createNodeLikeResponse()

      await workerRuntimeHost.runWithRequestScope(async () => {
        await state.dispatcher?.handle(req, response as unknown as import('node:http').ServerResponse)
      })

      return toResponse()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (isApiRequest) {
        return new Response(JSON.stringify({ ok: false, error: message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response(message, {
        status: 500,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }
  }

  const queue = async (
    batch: CloudflareWorkerQueueBatch<unknown>,
    env?: CloudflareWorkerRuntimeEnv,
    _context?: CloudflareWorkerExecutionContext,
  ): Promise<void> => {
    const { kanbanDir, workspaceRoot } = getWorkerPaths(options, env)
    const workerRuntimeHost = resolveWorkerRuntimeHostHandle(options, env, workspaceRoot, state)

    await workerRuntimeHost.refreshCommittedConfig()
    workerRuntimeHost.assertConfigReady()
    installWorkerRuntimeHost(workerRuntimeHost.runtimeHost)

    await workerRuntimeHost.runWithRequestScope(async () => {
      if (!state.bootstrap || !hasCloudflareCallbackModuleHandlers(state.bootstrap.config as Record<string, unknown>)) {
        throw new Error('Cloudflare callback queue received work, but no callback.runtime module handlers are configured.')
      }

      const runtimeConfig = workerRuntimeHost.runtimeHost.readConfig?.(
        workspaceRoot,
        path.join(kanbanDir, '.kanban.json'),
      )
      const callbackProviderId = getCallbackRuntimeProviderId(runtimeConfig) ?? getCallbackRuntimeProviderId(state.bootstrap.config)
      if (!callbackProviderId || callbackProviderId === 'none') {
        throw new Error('Cloudflare callback queue received work, but callback.runtime is not configured.')
      }

      const workerProviderContext = workerRuntimeHost.runtimeHost.getCloudflareWorkerProviderContext?.() ?? null
      const callbackConsumer = loadWorkerCallbackQueueConsumer(
        callbackProviderId,
        workspaceRoot,
        workerProviderContext,
      )
      const sdk = new KanbanSDK(path.resolve(kanbanDir))

      try {
        callbackConsumer.attachRuntimeContext?.({
          workspaceRoot,
          sdk,
          resolveModule: workerRuntimeHost.runtimeHost.resolveExternalModule?.bind(workerRuntimeHost.runtimeHost),
        })

        for (const message of batch.messages) {
          const envelope = parseCloudflareCallbackQueueMessageEnvelope(message.body)
          if (!envelope) {
            throw new Error('Cloudflare callback queue received an invalid durable callback envelope.')
          }

          const disposition = await callbackConsumer.consumeQueuedCallbackEvent?.({ eventId: envelope.eventId })
          if (disposition === 'retry') {
            message.retry?.()
            continue
          }

          message.ack?.()
        }
      } finally {
        sdk.close()
        callbackConsumer.unregister()
      }
    })
  }

  return { fetch, queue }
}

const { fetch: workerFetch, queue: workerQueue } = createCloudflareWorkerEntrypoint()

export { workerQueue as queue }

export default {
  fetch: workerFetch,
  queue: workerQueue,
}
