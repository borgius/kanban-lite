import Fuse from 'fuse.js'
import type { Card } from '../shared/types'

/**
 * Retrieves a value from a nested object using a dot-notation path.
 * Returns `undefined` if any segment along the path does not exist or is not an object.
 *
 * @param obj - The object to traverse.
 * @param path - Dot-separated key path (e.g. `'links.jira'`).
 * @returns The value at the path, or `undefined`.
 *
 * @example
 * getNestedValue({ links: { jira: 'PROJ-123' } }, 'links.jira')
 * // => 'PROJ-123'
 */
export function getNestedValue(obj: Record<string, any>, path: string): unknown {
  return path.split('.').reduce((curr: any, key) =>
    curr != null && typeof curr === 'object' ? curr[key] : undefined, obj)
}

export interface ParsedSearchQuery {
  metaFilter: Record<string, string>
  plainText: string
}

function decodeSearchTokenValue(value: string): string {
  return value.replace(/\\([\\"'])/g, '$1')
}

/**
 * Parses `meta.field: value` tokens out of a free-text query string.
 * The returned metadata filter uses dot-notation paths and preserves the
 * existing token syntax used by the webview search bar.
 *
 * @param query - Raw search query containing optional `meta.field: value` tokens.
 * @returns Extracted metadata filters plus the remaining plain-text query.
 */
export function parseSearchQuery(query: string): ParsedSearchQuery {
  const metaFilter: Record<string, string> = {}
  const plainText = query
    .replace(/meta\.([a-zA-Z0-9_.]+):\s*(?:"((?:\\.|[^"])*)"|'((?:\\.|[^'])*)'|(\S+))/g, (_full, key, doubleQuoted, singleQuoted, bareValue) => {
      const rawValue = doubleQuoted ?? singleQuoted ?? bareValue ?? ''
      metaFilter[key] = decodeSearchTokenValue(rawValue)
      return ''
    })
    .replace(/\s{2,}/g, ' ')
    .trim()
  return { metaFilter, plainText }
}

function collectMetadataValues(value: unknown): string[] {
  if (value == null) return []
  if (Array.isArray(value)) {
    return value.flatMap(item => collectMetadataValues(item))
  }
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap(item => collectMetadataValues(item))
  }
  return [String(value)]
}

function normalizeSearchValue(value: string): string {
  return value.toLowerCase().trim()
}

function compactSearchValue(value: string): string {
  return normalizeSearchValue(value).replace(/[^a-z0-9]+/g, '')
}

function hasFuzzyMatch(haystack: string, needle: string): boolean {
  const normalizedHaystack = normalizeSearchValue(haystack)
  const normalizedNeedle = normalizeSearchValue(needle)
  if (!normalizedNeedle) return true
  if (normalizedHaystack.includes(normalizedNeedle)) return true

  const compactHaystack = compactSearchValue(haystack)
  const compactNeedle = compactSearchValue(needle)
  if (compactNeedle && compactHaystack.includes(compactNeedle)) return true

  const fuse = new Fuse(
    [
      { value: normalizedHaystack },
      { value: compactHaystack },
    ],
    {
      keys: ['value'],
      threshold: 0.4,
      ignoreLocation: true,
      minMatchCharLength: compactNeedle.length === 1 ? 1 : 2,
    }
  )

  return fuse.search(normalizedNeedle).length > 0 || (compactNeedle.length > 0 && fuse.search(compactNeedle).length > 0)
}

function getLegacySearchableCardText(card: Pick<Card, 'content' | 'id' | 'assignee' | 'labels'>): string {
  return [card.content, card.id, card.assignee, ...card.labels]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('\n')
}

/**
 * Builds a searchable string for a card from the legacy text fields plus any
 * metadata values. This is primarily used by fuzzy search so that metadata
 * values participate in the same storage-agnostic matching path.
 *
 * @param card - Card to extract searchable text from.
 * @returns A newline-delimited search corpus for the card.
 */
export function getSearchableCardText(card: Pick<Card, 'content' | 'id' | 'assignee' | 'labels' | 'metadata'>): string {
  const metadataValues = collectMetadataValues(card.metadata)
  return [getLegacySearchableCardText(card), ...metadataValues]
    .filter(value => value.length > 0)
    .join('\n')
}

/**
 * Returns `true` when the query matches one of the legacy free-text search
 * fields (`content`, `id`, `assignee`, `labels`) using case-insensitive
 * substring matching.
 *
 * @param card - Card to test.
 * @param query - Plain-text query without `meta.*` tokens.
 * @returns `true` when the query matches any legacy text field.
 */
export function matchesExactTextSearch(
  card: Pick<Card, 'content' | 'id' | 'assignee' | 'labels'>,
  query: string
): boolean {
  const needle = normalizeSearchValue(query)
  if (!needle) return true
  return getLegacySearchableCardText(card).toLowerCase().includes(needle)
}

/**
 * Returns `true` when the query matches the card's searchable text using a
 * Fuse-powered fuzzy matcher. Metadata values are included in the searchable
 * corpus so fuzzy mode can find metadata without storage-specific indexing.
 *
 * @param card - Card to test.
 * @param query - Plain-text query without `meta.*` tokens.
 * @returns `true` when fuzzy search matches the card.
 */
export function matchesFuzzyTextSearch(
  card: Pick<Card, 'content' | 'id' | 'assignee' | 'labels' | 'metadata'>,
  query: string
): boolean {
  const needle = normalizeSearchValue(query)
  if (!needle) return true
  return hasFuzzyMatch(getSearchableCardText(card), query)
}

/**
 * Returns `true` if every entry in `filter` matches the card's metadata using
 * case-insensitive substring matching on the string representation of each resolved value.
 * When `fuzzy` is enabled, Fuse.js is used as an opt-in fallback for the same
 * field-scoped values while keeping the filters AND-based.
 * Returns `false` immediately when `metadata` is `undefined`.
 *
 * Multiple filter entries are combined with AND logic — all must match for the
 * function to return `true`.
 *
 * @param metadata - The card's `metadata` field (may be `undefined`).
 * @param filter - Map of dot-notation paths to required substrings.
 *   e.g. `{ 'sprint': 'Q1', 'links.jira': 'PROJ' }`
 * @returns `true` if all filter entries match, `false` otherwise.
 *
 * @example
 * matchesMetaFilter({ sprint: '2026-Q1' }, { sprint: 'Q1' })
 * // => true  (case-insensitive substring)
 *
 * matchesMetaFilter({ links: { jira: 'PROJ-123' } }, { 'links.jira': 'PROJ' })
 * // => true  (nested dot-notation)
 *
 * matchesMetaFilter(undefined, { sprint: 'Q1' })
 * // => false
 */
export function matchesMetaFilter(
  metadata: Record<string, any> | undefined,
  filter: Record<string, string>,
  fuzzy = false
): boolean {
  if (Object.keys(filter).length === 0) return true
  if (!metadata) return false
  for (const [path, needle] of Object.entries(filter)) {
    const value = getNestedValue(metadata, path)
    if (value == null) return false
    const valueText = String(value)
    if (!valueText.toLowerCase().includes(needle.toLowerCase()) && (!fuzzy || !hasFuzzyMatch(valueText, needle))) return false
  }
  return true
}

/**
 * Evaluates a card against an optional free-text query and metadata filters.
 * Metadata tokens embedded inside `searchQuery` are merged with `metaFilter`
 * and remain AND-based plus field-scoped in both exact and fuzzy modes.
 *
 * Exact mode is the default and preserves the existing substring semantics.
 * Fuzzy mode is opt-in and extends plain-text matching to metadata values.
 *
 * @param card - Card to test.
 * @param searchQuery - Optional raw search query, including `meta.field: value` tokens.
 * @param metaFilter - Optional explicit metadata filters supplied outside the query string.
 * @param fuzzy - When `true`, enables Fuse-powered fuzzy matching.
 * @returns `true` when the card satisfies both metadata and free-text constraints.
 */
export function matchesCardSearch(
  card: Pick<Card, 'content' | 'id' | 'assignee' | 'labels' | 'metadata'>,
  searchQuery?: string,
  metaFilter: Record<string, string> = {},
  fuzzy = false
): boolean {
  const { metaFilter: parsedMetaFilter, plainText } = parseSearchQuery(searchQuery || '')
  const combinedMetaFilter = { ...metaFilter, ...parsedMetaFilter }

  if (!matchesMetaFilter(card.metadata, combinedMetaFilter, fuzzy)) return false
  if (!plainText) return true

  return fuzzy
    ? matchesFuzzyTextSearch(card, plainText)
    : matchesExactTextSearch(card, plainText)
}
