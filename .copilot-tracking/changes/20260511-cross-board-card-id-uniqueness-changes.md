# Changes: Cross-Board Card ID Uniqueness

## Summary

Prevent `createCard(...)` from reusing a card ID that already exists on another board when `config.nextCardId` is stale.

## Files Changed

### Phase 1: SDK collision-safe card creation

- `packages/kanban-lite/src/sdk/modules/cards/crud.ts` — added `allocateUniqueCardIdAcrossBoards` internal helper; wired into `createCard`
- `packages/kanban-lite/src/shared/config/io.ts` — updated JSDoc on `allocateCardId` to clarify it does not perform a cross-board storage check

### Phase 2: Regression tests

- `packages/kanban-lite/src/sdk/__tests__/multi-board.test.ts` — added stale-counter collision-recovery tests

### Phase 3: Docs

- `CHANGELOG.md` — added bug-fix entry
