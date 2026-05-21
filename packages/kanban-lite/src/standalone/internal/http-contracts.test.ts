import { describe, expect, it } from 'vitest'

import { KANBAN_OPENAPI_SPEC } from './openapi-spec'
import {
  buildBuiltInStandaloneOpenApiPaths,
  listBuiltInStandaloneRouteContractKeys,
} from './http-contracts'

function collectRouteKeys(paths: Record<string, Record<string, unknown>>): string[] {
  return Object.entries(paths)
    .flatMap(([routePath, pathItem]) => Object.keys(pathItem).map((method) => `${method.toUpperCase()} ${routePath}`))
    .sort((left, right) => left.localeCompare(right))
}

describe('built-in standalone route contracts', () => {
  it('generate the same built-in OpenAPI operations as the contract registry', () => {
    expect(collectRouteKeys(buildBuiltInStandaloneOpenApiPaths())).toEqual(
      listBuiltInStandaloneRouteContractKeys(),
    )
  })

  it('keep the base standalone OpenAPI spec aligned with the built-in contract registry', () => {
    const routeKeys = collectRouteKeys(KANBAN_OPENAPI_SPEC.paths as Record<string, Record<string, unknown>>)

    expect(routeKeys).toEqual(listBuiltInStandaloneRouteContractKeys())
    expect(routeKeys).toContain('GET /api/health')
    expect(routeKeys).toContain('POST /api/webview-sync')
    expect(routeKeys).toContain('POST /api/tasks/{id}/comments/stream')
  })
})
