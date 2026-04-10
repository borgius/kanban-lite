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

const CLOUDFLARE_ACTIVE_CARD_STATE_BINDING = 'KANBAN_ACTIVE_CARD_STATE'
const LIVE_SYNC_OBJECT_NAME_PREFIX = 'live-sync:'
const LIVE_SYNC_NOTIFY_PATH = '/live-sync/notify'

type WorkerLiveSyncDurableObjectStub = {
  fetch(request: Request): Promise<Response>
}

type WorkerLiveSyncDurableObjectNamespace = {
  getByName(name: string): WorkerLiveSyncDurableObjectStub
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function isAfterEventEnvelope(value: unknown): value is { event: string; data: unknown } {
  return isRecord(value)
    && typeof value.event === 'string'
    && Object.prototype.hasOwnProperty.call(value, 'data')
    && !Object.prototype.hasOwnProperty.call(value, 'input')
}

function getWorkerLiveSyncNamespace(
  env?: CloudflareWorkerRuntimeEnv,
): WorkerLiveSyncDurableObjectNamespace | null {
  const candidate = env?.[CLOUDFLARE_ACTIVE_CARD_STATE_BINDING]
  if (!candidate || typeof candidate !== 'object') {
    return null
  }

  return typeof (candidate as WorkerLiveSyncDurableObjectNamespace).getByName === 'function'
    ? candidate as WorkerLiveSyncDurableObjectNamespace
    : null
}

function getWorkerLiveSyncStub(
  namespace: WorkerLiveSyncDurableObjectNamespace,
  kanbanDir: string,
): WorkerLiveSyncDurableObjectStub {
  return namespace.getByName(`${LIVE_SYNC_OBJECT_NAME_PREFIX}${path.resolve(kanbanDir)}`)
}

async function notifyWorkerLiveSync(
  env: CloudflareWorkerRuntimeEnv | undefined,
  kanbanDir: string,
  event: string,
): Promise<void> {
  const namespace = getWorkerLiveSyncNamespace(env)
  if (!namespace) {
    return
  }

  const response = await getWorkerLiveSyncStub(namespace, kanbanDir).fetch(new Request(`https://kanban-lite.worker${LIVE_SYNC_NOTIFY_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'syncRequired', reason: event }),
  }))

  if (!response.ok) {
    throw new Error(`Cloudflare live sync notify failed with status ${response.status}`)
  }
}

function createWorkerSyncEventHandler(
  getEnv: () => CloudflareWorkerRuntimeEnv | undefined,
  kanbanDir: string,
): (event: string, data: unknown) => void {
  return (event, data) => {
    if (event.startsWith('auth.') || !isAfterEventEnvelope(data)) {
      return
    }

    void notifyWorkerLiveSync(getEnv(), kanbanDir, event).catch((error) => {
      console.error(`Failed to publish Cloudflare live sync event (${event}):`, error)
    })
  }
}

function createWorkerContext(kanbanDir: string, onEvent?: (event: string, data: unknown) => void): StandaloneContext {
  const absoluteKanbanDir = path.resolve(kanbanDir)
  const workspaceRoot = path.dirname(absoluteKanbanDir)
  const sdk = new KanbanSDK(absoluteKanbanDir, onEvent ? { onEvent } : undefined)
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

async function maybeHandleWebSocketUpgrade(
  request: Request,
  options: CloudflareWorkerFetchHandlerOptions,
  state: WorkerEntrypointState,
  env?: CloudflareWorkerRuntimeEnv,
): Promise<Response | null> {
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    return null
  }

  const url = new URL(request.url)
  const basePath = options.basePath ?? ''
  if (url.pathname !== `${basePath}/ws`) {
    return new Response('Not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  const namespace = getWorkerLiveSyncNamespace(env)
  if (!namespace) {
    return new Response('WebSocket live sync is not configured for this Cloudflare Workers entrypoint yet.', {
      status: 501,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  const { kanbanDir, workspaceRoot } = getWorkerPaths(options, env)
  const workerRuntimeHost = resolveWorkerRuntimeHostHandle(options, env, workspaceRoot, state)

  await workerRuntimeHost.refreshCommittedConfig()
  installWorkerRuntimeHost(workerRuntimeHost.runtimeHost)

  if (!state.dispatcher || workerRuntimeHost.needsDispatcherRefresh()) {
    const ctx = createWorkerContext(kanbanDir, createWorkerSyncEventHandler(() => state.runtimeEnv, kanbanDir))
    state.dispatcher = createStandaloneRouteDispatcher(ctx, options.webviewDir ?? '', getIndexHtml(basePath), basePath)
    workerRuntimeHost.markDispatcherReady()
  }

  const req = await toIncomingMessage(request)
  await workerRuntimeHost.runWithRequestScope(async () => {
    await state.dispatcher?.resolveWsAuthContext(req)
  })

  return getWorkerLiveSyncStub(namespace, kanbanDir).fetch(request)
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
    runtimeEnv: undefined,
  }

  const fetch = async (request: Request, env?: CloudflareWorkerRuntimeEnv): Promise<Response> => {
    state.runtimeEnv = env

    const webSocketUpgradeResponse = await maybeHandleWebSocketUpgrade(request, options, state, env)
    if (webSocketUpgradeResponse) {
      return webSocketUpgradeResponse
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
        const ctx = createWorkerContext(kanbanDir, createWorkerSyncEventHandler(() => state.runtimeEnv, kanbanDir))
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
    state.runtimeEnv = env
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
      const sdk = new KanbanSDK(path.resolve(kanbanDir), {
        onEvent: createWorkerSyncEventHandler(() => env, kanbanDir),
      })

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
