import type { CardSortOption } from '../shared/types'

// Re-exported here for existing standalone callers; the canonical definition
// lives in `../shared/cardFrontmatter` so the VSCode extension and other
// transports can use the same projection without a layer violation.
export { buildCardFrontmatter } from '../shared/cardFrontmatter'

export function parseSubmitData(value: unknown): Record<string, unknown> {
  if (value === undefined) return {}
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  throw new Error('data must be an object')
}

export function getSubmitErrorStatus(err: unknown): number {
  const message = String(err)
  return message.includes('Card not found') || message.includes('Form not found') ? 404 : 400
}

export function getListCardsOptions(searchParams: URLSearchParams): {
  metaFilter?: Record<string, string>
  sort?: CardSortOption
  searchQuery?: string
  fuzzy?: boolean
} {
  const metaFilter: Record<string, string> = {}
  for (const [param, value] of searchParams.entries()) {
    if (param.startsWith('meta.')) metaFilter[param.slice(5)] = value
  }

  const sort = searchParams.get('sort') as CardSortOption | null
  const searchQuery = searchParams.get('q')?.trim() || undefined
  const fuzzyParam = searchParams.get('fuzzy')

  return {
    metaFilter: Object.keys(metaFilter).length > 0 ? metaFilter : undefined,
    sort: sort || undefined,
    searchQuery,
    fuzzy: fuzzyParam?.toLowerCase() === 'true' ? true : undefined,
  }
}
