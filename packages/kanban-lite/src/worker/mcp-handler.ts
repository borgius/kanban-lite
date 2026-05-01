import * as path from 'node:path'

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'

import { KanbanSDK } from '../sdk/KanbanSDK'
import type { AuthContext } from '../sdk/types'
import { createMcpServerInstance } from '../mcp-server/mcp-main'
import { withConfigReadCache } from '../shared/config'
import type { CloudflareWorkerRuntimeEnv } from './worker-types'
import { getWorkerPaths } from './worker-utils'
import type { CloudflareWorkerFetchHandlerOptions } from './worker-types'
import { resolveWorkerRuntimeHostHandle, installWorkerRuntimeHost } from './worker-runtime'
import type { WorkerEntrypointState } from './worker-types'
import { extractCloudflareWorkerBearerToken } from './worker-auth'

function createWorkerMcpAuthHelpers(
  sdk: KanbanSDK,
  token: ReturnType<typeof extractCloudflareWorkerBearerToken>,
) {
  function resolveAuthContext(): AuthContext {
    return token
      ? { token: token.token, tokenSource: token.source, transport: 'mcp' }
      : { transport: 'mcp' }
  }

  function runWithAuth<T>(fn: () => Promise<T>): Promise<T> {
    return sdk.runWithAuth(resolveAuthContext(), fn)
  }

  function getAuthStatus() {
    const auth = sdk.getAuthStatus()
    const ctx = resolveAuthContext()
    return {
      ...auth,
      configured: auth.identityEnabled || auth.policyEnabled,
      tokenPresent: Boolean(ctx.token),
      tokenSource: ctx.tokenSource ?? null,
      transport: ctx.transport ?? 'mcp',
    }
  }

  return { resolveAuthContext, runWithAuth, getAuthStatus }
}

export async function handleMcpRequest(
  request: Request,
  options: CloudflareWorkerFetchHandlerOptions,
  state: WorkerEntrypointState,
  env?: CloudflareWorkerRuntimeEnv,
): Promise<Response> {
  const { kanbanDir, workspaceRoot } = getWorkerPaths(options, env)
  const workerRuntimeHost = resolveWorkerRuntimeHostHandle(options, env, workspaceRoot, state)

  await workerRuntimeHost.refreshCommittedConfig()
  installWorkerRuntimeHost(workerRuntimeHost.runtimeHost)

  return workerRuntimeHost.runWithRequestScope(() => withConfigReadCache(async () => {
    const absoluteKanbanDir = path.resolve(kanbanDir)
    const sdk = new KanbanSDK(absoluteKanbanDir)
    const token = extractCloudflareWorkerBearerToken(request.headers)
    const authHelpers = createWorkerMcpAuthHelpers(sdk, token)

    const mcpServer = createMcpServerInstance({
      sdk,
      workspaceRoot,
      kanbanDir: absoluteKanbanDir,
      authHelpers,
    })

    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: false,
    })

    await mcpServer.connect(transport)

    try {
      return await transport.handleRequest(request)
    } finally {
      sdk.close()
    }
  }))
}
