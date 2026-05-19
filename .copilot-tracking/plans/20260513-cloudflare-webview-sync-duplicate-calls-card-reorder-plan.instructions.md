---
applyTo: ".copilot-tracking/changes/20260513-cloudflare-webview-sync-duplicate-calls-card-reorder-changes.md"
---

<!-- markdownlint-disable-file -->

# Task Checklist: Cloudflare Webview Sync Duplicate Calls and Card Reorder

## Overview

Eliminate redundant origin-tab Cloudflare hybrid `POST /api/webview-sync` replays that are causing repeated sync requests and visible card-order bounce after successful mutations.

## Objectives

- Make the Cloudflare hybrid invalidation path origin-aware so the initiating tab does not immediately replay `[switchBoard, openCard, ready]` after its own successful mutation.
- Preserve cross-tab freshness, reconnect-triggered resyncs, and local standalone behavior while keeping `/api/webview-sync` as the authoritative refresh endpoint.
- Add focused regression coverage for duplicate sync and move-card ordering stability, then run the repo’s mandatory validation commands.
- Update release notes and any affected Cloudflare sync docs if the final implementation changes user-visible behavior descriptions.

## Research Summary

### Project Files

- `packages/kanban-lite/src/webview/standalone-shim.ts` - browser-side hybrid sync negotiation, replay building, and `syncRequired` handling
- `packages/kanban-lite/src/shared/types/messages.ts` - shared transport message typing for `syncTransportMode`, `syncRequired`, and any origin-session metadata
- `packages/kanban-lite/src/standalone/internal/routes/system.ts` - `/api/webview-sync` HTTP entrypoint shared by local standalone and Cloudflare Worker
- `packages/kanban-lite/src/standalone/internal/webview-sync.ts` - shared HTTP sync bridge that already deduplicates responses within a single request
- `packages/kanban-lite/src/worker/worker-entry.ts` - Cloudflare Worker invalidation publishing and `/ws` upgrade handling
- `scripts/lib/cloudflare-worker-durable-objects.mjs` - generated Durable Object live-sync coordination and current all-sockets broadcast behavior
- `packages/kanban-lite/src/webview/standalone-shim.test.ts` - current hybrid replay tests and the best anchor for origin-tab dedup regressions
- `packages/kanban-lite/src/worker/live-sync-runtime.test.ts` - Worker invalidation fan-out tests and cross-session freshness regression anchor
- `packages/kanban-lite/src/sdk/modules/cards/actions.ts` - authoritative server-side move-card ordering path that makes duplicate snapshots visibly reorder cards
- `docs/cloudflare.md` - documented hybrid architecture contract for Cloudflare deployments

### External References

- #file:../research/20260513-cloudflare-webview-sync-duplicate-calls-card-reorder-research.md - validated repo investigation, Cloudflare transport analysis, and implementation guidance
- #fetch:https://developers.cloudflare.com/durable-objects/best-practices/websockets/ - Durable Object coordination patterns, including excluding the initiating client from broadcast when appropriate
- #fetch:https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/ - official hibernation example showing initiator-aware WebSocket fan-out patterns
- #fetch:https://developers.cloudflare.com/workers/runtime-apis/context/#waituntil - Worker lifetime guidance for async notify work that must survive the response

### Standards References

- #file:../../AGENTS.md - minimum-change policy, README/CHANGELOG rule, and mandatory verification commands
- #file:../../.github/instructions/core-surface.instructions.md - shared surface parity and source-doc update expectations
- #file:../../.github/instructions/reliability.instructions.md - duplicate side-effect, reconnect, and invalidation-fan-out safeguards

## Implementation Checklist

### [ ] Phase 1: Origin-aware hybrid sync transport

- [ ] Task 1.1: Thread a stable session identifier through the Cloudflare hybrid sync path
  - Details: .copilot-tracking/details/20260513-cloudflare-webview-sync-duplicate-calls-card-reorder-details.md (Lines 13-40)

- [ ] Task 1.2: Exclude the initiating Cloudflare session from redundant syncRequired fan-out
  - Details: .copilot-tracking/details/20260513-cloudflare-webview-sync-duplicate-calls-card-reorder-details.md (Lines 42-67)

### [ ] Phase 2: Regression coverage for duplicate sync and ordering drift

- [ ] Task 2.1: Extend hybrid transport tests for origin-tab deduplication
  - Details: .copilot-tracking/details/20260513-cloudflare-webview-sync-duplicate-calls-card-reorder-details.md (Lines 73-96)

- [ ] Task 2.2: Add a move-card regression that guards against order bounce on the originating tab
  - Details: .copilot-tracking/details/20260513-cloudflare-webview-sync-duplicate-calls-card-reorder-details.md (Lines 98-121)

### [ ] Phase 3: Docs and verification

- [ ] Task 3.1: Update release notes and Cloudflare sync docs as needed
  - Details: .copilot-tracking/details/20260513-cloudflare-webview-sync-duplicate-calls-card-reorder-details.md (Lines 127-147)

- [ ] Task 3.2: Run the mandatory verification commands
  - Details: .copilot-tracking/details/20260513-cloudflare-webview-sync-duplicate-calls-card-reorder-details.md (Lines 149-168)

## Dependencies

- Existing hybrid transport state in `packages/kanban-lite/src/webview/standalone-shim.ts`
- Existing shared message typing in `packages/kanban-lite/src/shared/types/messages.ts`
- Existing Worker invalidation flow in `packages/kanban-lite/src/worker/worker-entry.ts`
- Generated Durable Object coordination in `scripts/lib/cloudflare-worker-durable-objects.mjs`
- Regression anchors in `packages/kanban-lite/src/webview/standalone-shim.test.ts` and `packages/kanban-lite/src/worker/live-sync-runtime.test.ts`
- Root validation commands: `pnpm exec tsc --noEmit`, `nr build`, `nr test`, and `nr e2e`

## Success Criteria

- Cloudflare hybrid mode stops sending redundant origin-tab `POST /api/webview-sync` replays for the same successful local mutation.
- Other tabs still receive `syncRequired` invalidations and refresh correctly.
- Reconnect-driven transport renegotiation still produces one valid authoritative resync.
- The initiating tab no longer shows move-card order bounce caused solely by its own invalidation echo.
- Focused regressions cover origin-tab deduplication and move-card stability, and the required verification commands pass with no new failures.
