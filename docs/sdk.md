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
import type { Card, CardStatus, Priority, KanbanColumn, CardDisplaySettings, CreateCardInput } from 'kanban-lite/sdk'
import { parseCardFile, serializeCard, getTitleFromContent, getDisplayTitleFromContent, DEFAULT_COLUMNS } from 'kanban-lite/sdk'
import { readConfig, writeConfig, configToSettings, settingsToConfig } from 'kanban-lite/sdk'
```

Callback runtime helpers are also exported from the SDK barrel:

```typescript
import type { CallbackCapabilityNamespace, ResolvedCallbackCapabilities } from 'kanban-lite/sdk'
import { normalizeCallbackCapabilities } from 'kanban-lite/sdk'
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


## Parser

<a name="parseCardFile"></a>

### parseCardFile(content, filePath) ⇒
Parses a markdown file with YAML frontmatter into a Card object.

The file is expected to have a YAML frontmatter block delimited by `---` at the
top, followed by the card body content. Additional `---` delimited blocks after
the body are parsed as comment sections (if they contain `comment: true`),
otherwise they are treated as part of the body content.

**Kind**: global function  
**Returns**: The parsed [Card](Card) object, or `null` if no valid frontmatter block is found.  

| Param | Description |
| --- | --- |
| content | The raw string content of the markdown file. |
| filePath | The absolute file path, used to extract the card ID from the filename   if no `id` field is present in the frontmatter. |


* * *

<a name="serializeCard"></a>

### serializeCard(card) ⇒
Serializes a Card object back to markdown with YAML frontmatter.

Produces a string with a `---` delimited YAML frontmatter block containing all
card metadata, followed by the card body content. Any comments attached to the
card are appended as additional `---` delimited sections at the end of the file.

**Kind**: global function  
**Returns**: The complete markdown string ready to be written to a `.md` file.  

| Param | Description |
| --- | --- |
| card | The [Card](Card) object to serialize. |


* * *


## File Utilities

<a name="findWorkspaceRootSync"></a>

### findWorkspaceRootSync(startDir) ⇒
Synchronously walks up from `startDir` looking for a workspace root.

Preference order:
1. A directory containing `.git` (authoritative project root)
2. The nearest directory containing `.kanban.json`
3. The nearest directory containing `package.json`

This ensures monorepo package folders do not shadow the actual repository
root when a `.git` directory exists higher up the tree.

**Kind**: global function  
**Returns**: The detected workspace root, or `startDir` on no match.  

| Param | Description |
| --- | --- |
| startDir | Directory to start scanning from. |


* * *

<a name="resolveWorkspaceRoot"></a>

### resolveWorkspaceRoot(startDir, configFilePath) ⇒
Resolves the workspace root from either an explicit config file path or the
current directory tree.

**Kind**: global function  
**Returns**: The absolute workspace root path.  

| Param | Description |
| --- | --- |
| startDir | Optional directory to start scanning from. Defaults to `process.cwd()`. |
| configFilePath | Optional path to a specific `.kanban.json` file. |


* * *

<a name="resolveKanbanDir"></a>

### resolveKanbanDir(startDir, configFilePath) ⇒
Resolves the kanban directory without an explicit path by locating the
workspace root, then reading `kanbanDirectory` from the effective
`.kanban.json` file (defaults to `'.kanban'`).

**Kind**: global function  
**Returns**: The absolute path to the kanban directory.  

| Param | Description |
| --- | --- |
| startDir | Optional directory to start scanning from. Defaults to `process.cwd()`. |
| configFilePath | Optional path to a specific `.kanban.json` file. |


* * *

<a name="getCardFilePath"></a>

### getCardFilePath(kanbanDir, status, filename) ⇒
Constructs the full file path for a card markdown file.

**Kind**: global function  
**Returns**: The absolute path to the card file, including the `.md` extension.  

| Param | Description |
| --- | --- |
| kanbanDir | The root kanban directory (e.g., `.kanban`). |
| status | The status subdirectory name (e.g., `backlog`, `in-progress`). |
| filename | The card filename without the `.md` extension. |


* * *

<a name="ensureDirectories"></a>

### ensureDirectories(kanbanDir) ⇒
Creates the kanban directory if it does not already exist.

**Kind**: global function  
**Returns**: A promise that resolves when the directory has been created or already exists.  

| Param | Description |
| --- | --- |
| kanbanDir | The root kanban directory path to ensure exists. |


* * *

<a name="ensureStatusSubfolders"></a>

### ensureStatusSubfolders(kanbanDir, statuses) ⇒
Creates subdirectories for each status column under the kanban directory.

**Kind**: global function  
**Returns**: A promise that resolves when all status subdirectories have been created.  

| Param | Description |
| --- | --- |
| kanbanDir | The root kanban directory containing status subdirectories. |
| statuses | An array of status names to create as subdirectories. |


* * *

<a name="moveCardFile"></a>

### moveCardFile(currentPath, kanbanDir, newStatus, attachments) ⇒
Moves a card file to a new status directory, handling name collisions by
appending a numeric suffix (e.g., `card-1.md`, `card-2.md`). Optionally
co-moves attachment files from the source directory to the target directory.

**Kind**: global function  
**Returns**: A promise that resolves to the new absolute path of the moved card file.  

| Param | Description |
| --- | --- |
| currentPath | The current absolute path of the card file. |
| kanbanDir | The root kanban directory. |
| newStatus | The target status subdirectory to move the card into. |
| attachments | Optional array of attachment filenames to co-move alongside the card. |


* * *

<a name="renameCardFile"></a>

### renameCardFile(currentPath, newFilename) ⇒
Renames a card file in place within its current directory.

**Kind**: global function  
**Returns**: A promise that resolves to the new absolute path of the renamed card file.  

| Param | Description |
| --- | --- |
| currentPath | The current absolute path of the card file. |
| newFilename | The new filename without the `.md` extension. |


* * *

<a name="getStatusFromPath"></a>

### getStatusFromPath(filePath, kanbanDir) ⇒
Extracts the status from a card's file path by examining the directory structure.

Expects the file to be located at `{kanbanDir}/{status}/{filename}.md`. If the
relative path does not match this two-level structure, returns `null`.

**Kind**: global function  
**Returns**: The status string extracted from the path, or `null` if the path structure is unexpected.  

| Param | Description |
| --- | --- |
| filePath | The absolute path to the card file. |
| kanbanDir | The root kanban directory used to compute the relative path. |


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
  .kanban.json          # Board config, forms, labels, settings, and webhook definitions
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
