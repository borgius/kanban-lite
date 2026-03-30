/**
 * Singleton queue that batches card-state requests triggered by IntersectionObserver
 * observations in CardItem components, then flushes them as a single `getCardStates`
 * WebSocket message after a short debounce.
 *
 * Cards whose `cardState` is already populated are skipped — they were either
 * decorated by a broadcast init or already fetched by an earlier viewport event.
 */
import { getVsCodeApi } from './vsCodeApi'

const DEBOUNCE_MS = 80

let pendingIds: Set<string> = new Set()
let flushTimer: ReturnType<typeof setTimeout> | null = null

function flush() {
  flushTimer = null
  if (pendingIds.size === 0) return
  const cardIds = Array.from(pendingIds)
  pendingIds = new Set()
  getVsCodeApi().postMessage({ type: 'getCardStates', cardIds })
}

/**
 * Enqueue a card ID for a batched `getCardStates` request.
 * Safe to call many times per frame — the flush is debounced.
 */
export function enqueueCardStateRequest(cardId: string): void {
  pendingIds.add(cardId)
  if (flushTimer !== null) clearTimeout(flushTimer)
  flushTimer = setTimeout(flush, DEBOUNCE_MS)
}
