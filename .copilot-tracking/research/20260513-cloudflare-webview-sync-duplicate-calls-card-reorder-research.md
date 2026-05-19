<!-- markdownlint-disable-file -->

# Task Research Notes: Cloudflare webview-sync duplicate calls and card reorder behavior

## Research Executed

### File Analysis

- `packages/kanban-lite/src/webview/App.tsx`
  - `grep_search` confirmed the standalone UI posts `{ type: 'ready' }` once on mount, opens cards via `{ type: 'openCard' }`, and performs optimistic card reordering in `handleMoveCard()` before server confirmation.
- `packages/kanban-lite/src/webview/router.tsx`
  - URL bootstrap logic independently posts `{ type: 'switchBoard' }` and then `{ type: 'openCard' }`, which explains why the shim can replay both alongside a later `ready` snapshot sync.
- `packages/kanban-lite/src/webview/standalone-shim.ts`
  - `buildHttpSyncMessages()` (`line 96`), `syncMessagesOverHttp()` (`142`), `syncCurrentStateOverHttp()` (`165`), `activateHttpFallback()` (`173`), and `connect()` (`269`) are the exact browser-side sync/retry entrypoints.
  - The exact repeated payload pattern reported by the user — `[{ type: 'switchBoard' }, { type: 'openCard' }, { type: 'ready' }]` — is produced by `syncCurrentStateOverHttp()`, not by ordinary one-off mutation sends.
- `packages/kanban-lite/src/webview/store/store.ts`
  - `getFilteredCardsByStatus()` (`354`) re-sorts cards by `order`, so every authoritative `init` / `cardsUpdated` snapshot can visibly reshuffle cards even when the store mutation is just “replace cards with server truth”.
- `packages/kanban-lite/src/standalone/server.ts`
  - Local Node standalone wires both `createStandaloneRouteDispatcher(...)` and `attachWebSocketHandlers(...)`, so local mode keeps using a real app WebSocket for authoritative server messages.
- `packages/kanban-lite/src/standalone/dispatch.ts`
  - Shared HTTP route dispatcher is used by both local standalone and Cloudflare Worker, which means `/api/webview-sync` behavior itself is shared; the deployment-specific behavior difference is transport around it.
- `packages/kanban-lite/src/standalone/internal/routes/system.ts`
  - POST `/api/webview-sync` resolves to `syncWebviewMessages(ctx, rawMessages, extractAuthContext(req))`.
- `packages/kanban-lite/src/standalone/internal/webview-sync.ts`
  - The HTTP bridge reuses `handleMessage(...)` through a pseudo-client, coalesces duplicate `init` / `cardsUpdated` messages within a single request, sets `ctx.skipMutationBroadcast = true`, and can synthesize a scoped `init` after message handling.
  - This proves the server already deduplicates responses within one request, but not across separate requests.
- `packages/kanban-lite/src/standalone/messageHandlers/card-dispatch.ts`
  - `ready` (`57`) loads cards and sends init.
  - `openCard` (`111`) updates active/open state and sends `cardStates` plus `cardContent`, but does not itself reload cards.
- `packages/kanban-lite/src/standalone/messageHandlers/board-dispatch.ts`
  - `switchBoard` (`176`) loads cards and broadcasts an init payload for the selected board.
- `packages/kanban-lite/src/standalone/broadcastService.ts`
  - `loadCards()`, `buildScopedInitMessage()`, `buildInitMessage()`, and per-client broadcasting are the source of authoritative card snapshots.
- `packages/kanban-lite/src/worker/worker-entry.ts`
  - `notifyWorkerLiveSync()` (`87`) POSTs invalidation notices to the Durable Object.
  - `createWorkerSyncEventHandler()` (`108`) subscribes to SDK after-events and schedules invalidation fan-out.
  - `maybeHandleWebSocketUpgrade()` (`228`) is the Cloudflare-only `/ws` upgrade path.
  - `createCloudflareWorkerFetchHandler()` (`275`) reuses the standalone dispatcher for HTTP but not for authoritative WebSocket board sync.
- `scripts/lib/cloudflare-worker-durable-objects.mjs`
  - The generated Durable Object immediately sends `{ type: 'syncTransportMode', mode: 'http-sync-websocket-notify' }` on socket accept, and broadcasts every incoming `syncRequired` to all connected sockets with no origin-tab filtering.
- `packages/kanban-lite/src/sdk/KanbanSDK-core.ts`
  - `onEvent` listeners receive `payload.data`; for after-events that is an `AfterEventPayload`, which is exactly what the Worker invalidation handler inspects.
  - `_runAfterEvent()` emits `{ type: event, data: afterPayload }`, where `afterPayload` includes `{ event, data, actor, boardId, timestamp, meta }`.
- `packages/kanban-lite/src/sdk/KanbanSDK-cards.ts`
  - Successful card mutations emit `task.created`, `task.updated`, and `task.moved`, which are the Cloudflare invalidation triggers.
- `packages/kanban-lite/src/sdk/KanbanSDK-card-state.ts`
  - `markCardOpened()` updates card-state storage but does not emit `task.*` after-events.
- `packages/kanban-lite/src/sdk/modules/cards/actions.ts`
  - `moveCard()` (`104`) is the authoritative server-side order recomputation path. It sorts the full target column by `order` and generates a new fractional key.
- `docs/cloudflare.md`
  - The documented Cloudflare architecture is hybrid by design: the Durable Object-backed `/ws` channel is an invalidation signal, while `/api/webview-sync` remains the authoritative latest-state refresh path.
- `README.md`
  - The root README matches `docs/cloudflare.md` and describes the same hybrid sync contract.
- `packages/kanban-lite/src/webview/standalone-shim.test.ts`
  - Verified test coverage shows `syncTransportMode` and `syncRequired` result in HTTP snapshot sync calls whose payload matches the user’s observed `[switchBoard, openCard, ready]` pattern.
- `packages/kanban-lite/src/worker/live-sync-runtime.test.ts`
  - Verified test coverage shows successful Worker mutations publish `syncRequired` invalidations.
- `packages/kanban-lite/src/worker/active-card-runtime.test.ts`
  - Verified test coverage shows Worker-mode `/api/webview-sync` commonly batches `ready` and `openCard` to persist active-card state.

### Code Search Results

- `/api/webview-sync|webview-sync|webview sync`
  - Found in `packages/kanban-lite/src/webview/standalone-shim.ts`, `packages/kanban-lite/src/standalone/internal/routes/system.ts`, `packages/kanban-lite/src/standalone/__tests__/worker.test.ts`, `packages/kanban-lite/src/worker/active-card-runtime.test.ts`, `README.md`, and `docs/cloudflare.md`.
- `buildHttpSyncMessages|syncCurrentStateOverHttp|activateHttpFallback|function connect`
  - All matched only in `packages/kanban-lite/src/webview/standalone-shim.ts`, confirming the browser shim is the sole initiator of the repeated snapshot POST shape.
- `case 'ready'|case 'openCard'|case 'switchBoard'`
  - Matched in `packages/kanban-lite/src/standalone/messageHandlers/card-dispatch.ts` and `packages/kanban-lite/src/standalone/messageHandlers/board-dispatch.ts`, confirming which server handlers correspond to the replayed client messages.
- `syncTransportMode|http-sync-websocket-notify|syncRequired`
  - Matched in `packages/kanban-lite/src/webview/standalone-shim.ts`, `packages/kanban-lite/src/worker/worker-entry.ts`, `scripts/lib/cloudflare-worker-durable-objects.mjs`, and tests covering Worker hybrid sync.
- `attachWebSocketHandlers|createStandaloneRouteDispatcher`
  - `vscode_listCodeUsages` verified local Node standalone uses both, while Cloudflare Worker reuses only the route dispatcher and handles `/ws` separately through Worker code and the Durable Object.
- `generateKeyBetween|handleMoveCard|getFilteredCardsByStatus|moveCard`
  - Matched in `packages/kanban-lite/src/webview/App.tsx`, `packages/kanban-lite/src/webview/store/store.ts`, and `packages/kanban-lite/src/sdk/modules/cards/actions.ts`, mapping client optimistic ordering to server authoritative ordering.
- `visibilitychange|document.visibilityState|EventSource`
  - No matches in `packages/kanban-lite/src/webview/**/*.{ts,tsx}`.
  - The only transport-related webview matches were `navigator.onLine` in `standalone-shim.ts` and unrelated UI timers in `UndoToast.tsx` / `VoiceCommentRecorder.tsx`, so the repeated POSTs are not caused by a visibility-based polling loop, SSE, or browser-side periodic sync job.
- `_runAfterEvent\('task.moved'|_runAfterEvent\('task.created'|_runAfterEvent\('task.updated'`
  - Matched in `packages/kanban-lite/src/sdk/KanbanSDK-cards.ts`, confirming the exact Worker invalidation triggers.

### External Research

- #fetch:https://developers.cloudflare.com/durable-objects/best-practices/websockets/
  - Cloudflare recommends Durable Objects as the coordination point for multiple WebSocket clients, notes that WebSocket hibernation preserves idle connections while evicting in-memory state, and notes that code updates disconnect existing WebSockets. That makes reconnect-triggered resyncs expected platform behavior that app code must handle idempotently.
- #fetch:https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/
  - Durable Objects can hibernate and later resume, which clears ordinary in-memory variables. Any reconnect/resubscribe flow has to rebuild live state explicitly.
- #fetch:https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/
  - The official example shows both “broadcast to all WebSockets” and “broadcast to all WebSockets except the initiating client.” That is directly relevant because this repo’s generated Durable Object currently always broadcasts to all sockets and does not preserve initiator identity.
- #fetch:https://developers.cloudflare.com/workers/runtime-apis/websockets/
  - Cloudflare Workers use standard WebSocket upgrade flow but defer multi-client coordination to Durable Objects.
- #fetch:https://developers.cloudflare.com/workers/runtime-apis/context/#waituntil
  - Cloudflare documents `ctx.waitUntil()` as the supported way to keep important background work alive after returning a response.
- #githubRepo:"cloudflare/workers-chat-demo durable object websocket coordination"
  - Cloudflare’s official chat demo describes the Durable Object as the real-time coordination layer that forwards messages directly to other users rather than routing live fan-out through storage.

### Project Conventions

- Standards referenced: `AGENTS.md`, `.github/copilot-instructions.md`, `.github/instructions/core-surface.instructions.md`, `.github/instructions/reliability.instructions.md`
- Instructions followed: SDK-first reasoning, minimum necessary change philosophy, reliability-sensitive analysis for async invalidation flows, and research-only editing limited to `.copilot-tracking/research/`
- Additional implementation note: `.github/instructions/react-tsx.instructions.md` would apply if a follow-up fix touches `packages/kanban-lite/src/webview/App.tsx` or `packages/kanban-lite/src/webview/router.tsx`

## Key Discoveries

### Project Structure

The exact Cloudflare duplicate-call path is:

1. Browser UI emits `ready`, `switchBoard`, and `openCard`
   - `packages/kanban-lite/src/webview/App.tsx`
   - `packages/kanban-lite/src/webview/router.tsx`
2. Standalone browser shim caches the last board/card context and decides transport
   - `packages/kanban-lite/src/webview/standalone-shim.ts`
3. In local standalone mode, requests and authoritative updates flow over the real app WebSocket
   - `packages/kanban-lite/src/standalone/server.ts`
   - `packages/kanban-lite/src/standalone/internal/websocket.ts`
4. In Cloudflare mode, `/ws` is handled by the Worker + Durable Object and immediately negotiates `http-sync-websocket-notify`
   - `packages/kanban-lite/src/worker/worker-entry.ts`
   - `scripts/lib/cloudflare-worker-durable-objects.mjs`
5. Once that mode is active, authoritative state refreshes use HTTP POST `/api/webview-sync`
   - `packages/kanban-lite/src/standalone/internal/routes/system.ts`
   - `packages/kanban-lite/src/standalone/internal/webview-sync.ts`
6. HTTP sync delegates back into the same standalone message handlers used elsewhere
   - `packages/kanban-lite/src/standalone/messageHandlers/card-dispatch.ts`
   - `packages/kanban-lite/src/standalone/messageHandlers/board-dispatch.ts`
7. Mutations reach the SDK, which emits after-events that the Worker converts into Durable Object invalidations
   - `packages/kanban-lite/src/sdk/KanbanSDK-cards.ts`
   - `packages/kanban-lite/src/sdk/KanbanSDK-core.ts`
   - `packages/kanban-lite/src/worker/worker-entry.ts`

That means the duplication is not inside the SDK or inside `/api/webview-sync` routing. It is in the Cloudflare transport choreography around otherwise shared server behavior.

### Implementation Patterns

The strongest verified pattern is that the user’s exact repeated payload shape is a replay snapshot, not a direct mutation request.

- `buildHttpSyncMessages()` only includes the full `[switchBoard, openCard, ready]` replay when the shim is resyncing current viewer state.
- For ordinary card-scoped messages, the shim tries to inject `boardId` and avoid replaying the heavier board/card bootstrap context.
- Therefore repeated POSTs with the three-message payload point specifically to `syncCurrentStateOverHttp()`.

There are only three verified ways the shim reaches `syncCurrentStateOverHttp()`:

1. initial transition into HTTP fallback / hybrid mode
2. a later `syncTransportMode: 'http-sync-websocket-notify'` handshake after reconnect
3. a `syncRequired` invalidation while in hybrid mode

The Worker-side invalidation flow is also verified end to end:

- committed card mutations emit `task.created`, `task.updated`, or `task.moved`
- `createWorkerSyncEventHandler()` receives the `AfterEventPayload`
- `notifyWorkerLiveSync()` POSTs `{ type: 'syncRequired', reason }` to the Durable Object
- the generated Durable Object loops `for (const socket of this.ctx.getWebSockets())` and sends the same JSON to every socket
- the shim receives `syncRequired`, debounces for `150ms`, and calls `syncCurrentStateOverHttp()` again

There is no initiator identity in that path. No client ID is attached to `syncRequired`, and the Durable Object does not skip the originating socket. That is the cleanest explanation for “the tab that just performed a successful mutation immediately POSTs `/api/webview-sync` again with `[switchBoard, openCard, ready]`”.

Local standalone behaves differently:

| Environment | Authoritative state channel | Invalidations | Verified behavior |
| --- | --- | --- | --- |
| Local Node standalone | real app WebSocket | not split from state channel | `attachWebSocketHandlers()` handles messages directly; no Worker invalidation fan-out layer |
| Cloudflare Worker with Durable Object binding | HTTP `/api/webview-sync` | Durable Object `/ws` sends `syncRequired` only | documented in `docs/cloudflare.md`; negotiated by `syncTransportMode` |
| Cloudflare Worker without Durable Object binding | HTTP fallback only | none | `/ws` upgrade returns `501`; no DO-driven invalidation loop |

That last row matters: the user’s exact `[switchBoard, openCard, ready]` payload is more consistent with the hybrid Durable Object path than with pure 501 fallback.

Card order is recomputed in two separate places:

- Client optimistic path in `packages/kanban-lite/src/webview/App.tsx`
  - `handleMoveCard()` calculates a new fractional key with `generateKeyBetween(before, after)` using the cards currently visible in the UI and updates local state immediately.
- Server authoritative path in `packages/kanban-lite/src/sdk/modules/cards/actions.ts`
  - `moveCard()` loads raw cards from storage, sorts the full target column by `order`, and computes the authoritative fractional key.

The store then always renders by sorting on `order` in `getFilteredCardsByStatus()`. Any later authoritative `init` / `cardsUpdated` snapshot replaces cards in the store and can visibly reorder a column compared with the optimistic local arrangement.

Two verified nuances sharpen that conclusion:

1. `openCard` itself is not a likely invalidation source.
   - `card-dispatch.ts` handles `openCard` by calling `markCardOpened()` and `setActiveCard()`.
   - `KanbanSDK-card-state.ts` and card-state-related reads show `markCardOpened()` does not emit `task.*` after-events.
   - So repeated `switchBoard/openCard/ready` POSTs are much more likely replayed current-view state than a direct response to `openCard` itself.
2. Hidden-card / auth-visibility drift is a plausible secondary reorder amplifier.
   - The client move calculation uses the visible cards in the current UI state.
   - The server move calculation uses `listCardsRaw()` across the full target column.
   - If hidden cards exist, the authoritative order can differ from the optimistic visible-only order even when the server is behaving correctly.

### Complete Examples

```ts
// packages/kanban-lite/src/webview/App.tsx
if (!readySentRef.current) {
  readySentRef.current = true
  vscode.postMessage({ type: 'ready' })
}

// packages/kanban-lite/src/webview/router.tsx
if (params.boardId) {
  vscode.postMessage({ type: 'switchBoard', boardId: params.boardId })
}
...
vscode.postMessage({
  type: 'openCard',
  cardId: pendingCardIdRef.current,
  ...(pendingBoardIdRef.current ? { boardId: pendingBoardIdRef.current } : {}),
})

// packages/kanban-lite/src/webview/standalone-shim.ts
if (data.type === 'syncTransportMode') {
  syncTransportMode = data.mode
  if (data.mode === 'http-sync-websocket-notify' && readyRequested) {
    void syncCurrentStateOverHttp().catch((error) => {
      logShimEvent('http-sync-websocket-notify-initial-sync-error', { error })
    })
  }
}
if (data.type === 'syncRequired' && syncTransportMode === 'http-sync-websocket-notify') {
  if (syncRequiredDebounceTimer !== null) {
    window.clearTimeout(syncRequiredDebounceTimer)
  }
  syncRequiredDebounceTimer = window.setTimeout(() => {
    syncRequiredDebounceTimer = null
    void syncCurrentStateOverHttp().catch((error) => {
      logShimEvent('sync-required-http-sync-error', { error, reason: data.reason })
    })
  }, SYNC_REQUIRED_DEBOUNCE_MS)
}

// scripts/lib/cloudflare-worker-durable-objects.mjs
server.send(JSON.stringify({ type: 'syncTransportMode', mode: 'http-sync-websocket-notify' }))
...
for (const socket of this.ctx.getWebSockets()) {
  socket.send(json)
}

// packages/kanban-lite/src/sdk/modules/cards/actions.ts
const targetColumnCards = cards
  .filter((c) => c.status === newStatus && c.id !== cardId)
  .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
const before = pos > 0 ? targetColumnCards[pos - 1].order : null
const after = pos < targetColumnCards.length ? targetColumnCards[pos].order : null
card.order = generateKeyBetween(before, after)

// Cloudflare official websocket hibernation example (external docs)
// Demonstrates that broadcasting to all EXCEPT the initiating client is an intended DO pattern.
// This repo's generated DO currently uses the "all sockets" variant instead.
```

### API and Schema Documentation

- Browser-to-server authoritative sync endpoint
  - Route: `POST /api/webview-sync`
  - Handler: `packages/kanban-lite/src/standalone/internal/routes/system.ts`
  - Runtime: local standalone and Cloudflare Worker both delegate to the same `syncWebviewMessages(...)` implementation
  - Input shape: a single message or array of webview messages, normalized to `rawMessages`
  - Output shape: `{ ok: true, data: { messages: ExtensionMessage[] } }`
- Transport-control messages observed in the hybrid Cloudflare path
  - `{ type: 'syncTransportMode', mode: 'http-sync-websocket-notify' }`
  - `{ type: 'syncRequired', reason?: string }`
- Relevant authoritative response messages
  - `init`
  - `cardsUpdated`
  - `cardContent`
  - `cardStates`
  - `connectionStatus`
- Worker-only live-sync side channel
  - WebSocket path: `/ws`
  - Durable Object notify path: `/live-sync/notify`
  - Purpose: notify clients that authoritative state should be refreshed over HTTP
- Sanitized example of the repeated authoritative snapshot request body

```json
{
  "messages": [
    { "type": "switchBoard", "boardId": "example-board" },
    { "type": "openCard", "cardId": "498", "boardId": "example-board" },
    { "type": "ready" }
  ]
}
```

### Configuration Examples

```toml
[[durable_objects.bindings]]
name = "KANBAN_ACTIVE_CARD_STATE"
class_name = "KanbanActiveCardState"

[[migrations]]
tag = "kanban-active-card-state-v1"
new_sqlite_classes = ["KanbanActiveCardState"]
```

### Technical Requirements

- Preserve the documented Cloudflare architecture: `/ws` remains an invalidation channel and `/api/webview-sync` remains the authoritative latest-state refresh path.
- Preserve local Node standalone behavior. The duplicate-call issue is specific to the Worker hybrid choreography and should not regress local direct-WebSocket mode.
- Preserve auth-scoped / filtered init payload behavior. Any fix that bypasses scoped `buildScopedInitMessage()` would be unsafe.
- Fix duplicate POSTs across requests, not only inside one request. The current HTTP bridge already coalesces duplicate `init` / `cardsUpdated` responses per request.
- Preserve cross-tab invalidation for non-origin tabs. The duplicate origin-tab refresh is wasteful; removing invalidation fan-out entirely would break multi-tab freshness.
- Treat reconnects as first-class. Cloudflare documents that DO WebSockets disconnect on code updates and resume after hibernation, so at least one reconnect-driven resync must remain valid.
- Preserve active-card state persistence, which is currently exercised by the Worker + HTTP sync tests.
- If any Worker-side notify work stays asynchronous after the response is produced, use `ctx.waitUntil()` or an equivalent bound lifetime so required invalidations are not dropped.

## Recommended Approach

The most evidence-backed root cause is origin-tab duplication in the Cloudflare hybrid sync path.

Why this is the leading explanation:

- the user’s exact repeated payload matches `syncCurrentStateOverHttp()` replay behavior
- `syncCurrentStateOverHttp()` is invoked on `syncRequired` in hybrid mode
- successful Worker mutations emit `task.*` after-events
- the Worker turns those after-events into `syncRequired`
- the generated Durable Object broadcasts that invalidation to all sockets, including the initiating tab
- the initiating tab already received an authoritative HTTP response for its own mutation, so the follow-up `syncRequired` is redundant for that same tab

The recommended fix direction is to make hybrid invalidations origin-aware instead of weakening sync globally.

Recommended implementation shape:

1. give each Cloudflare hybrid browser session a stable WebSocket/session identifier
2. include that identifier on HTTP mutation requests sent through `/api/webview-sync` while in `http-sync-websocket-notify` mode
3. pass the origin session identifier into `notifyWorkerLiveSync()`
4. change the Durable Object broadcast from “all sockets” to “all sockets except the initiating session” for `syncRequired`
5. keep reconnect-triggered `syncTransportMode` resyncs intact, because those are still needed after DO reconnects / code updates

Why this is the best single approach:

- it matches Cloudflare’s documented DO pattern of excluding the initiating client when appropriate
- it preserves cross-tab freshness instead of suppressing invalidations wholesale
- it avoids heuristic time windows that might hide a legitimate external update
- it attacks the duplication at the exact layer where it is introduced

Secondary findings that should stay in scope during implementation:

- **Second most likely contributing factor:** reconnect-driven handshakes can also produce extra `ready` snapshot POSTs. Cloudflare explicitly documents that WebSockets disconnect on code updates, so repeated POSTs while the user is idle would point to this path rather than local mutation echo.
- **Most likely explanation for visible card reordering:** repeated authoritative snapshots overwrite the client’s optimistic fractional order after `handleMoveCard()`.
- **Plausible reorder-only amplifier:** if auth visibility hides cards, client visible-order calculations can diverge from the server’s raw-column ordering. This explains surprising final placement after a move, but it does not explain the repeated `[switchBoard, openCard, ready]` POST pattern by itself.
- **Lower-confidence reliability note:** `createWorkerSyncEventHandler()` currently triggers `notifyWorkerLiveSync()` via `setTimeout(..., 0)` and fire-and-forget async work. If any invalidations are observed to go missing, tie that work to `ctx.waitUntil()`; this is a durability concern, not the strongest explanation for duplicate POSTs.

## Implementation Guidance

- **Objectives**: eliminate redundant origin-tab `POST /api/webview-sync` calls in Cloudflare hybrid mode, preserve non-origin live-sync notifications, and stop duplicate authoritative snapshots from overwriting optimistic order unnecessarily.
- **Key Tasks**:
  - trace a stable session identifier from Durable Object WebSocket accept to the browser shim
  - include that identifier on hybrid HTTP mutation requests routed through `/api/webview-sync`
  - thread the identifier through Worker invalidation publish so the Durable Object can exclude the initiating session
  - extend tests in `packages/kanban-lite/src/webview/standalone-shim.test.ts` and `packages/kanban-lite/src/worker/live-sync-runtime.test.ts` to prove origin-tab dedup while preserving other-tab invalidation
  - add a regression that moves a card in hybrid mode and verifies no immediate second snapshot is applied to the originating tab
- **Dependencies**: `packages/kanban-lite/src/webview/standalone-shim.ts`, `packages/kanban-lite/src/worker/worker-entry.ts`, `scripts/lib/cloudflare-worker-durable-objects.mjs`, shared message typing used by webview/worker transport, existing hybrid sync tests, and possibly a new Worker integration test that simulates two sockets
- **Success Criteria**:
  - one local mutation in a Cloudflare deployment causes at most one authoritative HTTP sync round-trip for the initiating tab
  - a second tab connected to the same board still receives an invalidation and refreshes
  - reconnect or transport renegotiation still triggers one valid latest-state resync
  - card order does not visibly “bounce back” on the originating tab due solely to an immediate duplicate snapshot after a successful move
  - no local standalone regression: direct WebSocket mode still behaves as before
