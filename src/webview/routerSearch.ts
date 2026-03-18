export interface RouteSearch {
  priority?: string
  labels?: string
  assignee?: string
  dueDate?: string
  q?: string
  fuzzy?: string
}

function normalizeRouteSearchValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return String(value)
  return undefined
}

export function parseRouteBoolean(value: unknown): boolean | undefined {
  const normalized = normalizeRouteSearchValue(value)?.trim().replace(/^"(.*)"$/, '$1').toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  return undefined
}

export function validateSearch(search: Record<string, unknown>): RouteSearch {
  return {
    priority: normalizeRouteSearchValue(search.priority),
    labels: normalizeRouteSearchValue(search.labels),
    assignee: normalizeRouteSearchValue(search.assignee),
    dueDate: normalizeRouteSearchValue(search.dueDate),
    q: normalizeRouteSearchValue(search.q),
    fuzzy: normalizeRouteSearchValue(search.fuzzy),
  }
}

export function buildSearchStr(search: RouteSearch): string {
  return JSON.stringify({
    ...(search.priority && { priority: search.priority }),
    ...(search.labels && { labels: search.labels }),
    ...(search.assignee && { assignee: search.assignee }),
    ...(search.dueDate && { dueDate: search.dueDate }),
    ...(search.q && { q: search.q }),
    ...(search.fuzzy && { fuzzy: search.fuzzy }),
  })
}
