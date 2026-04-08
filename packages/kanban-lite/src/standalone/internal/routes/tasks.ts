import type { StandaloneRequestContext } from '../common'
import { handleTaskCrudRoutes } from './tasks/crud-routes'
import { handleTaskContentRoutes } from './tasks/content-routes'

export async function handleTaskRoutes(request: StandaloneRequestContext): Promise<boolean> {
  return await handleTaskCrudRoutes(request) || await handleTaskContentRoutes(request)
}
