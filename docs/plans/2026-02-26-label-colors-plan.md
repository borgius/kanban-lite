# Label Colors & Management — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add colored labels with groups, a label management UI in Settings, and label CRUD across all interfaces (SDK, CLI, API, MCP).

**Architecture:** Labels get a central registry in `.kanban.json` as `labels: Record<string, LabelDefinition>`. The SDK owns all label CRUD + group filtering. UI components read label definitions to render colored badges. Cards continue storing labels as `string[]` — no migration needed.

**Tech Stack:** TypeScript, React (Zustand store), Vitest, Node.js fs

**Design doc:** `docs/plans/2026-02-26-label-colors-design.md`

---

### Task 1: Add LabelDefinition type and update KanbanConfig

**Files:**
- Modify: `src/shared/types.ts:210` (after CardDisplaySettings)
- Modify: `src/shared/config.ts:54-91` (KanbanConfig interface)
- Modify: `src/shared/config.ts:125-145` (DEFAULT_CONFIG)

**Step 1: Add LabelDefinition interface to types.ts**

Add after `CardDisplaySettings` (after line 233):

```typescript
export interface LabelDefinition {
  color: string
  group?: string
}

export const LABEL_PRESET_COLORS: { name: string; hex: string }[] = [
  { name: 'red', hex: '#e11d48' },
  { name: 'orange', hex: '#ea580c' },
  { name: 'amber', hex: '#d97706' },
  { name: 'yellow', hex: '#ca8a04' },
  { name: 'lime', hex: '#65a30d' },
  { name: 'green', hex: '#16a34a' },
  { name: 'teal', hex: '#0d9488' },
  { name: 'cyan', hex: '#0891b2' },
  { name: 'blue', hex: '#2563eb' },
  { name: 'indigo', hex: '#4f46e5' },
  { name: 'violet', hex: '#7c3aed' },
  { name: 'pink', hex: '#db2777' },
]
```

**Step 2: Add `labels` field to KanbanConfig in config.ts**

Add to `KanbanConfig` interface (after line 90, before closing `}`):

```typescript
  labels?: Record<string, LabelDefinition>
```

Import `LabelDefinition` from `./types` (update line 3).

**Step 3: Add `labels` to DEFAULT_CONFIG**

Add to `DEFAULT_CONFIG` (after `port: 3000`, line 144):

```typescript
  labels: {}
```

**Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 5: Commit**

```
feat: add LabelDefinition type and labels field to KanbanConfig
```

---

### Task 2: Add SDK label management methods

**Files:**
- Modify: `src/sdk/KanbanSDK.ts:849-856` (after getUniqueLabels)
- Test: `src/sdk/__tests__/KanbanSDK.test.ts`

**Step 1: Write failing tests for label CRUD**

Add to `src/sdk/__tests__/KanbanSDK.test.ts`:

```typescript
describe('Label management', () => {
  it('getLabels returns empty object by default', async () => {
    const labels = sdk.getLabels()
    expect(labels).toEqual({})
  })

  it('setLabel creates a new label definition', async () => {
    sdk.setLabel('bug', { color: '#e11d48', group: 'Type' })
    const labels = sdk.getLabels()
    expect(labels['bug']).toEqual({ color: '#e11d48', group: 'Type' })
  })

  it('setLabel updates an existing label definition', async () => {
    sdk.setLabel('bug', { color: '#e11d48' })
    sdk.setLabel('bug', { color: '#2563eb', group: 'Type' })
    const labels = sdk.getLabels()
    expect(labels['bug']).toEqual({ color: '#2563eb', group: 'Type' })
  })

  it('deleteLabel removes label definition from config', async () => {
    sdk.setLabel('bug', { color: '#e11d48' })
    sdk.deleteLabel('bug')
    const labels = sdk.getLabels()
    expect(labels['bug']).toBeUndefined()
  })

  it('renameLabel updates config key and cascades to all cards', async () => {
    writeCardFile(tempDir, '1-card.md', makeCardContent({
      id: '1-card', status: 'backlog', labels: ['bug', 'frontend']
    }), 'backlog')
    sdk.setLabel('bug', { color: '#e11d48', group: 'Type' })

    await sdk.renameLabel('bug', 'defect')

    const labels = sdk.getLabels()
    expect(labels['bug']).toBeUndefined()
    expect(labels['defect']).toEqual({ color: '#e11d48', group: 'Type' })

    const cards = await sdk.listCards()
    expect(cards[0].labels).toContain('defect')
    expect(cards[0].labels).not.toContain('bug')
    expect(cards[0].labels).toContain('frontend')
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/sdk/__tests__/KanbanSDK.test.ts`
Expected: FAIL — methods don't exist yet.

**Step 3: Implement SDK label methods**

Add to `KanbanSDK` class in `src/sdk/KanbanSDK.ts`, after `getUniqueLabels` (after line 856):

```typescript
  // --- Label definition management ---

  getLabels(): Record<string, LabelDefinition> {
    const config = readConfig(this.workspaceRoot)
    return config.labels || {}
  }

  setLabel(name: string, definition: LabelDefinition): void {
    const config = readConfig(this.workspaceRoot)
    if (!config.labels) config.labels = {}
    config.labels[name] = definition
    writeConfig(this.workspaceRoot, config)
  }

  deleteLabel(name: string): void {
    const config = readConfig(this.workspaceRoot)
    if (config.labels) {
      delete config.labels[name]
      writeConfig(this.workspaceRoot, config)
    }
  }

  async renameLabel(oldName: string, newName: string): Promise<void> {
    const config = readConfig(this.workspaceRoot)
    if (config.labels && config.labels[oldName]) {
      config.labels[newName] = config.labels[oldName]
      delete config.labels[oldName]
      writeConfig(this.workspaceRoot, config)
    }

    // Cascade to all cards
    const cards = await this.listCards()
    for (const card of cards) {
      if (card.labels.includes(oldName)) {
        const newLabels = card.labels.map(l => l === oldName ? newName : l)
        await this.updateCard(card.id, { labels: newLabels })
      }
    }
  }
```

Import `LabelDefinition` from `../shared/types` and `readConfig`, `writeConfig` from `../shared/config` at the top of the file.

**Step 4: Run tests to verify they pass**

Run: `npm test -- --run src/sdk/__tests__/KanbanSDK.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: add SDK label management methods (getLabels, setLabel, renameLabel, deleteLabel)
```

---

### Task 3: Add SDK labelGroup filtering

**Files:**
- Modify: `src/sdk/KanbanSDK.ts` (add `filterCardsByLabelGroup` method)
- Test: `src/sdk/__tests__/KanbanSDK.test.ts`

**Step 1: Write failing tests**

```typescript
describe('Label group filtering', () => {
  it('filterCardsByLabelGroup returns cards with any label from the group', async () => {
    sdk.setLabel('bug', { color: '#e11d48', group: 'Type' })
    sdk.setLabel('feature', { color: '#2563eb', group: 'Type' })
    sdk.setLabel('high', { color: '#f59e0b', group: 'Priority' })

    writeCardFile(tempDir, '1-card.md', makeCardContent({
      id: '1-card', status: 'backlog', labels: ['bug']
    }), 'backlog')
    writeCardFile(tempDir, '2-card.md', makeCardContent({
      id: '2-card', status: 'backlog', labels: ['high']
    }), 'backlog')
    writeCardFile(tempDir, '3-card.md', makeCardContent({
      id: '3-card', status: 'backlog', labels: ['feature', 'high']
    }), 'backlog')

    const typeCards = await sdk.filterCardsByLabelGroup('Type')
    expect(typeCards.map(c => c.id).sort()).toEqual(['1-card', '3-card'])

    const priorityCards = await sdk.filterCardsByLabelGroup('Priority')
    expect(priorityCards.map(c => c.id).sort()).toEqual(['2-card', '3-card'])
  })

  it('filterCardsByLabelGroup returns empty for unknown group', async () => {
    const cards = await sdk.filterCardsByLabelGroup('NonExistent')
    expect(cards).toEqual([])
  })

  it('getLabelsInGroup returns labels belonging to a group', () => {
    sdk.setLabel('bug', { color: '#e11d48', group: 'Type' })
    sdk.setLabel('feature', { color: '#2563eb', group: 'Type' })
    sdk.setLabel('high', { color: '#f59e0b', group: 'Priority' })
    sdk.setLabel('docs', { color: '#16a34a' })

    expect(sdk.getLabelsInGroup('Type').sort()).toEqual(['bug', 'feature'])
    expect(sdk.getLabelsInGroup('Priority')).toEqual(['high'])
    expect(sdk.getLabelsInGroup('Other')).toEqual([])
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/sdk/__tests__/KanbanSDK.test.ts`
Expected: FAIL

**Step 3: Implement methods**

Add to `KanbanSDK` class after the label management methods:

```typescript
  getLabelsInGroup(group: string): string[] {
    const labels = this.getLabels()
    return Object.entries(labels)
      .filter(([, def]) => (def.group || 'Other') === group)
      .map(([name]) => name)
      .sort()
  }

  async filterCardsByLabelGroup(group: string, boardId?: string): Promise<Feature[]> {
    const groupLabels = this.getLabelsInGroup(group)
    if (groupLabels.length === 0) return []
    const cards = await this.listCards(undefined, boardId)
    return cards.filter(c => c.labels.some(l => groupLabels.includes(l)))
  }
```

**Step 4: Run tests**

Run: `npm test -- --run src/sdk/__tests__/KanbanSDK.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: add SDK label group filtering (filterCardsByLabelGroup, getLabelsInGroup)
```

---

### Task 4: Add label CRUD to CLI

**Files:**
- Modify: `src/cli/index.ts` (add `labels` subcommand + `--label-group` to `list`)

**Step 1: Add `--label-group` flag to the list command**

Find where `--label` filter is applied in `cmdList` (around line 177). Add after it:

```typescript
if (typeof flags['label-group'] === 'string') {
  cards = await sdk.filterCardsByLabelGroup(flags['label-group'] as string, boardId)
}
```

Also add `'label-group'` to the flags parsing.

**Step 2: Add `labels` subcommand**

Add a new `cmdLabels` function handling these subcommands:

- `kl labels list` — calls `sdk.getLabels()`, prints table
- `kl labels set <name> --color <hex> [--group <group>]` — calls `sdk.setLabel()`
- `kl labels rename <old> <new>` — calls `sdk.renameLabel()`
- `kl labels delete <name>` — calls `sdk.deleteLabel()`

Register the subcommand in the main command dispatch (where `list`, `create`, `edit` etc. are routed).

**Step 3: Verify CLI works manually**

Run: `npx tsx src/cli/index.ts labels list`
Expected: Shows empty label list or formatted table.

**Step 4: Commit**

```
feat: add CLI labels subcommand and --label-group filter
```

---

### Task 5: Add label CRUD to REST API

**Files:**
- Modify: `src/standalone/server.ts` (add `/api/labels` endpoints + `labelGroup` query param)

**Step 1: Add `labelGroup` query param to GET /api/cards endpoints**

Find the label filter in GET /api/boards/:boardId/tasks (around line 715). Add after it:

```typescript
const labelGroup = url.searchParams.get('labelGroup')
if (labelGroup) {
  const groupLabels = sdk.getLabelsInGroup(labelGroup)
  result = result.filter(f => f.labels.some(l => groupLabels.includes(l)))
}
```

Do the same for GET /api/tasks (around line 837).

**Step 2: Add label CRUD endpoints**

Add route handlers for:

- `GET /api/labels` — returns `sdk.getLabels()`
- `PUT /api/labels/:name` — body `{ color, group? }` → calls `sdk.setLabel()`
- `PATCH /api/labels/:name` — body `{ newName }` → calls `sdk.renameLabel()`
- `DELETE /api/labels/:name` → calls `sdk.deleteLabel()`

Follow the existing routing pattern in `server.ts`.

**Step 3: Write integration tests**

Add to `src/standalone/__tests__/server.integration.test.ts`:

```typescript
describe('Labels API', () => {
  it('GET /api/labels returns empty object initially', async () => {
    const res = await fetch(`${baseUrl}/api/labels`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({})
  })

  it('PUT /api/labels/:name creates a label', async () => {
    const res = await fetch(`${baseUrl}/api/labels/bug`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ color: '#e11d48', group: 'Type' })
    })
    expect(res.status).toBe(200)
  })

  it('DELETE /api/labels/:name removes a label', async () => {
    await fetch(`${baseUrl}/api/labels/bug`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ color: '#e11d48' })
    })
    const res = await fetch(`${baseUrl}/api/labels/bug`, { method: 'DELETE' })
    expect(res.status).toBe(200)
  })

  it('GET /api/tasks?labelGroup=Type filters by group', async () => {
    // Setup: create label definition and cards with that label
    // Then verify filtering works
  })
})
```

**Step 4: Run tests**

Run: `npm test -- --run src/standalone/__tests__/server.integration.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: add REST API label endpoints and labelGroup filter
```

---

### Task 6: Add label CRUD to MCP server

**Files:**
- Modify: `src/mcp-server/index.ts` (add tools + `labelGroup` param)

**Step 1: Add `labelGroup` to `list_cards` tool**

In the `list_cards` tool definition (around line 128), add:

```typescript
labelGroup: z.string().optional().describe('Filter by label group name')
```

In the handler, add after existing label filter:

```typescript
if (labelGroup) {
  const groupLabels = sdk.getLabelsInGroup(labelGroup)
  cards = cards.filter(c => c.labels.some(l => groupLabels.includes(l)))
}
```

**Step 2: Add label management tools**

Add 4 new tools following the existing tool patterns:

- `list_labels` — calls `sdk.getLabels()`, returns formatted JSON
- `set_label` — params: `name`, `color`, `group?` → calls `sdk.setLabel()`
- `rename_label` — params: `oldName`, `newName` → calls `sdk.renameLabel()`
- `delete_label` — params: `name` → calls `sdk.deleteLabel()`

**Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 4: Commit**

```
feat: add MCP label management tools and labelGroup filter
```

---

### Task 7: Add label definitions to webview store and message types

**Files:**
- Modify: `src/shared/types.ts:277-309` (ExtensionMessage, WebviewMessage)
- Modify: `src/webview/store/index.ts:7-48` (KanbanState)

**Step 1: Update message types**

In `src/shared/types.ts`, update `ExtensionMessage` init message (line 278) to include `labels`:

```typescript
| { type: 'init'; features: Feature[]; columns: KanbanColumn[]; settings: CardDisplaySettings; boards?: BoardInfo[]; currentBoard?: string; workspace?: WorkspaceInfo; labels?: Record<string, LabelDefinition> }
```

Add new message types to `WebviewMessage`:

```typescript
| { type: 'setLabel'; name: string; definition: LabelDefinition }
| { type: 'renameLabel'; oldName: string; newName: string }
| { type: 'deleteLabel'; name: string }
```

Add new message to `ExtensionMessage`:

```typescript
| { type: 'labelsUpdated'; labels: Record<string, LabelDefinition> }
```

**Step 2: Update store**

In `src/webview/store/index.ts`, add to `KanbanState` interface:

```typescript
labelDefs: Record<string, LabelDefinition>
setLabelDefs: (labels: Record<string, LabelDefinition>) => void
```

Add to store creation:

```typescript
labelDefs: {},
setLabelDefs: (labels) => set({ labelDefs: labels }),
```

Update the `labelFilter` to support group filter format — store value like `"group:Type"` vs `"bug"`:

```typescript
// In getFilteredFeaturesByStatus, update label filter logic (around line 188):
if (labelFilter !== 'all') {
  if (labelFilter.startsWith('group:')) {
    const group = labelFilter.slice(6)
    const { labelDefs } = get()
    const groupLabels = Object.entries(labelDefs)
      .filter(([, def]) => (def.group || 'Other') === group)
      .map(([name]) => name)
    if (!f.labels.some(l => groupLabels.includes(l))) return false
  } else {
    if (!f.labels.includes(labelFilter)) return false
  }
}
```

**Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 4: Commit**

```
feat: add label definitions to store and message types
```

---

### Task 8: Wire label messages in standalone server and extension

**Files:**
- Modify: `src/standalone/server.ts` (handle new WebSocket messages, send labels on init)
- Modify: `src/extension/KanbanViewProvider.ts` (if it exists — handle label messages)

**Step 1: Send labels on init**

Find where the `init` message is sent over WebSocket. Add `labels: sdk.getLabels()` to the init payload.

**Step 2: Handle label WebSocket messages**

Add handlers for `setLabel`, `renameLabel`, `deleteLabel` WebSocket messages. Each should:
1. Call the appropriate SDK method
2. Broadcast a `labelsUpdated` message to all connected clients

**Step 3: Verify standalone server works**

Run: `npm run build:standalone-server && node dist/standalone/server.js`
Expected: Server starts. Opening the webview should show labels in init payload.

**Step 4: Commit**

```
feat: wire label messages through WebSocket and extension
```

---

### Task 9: Render colored labels on cards

**Files:**
- Modify: `src/webview/components/FeatureCard.tsx:135-150`

**Step 1: Update FeatureCard label rendering**

Replace the static gray label badges with color-aware rendering. Read `labelDefs` from the store:

```tsx
import { useStore } from '../store'

// Inside FeatureCard component:
const labelDefs = useStore(s => s.labelDefs)

// Replace label rendering (lines 136-150):
{cardSettings.showLabels && feature.labels.length > 0 && (
  <div className="flex flex-wrap gap-1 mb-2">
    {feature.labels.slice(0, 3).map((label) => {
      const def = labelDefs[label]
      return (
        <span
          key={label}
          className={`text-xs px-1.5 py-0.5 rounded ${!def ? 'bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300' : ''}`}
          style={def ? { backgroundColor: `${def.color}20`, color: def.color } : undefined}
        >
          {label}
        </span>
      )
    })}
    {feature.labels.length > 3 && (
      <span className="text-xs text-zinc-400">+{feature.labels.length - 3}</span>
    )}
  </div>
)}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: No errors.

**Step 3: Commit**

```
feat: render colored label badges on cards
```

---

### Task 10: Update label rendering in FeatureEditor and CreateFeatureDialog

**Files:**
- Modify: `src/webview/components/FeatureEditor.tsx` (LabelEditor badges)
- Modify: `src/webview/components/CreateFeatureDialog.tsx` (LabelInput badges)

**Step 1: Update LabelEditor in FeatureEditor.tsx**

Find the label badge rendering in the LabelEditor component. Update badges to use color from `labelDefs` store, same pattern as Task 9.

**Step 2: Update LabelInput in CreateFeatureDialog.tsx**

Same color-aware badge pattern in the create dialog's label input.

**Step 3: Verify build**

Run: `npm run build`
Expected: No errors.

**Step 4: Commit**

```
feat: render colored labels in editor and create dialog
```

---

### Task 11: Update Toolbar label filter with groups

**Files:**
- Modify: `src/webview/components/Toolbar.tsx:195-209`

**Step 1: Replace label filter select with grouped dropdown**

Replace the simple `<select>` (lines 196-209) with a grouped dropdown that:
- Groups labels by their `group` field from `labelDefs`
- Shows group headers with "select all" options (value: `group:GroupName`)
- Shows individual labels with color dots
- Labels without a group go under "Other"

```tsx
const labelDefs = useStore(s => s.labelDefs)

// Build grouped structure
const groupedLabels = useMemo(() => {
  const groups: Record<string, string[]> = {}
  labels.forEach(label => {
    const def = labelDefs[label]
    const group = def?.group || 'Other'
    if (!groups[group]) groups[group] = []
    groups[group].push(label)
  })
  return groups
}, [labels, labelDefs])
```

Render as a `<select>` with `<optgroup>` elements, or a custom dropdown component with group headers. The value for group-level selection uses the `group:GroupName` prefix format that the store already understands (from Task 7).

**Step 2: Verify build**

Run: `npm run build`
Expected: No errors.

**Step 3: Commit**

```
feat: add grouped label filter dropdown with color dots in toolbar
```

---

### Task 12: Add label management section to Settings panel

**Files:**
- Modify: `src/webview/components/SettingsPanel.tsx`

**Step 1: Add Labels section**

After the "Defaults" section (after line 296), add a new `SettingsSection` titled "Labels":

Components to build inside `SettingsPanel.tsx`:

1. **LabelRow** — displays one label with color dot, name, group badge, rename button, delete button
2. **ColorPicker** — popover with 12 preset color buttons + custom hex input
3. **AddLabelForm** — name input + color picker + optional group input + add button
4. **LabelsSection** — fetches labels from store, merges with orphan labels from cards, groups by group name, renders LabelRow list + AddLabelForm

The section sends `setLabel`, `renameLabel`, `deleteLabel` WebSocket messages via the existing `postMessage` mechanism.

For rename: show an inline text input replacing the label name. On confirm, send `renameLabel` message.

For delete: show a confirmation with card count. The card count comes from `features.filter(f => f.labels.includes(name)).length` using the store.

**Step 2: Wire messages**

The SettingsPanel needs to call `postMessage` for label operations. Check how existing settings messages work (the `onSave` prop pattern) and follow the same approach. Label operations need their own message types since they don't go through the `saveSettings` flow.

**Step 3: Verify build**

Run: `npm run build`
Expected: No errors.

**Step 4: Commit**

```
feat: add label management section to Settings panel with color picker
```

---

### Task 13: Handle label messages in webview App component

**Files:**
- Modify: `src/webview/App.tsx` or wherever WebSocket/message handling lives

**Step 1: Find the message handler**

Find where `ExtensionMessage` types are handled (where `init`, `featuresUpdated` etc. are processed). Add handlers for:

- `init` — extract `labels` from payload, call `setLabelDefs(labels)`
- `labelsUpdated` — call `setLabelDefs(labels)`

**Step 2: Send label messages**

Find the `postMessage` function. Ensure the new `setLabel`, `renameLabel`, `deleteLabel` message types are handled by the message sender.

**Step 3: Verify build**

Run: `npm run build`
Expected: No errors.

**Step 4: Commit**

```
feat: handle label messages in webview App component
```

---

### Task 14: Full integration test and type check

**Files:**
- All modified files

**Step 1: Run full type check**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 2: Run all tests**

Run: `npm test`
Expected: All tests pass.

**Step 3: Build everything**

Run: `npm run build`
Expected: Build succeeds.

**Step 4: Manual smoke test**

1. Start standalone server
2. Open board in browser
3. Go to Settings → Labels section
4. Add a label "bug" with red color and group "Type"
5. Add a label "feature" with blue color and group "Type"
6. Create a card with label "bug"
7. Verify card shows red badge
8. Verify toolbar filter shows grouped dropdown
9. Filter by group "Type" — verify it works
10. Rename "bug" to "defect" — verify card updates
11. Delete "defect" — verify badge goes gray

**Step 5: Final commit if any fixes needed**

```
fix: address issues found during integration testing
```
