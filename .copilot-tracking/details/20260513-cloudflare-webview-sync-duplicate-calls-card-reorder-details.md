<!-- markdownlint-disable-file -->

# Task Details: Cloudflare Webview Sync Duplicate Calls and Card Reorder

## Research Reference

**Source Research**: #file:../research/20260513-cloudflare-webview-sync-duplicate-calls-card-reorder-research.md

---

## Phase 1: Origin-aware hybrid sync transport

### Task 1.1: Thread a stable session identifier through the Cloudflare hybrid sync path

Implement the smallest shared transport change that lets the initiating browser
session identify itself across the hybrid WebSocket + HTTP sync flow.

- **Files**:
  - `packages/kanban-lite/src/webview/standalone-shim.ts` - capture the Worker-assigned hybrid session identifier and attach it to HTTP sync requests that can trigger authoritative mutation refreshes
  - `packages/kanban-lite/src/shared/types/messages.ts` - extend the existing transport-control message typing so the shim and Worker share one source of truth for the session/origin fields
  - `packages/kanban-lite/src/standalone/internal/routes/system.ts` - accept the minimal extra request metadata without breaking the existing `/api/webview-sync` request shape
  - `packages/kanban-lite/src/standalone/internal/webview-sync.ts` - thread the origin session metadata into the shared sync handling path only where it is needed for downstream invalidation decisions
  - `packages/kanban-lite/src/worker/worker-entry.ts` - read the origin session metadata from hybrid HTTP sync requests and preserve it when the Worker converts committed `task.*` after-events into live-sync invalidations
- **Implementation**:
  - Keep `/api/webview-sync` as the authoritative refresh endpoint and avoid adding a parallel mutation route.
  - Reuse the existing hybrid transport negotiation instead of inventing a second client state machine.
  - Add the session/origin identifier to the shared message types once, then reuse that type on both the shim and Worker sides.
  - Limit the new metadata to the Cloudflare hybrid path so local standalone direct-WebSocket mode keeps the same runtime behavior.
  - Preserve scoped auth/init behavior and the current active-card sync semantics while threading the new identifier.
- **Success**:
  - The originating Cloudflare hybrid tab can be identified on the server side when its HTTP sync request later triggers a live-sync invalidation.
  - Local standalone and pure HTTP fallback behavior remain source-compatible.
  - No second authoritative transport or duplicated request schema is introduced.
- **Research References**:
  - #file:../research/20260513-cloudflare-webview-sync-duplicate-calls-card-reorder-research.md (Lines 106-154) - Verified Cloudflare duplicate-call path, replay trigger, and missing initiator identity
  - #file:../research/20260513-cloudflare-webview-sync-duplicate-calls-card-reorder-research.md (Lines 247-267) - Current `/api/webview-sync` contract and hybrid transport-control message shapes
  - #file:../research/20260513-cloudflare-webview-sync-duplicate-calls-card-reorder-research.md (Lines 318-324) - Recommended session/origin threading sequence
- **Dependencies**:
  - Existing hybrid transport seam in `standalone-shim.ts`
  - Existing Worker invalidation seam in `worker-entry.ts`

### Task 1.2: Exclude the initiating Cloudflare session from redundant syncRequired fan-out

Apply the deduplication at the Durable Object invalidation layer so other tabs
still refresh, while the originating tab avoids an immediate redundant replay.

- **Files**:
  - `scripts/lib/cloudflare-worker-durable-objects.mjs` - change the generated Durable Object broadcast logic from blanket fan-out to origin-aware fan-out for `syncRequired`
  - `packages/kanban-lite/src/worker/worker-entry.ts` - include the origin session identifier when publishing live-sync invalidations to the Durable Object
  - `packages/kanban-lite/src/shared/types/messages.ts` - keep any new invalidation payload fields aligned with the shared transport types
  - `docs/cloudflare.md` - update the source architecture notes only if they describe invalidation fan-out in a way that becomes inaccurate after origin-aware filtering
- **Implementation**:
  - Preserve cross-tab invalidation for non-origin sessions.
  - Do not suppress reconnect-triggered resyncs from `syncTransportMode`; those remain valid after Durable Object reconnects or Worker code updates.
  - Prefer an explicit origin-session exclusion over debounce windows or time-based heuristics.
  - If the notify path must remain asynchronous after the HTTP response returns, bind the required work to Worker request lifetime appropriately.
- **Success**:
  - A successful card mutation in Cloudflare hybrid mode does not immediately send `syncRequired` back to the same browser session that just received the authoritative HTTP result.
  - Other tabs connected to the same board still receive the invalidation and refresh.
  - Legitimate reconnect-driven HTTP resyncs continue to work.
- **Research References**:
  - #file:../research/20260513-cloudflare-webview-sync-duplicate-calls-card-reorder-research.md (Lines 81-94) - Cloudflare Durable Object guidance, including the documented “all except initiator” broadcast pattern
  - #file:../research/20260513-cloudflare-webview-sync-duplicate-calls-card-reorder-research.md (Lines 146-154) - Verified current all-sockets invalidation behavior and missing initiator exclusion
  - #file:../research/20260513-cloudflare-webview-sync-duplicate-calls-card-reorder-research.md (Lines 294-301) - Reliability constraints for cross-tab freshness, reconnects, and request lifetime management
  - #file:../research/20260513-cloudflare-webview-sync-duplicate-calls-card-reorder-research.md (Lines 316-331) - Recommended origin-aware invalidation strategy and rationale
- **Dependencies**:
  - Task 1.1 completion

---

## Phase 2: Regression coverage for duplicate sync and ordering drift

### Task 2.1: Extend hybrid transport tests for origin-tab deduplication

Add focused regression coverage around the exact Cloudflare hybrid replay path so
this bug cannot quietly return later.

- **Files**:
  - `packages/kanban-lite/src/webview/standalone-shim.test.ts` - prove the shim still performs initial/reconnect syncs but does not perform an extra origin-tab replay when the Worker excludes the initiating session
  - `packages/kanban-lite/src/worker/live-sync-runtime.test.ts` - prove live-sync invalidations still reach non-origin tabs while skipping the initiating session
  - `packages/kanban-lite/src/shared/types/messages.ts` - ensure any typed test fixtures stay aligned with the shared transport message schema
- **Implementation**:
  - Add a regression covering the exact `[switchBoard, openCard, ready]` replay payload shape the user observed.
  - Verify origin-aware invalidation preserves the existing debounce/coalescing behavior for bursty updates.
  - Verify reconnect or `syncTransportMode` negotiation still triggers one valid state refresh.
  - Keep the tests transport-focused; do not overfit them to implementation-specific logging.
- **Success**:
  - The initiating hybrid session produces at most one authoritative HTTP sync round-trip for a local mutation.
  - Non-origin sessions still refresh after the same mutation.
  - Existing hybrid reconnect behavior remains covered.
- **Research References**:
  - #file:../research/20260513-cloudflare-webview-sync-duplicate-calls-card-reorder-research.md (Lines 54-59) - Existing test anchors around shim replay and Worker invalidation
  - #file:../research/20260513-cloudflare-webview-sync-duplicate-calls-card-reorder-research.md (Lines 134-154) - Replay-path evidence and invalidation flow
  - #file:../research/20260513-cloudflare-webview-sync-duplicate-calls-card-reorder-research.md (Lines 342-353) - Required regression scope and success criteria
- **Dependencies**:
  - Phase 1 completion

### Task 2.2: Add a move-card regression that guards against order bounce on the originating tab

Cover the user-visible symptom by verifying that a successful move no longer
gets immediately overwritten by a redundant authoritative snapshot on the same
session.

- **Files**:
  - `packages/kanban-lite/src/webview/standalone-shim.test.ts` - assert the originating session does not trigger a second replay after a move-triggered invalidation cycle
  - `packages/kanban-lite/src/worker/live-sync-runtime.test.ts` - assert the live-sync event produced by `task.moved` still reaches other sessions
  - `packages/kanban-lite/src/standalone/__tests__/worker.test.ts` - add an end-to-end Worker-facing regression only if the unit-level tests do not sufficiently cover move-card ordering stability
- **Implementation**:
  - Exercise a `task.moved` path, not just a generic update, because the visible regression is column-order bounce.
  - Assert the origin session keeps the optimistic move until the first authoritative response, without an immediate second overwrite from its own invalidation echo.
  - Keep secondary hidden-card visibility drift in mind, but do not broaden this regression beyond the duplicate-snapshot bug unless the implementation exposes a separate server/client ordering defect.
- **Success**:
  - A moved card does not visibly bounce on the initiating Cloudflare hybrid tab due solely to an immediate duplicate replay.
  - Cross-session freshness for move events is preserved.
  - The regression remains narrowly targeted to the duplicate-sync root cause.
- **Research References**:
  - #file:../research/20260513-cloudflare-webview-sync-duplicate-calls-card-reorder-research.md (Lines 166-184) - Client/server ordering paths and the hidden-card secondary hypothesis
  - #file:../research/20260513-cloudflare-webview-sync-duplicate-calls-card-reorder-research.md (Lines 333-338) - Ordering symptom analysis and lower-priority alternative hypotheses
  - #file:../research/20260513-cloudflare-webview-sync-duplicate-calls-card-reorder-research.md (Lines 347-354) - Recommended move-card regression target and final success criteria
- **Dependencies**:
  - Task 2.1 completion

---

## Phase 3: Docs and verification

### Task 3.1: Update release notes and Cloudflare sync docs as needed

Reflect the correctness fix in source docs without turning an internal transport
cleanup into a feature rewrite.

- **Files**:
  - `CHANGELOG.md` - add a concise bug-fix entry for redundant Cloudflare hybrid sync requests and resulting order bounce
  - `README.md` - update any user-facing Cloudflare sync wording only if the current text overstates the old invalidation behavior
  - `docs/cloudflare.md` - keep the hybrid architecture explanation accurate if the source docs mention how invalidations are fanned out
- **Implementation**:
  - Keep the language factual: this is a correctness and efficiency fix, not a new feature.
  - Preserve the documented hybrid architecture where `/ws` invalidates and `/api/webview-sync` provides authoritative state.
  - Update source documentation only; do not manually edit generated docs.
- **Success**:
  - Release notes mention the Cloudflare duplicate-sync fix.
  - Any affected Cloudflare sync documentation stays aligned with the implemented behavior.
- **Research References**:
  - #file:../research/20260513-cloudflare-webview-sync-duplicate-calls-card-reorder-research.md (Lines 50-53) - Existing user-facing Cloudflare architecture docs
  - #file:../research/20260513-cloudflare-webview-sync-duplicate-calls-card-reorder-research.md (Lines 294-299) - Architecture constraints that docs must continue to describe accurately
- **Dependencies**:
  - Phases 1-2 complete

### Task 3.2: Run the mandatory verification commands

Validate the final implementation against repo policy before considering the
fix complete.

- **Files**:
  - No source files; verification only
- **Implementation**:
  - Run `pnpm exec tsc --noEmit`
  - Run `nr build`
  - Run `nr test`
  - Run `nr e2e`
  - Fix any new failures introduced by the implementation before closing the task.
- **Success**:
  - TypeScript, build, unit tests, and E2E all pass with no new failures.
- **Research References**:
  - #file:../research/20260513-cloudflare-webview-sync-duplicate-calls-card-reorder-research.md (Lines 340-354) - Final objectives, dependencies, and implementation success criteria
  - #file:../../AGENTS.md - Mandatory validation order and completion standard
- **Dependencies**:
  - Task 3.1 completion

---

## Dependencies

- The Cloudflare duplicate-call regression lives in the hybrid transport choreography around shared standalone behavior, so the fix should stay minimal and transport-focused.
- `core-surface.instructions.md` applies because the change touches shared standalone/Worker surfaces and must preserve SDK-first parity assumptions.
- `reliability.instructions.md` applies because the bug involves duplicate side effects, reconnect semantics, and invalidation fan-out.
- `react-tsx.instructions.md` only applies if implementation ends up touching `packages/kanban-lite/src/webview/App.tsx` or `packages/kanban-lite/src/webview/router.tsx`.

## Success Criteria

- Cloudflare hybrid mode stops sending redundant origin-tab `POST /api/webview-sync` replays for the same successful local mutation.
- Other tabs still receive live-sync invalidations and refresh correctly.
- Reconnect-driven transport renegotiation still triggers one valid authoritative resync.
- The initiating tab no longer shows card-order bounce caused solely by its own invalidation echo.
- The required verification commands pass after implementation.
