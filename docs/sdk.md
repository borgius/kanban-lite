# Kanban Lite SDK

The `KanbanSDK` class is the core engine behind Kanban Lite. It provides a complete, async API for managing cards, comments, attachments, columns, and board settings. The CLI, MCP server, VSCode extension, and standalone web server all delegate to this single SDK — so behavior is consistent everywhere.

## Installation

```bash
npm install kanban-lite
```

## Import

```typescript
import { KanbanSDK } from 'kanban-lite/sdk'
```

You can also import types and utilities:

```typescript
import type { Feature, FeatureStatus, Priority, KanbanColumn, CardDisplaySettings, CreateCardInput } from 'kanban-lite/sdk'
import { parseFeatureFile, serializeFeature, getTitleFromContent, DEFAULT_COLUMNS } from 'kanban-lite/sdk'
import { readConfig, writeConfig, configToSettings, settingsToConfig } from 'kanban-lite/sdk'
```

## Quick Start

```typescript
import { KanbanSDK } from 'kanban-lite/sdk'

const sdk = new KanbanSDK('/path/to/project/.kanban')

// Create a card
const card = await sdk.createCard({
  content: '# Implement auth\n\nAdd OAuth2 login flow.',
  status: 'todo',
  priority: 'high',
  labels: ['backend', 'security']
})

// List all cards (sorted by order)
const cards = await sdk.listCards()

// Move card to a different column
await sdk.moveCard(card.id, 'in-progress')

// Add a comment
await sdk.addComment(card.id, 'alice', 'Started working on this')

// Clean up
await sdk.deleteCard(card.id)
```

## Constructor

```typescript
new KanbanSDK(featuresDir: string)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `featuresDir` | `string` | Absolute path to the features directory (typically `/path/to/project/.kanban`) |

The SDK derives the **workspace root** as the parent directory of `featuresDir`. This is where it looks for `.kanban.json` (board configuration).

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `featuresDir` | `string` | The features directory passed to the constructor |
| `workspaceRoot` | `string` | Parent directory of `featuresDir` (read-only getter) |

---

## Card Operations

### `listCards(columns?)`

Lists all cards, sorted by their fractional order. Automatically handles migration of legacy data formats.

```typescript
const cards: Feature[] = await sdk.listCards()

// Optionally pass column IDs to ensure their subdirectories exist
const cards = await sdk.listCards(['backlog', 'todo', 'in-progress', 'review', 'done'])
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `columns` | `string[]` | `undefined` | Column IDs whose subdirectories should be created if missing |

**Returns:** `Promise<Feature[]>` — All cards sorted by `order` (ascending).

**Automatic migrations performed on each call:**
1. Flat `.md` files in the root features directory are moved into their status subfolder
2. Cards whose frontmatter status doesn't match their folder location are moved to the correct folder
3. Legacy integer `order` values are converted to fractional indices (base-62)

---

### `getCard(cardId)`

Retrieves a single card by its ID.

```typescript
const card: Feature | null = await sdk.getCard('42')
```

**Returns:** `Promise<Feature | null>` — The card, or `null` if not found.

---

### `createCard(data)`

Creates a new card with auto-generated ID, timestamps, and fractional order.

```typescript
const card = await sdk.createCard({
  content: '# My Task\n\nDescription here.',
  status: 'todo',
  priority: 'high',
  assignee: 'alice',
  dueDate: '2026-03-01',
  labels: ['frontend', 'urgent'],
  attachments: []
})
```

**Parameters — `CreateCardInput`:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `content` | `string` | *required* | Markdown content (title extracted from first `# heading`) |
| `status` | `FeatureStatus` | `'backlog'` | Initial column |
| `priority` | `Priority` | `'medium'` | Priority level |
| `assignee` | `string \| null` | `null` | Assigned team member |
| `dueDate` | `string \| null` | `null` | Due date (ISO 8601 string) |
| `labels` | `string[]` | `[]` | Labels/tags |
| `attachments` | `string[]` | `[]` | Attachment filenames |

**Returns:** `Promise<Feature>` — The created card with all generated fields.

**Auto-generated fields:**
- `id` — Incremental numeric ID (e.g. `"42"`)
- `created` / `modified` — Current ISO timestamp
- `completedAt` — Set to current timestamp if status is `'done'`, otherwise `null`
- `order` — Fractional index placing the card at the end of its column
- `filePath` — Full path to the created `.md` file

---

### `updateCard(cardId, updates)`

Updates one or more fields of an existing card.

```typescript
const updated = await sdk.updateCard('42', {
  priority: 'critical',
  assignee: 'bob',
  labels: ['backend'],
  content: '# Updated Title\n\nNew description.'
})
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `cardId` | `string` | Card ID |
| `updates` | `Partial<Feature>` | Fields to update (`id` and `filePath` are ignored) |

**Returns:** `Promise<Feature>` — The updated card.

**Automatic behaviors:**
- `modified` timestamp is updated
- If `status` changes to `'done'`, `completedAt` is set; if it changes away from `'done'`, `completedAt` is cleared
- If `status` changes, the file is moved to the corresponding subfolder
- If the title (first `# heading` in content) changes, the file is renamed to match

**Throws:** `Error` if card not found.

---

### `moveCard(cardId, newStatus, position?)`

Moves a card to a different column and/or reorders it within a column.

```typescript
// Move to the end of "in-progress"
await sdk.moveCard('42', 'in-progress')

// Move to position 0 (top) of "review"
await sdk.moveCard('42', 'review', 0)

// Move to position 2 within the same column
await sdk.moveCard('42', 'todo', 2)
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `cardId` | `string` | *required* | Card ID |
| `newStatus` | `FeatureStatus` | *required* | Target column |
| `position` | `number` | End of column | Zero-based position within the target column |

**Returns:** `Promise<Feature>` — The moved card.

**Throws:** `Error` if card not found.

---

### `deleteCard(cardId)`

Permanently deletes a card's markdown file.

```typescript
await sdk.deleteCard('42')
```

**Throws:** `Error` if card not found.

---

### `getCardsByStatus(status)`

Convenience method to list cards filtered by status.

```typescript
const todoCards = await sdk.getCardsByStatus('todo')
```

**Returns:** `Promise<Feature[]>`

---

### `getUniqueAssignees()`

Returns a sorted list of all unique assignee names across all cards.

```typescript
const assignees: string[] = await sdk.getUniqueAssignees()
// ['alice', 'bob']
```

---

### `getUniqueLabels()`

Returns a sorted list of all unique labels across all cards.

```typescript
const labels: string[] = await sdk.getUniqueLabels()
// ['backend', 'frontend', 'urgent']
```

---

## Comment Operations

Comments are stored inside the card's markdown file as additional YAML document blocks.

### `listComments(cardId)`

```typescript
const comments: Comment[] = await sdk.listComments('42')
```

**Returns:** `Promise<Comment[]>`

Each `Comment` has:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Comment ID (e.g. `"c1"`, `"c2"`) |
| `author` | `string` | Author name |
| `created` | `string` | ISO 8601 timestamp |
| `content` | `string` | Comment body (plain text or markdown) |

---

### `addComment(cardId, author, content)`

```typescript
const card = await sdk.addComment('42', 'alice', 'Looks good, needs tests')
// card.comments now includes the new comment with auto-generated ID
```

**Returns:** `Promise<Feature>` — The updated card.

---

### `updateComment(cardId, commentId, content)`

```typescript
await sdk.updateComment('42', 'c1', 'Updated: LGTM after adding tests')
```

**Throws:** `Error` if card or comment not found.

---

### `deleteComment(cardId, commentId)`

```typescript
await sdk.deleteComment('42', 'c1')
```

**Throws:** `Error` if card not found.

---

## Attachment Operations

Attachments are files stored alongside the card's `.md` file in the same directory.

### `listAttachments(cardId)`

```typescript
const attachments: string[] = await sdk.listAttachments('42')
// ['screenshot.png', 'design.pdf']
```

---

### `addAttachment(cardId, sourcePath)`

Copies a file to the card's directory and records it in the card's frontmatter.

```typescript
const card = await sdk.addAttachment('42', '/tmp/screenshot.png')
```

If the file is already in the card's directory, it won't be copied again.

**Returns:** `Promise<Feature>` — The updated card.

---

### `removeAttachment(cardId, attachment)`

Removes an attachment reference from the card's frontmatter. Does **not** delete the file from disk.

```typescript
await sdk.removeAttachment('42', 'screenshot.png')
```

**Returns:** `Promise<Feature>` — The updated card.

---

## Column Operations

Columns define the board's workflow stages. They are stored in `.kanban.json` at the workspace root.

> Column methods are **synchronous** (they read/write `.kanban.json` using `fs.readFileSync`/`writeFileSync`), except `removeColumn` which is async because it checks for cards in the column.

### `listColumns()`

```typescript
const columns: KanbanColumn[] = sdk.listColumns()
```

Each `KanbanColumn` has:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique column identifier (used as folder name and status value) |
| `name` | `string` | Display name |
| `color` | `string` | Hex color code |

Default columns: `backlog`, `todo`, `in-progress`, `review`, `done`.

---

### `addColumn(column)`

```typescript
const columns = sdk.addColumn({ id: 'testing', name: 'Testing', color: '#ff9900' })
```

**Throws:** `Error` if a column with the same `id` already exists.

**Returns:** `KanbanColumn[]` — The updated list of all columns.

---

### `updateColumn(columnId, updates)`

```typescript
const columns = sdk.updateColumn('testing', { name: 'QA', color: '#00cc99' })
```

Both `name` and `color` are optional — only provided fields are updated.

**Throws:** `Error` if column not found.

**Returns:** `KanbanColumn[]` — The updated list of all columns.

---

### `removeColumn(columnId)`

Removes a column. Fails if any cards are still in that column.

```typescript
const columns = await sdk.removeColumn('testing')
```

**Throws:** `Error` if column not found or column still contains cards.

**Returns:** `Promise<KanbanColumn[]>` — The updated list of all columns.

---

### `reorderColumns(columnIds)`

Reorders columns by specifying all column IDs in the desired order.

```typescript
const columns = sdk.reorderColumns(['todo', 'in-progress', 'review', 'done', 'backlog'])
```

**Throws:** `Error` if any ID is missing or if the list doesn't include all columns.

**Returns:** `KanbanColumn[]` — The reordered column list.

---

## Settings Operations

Board display settings control how cards are rendered in the UI.

### `getSettings()`

```typescript
const settings: CardDisplaySettings = sdk.getSettings()
```

**`CardDisplaySettings` fields:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `showPriorityBadges` | `boolean` | `true` | Show priority badges on cards |
| `showAssignee` | `boolean` | `true` | Show assignee on cards |
| `showDueDate` | `boolean` | `true` | Show due dates on cards |
| `showLabels` | `boolean` | `true` | Show labels on cards |
| `showBuildWithAI` | `boolean` | `true` | Show "Build with AI" button |
| `showFileName` | `boolean` | `false` | Show file name on cards |
| `compactMode` | `boolean` | `false` | Use compact card layout |
| `markdownEditorMode` | `boolean` | `false` | Use raw markdown editor |
| `defaultPriority` | `Priority` | `'medium'` | Default priority for new cards |
| `defaultStatus` | `FeatureStatus` | `'backlog'` | Default status for new cards |

---

### `updateSettings(settings)`

```typescript
sdk.updateSettings({
  ...sdk.getSettings(),
  compactMode: true,
  showFileName: true
})
```

**Note:** Pass a full `CardDisplaySettings` object (use spread with `getSettings()` to change only specific fields).

---

## Initialization

### `init()`

Ensures the features directory exists. Called automatically by most operations, but can be invoked explicitly.

```typescript
await sdk.init()
```

---

## Types

### `Feature`

```typescript
interface Feature {
  id: string              // Auto-generated card ID (e.g. "42")
  status: FeatureStatus   // Column: 'backlog' | 'todo' | 'in-progress' | 'review' | 'done'
  priority: Priority      // 'critical' | 'high' | 'medium' | 'low'
  assignee: string | null // Assigned team member
  dueDate: string | null  // ISO 8601 date string
  created: string         // ISO 8601 timestamp
  modified: string        // ISO 8601 timestamp (auto-updated)
  completedAt: string | null // Set when status becomes 'done'
  labels: string[]        // Tags
  attachments: string[]   // Attachment filenames
  comments: Comment[]     // Discussion threads
  order: string           // Fractional index for ordering (base-62)
  content: string         // Markdown body (title is the first # heading)
  filePath: string        // Absolute path to the .md file
}
```

### `FeatureStatus`

```typescript
type FeatureStatus = 'backlog' | 'todo' | 'in-progress' | 'review' | 'done'
```

### `Priority`

```typescript
type Priority = 'critical' | 'high' | 'medium' | 'low'
```

### `KanbanColumn`

```typescript
interface KanbanColumn {
  id: string    // Used as folder name and status value
  name: string  // Display name
  color: string // Hex color
}
```

### `Comment`

```typescript
interface Comment {
  id: string      // e.g. "c1", "c2"
  author: string
  created: string // ISO 8601 timestamp
  content: string
}
```

### `CreateCardInput`

```typescript
interface CreateCardInput {
  content: string
  status?: FeatureStatus
  priority?: Priority
  assignee?: string | null
  dueDate?: string | null
  labels?: string[]
  attachments?: string[]
}
```

### `CardDisplaySettings`

```typescript
interface CardDisplaySettings {
  showPriorityBadges: boolean
  showAssignee: boolean
  showDueDate: boolean
  showLabels: boolean
  showBuildWithAI: boolean
  showFileName: boolean
  compactMode: boolean
  markdownEditorMode: boolean
  defaultPriority: Priority
  defaultStatus: FeatureStatus
}
```

---

## Utility Exports

The SDK package also exports lower-level utilities:

| Export | Description |
|--------|-------------|
| `parseFeatureFile(content, filePath)` | Parse a markdown string into a `Feature` object |
| `serializeFeature(feature)` | Serialize a `Feature` object back to markdown with YAML frontmatter |
| `getTitleFromContent(content)` | Extract the title from the first `# heading` in markdown |
| `generateFeatureFilename(id, title)` | Generate a filename slug from a numeric ID and title |
| `DEFAULT_COLUMNS` | The default 5-column board layout |
| `readConfig(workspaceRoot)` | Read `.kanban.json` configuration |
| `writeConfig(workspaceRoot, config)` | Write `.kanban.json` configuration |
| `configToSettings(config)` | Extract `CardDisplaySettings` from a `KanbanConfig` |
| `settingsToConfig(config, settings)` | Merge `CardDisplaySettings` back into a `KanbanConfig` |

---

## File Layout

The SDK manages this file structure:

```
project/
  .kanban.json              # Board config (columns, display settings)
  .kanban/                  # Features directory
    backlog/
      1-my-task.md          # Card markdown file
    todo/
      2-another-task.md
      screenshot.png        # Attachment (same directory as card)
    in-progress/
    review/
    done/
```

Each card file uses YAML frontmatter followed by markdown content:

```markdown
---
id: "1"
status: "backlog"
priority: "high"
assignee: "alice"
dueDate: "2026-03-01"
created: "2026-02-21T10:00:00.000Z"
modified: "2026-02-21T14:00:00.000Z"
completedAt: null
labels: ["backend", "security"]
attachments: []
order: "a0"
---

# Implement authentication

Add OAuth2 login flow with Google and GitHub providers.

---
comment: true
id: "c1"
author: "bob"
created: "2026-02-21T15:00:00.000Z"
---
Should we support SAML too?
```

---

## Error Handling

SDK methods throw standard `Error` objects with descriptive messages:

```typescript
try {
  await sdk.deleteCard('nonexistent')
} catch (err) {
  console.error(err.message) // "Card not found: nonexistent"
}
```

Common error messages:
- `"Card not found: <id>"`
- `"Comment not found: <commentId>"`
- `"Column not found: <columnId>"`
- `"Column already exists: <columnId>"`
- `"Cannot remove column "<id>": N card(s) still in this column"`
- `"Must include all column IDs when reordering"`
