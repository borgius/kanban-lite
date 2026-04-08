import type { Card, CardFormAttachment, CardFormDataMap, ResolvedFormDescriptor } from '../../shared/types'

export interface SubmitFormInput {
  /** Card ID that owns the target attached form. */
  cardId: string
  /** Resolved form identifier (named config form id or inline generated id). */
  formId: string
  /** Submitted field values merged over the resolved base payload before validation. */
  data: Record<string, unknown>
  /** Optional board ID. Defaults to the workspace default board. */
  boardId?: string
}

export interface SubmitFormResult {
  /** Board that owns the submitted card/form. */
  boardId: string
  /** Sanitized persisted card snapshot after the successful form update. */
  card: Omit<Card, 'filePath'>
  /** Resolved form descriptor used for validation and downstream context. */
  form: ResolvedFormDescriptor
  /** Final validated payload that was persisted to `card.formData[form.id]`. */
  data: Record<string, unknown>
}

export type FormSubmitEvent = SubmitFormResult

/**
 * Strips the `filePath` property from a card before exposing it
 * in webhook payloads or API responses. The file path is an internal
 * implementation detail that should not be leaked externally.
 *
 * @param card - The card object to sanitize.
 * @returns A copy of the card without the `filePath` field.
 *
 * @example
 * const safe = sanitizeCard(card)
 * // safe.filePath is undefined
 */
export function sanitizeCard(card: Card): Omit<Card, 'filePath'> {
  const { filePath, ...rest } = card
  void filePath
  return rest
}

// ---------------------------------------------------------------------------
// Auth context, decision, and error vocabulary
// ---------------------------------------------------------------------------

/**
 * Canonical machine-readable auth error categories.
 *
 * Consumed by {@link AuthError} and {@link AuthDecision.reason} so that host
 * surfaces (HTTP API, CLI, MCP, extension) can map denial semantics to their
 * own error codes (e.g. HTTP 401 vs 403) without parsing error messages.
 */
