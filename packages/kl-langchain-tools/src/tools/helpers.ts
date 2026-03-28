/** Extracts the display title from card markdown content. */
export function extractTitle(content: string | undefined): string {
  return content?.split('\n')[0]?.replace(/^#\s*/, '') ?? ''
}
