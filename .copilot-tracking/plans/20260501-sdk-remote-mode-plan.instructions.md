---
applyTo: ".copilot-tracking/changes/20260501-sdk-remote-mode-changes.md"
---

<!-- markdownlint-disable-file -->

# Task Checklist: SDK Remote Mode (API URL + Token)

## Overview

Add a `RemoteKanbanSDK` class that transparently proxies all SDK operations to a remote kanban-lite REST API when the client supplies a `remoteUrl` (and optional `token`), with an identical public interface to the local `KanbanSDK`.

## Objectives

- Clients can `new RemoteKanbanSDK({ remoteUrl, token })` without any local filesystem access
- All common card, board, comment, checklist, and attachment methods are available
- Response shapes (`Card`, `BoardInfo`, `Comment`, `LogEntry`) are identical to local SDK
- TypeScript compilation succeeds with no new errors
- Exported from the SDK barrel so it is discoverable from `kanban-lite/sdk`

## Research Summary

### Project Files

- `packages/kanban-lite/src/sdk/KanbanSDK-core.ts` - Constructor, `SDKOptions`, `StorageEngine` injection path
- `packages/kanban-lite/src/sdk/types/events.ts` - `SDKOptions` interface (Lines 388–440)
- `packages/kanban-lite/src/sdk/plugins/types.ts` - `StorageEngine` interface (Lines 1–80)
- `packages/kanban-lite/src/sdk/modules/context.ts` - `SDKContext` internal interface
- `packages/kanban-lite/src/sdk/index.ts` - SDK barrel exports
- `packages/kanban-lite/src/sdk/KanbanSDK-data.ts` - Full public SDK method surface
- `packages/kanban-lite/src/standalone/internal/routes/tasks/crud-routes.ts` - REST endpoint shapes

### External References

- #file:../research/20260501-sdk-remote-mode-research.md - Full codebase analysis and implementation approach
- #fetch:http://localhost:3000/api/docs - Live OpenAPI spec (when server is running)

### Standards References

- #file:../../AGENTS.md - File size limits, layer conventions, no logic in barrels

## Implementation Checklist

### [ ] Phase 1: Core HTTP client and card operations

- [ ] Task 1.1: Create `packages/kanban-lite/src/sdk/remote/` directory and `RemoteKanbanSDK.ts`

  - Details: .copilot-tracking/details/20260501-sdk-remote-mode-details.md (Lines 18–95)

- [ ] Task 1.2: Implement `init()`, `listCards()`, `getCard()`, `createCard()`, `updateCard()`, `deleteCard()`, `moveCard()`

  - Details: .copilot-tracking/details/20260501-sdk-remote-mode-details.md (Lines 96–175)

- [ ] Task 1.3: Implement event bus stubs (`on`, `once`, `off`, `onAny`, `waitFor`, etc.)

  - Details: .copilot-tracking/details/20260501-sdk-remote-mode-details.md (Lines 176–210)

### [ ] Phase 2: Board and auxiliary operations

- [ ] Task 2.1: Implement board methods (`listBoards`, `getBoard`, `createBoard`, `updateBoard`, `deleteBoard`)

  - Details: .copilot-tracking/details/20260501-sdk-remote-mode-details.md (Lines 213–260)

- [ ] Task 2.2: Implement comment methods (`listComments`, `addComment`, `updateComment`, `deleteComment`)

  - Details: .copilot-tracking/details/20260501-sdk-remote-mode-details.md (Lines 261–310)

- [ ] Task 2.3: Implement checklist methods (`addChecklistItem`, `editChecklistItem`, `deleteChecklistItem`, `checkChecklistItem`, `uncheckChecklistItem`)

  - Details: .copilot-tracking/details/20260501-sdk-remote-mode-details.md (Lines 311–360)

- [ ] Task 2.4: Implement attachment methods (`addAttachmentData`, `removeAttachment`, `getAttachmentData`) and null-returning stubs (`getLocalCardPath`, `getAttachmentStoragePath`, `materializeAttachment`)

  - Details: .copilot-tracking/details/20260501-sdk-remote-mode-details.md (Lines 361–420)

### [ ] Phase 3: Exports and SDK options

- [ ] Task 3.1: Create `packages/kanban-lite/src/sdk/remote/index.ts` barrel

  - Details: .copilot-tracking/details/20260501-sdk-remote-mode-details.md (Lines 423–440)

- [ ] Task 3.2: Export `RemoteKanbanSDK` from `packages/kanban-lite/src/sdk/index.ts`

  - Details: .copilot-tracking/details/20260501-sdk-remote-mode-details.md (Lines 441–455)

- [ ] Task 3.3: Add `remoteUrl?` and `token?` fields to `SDKOptions` in `packages/kanban-lite/src/sdk/types/events.ts`

  - Details: .copilot-tracking/details/20260501-sdk-remote-mode-details.md (Lines 456–475)

### [ ] Phase 4: Validation

- [ ] Task 4.1: Run `pnpm exec tsc --noEmit` in the kanban-lite package and fix any errors

  - Details: .copilot-tracking/details/20260501-sdk-remote-mode-details.md (Lines 478–490)

- [ ] Task 4.2: Verify smoke-test usage compiles and runs against a live server (optional, documented)

  - Details: .copilot-tracking/details/20260501-sdk-remote-mode-details.md (Lines 491–510)

## Dependencies

- Node.js 18+ global `fetch` (already required by repo)
- Existing `Card`, `BoardInfo`, `Comment`, `LogEntry`, `KanbanColumn`, `Priority` types from `../shared/types`
- Existing `CreateCardInput` from `./types`
- No new npm dependencies

## Success Criteria

- `new RemoteKanbanSDK({ remoteUrl: "http://localhost:3000", token: "tok" })` constructs without filesystem access
- `await sdk.listCards()` proxies to `GET /api/tasks` and returns `Card[]`
- TypeScript compilation (`pnpm exec tsc --noEmit`) reports no new errors
- `RemoteKanbanSDK` is importable as `import { RemoteKanbanSDK } from "kanban-lite/sdk"`
