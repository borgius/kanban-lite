# Design: Card Format Version Field

**Date:** 2026-02-26
**Status:** Approved

## Summary

Stamp newly created cards with a `version: 1` schema version field as the first line of their YAML frontmatter. Existing cards without the field parse as `version: 0`. No upgrade-on-update; the field is informational only.

## Decisions

- **Version purpose:** Schema version (not app version) — identifies which frontmatter format the card was written with.
- **Placement:** First field in frontmatter, before `id`.
- **Legacy cards:** Missing field → parsed as `version: 0`.
- **Approach:** New cards only (Option A) — no upgrade on update, no migration command.

## Data Model

### `src/shared/types.ts`

Add constant:
```ts
export const CARD_FORMAT_VERSION = 1
```

Add `version: number` as the first field to both `Feature` and `FeatureFrontmatter` interfaces.

## Serializer (`src/sdk/parser.ts` — `serializeFeature`)

`version: <n>` is written as the first line after the opening `---`:

```yaml
---
version: 1
id: "42"
status: "todo"
...
```

The `feature.version` value is written literally (no quotes).

## Parser (`src/sdk/parser.ts` — `parseFeatureFile`)

Read `version` from frontmatter using `getValue('version')`. Parse with `parseInt(..., 10)`. Default to `0` if missing or unparseable:

```ts
version: parseInt(getValue('version'), 10) || 0,
```

## SDK (`src/sdk/KanbanSDK.ts` — `createCard`)

Add `version: CARD_FORMAT_VERSION` to the card object literal (import `CARD_FORMAT_VERSION` from `../shared/types`).

## Tests

Update `src/sdk/__tests__/KanbanSDK.test.ts`:
- Verify `createCard` returns a card with `version === 1`.
- Verify parsing a card without a version field returns `version === 0`.
- Verify serialized output includes `version: 1` as the first frontmatter field.

## Files Changed

| File | Change |
|------|--------|
| `src/shared/types.ts` | Add `CARD_FORMAT_VERSION = 1` constant; add `version: number` to `Feature` and `FeatureFrontmatter` |
| `src/sdk/parser.ts` | `serializeFeature`: write `version` first; `parseFeatureFile`: read `version`, default `0` |
| `src/sdk/KanbanSDK.ts` | `createCard`: set `version: CARD_FORMAT_VERSION` |
| `src/sdk/__tests__/KanbanSDK.test.ts` | Add version-related assertions |
