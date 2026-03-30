import type { Card } from '../shared/types';
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
export declare function getNestedValue(obj: Record<string, unknown>, path: string): unknown;
export interface ParsedSearchQuery {
    metaFilter: Record<string, string>;
    plainText: string;
}
/**
 * Parses `meta.field: value` tokens out of a free-text query string.
 * The returned metadata filter uses dot-notation paths and preserves the
 * existing token syntax used by the webview search bar.
 *
 * @param query - Raw search query containing optional `meta.field: value` tokens.
 * @returns Extracted metadata filters plus the remaining plain-text query.
 */
export declare function parseSearchQuery(query: string): ParsedSearchQuery;
/**
 * Builds a searchable string for a card from the legacy text fields plus any
 * metadata values. This is primarily used by fuzzy search so that metadata
 * values participate in the same storage-agnostic matching path.
 *
 * @param card - Card to extract searchable text from.
 * @returns A newline-delimited search corpus for the card.
 */
export declare function getSearchableCardText(card: Pick<Card, 'content' | 'id' | 'assignee' | 'labels' | 'metadata'>): string;
/**
 * Returns `true` when the query matches one of the legacy free-text search
 * fields (`content`, `id`, `assignee`, `labels`) using case-insensitive
 * substring matching.
 *
 * @param card - Card to test.
 * @param query - Plain-text query without `meta.*` tokens.
 * @returns `true` when the query matches any legacy text field.
 */
export declare function matchesExactTextSearch(card: Pick<Card, 'content' | 'id' | 'assignee' | 'labels'>, query: string): boolean;
/**
 * Returns `true` when the query matches the card's searchable text using a
 * Fuse-powered fuzzy matcher. Metadata values are included in the searchable
 * corpus so fuzzy mode can find metadata without storage-specific indexing.
 *
 * @param card - Card to test.
 * @param query - Plain-text query without `meta.*` tokens.
 * @returns `true` when fuzzy search matches the card.
 */
export declare function matchesFuzzyTextSearch(card: Pick<Card, 'content' | 'id' | 'assignee' | 'labels' | 'metadata'>, query: string): boolean;
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
export declare function matchesMetaFilter(metadata: Record<string, unknown> | undefined, filter: Record<string, string>, fuzzy?: boolean): boolean;
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
export declare function matchesCardSearch(card: Pick<Card, 'content' | 'id' | 'assignee' | 'labels' | 'metadata'>, searchQuery?: string, metaFilter?: Record<string, string>, fuzzy?: boolean): boolean;
