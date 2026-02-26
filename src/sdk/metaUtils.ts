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

/**
 * Returns `true` if every entry in `filter` matches the card's metadata using
 * case-insensitive substring matching on the string representation of each resolved value.
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
  filter: Record<string, string>
): boolean {
  if (!metadata) return false
  for (const [path, needle] of Object.entries(filter)) {
    const value = getNestedValue(metadata, path)
    if (value == null) return false
    if (!String(value).toLowerCase().includes(needle.toLowerCase())) return false
  }
  return true
}
