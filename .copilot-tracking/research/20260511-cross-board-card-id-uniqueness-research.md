<!-- markdownlint-disable-file -->

# Research: Cross-Board Card ID Uniqueness

## Summary

When a new card is created, the repo intends the card ID to be globally unique
across all boards, because card lookup and card-scoped mutations resolve by
`cardId` alone. That invariant is documented in config types and already tested
for the happy path, but the actual create flow still trusts `config.nextCardId`
without checking whether the chosen ID already exists anywhere in storage. If
the config counter drifts behind real card data, `createCard()` can mint a
duplicate ID and break the global lookup assumption.

The safest fix is SDK-first in `packages/kanban-lite/src/sdk/modules/cards/crud.ts`:
keep the existing counter as the fast starting point, then verify the candidate
ID is unused across all boards before the card is written. Only when a
collision is detected should the SDK fall back to scanning existing card IDs,
pick the next free numeric ID, and advance the workspace-level counter.

---

## 1. Research validation and tool findings

### 1.1 Existing planning state

- `file_search` found no existing research, plan, details, or prompt file for
  this card-ID uniqueness issue.
- `.copilot-tracking/research/` currently contains unrelated task research only:
  - `20260501-sdk-remote-mode-research.md`
  - `20260502-board-import-export-settings-research.md`
  - `20260506-all-boards-overview-page-research.md`
- `file_search` for `**/task-researcher.agent.md` returned no results, so the
  Task Planner mode’s referenced research-agent file is not present in this
  workspace.

### 1.2 Verified repo investigation

- The repo-level structural overview was gathered with the required
  `hypergrep --model "" .` session-start command.
- `hypergrep --impact "allocateCardId" .` shows a very small direct runtime
  blast radius: `createCard()` is the only production caller, with one config
  regression test also exercising the helper.
- `grep_search` and `read_file` confirm the relevant seams are concentrated in:
  - `packages/kanban-lite/src/sdk/modules/cards/crud.ts`
  - `packages/kanban-lite/src/shared/config/io.ts`
  - `packages/kanban-lite/src/shared/config/types.ts`
  - `packages/kanban-lite/src/sdk/__tests__/multi-board.test.ts`
  - `packages/kanban-lite/src/sdk/plugins/types.ts`
- `grep_search` across standalone, CLI, and MCP shows those surfaces already
  delegate card creation to `sdk.createCard(...)`, so a correct SDK fix should
  flow through all hosts without new request-schema changes.

### 1.3 External source research gathered

- MDN Set reference:
  `https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Set`
- MDN `Set.prototype.has()` reference:
  `https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Set/has`

These sources confirm:

- `Set` stores only unique values.
- `Set.prototype.has()` is the standard membership check and is, on average,
  faster than linear array membership checks for similarly sized collections.
- A `Set<number>` is an appropriate JavaScript data structure for a
  collision-recovery path that needs to skip already-used numeric card IDs.

---

## 2. Current repo structure and implementation seams

### 2.1 The current create flow allocates before it verifies

- `packages/kanban-lite/src/sdk/modules/cards/crud.ts:235-286`
  implements `createCard(...)`.
- `packages/kanban-lite/src/sdk/modules/cards/crud.ts:247`
  calls `allocateCardId(ctx.workspaceRoot, resolvedBoardId)`.
- The returned numeric ID is used immediately to build the card filename and
  the persisted card record.

Important implication:

- today’s create path assumes `allocateCardId(...)` always returns a globally
  unused ID
- there is no cross-board storage check between allocation and write

### 2.2 The shared config layer documents a stronger guarantee than it enforces

- `packages/kanban-lite/src/shared/config/types.ts:353-357`
  documents `KanbanConfig.nextCardId` as a global auto-increment counter shared
  across all boards so every card gets a unique numeric ID.
- `packages/kanban-lite/src/shared/config/types.ts:217-221`
  marks `BoardConfig.nextCardId` as deprecated and says the workspace-level
  counter is now the uniqueness source of truth.
- `packages/kanban-lite/src/shared/config/io.ts:512-518`
  shows `allocateCardId(...)` simply returns `config.nextCardId`, increments it
  by one, writes the config, and returns the old value.

Important implication:

- the global uniqueness guarantee currently depends on the config counter being
  accurate already
- the helper itself does not inspect real card storage

### 2.3 Counter synchronization is real, but only partial and opportunistic

- `packages/kanban-lite/src/sdk/modules/cards/crud.ts:89-98`
  extracts numeric IDs from the cards returned by `listCardsRaw(...)` and calls
  `syncCardIdCounter(...)`.
- `packages/kanban-lite/src/shared/config/io.ts:539-545`
  updates `config.nextCardId` to `max(existingIds) + 1` when the current global
  counter is behind the maximum observed ID.
- `packages/kanban-lite/src/shared/config/io.ts:421-425`
  repairs a missing global counter by taking the maximum of per-board
  `nextCardId` values.

Important implication:

- the sync path only runs after a specific board has been scanned
- the read-config migration path uses board counters, not the actual cards on
  disk or in the active storage provider
- a stale `config.nextCardId` can survive long enough for `createCard()` to use
  it, especially when cards were created or copied outside the normal flow

### 2.4 Global card lookup already assumes cross-board uniqueness

- `packages/kanban-lite/src/sdk/modules/cards/crud.ts:149-158`
  documents `getCard(...)` as searching boards in config order until it finds
  the globally unique matching card.
- `packages/kanban-lite/src/sdk/modules/cards/crud.ts:155-171`
  and related helpers implement that board-by-board lookup.
- Many card-scoped SDK operations throw `Card not found: ${cardId}` and resolve
  the target card by `cardId` alone after relying on that global lookup path.

Important implication:

- duplicate card IDs across boards are not a cosmetic problem
- they would make cross-board mutation targeting ambiguous for comments,
  attachments, logs, card-state APIs, and transfer/move/update flows

### 2.5 The storage interface supports a portable collision check

- `packages/kanban-lite/src/sdk/plugins/types.ts:51`
  requires every storage engine to implement `scanCards(boardDir, boardId)`.
- `packages/kanban-lite/src/sdk/plugins/types.ts:61`
  allows engines to optionally implement `getCardById(boardDir, boardId, cardId)`
  for targeted lookups.
- `packages/kanban-lite/src/sdk/modules/cards/crud.ts:117-143`
  already uses `getCardById` when available and falls back to a scan otherwise.

Important implication:

- a collision guard can be written once in the SDK and work for every provider
- the efficient path can use `getCardById(...)` when present
- the universal fallback can still scan every board safely when a targeted
  lookup is unavailable

### 2.6 API, CLI, and MCP parity already flows through the SDK create path

- `packages/kanban-lite/src/standalone/mutationService.ts:41-48`
  routes standalone card creation through `ctx.sdk.createCard(...)`.
- `packages/kanban-lite/src/standalone/internal/routes/boards/task-routes.ts:106-111`
  also calls `sdk.createCard(...)`.
- `packages/kanban-lite/src/cli/commands/cards.ts:247`
  creates cards via `sdk.createCard(...)`.
- `packages/kanban-lite/src/mcp-server/tools/cards.ts:163-171`
  creates cards via `sdk.createCard(...)`.

Important implication:

- this is an SDK-first behavior fix, not a multi-surface schema feature
- no API, CLI, or MCP request-contract changes appear necessary
- one correct SDK fix should preserve parity automatically

### 2.7 Existing tests cover the happy path, not stale-counter recovery

- `packages/kanban-lite/src/sdk/__tests__/multi-board.test.ts:343-360`
  verifies cards created on two boards get different IDs in the normal flow.
- `packages/kanban-lite/src/sdk/__tests__/multi-board.test.ts:362-389`
  verifies card-scoped reads and mutations work across boards when IDs are
  unique.
- `packages/kanban-lite/src/sdk/__tests__/migration.test.ts:391-424`
  verifies `allocateCardId(...)` preserves unrelated config fields during write,
  but it does not verify collision recovery against real stored cards.

Important implication:

- there is no regression coverage for the exact failure described by the user:
  stale counter + existing card on another board + new card creation

---

## 3. What the bug means in this repo

### 3.1 Expected behavior

When any surface creates a new card:

1. the new card ID must be unused across every board in the workspace
2. the ID must remain compatible with the existing numeric filename convention
3. the workspace-level `nextCardId` must move past the chosen ID so the next
   creation does not reuse it
4. no API or host contract should need to change, because this is an internal
   uniqueness guarantee

### 3.2 Actual failure mode

If `config.nextCardId` is behind the real cards stored in the workspace,
`createCard()` can still allocate the stale number and immediately write a new
card with that duplicate ID.

Likely ways the counter can drift behind storage include:

- manually copied or edited card files
- storage/provider migration edge cases
- older or externally modified workspaces where cards exist but the config
  counter was not advanced first
- boards that have not yet been scanned in the current runtime, so the
  opportunistic `syncCardIdCounter(...)` path never ran

### 3.3 Scope recommendation

Keep this task tightly focused on **preventing new collisions**.

Recommended scope:

- make new card creation collision-safe across all boards
- preserve the existing public create-card API
- add regression tests for stale-counter recovery
- update relevant docs/comments to match the actual guarantee

Out of scope for this task:

- retroactively repairing already-duplicated card IDs in existing workspaces
- introducing a new ID format
- adding user-facing migration commands for duplicate cleanup

---

## 4. Recommended implementation approach

### 4.1 Fix the bug in the async SDK create path

The main change belongs in `packages/kanban-lite/src/sdk/modules/cards/crud.ts`,
not only in `shared/config/io.ts`.

Why:

- `allocateCardId(...)` is synchronous and only sees config state
- the storage engine APIs that can verify real card existence are async and live
  on the SDK context
- `createCard(...)` is the only production caller of `allocateCardId(...)`

### 4.2 Use the current counter as the fast path, then verify it

Recommended algorithm:

1. call `allocateCardId(...)` to reserve the current counter value
2. check whether that candidate ID already exists on any board
3. if it does not exist, continue exactly as today
4. if it does exist:
   - collect the existing numeric card IDs across all boards
   - load them into `new Set<number>(...)`
   - increment the candidate until `!takenIds.has(candidate)`
   - advance `config.nextCardId` past the final chosen value before writing the
     card

This keeps the common case cheap while still fixing the stale-counter bug.

### 4.3 Reuse the storage engine’s targeted lookup when available

The collision check should mirror the existing card lookup pattern:

- fast path: for each board, call `getCardById(...)` when the active storage
  engine implements it
- fallback: when `getCardById(...)` is unavailable, scan that board with
  `scanCards(...)` and test the IDs in memory

That approach matches the existing storage abstraction instead of adding new
provider requirements.

### 4.4 Suggested helper shape

A focused internal helper in `crud.ts` is enough. For example:

```ts
async function allocateUniqueCardIdAcrossBoards(
  ctx: SDKContext,
  candidate: number,
): Promise<number>
```

Expected behavior of the helper:

- accept the counter-derived candidate ID
- return it unchanged if no card already uses it
- on collision, gather numeric IDs across all boards, choose the next free one,
  and advance the workspace-level counter past that final value

This keeps the public SDK surface unchanged.

### 4.5 Config/JSDoc cleanup to consider in the same task

Because the current docs describe a stronger guarantee than the raw counter
enforces by itself, the implementation task should review whether small comment
updates are needed in:

- `packages/kanban-lite/src/shared/config/io.ts`
- `packages/kanban-lite/src/shared/config/types.ts`

The goal is not a wording rewrite marathon. The goal is to keep the docs aligned
with the actual invariant after the bug fix lands.

---

## 5. Testing guidance from existing patterns

### 5.1 SDK tests to add

Add focused regression coverage in
`packages/kanban-lite/src/sdk/__tests__/multi-board.test.ts`.

Recommended cases:

1. **stale global counter on another board**
   - create or seed a card on board A with ID `1`
   - create board B
   - force `config.nextCardId = 1`
   - create a new card on board B
   - assert the new card skips `1` and chooses the next unused ID

2. **counter advances past the recovered ID**
   - after the collision-recovery create, read `.kanban.json`
   - assert `nextCardId` is greater than the chosen fallback ID

3. **existing happy-path uniqueness still works**
   - preserve or lightly extend the current cross-board uniqueness test so the
     new guard does not regress the normal flow

### 5.2 Surface validation guidance

Because standalone, CLI, and MCP already call `sdk.createCard(...)`, the task
does not appear to need transport or schema changes.

Recommended validation:

- rely on SDK regression tests for the behavior itself
- still run the mandatory repo-wide verification commands so the delegated host
  surfaces are exercised by their existing test coverage

---

## 6. External implementation references

### 6.1 MDN Set

The MDN Set reference confirms:

- a `Set` stores unique values only
- membership is checked via `.has(...)`
- `Set` is the standard JavaScript container for uniqueness constraints

Reference:

- `https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Set`

### 6.2 MDN Set.prototype.has()

The MDN `Set.prototype.has()` reference provides the exact membership API and a
simple example for presence checks.

Reference:

- `https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Set/has`

---

## 7. Implementation guidance

- Keep the fix SDK-first in `cards/crud.ts`.
- Do not change create-card request contracts unless investigation during
  implementation proves a surface bypasses the SDK path.
- Prefer a small internal helper over expanding `shared/config/io.ts` into an
  async storage-aware layer.
- Preserve the existing global numeric ID format and filename generation.
- Add regression coverage for stale counters, not just the happy path.
- Update `README.md` and `CHANGELOG.md` if the task is treated as a user-facing
  bug fix under repo policy.
- Run the required verification commands before considering the implementation
  done.

---

## 8. Recommended task breakdown

1. Add an SDK-side collision guard for card creation in `cards/crud.ts`.
2. Align any affected counter/JSDoc comments in shared config files.
3. Add stale-counter regression tests in `multi-board.test.ts`.
4. Update `README.md` and `CHANGELOG.md` if required by repo policy.
5. Run `pnpm exec tsc --noEmit`, `nr build`, `nr test`, and `nr e2e`.
