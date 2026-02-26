# Label Colors & Management

## Overview

Add color support for labels and a management screen to create, edit, rename, and delete label definitions with colors and optional groups.

## Data Model

### LabelDefinition

New interface in `types.ts`:

```typescript
export interface LabelDefinition {
  color: string   // hex color, e.g. "#e11d48"
  group?: string  // optional group name, e.g. "Type", "Priority"
}
```

### Storage

Labels stored as a map in `.kanban.json` alongside existing config:

```json
{
  "columns": [...],
  "showLabels": true,
  "labels": {
    "bug": { "color": "#e11d48", "group": "Type" },
    "feature": { "color": "#2563eb", "group": "Type" },
    "high": { "color": "#f59e0b", "group": "Priority" },
    "docs": { "color": "#16a34a" }
  }
}
```

- Cards continue storing labels as `string[]` in frontmatter (no change)
- Labels without a definition fall back to gray styling
- Labels without a group appear under "Other" in grouped views
- Default config: `labels: {}` (empty)

### Preset Color Palette

12 curated colors that work in both light and dark mode:

| Name   | Hex       |
|--------|-----------|
| red    | `#e11d48` |
| orange | `#ea580c` |
| amber  | `#d97706` |
| yellow | `#ca8a04` |
| lime   | `#65a30d` |
| green  | `#16a34a` |
| teal   | `#0d9488` |
| cyan   | `#0891b2` |
| blue   | `#2563eb` |
| indigo | `#4f46e5` |
| violet | `#7c3aed` |
| pink   | `#db2777` |

Users can also enter a custom hex value.

## SDK Methods

New methods on `KanbanSDK`:

- `getLabels(): Record<string, LabelDefinition>` — read label definitions from config
- `setLabel(name: string, definition: LabelDefinition): void` — create or update a label definition
- `renameLabel(oldName: string, newName: string): void` — rename in config + cascade to all cards
- `deleteLabel(name: string): void` — remove definition from config only (cards keep label strings, render gray)

### SDK Filtering

Add `labelGroup` to the existing card filter parameters:

```typescript
interface CardFilters {
  status?: string
  priority?: string
  assignee?: string
  label?: string       // existing — filter by single label
  labelGroup?: string  // new — filter by group (matches any label in that group)
}
```

The SDK resolves `labelGroup` internally: looks up all labels in the group from config, then filters cards that have any of those labels. All interfaces (CLI, API, MCP) pass the parameter through — no duplicated filtering logic.

## UI: Settings Panel — Label Management

New "Labels" section in the Settings panel:

```
Labels
─────────────────────────────────────
  Type
[bug]        ● red       [rename] [×]
[feature]    ● blue      [rename] [×]

  Priority
[high]       ● amber     [rename] [×]

  Other
[docs]       ● green     [rename] [×]

+ Add label  [name] [color picker] [group] [Add]
```

### Behavior

- **Label list** merges two sources: labels defined in config (with colors) + orphan labels found on cards but not in config (shown with gray indicator)
- **Color picker** — click color dot to open palette popover with 12 presets + custom hex input
- **Group** — optional inline text field, autocompletes from existing group names
- **Rename** — inline edit; cascades to all cards
- **Delete** — confirmation dialog: "This label is used on N cards. Remove color definition?" Removes config entry only, cards keep label strings (render gray)
- **Add** — text input + color picker + optional group

## UI: Colored Label Rendering

### Color approach

```tsx
// Colored label
style={{ backgroundColor: `${color}20`, color: color }}

// Fallback (no definition)
className="bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300"
```

The `20` hex suffix gives a 12% opacity tinted background. Full color for text. Works in both light and dark mode.

### Where colored labels appear

- Card badges on board (FeatureCard)
- Label editor (FeatureEditor)
- Label input (CreateFeatureDialog)
- Label filter dropdown (Toolbar) — color dot next to label name
- Settings panel label list

### Toolbar filter dropdown with groups

```
All Labels
──────────
▸ Type (select all)
    ● bug
    ● feature
──────────
▸ Priority (select all)
    ● high
──────────
  Other
    ● docs
```

Clicking a group name filters to all cards with any label from that group. Clicking a specific label filters to just that label.

## Feature Parity (CLI, API, MCP)

| Operation | CLI | API | MCP |
|-----------|-----|-----|-----|
| List labels | `kl labels list` | `GET /api/labels` | `list-labels` |
| Set label | `kl labels set bug --color "#e11d48" --group "Type"` | `PUT /api/labels/:name` | `set-label` |
| Rename label | `kl labels rename bug defect` | `PATCH /api/labels/:name` | `rename-label` |
| Delete label | `kl labels delete bug` | `DELETE /api/labels/:name` | `delete-label` |
| Filter by group | `kl list --label-group "Type"` | `GET /api/cards?labelGroup=Type` | `list-cards` with `labelGroup` param |

All interfaces delegate to SDK methods — no duplicated logic.

## Not Included (YAGNI)

- No label icons
- No label ordering (alphabetical everywhere)
- No multi-select label filter (single label or single group at a time)
- No label descriptions
