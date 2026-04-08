import type { StandaloneRequestContext } from '../common'
import { handleBoardCrudRoutes } from './boards/board-routes'
import { handleBoardTaskRoutes } from './boards/task-routes'

export async function handleBoardRoutes(request: StandaloneRequestContext): Promise<boolean> {
  return await handleBoardCrudRoutes(request) || await handleBoardTaskRoutes(request)
}
