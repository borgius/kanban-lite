import type { Card, CardFrontmatter } from './types'

/**
 * Builds the `CardFrontmatter` projection sent to webview and HTTP clients.
 *
 * Shared across transports (standalone broadcasts, HTTP task routes, and
 * the VSCode extension webview) so the over-the-wire card shape stays
 * consistent.
 *
 * `tasks` is intentionally omitted from the base projection because
 * checklist visibility is caller-scoped: callers add `tasks` explicitly
 * only when the caller has permission to show the checklist.
 *
 * Per the `CardFrontmatter` contract, `version` defaults to `0` for
 * legacy (pre-versioning) cards that lack the field on disk.
 */
export function buildCardFrontmatter(card: Card): CardFrontmatter {
  return {
    version: card.version ?? 0,
    id: card.id,
    status: card.status,
    priority: card.priority,
    assignee: card.assignee,
    dueDate: card.dueDate,
    created: card.created,
    modified: card.modified,
    completedAt: card.completedAt,
    labels: card.labels,
    attachments: card.attachments,
    tasks: card.tasks,
    order: card.order,
    metadata: card.metadata,
    actions: card.actions,
    forms: card.forms,
    formData: card.formData,
  }
}
