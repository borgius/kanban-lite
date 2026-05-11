<!-- markdownlint-disable-file -->

# Task Details: Cross-Board Card ID Uniqueness

## Research Reference

**Source Research**: #file:../research/20260511-cross-board-card-id-uniqueness-research.md

---

## Phase 1: SDK collision-safe card creation

### Task 1.1: Add a cross-board collision guard to the SDK create flow

Implement the uniqueness fix in the SDK create path so every host surface keeps
the same behavior without transport or schema changes.

- **Files**:
  - `packages/kanban-lite/src/sdk/modules/cards/crud.ts` - add the internal collision-check helper and wire it into `createCard(...)`
  - `packages/kanban-lite/src/sdk/plugins/types.ts` - reference only; use the existing `scanCards(...)` / optional `getCardById(...)` contract rather than inventing a new provider API
- **Implementation**:
  - Keep `createCard(...)` as the public behavior seam.
  - Use `allocateCardId(...)` as the initial candidate generator so the normal
    path stays cheap.
  - Before persisting the new card, verify that the candidate numeric ID is not
    already present on any board in the active storage provider.
  - Prefer the existing targeted lookup capability when the storage engine
    implements `getCardById(...)`; fall back to per-board scans when it does not.
  - If the candidate collides, gather existing numeric card IDs across the
    workspace, choose the next free numeric ID, and move the workspace-level
    counter past that chosen value before writing the card.
  - Preserve the current numeric ID format, filename generation, and create-card
    method signature.
- **Success**:
  - New cards never reuse an existing numeric card ID from another board.
  - The common create-card path stays SDK-first and surface-agnostic.
  - No API, CLI, or MCP request-contract changes are required.
- **Research References**:
  - #file:../research/20260511-cross-board-card-id-uniqueness-research.md (Lines 71-193) - Verified create path, config invariant, storage seams, parity delegates, and existing test gap
  - #file:../research/20260511-cross-board-card-id-uniqueness-research.md (Lines 241-302) - Recommended implementation approach and helper shape
- **Dependencies**:
  - Existing `createCard(...)` implementation in `cards/crud.ts`
  - Existing storage engine contract in `sdk/plugins/types.ts`

### Task 1.2: Keep shared counter semantics and comments aligned with the fix

Review the shared config helpers and comments so the documented uniqueness story
matches the runtime behavior after the SDK guard is added.

- **Files**:
  - `packages/kanban-lite/src/shared/config/io.ts` - adjust comments or add the smallest helper needed to advance `nextCardId` after fallback allocation
  - `packages/kanban-lite/src/shared/config/types.ts` - update the documented invariant only if the source comments become misleading after the implementation
- **Implementation**:
  - Keep the public `allocateCardId(...)` API shape stable unless the
    implementation proves a tiny helper addition is cleaner than reusing
    `syncCardIdCounter(...)`.
  - Avoid turning the shared config module into a storage-aware async layer.
  - Limit comment/JSDoc edits to the minimum needed to describe the real
    invariant once the collision guard exists.
- **Success**:
  - Shared config comments no longer over-promise behavior that only the SDK
    create path enforces.
  - Any helper added for counter advancement remains small and narrowly scoped.
- **Research References**:
  - #file:../research/20260511-cross-board-card-id-uniqueness-research.md (Lines 88-125) - Current global-counter documentation versus actual enforcement
  - #file:../research/20260511-cross-board-card-id-uniqueness-research.md (Lines 303-314) - JSDoc/comment cleanup guidance
- **Dependencies**:
  - Task 1.1 completion

---

## Phase 2: Regression coverage

### Task 2.1: Add stale-counter and cross-board fallback tests

Extend the existing multi-board test anchor so the exact reported bug becomes a
permanent regression test.

- **Files**:
  - `packages/kanban-lite/src/sdk/__tests__/multi-board.test.ts` - add stale-counter collision-recovery coverage near the existing cross-board uniqueness tests
  - `packages/kanban-lite/src/sdk/__tests__/migration.test.ts` - only if a focused config-level assertion is needed for any shared counter helper introduced in Phase 1
- **Implementation**:
  - Add a test where an existing card on one board already uses the numeric ID
    that `config.nextCardId` would otherwise hand out.
  - Force the counter behind the real data, create a new card on another board,
    and assert the SDK skips the collision and selects the next unused numeric
    ID.
  - Assert the workspace config advances `nextCardId` beyond the recovered ID.
  - Preserve the existing happy-path cross-board uniqueness test coverage.
- **Success**:
  - The reported stale-counter collision scenario is covered by an automated
    test.
  - The next-card counter is verified after fallback allocation, not just the
    returned card ID.
- **Research References**:
  - #file:../research/20260511-cross-board-card-id-uniqueness-research.md (Lines 176-193) - Existing happy-path test anchor and current gap
  - #file:../research/20260511-cross-board-card-id-uniqueness-research.md (Lines 317-352) - Recommended stale-counter regression cases and validation scope
- **Dependencies**:
  - Phase 1 completion

---

## Phase 3: Docs and verification

### Task 3.1: Update user-facing docs for the collision guard if required

Apply the repo policy for user-facing fixes without broadening the task beyond
what the bug actually changes.

- **Files**:
  - `README.md` - mention the stronger card-ID uniqueness guarantee only if the existing docs describe card creation behavior in a way users rely on
  - `CHANGELOG.md` - add a concise bug-fix note for cross-board card ID collision avoidance
- **Implementation**:
  - Keep documentation updates short and factual.
  - Do not invent a new feature narrative; this is a correctness fix.
  - If source comments or generated docs are affected, update the source comments
    instead of editing generated output directly.
- **Success**:
  - User-facing release notes reflect the fix.
  - Documentation stays aligned with the SDK-first implementation.
- **Research References**:
  - #file:../research/20260511-cross-board-card-id-uniqueness-research.md (Lines 379-402) - Documentation and implementation guidance
- **Dependencies**:
  - Phases 1-2 complete

### Task 3.2: Run the mandatory verification commands

Validate the final implementation against repo policy before considering the
task complete.

- **Files**:
  - No source files; verification only
- **Implementation**:
  - Run `pnpm exec tsc --noEmit`
  - Run `nr build`
  - Run `nr test`
  - Run `nr e2e`
  - Fix any new failures introduced by the implementation before closing the
    task.
- **Success**:
  - TypeScript, build, unit tests, and E2E all pass with no new failures.
- **Research References**:
  - #file:../research/20260511-cross-board-card-id-uniqueness-research.md (Lines 395-400) - Final task breakdown and verification expectation
  - #file:../../AGENTS.md - Mandatory validation order and completion standard
- **Dependencies**:
  - Task 3.1 completion

---

## Dependencies

- The SDK is the source of truth for shared card-creation behavior.
- `core-surface.instructions.md` applies because the fix lives in SDK code and
  automatically affects standalone, CLI, and MCP surfaces through existing
  delegation.
- The current storage engine contract already provides the required lookup seams
  (`scanCards(...)` and optional `getCardById(...)`).

## Success Criteria

- Card creation never reuses an ID already present on another board, even when
  `config.nextCardId` is stale.
- The workspace-level `nextCardId` is advanced past any fallback ID chosen by
  the collision guard.
- Existing host surfaces keep parity by continuing to delegate through
  `sdk.createCard(...)`.
- Regression tests cover the stale-counter case, and the required verification
  commands pass.
