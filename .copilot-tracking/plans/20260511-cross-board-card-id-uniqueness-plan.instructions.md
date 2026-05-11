---
applyTo: ".copilot-tracking/changes/20260511-cross-board-card-id-uniqueness-changes.md"
---

<!-- markdownlint-disable-file -->

# Task Checklist: Cross-Board Card ID Uniqueness

## Overview

Prevent new card creation from reusing a card ID that already exists on another board, even when the workspace-level `nextCardId` counter has drifted behind stored card data.

## Objectives

- Add an SDK-first collision guard so `createCard(...)` always chooses an unused numeric card ID across the entire workspace.
- Preserve the existing create-card contracts for standalone, CLI, and MCP by fixing the shared SDK path they already call.
- Add regression coverage for stale-counter recovery and verify the repo with the required validation commands.
- Update user-facing documentation and release notes if the fix is treated as a user-visible correctness change.

## Research Summary

### Project Files

- `packages/kanban-lite/src/sdk/modules/cards/crud.ts` - current `createCard(...)` flow and global card lookup assumption
- `packages/kanban-lite/src/shared/config/io.ts` - `allocateCardId(...)`, `syncCardIdCounter(...)`, and config fallback behavior
- `packages/kanban-lite/src/shared/config/types.ts` - documented global uniqueness invariant for `nextCardId`
- `packages/kanban-lite/src/sdk/plugins/types.ts` - storage engine scan and targeted ID lookup seams
- `packages/kanban-lite/src/sdk/__tests__/multi-board.test.ts` - existing happy-path cross-board uniqueness tests
- `packages/kanban-lite/src/standalone/mutationService.ts` - standalone card creation delegates to `sdk.createCard(...)`
- `packages/kanban-lite/src/cli/commands/cards.ts` - CLI card creation delegates to `sdk.createCard(...)`
- `packages/kanban-lite/src/mcp-server/tools/cards.ts` - MCP card creation delegates to `sdk.createCard(...)`

### External References

- #file:../research/20260511-cross-board-card-id-uniqueness-research.md - validated repo investigation, root-cause analysis, and implementation guidance
- #fetch:https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Set - `Set` uniqueness semantics and membership-performance rationale
- #fetch:https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Set/has - canonical membership-check API for collision recovery

### Standards References

- #file:../../AGENTS.md - SDK-first architecture, README/CHANGELOG rule, and mandatory verification commands
- #file:../../.github/instructions/core-surface.instructions.md - SDK-first sequencing and parity expectations for shared behavior changes

## Implementation Checklist

### [ ] Phase 1: SDK collision-safe card creation

- [ ] Task 1.1: Add a cross-board collision guard to the SDK create flow
  - Details: .copilot-tracking/details/20260511-cross-board-card-id-uniqueness-details.md (Lines 13-43)

- [ ] Task 1.2: Keep shared counter semantics and comments aligned with the fix
  - Details: .copilot-tracking/details/20260511-cross-board-card-id-uniqueness-details.md (Lines 45-70)

### [ ] Phase 2: Regression coverage

- [ ] Task 2.1: Add stale-counter and cross-board fallback tests
  - Details: .copilot-tracking/details/20260511-cross-board-card-id-uniqueness-details.md (Lines 74-101)

### [ ] Phase 3: Docs and verification

- [ ] Task 3.1: Update user-facing docs for the collision guard if required
  - Details: .copilot-tracking/details/20260511-cross-board-card-id-uniqueness-details.md (Lines 105-124)

- [ ] Task 3.2: Run the mandatory verification commands
  - Details: .copilot-tracking/details/20260511-cross-board-card-id-uniqueness-details.md (Lines 126-148)

## Dependencies

- Existing SDK `createCard(...)` path in `packages/kanban-lite/src/sdk/modules/cards/crud.ts`
- Existing storage engine contract in `packages/kanban-lite/src/sdk/plugins/types.ts`
- Existing multi-board regression test anchor in `packages/kanban-lite/src/sdk/__tests__/multi-board.test.ts`
- Root validation commands: `pnpm exec tsc --noEmit`, `nr build`, `nr test`, and `nr e2e`

## Success Criteria

- New card creation never reuses a numeric ID that already exists on another board, even when `config.nextCardId` is stale.
- The workspace-level `nextCardId` is advanced beyond any fallback ID chosen during collision recovery.
- Standalone, CLI, and MCP continue to inherit the fix through the shared SDK path without new request-contract changes.
- Regression tests cover the stale-counter scenario and the required verification commands pass with no new failures.
