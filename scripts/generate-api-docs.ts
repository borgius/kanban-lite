#!/usr/bin/env npx tsx
/**
 * @deprecated Compatibility wrapper that preserves the historical
 * `scripts/generate-api-docs.ts` entrypoint while switching the docs pipeline
 * to the standalone Swagger/OpenAPI source of truth plus active standalone
 * plugin API metadata.
 *
 * Source of truth: `packages/kanban-lite/src/standalone/internal/openapi-spec.ts`
 * plus plugin-owned fragments discovered through the standalone plugin path
 * Output: `docs/api.md`
 */
import * as fs from 'fs'
import * as path from 'path'

import { normalizeWebhookCapabilities } from '../packages/kanban-lite/src/shared/config'
import { resolveCapabilityBag, type StandaloneHttpPlugin } from '../packages/kanban-lite/src/sdk/plugins'
import { KANBAN_OPENAPI_SPEC } from '../packages/kanban-lite/src/standalone/internal/openapi-spec'
import { MOBILE_STANDALONE_API_DOCS } from '../packages/kanban-lite/src/standalone/internal/routes/mobile'

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'docs', 'api.md')
const DOCS_KANBAN_DIR = path.join(ROOT, '.kanban')

type OpenAPISchema = {
  type?: string
  description?: string
  enum?: readonly string[]
  items?: OpenAPISchema
  properties?: Record<string, OpenAPISchema>
  required?: readonly string[]
  additionalProperties?: boolean | OpenAPISchema
  nullable?: boolean
  $ref?: string
}

type OpenAPIParameter = {
  name: string
  in: string
  required?: boolean
  description?: string
  schema?: OpenAPISchema
}

type OpenAPIRequestBody = {
  required?: boolean
  description?: string
  content?: Record<string, { schema?: OpenAPISchema }>
}

type OpenAPIResponses = Record<string, { description?: string }>

type OpenAPIOperation = {
  tags?: readonly string[]
  summary?: string
  description?: string
  parameters?: readonly OpenAPIParameter[]
  requestBody?: OpenAPIRequestBody
  responses?: OpenAPIResponses
}

type OpenApiTag = { name: string; description?: string }
type OpenApiDocFragment = { tags?: ReadonlyArray<OpenApiTag>; paths: OpenAPISpec['paths'] }

type OpenAPISpec = {
  info: {
    title: string
    description?: string
    version?: string
  }
  tags?: OpenApiTag[]
  paths: Record<string, Record<string, OpenAPIOperation>>
}

const WEBHOOK_STANDALONE_PLUGIN_ID = 'webhooks'
const BUILTIN_STANDALONE_API_DOCS = [MOBILE_STANDALONE_API_DOCS] as const

const WEBHOOK_STANDALONE_API_DOCS = {
  tags: [
    {
      name: 'Webhooks',
      description: 'Webhook registration endpoints. These routes are registered by the active standalone webhook plugin while preserving the public `/api/webhooks` contract.',
    },
  ],
  paths: {
    '/api/webhooks': {
      get: {
        tags: ['Webhooks'],
        summary: 'List webhooks',
        description: 'Returns all registered webhooks. Runtime ownership stays on the active standalone webhook plugin, which preserves this public path.',
        responses: { 200: { description: 'Webhook list.' }, 401: { description: 'Authentication required.' }, 403: { description: 'Forbidden.' } },
      },
      post: {
        tags: ['Webhooks'],
        summary: 'Create webhook',
        description: 'Registers a new webhook endpoint through the active standalone webhook plugin.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['url', 'events'],
                properties: {
                  url: { type: 'string', description: 'Target HTTP(S) URL.' },
                  events: { type: 'array', items: { type: 'string' }, description: 'Subscribed event names, or `["*"]` for all events.' },
                  secret: { type: 'string', description: 'Optional HMAC signing secret.' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Webhook created.' },
          400: { description: 'Validation error.' },
          401: { description: 'Authentication required.' },
          403: { description: 'Forbidden.' },
        },
      },
    },
    '/api/webhooks/{id}': {
      put: {
        tags: ['Webhooks'],
        summary: 'Update webhook',
        description: 'Updates an existing webhook by id through the active standalone webhook plugin.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Webhook identifier.',
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  url: { type: 'string', description: 'Updated HTTP(S) URL.' },
                  events: { type: 'array', items: { type: 'string' }, description: 'Updated event filter list.' },
                  secret: { type: 'string', description: 'Updated HMAC signing secret.' },
                  active: { type: 'boolean', description: 'Whether the webhook is active.' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Webhook updated.' },
          401: { description: 'Authentication required.' },
          403: { description: 'Forbidden.' },
          404: { description: 'Webhook not found.' },
        },
      },
      delete: {
        tags: ['Webhooks'],
        summary: 'Delete webhook',
        description: 'Deletes a webhook by id through the active standalone webhook plugin.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Webhook identifier.',
          },
        ],
        responses: {
          200: { description: 'Webhook deleted.' },
          401: { description: 'Authentication required.' },
          403: { description: 'Forbidden.' },
          404: { description: 'Webhook not found.' },
        },
      },
    },
  },
} as const

function mergeStandaloneOpenApiDocs(
  baseSpec: OpenAPISpec,
  fragments: ReadonlyArray<OpenApiDocFragment>,
): OpenAPISpec {
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

  return {
    ...baseSpec,
    tags: mergedTags,
    paths: {
      ...baseSpec.paths,
      ...Object.assign({}, ...fragments.map((fragment) => fragment.paths)),
    },
  }
}

function hasStandaloneWebhookPlugin(plugins: readonly StandaloneHttpPlugin[]): boolean {
  return plugins.some((plugin) => plugin.manifest.id === WEBHOOK_STANDALONE_PLUGIN_ID)
}

function buildSpec(): OpenAPISpec {
  const baseSpec = KANBAN_OPENAPI_SPEC as OpenAPISpec
  const fragments: OpenApiDocFragment[] = [...BUILTIN_STANDALONE_API_DOCS]

  try {
    const capabilityBag = resolveCapabilityBag(
      {
        'card.storage': { provider: 'markdown' },
        'attachment.storage': { provider: 'localfs' },
      },
      DOCS_KANBAN_DIR,
      undefined,
      normalizeWebhookCapabilities({}),
    )

    if (hasStandaloneWebhookPlugin(capabilityBag.standaloneHttpPlugins)) {
      fragments.push(WEBHOOK_STANDALONE_API_DOCS)
    }
  } catch {
    return mergeStandaloneOpenApiDocs(baseSpec, fragments)
  }

  return mergeStandaloneOpenApiDocs(baseSpec, fragments)
}

const spec = buildSpec()

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, '<br/>')
}

function formatSchemaType(schema?: OpenAPISchema): string {
  if (!schema) return '—'
  if (schema.$ref) return `\`${schema.$ref.replace('#/components/schemas/', '')}\``
  if (schema.enum?.length) return schema.enum.map((value) => `\`${value}\``).join(' \\| ')
  if (schema.type === 'array') return schema.items ? `${formatSchemaType(schema.items)}[]` : 'array'
  if (schema.type === 'object' && schema.additionalProperties && typeof schema.additionalProperties === 'object') {
    return `Record<string, ${formatSchemaType(schema.additionalProperties)}>`
  }
  if (schema.type === 'object' && schema.properties) return 'object'
  const baseType = schema.type ?? 'object'
  return schema.nullable ? `${baseType} | null` : baseType
}

function renderSchemaTable(schema?: OpenAPISchema): string[] {
  if (!schema?.properties || Object.keys(schema.properties).length === 0) {
    if (schema?.description) return ['', schema.description]
    if (schema) return ['', `Schema: ${formatSchemaType(schema)}`]
    return []
  }

  const required = new Set(schema.required ?? [])
  const lines = [
    '',
    '| Field | Type | Required | Description |',
    '|------|------|----------|-------------|',
  ]

  for (const [fieldName, fieldSchema] of Object.entries(schema.properties)) {
    lines.push(
      `| \`${escapeTableCell(fieldName)}\` | ${escapeTableCell(formatSchemaType(fieldSchema))} | ${required.has(fieldName) ? 'Yes' : 'No'} | ${escapeTableCell(fieldSchema.description ?? '—')} |`,
    )
  }

  return lines
}

function renderParameters(parameters?: readonly OpenAPIParameter[]): string[] {
  if (!parameters?.length) return []

  const lines = [
    '',
    '#### Parameters',
    '',
    '| Name | In | Type | Required | Description |',
    '|------|----|------|----------|-------------|',
  ]

  for (const parameter of parameters) {
    lines.push(
      `| \`${escapeTableCell(parameter.name)}\` | ${escapeTableCell(parameter.in)} | ${escapeTableCell(formatSchemaType(parameter.schema))} | ${parameter.required ? 'Yes' : 'No'} | ${escapeTableCell(parameter.description ?? '—')} |`,
    )
  }

  return lines
}

function renderRequestBody(requestBody?: OpenAPIRequestBody): string[] {
  if (!requestBody) return []

  const schema = requestBody.content?.['application/json']?.schema
  const lines = ['', '#### Request Body', '', `Required: ${requestBody.required ? 'Yes' : 'No'}`]

  if (requestBody.description) {
    lines.push('', requestBody.description)
  }

  return [...lines, ...renderSchemaTable(schema)]
}

function renderResponses(responses?: OpenAPIResponses): string[] {
  if (!responses || Object.keys(responses).length === 0) return []

  const lines = [
    '',
    '#### Responses',
    '',
    '| Status | Description |',
    '|--------|-------------|',
  ]

  for (const [status, response] of Object.entries(responses)) {
    lines.push(`| \`${escapeTableCell(String(status))}\` | ${escapeTableCell(response.description ?? '—')} |`)
  }

  return lines
}

function collectOperationsForTag(tagName: string): Array<{ path: string; method: string; operation: OpenAPIOperation }> {
  const operations: Array<{ path: string; method: string; operation: OpenAPIOperation }> = []

  for (const [routePath, methods] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (operation.tags?.includes(tagName)) {
        operations.push({ path: routePath, method, operation })
      }
    }
  }

  return operations
}

function buildMarkdown(): string {
  const lines: string[] = [
    `# ${spec.info.title}`,
    '',
    '> This file is generated from `packages/kanban-lite/src/standalone/internal/openapi-spec.ts` plus active standalone plugin API metadata via `scripts/generate-api-docs.ts`.',
    '',
    `Version: ${spec.info.version ?? 'unversioned'}`,
    '',
    '- Authoritative source: Swagger/OpenAPI in `packages/kanban-lite/src/standalone/internal/openapi-spec.ts` plus standalone plugin API metadata discovered during docs generation',
    '- Interactive docs: `http://localhost:3000/api/docs`',
    '- OpenAPI JSON: `http://localhost:3000/api/docs/json`',
    '- Base API URL: `http://localhost:3000/api`',
  ]

  if (spec.info.description) {
    lines.push('', spec.info.description)
  }

  for (const tag of spec.tags ?? []) {
    const operations = collectOperationsForTag(tag.name)
    if (operations.length === 0) continue

    lines.push('', `## ${tag.name}`)

    if (tag.description) {
      lines.push('', tag.description)
    }

    for (const { path: routePath, method, operation } of operations) {
      lines.push('', `### ${method.toUpperCase()} \`${routePath}\``)

      if (operation.summary) {
        lines.push('', `**${operation.summary}**`)
      }

      if (operation.description) {
        lines.push('', operation.description)
      }

      lines.push(...renderParameters(operation.parameters))
      lines.push(...renderRequestBody(operation.requestBody))
      lines.push(...renderResponses(operation.responses))
    }
  }

  return `${lines.join('\n').trim()}\n`
}

fs.writeFileSync(OUT, buildMarkdown(), 'utf8')
console.log(`Generated ${path.relative(ROOT, OUT)} from packages/kanban-lite/src/standalone/internal/openapi-spec.ts`)
