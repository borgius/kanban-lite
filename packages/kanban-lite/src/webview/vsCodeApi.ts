// Singleton accessor for the VS Code API.
// In VS Code, acquireVsCodeApi() may only be called once per page; this module
// ensures exactly one call regardless of how many consumers import it.
// In standalone mode the shim provides the same function, also callable many
// times, so the singleton is still fine.
declare const acquireVsCodeApi: () => {
  postMessage: (message: unknown) => void
  getState: () => unknown
  setState: (state: unknown) => void
}

let _api: ReturnType<typeof acquireVsCodeApi> | null = null

export function getVsCodeApi(): ReturnType<typeof acquireVsCodeApi> {
  if (!_api) _api = acquireVsCodeApi()
  return _api
}
