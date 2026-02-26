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
import type { Feature, FeatureStatus, Priority, KanbanColumn, CardDisplaySettings, CreateCardInput, LabelDefinition } from 'kanban-lite/sdk'
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

---


## KanbanSDK Class

<a name="KanbanSDK"></a>

### KanbanSDK
Core SDK for managing kanban boards stored as markdown files.

Provides full CRUD operations for boards, cards, columns, comments,
attachments, and display settings. Cards are persisted as markdown files
with YAML frontmatter under the `.kanban/` directory, organized by board
and status column.

This class is the foundation that the CLI, MCP server, and standalone
HTTP server are all built on top of.

**Kind**: global class  

* [KanbanSDK](#KanbanSDK)
    * [new KanbanSDK(featuresDir, options)](#new_KanbanSDK_new)
    * [.workspaceRoot](#KanbanSDK+workspaceRoot) ⇒
    * [.emitEvent()](#KanbanSDK+emitEvent)
    * [.init()](#KanbanSDK+init) ⇒
    * [.listBoards()](#KanbanSDK+listBoards) ⇒
    * [.createBoard(id, name, options)](#KanbanSDK+createBoard) ⇒
    * [.deleteBoard(boardId)](#KanbanSDK+deleteBoard) ⇒
    * [.getBoard(boardId)](#KanbanSDK+getBoard) ⇒
    * [.updateBoard(boardId, updates)](#KanbanSDK+updateBoard) ⇒
    * [.transferCard(cardId, fromBoardId, toBoardId, targetStatus)](#KanbanSDK+transferCard) ⇒
    * [.listCards(columns, boardId)](#KanbanSDK+listCards) ⇒
    * [.getCard(cardId, boardId)](#KanbanSDK+getCard) ⇒
    * [.createCard(data)](#KanbanSDK+createCard) ⇒
    * [.updateCard(cardId, updates, boardId)](#KanbanSDK+updateCard) ⇒
    * [.moveCard(cardId, newStatus, position, boardId)](#KanbanSDK+moveCard) ⇒
    * [.deleteCard(cardId, boardId)](#KanbanSDK+deleteCard) ⇒
    * [.permanentlyDeleteCard(cardId, boardId)](#KanbanSDK+permanentlyDeleteCard) ⇒
    * [.getCardsByStatus(status, boardId)](#KanbanSDK+getCardsByStatus) ⇒
    * [.getUniqueAssignees(boardId)](#KanbanSDK+getUniqueAssignees) ⇒
    * [.getUniqueLabels(boardId)](#KanbanSDK+getUniqueLabels) ⇒
    * [.getLabels()](#KanbanSDK+getLabels) ⇒
    * [.setLabel(name, definition)](#KanbanSDK+setLabel)
    * [.deleteLabel(name)](#KanbanSDK+deleteLabel)
    * [.renameLabel(oldName, newName)](#KanbanSDK+renameLabel)
    * [.getLabelsInGroup(group)](#KanbanSDK+getLabelsInGroup) ⇒
    * [.filterCardsByLabelGroup(group, boardId)](#KanbanSDK+filterCardsByLabelGroup) ⇒
    * [.addAttachment(cardId, sourcePath, boardId)](#KanbanSDK+addAttachment) ⇒
    * [.removeAttachment(cardId, attachment, boardId)](#KanbanSDK+removeAttachment) ⇒
    * [.listAttachments(cardId, boardId)](#KanbanSDK+listAttachments) ⇒
    * [.listComments(cardId, boardId)](#KanbanSDK+listComments) ⇒
    * [.addComment(cardId, author, content, boardId)](#KanbanSDK+addComment) ⇒
    * [.updateComment(cardId, commentId, content, boardId)](#KanbanSDK+updateComment) ⇒
    * [.deleteComment(cardId, commentId, boardId)](#KanbanSDK+deleteComment) ⇒
    * [.listColumns(boardId)](#KanbanSDK+listColumns) ⇒
    * [.addColumn(column, boardId)](#KanbanSDK+addColumn) ⇒
    * [.updateColumn(columnId, updates, boardId)](#KanbanSDK+updateColumn) ⇒
    * [.removeColumn(columnId, boardId)](#KanbanSDK+removeColumn) ⇒
    * [.reorderColumns(columnIds, boardId)](#KanbanSDK+reorderColumns) ⇒
    * [.getSettings()](#KanbanSDK+getSettings) ⇒
    * [.updateSettings(settings)](#KanbanSDK+updateSettings)


* * *

<a name="new_KanbanSDK_new"></a>

#### new KanbanSDK(featuresDir, options)
Creates a new KanbanSDK instance.


| Param | Description |
| --- | --- |
| featuresDir | Absolute path to the `.kanban` features directory.   The parent of this directory is treated as the workspace root. |
| options | Optional configuration including an event handler callback. |

**Example**  
```ts
const sdk = new KanbanSDK('/path/to/project/.kanban')
await sdk.init()
const cards = await sdk.listCards()
```

* * *

<a name="KanbanSDK+workspaceRoot"></a>

#### kanbanSDK.workspaceRoot ⇒
The workspace root directory (parent of the features directory).

This is the project root where `.kanban.json` configuration lives.

**Kind**: instance property of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: The absolute path to the workspace root directory.  
**Example**  
```ts
const sdk = new KanbanSDK('/home/user/my-project/.kanban')
console.log(sdk.workspaceRoot) // '/home/user/my-project'
```

* * *

<a name="KanbanSDK+emitEvent"></a>

#### kanbanSDK.emitEvent()
Emits an event to the registered handler, if one exists.
Called internally after every successful mutating operation.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  

* * *

<a name="KanbanSDK+init"></a>

#### kanbanSDK.init() ⇒
Initializes the SDK by running any pending filesystem migrations and
ensuring the default board's directory structure exists.

This should be called once before performing any operations, especially
on a fresh workspace or after upgrading from a single-board layout.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A promise that resolves when initialization is complete.  
**Example**  
```ts
const sdk = new KanbanSDK('/path/to/project/.kanban')
await sdk.init()
```

* * *

<a name="KanbanSDK+listBoards"></a>

#### kanbanSDK.listBoards() ⇒
Lists all boards defined in the workspace configuration.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: An array of [BoardInfo](BoardInfo) objects containing each board's
  `id`, `name`, and optional `description`.  
**Example**  
```ts
const boards = sdk.listBoards()
// [{ id: 'default', name: 'Default Board', description: undefined }]
```

* * *

<a name="KanbanSDK+createBoard"></a>

#### kanbanSDK.createBoard(id, name, options) ⇒
Creates a new board with the given ID and name.

If no columns are specified, the new board inherits columns from the
default board. If the default board has no columns, a standard set of
five columns (Backlog, To Do, In Progress, Review, Done) is used.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A [BoardInfo](BoardInfo) object for the newly created board.  
**Throws**:

- <code>Error</code> If a board with the given `id` already exists.


| Param | Description |
| --- | --- |
| id | Unique identifier for the board (used in file paths and API calls). |
| name | Human-readable display name for the board. |
| options | Optional configuration for the new board. |
| options.description | A short description of the board's purpose. |
| options.columns | Custom column definitions. Defaults to the default board's columns. |
| options.defaultStatus | The default status for new cards. Defaults to the first column's ID. |
| options.defaultPriority | The default priority for new cards. Defaults to the workspace default. |

**Example**  
```ts
const board = sdk.createBoard('bugs', 'Bug Tracker', {
  description: 'Track and triage bugs',
  defaultStatus: 'triage'
})
```

* * *

<a name="KanbanSDK+deleteBoard"></a>

#### kanbanSDK.deleteBoard(boardId) ⇒
Deletes a board and its directory from the filesystem.

The board must be empty (no cards) and must not be the default board.
The board's directory is removed recursively from disk, and the board
entry is removed from the workspace configuration.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A promise that resolves when the board has been deleted.  
**Throws**:

- <code>Error</code> If the board does not exist.
- <code>Error</code> If the board is the default board.
- <code>Error</code> If the board still contains cards.


| Param | Description |
| --- | --- |
| boardId | The ID of the board to delete. |

**Example**  
```ts
await sdk.deleteBoard('old-sprint')
```

* * *

<a name="KanbanSDK+getBoard"></a>

#### kanbanSDK.getBoard(boardId) ⇒
Retrieves the full configuration for a specific board.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: The [BoardConfig](BoardConfig) object containing columns, settings, and metadata.  
**Throws**:

- <code>Error</code> If the board does not exist.


| Param | Description |
| --- | --- |
| boardId | The ID of the board to retrieve. |

**Example**  
```ts
const config = sdk.getBoard('default')
console.log(config.columns) // [{ id: 'backlog', name: 'Backlog', ... }, ...]
```

* * *

<a name="KanbanSDK+updateBoard"></a>

#### kanbanSDK.updateBoard(boardId, updates) ⇒
Updates properties of an existing board.

Only the provided fields are updated; omitted fields remain unchanged.
The `nextCardId` counter cannot be modified through this method.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: The updated [BoardConfig](BoardConfig) object.  
**Throws**:

- <code>Error</code> If the board does not exist.


| Param | Description |
| --- | --- |
| boardId | The ID of the board to update. |
| updates | A partial object containing the fields to update. |
| updates.name | New display name for the board. |
| updates.description | New description for the board. |
| updates.columns | Replacement column definitions. |
| updates.defaultStatus | New default status for new cards. |
| updates.defaultPriority | New default priority for new cards. |

**Example**  
```ts
const updated = sdk.updateBoard('bugs', {
  name: 'Bug Tracker v2',
  defaultPriority: 'high'
})
```

* * *

<a name="KanbanSDK+transferCard"></a>

#### kanbanSDK.transferCard(cardId, fromBoardId, toBoardId, targetStatus) ⇒
Transfers a card from one board to another.

The card file is physically moved to the target board's directory. If a
target status is not specified, the card is placed in the target board's
default status column. The card's order is recalculated to place it at
the end of the target column. Timestamps (`modified`, `completedAt`)
are updated accordingly.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A promise resolving to the updated [Feature](Feature) card object.  
**Throws**:

- <code>Error</code> If either board does not exist.
- <code>Error</code> If the card is not found in the source board.


| Param | Description |
| --- | --- |
| cardId | The ID of the card to transfer. |
| fromBoardId | The ID of the source board. |
| toBoardId | The ID of the destination board. |
| targetStatus | Optional status column in the destination board.   Defaults to the destination board's default status. |

**Example**  
```ts
const card = await sdk.transferCard('42', 'inbox', 'bugs', 'triage')
console.log(card.boardId) // 'bugs'
console.log(card.status)  // 'triage'
```

* * *

<a name="KanbanSDK+listCards"></a>

#### kanbanSDK.listCards(columns, boardId) ⇒
Lists all cards on a board, optionally filtered by column/status.

**Note:** This includes soft-deleted cards (status `'deleted'`).
Filter them out if you need only active cards.

This method performs several housekeeping tasks during loading:
- Migrates flat root-level `.md` files into their proper status subdirectories
- Reconciles status/folder mismatches (moves files to match their frontmatter status)
- Migrates legacy integer ordering to fractional indexing
- Syncs the card ID counter with existing cards

Cards are returned sorted by their fractional order key.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A promise resolving to an array of [Feature](Feature) card objects, sorted by order.  

| Param | Description |
| --- | --- |
| columns | Optional array of status/column IDs to filter by.   When provided, ensures those subdirectories exist on disk. |
| boardId | Optional board ID. Defaults to the workspace's default board. |

**Example**  
```ts
// List all cards on the default board
const allCards = await sdk.listCards()

// List only cards in 'todo' and 'in-progress' columns on the 'bugs' board
const filtered = await sdk.listCards(['todo', 'in-progress'], 'bugs')
```

* * *

<a name="KanbanSDK+getCard"></a>

#### kanbanSDK.getCard(cardId, boardId) ⇒
Retrieves a single card by its ID.

Supports partial ID matching -- the provided `cardId` is matched against
all cards on the board.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A promise resolving to the matching [Feature](Feature) card, or `null` if not found.  

| Param | Description |
| --- | --- |
| cardId | The full or partial ID of the card to retrieve. |
| boardId | Optional board ID. Defaults to the workspace's default board. |

**Example**  
```ts
const card = await sdk.getCard('42')
if (card) {
  console.log(card.content)
}
```

* * *

<a name="KanbanSDK+createCard"></a>

#### kanbanSDK.createCard(data) ⇒
Creates a new card on a board.

The card is assigned an auto-incrementing numeric ID, placed at the end
of its target status column using fractional indexing, and persisted as a
markdown file with YAML frontmatter. If no status or priority is provided,
the board's defaults are used.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A promise resolving to the newly created [Feature](Feature) card.  

| Param | Description |
| --- | --- |
| data | The card creation input. See [CreateCardInput](CreateCardInput). |
| data.content | Markdown content for the card. The first `# Heading` becomes the title. |
| data.status | Optional status column. Defaults to the board's default status. |
| data.priority | Optional priority level. Defaults to the board's default priority. |
| data.assignee | Optional assignee name. |
| data.dueDate | Optional due date as an ISO 8601 string. |
| data.labels | Optional array of label strings. |
| data.attachments | Optional array of attachment filenames. |
| data.metadata | Optional arbitrary key-value metadata stored in the card's frontmatter. |
| data.boardId | Optional board ID. Defaults to the workspace's default board. |

**Example**  
```ts
const card = await sdk.createCard({
  content: '# Fix login bug\n\nUsers cannot log in with email.',
  status: 'todo',
  priority: 'high',
  labels: ['bug', 'auth'],
  boardId: 'bugs'
})
console.log(card.id) // '7'
```

* * *

<a name="KanbanSDK+updateCard"></a>

#### kanbanSDK.updateCard(cardId, updates, boardId) ⇒
Updates an existing card's properties.

Only the provided fields are updated; omitted fields remain unchanged.
The `filePath`, `id`, and `boardId` fields are protected and cannot be
overwritten. If the card's title changes, the underlying file is renamed.
If the status changes, the file is moved to the new status subdirectory
and `completedAt` is updated accordingly.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A promise resolving to the updated [Feature](Feature) card.  
**Throws**:

- <code>Error</code> If the card is not found.


| Param | Description |
| --- | --- |
| cardId | The ID of the card to update. |
| updates | A partial [Feature](Feature) object with the fields to update. |
| boardId | Optional board ID. Defaults to the workspace's default board. |

**Example**  
```ts
const updated = await sdk.updateCard('42', {
  priority: 'critical',
  assignee: 'alice',
  labels: ['urgent', 'backend']
})
```

* * *

<a name="KanbanSDK+moveCard"></a>

#### kanbanSDK.moveCard(cardId, newStatus, position, boardId) ⇒
Moves a card to a different status column and/or position within that column.

The card's fractional order key is recalculated based on the target
position. If the status changes, the underlying file is moved to the
corresponding subdirectory and `completedAt` is updated accordingly.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A promise resolving to the updated [Feature](Feature) card.  
**Throws**:

- <code>Error</code> If the card is not found.


| Param | Description |
| --- | --- |
| cardId | The ID of the card to move. |
| newStatus | The target status/column ID. |
| position | Optional zero-based index within the target column.   Defaults to the end of the column. |
| boardId | Optional board ID. Defaults to the workspace's default board. |

**Example**  
```ts
// Move card to 'in-progress' at position 0 (top of column)
const card = await sdk.moveCard('42', 'in-progress', 0)

// Move card to 'done' at the end (default)
const done = await sdk.moveCard('42', 'done')
```

* * *

<a name="KanbanSDK+deleteCard"></a>

#### kanbanSDK.deleteCard(cardId, boardId) ⇒
Soft-deletes a card by moving it to the `deleted` status column.
The file remains on disk and can be restored.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A promise that resolves when the card has been moved to deleted status.  
**Throws**:

- <code>Error</code> If the card is not found.


| Param | Description |
| --- | --- |
| cardId | The ID of the card to soft-delete. |
| boardId | Optional board ID. Defaults to the workspace's default board. |

**Example**  
```ts
await sdk.deleteCard('42', 'bugs')
```

* * *

<a name="KanbanSDK+permanentlyDeleteCard"></a>

#### kanbanSDK.permanentlyDeleteCard(cardId, boardId) ⇒
Permanently deletes a card's markdown file from disk.
This cannot be undone.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A promise that resolves when the card file has been removed from disk.  
**Throws**:

- <code>Error</code> If the card is not found.


| Param | Description |
| --- | --- |
| cardId | The ID of the card to permanently delete. |
| boardId | Optional board ID. Defaults to the workspace's default board. |

**Example**  
```ts
await sdk.permanentlyDeleteCard('42', 'bugs')
```

* * *

<a name="KanbanSDK+getCardsByStatus"></a>

#### kanbanSDK.getCardsByStatus(status, boardId) ⇒
Returns all cards in a specific status column.

This is a convenience wrapper around [listCards](listCards) that filters
by a single status value.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A promise resolving to an array of [Feature](Feature) cards in the given status.  

| Param | Description |
| --- | --- |
| status | The status/column ID to filter by (e.g., `'todo'`, `'in-progress'`). |
| boardId | Optional board ID. Defaults to the workspace's default board. |

**Example**  
```ts
const inProgress = await sdk.getCardsByStatus('in-progress')
console.log(`${inProgress.length} cards in progress`)
```

* * *

<a name="KanbanSDK+getUniqueAssignees"></a>

#### kanbanSDK.getUniqueAssignees(boardId) ⇒
Returns a sorted list of unique assignee names across all cards on a board.

Cards with no assignee are excluded from the result.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A promise resolving to a sorted array of unique assignee name strings.  

| Param | Description |
| --- | --- |
| boardId | Optional board ID. Defaults to the workspace's default board. |

**Example**  
```ts
const assignees = await sdk.getUniqueAssignees('bugs')
// ['alice', 'bob', 'charlie']
```

* * *

<a name="KanbanSDK+getUniqueLabels"></a>

#### kanbanSDK.getUniqueLabels(boardId) ⇒
Returns a sorted list of unique labels across all cards on a board.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A promise resolving to a sorted array of unique label strings.  

| Param | Description |
| --- | --- |
| boardId | Optional board ID. Defaults to the workspace's default board. |

**Example**  
```ts
const labels = await sdk.getUniqueLabels()
// ['bug', 'enhancement', 'frontend', 'urgent']
```

* * *

<a name="KanbanSDK+getLabels"></a>

#### kanbanSDK.getLabels() ⇒
Returns all label definitions from the workspace configuration.

Label definitions map label names to their color and optional group.
Labels on cards that have no definition will render with default gray styling.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A record mapping label names to [LabelDefinition](LabelDefinition) objects.  
**Example**  
```ts
const labels = sdk.getLabels()
// { bug: { color: '#e11d48', group: 'Type' }, docs: { color: '#16a34a' } }
```

* * *

<a name="KanbanSDK+setLabel"></a>

#### kanbanSDK.setLabel(name, definition)
Creates or updates a label definition in the workspace configuration.

If the label already exists, its definition is replaced entirely.
The change is persisted to `.kanban.json` immediately.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  

| Param | Description |
| --- | --- |
| name | The label name (e.g. `'bug'`, `'frontend'`). |
| definition | The label definition with color and optional group. |

**Example**  
```ts
sdk.setLabel('bug', { color: '#e11d48', group: 'Type' })
sdk.setLabel('docs', { color: '#16a34a' })
```

* * *

<a name="KanbanSDK+deleteLabel"></a>

#### kanbanSDK.deleteLabel(name)
Removes a label definition from the workspace configuration.

This only removes the color/group definition — cards that use this
label keep their label strings. Those labels will render with default
gray styling in the UI.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  

| Param | Description |
| --- | --- |
| name | The label name to remove. |

**Example**  
```ts
sdk.deleteLabel('bug')
```

* * *

<a name="KanbanSDK+renameLabel"></a>

#### kanbanSDK.renameLabel(oldName, newName)
Renames a label in the configuration and cascades the change to all cards.

Updates the label key in `.kanban.json` and replaces the old label name
with the new one on every card that uses it.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  

| Param | Description |
| --- | --- |
| oldName | The current label name. |
| newName | The new label name. |

**Example**  
```ts
await sdk.renameLabel('bug', 'defect')
// Config updated: 'defect' now has bug's color/group
// All cards with 'bug' label now have 'defect' instead
```

* * *

<a name="KanbanSDK+getLabelsInGroup"></a>

#### kanbanSDK.getLabelsInGroup(group) ⇒
Returns a sorted list of label names that belong to the given group.

Labels without an explicit `group` property are not matched by any
group name (they are considered ungrouped).

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A sorted array of label names in the group.  

| Param | Description |
| --- | --- |
| group | The group name to filter by (e.g. `'Type'`, `'Priority'`). |

**Example**  
```ts
sdk.setLabel('bug', { color: '#e11d48', group: 'Type' })
sdk.setLabel('feature', { color: '#2563eb', group: 'Type' })

sdk.getLabelsInGroup('Type')
// ['bug', 'feature']
```

* * *

<a name="KanbanSDK+filterCardsByLabelGroup"></a>

#### kanbanSDK.filterCardsByLabelGroup(group, boardId) ⇒
Returns all cards that have at least one label belonging to the given group.

Looks up all labels in the group via [getLabelsInGroup](getLabelsInGroup), then filters
cards to those containing any of those labels.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A promise resolving to an array of matching [Feature](Feature) cards.  

| Param | Description |
| --- | --- |
| group | The group name to filter by. |
| boardId | Optional board ID. Defaults to the workspace's default board. |

**Example**  
```ts
const typeCards = await sdk.filterCardsByLabelGroup('Type')
// Returns all cards with 'bug', 'feature', or any other 'Type' label
```

* * *

<a name="KanbanSDK+addAttachment"></a>

#### kanbanSDK.addAttachment(cardId, sourcePath, boardId) ⇒
Adds a file attachment to a card.

The source file is copied into the card's directory (alongside its
markdown file) unless it already resides there. The attachment filename
is added to the card's `attachments` array if not already present.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A promise resolving to the updated [Feature](Feature) card.  
**Throws**:

- <code>Error</code> If the card is not found.


| Param | Description |
| --- | --- |
| cardId | The ID of the card to attach the file to. |
| sourcePath | Path to the file to attach. Can be absolute or relative. |
| boardId | Optional board ID. Defaults to the workspace's default board. |

**Example**  
```ts
const card = await sdk.addAttachment('42', '/tmp/screenshot.png')
console.log(card.attachments) // ['screenshot.png']
```

* * *

<a name="KanbanSDK+removeAttachment"></a>

#### kanbanSDK.removeAttachment(cardId, attachment, boardId) ⇒
Removes an attachment reference from a card's metadata.

This removes the attachment filename from the card's `attachments` array
but does not delete the physical file from disk.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A promise resolving to the updated [Feature](Feature) card.  
**Throws**:

- <code>Error</code> If the card is not found.


| Param | Description |
| --- | --- |
| cardId | The ID of the card to remove the attachment from. |
| attachment | The attachment filename to remove (e.g., `'screenshot.png'`). |
| boardId | Optional board ID. Defaults to the workspace's default board. |

**Example**  
```ts
const card = await sdk.removeAttachment('42', 'old-screenshot.png')
```

* * *

<a name="KanbanSDK+listAttachments"></a>

#### kanbanSDK.listAttachments(cardId, boardId) ⇒
Lists all attachment filenames for a card.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A promise resolving to an array of attachment filename strings.  
**Throws**:

- <code>Error</code> If the card is not found.


| Param | Description |
| --- | --- |
| cardId | The ID of the card whose attachments to list. |
| boardId | Optional board ID. Defaults to the workspace's default board. |

**Example**  
```ts
const files = await sdk.listAttachments('42')
// ['screenshot.png', 'debug-log.txt']
```

* * *

<a name="KanbanSDK+listComments"></a>

#### kanbanSDK.listComments(cardId, boardId) ⇒
Lists all comments on a card.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A promise resolving to an array of [Comment](Comment) objects.  
**Throws**:

- <code>Error</code> If the card is not found.


| Param | Description |
| --- | --- |
| cardId | The ID of the card whose comments to list. |
| boardId | Optional board ID. Defaults to the workspace's default board. |

**Example**  
```ts
const comments = await sdk.listComments('42')
for (const c of comments) {
  console.log(`${c.author}: ${c.content}`)
}
```

* * *

<a name="KanbanSDK+addComment"></a>

#### kanbanSDK.addComment(cardId, author, content, boardId) ⇒
Adds a comment to a card.

The comment is assigned an auto-incrementing ID (e.g., `'c1'`, `'c2'`)
based on the existing comments. The card's `modified` timestamp is updated.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A promise resolving to the updated [Feature](Feature) card (including the new comment).  
**Throws**:

- <code>Error</code> If the card is not found.


| Param | Description |
| --- | --- |
| cardId | The ID of the card to comment on. |
| author | The name of the comment author. |
| content | The comment text content. |
| boardId | Optional board ID. Defaults to the workspace's default board. |

**Example**  
```ts
const card = await sdk.addComment('42', 'alice', 'This needs more investigation.')
console.log(card.comments.length) // 1
```

* * *

<a name="KanbanSDK+updateComment"></a>

#### kanbanSDK.updateComment(cardId, commentId, content, boardId) ⇒
Updates the content of an existing comment on a card.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A promise resolving to the updated [Feature](Feature) card.  
**Throws**:

- <code>Error</code> If the card is not found.
- <code>Error</code> If the comment is not found on the card.


| Param | Description |
| --- | --- |
| cardId | The ID of the card containing the comment. |
| commentId | The ID of the comment to update (e.g., `'c1'`). |
| content | The new content for the comment. |
| boardId | Optional board ID. Defaults to the workspace's default board. |

**Example**  
```ts
const card = await sdk.updateComment('42', 'c1', 'Updated: this is now resolved.')
```

* * *

<a name="KanbanSDK+deleteComment"></a>

#### kanbanSDK.deleteComment(cardId, commentId, boardId) ⇒
Deletes a comment from a card.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A promise resolving to the updated [Feature](Feature) card.  
**Throws**:

- <code>Error</code> If the card is not found.


| Param | Description |
| --- | --- |
| cardId | The ID of the card containing the comment. |
| commentId | The ID of the comment to delete (e.g., `'c1'`). |
| boardId | Optional board ID. Defaults to the workspace's default board. |

**Example**  
```ts
const card = await sdk.deleteComment('42', 'c2')
```

* * *

<a name="KanbanSDK+listColumns"></a>

#### kanbanSDK.listColumns(boardId) ⇒
Lists all columns defined for a board.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: An array of [KanbanColumn](KanbanColumn) objects in their current order.  

| Param | Description |
| --- | --- |
| boardId | Optional board ID. Defaults to the workspace's default board. |

**Example**  
```ts
const columns = sdk.listColumns('bugs')
// [{ id: 'triage', name: 'Triage', color: '#ef4444' }, ...]
```

* * *

<a name="KanbanSDK+addColumn"></a>

#### kanbanSDK.addColumn(column, boardId) ⇒
Adds a new column to a board.

The column is appended to the end of the board's column list.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: The full updated array of [KanbanColumn](KanbanColumn) objects for the board.  
**Throws**:

- <code>Error</code> If the board is not found.
- <code>Error</code> If a column with the same ID already exists.
- <code>Error</code> If the column ID is `'deleted'` (reserved for soft-delete).


| Param | Description |
| --- | --- |
| column | The column definition to add. |
| column.id | Unique identifier for the column (used as status values on cards). |
| column.name | Human-readable display name. |
| column.color | CSS color string for the column header. |
| boardId | Optional board ID. Defaults to the workspace's default board. |

**Example**  
```ts
const columns = sdk.addColumn(
  { id: 'blocked', name: 'Blocked', color: '#ef4444' },
  'default'
)
```

* * *

<a name="KanbanSDK+updateColumn"></a>

#### kanbanSDK.updateColumn(columnId, updates, boardId) ⇒
Updates the properties of an existing column.

Only the provided fields (`name`, `color`) are updated; the column's
`id` cannot be changed.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: The full updated array of [KanbanColumn](KanbanColumn) objects for the board.  
**Throws**:

- <code>Error</code> If the board is not found.
- <code>Error</code> If the column is not found.


| Param | Description |
| --- | --- |
| columnId | The ID of the column to update. |
| updates | A partial object with the fields to update. |
| updates.name | New display name for the column. |
| updates.color | New CSS color string for the column. |
| boardId | Optional board ID. Defaults to the workspace's default board. |

**Example**  
```ts
const columns = sdk.updateColumn('in-progress', {
  name: 'Working On',
  color: '#f97316'
})
```

* * *

<a name="KanbanSDK+removeColumn"></a>

#### kanbanSDK.removeColumn(columnId, boardId) ⇒
Removes a column from a board.

The column must be empty (no cards currently assigned to it).
This operation cannot be undone.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A promise resolving to the updated array of [KanbanColumn](KanbanColumn) objects.  
**Throws**:

- <code>Error</code> If the board is not found.
- <code>Error</code> If the column is not found.
- <code>Error</code> If the column still contains cards.
- <code>Error</code> If the column ID is `'deleted'` (reserved for soft-delete).


| Param | Description |
| --- | --- |
| columnId | The ID of the column to remove. |
| boardId | Optional board ID. Defaults to the workspace's default board. |

**Example**  
```ts
const columns = await sdk.removeColumn('blocked', 'default')
```

* * *

<a name="KanbanSDK+reorderColumns"></a>

#### kanbanSDK.reorderColumns(columnIds, boardId) ⇒
Reorders the columns of a board.

The `columnIds` array must contain every existing column ID exactly once,
in the desired new order.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: The reordered array of [KanbanColumn](KanbanColumn) objects.  
**Throws**:

- <code>Error</code> If the board is not found.
- <code>Error</code> If any column ID in the array does not exist.
- <code>Error</code> If the array does not include all column IDs.


| Param | Description |
| --- | --- |
| columnIds | An array of all column IDs in the desired order. |
| boardId | Optional board ID. Defaults to the workspace's default board. |

**Example**  
```ts
const columns = sdk.reorderColumns(
  ['backlog', 'todo', 'blocked', 'in-progress', 'review', 'done'],
  'default'
)
```

* * *

<a name="KanbanSDK+getSettings"></a>

#### kanbanSDK.getSettings() ⇒
Returns the global card display settings for the workspace.

Display settings control which fields are shown on card previews
(e.g., priority badges, assignee avatars, due dates, labels).

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: The current [CardDisplaySettings](CardDisplaySettings) object.  
**Example**  
```ts
const settings = sdk.getSettings()
console.log(settings.showPriority) // true
```

* * *

<a name="KanbanSDK+updateSettings"></a>

#### kanbanSDK.updateSettings(settings)
Updates the global card display settings for the workspace.

The provided settings object fully replaces the display settings
in the workspace configuration file (`.kanban.json`).

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  

| Param | Description |
| --- | --- |
| settings | The new [CardDisplaySettings](CardDisplaySettings) to apply. |

**Example**  
```ts
sdk.updateSettings({
  showPriority: true,
  showAssignee: true,
  showDueDate: false,
  showLabels: true
})
```

* * *


## Types

<a name="DEFAULT_COLUMNS"></a>

### DEFAULT\_COLUMNS
The default set of five kanban columns provided when no custom columns
are configured: Backlog, To Do, In Progress, Review, and Done.

**Kind**: global variable  
**Example**  
```js
// Use as the initial column configuration
const config = { columns: [...DEFAULT_COLUMNS] }
```

* * *

<a name="getTitleFromContent"></a>

### getTitleFromContent(content) ⇒
Extracts a title from markdown content by finding the first `# heading`.
Falls back to the first non-empty line if no heading is found,
or `'Untitled'` if the content is empty.

**Kind**: global function  
**Returns**: The extracted title string.  

| Param | Description |
| --- | --- |
| content | Raw markdown string to extract the title from. |

**Example**  
```js
getTitleFromContent('# My Card\nSome body text')
// => 'My Card'
```
**Example**  
```js
getTitleFromContent('Just a line of text')
// => 'Just a line of text'
```

* * *

<a name="generateSlug"></a>

### generateSlug(title) ⇒
Creates a filename-safe slug from a title string.

The slug is lowercased, stripped of special characters, limited to 50
characters, and falls back to `'feature'` if the result would be empty.

**Kind**: global function  
**Returns**: A URL/filename-safe slug string.  

| Param | Description |
| --- | --- |
| title | The human-readable title to slugify. |

**Example**  
```js
generateSlug('Build Dashboard UI')
// => 'build-dashboard-ui'
```
**Example**  
```js
generateSlug('Hello, World!!!')
// => 'hello-world'
```

* * *

<a name="generateFeatureFilename"></a>

### generateFeatureFilename(id, title) ⇒ <code>id</code>
Generates a card filename from an incremental numeric ID and a title.

The filename is composed of the ID prefix followed by a slugified title
(e.g. `'42-build-dashboard'`).

**Kind**: global function  
**Returns**: <code>id</code> - A filename string in the format `'-{slug}'`.  

| Param | Description |
| --- | --- |
| id | The numeric card ID. |
| title | The human-readable card title. |

**Example**  
```js
generateFeatureFilename(42, 'Build Dashboard')
// => '42-build-dashboard'
```

* * *

<a name="extractNumericId"></a>

### extractNumericId(filenameOrId) ⇒
Extracts the numeric ID prefix from a filename or card ID string.

Looks for a leading sequence of digits optionally followed by a hyphen
(e.g. `'42-build-dashboard'` yields `42`).

**Kind**: global function  
**Returns**: The parsed numeric ID, or `null` if no numeric prefix is found.  

| Param | Description |
| --- | --- |
| filenameOrId | A filename or card ID string such as `'42-build-dashboard'`. |

**Example**  
```js
extractNumericId('42-build-dashboard')
// => 42
```
**Example**  
```js
extractNumericId('no-number')
// => null
```

* * *

<a name="sanitizeFeature"></a>

### sanitizeFeature(feature) ⇒
Strips the `filePath` property from a card before exposing it
in webhook payloads or API responses. The file path is an internal
implementation detail that should not be leaked externally.

**Kind**: global function  
**Returns**: A copy of the card without the `filePath` field.  

| Param | Description |
| --- | --- |
| feature | The card object to sanitize. |

**Example**  
```js
const safe = sanitizeFeature(card)
// safe.filePath is undefined
```

* * *


## Configuration

<a name="DEFAULT_CONFIG"></a>

### DEFAULT\_CONFIG
Default configuration used when no `.kanban.json` file exists or when
fields are missing from an existing config. Includes a single `'default'`
board with the standard five columns.

**Kind**: global variable  

* * *

<a name="CONFIG_FILENAME"></a>

### CONFIG\_FILENAME
The filename used for the kanban configuration file: `'.kanban.json'`.

**Kind**: global variable  

* * *

<a name="configPath"></a>

### configPath(workspaceRoot) ⇒
Returns the absolute path to the `.kanban.json` config file for a workspace.

**Kind**: global function  
**Returns**: Absolute path to the config file.  

| Param | Description |
| --- | --- |
| workspaceRoot | Absolute path to the workspace root directory. |

**Example**  
```js
configPath('/home/user/my-project')
// => '/home/user/my-project/.kanban.json'
```

* * *

<a name="readConfig"></a>

### readConfig(workspaceRoot) ⇒
Reads the kanban config from disk. If the file is missing or unreadable,
returns the default config. If the file contains a v1 config, it is
automatically migrated to v2 format and persisted back to disk.

**Kind**: global function  
**Returns**: The parsed (and possibly migrated) kanban configuration.  

| Param | Description |
| --- | --- |
| workspaceRoot | Absolute path to the workspace root directory. |

**Example**  
```js
const config = readConfig('/home/user/my-project')
console.log(config.defaultBoard) // => 'default'
```

* * *

<a name="writeConfig"></a>

### writeConfig(workspaceRoot, config)
Writes the kanban config to disk as pretty-printed JSON.

**Kind**: global function  

| Param | Description |
| --- | --- |
| workspaceRoot | Absolute path to the workspace root directory. |
| config | The kanban configuration to persist. |

**Example**  
```js
const config = readConfig('/home/user/my-project')
config.defaultBoard = 'sprint-1'
writeConfig('/home/user/my-project', config)
```

* * *

<a name="getDefaultBoardId"></a>

### getDefaultBoardId(workspaceRoot) ⇒
Returns the default board ID from the workspace config.

**Kind**: global function  
**Returns**: The default board ID string (e.g. `'default'`).  

| Param | Description |
| --- | --- |
| workspaceRoot | Absolute path to the workspace root directory. |

**Example**  
```js
const boardId = getDefaultBoardId('/home/user/my-project')
// => 'default'
```

* * *

<a name="getBoardConfig"></a>

### getBoardConfig(workspaceRoot, boardId) ⇒
Returns the configuration for a specific board. If `boardId` is omitted,
the default board is used.

**Kind**: global function  
**Returns**: The board configuration object.  
**Throws**:

- <code>Error</code> If the resolved board ID does not exist in the config.


| Param | Description |
| --- | --- |
| workspaceRoot | Absolute path to the workspace root directory. |
| boardId | Optional board ID. Defaults to the workspace's default board. |

**Example**  
```js
const board = getBoardConfig('/home/user/my-project', 'sprint-1')
console.log(board.name) // => 'Sprint 1'
```
**Example**  
```js
// Uses default board
const board = getBoardConfig('/home/user/my-project')
```

* * *

<a name="allocateCardId"></a>

### allocateCardId(workspaceRoot, boardId) ⇒
Allocates the next card ID for a board by reading and incrementing the
board's `nextCardId` counter. The updated config is persisted to disk.

**Kind**: global function  
**Returns**: The newly allocated numeric card ID.  
**Throws**:

- <code>Error</code> If the resolved board ID does not exist in the config.


| Param | Description |
| --- | --- |
| workspaceRoot | Absolute path to the workspace root directory. |
| boardId | Optional board ID. Defaults to the workspace's default board. |

**Example**  
```js
const id = allocateCardId('/home/user/my-project')
// => 1 (first call), 2 (second call), etc.
```

* * *

<a name="syncCardIdCounter"></a>

### syncCardIdCounter(workspaceRoot, boardId, existingIds)
Synchronizes the board's `nextCardId` counter to be greater than all
existing card IDs. This prevents ID collisions when cards have been
created outside the normal allocation flow (e.g. manual file creation).

Does nothing if `existingIds` is empty or the counter is already ahead.

**Kind**: global function  

| Param | Description |
| --- | --- |
| workspaceRoot | Absolute path to the workspace root directory. |
| boardId | The board ID to synchronize. |
| existingIds | Array of numeric card IDs currently present on the board. |

**Example**  
```js
syncCardIdCounter('/home/user/my-project', 'default', [1, 5, 12])
// Board's nextCardId is now at least 13
```

* * *

<a name="configToSettings"></a>

### configToSettings(config) ⇒
Extracts [CardDisplaySettings](CardDisplaySettings) from a [KanbanConfig](KanbanConfig) by
picking out the global display-related fields.

**Kind**: global function  
**Returns**: A `CardDisplaySettings` object with the current display preferences.  

| Param | Description |
| --- | --- |
| config | The kanban configuration to extract settings from. |

**Example**  
```js
const config = readConfig('/home/user/my-project')
const settings = configToSettings(config)
console.log(settings.compactMode) // => false
```

* * *

<a name="settingsToConfig"></a>

### settingsToConfig(config, settings) ⇒
Merges [CardDisplaySettings](CardDisplaySettings) back into a [KanbanConfig](KanbanConfig),
returning a new config object with the display fields updated.

**Kind**: global function  
**Returns**: A new `KanbanConfig` with the display settings applied.  

| Param | Description |
| --- | --- |
| config | The existing kanban configuration to update. |
| settings | The display settings to merge into the config. |

**Example**  
```js
const config = readConfig('/home/user/my-project')
const updated = settingsToConfig(config, { ...configToSettings(config), compactMode: true })
writeConfig('/home/user/my-project', updated)
```

* * *


## Parser

<a name="parseFeatureFile"></a>

### parseFeatureFile(content, filePath) ⇒
Parses a markdown file with YAML frontmatter into a Feature object.

The file is expected to have a YAML frontmatter block delimited by `---` at the
top, followed by the card body content. Additional `---` delimited blocks after
the body are parsed as comment sections (if they contain `comment: true`),
otherwise they are treated as part of the body content.

**Kind**: global function  
**Returns**: The parsed [Feature](Feature) object, or `null` if no valid frontmatter block is found.  

| Param | Description |
| --- | --- |
| content | The raw string content of the markdown file. |
| filePath | The absolute file path, used to extract the card ID from the filename   if no `id` field is present in the frontmatter. |


* * *

<a name="serializeFeature"></a>

### serializeFeature(feature) ⇒
Serializes a Feature object back to markdown with YAML frontmatter.

Produces a string with a `---` delimited YAML frontmatter block containing all
card metadata, followed by the card body content. Any comments attached to the
feature are appended as additional `---` delimited sections at the end of the file.

**Kind**: global function  
**Returns**: The complete markdown string ready to be written to a `.md` file.  

| Param | Description |
| --- | --- |
| feature | The [Feature](Feature) object to serialize. |


* * *


## File Utilities

<a name="getFeatureFilePath"></a>

### getFeatureFilePath(featuresDir, status, filename) ⇒
Constructs the full file path for a card markdown file.

**Kind**: global function  
**Returns**: The absolute path to the card file, including the `.md` extension.  

| Param | Description |
| --- | --- |
| featuresDir | The root features directory (e.g., `.kanban`). |
| status | The status subdirectory name (e.g., `backlog`, `in-progress`). |
| filename | The card filename without the `.md` extension. |


* * *

<a name="ensureDirectories"></a>

### ensureDirectories(featuresDir) ⇒
Creates the features directory if it does not already exist.

**Kind**: global function  
**Returns**: A promise that resolves when the directory has been created or already exists.  

| Param | Description |
| --- | --- |
| featuresDir | The root features directory path to ensure exists. |


* * *

<a name="ensureStatusSubfolders"></a>

### ensureStatusSubfolders(featuresDir, statuses) ⇒
Creates subdirectories for each status column under the features directory.

**Kind**: global function  
**Returns**: A promise that resolves when all status subdirectories have been created.  

| Param | Description |
| --- | --- |
| featuresDir | The root features directory containing status subdirectories. |
| statuses | An array of status names to create as subdirectories. |


* * *

<a name="moveFeatureFile"></a>

### moveFeatureFile(currentPath, featuresDir, newStatus, attachments) ⇒
Moves a card file to a new status directory, handling name collisions by
appending a numeric suffix (e.g., `card-1.md`, `card-2.md`). Optionally
co-moves attachment files from the source directory to the target directory.

**Kind**: global function  
**Returns**: A promise that resolves to the new absolute path of the moved card file.  

| Param | Description |
| --- | --- |
| currentPath | The current absolute path of the card file. |
| featuresDir | The root features directory. |
| newStatus | The target status subdirectory to move the card into. |
| attachments | Optional array of attachment filenames to co-move alongside the card. |


* * *

<a name="renameFeatureFile"></a>

### renameFeatureFile(currentPath, newFilename) ⇒
Renames a card file in place within its current directory.

**Kind**: global function  
**Returns**: A promise that resolves to the new absolute path of the renamed card file.  

| Param | Description |
| --- | --- |
| currentPath | The current absolute path of the card file. |
| newFilename | The new filename without the `.md` extension. |


* * *

<a name="getStatusFromPath"></a>

### getStatusFromPath(filePath, featuresDir) ⇒
Extracts the status from a card's file path by examining the directory structure.

Expects the file to be located at `{featuresDir}/{status}/{filename}.md`. If the
relative path does not match this two-level structure, returns `null`.

**Kind**: global function  
**Returns**: The status string extracted from the path, or `null` if the path structure is unexpected.  

| Param | Description |
| --- | --- |
| filePath | The absolute path to the card file. |
| featuresDir | The root features directory used to compute the relative path. |


* * *


## Data Storage

Cards are stored as markdown files with YAML frontmatter:

```
.kanban/
  boards/
    default/
      backlog/
        1-implement-auth.md
        2-setup-ci.md
      todo/
      in-progress/
      review/
      done/
    bugs/
      new/
      investigating/
      fixed/
  .kanban.json          # Board configuration (v2)
  .kanban-webhooks.json # Webhook definitions
```

Each card file contains YAML frontmatter (id, status, priority, assignee, dates, labels, order) followed by markdown content and optional comment sections.

---

## Error Handling

All SDK methods throw standard `Error` objects with descriptive messages:

| Error | Cause |
|-------|-------|
| `Card not found: {id}` | No card matches the given ID |
| `Board not found: {id}` | Board ID doesn't exist in config |
| `Board already exists: {id}` | Duplicate board ID on create |
| `Cannot delete the default board: {id}` | Attempted to delete default board |
| `Cannot delete board "{id}": N card(s) still exist` | Board has cards |
| `Column not found: {id}` | Column ID doesn't exist |
| `Column already exists: {id}` | Duplicate column ID on add |
| `Cannot remove column "{id}": N card(s) still in this column` | Column has cards |
| `Must include all column IDs when reordering` | Missing columns in reorder |
| `Comment not found: {id}` | Comment ID doesn't exist |
