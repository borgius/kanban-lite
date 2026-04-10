import { PluginSettingsOperationError } from '../../../sdk/KanbanSDK'
import { authErrorToHttpStatus, extractAuthContext, getAuthErrorLike } from '../../authUtils'
import { jsonError, jsonOk, readBody } from '../../httpUtils'
import type { StandaloneRequestContext } from '../common'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function jsonErrorWithData(res: Parameters<typeof jsonError>[0], status: number, error: string, data: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  })
  res.end(JSON.stringify({ ok: false, error, data }))
}

function getPluginSettingsErrorStatus(code: string): number {
  switch (code) {
    case 'invalid-plugin-install-package-name':
    case 'invalid-plugin-install-scope':
    case 'plugin-settings-options-invalid':
    case 'plugin-settings-install-failed':
    case 'plugin-settings-runtime-mutation-rejected':
      return 400
    case 'plugin-settings-provider-not-found':
      return 404
    default:
      return 500
  }
}

function handlePluginSettingsRouteError(
  res: Parameters<typeof jsonError>[0],
  error: unknown,
): void {
  const authErr = getAuthErrorLike(error)
  if (authErr) {
    jsonError(res, authErrorToHttpStatus(authErr), authErr.message)
    return
  }

  if (error instanceof PluginSettingsOperationError) {
    jsonErrorWithData(res, getPluginSettingsErrorStatus(error.payload.code), error.payload.message, error.payload)
    return
  }

  jsonError(res, 500, String(error))
}

export async function handlePluginSettingsRoutes(request: StandaloneRequestContext): Promise<boolean> {
  const { ctx, route, req, res } = request
  const { sdk } = ctx
  const runWithRequestAuth = <T>(fn: () => Promise<T>): Promise<T> => sdk.runWithAuth(extractAuthContext(req), fn)

  let params = route('GET', '/api/plugin-settings')
  if (params) {
    try {
      jsonOk(res, await runWithRequestAuth(() => sdk.listPluginSettings()))
    } catch (err) {
      handlePluginSettingsRouteError(res, err)
    }
    return true
  }

  params = route('GET', '/api/plugin-settings/:capability/:providerId')
  if (params) {
    const { capability, providerId } = params
    try {
      const provider = await runWithRequestAuth(() =>
        sdk.getPluginSettings(capability as never, providerId),
      )
      if (!provider) {
        jsonError(res, 404, 'Plugin provider not found')
      } else {
        jsonOk(res, provider)
      }
    } catch (err) {
      handlePluginSettingsRouteError(res, err)
    }
    return true
  }

  params = route('PUT', '/api/plugin-settings/:capability/:providerId/select')
  if (params) {
    const { capability, providerId } = params
    try {
      const provider = await runWithRequestAuth(() =>
        sdk.selectPluginSettingsProvider(capability as never, providerId),
      )
      jsonOk(res, provider)
    } catch (err) {
      handlePluginSettingsRouteError(res, err)
    }
    return true
  }

  params = route('PUT', '/api/plugin-settings/:capability/:providerId/options')
  if (params) {
    const { capability, providerId } = params
    try {
      const body = await readBody(req)
      const nextOptions = 'options' in body ? body.options : body
      if (!isRecord(nextOptions)) {
        jsonError(res, 400, 'options must be an object')
        return true
      }

      const provider = await runWithRequestAuth(() =>
        sdk.updatePluginSettingsOptions(capability as never, providerId, nextOptions),
      )
      jsonOk(res, provider)
    } catch (err) {
      handlePluginSettingsRouteError(res, err)
    }
    return true
  }

  params = route('POST', '/api/plugin-settings/install')
  if (params) {
    try {
      const body = await readBody(req)
      const result = await runWithRequestAuth(() => sdk.installPluginSettingsPackage({
        packageName: body.packageName,
        scope: body.scope,
      }))
      jsonOk(res, result)
    } catch (err) {
      handlePluginSettingsRouteError(res, err)
    }
    return true
  }

  return false
}
