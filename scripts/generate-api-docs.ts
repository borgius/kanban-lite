#!/usr/bin/env npx tsx
/**
 * @deprecated Compatibility wrapper that preserves the historical
 * `scripts/generate-api-docs.ts` entrypoint while switching the docs pipeline
 * to the standalone Swagger/OpenAPI source of truth.
 *
 * Source of truth: `packages/kanban-lite/src/standalone/internal/openapi-spec.ts`
 * Output: `docs/api.md`
 */
import * as fs from 'fs'
import * as path from 'path'

import { KANBAN_OPENAPI_SPEC } from '../packages/kanban-lite/src/standalone/internal/openapi-spec'

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'docs', 'api.md')

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
  tags?: string[]
  summary?: string
  description?: string
  parameters?: OpenAPIParameter[]
  requestBody?: OpenAPIRequestBody
  responses?: OpenAPIResponses
}

type OpenAPISpec = {
  info: {
    title: string
    description?: string
    version?: string
  }
  tags?: Array<{ name: string; description?: string }>
  paths: Record<string, Record<string, OpenAPIOperation>>
}

const spec = KANBAN_OPENAPI_SPEC as OpenAPISpec

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

function renderParameters(parameters?: OpenAPIParameter[]): string[] {
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
    '> This file is generated from `packages/kanban-lite/src/standalone/internal/openapi-spec.ts` via `scripts/generate-api-docs.ts`.',
    '',
    `Version: ${spec.info.version ?? 'unversioned'}`,
    '',
    '- Authoritative source: Swagger/OpenAPI in `packages/kanban-lite/src/standalone/internal/openapi-spec.ts`',
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
