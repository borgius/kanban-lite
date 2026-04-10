import { main } from './mcp-main'

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`MCP Server error: ${message}`)
  process.exit(1)
})
