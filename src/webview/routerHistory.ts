/**
 * Standalone mode injects an `acquireVsCodeApi()` shim for message parity, so
 * history selection must be based on the actual page protocol rather than the
 * presence of that global alone.
 */
export function shouldUseMemoryHistory(protocol: string): boolean {
  return protocol !== 'http:' && protocol !== 'https:'
}
