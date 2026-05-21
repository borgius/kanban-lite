import { jsonError, jsonOk, readBody } from '../../httpUtils'
import type { StandaloneRequestContext } from '../common'
export { MOBILE_STANDALONE_API_DOCS } from './mobile-docs'

export async function handleMobileRoutes(request: StandaloneRequestContext): Promise<boolean> {
  const { ctx, route, req, res } = request

  const params = route('POST', '/api/mobile/bootstrap')
  if (!params) return false

  try {
    const body = await readBody(req)
    const workspaceOrigin = typeof body.workspaceOrigin === 'string' ? body.workspaceOrigin.trim() : ''
    if (workspaceOrigin.length === 0) {
      jsonError(res, 400, 'workspaceOrigin is required')
      return true
    }

    const payload = await ctx.sdk.resolveMobileBootstrap({
      workspaceOrigin,
      bootstrapToken: typeof body.bootstrapToken === 'string' ? body.bootstrapToken : null,
    })
    jsonOk(res, payload)
  } catch (error) {
    jsonError(res, 400, error instanceof Error ? error.message : String(error))
  }
  return true
}
