import type { StandaloneOpenApiOperation, StandaloneOpenApiPaths } from '../../sdk/plugins'
import type { StandaloneRouteHandler } from './common'
import { handleCardFileRoute } from './lifecycle'
import { boardsPaths } from './openapi-spec/paths-boards'
import { miscPaths } from './openapi-spec/paths-misc'
import { tasksPaths } from './openapi-spec/paths-tasks'
import { handleBoardCrudRoutes } from './routes/boards/board-routes'
import { handleBoardTaskRoutes } from './routes/boards/task-routes'
import { MOBILE_STANDALONE_API_DOCS, handleMobileRoutes } from './routes/mobile'
import { handleSystemApiRoutes } from './routes/system'
import { handleTaskContentRoutes } from './routes/tasks/content-routes'
import { handleTaskCrudRoutes } from './routes/tasks/crud-routes'

type StandaloneHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

type StandaloneRouteBinding = {
  method: StandaloneHttpMethod
  runtimePath: string
  handler: StandaloneRouteHandler
}

export interface StandalonePublicRouteContract extends StandaloneRouteBinding {
  openApiPath: string
  openApiMethod: Lowercase<StandaloneHttpMethod>
  operation: StandaloneOpenApiOperation
}

const BUILTIN_OPENAPI_PATHS = {
  ...boardsPaths,
  ...tasksPaths,
  ...miscPaths,
  ...MOBILE_STANDALONE_API_DOCS.paths,
} as StandaloneOpenApiPaths

function toRuntimePath(openApiPath: string): string {
  return openApiPath.replace(/\{([^}]+)\}/g, ':$1')
}

function createPublicRouteContract(
  method: StandaloneHttpMethod,
  openApiPath: string,
  handler: StandaloneRouteHandler,
): StandalonePublicRouteContract {
  const openApiMethod = method.toLowerCase() as Lowercase<StandaloneHttpMethod>
  const operation = BUILTIN_OPENAPI_PATHS[openApiPath]?.[openApiMethod]
  if (!operation) {
    throw new Error(`Missing standalone OpenAPI operation for ${method} ${openApiPath}`)
  }
  return {
    method,
    openApiPath,
    openApiMethod,
    runtimePath: toRuntimePath(openApiPath),
    handler,
    operation,
  }
}

function createInternalRouteBinding(
  method: StandaloneHttpMethod,
  runtimePath: string,
  handler: StandaloneRouteHandler,
): StandaloneRouteBinding {
  return { method, runtimePath, handler }
}

const BOARD_CRUD_PUBLIC_ROUTES: readonly StandalonePublicRouteContract[] = [
  createPublicRouteContract('GET', '/api/boards', handleBoardCrudRoutes),
  createPublicRouteContract('POST', '/api/boards', handleBoardCrudRoutes),
  createPublicRouteContract('GET', '/api/boards/overview', handleBoardCrudRoutes),
  createPublicRouteContract('GET', '/api/boards/{boardId}', handleBoardCrudRoutes),
  createPublicRouteContract('PUT', '/api/boards/{boardId}', handleBoardCrudRoutes),
  createPublicRouteContract('DELETE', '/api/boards/{boardId}', handleBoardCrudRoutes),
  createPublicRouteContract('GET', '/api/boards/{boardId}/actions', handleBoardCrudRoutes),
  createPublicRouteContract('POST', '/api/boards/{boardId}/actions', handleBoardCrudRoutes),
  createPublicRouteContract('PUT', '/api/boards/{boardId}/actions/{key}', handleBoardCrudRoutes),
  createPublicRouteContract('DELETE', '/api/boards/{boardId}/actions/{key}', handleBoardCrudRoutes),
  createPublicRouteContract('POST', '/api/boards/{boardId}/actions/{key}/trigger', handleBoardCrudRoutes),
  createPublicRouteContract('GET', '/api/boards/{boardId}/export', handleBoardCrudRoutes),
  createPublicRouteContract('POST', '/api/boards/import', handleBoardCrudRoutes),
  createPublicRouteContract('POST', '/api/boards/{boardId}/tasks/{id}/transfer', handleBoardCrudRoutes),
] as const

const BOARD_TASK_PUBLIC_ROUTES: readonly StandalonePublicRouteContract[] = [
  createPublicRouteContract('GET', '/api/boards/{boardId}/tasks', handleBoardTaskRoutes),
  createPublicRouteContract('GET', '/api/boards/{boardId}/tasks/active', handleBoardTaskRoutes),
  createPublicRouteContract('POST', '/api/boards/{boardId}/tasks', handleBoardTaskRoutes),
  createPublicRouteContract('GET', '/api/boards/{boardId}/tasks/{id}/checklist', handleBoardTaskRoutes),
  createPublicRouteContract('POST', '/api/boards/{boardId}/tasks/{id}/checklist', handleBoardTaskRoutes),
  createPublicRouteContract('PUT', '/api/boards/{boardId}/tasks/{id}/checklist/{index}', handleBoardTaskRoutes),
  createPublicRouteContract('DELETE', '/api/boards/{boardId}/tasks/{id}/checklist/{index}', handleBoardTaskRoutes),
  createPublicRouteContract('POST', '/api/boards/{boardId}/tasks/{id}/checklist/{index}/check', handleBoardTaskRoutes),
  createPublicRouteContract('POST', '/api/boards/{boardId}/tasks/{id}/checklist/{index}/uncheck', handleBoardTaskRoutes),
  createPublicRouteContract('GET', '/api/boards/{boardId}/tasks/{id}', handleBoardTaskRoutes),
  createPublicRouteContract('POST', '/api/boards/{boardId}/tasks/{id}/comments', handleBoardTaskRoutes),
  createPublicRouteContract('POST', '/api/boards/{boardId}/tasks/{id}/open', handleBoardTaskRoutes),
  createPublicRouteContract('POST', '/api/boards/{boardId}/tasks/{id}/read', handleBoardTaskRoutes),
  createPublicRouteContract('PUT', '/api/boards/{boardId}/tasks/{id}', handleBoardTaskRoutes),
  createPublicRouteContract('POST', '/api/boards/{boardId}/tasks/{id}/forms/{formId}/submit', handleBoardTaskRoutes),
  createPublicRouteContract('PATCH', '/api/boards/{boardId}/tasks/{id}/move', handleBoardTaskRoutes),
  createPublicRouteContract('POST', '/api/boards/{boardId}/tasks/{id}/actions/{action}', handleBoardTaskRoutes),
  createPublicRouteContract('DELETE', '/api/boards/{boardId}/tasks/{id}/permanent', handleBoardTaskRoutes),
  createPublicRouteContract('DELETE', '/api/boards/{boardId}/tasks/{id}', handleBoardTaskRoutes),
  createPublicRouteContract('GET', '/api/boards/{boardId}/columns', handleBoardTaskRoutes),
  createPublicRouteContract('GET', '/api/boards/{boardId}/logs', handleBoardTaskRoutes),
  createPublicRouteContract('POST', '/api/boards/{boardId}/logs', handleBoardTaskRoutes),
  createPublicRouteContract('DELETE', '/api/boards/{boardId}/logs', handleBoardTaskRoutes),
] as const

const TASK_CRUD_PUBLIC_ROUTES: readonly StandalonePublicRouteContract[] = [
  createPublicRouteContract('GET', '/api/tasks', handleTaskCrudRoutes),
  createPublicRouteContract('GET', '/api/tasks/active', handleTaskCrudRoutes),
  createPublicRouteContract('POST', '/api/tasks', handleTaskCrudRoutes),
  createPublicRouteContract('GET', '/api/tasks/{id}/checklist', handleTaskCrudRoutes),
  createPublicRouteContract('POST', '/api/tasks/{id}/checklist', handleTaskCrudRoutes),
  createPublicRouteContract('PUT', '/api/tasks/{id}/checklist/{index}', handleTaskCrudRoutes),
  createPublicRouteContract('DELETE', '/api/tasks/{id}/checklist/{index}', handleTaskCrudRoutes),
  createPublicRouteContract('POST', '/api/tasks/{id}/checklist/{index}/check', handleTaskCrudRoutes),
  createPublicRouteContract('POST', '/api/tasks/{id}/checklist/{index}/uncheck', handleTaskCrudRoutes),
  createPublicRouteContract('GET', '/api/tasks/{id}', handleTaskCrudRoutes),
  createPublicRouteContract('POST', '/api/tasks/{id}/open', handleTaskCrudRoutes),
  createPublicRouteContract('POST', '/api/tasks/{id}/read', handleTaskCrudRoutes),
  createPublicRouteContract('PUT', '/api/tasks/{id}', handleTaskCrudRoutes),
  createPublicRouteContract('POST', '/api/tasks/{id}/forms/{formId}/submit', handleTaskCrudRoutes),
  createPublicRouteContract('PATCH', '/api/tasks/{id}/move', handleTaskCrudRoutes),
  createPublicRouteContract('POST', '/api/tasks/{id}/actions/{action}', handleTaskCrudRoutes),
  createPublicRouteContract('DELETE', '/api/tasks/{id}/permanent', handleTaskCrudRoutes),
  createPublicRouteContract('DELETE', '/api/tasks/{id}', handleTaskCrudRoutes),
] as const

const TASK_CONTENT_PUBLIC_ROUTES: readonly StandalonePublicRouteContract[] = [
  createPublicRouteContract('POST', '/api/tasks/{id}/attachments', handleTaskContentRoutes),
  createPublicRouteContract('GET', '/api/tasks/{id}/attachments/{filename}', handleTaskContentRoutes),
  createPublicRouteContract('DELETE', '/api/tasks/{id}/attachments/{filename}', handleTaskContentRoutes),
  createPublicRouteContract('GET', '/api/tasks/{id}/comments', handleTaskContentRoutes),
  createPublicRouteContract('POST', '/api/tasks/{id}/comments', handleTaskContentRoutes),
  createPublicRouteContract('POST', '/api/tasks/{id}/comments/stream', handleTaskContentRoutes),
  createPublicRouteContract('PUT', '/api/tasks/{id}/comments/{commentId}', handleTaskContentRoutes),
  createPublicRouteContract('DELETE', '/api/tasks/{id}/comments/{commentId}', handleTaskContentRoutes),
  createPublicRouteContract('GET', '/api/tasks/{id}/logs', handleTaskContentRoutes),
  createPublicRouteContract('POST', '/api/tasks/{id}/logs', handleTaskContentRoutes),
  createPublicRouteContract('DELETE', '/api/tasks/{id}/logs', handleTaskContentRoutes),
] as const

const MOBILE_PUBLIC_ROUTES: readonly StandalonePublicRouteContract[] = [
  createPublicRouteContract('POST', '/api/mobile/bootstrap', handleMobileRoutes),
] as const

const SYSTEM_PUBLIC_ROUTES: readonly StandalonePublicRouteContract[] = [
  createPublicRouteContract('GET', '/api/resolve-path', handleSystemApiRoutes),
  createPublicRouteContract('GET', '/api/health', handleSystemApiRoutes),
  createPublicRouteContract('POST', '/api/webview-sync', handleSystemApiRoutes),
  createPublicRouteContract('GET', '/api/events', handleSystemApiRoutes),
  createPublicRouteContract('GET', '/api/card-state/status', handleSystemApiRoutes),
  createPublicRouteContract('GET', '/api/columns', handleSystemApiRoutes),
  createPublicRouteContract('POST', '/api/columns', handleSystemApiRoutes),
  createPublicRouteContract('PUT', '/api/columns/reorder', handleSystemApiRoutes),
  createPublicRouteContract('PUT', '/api/columns/minimized', handleSystemApiRoutes),
  createPublicRouteContract('PUT', '/api/columns/{id}', handleSystemApiRoutes),
  createPublicRouteContract('DELETE', '/api/columns/{id}', handleSystemApiRoutes),
  createPublicRouteContract('GET', '/api/settings', handleSystemApiRoutes),
  createPublicRouteContract('PUT', '/api/settings', handleSystemApiRoutes),
  createPublicRouteContract('GET', '/api/plugin-settings', handleSystemApiRoutes),
  createPublicRouteContract('GET', '/api/plugin-settings/{capability}/{providerId}', handleSystemApiRoutes),
  createPublicRouteContract('PUT', '/api/plugin-settings/{capability}/{providerId}/select', handleSystemApiRoutes),
  createPublicRouteContract('PUT', '/api/plugin-settings/{capability}/{providerId}/options', handleSystemApiRoutes),
  createPublicRouteContract('POST', '/api/plugin-settings/install', handleSystemApiRoutes),
  createPublicRouteContract('GET', '/api/labels', handleSystemApiRoutes),
  createPublicRouteContract('PUT', '/api/labels/{name}', handleSystemApiRoutes),
  createPublicRouteContract('PATCH', '/api/labels/{name}', handleSystemApiRoutes),
  createPublicRouteContract('DELETE', '/api/labels/{name}', handleSystemApiRoutes),
  createPublicRouteContract('GET', '/api/workspace', handleSystemApiRoutes),
  createPublicRouteContract('GET', '/api/auth', handleSystemApiRoutes),
  createPublicRouteContract('GET', '/api/storage', handleSystemApiRoutes),
  createPublicRouteContract('POST', '/api/storage/migrate-to-sqlite', handleSystemApiRoutes),
  createPublicRouteContract('POST', '/api/storage/migrate-to-markdown', handleSystemApiRoutes),
] as const

export const BUILTIN_STANDALONE_ROUTE_CONTRACTS: readonly StandalonePublicRouteContract[] = [
  ...BOARD_CRUD_PUBLIC_ROUTES,
  ...BOARD_TASK_PUBLIC_ROUTES,
  ...TASK_CRUD_PUBLIC_ROUTES,
  ...TASK_CONTENT_PUBLIC_ROUTES,
  ...MOBILE_PUBLIC_ROUTES,
  ...SYSTEM_PUBLIC_ROUTES,
] as const

export const BUILTIN_INTERNAL_ROUTE_BINDINGS: readonly StandaloneRouteBinding[] = [
  createInternalRouteBinding('POST', '/api/upload-attachment', handleSystemApiRoutes),
  createInternalRouteBinding('GET', '/api/attachment', handleSystemApiRoutes),
  createInternalRouteBinding('GET', '/api/card-file', handleCardFileRoute),
] as const

function createBoundRouteHandler(binding: StandaloneRouteBinding): StandaloneRouteHandler {
  return async (request) => {
    if (!request.route(binding.method, binding.runtimePath)) {
      return false
    }
    return binding.handler(request)
  }
}

export function createBuiltInStandaloneRouteHandlers(): StandaloneRouteHandler[] {
  return [
    ...BUILTIN_STANDALONE_ROUTE_CONTRACTS,
    ...BUILTIN_INTERNAL_ROUTE_BINDINGS,
  ].map(createBoundRouteHandler)
}

export function buildBuiltInStandaloneOpenApiPaths(): StandaloneOpenApiPaths {
  return BUILTIN_STANDALONE_ROUTE_CONTRACTS.reduce<StandaloneOpenApiPaths>((paths, contract) => {
    const pathItem = paths[contract.openApiPath] ?? {}
    pathItem[contract.openApiMethod] = contract.operation
    paths[contract.openApiPath] = pathItem
    return paths
  }, {})
}

export function listBuiltInStandaloneRouteContractKeys(): string[] {
  return BUILTIN_STANDALONE_ROUTE_CONTRACTS
    .map((contract) => `${contract.method} ${contract.openApiPath}`)
    .sort((left, right) => left.localeCompare(right))
}
