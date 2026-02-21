# Kanban Markdown - Development Guide

A VSCode extension + standalone server + CLI + MCP server for managing kanban boards stored as markdown files.

## Architecture

```
src/
  sdk/           # Core SDK (no external dependencies) - KanbanSDK class
  shared/        # Shared types (Feature, KanbanColumn, CardDisplaySettings) and config module
  cli/           # CLI tool (built on SDK)
  mcp-server/    # MCP server (built on SDK + config + webhooks)
  extension/     # VSCode extension
  standalone/    # HTTP server with REST API + WebSocket + file watcher
  webview/       # React frontend (shared by extension + standalone)
```

## Key Files

- `src/sdk/KanbanSDK.ts` - Core card/column CRUD operations
- `src/sdk/parser.ts` - Markdown frontmatter parsing and serialization
- `src/shared/types.ts` - All TypeScript types and enums
- `src/shared/config.ts` - `.kanban.json` config read/write, settings conversion
- `src/standalone/server.ts` - HTTP server with all REST API routes + WebSocket
- `src/standalone/webhooks.ts` - Webhook CRUD and delivery
- `src/cli/index.ts` - All CLI commands
- `src/mcp-server/index.ts` - All MCP tool definitions

## Build

```bash
npm run build              # Build everything
npm run build:cli          # CLI only
npm run build:mcp          # MCP server only
npm run build:standalone-server  # HTTP server only
npx tsc --noEmit           # Type-check
npm test                   # Run tests (vitest)
```

## Feature Parity

All three interfaces (API, CLI, MCP) support the same operations: cards CRUD, columns CRUD, settings get/update, webhooks CRUD, workspace info. When adding new functionality, add it to all three.

## Data Storage

- Cards: `.kanban/{status}/card-name-YYYY-MM-DD.md` (markdown with YAML frontmatter)
- Config: `.kanban.json` (columns, display settings)
- Webhooks: `.kanban-webhooks.json`
- SDK board config: `.kanban/board.json` (used by SDK for column management)

## Conventions

- Card IDs are auto-generated from title + date
- Partial ID matching is supported across all interfaces
- Fractional indexing (base-62) for card ordering within columns
- `completedAt` is auto-managed when status changes to/from `done`
- `modified` timestamp is auto-updated on any change
- The standalone server uses synchronous `fs` operations; the SDK uses async `fs/promises`
