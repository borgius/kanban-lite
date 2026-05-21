import type {
  StandaloneOpenApiDocFragment,
  StandaloneOpenApiOperation,
  StandaloneOpenApiParameter,
  StandaloneOpenApiPaths,
  StandaloneOpenApiRequestBody,
  StandaloneOpenApiSchema,
  StandaloneOpenApiTag,
} from '../../../sdk/plugins'

type OpenApiSchema = StandaloneOpenApiSchema

type OpenApiParameter = StandaloneOpenApiParameter

type OpenApiMediaType = {
  schema?: OpenApiSchema
  [key: string]: unknown
}

type OpenApiRequestBody = StandaloneOpenApiRequestBody

type OpenApiOperation = StandaloneOpenApiOperation

type OpenApiPathItem = Record<string, OpenApiOperation>

type OpenApiTag = StandaloneOpenApiTag

export type OpenApiPaths = StandaloneOpenApiPaths

export type OpenApiDocFragment = StandaloneOpenApiDocFragment

export type OpenApiSpecWithPaths = {
  tags?: OpenApiTag[]
  paths: OpenApiPaths
  [key: string]: unknown
}

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options'])

function cloneSchema(schema?: OpenApiSchema): OpenApiSchema | undefined {
  if (!schema) return undefined
  return {
    ...schema,
    items: cloneSchema(schema.items),
    properties: schema.properties
      ? Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, cloneSchema(value) ?? value]))
      : undefined,
    oneOf: schema.oneOf?.map((entry) => cloneSchema(entry) ?? entry),
    anyOf: schema.anyOf?.map((entry) => cloneSchema(entry) ?? entry),
    allOf: schema.allOf?.map((entry) => cloneSchema(entry) ?? entry),
  }
}

function toOperationId(summary: string): string {
  return summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function fallbackOperationId(method: string, routePath: string): string {
  return `${method}_${routePath
    .replace(/^\/api\//, '')
    .replace(/\{([^}]+)\}/g, '$1')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')}`
    .toLowerCase()
}

function normalizeParameter(parameter: OpenApiParameter): OpenApiParameter {
  const schema = cloneSchema(parameter.schema)
  const description = schema?.description ?? parameter.description

  return {
    ...parameter,
    schema: schema
      ? {
          ...schema,
          ...(description ? { description } : {}),
        }
      : schema,
  }
}

function normalizeRequestBody(requestBody?: OpenApiRequestBody): OpenApiRequestBody | undefined {
  if (!requestBody) return undefined

  const content = requestBody.content
    ? Object.fromEntries(
        Object.entries(requestBody.content).map(([mediaType, media]) => {
          const schema = cloneSchema(media.schema)
          return [mediaType, {
            ...media,
            schema: schema
              ? {
                  ...schema,
                  ...(schema.description ?? requestBody.description
                    ? { description: schema.description ?? requestBody.description }
                    : {}),
                }
              : schema,
          }]
        }),
      )
    : undefined

  return {
    ...requestBody,
    ...(content ? { content } : {}),
  }
}

function normalizeOperation(method: string, routePath: string, operation: OpenApiOperation): OpenApiOperation {
  return {
    ...operation,
    operationId: operation.operationId ?? (operation.summary ? toOperationId(operation.summary) : fallbackOperationId(method, routePath)),
    parameters: operation.parameters?.map(normalizeParameter),
    requestBody: normalizeRequestBody(operation.requestBody),
  }
}

export function normalizeStandaloneOpenApiSpec<TSpec extends OpenApiSpecWithPaths>(spec: TSpec): TSpec {
  return {
    ...spec,
    paths: Object.fromEntries(
      Object.entries(spec.paths).map(([routePath, pathItem]) => [
        routePath,
        Object.fromEntries(
          Object.entries(pathItem).map(([method, operation]) => [
            method,
            HTTP_METHODS.has(method)
              ? normalizeOperation(method, routePath, operation)
              : operation,
          ]),
        ),
      ]),
    ),
  }
}

export function mergeStandaloneOpenApiDocs<TSpec extends OpenApiSpecWithPaths>(
  baseSpec: TSpec,
  fragments: ReadonlyArray<OpenApiDocFragment>,
): TSpec {
  const mergedTags: OpenApiTag[] = [...(baseSpec.tags ?? [])]
  const seenTagNames = new Set(mergedTags.map((tag) => tag.name))

  for (const fragment of fragments) {
    for (const tag of fragment.tags ?? []) {
      if (!seenTagNames.has(tag.name)) {
        mergedTags.push(tag)
        seenTagNames.add(tag.name)
      }
    }
  }

  return normalizeStandaloneOpenApiSpec({
    ...baseSpec,
    tags: mergedTags,
    paths: {
      ...baseSpec.paths,
      ...Object.assign({}, ...fragments.map((fragment) => fragment.paths)),
    },
  } as TSpec)
}
