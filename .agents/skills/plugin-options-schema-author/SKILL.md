---
name: plugin-options-schema-author
description: Create or update kanban-lite plugin `optionsSchema()` / `uiSchema` metadata for shared Plugin Options forms. Use this whenever a task mentions plugin option schemas, `optionsSchema`, `uiSchema`, `policyOptionsSchemas`, JSON Forms provider options, secret field metadata, or schema-driven plugin settings editors.
license: MIT
metadata:
  author: kanban-lite
  version: "1.0.0"
---

# Plugin Options Schema Author

Use this skill whenever you are **creating or changing plugin settings schemas** for kanban-lite providers.

This skill exists to keep schema-driven plugin settings consistent across:

- provider exports,
- the shared Settings panel Plugin Options UI,
- SDK/API/CLI/MCP transport payloads,
- secret redaction behavior,
- and contributor-facing docs/tests.

## When this skill applies

Load this skill before making changes when the task involves any of the following:

- `optionsSchema()`
- `uiSchema`
- `optionsSchemas`
- `policyOptionsSchemas`
- `PluginSettingsOptionsSchemaMetadata`
- JSON Forms controls/layouts/rules for plugin options
- secret field metadata for plugin settings
- schema-driven provider configuration in the shared Plugin Options workflow

## First moves

Before editing files:

1. Read the current provider schema source.
2. Read `docs/plugins.md` sections covering plugin settings and `optionsSchema()`.
3. Read the relevant UI consumer when needed (for example `packages/kanban-lite/src/webview/components/SettingsPanel.tsx`).
4. If the task mentions JSON Forms behavior, consult the JSON Forms docs for:
   - controls
   - layouts
   - rules

## Core workflow

### 1. Keep `schema`, `uiSchema`, and `secrets` aligned

Every change to a provider options contract should review all three pieces together:

- `schema` defines the data contract
- `uiSchema` defines the editing experience
- `secrets` defines masking/write-only behavior

Do not update one and forget the others.

### 2. Prefer explicit `uiSchema` for non-trivial shapes

If the schema contains arrays, nested objects, or conceptually separate sections, prefer an explicit `uiSchema` instead of relying on the generated fallback.

Especially provide `uiSchema` when you need:

- section grouping,
- inline array item editors,
- stable labels,
- enum presentation tweaks,
- or conditional enable/show/hide behavior.

### 3. Use JSON Forms primitives intentionally

Prefer these patterns:

- `Group` for named sections
- `VerticalLayout` as the default container
- `HorizontalLayout` only when two small sibling controls genuinely benefit from side-by-side layout
- `Control` with explicit `label` when the generated label would be vague or unstable
- array `options.detail` for nested item editors
- `elementLabelProp` for readable array row summaries
- `showSortButtons` when array order matters to the user
- `rule` only when it adds clear UX value

Avoid ornamental `uiSchema` that merely mirrors the fallback without improving usability.

### 4. Rules should be modest and data-driven

When using JSON Forms rules:

- keep them local and easy to reason about,
- scope them to the smallest relevant value,
- prefer simple `SHOW` / `HIDE` / `ENABLE` / `DISABLE` conditions,
- and make sure the default editing path still works for empty/new items.

### 5. Secret fields must remain safe

If a field is secret-like (token, password, key, secret, hash), verify that:

- the secret path is declared in `secrets`,
- the UI remains compatible with masked write-only placeholders,
- and the schema description still makes sense once the shared secret hint is appended by the UI layer.

### 6. Add or update tests

When changing plugin settings schema metadata, add or update tests that cover:

- the JSON Schema contract,
- the `uiSchema` contract for key layout/detail/rule behavior,
- and secret metadata where applicable.

Prefer focused schema-metadata assertions over end-to-end UI snapshots unless the task explicitly needs UI rendering validation.

### 7. Update docs in the same task

When the contract or authoring guidance changes, update the relevant docs together:

- `README.md`
- `docs/plugins.md`
- the affected package README
- `CHANGELOG.md`
- this skill file if the workflow itself changed

## Practical checklist

- Is the JSON Schema still correct?
- Does the `uiSchema` clearly improve the editing experience?
- Are array editors using `options.detail` where appropriate?
- Are labels explicit where needed?
- Are rules minimal and correct for empty/new data?
- Are secret paths still complete and accurate?
- Are tests updated?
- Are docs updated?

## Avoid these mistakes

- Do not add a complex `uiSchema` for a single trivial scalar field.
- Do not add rules that block creating the first array item.
- Do not forget secret redaction metadata when adding token/password-like fields.
- Do not rely on fallback-generated layout for array-heavy schemas if the UX needs detail editors.
- Do not change provider option contracts without updating their docs/tests.
