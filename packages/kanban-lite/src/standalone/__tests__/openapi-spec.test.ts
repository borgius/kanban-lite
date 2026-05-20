import { describe, expect, it } from 'vitest'
import { KANBAN_OPENAPI_SPEC } from '../internal/openapi-spec'
import {
  mergeStandaloneOpenApiDocs,
  normalizeStandaloneOpenApiSpec,
  type OpenApiDocFragment,
  type OpenApiSpecWithPaths,
} from '../internal/openapi-spec/normalize'

describe('standalone OpenAPI metadata', () => {
  it('assigns stable operationIds and schema-level descriptions to list_tasks query params', () => {
    const spec = normalizeStandaloneOpenApiSpec(KANBAN_OPENAPI_SPEC as OpenApiSpecWithPaths)
    const operation = spec.paths['/api/tasks']?.get as {
      operationId?: string
      parameters?: Array<{
        name: string
        description?: string
        schema?: { description?: string }
      }>
    }

    expect(operation.operationId).toBe('list_tasks')

    const qParam = operation.parameters?.find((parameter) => parameter.name === 'q')
    const metaParam = operation.parameters?.find((parameter) => parameter.name === 'meta.<field>')

    expect(qParam?.schema?.description).toBe(qParam?.description)
    expect(metaParam?.schema?.description).toBe(metaParam?.description)
  })

  it('describes update_task and update_settings payload fields explicitly', () => {
    const spec = normalizeStandaloneOpenApiSpec(KANBAN_OPENAPI_SPEC as OpenApiSpecWithPaths)
    const updateTaskSchema = (spec.paths['/api/tasks/{id}']?.put as {
      requestBody?: {
        content?: {
          'application/json'?: {
            schema?: {
              properties?: Record<string, unknown>
            }
          }
        }
      }
    }).requestBody?.content?.['application/json']?.schema as {
      properties?: {
        content?: { description?: string }
        forms?: { items?: { properties?: { name?: { description?: string } } } }
      }
    }
    const settingsSchema = (spec.paths['/api/settings']?.put as {
      requestBody?: {
        content?: {
          'application/json'?: {
            schema?: {
              properties?: Record<string, unknown>
            }
          }
        }
      }
    }).requestBody?.content?.['application/json']?.schema as {
      properties?: {
        showBuildWithAI?: { description?: string }
        logsFilter?: {
          properties?: {
            show?: {
              properties?: {
                objects?: { description?: string }
              }
            }
          }
        }
      }
    }

    expect(updateTaskSchema.properties?.content?.description).toContain('replaces the existing task body')
    expect(updateTaskSchema.properties?.forms?.items?.properties?.name?.description).toContain('workspace form')
    expect(settingsSchema.properties?.showBuildWithAI?.description).toContain('Build with AI')
    expect(settingsSchema.properties?.logsFilter?.properties?.show?.properties?.objects?.description).toContain('structured JSON')
  })

  it('normalizes standalone plugin doc fragments too', () => {
    const fragment: OpenApiDocFragment = {
      paths: {
        '/api/example/{id}': {
          get: {
            summary: 'Get example',
            description: 'Returns one example resource.',
            parameters: [{
              name: 'id',
              in: 'path',
              required: true,
              description: 'Example identifier.',
              schema: { type: 'string' },
            }],
            responses: { 200: { description: 'Example payload.' } },
          },
        },
      },
    }

    const spec = mergeStandaloneOpenApiDocs(
      KANBAN_OPENAPI_SPEC as OpenApiSpecWithPaths,
      [fragment],
    )
    const operation = spec.paths['/api/example/{id}']?.get as {
      operationId?: string
      parameters?: Array<{ schema?: { description?: string } }>
    }

    expect(operation.operationId).toBe('get_example')
    expect(operation.parameters?.[0]?.schema?.description).toBe('Example identifier.')
  })
})
