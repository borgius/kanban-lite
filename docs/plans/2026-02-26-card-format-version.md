# Card Format Version Field Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stamp newly created cards with a `version: 1` schema version field as the first frontmatter field, so future format changes can be detected and migrated.

**Architecture:** Add `CARD_FORMAT_VERSION = 1` constant and `version: number` to the `Feature`/`FeatureFrontmatter` types. Update the serializer to write `version` first, the parser to read it (defaulting to `0` for legacy cards), and `createCard` to set `version: CARD_FORMAT_VERSION`.

**Tech Stack:** TypeScript, vitest (tests via `npm test`), `npx tsc --noEmit` for type checking.

---

### Task 1: Add type definitions and constant

**Files:**
- Modify: `src/shared/types.ts`

**Step 1: Add the constant and update both interfaces**

In `src/shared/types.ts`, add the constant after the imports/before the types:

```ts
/** Current card frontmatter schema version. Increment when the format changes. */
export const CARD_FORMAT_VERSION = 1
```

Add `version: number` as the **first field** to the `Feature` interface (before `id`):

```ts
export interface Feature {
  /** Card frontmatter schema version. 0 = legacy (pre-versioning). */
  version: number
  /** Unique identifier for the card (e.g. `'42-build-dashboard'`). */
  id: string
  // ... rest unchanged
}
```

Add `version: number` as the **first field** to the `FeatureFrontmatter` interface (before `id`):

```ts
export interface FeatureFrontmatter {
  /** Card frontmatter schema version. 0 = legacy (pre-versioning). */
  version: number
  /** Unique card identifier. */
  id: string
  // ... rest unchanged
}
```

**Step 2: Type-check**

Run: `npx tsc --noEmit`

Expected: Errors about `version` being missing in `parseFeatureFile` return value and `createCard` card literal. That's fine — we'll fix them in the next tasks.

---

### Task 2: Update the parser (read and write version)

**Files:**
- Modify: `src/sdk/parser.ts`

**Step 3: Write failing test for version serialization**

In `src/sdk/__tests__/KanbanSDK.test.ts`, add inside the existing `describe('createCard', ...)` block:

```ts
it('should write version: 1 as the first frontmatter field', async () => {
  const card = await sdk.createCard({ content: '# Version Test' })
  const onDisk = fs.readFileSync(card.filePath, 'utf-8')
  // version must be the very first field after opening ---
  expect(onDisk).toMatch(/^---\nversion: 1\n/)
})
```

**Step 4: Run test to verify it fails**

Run: `npm test -- --reporter=verbose 2>&1 | grep -A5 "version: 1"`

Expected: FAIL — the current serializer does not write `version`.

**Step 5: Update `serializeFeature` in `src/sdk/parser.ts`**

Add `version` as the **first line** in the `lines` array (before `id`):

```ts
export function serializeFeature(feature: Feature): string {
  const lines = [
    '---',
    `version: ${feature.version}`,   // ← ADD THIS LINE
    `id: "${feature.id}"`,
    // ... rest unchanged
  ]
```

**Step 6: Update `parseFeatureFile` in `src/sdk/parser.ts`**

Add `version` as the **first field** in the returned object literal (before `id`):

```ts
return {
  version: parseInt(getValue('version'), 10) || 0,   // ← ADD THIS LINE (default 0 for legacy)
  id: getValue('id') || extractIdFromFilename(filePath),
  // ... rest unchanged
}
```

**Step 7: Run the serialization test to confirm it passes**

Run: `npm test -- --reporter=verbose 2>&1 | grep -A5 "version: 1"`

Expected: PASS.

**Step 8: Type-check**

Run: `npx tsc --noEmit`

Expected: Still errors in `createCard` (next task). Parser errors should be gone.

---

### Task 3: Update `createCard` in KanbanSDK

**Files:**
- Modify: `src/sdk/KanbanSDK.ts`

**Step 9: Write failing test for createCard version field**

In `src/sdk/__tests__/KanbanSDK.test.ts`, add inside `describe('createCard', ...)`:

```ts
it('should set version to CARD_FORMAT_VERSION on new cards', async () => {
  const card = await sdk.createCard({ content: '# Version Card' })
  expect(card.version).toBe(1)
})
```

**Step 10: Run test to verify it fails**

Run: `npm test -- --reporter=verbose 2>&1 | grep -A3 "CARD_FORMAT_VERSION"`

Expected: FAIL — `createCard` doesn't set `version` yet.

**Step 11: Import the constant and update `createCard`**

In `src/sdk/KanbanSDK.ts`, update the import from `../shared/types`:

```ts
import { getTitleFromContent, generateFeatureFilename, extractNumericId, DELETED_STATUS_ID, CARD_FORMAT_VERSION } from '../shared/types'
```

In `createCard`, add `version: CARD_FORMAT_VERSION` as the **first field** of the card literal:

```ts
const card: Feature = {
  version: CARD_FORMAT_VERSION,        // ← ADD THIS LINE
  id: String(numericId),
  boardId: resolvedBoardId,
  // ... rest unchanged
}
```

**Step 12: Run all tests**

Run: `npm test`

Expected: All tests pass.

**Step 13: Type-check**

Run: `npx tsc --noEmit`

Expected: No errors.

---

### Task 4: Test legacy card parsing (version 0)

**Files:**
- Modify: `src/sdk/__tests__/KanbanSDK.test.ts`

**Step 14: Write test for legacy card parsing**

Add a test in a relevant `describe` block (e.g. after `describe('getCard', ...)` or in a new `describe('version', ...)`):

```ts
describe('version', () => {
  it('should parse legacy cards without version field as version 0', async () => {
    await sdk.init()
    // Write a card file with no version field (legacy format)
    writeCardFile(workspaceDir + '/.kanban', '1-legacy-card.md',
      `---
id: "1"
status: "backlog"
priority: "medium"
assignee: null
dueDate: null
created: "2025-01-01T00:00:00.000Z"
modified: "2025-01-01T00:00:00.000Z"
completedAt: null
labels: []
attachments: []
order: "a0"
---
# Legacy Card

No version field.`,
      'backlog'
    )
    const card = await sdk.getCard('1')
    expect(card).not.toBeNull()
    expect(card!.version).toBe(0)
  })
})
```

**Step 15: Run the test**

Run: `npm test`

Expected: All tests pass including the new legacy-card test.

---

### Task 5: Commit

**Step 16: Commit**

```bash
git add src/shared/types.ts src/sdk/parser.ts src/sdk/KanbanSDK.ts src/sdk/__tests__/KanbanSDK.test.ts docs/plans/2026-02-26-card-format-version.md docs/plans/2026-02-26-card-format-version-design.md
git commit -m "feat: add version field to card frontmatter schema"
```
