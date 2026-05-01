<!-- markdownlint-disable-file -->

# Task Details: SDK Remote Mode (API URL + Token)

## Research Reference

**Source Research**: #file:../research/20260501-sdk-remote-mode-research.md

---

## Phase 1: Core HTTP client and card operations

### Task 1.1: Create `remote/` directory and `RemoteKanbanSDK.ts` skeleton

Create `packages/kanban-lite/src/sdk/remote/RemoteKanbanSDK.ts` with:

- Class `RemoteKanbanSDK` (does NOT extend `KanbanSDKCore`)
- Constructor signature: `constructor(options: { remoteUrl: string; token?: string })`
  - Strips trailing slash from `remoteUrl`, stores as `this._remoteUrl`
  - Stores `options.token` as `this._token`
  - Constructs a local `EventBus` instance for the event proxy API
- Internal helper `_request<T>(method, path, body?)`: uses global `fetch`, adds
  `Authorization: Bearer <token>` header when token is present, parses
  `{ ok, data, error }` envelope, throws `Error(json.error)` on failure
- Public property `readonly kanbanDir: string = ''` (sentinel for remote mode)
- Public property `readonly workspaceRoot: string = ''`

```typescript
import type { Card, BoardInfo, Comment, LogEntry, KanbanColumn, Priority, LabelDefinition } from "../../shared/types"
import type { CreateCardInput } from "../types"
import { EventBus } from "../eventBus"

export class RemoteKanbanSDK {
  private readonly _remoteUrl: string
  private readonly _token: string | undefined
  private readonly _eventBus: EventBus

  readonly kanbanDir: string = ""
  readonly workspaceRoot: string = ""

  constructor(options: { remoteUrl: string; token?: string }) {
    this._remoteUrl = options.remoteUrl.replace(/\/$/, "")
    this._token = options.token
    this._eventBus = new EventBus()
  }

  private async _request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this._remoteUrl}${path}`
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (this._token) headers["Authorization"] = `Bearer ${this._token}`
    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const json = (await res.json()) as { ok: boolean; data?: T; error?: string }
    if (!json.ok) throw new Error(json.error ?? `Remote API error ${res.status}`)
    return json.data as T
  }
}
```

- **Files**:
  - `packages/kanban-lite/src/sdk/remote/RemoteKanbanSDK.ts` - New file, class skeleton
- **Success**:
  - File exists and compiles with no errors
  - Constructor does not read any filesystem path
- **Research References**:
  - #file:../research/20260501-sdk-remote-mode-research.md (Lines 100–160) - Implementation approach and HTTP helper pattern
- **Dependencies**:
  - `EventBus` from `../eventBus`

---

### Task 1.2: Implement core card methods

Add to `RemoteKanbanSDK`:

```typescript
async init(): Promise<void> {
  await this._request<unknown>("GET", "/api/health")
}

async listCards(columns?: string[], boardId?: string): Promise<Card[]> {
  const params = new URLSearchParams()
  if (boardId) params.set("boardId", boardId)
  if (columns?.length) params.set("columns", columns.join(","))
  const qs = params.toString()
  const base = boardId ? `/api/boards/${encodeURIComponent(boardId)}/tasks` : "/api/tasks"
  const path = qs ? `${base}?${qs}` : base
  return this._request<Card[]>("GET", path)
}

async getCard(cardId: string, boardId?: string): Promise<Card | null> {
  try {
    const base = boardId
      ? `/api/boards/${encodeURIComponent(boardId)}/tasks`
      : "/api/tasks"
    return await this._request<Card>("GET", `${base}/${encodeURIComponent(cardId)}`)
  } catch (err) {
    if (err instanceof Error && err.message.includes("not found")) return null
    throw err
  }
}

async createCard(input: CreateCardInput): Promise<Card> {
  return this._request<Card>("POST", "/api/tasks", input)
}

async updateCard(cardId: string, updates: Partial<CreateCardInput>, boardId?: string): Promise<Card> {
  const base = boardId
    ? `/api/boards/${encodeURIComponent(boardId)}/tasks`
    : "/api/tasks"
  return this._request<Card>("PATCH", `${base}/${encodeURIComponent(cardId)}`, updates)
}

async deleteCard(cardId: string, boardId?: string): Promise<void> {
  const base = boardId
    ? `/api/boards/${encodeURIComponent(boardId)}/tasks`
    : "/api/tasks"
  await this._request<void>("DELETE", `${base}/${encodeURIComponent(cardId)}`)
}

async moveCard(cardId: string, newStatus: string, boardId?: string): Promise<Card> {
  const base = boardId
    ? `/api/boards/${encodeURIComponent(boardId)}/tasks`
    : "/api/tasks"
  return this._request<Card>("POST", `${base}/${encodeURIComponent(cardId)}/move`, { status: newStatus })
}

async getActiveCard(boardId?: string): Promise<Card | null> {
  try {
    const qs = boardId ? `?boardId=${encodeURIComponent(boardId)}` : ""
    return await this._request<Card | null>("GET", `/api/tasks/active${qs}`)
  } catch {
    return null
  }
}
```

- **Files**:
  - `packages/kanban-lite/src/sdk/remote/RemoteKanbanSDK.ts` — add methods
- **Success**:
  - `listCards()` calls `GET /api/tasks`
  - `getCard()` returns `null` when API responds with not-found error
  - `createCard()` passes full `CreateCardInput` as JSON body
- **Research References**:
  - #file:../research/20260501-sdk-remote-mode-research.md (Lines 60–110) - REST endpoint mapping table
- **Dependencies**:
  - Task 1.1 completion

---

### Task 1.3: Implement event bus proxy methods

The local SDK exposes `on`, `once`, `many`, `onAny`, `off`, `offAny`,
`removeAllListeners`, `eventNames`, `listenerCount`, `hasListeners`, `waitFor`
via `this._eventBus`. Mirror these on `RemoteKanbanSDK` using the local
`EventBus` instance so consumers can subscribe to events the SDK fires
internally (e.g. from server-sent events in future, or after write ops).

```typescript
get eventBus() { return this._eventBus }

on(event: string, listener: (...args: unknown[]) => void) {
  this._eventBus.on(event, listener); return this
}
once(event: string, listener: (...args: unknown[]) => void) {
  this._eventBus.once(event, listener); return this
}
off(event: string, listener: (...args: unknown[]) => void) {
  this._eventBus.off(event, listener); return this
}
onAny(listener: (...args: unknown[]) => void) {
  this._eventBus.onAny(listener); return this
}
offAny(listener: (...args: unknown[]) => void) {
  this._eventBus.offAny(listener); return this
}
removeAllListeners(event?: string) {
  this._eventBus.removeAllListeners(event); return this
}
eventNames() { return this._eventBus.eventNames() }
listenerCount(event?: string) { return this._eventBus.listenerCount(event) }
hasListeners(event?: string) { return this._eventBus.hasListeners(event) }
waitFor(event: string, options?: unknown) { return this._eventBus.waitFor(event, options) }
```

- **Files**:
  - `packages/kanban-lite/src/sdk/remote/RemoteKanbanSDK.ts` — add event proxy methods
- **Success**:
  - `sdk.on("task.created", ...)` does not throw
- **Research References**:
  - #file:../research/20260501-sdk-remote-mode-research.md (Lines 165–180) - EventBus usage in KanbanSDKCore
- **Dependencies**:
  - Task 1.1 completion

---

## Phase 2: Board and auxiliary operations

### Task 2.1: Board methods

```typescript
listBoards(): BoardInfo[] {
  // Note: synchronous on local SDK but boards come from config.
  // Remote must be async — return a promise and cast at call sites,
  // or expose as async and document the difference.
  // Use async to stay safe:
  throw new Error("Use listBoardsAsync() for remote SDK — listBoards() is not available in remote mode")
}

async listBoardsAsync(): Promise<BoardInfo[]> {
  return this._request<BoardInfo[]>("GET", "/api/boards")
}

async getBoard(boardId: string): Promise<unknown> {
  return this._request("GET", `/api/boards/${encodeURIComponent(boardId)}`)
}

async createBoard(id: string, name: string, options?: {
  description?: string
  columns?: KanbanColumn[]
  defaultStatus?: string
  defaultPriority?: Priority
}): Promise<BoardInfo> {
  return this._request<BoardInfo>("POST", "/api/boards", { id, name, ...options })
}

async updateBoard(boardId: string, updates: Record<string, unknown>): Promise<unknown> {
  return this._request("PUT", `/api/boards/${encodeURIComponent(boardId)}`, updates)
}

async deleteBoard(boardId: string): Promise<void> {
  await this._request<void>("DELETE", `/api/boards/${encodeURIComponent(boardId)}`)
}
```

**Note on `listBoards()`**: The local `KanbanSDK.listBoards()` is synchronous
(reads from cached config). The remote equivalent must be async. Expose
`listBoardsAsync()` as the async variant and have `listBoards()` throw a clear
error directing users to it.

- **Files**:
  - `packages/kanban-lite/src/sdk/remote/RemoteKanbanSDK.ts` — add board methods
- **Success**:
  - `sdk.listBoardsAsync()` resolves to `BoardInfo[]`
- **Research References**:
  - #file:../research/20260501-sdk-remote-mode-research.md (Lines 85–100) - Board REST endpoints
- **Dependencies**:
  - Task 1.1 completion

---

### Task 2.2: Comment methods

```typescript
async listComments(cardId: string, boardId?: string): Promise<Comment[]> {
  const base = boardId
    ? `/api/boards/${encodeURIComponent(boardId)}/tasks`
    : "/api/tasks"
  return this._request<Comment[]>("GET", `${base}/${encodeURIComponent(cardId)}/comments`)
}

async addComment(cardId: string, author: string, content: string, boardId?: string): Promise<Card> {
  const base = boardId
    ? `/api/boards/${encodeURIComponent(boardId)}/tasks`
    : "/api/tasks"
  return this._request<Card>("POST", `${base}/${encodeURIComponent(cardId)}/comments`, { author, content })
}

async updateComment(cardId: string, commentId: string, content: string, boardId?: string): Promise<Card> {
  const base = boardId
    ? `/api/boards/${encodeURIComponent(boardId)}/tasks`
    : "/api/tasks"
  return this._request<Card>("PATCH", `${base}/${encodeURIComponent(cardId)}/comments/${encodeURIComponent(commentId)}`, { content })
}

async deleteComment(cardId: string, commentId: string, boardId?: string): Promise<Card> {
  const base = boardId
    ? `/api/boards/${encodeURIComponent(boardId)}/tasks`
    : "/api/tasks"
  return this._request<Card>("DELETE", `${base}/${encodeURIComponent(cardId)}/comments/${encodeURIComponent(commentId)}`)
}
```

- **Files**:
  - `packages/kanban-lite/src/sdk/remote/RemoteKanbanSDK.ts` — add comment methods
- **Success**:
  - `sdk.addComment("id-1", "alice", "done")` posts to `/api/tasks/id-1/comments`
- **Research References**:
  - #file:../research/20260501-sdk-remote-mode-research.md (Lines 62–78) - Comment REST endpoints
- **Dependencies**:
  - Task 1.2 completion

---

### Task 2.3: Checklist methods

```typescript
async addChecklistItem(cardId: string, title: string, boardId?: string): Promise<Card> {
  const base = boardId
    ? `/api/boards/${encodeURIComponent(boardId)}/tasks`
    : "/api/tasks"
  return this._request<Card>("POST", `${base}/${encodeURIComponent(cardId)}/checklist`, { title })
}

async editChecklistItem(cardId: string, index: number, title: string, boardId?: string): Promise<Card> {
  const base = boardId
    ? `/api/boards/${encodeURIComponent(boardId)}/tasks`
    : "/api/tasks"
  return this._request<Card>("PATCH", `${base}/${encodeURIComponent(cardId)}/checklist/${index}`, { title })
}

async deleteChecklistItem(cardId: string, index: number, boardId?: string): Promise<Card> {
  const base = boardId
    ? `/api/boards/${encodeURIComponent(boardId)}/tasks`
    : "/api/tasks"
  return this._request<Card>("DELETE", `${base}/${encodeURIComponent(cardId)}/checklist/${index}`)
}

async checkChecklistItem(cardId: string, index: number, boardId?: string): Promise<Card> {
  const base = boardId
    ? `/api/boards/${encodeURIComponent(boardId)}/tasks`
    : "/api/tasks"
  return this._request<Card>("POST", `${base}/${encodeURIComponent(cardId)}/checklist/${index}/check`)
}

async uncheckChecklistItem(cardId: string, index: number, boardId?: string): Promise<Card> {
  const base = boardId
    ? `/api/boards/${encodeURIComponent(boardId)}/tasks`
    : "/api/tasks"
  return this._request<Card>("DELETE", `${base}/${encodeURIComponent(cardId)}/checklist/${index}/check`)
}
```

- **Files**:
  - `packages/kanban-lite/src/sdk/remote/RemoteKanbanSDK.ts` — add checklist methods
- **Success**:
  - Checklist index is passed as a path segment
- **Research References**:
  - #file:../research/20260501-sdk-remote-mode-research.md (Lines 62–80) - Checklist REST endpoints
- **Dependencies**:
  - Task 1.2 completion

---

### Task 2.4: Attachment methods and null-returning stubs

```typescript
async addAttachmentData(cardId: string, filename: string, data: string | Uint8Array, boardId?: string): Promise<Card> {
  const base = boardId
    ? `/api/boards/${encodeURIComponent(boardId)}/tasks`
    : "/api/tasks"
  // Multipart upload
  const form = new FormData()
  const blob = typeof data === "string"
    ? new Blob([data], { type: "text/plain" })
    : new Blob([data], { type: "application/octet-stream" })
  form.append("file", blob, filename)
  const url = `${this._remoteUrl}${base}/${encodeURIComponent(cardId)}/attachments`
  const headers: Record<string, string> = {}
  if (this._token) headers["Authorization"] = `Bearer ${this._token}`
  const res = await fetch(url, { method: "POST", headers, body: form })
  const json = (await res.json()) as { ok: boolean; data?: Card; error?: string }
  if (!json.ok) throw new Error(json.error ?? `Remote API error ${res.status}`)
  return json.data as Card
}

async removeAttachment(cardId: string, attachment: string, boardId?: string): Promise<Card> {
  const base = boardId
    ? `/api/boards/${encodeURIComponent(boardId)}/tasks`
    : "/api/tasks"
  return this._request<Card>("DELETE", `${base}/${encodeURIComponent(cardId)}/attachments/${encodeURIComponent(attachment)}`)
}

async getAttachmentData(cardId: string, filename: string, boardId?: string): Promise<{ data: Uint8Array; contentType?: string } | null> {
  const base = boardId
    ? `/api/boards/${encodeURIComponent(boardId)}/tasks`
    : "/api/tasks"
  const url = `${this._remoteUrl}${base}/${encodeURIComponent(cardId)}/attachments/${encodeURIComponent(filename)}`
  const headers: Record<string, string> = {}
  if (this._token) headers["Authorization"] = `Bearer ${this._token}`
  const res = await fetch(url, { headers })
  if (res.status === 404) return null
  const buf = await res.arrayBuffer()
  return { data: new Uint8Array(buf), contentType: res.headers.get("content-type") ?? undefined }
}

// Stubs that return null — no local filesystem in remote mode
getLocalCardPath(_card: unknown): null { return null }
getAttachmentStoragePath(_card: unknown): null { return null }
async materializeAttachment(_card: unknown, _attachment: string): Promise<null> { return null }
```

- **Files**:
  - `packages/kanban-lite/src/sdk/remote/RemoteKanbanSDK.ts` — add attachment methods and stubs
- **Success**:
  - `getLocalCardPath()` always returns `null`
  - `addAttachmentData()` uses `FormData` multipart, not JSON body
- **Research References**:
  - #file:../research/20260501-sdk-remote-mode-research.md (Lines 90–105) - Attachment REST endpoints
- **Dependencies**:
  - Task 1.1 completion

---

## Phase 3: Exports and SDK options

### Task 3.1: Create `remote/index.ts` barrel

Create `packages/kanban-lite/src/sdk/remote/index.ts`:

```typescript
export { RemoteKanbanSDK } from "./RemoteKanbanSDK"
```

- **Files**:
  - `packages/kanban-lite/src/sdk/remote/index.ts` — new barrel file
- **Success**:
  - `import { RemoteKanbanSDK } from "../remote"` resolves
- **Research References**:
  - #file:../research/20260501-sdk-remote-mode-research.md (Lines 130–135) - File locations
- **Dependencies**:
  - Task 1.1 completion

---

### Task 3.2: Export `RemoteKanbanSDK` from main SDK barrel

In `packages/kanban-lite/src/sdk/index.ts`, add after the existing `KanbanSDK` export line:

```typescript
export { RemoteKanbanSDK } from "./remote"
```

- **Files**:
  - `packages/kanban-lite/src/sdk/index.ts` — add one export line
- **Success**:
  - `import { RemoteKanbanSDK } from "kanban-lite/sdk"` resolves at the TypeScript level
- **Research References**:
  - #file:../research/20260501-sdk-remote-mode-research.md (Lines 130–145) - File locations and barrel pattern
- **Dependencies**:
  - Task 3.1 completion

---

### Task 3.3: Add `remoteUrl` and `token` to `SDKOptions`

In `packages/kanban-lite/src/sdk/types/events.ts`, add to the `SDKOptions` interface (after `capabilities`):

```typescript
/**
 * Remote kanban-lite REST API base URL (e.g. `"http://localhost:3000"`).
 *
 * When set, the SDK constructor will throw and direct users to use
 * `RemoteKanbanSDK` instead of `KanbanSDK`, since remote-mode requires
 * a different class to avoid local filesystem initialization.
 *
 * @see RemoteKanbanSDK
 */
remoteUrl?: string
/**
 * Bearer token for remote API authentication.
 * Only relevant when `remoteUrl` is set.
 */
token?: string
```

And in `KanbanSDKCore` constructor (`KanbanSDK-core.ts`), add an early guard:

```typescript
if (options?.remoteUrl) {
  throw new Error(
    "Use RemoteKanbanSDK({ remoteUrl, token }) instead of KanbanSDK when connecting to a remote API."
  )
}
```

- **Files**:
  - `packages/kanban-lite/src/sdk/types/events.ts` — add `remoteUrl?` and `token?` to `SDKOptions`
  - `packages/kanban-lite/src/sdk/KanbanSDK-core.ts` — add early guard in constructor
- **Success**:
  - `new KanbanSDK(undefined, { remoteUrl: "http://..." })` throws descriptive error
  - `SDKOptions.remoteUrl` is a documented field visible in IDE autocomplete
- **Research References**:
  - #file:../research/20260501-sdk-remote-mode-research.md (Lines 145–155) - SDKOptions extension rationale
- **Dependencies**:
  - Task 1.1 completion

---

## Phase 4: Validation

### Task 4.1: TypeScript compilation check

Run in `packages/kanban-lite/`:

```bash
pnpm exec tsc --noEmit
```

Fix any type errors. Common issues to watch for:
- `EventBus` method signatures (check `eventBus.ts` for exact overload shapes)
- `waitFor` options type — check what `EventBusWaitOptions` looks like
- `BoardInfo` vs `BoardConfig` — `listBoards()` returns `BoardInfo[]`
- `many()` method on `EventBus` (may need to re-check)

- **Files**:
  - `packages/kanban-lite/src/sdk/remote/RemoteKanbanSDK.ts` — fix type errors
- **Success**:
  - Zero TypeScript errors after `pnpm exec tsc --noEmit`
- **Dependencies**:
  - All Phase 1–3 tasks complete

---

### Task 4.2: Smoke-test usage documentation

Verify the following usage pattern compiles (add to research or changes doc):

```typescript
import { RemoteKanbanSDK } from "kanban-lite/sdk"

const sdk = new RemoteKanbanSDK({
  remoteUrl: "http://localhost:3000",
  token: "my-bearer-token"
})

await sdk.init() // validates connectivity
const cards = await sdk.listCards()
const card = await sdk.createCard({ content: "# New task" })
```

- **Files**:
  - (no file changes — documentation only)
- **Success**:
  - Usage example is accurate and compiles when tested against the built package
- **Dependencies**:
  - Task 4.1 completion

---

## Dependencies

- Node.js 18+ global `fetch` (no polyfill needed)
- `EventBus` from `packages/kanban-lite/src/sdk/eventBus.ts`
- `Card`, `BoardInfo`, `Comment`, `LogEntry` from `packages/kanban-lite/src/shared/types.ts`
- `CreateCardInput` from `packages/kanban-lite/src/sdk/types/events.ts`

## Success Criteria

- `RemoteKanbanSDK` class is exported from `kanban-lite/sdk`
- Constructor accepts `{ remoteUrl: string; token?: string }`, no filesystem access
- Core card and board methods proxy to the REST API
- TypeScript compilation is clean
