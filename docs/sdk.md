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


## KanbanSDK Class

<a name="PluginSettingsOperationError"></a>

### PluginSettingsOperationError
Error thrown when plugin settings SDK operations fail with a redacted payload.

**Kind**: global class  

* * *

<a name="PluginSettingsValidationError"></a>

### PluginSettingsValidationError
Error thrown when a plugin settings contract validation boundary rejects input.

**Kind**: global class  

* * *

<a name="KanbanSDK"></a>

### KanbanSDK
Core SDK for managing kanban boards with provider-backed card storage.

Provides full CRUD operations for boards, cards, columns, comments,
attachments, and display settings. By default cards are persisted as
markdown files with YAML frontmatter under the `.kanban/` directory,
organized by board and status column, but the resolved `card.storage`
provider may also route card/comment persistence to SQLite, MySQL, or an
external plugin.

This class is the foundation that the CLI, MCP server, and standalone
HTTP server are all built on top of.

**Kind**: global class  

* [KanbanSDK](#KanbanSDK)
    * [new KanbanSDK(kanbanDir, options)](#new_KanbanSDK_new)
    * _instance_
        * [.eventBus](#KanbanSDK+eventBus)
        * [.storageEngine](#KanbanSDK+storageEngine)
        * [.capabilities](#KanbanSDK+capabilities)
        * [._currentAuthContext](#KanbanSDK+_currentAuthContext)
        * [.workspaceRoot](#KanbanSDK+workspaceRoot) ⇒
        * [.on()](#KanbanSDK+on)
        * [.once()](#KanbanSDK+once)
        * [.many()](#KanbanSDK+many)
        * [.onAny()](#KanbanSDK+onAny)
        * [.off()](#KanbanSDK+off)
        * [.offAny()](#KanbanSDK+offAny)
        * [.removeAllListeners()](#KanbanSDK+removeAllListeners)
        * [.eventNames()](#KanbanSDK+eventNames)
        * [.listenerCount()](#KanbanSDK+listenerCount)
        * [.hasListeners()](#KanbanSDK+hasListeners)
        * [.waitFor()](#KanbanSDK+waitFor)
        * [.getStorageStatus()](#KanbanSDK+getStorageStatus) ⇒
        * [.getAuthStatus()](#KanbanSDK+getAuthStatus) ⇒
        * [.resolveMobileBootstrap(input)](#KanbanSDK+resolveMobileBootstrap) ⇒
        * [.inspectMobileSession(input)](#KanbanSDK+inspectMobileSession) ⇒
        * [.getWebhookStatus()](#KanbanSDK+getWebhookStatus) ⇒
        * [.listAvailableEvents(options)](#KanbanSDK+listAvailableEvents) ⇒
        * [.listPluginSettings()](#KanbanSDK+listPluginSettings) ⇒
        * [.getPluginSettings(capability, providerId)](#KanbanSDK+getPluginSettings) ⇒
        * [.selectPluginSettingsProvider(capability, providerId)](#KanbanSDK+selectPluginSettingsProvider) ⇒
        * [.updatePluginSettingsOptions(capability, providerId, options)](#KanbanSDK+updatePluginSettingsOptions) ⇒
        * [.installPluginSettingsPackage(input)](#KanbanSDK+installPluginSettingsPackage) ⇒
        * [.getCardStateStatus()](#KanbanSDK+getCardStateStatus)
        * [.getExtension(id)](#KanbanSDK+getExtension) ⇒
        * [._requireCardStateCapabilities()](#KanbanSDK+_requireCardStateCapabilities)
        * [._resolveCardStateTarget()](#KanbanSDK+_resolveCardStateTarget)
        * [._resolveCardStateTargetDirect()](#KanbanSDK+_resolveCardStateTargetDirect)
        * [._resolveCardStateActorId()](#KanbanSDK+_resolveCardStateActorId)
        * [._getLatestUnreadActivityCursor()](#KanbanSDK+_getLatestUnreadActivityCursor)
        * [._createUnreadSummary()](#KanbanSDK+_createUnreadSummary)
        * [.getCardState()](#KanbanSDK+getCardState)
        * [.getCardStateReadModelForCard(card, fallbackBoardId)](#KanbanSDK+getCardStateReadModelForCard) ⇒
        * [.getUnreadSummary()](#KanbanSDK+getUnreadSummary)
        * [.markCardOpened()](#KanbanSDK+markCardOpened)
        * [.markCardRead()](#KanbanSDK+markCardRead)
        * [._authorizeAction(action, context)](#KanbanSDK+_authorizeAction) ⇒
        * [.canPerformAction(action, context)](#KanbanSDK+canPerformAction) ⇒
        * [.runWithAuth(auth, fn)](#KanbanSDK+runWithAuth) ⇒
        * [._resolveEventActor()](#KanbanSDK+_resolveEventActor)
        * [._runBeforeEvent(event, input, actor, boardId)](#KanbanSDK+_runBeforeEvent) ⇒
        * [._runAfterEvent(event, data, actor, boardId, meta)](#KanbanSDK+_runAfterEvent)
        * [.getLocalCardPath(card)](#KanbanSDK+getLocalCardPath) ⇒
        * [.getAttachmentStoragePath(card)](#KanbanSDK+getAttachmentStoragePath) ⇒
        * [.appendAttachment()](#KanbanSDK+appendAttachment)
        * [.materializeAttachment(card, attachment)](#KanbanSDK+materializeAttachment) ⇒
        * [.copyAttachment(sourcePath, card)](#KanbanSDK+copyAttachment)
        * [.close()](#KanbanSDK+close)
        * [.destroy()](#KanbanSDK+destroy)
        * [.emitEvent()](#KanbanSDK+emitEvent)
        * [.getConfigSnapshot()](#KanbanSDK+getConfigSnapshot) ⇒
        * [._resolveBoardId()](#KanbanSDK+_resolveBoardId)
        * [._boardDir()](#KanbanSDK+_boardDir)
        * [._isCompletedStatus()](#KanbanSDK+_isCompletedStatus)
        * [._ensureMigrated()](#KanbanSDK+_ensureMigrated)
        * [.init()](#KanbanSDK+init) ⇒
        * [.listBoards()](#KanbanSDK+listBoards) ⇒
        * [.createBoard(id, name, options)](#KanbanSDK+createBoard) ⇒
        * [.deleteBoard(boardId)](#KanbanSDK+deleteBoard) ⇒
        * [.getBoard(boardId)](#KanbanSDK+getBoard) ⇒
        * [.updateBoard(boardId, updates)](#KanbanSDK+updateBoard) ⇒
        * [.getBoardActions(boardId)](#KanbanSDK+getBoardActions) ⇒
        * [.addBoardAction(boardId, key, title)](#KanbanSDK+addBoardAction) ⇒
        * [.removeBoardAction(boardId, key)](#KanbanSDK+removeBoardAction) ⇒
        * [.triggerBoardAction(boardId, actionKey)](#KanbanSDK+triggerBoardAction)
        * [.transferCard(cardId, fromBoardId, toBoardId, targetStatus)](#KanbanSDK+transferCard) ⇒
        * [._listCardsRaw()](#KanbanSDK+_listCardsRaw)
        * [.getCard(cardId, boardId)](#KanbanSDK+getCard) ⇒
        * [._getCardRaw()](#KanbanSDK+_getCardRaw)
        * [.getActiveCard(boardId)](#KanbanSDK+getActiveCard) ⇒
        * [.setActiveCard()](#KanbanSDK+setActiveCard)
        * [.clearActiveCard()](#KanbanSDK+clearActiveCard)
        * [.createCard(data)](#KanbanSDK+createCard) ⇒
        * [.updateCard(cardId, updates, boardId)](#KanbanSDK+updateCard) ⇒
        * [.addChecklistItem()](#KanbanSDK+addChecklistItem)
        * [.editChecklistItem()](#KanbanSDK+editChecklistItem)
        * [.deleteChecklistItem()](#KanbanSDK+deleteChecklistItem)
        * [.checkChecklistItem()](#KanbanSDK+checkChecklistItem)
        * [.uncheckChecklistItem()](#KanbanSDK+uncheckChecklistItem)
        * [.submitForm(input)](#KanbanSDK+submitForm) ⇒
        * [.triggerAction(cardId, action, boardId)](#KanbanSDK+triggerAction) ⇒
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
        * [.getAttachmentDir(cardId, boardId)](#KanbanSDK+getAttachmentDir) ⇒
        * [.listComments(cardId, boardId)](#KanbanSDK+listComments) ⇒
        * [.addComment(cardId, author, content, boardId)](#KanbanSDK+addComment) ⇒
        * [.updateComment(cardId, commentId, content, boardId)](#KanbanSDK+updateComment) ⇒
        * [.deleteComment(cardId, commentId, boardId)](#KanbanSDK+deleteComment) ⇒
        * [.streamComment(cardId, author, stream)](#KanbanSDK+streamComment) ⇒
        * [.getLogFilePath(cardId, boardId)](#KanbanSDK+getLogFilePath) ⇒
        * [.listLogs(cardId, boardId)](#KanbanSDK+listLogs) ⇒
        * [.addLog(cardId, text, options, boardId)](#KanbanSDK+addLog) ⇒
        * [.clearLogs(cardId, boardId)](#KanbanSDK+clearLogs) ⇒
        * [.getBoardLogFilePath(boardId)](#KanbanSDK+getBoardLogFilePath) ⇒
        * [.listBoardLogs(boardId)](#KanbanSDK+listBoardLogs) ⇒
        * [.addBoardLog(text, options, boardId)](#KanbanSDK+addBoardLog) ⇒
        * [.clearBoardLogs(boardId)](#KanbanSDK+clearBoardLogs) ⇒
        * [.listColumns(boardId)](#KanbanSDK+listColumns) ⇒
        * [.addColumn(column, boardId)](#KanbanSDK+addColumn) ⇒
        * [.updateColumn(columnId, updates, boardId)](#KanbanSDK+updateColumn) ⇒
        * [.removeColumn(columnId, boardId)](#KanbanSDK+removeColumn) ⇒
        * [.cleanupColumn(columnId, boardId)](#KanbanSDK+cleanupColumn) ⇒
        * [.purgeDeletedCards(boardId)](#KanbanSDK+purgeDeletedCards) ⇒
        * [.reorderColumns(columnIds, boardId)](#KanbanSDK+reorderColumns) ⇒
        * [.getMinimizedColumns(boardId)](#KanbanSDK+getMinimizedColumns) ⇒
        * [.setMinimizedColumns(columnIds, boardId)](#KanbanSDK+setMinimizedColumns) ⇒
        * [.getSettings()](#KanbanSDK+getSettings) ⇒
        * [.updateSettings(settings)](#KanbanSDK+updateSettings)
        * [.migrateToSqlite(dbPath)](#KanbanSDK+migrateToSqlite) ⇒
        * [.migrateToMarkdown()](#KanbanSDK+migrateToMarkdown) ⇒
        * [.setDefaultBoard(boardId)](#KanbanSDK+setDefaultBoard)
        * [.listWebhooks()](#KanbanSDK+listWebhooks) ⇒
        * [.createWebhook(webhookConfig)](#KanbanSDK+createWebhook) ⇒
        * [.deleteWebhook(id)](#KanbanSDK+deleteWebhook) ⇒
        * [.updateWebhook(id, updates)](#KanbanSDK+updateWebhook) ⇒
    * _static_
        * [._authStorage](#KanbanSDK._authStorage)
        * [._runWithScopedAuth()](#KanbanSDK._runWithScopedAuth)
        * [._getScopedAuth()](#KanbanSDK._getScopedAuth)
        * [._cloneMergeValue()](#KanbanSDK._cloneMergeValue)
        * [._deepMerge()](#KanbanSDK._deepMerge)


* * *

<a name="new_KanbanSDK_new"></a>

#### new KanbanSDK(kanbanDir, options)
Creates a new KanbanSDK instance.


| Param | Description |
| --- | --- |
| kanbanDir | Absolute path to the `.kanban` kanban directory.   When omitted, the directory is auto-detected by walking up from   `process.cwd()` to find the workspace root (via `.git`, `package.json`,   or `.kanban.json`), then reading `kanbanDirectory` from `.kanban.json`   (defaults to `'.kanban'`). |
| options | Optional configuration including an event handler callback   and storage engine selection. |

**Example**  
```ts
const sdk = new KanbanSDK('/path/to/project/.kanban')
await sdk.init()
const cards = await sdk.listCards()
```

* * *

<a name="KanbanSDK+eventBus"></a>

#### kanbanSDK.eventBus
The underlying SDK event bus for advanced event workflows.

Most consumers can use the convenience proxy methods on `KanbanSDK`
itself (`on`, `once`, `many`, `onAny`, `waitFor`, etc.). Access the
raw bus directly when you specifically need the shared `EventBus`
instance.

**Kind**: instance property of [<code>KanbanSDK</code>](#KanbanSDK)  

* * *

<a name="KanbanSDK+storageEngine"></a>

#### kanbanSDK.storageEngine
The active storage engine powering this SDK instance.
Returns the resolved `card.storage` provider implementation
(for example `markdown`, `sqlite`, or `mysql`).

**Kind**: instance property of [<code>KanbanSDK</code>](#KanbanSDK)  

* * *

<a name="KanbanSDK+capabilities"></a>

#### kanbanSDK.capabilities
The resolved storage/attachment capability bag for this SDK instance.
Returns `null` when a pre-built storage engine was injected directly.

**Kind**: instance property of [<code>KanbanSDK</code>](#KanbanSDK)  

* * *

<a name="KanbanSDK+_currentAuthContext"></a>

#### kanbanSDK.\_currentAuthContext
Returns the auth context installed by the nearest enclosing [runWithAuth](runWithAuth) call, if any. @internal

**Kind**: instance property of [<code>KanbanSDK</code>](#KanbanSDK)  

* * *

<a name="KanbanSDK+workspaceRoot"></a>

#### kanbanSDK.workspaceRoot ⇒
The workspace root directory (parent of the kanban directory).

This is the project root where `.kanban.json` configuration lives.

**Kind**: instance property of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: The absolute path to the workspace root directory.  
**Example**  
```ts
const sdk = new KanbanSDK('/home/user/my-project/.kanban')
console.log(sdk.workspaceRoot) // '/home/user/my-project'
```

* * *

<a name="KanbanSDK+on"></a>

#### kanbanSDK.on()
Subscribe to an SDK event or wildcard pattern.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  

* * *

<a name="KanbanSDK+once"></a>

#### kanbanSDK.once()
Subscribe to the next matching SDK event only once.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  

* * *

<a name="KanbanSDK+many"></a>

#### kanbanSDK.many()
Subscribe to an SDK event a fixed number of times.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  

* * *

<a name="KanbanSDK+onAny"></a>

#### kanbanSDK.onAny()
Subscribe to every SDK event regardless of name.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  

* * *

<a name="KanbanSDK+off"></a>

#### kanbanSDK.off()
Remove a specific event listener.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  

* * *

<a name="KanbanSDK+offAny"></a>

#### kanbanSDK.offAny()
Remove a specific catch-all listener.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  

* * *

<a name="KanbanSDK+removeAllListeners"></a>

#### kanbanSDK.removeAllListeners()
Remove all event listeners for one event, or all listeners when omitted.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  

* * *

<a name="KanbanSDK+eventNames"></a>

#### kanbanSDK.eventNames()
Return the registered event names currently tracked by the bus.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  

* * *

<a name="KanbanSDK+listenerCount"></a>

#### kanbanSDK.listenerCount()
Get the number of listeners for a specific event, or all listeners when omitted.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  

* * *

<a name="KanbanSDK+hasListeners"></a>

#### kanbanSDK.hasListeners()
Check whether any listeners are registered for an event or for the bus overall.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  

* * *

<a name="KanbanSDK+waitFor"></a>

#### kanbanSDK.waitFor()
Wait for the next matching SDK event and resolve with its payload.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  

* * *

<a name="KanbanSDK+getStorageStatus"></a>

#### kanbanSDK.getStorageStatus() ⇒
Returns storage/provider metadata for host surfaces and diagnostics.

Use this to inspect resolved provider ids, file-backed status, and
watcher behavior without reaching into capability internals.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A [StorageStatus](StorageStatus) snapshot containing the active provider id,
  resolved provider selections (when available), whether cards are backed by
  local files, and the watcher glob used by file-backed hosts.  
**Example**  
```ts
const status = sdk.getStorageStatus()
console.log(status.storageEngine) // 'markdown' | 'sqlite' | 'mysql' | ...
console.log(status.watchGlob) // e.g. markdown card glob for board/status directories
```

* * *

<a name="KanbanSDK+getAuthStatus"></a>

#### kanbanSDK.getAuthStatus() ⇒
Returns auth provider metadata for host surfaces and diagnostics.

Use this to inspect which identity and policy providers are active
and whether real auth enforcement is enabled.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: An [AuthStatus](AuthStatus) snapshot containing the active provider ids
  and boolean flags indicating whether non-noop providers are live.  
**Example**  
```ts
const status = sdk.getAuthStatus()
console.log(status.identityProvider) // 'noop' | 'my-token-plugin' | ...
console.log(status.identityEnabled)  // false when no plugin configured
```

* * *

<a name="KanbanSDK+resolveMobileBootstrap"></a>

#### kanbanSDK.resolveMobileBootstrap(input) ⇒
Resolves the minimal mobile bootstrap contract for a workspace entry attempt.

This SDK-owned seam keeps the supported v1 auth contract explicit without
introducing a duplicate username/password API. The result always stays scoped
to the existing `local` auth provider, preserves the browser cookie-login
assumption for standalone `/auth/login`, and advertises the approved opaque
bearer transport that the mobile app will store after the real login or token
redemption flow completes.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: The canonical workspace origin plus the next supported auth step.  
**Throws**:

- <code>Error</code> If `workspaceOrigin` is empty or not an absolute URL.


| Param | Description |
| --- | --- |
| input | Workspace bootstrap request from a typed origin, deep link, or QR entry. |

**Example**  
```ts
const bootstrap = await sdk.resolveMobileBootstrap({
  workspaceOrigin: 'https://field.example.com/app/',
  bootstrapToken: 'one-time-link-token'
})

console.log(bootstrap.workspaceOrigin) // 'https://field.example.com'
console.log(bootstrap.nextStep) // 'redeem-bootstrap-token'
```

* * *

<a name="KanbanSDK+inspectMobileSession"></a>

#### kanbanSDK.inspectMobileSession(input) ⇒
Builds the safe mobile session-status payload returned after restore validation.

Host layers should call this only after validating the opaque mobile session
credential against the server-owned session store. The returned shape is safe
for no-stale-flash restore gates because it includes only workspace/subject
namespace metadata and the fixed transport contract — never the raw token,
password, or browser cookie material.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A normalized session-status payload suitable for cold-start/resume checks.  
**Throws**:

- <code>Error</code> If `workspaceOrigin` or `subject` is empty, or if `workspaceOrigin` is not an absolute URL.


| Param | Description |
| --- | --- |
| input | Validated mobile session metadata to surface back to the app. |

**Example**  
```ts
const status = await sdk.inspectMobileSession({
  workspaceOrigin: 'https://field.example.com/mobile',
  subject: 'worker-7',
  roles: ['technician', 'reviewer']
})

console.log(status.authentication.mobileSessionTransport) // 'opaque-bearer'
console.log(status.roles) // ['technician', 'reviewer']
```

* * *

<a name="KanbanSDK+getWebhookStatus"></a>

#### kanbanSDK.getWebhookStatus() ⇒
Returns webhook provider metadata for host surfaces and diagnostics.

Use this to inspect which webhook delivery provider is active and whether
`kl-plugin-webhook` is installed.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A [WebhookStatus](WebhookStatus) snapshot containing the active provider id
  and a boolean flag indicating whether a provider is active.  
**Example**  
```ts
const status = sdk.getWebhookStatus()
console.log(status.webhookProvider)      // 'none' | 'webhooks' | ...
console.log(status.webhookProviderActive) // false when kl-plugin-webhook not installed
```

* * *

<a name="KanbanSDK+listAvailableEvents"></a>

#### kanbanSDK.listAvailableEvents(options) ⇒
Returns the discoverable SDK event catalog for this runtime.

The returned list includes built-in core before/after events plus any
plugin-declared events exported through active `sdkExtensionPlugin.events`
bags. `mask` uses the same dotted wildcard semantics as the SDK event bus:
`*` matches one segment and `**` matches zero or more segments.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A stable, sorted list of discoverable event descriptors.  

| Param | Description |
| --- | --- |
| options | Optional phase/type and wildcard-mask filters. |


* * *

<a name="KanbanSDK+listPluginSettings"></a>

#### kanbanSDK.listPluginSettings() ⇒
Lists the capability-grouped plugin provider inventory for the workspace.

Discovery reuses the canonical runtime loader order so the returned rows
reflect providers that the SDK can actually resolve at runtime. Selected
state is derived from `.kanban.json`, and the payload carries the shared
plugin-settings redaction policy for downstream UI/API/CLI/MCP reuse.
Requires the `plugin-settings.read` auth action before any inventory is materialized.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A capability-grouped plugin settings inventory payload.  

* * *

<a name="KanbanSDK+getPluginSettings"></a>

#### kanbanSDK.getPluginSettings(capability, providerId) ⇒
Returns the redacted plugin settings read model for one provider.

The read model includes the provider's discovery source, current selected
state for the capability, any discovered options schema metadata, and a
redacted snapshot of persisted options when this provider is selected.
Requires the `plugin-settings.read` auth action before any provider payload is materialized.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: The redacted provider read model, or `null` when the provider is not discovered.  

| Param | Description |
| --- | --- |
| capability | The capability namespace to inspect. |
| providerId | Provider identifier within that capability. |


* * *

<a name="KanbanSDK+selectPluginSettingsProvider"></a>

#### kanbanSDK.selectPluginSettingsProvider(capability, providerId) ⇒
Persists the canonical selected provider for one capability inside `.kanban.json`.

Selection is modeled only by the provider ref stored under `plugins[capability]`.
Re-selecting the same provider preserves any existing persisted options while
switching to a different provider replaces the previous single-provider entry.
Selecting `none` for `webhook.delivery` disables webhook runtime loading while
preserving any stored webhook options for later re-enable.
Requires the `plugin-settings.update` auth action before any persistence or
provider readback occurs.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: The redacted provider read model after persistence succeeds, or `null`
  when the capability was explicitly disabled.  

| Param | Description |
| --- | --- |
| capability | Capability namespace to update. |
| providerId | Provider identifier to select. |


* * *

<a name="KanbanSDK+updatePluginSettingsOptions"></a>

#### kanbanSDK.updatePluginSettingsOptions(capability, providerId, options) ⇒
Persists provider options under the canonical capability-selection model.

Secret fields remain write-only: callers may submit the shared masked value
placeholder to keep an existing stored secret unchanged, while any non-masked
replacement overwrites that secret. When the target provider is already
selected, the canonical `plugins[capability]` entry is updated in place.
When the provider is currently inactive, the options are cached under the
shared plugin-options store so hosts can save and reopen schema-driven forms
without changing enablement; selecting that provider later restores the
cached options into `plugins[capability]`.
Requires the `plugin-settings.update` auth action before any persistence or
provider readback occurs.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: The redacted provider read model after persistence succeeds.  

| Param | Description |
| --- | --- |
| capability | Capability namespace to update. |
| providerId | Provider identifier whose options are being updated. |
| options | Provider options payload to persist. |


* * *

<a name="KanbanSDK+installPluginSettingsPackage"></a>

#### kanbanSDK.installPluginSettingsPackage(input) ⇒
Installs a supported external plugin package through guarded `npm install` execution.

The SDK validates the request before launching a subprocess, accepts only exact
unscoped `kl-*` package names, always disables lifecycle scripts for in-product
installs, and redacts stdout/stderr before surfacing either the success payload
or a structured failure payload.
Requires the `plugin-settings.update` auth action before validation or install
subprocess work begins.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: Structured redacted success payload describing the executed npm command.  
**Throws**:

- [<code>PluginSettingsOperationError</code>](#PluginSettingsOperationError) When validation fails or npm exits unsuccessfully.


| Param | Description |
| --- | --- |
| input | Candidate package name and install scope to validate and install. |


* * *

<a name="KanbanSDK+getCardStateStatus"></a>

#### kanbanSDK.getCardStateStatus()
Returns card-state provider metadata for host surfaces and diagnostics.

The status includes the stable auth-absent default actor contract and lets
callers distinguish configured-identity failures from true backend
unavailability via `availability` / `errorCode`.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  

* * *

<a name="KanbanSDK+getExtension"></a>

#### kanbanSDK.getExtension(id) ⇒
Returns the SDK extension bag contributed by the plugin with the given `id`,
or `undefined` when no active plugin has exported a matching `sdkExtensionPlugin`.

Use this to access plugin-owned SDK capabilities (e.g. webhook CRUD methods
contributed by `kl-plugin-webhook`) without importing plugin packages directly.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: The resolved extension bag cast to `T`, or `undefined` when the plugin
  is not active or has not exported `sdkExtensionPlugin`.  
**Typeparam**: T - Shape of the expected extension bag.  

| Param | Description |
| --- | --- |
| id | The plugin manifest id to look up (e.g. `'kl-plugin-webhook'`). |

**Example**  
```ts
const webhookExt = sdk.getExtension<{ listWebhooks(): Webhook[] }>('kl-plugin-webhook')
const webhooks = webhookExt?.listWebhooks() ?? []
```

* * *

<a name="KanbanSDK+_requireCardStateCapabilities"></a>

#### kanbanSDK.\_requireCardStateCapabilities()
**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Internal**:   

* * *

<a name="KanbanSDK+_resolveCardStateTarget"></a>

#### kanbanSDK.\_resolveCardStateTarget()
**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Internal**:   

* * *

<a name="KanbanSDK+_resolveCardStateTargetDirect"></a>

#### kanbanSDK.\_resolveCardStateTargetDirect()
Derives a card-state target directly from a pre-loaded Card without a listCards round-trip.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Internal**:   

* * *

<a name="KanbanSDK+_resolveCardStateActorId"></a>

#### kanbanSDK.\_resolveCardStateActorId()
**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Internal**:   

* * *

<a name="KanbanSDK+_getLatestUnreadActivityCursor"></a>

#### kanbanSDK.\_getLatestUnreadActivityCursor()
**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Internal**:   

* * *

<a name="KanbanSDK+_createUnreadSummary"></a>

#### kanbanSDK.\_createUnreadSummary()
**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Internal**:   

* * *

<a name="KanbanSDK+getCardState"></a>

#### kanbanSDK.getCardState()
Reads persisted card-state for the current actor without producing any side effects.

When `domain` is omitted, the unread cursor domain is returned.
This method reads actor-scoped `card.state` only and does not reflect or
modify active-card UI state.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  

* * *

<a name="KanbanSDK+getCardStateReadModelForCard"></a>

#### kanbanSDK.getCardStateReadModelForCard(card, fallbackBoardId) ⇒
Batch-efficient read model for a pre-loaded card used during board init and broadcast.

Unlike calling [getUnreadSummary](getUnreadSummary) and [getCardState](getCardState) separately, this method:
- Resolves the actor identity exactly once.
- Derives the board/card target from the supplied Card without an extra listCards round-trip.
- Runs log, unread-cursor, and open-state I/O concurrently.

Use this when the caller already holds the full Card object (e.g. inside
`decorateCardsForWebview`) to avoid the N² file-scan that the individual
methods incur when called in a loop over all cards.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: Unread summary and open-domain card-state record for the current actor.  

| Param | Description |
| --- | --- |
| card | The pre-loaded Card object. |
| fallbackBoardId | Board ID to use when `card.boardId` is not set. |


* * *

<a name="KanbanSDK+getUnreadSummary"></a>

#### kanbanSDK.getUnreadSummary()
Derives unread state for the current actor from persisted activity logs without mutating card state.

Unread derivation is SDK-owned for both the built-in file-backed backend and
first-party compatibility backends such as `sqlite`.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  

* * *

<a name="KanbanSDK+markCardOpened"></a>

#### kanbanSDK.markCardOpened()
Persists an explicit open-card mutation for the current actor.

Opening a card records the `open` domain and acknowledges the latest unread
activity cursor for that actor without depending on `setActiveCard`.
This does not change workspace active-card UI state.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  

* * *

<a name="KanbanSDK+markCardRead"></a>

#### kanbanSDK.markCardRead()
Persists an explicit read-through cursor for the current actor.

Reads are side-effect free; call this method when you want to acknowledge
unread activity explicitly. Configured-identity failures surface as
`ERR_CARD_STATE_IDENTITY_UNAVAILABLE` rather than backend unavailability.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  

* * *

<a name="KanbanSDK+_authorizeAction"></a>

#### kanbanSDK.\_authorizeAction(action, context) ⇒
Resolves caller identity and evaluates whether the named action is permitted.

This is the internal SDK pre-action authorization seam. SDK methods that
represent mutating or privileged operations should call this before
executing their logic.

When no auth plugins are configured the built-in noop path allows all
actions anonymously, preserving the current open-access behavior
for workspaces without an auth configuration.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: Fulfilled [AuthDecision](AuthDecision) when the action is permitted.  
**Throws**:

- <code>AuthError</code> When the policy plugin denies the action.

**Internal**:   

| Param | Description |
| --- | --- |
| action | Canonical action name (e.g. `'card.create'`, `'board.delete'`). |
| context | Optional auth context from the inbound request. |


* * *

<a name="KanbanSDK+canPerformAction"></a>

#### kanbanSDK.canPerformAction(action, context) ⇒
Resolves caller identity and returns whether the named action is permitted.

Unlike [_authorizeAction](_authorizeAction), this helper never emits auth lifecycle
events and never throws for a normal policy denial. It is intended for
side-effect-free host/UI capability checks such as deciding whether to
expose checklist affordances for the current caller.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: `true` when the action is permitted for the resolved caller.  

| Param | Description |
| --- | --- |
| action | Canonical action name (e.g. `'card.checklist.show'`). |
| context | Optional auth context from the inbound request. |


* * *

<a name="KanbanSDK+runWithAuth"></a>

#### kanbanSDK.runWithAuth(auth, fn) ⇒
Runs `fn` within an async scope where `auth` is the active auth context.

Use this on host surfaces (REST routes, CLI commands, MCP handlers) to
bind a request-scoped [AuthContext](AuthContext) before calling SDK mutators.
The context is propagated automatically through every `await` in the call
tree without being threaded through method signatures.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: The promise returned by `fn`.  

| Param | Description |
| --- | --- |
| auth | Request-scoped auth context to install for the duration of `fn`. |
| fn | Async callback to execute with the auth context active. |

**Example**  
```ts
const card = await sdk.runWithAuth({ token: req.headers.authorization }, () =>
  sdk.createCard({ boardId: 'default', title: 'New task' })
)
```

* * *

<a name="KanbanSDK+_resolveEventActor"></a>

#### kanbanSDK.\_resolveEventActor()
**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Internal**:   

* * *

<a name="KanbanSDK+_runBeforeEvent"></a>

#### kanbanSDK.\_runBeforeEvent(event, input, actor, boardId) ⇒
Dispatches a before-event to all registered listeners and returns a
deep-merged clone of the input.

Clones `input` immediately with `structuredClone` so the caller's object
is never mutated. Awaits all registered before-event listeners in
registration order via [EventBus.emitAsync](EventBus.emitAsync). Each plain-object
listener response is deep-merged in registration order over the clone so
that later-registered listeners override earlier ones at every nesting
depth. Arrays in listener responses **replace** (no concatenation).
Non-plain-object, `void`, or empty `{}` responses contribute no keys and
the accumulated input stays effectively unchanged.

**Throwing aborts the mutation:** any error thrown by a listener —
including [AuthError](AuthError) — propagates immediately to the caller.
No subsequent listeners execute and no mutation write occurs.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: Promise resolving to the deep-merged input clone after all listeners settle.  
**Internal**:   

| Param | Description |
| --- | --- |
| event | Before-event name (e.g. `'card.create'`). |
| input | Initial mutation input used as the clone/merge base. |
| actor | Resolved acting principal, if known. |
| boardId | Board context for this action, if applicable. |


* * *

<a name="KanbanSDK+_runAfterEvent"></a>

#### kanbanSDK.\_runAfterEvent(event, data, actor, boardId, meta)
Emits an after-event exactly once after a mutation has been committed.

Wraps `data` in an [AfterEventPayload](AfterEventPayload) envelope and emits it on the event
bus as an [SDKEvent](SDKEvent). After-event listeners are non-blocking: the event bus
isolates errors per listener so a failing listener never prevents sibling listeners
from executing and never propagates to the SDK caller.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Internal**:   

| Param | Description |
| --- | --- |
| event | After-event name (e.g. `'task.created'`). |
| data | The committed mutation result. |
| actor | Resolved acting principal, if known. |
| boardId | Board context for this event, if applicable. |
| meta | Optional audit metadata. |


* * *

<a name="KanbanSDK+getLocalCardPath"></a>

#### kanbanSDK.getLocalCardPath(card) ⇒
Returns the local file path for a card when the active provider exposes one.

This is most useful for editor integrations or diagnostics that need to open
or reveal the underlying source file. Providers that do not expose stable
local card files return `null`.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: The absolute on-disk card path, or `null` when the active provider
  does not expose one.  

| Param | Description |
| --- | --- |
| card | The resolved card object. |

**Example**  
```ts
const card = await sdk.getCard('42')
if (card) {
  console.log(sdk.getLocalCardPath(card))
}
```

* * *

<a name="KanbanSDK+getAttachmentStoragePath"></a>

#### kanbanSDK.getAttachmentStoragePath(card) ⇒
Returns the local attachment directory for a card when the active
attachment provider exposes one.

File-backed providers typically return an absolute directory under the
workspace, while database-backed or remote attachment providers may return
`null` when attachments are not directly browseable on disk.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: The absolute attachment directory, or `null` when the active
  attachment provider cannot expose one.  

| Param | Description |
| --- | --- |
| card | The resolved card object. |


* * *

<a name="KanbanSDK+appendAttachment"></a>

#### kanbanSDK.appendAttachment()
Requests an efficient in-place append for an attachment when the active
attachment provider supports it.

Returns `true` when the provider handled the append directly and `false`
when callers should fall back to rewriting the attachment through the
normal copy/materialization path.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  

* * *

<a name="KanbanSDK+materializeAttachment"></a>

#### kanbanSDK.materializeAttachment(card, attachment) ⇒
Resolves or materializes a safe local file path for a named attachment.

For simple file-backed providers this usually returns the existing file.
Other providers may need to materialize a temporary local copy first.
The method also guards against invalid attachment names and only resolves
files already attached to the card.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: An absolute local path, or `null` when the attachment cannot be
  safely exposed by the current provider.  

| Param | Description |
| --- | --- |
| card | The resolved card object. |
| attachment | Attachment filename exactly as stored on the card. |

**Example**  
```ts
const card = await sdk.getCard('42')
const pdfPath = card ? await sdk.materializeAttachment(card, 'report.pdf') : null
```

* * *

<a name="KanbanSDK+copyAttachment"></a>

#### kanbanSDK.copyAttachment(sourcePath, card)
Copies an attachment through the resolved attachment-storage capability.

This is a low-level helper used by higher-level attachment flows. It writes
the supplied source file into the active attachment provider for the given
card, whether that provider is local filesystem storage or a custom plugin.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  

| Param | Description |
| --- | --- |
| sourcePath | Absolute or relative path to the source file to copy. |
| card | The target card that should own the copied attachment. |


* * *

<a name="KanbanSDK+close"></a>

#### kanbanSDK.close()
Closes the storage engine and releases any held resources (e.g. database
connections). Call this when the SDK instance is no longer needed.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  

* * *

<a name="KanbanSDK+destroy"></a>

#### kanbanSDK.destroy()
Tear down the SDK, destroying the event bus and all listeners.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  

* * *

<a name="KanbanSDK+emitEvent"></a>

#### kanbanSDK.emitEvent()
**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Internal**:   

* * *

<a name="KanbanSDK+getConfigSnapshot"></a>

#### kanbanSDK.getConfigSnapshot() ⇒
Returns a cloned read-only snapshot of the current workspace config.

The returned snapshot is created from a fresh config read and deep-cloned
before being returned, so callers receive an isolated view of the current
`.kanban.json` state rather than a live mutable runtime object. Mutating the
returned snapshot does not update persisted config or affect this SDK instance.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A cloned read-only snapshot of the current [KanbanConfig](KanbanConfig).  
**Example**  
```ts
const config = sdk.getConfigSnapshot()
console.log(config.defaultBoard)
```

* * *

<a name="KanbanSDK+_resolveBoardId"></a>

#### kanbanSDK.\_resolveBoardId()
**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Internal**:   

* * *

<a name="KanbanSDK+_boardDir"></a>

#### kanbanSDK.\_boardDir()
**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Internal**:   

* * *

<a name="KanbanSDK+_isCompletedStatus"></a>

#### kanbanSDK.\_isCompletedStatus()
**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Internal**:   

* * *

<a name="KanbanSDK+_ensureMigrated"></a>

#### kanbanSDK.\_ensureMigrated()
**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Internal**:   

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
  `id`, `name`, optional `description`, and display-title metadata config.  
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
**Returns**: The [BoardConfig](BoardConfig) object containing columns, settings, metadata, and display-title metadata config.  
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
| updates.title | Ordered metadata keys whose values should prefix rendered card titles. |

**Example**  
```ts
const updated = sdk.updateBoard('bugs', {
  name: 'Bug Tracker v2',
  defaultPriority: 'high'
})
```

* * *

<a name="KanbanSDK+getBoardActions"></a>

#### kanbanSDK.getBoardActions(boardId) ⇒
Returns the named actions defined on a board.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A map of action key to display title.  
**Throws**:

- <code>Error</code> If the board does not exist.


| Param | Description |
| --- | --- |
| boardId | Board ID. Defaults to the active board when omitted. |

**Example**  
```ts
const actions = sdk.getBoardActions('deployments')
console.log(actions.deploy) // 'Deploy now'
```

* * *

<a name="KanbanSDK+addBoardAction"></a>

#### kanbanSDK.addBoardAction(boardId, key, title) ⇒
Adds or updates a named action on a board.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: The updated actions map.  
**Throws**:

- <code>Error</code> If the board does not exist.


| Param | Description |
| --- | --- |
| boardId | Board ID. |
| key | Unique action key (used as identifier). |
| title | Human-readable display title for the action. |

**Example**  
```ts
sdk.addBoardAction('deployments', 'deploy', 'Deploy now')
```

* * *

<a name="KanbanSDK+removeBoardAction"></a>

#### kanbanSDK.removeBoardAction(boardId, key) ⇒
Removes a named action from a board.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: The updated actions map.  
**Throws**:

- <code>Error</code> If the board does not exist.
- <code>Error</code> If the action key is not found on the board.


| Param | Description |
| --- | --- |
| boardId | Board ID. |
| key | The action key to remove. |

**Example**  
```ts
sdk.removeBoardAction('deployments', 'deploy')
```

* * *

<a name="KanbanSDK+triggerBoardAction"></a>

#### kanbanSDK.triggerBoardAction(boardId, actionKey)
Fires the `board.action` webhook event for a named board action.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Throws**:

- <code>Error</code> If the board does not exist.
- <code>Error</code> If the action key is not defined on the board.


| Param | Description |
| --- | --- |
| boardId | The board that owns the action. |
| actionKey | The key of the action to trigger. |

**Example**  
```ts
await sdk.triggerBoardAction('deployments', 'deploy')
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
**Returns**: A promise resolving to the updated [Card](Card) card object.  
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

<a name="KanbanSDK+_listCardsRaw"></a>

#### kanbanSDK.\_listCardsRaw()
**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Internal**:   

* * *

<a name="KanbanSDK+getCard"></a>

#### kanbanSDK.getCard(cardId, boardId) ⇒
Retrieves a single card by its ID.

Supports partial ID matching -- the provided `cardId` is matched against
all cards on the board.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A promise resolving to the matching [Card](Card) card, or `null` if not found.  

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

<a name="KanbanSDK+_getCardRaw"></a>

#### kanbanSDK.\_getCardRaw()
**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Internal**:   

* * *

<a name="KanbanSDK+getActiveCard"></a>

#### kanbanSDK.getActiveCard(boardId) ⇒
Retrieves the card currently marked as active/open in this workspace.

Active-card state is persisted in the workspace so other interfaces
(standalone server, CLI, MCP, and VS Code) can query the same card.
Returns `null` when no card is currently active.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A promise resolving to the active [Card](Card), or `null`.  

| Param | Description |
| --- | --- |
| boardId | Optional board ID. When provided, returns the active card   only if it belongs to that board. |

**Example**  
```ts
const active = await sdk.getActiveCard()
if (active) {
  console.log(active.id)
}
```

* * *

<a name="KanbanSDK+setActiveCard"></a>

#### kanbanSDK.setActiveCard()
**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Internal**:   

* * *

<a name="KanbanSDK+clearActiveCard"></a>

#### kanbanSDK.clearActiveCard()
**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Internal**:   

* * *

<a name="KanbanSDK+createCard"></a>

#### kanbanSDK.createCard(data) ⇒
Creates a new card on a board.

The card is assigned an auto-incrementing numeric ID, placed at the end
of its target status column using fractional indexing, and persisted as a
markdown file with YAML frontmatter. If no status or priority is provided,
the board's defaults are used.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A promise resolving to the newly created [Card](Card) card.  

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
| data.actions | Optional per-card actions as action keys or key-to-title map. |
| data.forms | Optional attached forms, using workspace-form references or inline definitions. |
| data.formData | Optional per-form persisted values keyed by resolved form ID. |
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

Common update fields include `content`, `status`, `priority`, `assignee`,
`dueDate`, `labels`, `metadata`, `actions`, `forms`, and `formData`.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A promise resolving to the updated [Card](Card) card.  
**Throws**:

- <code>Error</code> If the card is not found.


| Param | Description |
| --- | --- |
| cardId | The ID of the card to update. |
| updates | A partial [Card](Card) object with the fields to update. |
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

<a name="KanbanSDK+addChecklistItem"></a>

#### kanbanSDK.addChecklistItem()
Adds a new checklist item to a card using checklist-wide optimistic concurrency.

Callers must provide the latest checklist `token` from the shared checklist read
model. This prevents concurrent append operations from silently overwriting one
another when two callers read the same checklist snapshot.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  

* * *

<a name="KanbanSDK+editChecklistItem"></a>

#### kanbanSDK.editChecklistItem()
Edits an existing checklist item's text while preserving its checked state.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  

* * *

<a name="KanbanSDK+deleteChecklistItem"></a>

#### kanbanSDK.deleteChecklistItem()
Deletes a checklist item using stale-write protection via `expectedRaw`.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  

* * *

<a name="KanbanSDK+checkChecklistItem"></a>

#### kanbanSDK.checkChecklistItem()
Marks a checklist item complete using stale-write protection via `expectedRaw`.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  

* * *

<a name="KanbanSDK+uncheckChecklistItem"></a>

#### kanbanSDK.uncheckChecklistItem()
Marks a checklist item incomplete using stale-write protection via `expectedRaw`.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  

* * *

<a name="KanbanSDK+submitForm"></a>

#### kanbanSDK.submitForm(input) ⇒
Validates and persists a form submission for a card, then emits `form.submit`
through the normal SDK event/webhook pipeline.

The target form must already be attached to the card, either as an inline
card-local form or as a named reusable workspace form reference.

**Partial-at-rest semantics:** `card.formData[formId]` may be a partial
record at rest (containing only previously submitted or pre-seeded fields).
The merge below always produces a full canonical object, and that full
object is what gets persisted and returned as `result.data`.

Merge order for the resolved base payload (lowest → highest priority):
1. Workspace-config form defaults (`KanbanConfig.forms[formName].data`)
2. Card-scoped attachment defaults (`attachment.data`)
3. Persisted per-card form data (`card.formData[formId]`, may be partial)
4. Card metadata fields that are declared in the form schema
5. The submitted payload passed to this method

Before the merge, string values in each source layer are prepared via
`prepareFormData()` (from `src/shared/formDataPreparation`), which resolves
`${path}` placeholders against the full card interpolation context.

Validation happens authoritatively in the SDK before persistence and before
any event/webhook emission, so CLI/API/MCP/UI callers all share the same rules.
After a successful submit, the SDK also appends a system card log entry that
records the submitted payload under `payload` for audit/debug visibility.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: The canonical persisted payload and event context. `result.data` is
  always the full merged and validated object (never a partial snapshot).  
**Throws**:

- <code>Error</code> If the card or form cannot be found, or if validation fails.


| Param | Description |
| --- | --- |
| input | The form submission input. |
| input.cardId | ID of the card that owns the target form. |
| input.formId | Resolved form ID/name to submit. |
| input.data | Submitted field values to merge over the resolved base payload. |
| input.boardId | Optional board ID. Defaults to the workspace default board. |

**Example**  
```ts
const result = await sdk.submitForm({
  cardId: '42',
  formId: 'bug-report',
  data: { severity: 'high', title: 'Crash on save' }
})
console.log(result.data.severity) // 'high'
```

* * *

<a name="KanbanSDK+triggerAction"></a>

#### kanbanSDK.triggerAction(cardId, action, boardId) ⇒
Triggers a named action for a card.

Validates the card, appends an activity log entry, and emits the
`card.action.triggered` after-event so registered webhooks receive
the action payload automatically.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A promise that resolves when the action has been processed.  
**Throws**:

- <code>Error</code> If the card is not found.


| Param | Description |
| --- | --- |
| cardId | The ID of the card to trigger the action for. |
| action | The action name string (e.g. `'retry'`, `'sendEmail'`). |
| boardId | Optional board ID. Defaults to the workspace's default board. |

**Example**  
```ts
await sdk.triggerAction('42', 'retry')
await sdk.triggerAction('42', 'sendEmail', 'bugs')
```

* * *

<a name="KanbanSDK+moveCard"></a>

#### kanbanSDK.moveCard(cardId, newStatus, position, boardId) ⇒
Moves a card to a different status column and/or position within that column.

The card's fractional order key is recalculated based on the target
position. If the status changes, the underlying file is moved to the
corresponding subdirectory and `completedAt` is updated accordingly.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A promise resolving to the updated [Card](Card) card.  
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
**Returns**: A promise resolving to an array of [Card](Card) cards in the given status.  

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
Reserved checklist-derived labels such as `tasks` and `in-progress` are filtered
out so dirty legacy config cannot leak them back through host surfaces.

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
Reserved checklist-derived labels such as `tasks` and `in-progress` cannot be
defined manually.

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
Removes a label definition from the workspace configuration and cascades
the deletion to all cards by removing the label from their `labels` array.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  

| Param | Description |
| --- | --- |
| name | The label name to remove. |

**Example**  
```ts
await sdk.deleteLabel('bug')
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
**Returns**: A promise resolving to an array of matching [Card](Card) cards.  

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
**Returns**: A promise resolving to the updated [Card](Card) card.  
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
**Returns**: A promise resolving to the updated [Card](Card) card.  
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

<a name="KanbanSDK+getAttachmentDir"></a>

#### kanbanSDK.getAttachmentDir(cardId, boardId) ⇒
Returns the absolute path to the attachment directory for a card.

For the default markdown/localfs path this is typically
`{column_dir}/attachments/`. Other providers may return a different local
directory or `null` when attachments are not directly browseable on disk.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A promise resolving to the absolute directory path, or `null` if the card is not found.  

| Param | Description |
| --- | --- |
| cardId | The ID of the card. |
| boardId | Optional board ID. Defaults to the workspace's default board. |

**Example**  
```ts
const dir = await sdk.getAttachmentDir('42')
// '/workspace/.kanban/boards/default/backlog/attachments'
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
**Returns**: A promise resolving to the updated [Card](Card) card (including the new comment).  
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
**Returns**: A promise resolving to the updated [Card](Card) card.  
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
**Returns**: A promise resolving to the updated [Card](Card) card.  
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

<a name="KanbanSDK+streamComment"></a>

#### kanbanSDK.streamComment(cardId, author, stream) ⇒
Creates a comment on a card from a streaming text source, persisting it
once the stream is exhausted.

This method is the streaming counterpart to [addComment](addComment). It is
intended for use by AI agents that generate comment text incrementally
(e.g. an LLM `textStream`). The caller may supply `onStart` and `onChunk`
callbacks to fan live progress out to connected WebSocket viewers without
requiring intermediate disk writes.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A promise resolving to the updated [Card](Card) once the stream
  has been fully consumed and the comment has been persisted.  
**Throws**:

- <code>Error</code> If the card is not found.
- <code>Error</code> If `author` is empty.


| Param | Description |
| --- | --- |
| cardId | The ID of the card to comment on. |
| author | Display name of the streaming author. |
| stream | An `AsyncIterable<string>` that yields text chunks. |
| options.boardId | Optional board ID override. |
| options.onStart | Called once before iteration with the allocated   comment ID, author, and ISO timestamp. |
| options.onChunk | Called after each chunk with the comment ID and   the raw chunk string. |

**Example**  
```ts
// Stream an AI SDK textStream as a comment
const { textStream } = await streamText({ model, prompt })
const card = await sdk.streamComment('42', 'ai-agent', textStream, {
  onStart: (id, author, created) => broadcast({ type: 'commentStreamStart', cardId: '42', commentId: id, author, created }),
  onChunk: (id, chunk) => broadcast({ type: 'commentChunk', cardId: '42', commentId: id, chunk }),
})
```

* * *

<a name="KanbanSDK+getLogFilePath"></a>

#### kanbanSDK.getLogFilePath(cardId, boardId) ⇒
Returns the absolute path to the log file for a card.

The log file is stored as the card attachment `<cardId>.log` through the
active `attachment.storage` provider. File-backed providers usually return
a stable workspace path, while remote providers may return a materialized
temporary local file path instead.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A promise resolving to the log file path, or `null` if the card is not found.  

| Param | Description |
| --- | --- |
| cardId | The ID of the card. |
| boardId | Optional board ID. Defaults to the workspace's default board. |


* * *

<a name="KanbanSDK+listLogs"></a>

#### kanbanSDK.listLogs(cardId, boardId) ⇒
Lists all log entries for a card.

Reads the card's `.log` file and parses each line into a [LogEntry](LogEntry).
Returns an empty array if no log file exists.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A promise resolving to an array of [LogEntry](LogEntry) objects.  
**Throws**:

- <code>Error</code> If the card is not found.


| Param | Description |
| --- | --- |
| cardId | The ID of the card whose logs to list. |
| boardId | Optional board ID. Defaults to the workspace's default board. |

**Example**  
```ts
const logs = await sdk.listLogs('42')
for (const entry of logs) {
  console.log(`[${entry.source}] ${entry.text}`)
}
```

* * *

<a name="KanbanSDK+addLog"></a>

#### kanbanSDK.addLog(cardId, text, options, boardId) ⇒
Adds a log entry to a card.

Appends a new line to the card's `.log` attachment via the active
attachment-storage capability. Providers may handle this with a native
append hook when available, otherwise the SDK falls back to a safe
read/modify/write cycle. If the file does not exist, it is created and
automatically added to the card's attachments array.
The timestamp defaults to the current time if not provided.
The source defaults to `'default'` if not provided.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A promise resolving to the created [LogEntry](LogEntry).  
**Throws**:

- <code>Error</code> If the card is not found.


| Param | Description |
| --- | --- |
| cardId | The ID of the card to add the log to. |
| text | The log message text. Supports inline markdown. |
| options | Optional log entry parameters. |
| options.source | Source/origin label. Defaults to `'default'`. |
| options.timestamp | ISO 8601 timestamp. Defaults to current time. |
| options.object | Optional structured data to attach as JSON. |
| boardId | Optional board ID. Defaults to the workspace's default board. |

**Example**  
```ts
const entry = await sdk.addLog('42', 'Build started')
const entry2 = await sdk.addLog('42', 'Deploy complete', {
  source: 'ci',
  object: { version: '1.2.3', duration: 42 }
})
```

* * *

<a name="KanbanSDK+clearLogs"></a>

#### kanbanSDK.clearLogs(cardId, boardId) ⇒
Clears all log entries for a card by deleting the `.log` file.

The log attachment reference is removed from the card's attachments array.
When a local/materialized file exists, it is deleted best-effort as well.
New log entries recreate the log attachment automatically.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A promise that resolves when the logs have been cleared.  
**Throws**:

- <code>Error</code> If the card is not found.


| Param | Description |
| --- | --- |
| cardId | The ID of the card whose logs to clear. |
| boardId | Optional board ID. Defaults to the workspace's default board. |

**Example**  
```ts
await sdk.clearLogs('42')
```

* * *

<a name="KanbanSDK+getBoardLogFilePath"></a>

#### kanbanSDK.getBoardLogFilePath(boardId) ⇒
Returns the absolute path to the board-level log file for a given board.

The board log file is located at `.kanban/boards/<boardId>/board.log`,
at the same level as the column folders.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: The absolute path to `board.log` for the specified board.  

| Param | Description |
| --- | --- |
| boardId | Optional board ID. Defaults to the workspace's default board. |

**Example**  
```ts
const logPath = sdk.getBoardLogFilePath()
// '/workspace/.kanban/boards/default/board.log'
```

* * *

<a name="KanbanSDK+listBoardLogs"></a>

#### kanbanSDK.listBoardLogs(boardId) ⇒
Lists all log entries from the board-level log file.

Returns an empty array if the log file does not exist yet.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A promise that resolves to an array of [LogEntry](LogEntry) objects, oldest first.  

| Param | Description |
| --- | --- |
| boardId | Optional board ID. Defaults to the workspace's default board. |

**Example**  
```ts
const logs = await sdk.listBoardLogs()
// [{ timestamp: '2024-01-01T00:00:00.000Z', source: 'api', text: 'Card created' }]
```

* * *

<a name="KanbanSDK+addBoardLog"></a>

#### kanbanSDK.addBoardLog(text, options, boardId) ⇒
Appends a new log entry to the board-level log file.

Creates the log file if it does not yet exist.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A promise that resolves to the created [LogEntry](LogEntry).  

| Param | Description |
| --- | --- |
| text | The human-readable log message. |
| options | Optional entry metadata: source label, ISO timestamp override, and structured object. |
| boardId | Optional board ID. Defaults to the workspace's default board. |

**Example**  
```ts
const entry = await sdk.addBoardLog('Board archived', { source: 'cli' })
```

* * *

<a name="KanbanSDK+clearBoardLogs"></a>

#### kanbanSDK.clearBoardLogs(boardId) ⇒
Clears all log entries for a board by deleting the board-level `board.log` file.

New log entries will recreate the file automatically.
No error is thrown if the file does not exist.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A promise that resolves when the logs have been cleared.  

| Param | Description |
| --- | --- |
| boardId | Optional board ID. Defaults to the workspace's default board. |

**Example**  
```ts
await sdk.clearBoardLogs()
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

<a name="KanbanSDK+cleanupColumn"></a>

#### kanbanSDK.cleanupColumn(columnId, boardId) ⇒
Moves all cards in the specified column to the `deleted` (soft-delete) column.

This is a non-destructive operation — cards are moved to the reserved
`deleted` status and can be restored or permanently deleted later.
The column itself is not removed.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A promise resolving to the number of cards that were moved.  
**Throws**:

- <code>Error</code> If the column is `'deleted'` (no-op protection).


| Param | Description |
| --- | --- |
| columnId | The ID of the column whose cards should be moved to `deleted`. |
| boardId | Optional board ID. Defaults to the workspace's default board. |

**Example**  
```ts
const moved = await sdk.cleanupColumn('blocked')
console.log(`Moved ${moved} cards to deleted`)
```

* * *

<a name="KanbanSDK+purgeDeletedCards"></a>

#### kanbanSDK.purgeDeletedCards(boardId) ⇒
Permanently deletes all cards currently in the `deleted` column.

This is equivalent to "empty trash". All soft-deleted cards are
removed from disk. This operation cannot be undone.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: A promise resolving to the number of cards that were permanently deleted.  

| Param | Description |
| --- | --- |
| boardId | Optional board ID. Defaults to the workspace's default board. |

**Example**  
```ts
const count = await sdk.purgeDeletedCards()
console.log(`Permanently deleted ${count} cards`)
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

<a name="KanbanSDK+getMinimizedColumns"></a>

#### kanbanSDK.getMinimizedColumns(boardId) ⇒
Returns the minimized column IDs for a board.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: Array of column IDs currently marked as minimized.  

| Param | Description |
| --- | --- |
| boardId | Board to query (uses default board if omitted). |


* * *

<a name="KanbanSDK+setMinimizedColumns"></a>

#### kanbanSDK.setMinimizedColumns(columnIds, boardId) ⇒
Sets the minimized column IDs for a board, persisting the state to the
workspace config file. Stale or invalid IDs are silently dropped.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: The sanitized list of minimized column IDs that was saved.  

| Param | Description |
| --- | --- |
| columnIds | Column IDs to mark as minimized. |
| boardId | Board to update (uses default board if omitted). |


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

<a name="KanbanSDK+migrateToSqlite"></a>

#### kanbanSDK.migrateToSqlite(dbPath) ⇒
Migrates all card data from the current storage engine to SQLite.

Cards are scanned from every board using the active engine, then written
through the configured `sqlite` compatibility provider. After all data has
been copied the workspace `.kanban.json` is updated with
`storageEngine: 'sqlite'` and `sqlitePath` so that subsequent SDK instances
resolve the same compatibility provider.

The existing markdown files are **not** deleted; they serve as a manual
backup until the caller explicitly removes them.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: The total number of cards migrated.  
**Throws**:

- <code>Error</code> If the current engine is already `'sqlite'`.


| Param | Description |
| --- | --- |
| dbPath | Path to the SQLite database file. Relative paths are   resolved from the workspace root. Defaults to `'.kanban/kanban.db'`. |

**Example**  
```ts
const count = await sdk.migrateToSqlite()
console.log(`Migrated ${count} cards to SQLite`)
```

* * *

<a name="KanbanSDK+migrateToMarkdown"></a>

#### kanbanSDK.migrateToMarkdown() ⇒
Migrates all card data from the current `sqlite` compatibility provider back
to markdown files.

Cards are scanned from every board in the SQLite database and written as
individual `.md` files under `.kanban/boards/<boardId>/<status>/`. After
migration the workspace `.kanban.json` is updated to remove the
`storageEngine`/`sqlitePath` overrides so the default markdown engine is
used by subsequent SDK instances.

The SQLite database file is **not** deleted; it serves as a manual backup.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: The total number of cards migrated.  
**Throws**:

- <code>Error</code> If the current engine is already `'markdown'`.

**Example**  
```ts
const count = await sdk.migrateToMarkdown()
console.log(`Migrated ${count} cards to markdown`)
```

* * *

<a name="KanbanSDK+setDefaultBoard"></a>

#### kanbanSDK.setDefaultBoard(boardId)
Sets the default board for the workspace.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Throws**:

- <code>Error</code> If the board does not exist.


| Param | Description |
| --- | --- |
| boardId | The ID of the board to set as the default. |

**Example**  
```ts
sdk.setDefaultBoard('sprint-2')
```

* * *

<a name="KanbanSDK+listWebhooks"></a>

#### kanbanSDK.listWebhooks() ⇒
Lists all registered webhooks.

Delegates to the resolved `kl-plugin-webhook` provider.
Throws if no `webhook.delivery` provider is installed.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: Array of [Webhook](Webhook) objects.  
**Throws**:

- <code>Error</code> When `kl-plugin-webhook` is not installed.


* * *

<a name="KanbanSDK+createWebhook"></a>

#### kanbanSDK.createWebhook(webhookConfig) ⇒
Creates and persists a new webhook.

Delegates to the resolved `kl-plugin-webhook` provider.
Throws if no `webhook.delivery` provider is installed.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: The newly created [Webhook](Webhook).  
**Throws**:

- <code>Error</code> When `kl-plugin-webhook` is not installed.


| Param | Description |
| --- | --- |
| webhookConfig | The webhook configuration. |


* * *

<a name="KanbanSDK+deleteWebhook"></a>

#### kanbanSDK.deleteWebhook(id) ⇒
Deletes a webhook by its ID.

Delegates to the resolved `kl-plugin-webhook` provider.
Throws if no `webhook.delivery` provider is installed.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: `true` if deleted, `false` if not found.  
**Throws**:

- <code>Error</code> When `kl-plugin-webhook` is not installed.


| Param | Description |
| --- | --- |
| id | The webhook ID to delete. |


* * *

<a name="KanbanSDK+updateWebhook"></a>

#### kanbanSDK.updateWebhook(id, updates) ⇒
Updates an existing webhook's configuration.

Delegates to the resolved `kl-plugin-webhook` provider.
Throws if no `webhook.delivery` provider is installed.

**Kind**: instance method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Returns**: The updated [Webhook](Webhook), or `null` if not found.  
**Throws**:

- <code>Error</code> When `kl-plugin-webhook` is not installed.


| Param | Description |
| --- | --- |
| id | The webhook ID to update. |
| updates | Partial webhook fields to merge. |


* * *

<a name="KanbanSDK._authStorage"></a>

#### KanbanSDK.\_authStorage
**Kind**: static property of [<code>KanbanSDK</code>](#KanbanSDK)  
**Internal**: Async-scoped auth carrier. Installed per request scope via [runWithAuth](runWithAuth).  

* * *

<a name="KanbanSDK._runWithScopedAuth"></a>

#### KanbanSDK.\_runWithScopedAuth()
**Kind**: static method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Internal**:   

* * *

<a name="KanbanSDK._getScopedAuth"></a>

#### KanbanSDK.\_getScopedAuth()
**Kind**: static method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Internal**:   

* * *

<a name="KanbanSDK._cloneMergeValue"></a>

#### KanbanSDK.\_cloneMergeValue()
**Kind**: static method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Internal**:   

* * *

<a name="KanbanSDK._deepMerge"></a>

#### KanbanSDK.\_deepMerge()
Recursively deep-merges `source` into a shallow copy of `target`.

- Plain objects are merged recursively; later keys override earlier keys at
  every depth.
- Arrays, primitives, and class instances in `source` **replace** the
  corresponding value in `target` (no concatenation of arrays).
- `target` itself is never mutated; the caller receives the merged clone.

**Kind**: static method of [<code>KanbanSDK</code>](#KanbanSDK)  
**Internal**:   

* * *

<a name="PLUGIN_SETTINGS_REDACTION_TARGETS"></a>

### PLUGIN\_SETTINGS\_REDACTION\_TARGETS
Shared plugin secret redaction targets that every surface must honor.

**Kind**: global variable  

* * *

<a name="DEFAULT_PLUGIN_SETTINGS_REDACTION"></a>

### DEFAULT\_PLUGIN\_SETTINGS\_REDACTION
Default write-only secret masking policy for plugin settings contracts.

**Kind**: global variable  

* * *

<a name="PLUGIN_SETTINGS_INSTALL_SCOPES"></a>

### PLUGIN\_SETTINGS\_INSTALL\_SCOPES
Supported install scopes for in-product plugin installation requests.

**Kind**: global variable  

* * *

<a name="EXACT_PLUGIN_SETTINGS_PACKAGE_NAME_PATTERN"></a>

### EXACT\_PLUGIN\_SETTINGS\_PACKAGE\_NAME\_PATTERN
Exact package-name matcher for install requests accepted by the plugin settings contract.

**Kind**: global variable  

* * *

<a name="_isPlainObject"></a>

### \_isPlainObject()
Returns `true` when `value` is a plain-object merge candidate.

Accepts `{}` literals and `Object.create(null)` objects. Rejects arrays,
class instances, primitives, and `null`. Used by `KanbanSDK._deepMerge`.

**Kind**: global function  
**Internal**:   

* * *

<a name="isPluginSettingsInstallScope"></a>

### isPluginSettingsInstallScope()
Returns `true` when `value` is a supported plugin install scope.

**Kind**: global function  

* * *

<a name="isExactPluginSettingsPackageName"></a>

### isExactPluginSettingsPackageName()
Returns `true` when `value` is an exact unscoped `kl-*` npm package name.

**Kind**: global function  

* * *

<a name="validatePluginSettingsInstallRequest"></a>

### validatePluginSettingsInstallRequest()
Validates the SDK install request contract for plugin settings flows.

Only exact unscoped `kl-*` package names are accepted. Version specifiers,
paths, URLs, shell fragments, whitespace-delimited arguments, and other
npm wrapper syntax are rejected at this boundary before any subprocess work
is attempted.

**Kind**: global function  

* * *

<a name="createPluginSettingsErrorPayload"></a>

### createPluginSettingsErrorPayload()
Applies the shared plugin secret redaction policy to surfaced error payloads.

**Kind**: global function  

* * *


## Types

<a name="AuthError"></a>

### AuthError
Typed error thrown by the SDK authorization seam when a policy plugin
denies an action.

Host surfaces should catch this to return appropriate error responses
(HTTP 403, CLI error output, MCP tool error) without leaking token material.

**Kind**: global class  

* * *

<a name="CardStateError"></a>

### CardStateError
Typed public error for card-state availability and identity failures.

`ERR_CARD_STATE_IDENTITY_UNAVAILABLE` means a configured `auth.identity`
provider did not yield an actor. `ERR_CARD_STATE_UNAVAILABLE` means no active
`card.state` backend is available.

**Kind**: global class  

* * *

<a name="CARD_FORMAT_VERSION"></a>

### CARD\_FORMAT\_VERSION
Current card frontmatter schema version. Increment when the format changes.

**Kind**: global variable  

* * *

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

<a name="ERR_CARD_STATE_IDENTITY_UNAVAILABLE"></a>

### ERR\_CARD\_STATE\_IDENTITY\_UNAVAILABLE
Stable machine-readable error for configured-auth card-state calls without a resolved identity.

**Kind**: global variable  

* * *

<a name="ERR_CARD_STATE_UNAVAILABLE"></a>

### ERR\_CARD\_STATE\_UNAVAILABLE
Stable machine-readable error for card-state calls when no provider is active.

**Kind**: global variable  

* * *

<a name="CARD_STATE_DEFAULT_ACTOR_MODE"></a>

### CARD\_STATE\_DEFAULT\_ACTOR\_MODE
Stable mode name for the auth-absent card-state default actor contract.

**Kind**: global variable  

* * *

<a name="DEFAULT_CARD_STATE_ACTOR"></a>

### DEFAULT\_CARD\_STATE\_ACTOR
Shared default actor contract for auth-absent card-state mode.

This actor is only valid when no real `auth.identity` provider is configured.
All host surfaces should treat this as a stable public contract for both the
built-in file-backed `builtin` backend and first-party compatibility backends
such as `sqlite`.

**Kind**: global variable  

* * *

<a name="CARD_STATE_UNREAD_DOMAIN"></a>

### CARD\_STATE\_UNREAD\_DOMAIN
Stable built-in domain name for unread/read cursor persistence.

**Kind**: global variable  

* * *

<a name="CARD_STATE_OPEN_DOMAIN"></a>

### CARD\_STATE\_OPEN\_DOMAIN
Stable built-in domain name for explicit actor-scoped open-card state persistence.

**Kind**: global variable  

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

<a name="getDisplayTitleFromContent"></a>

### getDisplayTitleFromContent(content, metadata, titleFields) ⇒
Returns the user-visible card title for a board by prefixing selected
metadata values ahead of the raw markdown-derived title.

This helper is display-only. It does **not** modify stored markdown,
filename generation, or rename behavior.

**Kind**: global function  
**Returns**: The raw markdown title, optionally prefixed by configured metadata values.  

| Param | Description |
| --- | --- |
| content | Raw markdown card content. |
| metadata | Optional card metadata object. |
| titleFields | Ordered metadata keys whose non-empty rendered values should prefix the title. |

**Example**  
```js
getDisplayTitleFromContent('# Ship release', { ticket: 'REL-42', sprint: 'Q1' }, ['ticket', 'sprint'])
// => 'REL-42 Q1 Ship release'
```
**Example**  
```js
getDisplayTitleFromContent('# Ship release', { ticket: 'REL-42' }, ['missing', 'ticket'])
// => 'REL-42 Ship release'
```

* * *

<a name="generateSlug"></a>

### generateSlug(title) ⇒
Creates a filename-safe slug from a title string.

The slug is lowercased, stripped of special characters, limited to 50
characters, and falls back to `'card'` if the result would be empty.

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

<a name="formatFormDisplayName"></a>

### formatFormDisplayName(formKey) ⇒
Converts a stable form key such as `'bug-report'` into a human-friendly
display name such as `'Bug Report'`.

This is used as the default display name for reusable config-backed forms
when `FormDefinition.name` is omitted.

**Kind**: global function  
**Returns**: A human-readable title-cased name.  

| Param | Description |
| --- | --- |
| formKey | Stable config form key or resolved form identifier. |


* * *

<a name="generateCardFilename"></a>

### generateCardFilename(id, title) ⇒ <code>id</code>
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
generateCardFilename(42, 'Build Dashboard')
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

<a name="createEmptyPluginSettingsPayload"></a>

### createEmptyPluginSettingsPayload()
Empty plugin-settings payload used when a host has no active SDK context.

**Kind**: global function  

* * *

<a name="sanitizeCard"></a>

### sanitizeCard(card) ⇒
Strips the `filePath` property from a card before exposing it
in webhook payloads or API responses. The file path is an internal
implementation detail that should not be leaked externally.

**Kind**: global function  
**Returns**: A copy of the card without the `filePath` field.  

| Param | Description |
| --- | --- |
| card | The card object to sanitize. |

**Example**  
```js
const safe = sanitizeCard(card)
// safe.filePath is undefined
```

* * *


## Configuration

<a name="PLUGIN_CAPABILITY_NAMESPACES"></a>

### PLUGIN\_CAPABILITY\_NAMESPACES
Stable ordered capability list reused by plugin settings hosts and tests.

**Kind**: global variable  

* * *

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

<a name="loadDotEnv"></a>

### loadDotEnv(dir)
Loads key–value pairs from a `.env` file in the given directory into
`process.env`. Existing environment variables are never overwritten so that
real OS-level values always take precedence over file-based defaults.
Silently does nothing if the file does not exist.

**Kind**: global function  

| Param | Description |
| --- | --- |
| dir | Directory that may contain a `.env` file. |


* * *

<a name="resolveConfigEnvVars"></a>

### resolveConfigEnvVars(node, configFileName, nodePath) ⇒
Recursively resolves `${VAR_NAME}` placeholders in all string values of a
parsed config object against `process.env`. Mutates the object in place.

Throws a descriptive error when a referenced environment variable is not
set, including the JSON path to the offending value so the operator can
locate it quickly. Example error message:

```
missing ALICE_PASSWORD_HASH in .kanban.json: .plugins."auth.identity".options.users[3].password "${ALICE_PASSWORD_HASH}"
```

Keys that contain non-identifier characters (e.g. dots) are quoted in the
path segment, matching the convention used in `.kanban.json` error messages.

**Kind**: global function  
**Returns**: The processed node (same reference for objects/arrays; new primitive for strings).  

| Param | Description |
| --- | --- |
| node | The current node to process (object, array, string, or scalar). |
| configFileName | Config filename used in error messages (e.g. `'.kanban.json'`). |
| nodePath | JSON path accumulated so far (empty string at root). |


* * *

<a name="readConfig"></a>

### readConfig(workspaceRoot) ⇒
Reads the kanban config from disk. If the file is missing or unreadable,
returns the default config. If the file contains a v1 config, it is
automatically migrated to v2 format and persisted back to disk.

Any `${VAR_NAME}` placeholders found in string values are resolved against
`process.env` before the config is returned. If a referenced environment
variable is not set the process will throw a descriptive error rather than
silently falling back to defaults, because an unresolved secret is never a
safe default.

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
console.log(settings.cardViewMode) // => 'large'
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
const updated = settingsToConfig(config, { ...configToSettings(config), cardViewMode: 'normal' })
writeConfig('/home/user/my-project', updated)
```

* * *

<a name="normalizeAuthCapabilities"></a>

### normalizeAuthCapabilities()
Normalizes auth capability selections into a complete runtime capability map.

Omitted auth providers default to the `noop` compatibility ids. When the
external `kl-plugin-auth` package is installed those ids resolve there;
otherwise core keeps a built-in compatibility fallback so behavior is
unchanged when auth is not configured.

The input object is never mutated.

**Kind**: global function  

* * *

<a name="normalizeCardStateCapabilities"></a>

### normalizeCardStateCapabilities()
Normalizes card-state capability selections into a complete runtime capability map.

`card.state` is first-class and defaults to the built-in `localfs` provider
when omitted from `.kanban.json`.

The input object is never mutated.

**Kind**: global function  

* * *

<a name="normalizeStorageCapabilities"></a>

### normalizeStorageCapabilities()
Normalizes legacy storage settings plus capability-based plugin selections
into a complete runtime capability map.

Precedence:
1. Explicit `plugins[namespace]`
2. Legacy `storageEngine` / `sqlitePath` for `card.storage`
3. Backward-compatible defaults (`localfs` + derived attachment provider)

`attachment.storage` follows the active `card.storage` provider by default,
reusing the same provider id and options for first-party storage plugins.
Configure `attachment.storage` explicitly only when you want a different
provider (for example an attachment-only plugin such as S3).

The input object is never mutated.

**Kind**: global function  

* * *

<a name="normalizeWebhookCapabilities"></a>

### normalizeWebhookCapabilities()
Normalizes webhook capability selections into a complete runtime capability map.

When no explicit provider is configured, defaults to `{ provider: 'webhooks' }`, which
maps to the `kl-plugin-webhook` external package via `WEBHOOK_PROVIDER_ALIASES`.
Core no longer provides a built-in webhook delivery fallback; hosts must install
that package anywhere webhook CRUD or runtime delivery is expected to work.

The input object is never mutated.

**Kind**: global function  

* * *

<a name="normalizeCallbackCapabilities"></a>

### normalizeCallbackCapabilities()
Normalizes callback runtime capability selections into a complete runtime capability map.

`callback.runtime` is first-class but disabled by default until a provider is
explicitly selected through the shared plugin settings flow.

The input object is never mutated.

**Kind**: global function  

* * *


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


## Auth Plugin Contracts

<a name="WORKSPACE_ROOT"></a>

### WORKSPACE\_ROOT
The pnpm workspace root directory, resolved once at module load time.

- Inside the monorepo checkout: the absolute path to the repository root
  (contains `pnpm-workspace.yaml`).
- Outside the monorepo (standalone npm install): `null`.

Used by the plugin loader to probe `packages/{name}` as the primary
workspace-local resolution path during the staged monorepo migration.

**Kind**: global variable  
**Internal**:   

* * *

<a name="RBAC_USER_ACTIONS"></a>

### RBAC\_USER\_ACTIONS
Actions available to the `user` role.

Covers non-destructive card-interaction operations: form submission,
comments, attachments, action triggers, and card-level log writes.

**Kind**: global variable  

* * *

<a name="RBAC_MANAGER_ACTIONS"></a>

### RBAC\_MANAGER\_ACTIONS
Actions available to the `manager` role (includes all `user` actions).

Adds card lifecycle mutations (create, update, move, transfer, delete),
board-action triggers, card-log clearing, and board-level log writes.

**Kind**: global variable  

* * *

<a name="RBAC_ADMIN_ACTIONS"></a>

### RBAC\_ADMIN\_ACTIONS
Actions available to the `admin` role (includes all `manager` and `user` actions).

Adds all destructive and configuration operations: board create/update/delete,
settings, webhooks, labels, columns, board-action config edits, board-log
clearing, migrations, default-board changes, and deleted-card purge.

**Kind**: global variable  

* * *

<a name="RBAC_ROLE_MATRIX"></a>

### RBAC\_ROLE\_MATRIX
Fixed RBAC role matrix keyed by [RbacRole](RbacRole).

Each entry maps to the complete set of canonical action names that the role
is permitted to perform. This is the single canonical source of truth consumed
by the shipped `rbac` auth provider pair and by host tests that verify denial
semantics. Hosts must not replicate or extend this matrix locally.

**Kind**: global variable  
**Example**  
```js
// Check whether a resolved role may perform an action:
const allowed = RBAC_ROLE_MATRIX['manager'].has('card.create') // true
const denied  = RBAC_ROLE_MATRIX['user'].has('board.delete')   // false
```

* * *

<a name="NOOP_IDENTITY_PLUGIN"></a>

### NOOP\_IDENTITY\_PLUGIN
No-op identity provider resolved from `kl-plugin-auth` when available.

**Kind**: global variable  

* * *

<a name="NOOP_POLICY_PLUGIN"></a>

### NOOP\_POLICY\_PLUGIN
No-op policy provider resolved from `kl-plugin-auth` when available.

**Kind**: global variable  

* * *

<a name="RBAC_IDENTITY_PLUGIN"></a>

### RBAC\_IDENTITY\_PLUGIN
RBAC identity provider resolved from `kl-plugin-auth` when available.

**Kind**: global variable  

* * *

<a name="RBAC_POLICY_PLUGIN"></a>

### RBAC\_POLICY\_PLUGIN
RBAC policy provider resolved from `kl-plugin-auth` when available.

**Kind**: global variable  

* * *

<a name="PROVIDER_ALIASES"></a>

### PROVIDER\_ALIASES
Maps short user-facing provider ids to their installable npm package names.

The ids `sqlite` and `mysql` are compatibility aliases that keep the familiar
user-visible provider id in `.kanban.json` while delegating implementation
ownership to standalone, versioned packages. When a provider id is listed
here and no built-in implementation is registered, the resolver loads the
mapped package name and issues install hints that reference it.

Install targets:
- `sqlite`     → `npm install kl-plugin-storage-sqlite`
- `mysql`      → `npm install kl-plugin-storage-mysql`
- `postgresql` → `npm install kl-plugin-storage-postgresql`

All packages must export `cardStoragePlugin` and `attachmentStoragePlugin`
with CJS entry `dist/index.cjs`.

**Kind**: global variable  

* * *

<a name="CARD_STATE_PROVIDER_ALIASES"></a>

### CARD\_STATE\_PROVIDER\_ALIASES
Maps short `card.state` provider ids to their installable npm package names.

Card-state is now merged into storage packages. The aliases point to the
same packages as `PROVIDER_ALIASES`.

External packages must export `createCardStateProvider(context)` or a
`cardStateProvider`/`default` object with a manifest that provides
`'card.state'`.

**Kind**: global variable  

* * *

<a name="WEBHOOK_PROVIDER_ALIASES"></a>

### WEBHOOK\_PROVIDER\_ALIASES
Maps short webhook provider ids to their installable npm package names.

- `webhooks` → `npm install kl-plugin-webhook`

External packages must export `webhookProviderPlugin` (or a default export)
with a manifest that provides `'webhook.delivery'` and CRUD methods.

**Kind**: global variable  

* * *

<a name="CALLBACK_PROVIDER_ALIASES"></a>

### CALLBACK\_PROVIDER\_ALIASES
Maps short callback runtime provider ids to their installable npm package names.

- `callbacks` → `npm install kl-plugin-callback`

**Kind**: global variable  

* * *

<a name="AUTH_PROVIDER_ALIASES"></a>

### AUTH\_PROVIDER\_ALIASES
Maps built-in auth compatibility ids to the external auth package.

- `noop` → `npm install kl-plugin-auth`
- `rbac` → `npm install kl-plugin-auth`

**Kind**: global variable  

* * *

<a name="BUILTIN_ATTACHMENT_IDS"></a>

### BUILTIN\_ATTACHMENT\_IDS
Set of provider ids that are handled as built-in attachment plugins.

**Kind**: global variable  

* * *

<a name="FALLBACK_NOOP_IDENTITY_PLUGIN"></a>

### FALLBACK\_NOOP\_IDENTITY\_PLUGIN
Built-in compatibility no-op identity provider. Always resolves to `null` (anonymous).

**Kind**: global constant  

* * *

<a name="FALLBACK_NOOP_POLICY_PLUGIN"></a>

### FALLBACK\_NOOP\_POLICY\_PLUGIN
Built-in compatibility no-op policy provider. Always returns `{ allowed: true }` (allow-all).

**Kind**: global constant  

* * *

<a name="BUILTIN_CARD_PLUGINS"></a>

### BUILTIN\_CARD\_PLUGINS
Registry of built-in card.storage plugins keyed by provider id.

**Kind**: global constant  

* * *

<a name="findWorkspaceRoot"></a>

### findWorkspaceRoot()
Walks up from `startDir` looking for a `pnpm-workspace.yaml` file that
marks the workspace root.  Returns the first matching ancestor directory,
or `null` when running outside the monorepo (e.g., after a standalone npm
install by a user).

**Kind**: global function  
**Internal**:   

* * *

<a name="createRbacIdentityPlugin"></a>

### createRbacIdentityPlugin(principals)
Creates a runtime-validated RBAC identity plugin backed by a host-supplied
principal registry.

Tokens are treated as opaque strings and looked up in `principals`. A token
present in the map resolves to the associated principal entry; any token
absent from the map resolves to `null` (anonymous / deny). Roles are taken
from the registry entry and are never inferred from token text.

Token values and principal material — including role assignments — must
remain in host/runtime configuration only and must never appear in
`.kanban.json`, diagnostics, or log output.

**Kind**: global function  

| Param | Description |
| --- | --- |
| principals | Map of opaque token → [RbacPrincipalEntry](RbacPrincipalEntry), owned   and populated by the host at startup. |


* * *

<a name="canUseDefaultCardStateActor"></a>

### canUseDefaultCardStateActor()
Returns `true` only when the auth configuration permits the stable default
single-user card-state actor.

Any non-noop `auth.identity` provider disables the fallback, even if the
provider later resolves no caller for a specific request.

**Kind**: global function  

* * *

<a name="tryLoadGlobalPackage"></a>

### tryLoadGlobalPackage()
Tries to load an external plugin from the global npm node_modules directory.
The global prefix is derived from the Node.js binary path ([process.execPath](process.execPath)).
On Unix-like systems the global node_modules directory is `{prefix}/lib/node_modules`;
on Windows it is `{prefix}/node_modules`.

**Kind**: global function  
**Internal**:   

* * *

<a name="resolvePluginSettingsOptionsSchema"></a>

### resolvePluginSettingsOptionsSchema()
Resolves transport-safe plugin-settings metadata from a static object or a
dynamic sync/async schema factory.

Any nested resolver function found inside `schema`, `uiSchema`, or other
metadata fields is awaited before normalization, ensuring downstream host
transports and JSON Forms consumers receive plain structured-clone-safe
values only.

**Kind**: global function  

* * *

<a name="tryLoadSDKExtensionPlugin"></a>

### tryLoadSDKExtensionPlugin()
Attempts to load an optional `sdkExtensionPlugin` export from an active
package.  Returns `null` silently when the export is absent or does not
satisfy the [SDKExtensionPlugin](SDKExtensionPlugin) contract so that missing extensions
never prevent capability bag resolution.

**Kind**: global function  
**Internal**:   

* * *

<a name="resolveSDKExtensions"></a>

### resolveSDKExtensions(capabilities, authCapabilities, webhookCapabilities) ⇒
Collects SDK extension contributions from all active external packages by
probing each for the optional `sdkExtensionPlugin` named export.

**Kind**: global function  
**Returns**: De-duplicated list of resolved SDK extension entries.  
**Internal**:   

| Param | Description |
| --- | --- |
| capabilities | Resolved storage capability selections. |
| authCapabilities | Resolved auth capability selections. |
| webhookCapabilities | Resolved webhook capability selections, or `null`. |


* * *

<a name="loadExternalCardPlugin"></a>

### loadExternalCardPlugin()
Lazily loads an external npm card-storage plugin.
Returns a deterministic, actionable error when the package is not installed
rather than letting Node throw a confusing MODULE_NOT_FOUND.

**Kind**: global function  
**Internal**:   

* * *

<a name="loadExternalAttachmentPlugin"></a>

### loadExternalAttachmentPlugin()
Lazily loads an external npm attachment-storage plugin.
Returns a deterministic, actionable error when the package is not installed.

**Kind**: global function  
**Internal**:   

* * *

<a name="isValidSDKEventListenerPlugin"></a>

### isValidSDKEventListenerPlugin()
Type guard for [SDKEventListenerPlugin](SDKEventListenerPlugin) — validates that `plugin` has
the `register` / `unregister` lifecycle and a valid manifest.

**Kind**: global function  
**Internal**:   

* * *

<a name="resolveCardStateProviderFromStorage"></a>

### resolveCardStateProviderFromStorage()
Auto-derives card-state from the active storage plugin when no explicit
`card.state` provider is configured (or the configured provider is `localfs`).

Resolution order:
1. If an explicit non-localfs card-state provider is configured, use it.
2. If the storage provider is external, try loading `createCardStateProvider`
   from the storage package.
3. Fall back to the built-in file-backed card-state provider.

**Kind**: global function  

* * *

<a name="loadWebhookPluginPack"></a>

### loadWebhookPluginPack()
Lazily loads an external npm webhook provider plugin.

Accepts packages that export:
- `webhookProviderPlugin` (or a default): CRUD webhook provider.
- `webhookListenerPlugin` (optional): a [SDKEventListenerPlugin](SDKEventListenerPlugin) for
  runtime delivery.
- `WebhookListenerPlugin` (optional): a class export constructed with the
  workspace root when the runtime listener needs workspace-local config.

Returns a deterministic, actionable error when the package is not installed
or does not export the expected shape.

**Kind**: global function  
**Internal**:   

* * *

<a name="resolveWebhookPlugins"></a>

### resolveWebhookPlugins()
Attempts to resolve a webhook provider and its runtime delivery listener from
a normalized [ProviderRef](ProviderRef).

Listener resolution priority:
1. `webhookListenerPlugin: SDKEventListenerPlugin` named export from package.
2. `WebhookListenerPlugin` class export constructed with the workspace root.
3. `null` — no webhook runtime listener is available.

Returns `null` when the package is simply not installed yet (not-installed error).
Throws for any other loading or validation error.

**Kind**: global function  
**Internal**:   

* * *

<a name="createBuiltinAuthListenerPlugin"></a>

### createBuiltinAuthListenerPlugin(authIdentity, authPolicy, getAuthContext) ⇒
Creates the built-in auth event listener plugin that enforces authorization
during the before-event phase.

The listener resolves identity from the active request-scoped auth carrier,
evaluates
the configured policy for [BeforeEventPayload.event](BeforeEventPayload.event), emits
`auth.allowed` / `auth.denied`, and throws [AuthError](AuthError) when a mutation
must be vetoed.

**Kind**: global function  
**Returns**: A registered [SDKEventListenerPlugin](SDKEventListenerPlugin) for the auth runtime seam.  

| Param | Description |
| --- | --- |
| authIdentity | Resolved identity provider used to establish the caller. |
| authPolicy | Resolved policy provider used to authorize each action. |
| getAuthContext | Optional accessor for the active scoped auth context. |


* * *

<a name="collectActiveExternalPackageNames"></a>

### collectActiveExternalPackageNames(config) ⇒
Collects the canonical set of external npm package names that should be
probed for plugin extension contributions (e.g. `cliPlugin`, `standaloneHttpPlugin`)
from a raw workspace config object.

Applies the same alias translations used by the standalone HTTP plugin discovery
path (`collectStandaloneHttpPackageNames`), and reads both the normalized `plugins`
key and the legacy `webhookPlugin` key so that webhook-only configurations
deterministically activate the webhook package for all surfaces.

When no explicit webhook provider is configured, falls through to the default
`'webhooks'` → `'kl-plugin-webhook'` alias, matching the behaviour of
[normalizeWebhookCapabilities](normalizeWebhookCapabilities) and the standalone discovery path so that
both surfaces activate the same set of packages.

**Kind**: global function  
**Returns**: Deduplicated list of external npm package names to probe for extensions.  

| Param | Description |
| --- | --- |
| config | Raw workspace config. Only the consumed fields need to be present. |


* * *

<a name="resolveMcpPlugins"></a>

### resolveMcpPlugins()
Resolves optional MCP tool plugins from the canonical active-package set.

Reuses [collectActiveExternalPackageNames](#collectActiveExternalPackageNames) so MCP follows the same
activation model as CLI and standalone HTTP discovery.

**Kind**: global function  

* * *

<a name="resolveCapabilityBag"></a>

### resolveCapabilityBag(capabilities, kanbanDir, authCapabilities, webhookCapabilities, cardStateCapabilities, callbackCapabilities)
Resolves a fully typed [ResolvedCapabilityBag](ResolvedCapabilityBag) from a normalized
[ResolvedCapabilities](ResolvedCapabilities) map.

Attachment storage fallback precedence:
1. Explicit provider in `capabilities['attachment.storage']` (built-in or external)
2. Card storage engine's explicit built-in attachment provider
3. Built-in `localfs`

Auth plugins default to the `noop` compatibility providers (anonymous identity,
allow-all policy) when `authCapabilities` is not supplied, preserving
the current open-access behavior.

**Kind**: global function  

| Param | Description |
| --- | --- |
| capabilities | Normalized provider selections from [normalizeStorageCapabilities](normalizeStorageCapabilities). |
| kanbanDir | Absolute path to the `.kanban` directory. |
| authCapabilities | Optional normalized auth provider selections from                           [normalizeAuthCapabilities](normalizeAuthCapabilities). Defaults to noop providers. |
| webhookCapabilities | Optional normalized webhook provider selections from                           [normalizeWebhookCapabilities](normalizeWebhookCapabilities). When omitted, webhook                           provider resolution is skipped and `bag.webhookProvider` is `null`. |
| cardStateCapabilities | Optional normalized card-state provider selections from                           [normalizeCardStateCapabilities](normalizeCardStateCapabilities). |
| callbackCapabilities | Optional normalized callback runtime provider selections from                           [normalizeCallbackCapabilities](normalizeCallbackCapabilities). When omitted, callback                           listener resolution is skipped and `bag.callbackListener` is `null`. |


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
