<!-- markdownlint-disable-file -->

# Research: SDK Remote Mode — API URL + Token Transparent Proxy

## Summary

When a client provides `remoteUrl` (and optionally `token`) to the SDK, all
operations should be transparently routed to the remote kanban-lite REST API
instead of the local filesystem/DB, with an identical public interface.

---

## 1. Codebase Structure Analysis

### 1.1 SDK Class Hierarchy

The SDK is composed via a chain of class inheritance. All classes live under
`packages/kanban-lite/src/sdk/`:

```
KanbanSDKCore          KanbanSDK-core.ts      — constructor, event bus, auth ALS
  └─ KanbanSDKStatus   KanbanSDK-status.ts    — diagnostics, plugin settings CRUD
      └─ KanbanSDKCardState  KanbanSDK-card-state.ts — unread, mark opened/read
          └─ KanbanSDKBoards KanbanSDK-boards.ts  — init, boards, columns, settings
              └─ KanbanSDKCards KanbanSDK-cards.ts — card CRUD (list/get/create/update)
                  └─ KanbanSDKData KanbanSDK-data.ts — labels, attachments, comments, logs
                      └─ KanbanSDK  KanbanSDK.ts       — main export (barrel only)
```

### 1.2 Two Persistence Layers

All SDK operations use one or both of these layers:

**Layer A — StorageEngine** (`packages/kanban-lite/src/sdk/plugins/types.ts` L1–L80)
- Interface: `scanCards`, `writeCard`, `moveCard`, `renameCard`, `deleteCard`, `getCardById`, `ensureBoardDirs`, `deleteBoardData`, `copyAttachment`, `getCardDir`
- Used by: card CRUD, comments, logs, attachments
- Accessed via `ctx._storage`

**Layer B — Config file reads/writes** (via `readConfig`/`writeConfig` from `packages/kanban-lite/src/shared/config.ts`)
- Used by: board management, labels, settings, column CRUD
- All calls use `ctx.workspaceRoot` path and read/write `.kanban.json`
- Example: `packages/kanban-lite/src/sdk/modules/boards.ts` L22: `readConfig(ctx.workspaceRoot)`

### 1.3 SDKOptions Interface

**File**: `packages/kanban-lite/src/sdk/types/events.ts` L388–L440

Current fields:
- `onEvent?: SDKEventHandler`
- `storage?: StorageEngine`
- `storageEngine?: StorageEngineType`
- `sqlitePath?: string`
- `capabilities?: CapabilitySelections`
- `pluginInstallRunner?` (internal testing seam)

### 1.4 SDKContext Interface

**File**: `packages/kanban-lite/src/sdk/modules/context.ts` L1–L60

`SDKContext` is the internal interface that all module functions receive. It
exposes:
- `workspaceRoot: string`
- `kanbanDir: string`
- `_storage: StorageEngine`
- `capabilities: ResolvedCapabilityBag | null`
- `_resolveBoardId()`, `_boardDir()`, `_ensureMigrated()`
- High-level method refs: `listCards()`, `getCard()`, etc.

The SDK's `this` satisfies `SDKContext` (cast in `KanbanSDKBoards._ctx`).

### 1.5 Constructor Flow (KanbanSDKCore)

**File**: `packages/kanban-lite/src/sdk/KanbanSDK-core.ts` L131+

1. Resolves `kanbanDir` (auto-detect or argument)
2. `loadWorkspaceEnv(path.dirname(kanbanDir))` — loads `.env` from workspace root
3. If `options.storage` is provided → skip capability resolution, use directly
4. Otherwise → `readBootstrapConfig()` + `resolveCapabilityBag()` → sets `this._storage`

**Key insight**: The constructor can be bypassed by passing `options.storage`.
However, it still calls `loadWorkspaceEnv` and sets `this.kanbanDir`, which
would fail if there's no local workspace.

### 1.6 Export Barrel

**File**: `packages/kanban-lite/src/sdk/index.ts` L1–60

All public types and classes are re-exported here. New exports must be added
to this file.

---

## 2. REST API Surface (Remote Endpoints)

**Base**: `http://<host>/api`  
**Auth**: `Authorization: Bearer <token>` header  
**Envelope**: `{ ok: true, data: {...} }` / `{ ok: false, error: "..." }`

Source: `packages/kanban-lite/src/standalone/internal/routes/`

### Cards (tasks)
| Method | Path | SDK method |
|--------|------|-----------|
| GET | `/api/tasks` | `listCards()` |
| POST | `/api/tasks` | `createCard()` |
| GET | `/api/tasks/:id` | `getCard()` |
| PATCH | `/api/tasks/:id` | `updateCard()` |
| DELETE | `/api/tasks/:id` | `deleteCard()` |
| POST | `/api/tasks/:id/move` | `moveCard()` |
| GET | `/api/tasks/:id/comments` | `listComments()` |
| POST | `/api/tasks/:id/comments` | `addComment()` |
| PATCH | `/api/tasks/:id/comments/:cid` | `updateComment()` |
| DELETE | `/api/tasks/:id/comments/:cid` | `deleteComment()` |
| GET | `/api/tasks/:id/checklist` | (checklist read) |
| POST | `/api/tasks/:id/checklist` | `addChecklistItem()` |
| PATCH | `/api/tasks/:id/checklist/:idx` | `editChecklistItem()` |
| DELETE | `/api/tasks/:id/checklist/:idx` | `deleteChecklistItem()` |
| POST | `/api/tasks/:id/checklist/:idx/check` | `checkChecklistItem()` |
| DELETE | `/api/tasks/:id/checklist/:idx/check` | `uncheckChecklistItem()` |

Board-scoped variants use prefix `/api/boards/:boardId/tasks/*`.

### Boards
| Method | Path | SDK method |
|--------|------|-----------|
| GET | `/api/boards` | `listBoards()` |
| POST | `/api/boards` | `createBoard()` |
| GET | `/api/boards/:id` | `getBoard()` |
| PUT | `/api/boards/:id` | `updateBoard()` |
| DELETE | `/api/boards/:id` | `deleteBoard()` |

### System
| Method | Path | SDK method |
|--------|------|-----------|
| GET | `/api/health` | (status) |
| GET | `/api/tasks/active` | `getActiveCard()` |

### Attachments
| Method | Path | SDK method |
|--------|------|-----------|
| POST | `/api/tasks/:id/attachments` | `addAttachment()` |
| DELETE | `/api/tasks/:id/attachments/:name` | `removeAttachment()` |
| GET | `/api/tasks/:id/attachments/:name` | `getAttachmentData()` |

### Comments
Already listed under Cards section above.

---

## 3. Implementation Approach

### 3.1 Why Not Override StorageEngine Only

`StorageEngine` only covers card-level I/O. Board operations read
`.kanban.json` via `readConfig(ctx.workspaceRoot)` — there is no `.kanban.json`
in the client's local filesystem when operating remotely.

### 3.2 Chosen Approach: `RemoteKanbanSDK` standalone class

Create a new class `RemoteKanbanSDK` in
`packages/kanban-lite/src/sdk/remote/RemoteKanbanSDK.ts` that:

1. Does NOT inherit from `KanbanSDKCore` (avoids local FS init)
2. Implements the same public interface as `KanbanSDK`
3. Has a simple constructor: `{ remoteUrl: string; token?: string }`
4. Uses the global `fetch` API with `Authorization: Bearer <token>`
5. Parses the `{ ok, data, error }` response envelope
6. Throws errors matching the format local SDK throws (e.g. `Error('Card not found')`)

### 3.3 SDKOptions Extension (complementary)

Also add `remoteUrl?: string` and `token?: string` to `SDKOptions` for
documentation discoverability — the constructor will throw a clear error
directing users to `RemoteKanbanSDK` when these are set (avoids silent FS init).

### 3.4 Key Methods to Implement

Prioritised by common SDK usage patterns:

**Phase 1 — Core card operations**:
- `init()` → `GET /api/health` (validates connectivity)
- `listCards(columns?, boardId?)` → `GET /api/tasks?boardId=&columns=`
- `getCard(cardId, boardId?)` → `GET /api/tasks/:id?boardId=`
- `createCard(input)` → `POST /api/tasks`
- `updateCard(cardId, updates, boardId?)` → `PATCH /api/tasks/:id`
- `deleteCard(cardId, boardId?)` → `DELETE /api/tasks/:id`
- `moveCard(cardId, newStatus, boardId?)` → `POST /api/tasks/:id/move`

**Phase 2 — Board operations**:
- `listBoards()` → `GET /api/boards`
- `getBoard(boardId)` → `GET /api/boards/:id`
- `createBoard(id, name, options?)` → `POST /api/boards`
- `updateBoard(boardId, updates)` → `PUT /api/boards/:id`
- `deleteBoard(boardId)` → `DELETE /api/boards/:id`

**Phase 3 — Comments, attachments, checklist**:
- `listComments(cardId, boardId?)` → `GET /api/tasks/:id/comments`
- `addComment(cardId, author, content, boardId?)` → `POST /api/tasks/:id/comments`
- `updateComment(cardId, commentId, content, boardId?)` → `PATCH /api/tasks/:id/comments/:cid`
- `deleteComment(cardId, commentId, boardId?)` → `DELETE /api/tasks/:id/comments/:cid`
- `addChecklistItem(...)` → `POST /api/tasks/:id/checklist`
- `addAttachment(...)` → multipart `POST /api/tasks/:id/attachments`
- `removeAttachment(...)` → `DELETE /api/tasks/:id/attachments/:name`
- `getAttachmentData(...)` → `GET /api/tasks/:id/attachments/:name`

**Phase 4 — Stub/no-op stubs with clear errors**:
- `getLocalCardPath()` → always `null` (no local files in remote mode)
- `getAttachmentStoragePath()` → always `null`
- `materializeAttachment()` → always `null`
- `transferCard()` → proxy to `POST /api/tasks/:id/move` with `targetBoard` param
- Event bus (`on`, `once`, `off`, `onAny`, `waitFor`) → kept as local EventBus

---

## 4. File Locations

### New files
- `packages/kanban-lite/src/sdk/remote/RemoteKanbanSDK.ts` — main class
- `packages/kanban-lite/src/sdk/remote/index.ts` — barrel re-export

### Modified files
- `packages/kanban-lite/src/sdk/types/events.ts` — add `remoteUrl?`, `token?` to `SDKOptions`
- `packages/kanban-lite/src/sdk/index.ts` — export `RemoteKanbanSDK`

---

## 5. Patterns and Conventions

### 5.1 HTTP Helper

```typescript
// Internal helper inside RemoteKanbanSDK
private async _request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${this._remoteUrl}${path}`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (this._token) headers['Authorization'] = `Bearer ${this._token}`
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const json = await res.json() as { ok: boolean; data?: T; error?: string }
  if (!json.ok) throw new Error(json.error ?? `Remote API error ${res.status}`)
  return json.data as T
}
```

### 5.2 Error mapping

The REST API returns `{ ok: false, error: "Task not found" }` for 404s.
`RemoteKanbanSDK` propagates these as plain `Error` with the message, matching
what local SDK throws: `throw new Error('Card not found: <id>')`.

### 5.3 Board-scoped helpers

Most card methods accept an optional `boardId`. When present, use the board-scoped
path prefix `/api/boards/:boardId/tasks/...` instead of `/api/tasks/...`.

### 5.4 Node.js compatibility

The global `fetch` is available from Node.js 18+ (matches repo's stated minimum).
No polyfill needed.

### 5.5 AGENTS.md rules

- No file > 600 lines; `RemoteKanbanSDK.ts` must be split if it grows too large
- SDK is source of truth — `RemoteKanbanSDK` exports follow existing type names
- Keep `index.ts` as barrel only; no logic there

---

## 6. Success Indicators

- `new RemoteKanbanSDK({ remoteUrl: 'http://localhost:3000', token: 'tok' })` constructs
  without any local filesystem access
- `await sdk.listCards()` returns the same `Card[]` shape as local SDK
- `await sdk.createCard({ content: '# Hello' })` creates a card via REST
- TypeScript: no new TS errors (`pnpm exec tsc --noEmit`)
- Existing tests still pass (`nr test`)
