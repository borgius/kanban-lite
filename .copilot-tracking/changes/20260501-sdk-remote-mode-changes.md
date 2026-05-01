# Changes: SDK Remote Mode (API URL + Token)

## Summary

Added `RemoteKanbanSDK` — a new class that transparently proxies all SDK
operations to a remote kanban-lite REST API. Clients can connect to a running
server from any environment (browser, CI, agent) without local filesystem
access.

## New Files

- [packages/kanban-lite/src/sdk/remote/RemoteKanbanSDK.ts](../../packages/kanban-lite/src/sdk/remote/RemoteKanbanSDK.ts)
  — Main class. Constructor: `{ remoteUrl: string; token?: string }`. Implements
  card, board, comment, checklist, and attachment operations via `fetch` against
  the kanban-lite REST API. Event bus proxy methods mirror `KanbanSDKCore`.

- [packages/kanban-lite/src/sdk/remote/index.ts](../../packages/kanban-lite/src/sdk/remote/index.ts)
  — Barrel re-export for the `remote/` module.

## Modified Files

- [packages/kanban-lite/src/sdk/index.ts](../../packages/kanban-lite/src/sdk/index.ts)
  — Added `export { RemoteKanbanSDK } from './remote'` so it is importable as
  `import { RemoteKanbanSDK } from 'kanban-lite/sdk'`.

- [packages/kanban-lite/src/sdk/types/events.ts](../../packages/kanban-lite/src/sdk/types/events.ts)
  — Added `remoteUrl?: string` and `token?: string` fields to `SDKOptions` with
  JSDoc directing users to `RemoteKanbanSDK`.

- [packages/kanban-lite/src/sdk/KanbanSDK-core.ts](../../packages/kanban-lite/src/sdk/KanbanSDK-core.ts)
  — Added early guard in constructor: throws when `options.remoteUrl` is set,
  directing users to `RemoteKanbanSDK`.

- [docs/sdk.md](../../docs/sdk.md)
  — Added `RemoteKanbanSDK` section covering construction, quick-start, board
  operations, null-returning stubs, and the `SDKOptions` guard.

## Phase Completion

- [x] Phase 1: Core HTTP client and card operations
- [x] Phase 2: Board and auxiliary operations
- [x] Phase 3: Exports and SDK options
- [ ] Phase 4: Validation (TypeScript check)
