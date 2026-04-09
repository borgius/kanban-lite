import { dump, load } from 'js-yaml'

export type MetadataParseResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string }

/**
 * Serialize metadata to a YAML string.
 * Returns an empty string when metadata is undefined or empty.
 */
export function metadataToYaml(metadata: Record<string, unknown> | undefined): string {
  if (!metadata || Object.keys(metadata).length === 0) return ''
  return dump(metadata, { lineWidth: -1 }).replace(/\n$/, '')
}

/**
 * Parse a YAML string into metadata.
 * Returns `{ ok: false }` for invalid YAML, null, empty, non-object, or array values.
 */
export function yamlToMetadata(text: string): MetadataParseResult {
  const trimmed = text.trim()
  if (!trimmed) return { ok: true, value: {} }
  let parsed: unknown
  try {
    parsed = load(trimmed)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message }
  }
  if (parsed === null || parsed === undefined) return { ok: true, value: {} }
  if (Array.isArray(parsed)) return { ok: false, error: 'Metadata must be a YAML mapping, not a list' }
  if (typeof parsed !== 'object') return { ok: false, error: 'Metadata must be a YAML mapping (key: value pairs)' }
  return { ok: true, value: parsed as Record<string, unknown> }
}
