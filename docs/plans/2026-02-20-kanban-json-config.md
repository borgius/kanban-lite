# .kanban.json Config Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move all configuration from VSCode settings to a `.kanban.json` file at the project root, auto-created with full defaults on first non-default settings change.

**Architecture:** Create a shared `src/shared/config.ts` module with `KanbanConfig` interface, defaults, and read/write helpers. Replace all `vscode.workspace.getConfiguration('kanban-lite')` calls with `readConfig()`. Replace `onDidChangeConfiguration` with file watchers on `.kanban.json`. Remove `contributes.configuration` from `package.json`.

**Tech Stack:** TypeScript, Node.js `fs` module, VSCode `FileSystemWatcher` API

---

### Task 1: Create shared config module

**Files:**
- Create: `src/shared/config.ts`

**Step 1: Create the config module**

```typescript
// src/shared/config.ts
import * as fs from 'fs'
import * as path from 'path'
import type { KanbanColumn, CardDisplaySettings, Priority, FeatureStatus } from './types'

export interface KanbanConfig {
  featuresDirectory: string
  defaultPriority: Priority
  defaultStatus: FeatureStatus
  columns: KanbanColumn[]
  aiAgent: string
  showPriorityBadges: boolean
  showAssignee: boolean
  showDueDate: boolean
  showLabels: boolean
  showBuildWithAI: boolean
  showFileName: boolean
  compactMode: boolean
  markdownEditorMode: boolean
}

export const DEFAULT_CONFIG: KanbanConfig = {
  featuresDirectory: '.kanban',
  defaultPriority: 'medium',
  defaultStatus: 'backlog',
  columns: [
    { id: 'backlog', name: 'Backlog', color: '#6b7280' },
    { id: 'todo', name: 'To Do', color: '#3b82f6' },
    { id: 'in-progress', name: 'In Progress', color: '#f59e0b' },
    { id: 'review', name: 'Review', color: '#8b5cf6' },
    { id: 'done', name: 'Done', color: '#22c55e' }
  ],
  aiAgent: 'claude',
  showPriorityBadges: true,
  showAssignee: true,
  showDueDate: true,
  showLabels: true,
  showBuildWithAI: true,
  showFileName: false,
  compactMode: false,
  markdownEditorMode: false
}

export const CONFIG_FILENAME = '.kanban.json'

export function configPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, CONFIG_FILENAME)
}

export function readConfig(workspaceRoot: string): KanbanConfig {
  const filePath = configPath(workspaceRoot)
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    return { ...DEFAULT_CONFIG, ...raw }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function writeConfig(workspaceRoot: string, config: KanbanConfig): void {
  const filePath = configPath(workspaceRoot)
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

/** Extract CardDisplaySettings from a KanbanConfig */
export function configToSettings(config: KanbanConfig): CardDisplaySettings {
  return {
    showPriorityBadges: config.showPriorityBadges,
    showAssignee: config.showAssignee,
    showDueDate: config.showDueDate,
    showLabels: config.showLabels,
    showBuildWithAI: config.showBuildWithAI,
    showFileName: config.showFileName,
    compactMode: config.compactMode,
    markdownEditorMode: config.markdownEditorMode,
    defaultPriority: config.defaultPriority,
    defaultStatus: config.defaultStatus
  }
}

/** Merge CardDisplaySettings back into a KanbanConfig */
export function settingsToConfig(config: KanbanConfig, settings: CardDisplaySettings): KanbanConfig {
  return {
    ...config,
    showPriorityBadges: settings.showPriorityBadges,
    showAssignee: settings.showAssignee,
    showDueDate: settings.showDueDate,
    showLabels: settings.showLabels,
    showFileName: settings.showFileName,
    compactMode: settings.compactMode,
    defaultPriority: settings.defaultPriority,
    defaultStatus: settings.defaultStatus
  }
}
```

**Step 2: Commit**

```bash
git add src/shared/config.ts
git commit -m "feat: add shared config module for .kanban.json"
```

---

### Task 2: Update KanbanPanel.ts to use config module

**Files:**
- Modify: `src/extension/KanbanPanel.ts`

**Step 1: Add imports and workspace root helper**

At top of file, add:
```typescript
import { readConfig, writeConfig, configToSettings, settingsToConfig, configPath, CONFIG_FILENAME } from '../shared/config'
import type { KanbanConfig } from '../shared/config'
```

Add a private helper and field:
```typescript
private _configWatcher: vscode.FileSystemWatcher | undefined
```

Add helper method:
```typescript
private _getWorkspaceRoot(): string | null {
  const workspaceFolders = vscode.workspace.workspaceFolders
  if (!workspaceFolders || workspaceFolders.length === 0) return null
  return workspaceFolders[0].uri.fsPath
}
```

**Step 2: Replace `_getWorkspaceFeaturesDir()`**

Replace body with:
```typescript
private _getWorkspaceFeaturesDir(): string | null {
  const root = this._getWorkspaceRoot()
  if (!root) return null
  const config = readConfig(root)
  return path.join(root, config.featuresDirectory)
}
```

**Step 3: Replace `_getColumns()`**

Replace body with:
```typescript
private _getColumns(): KanbanColumn[] {
  const root = this._getWorkspaceRoot()
  if (!root) return [...DEFAULT_CONFIG.columns]
  const config = readConfig(root)
  return config.columns.map(c => ({ ...c }))
}
```

Import `DEFAULT_CONFIG` from config module (already added in step 1).

**Step 4: Replace `_sendFeaturesToWebviewWithColumns()`**

Replace the method body to read from config instead of `vscode.workspace.getConfiguration`:
```typescript
private _sendFeaturesToWebviewWithColumns(columns: KanbanColumn[]): void {
  const root = this._getWorkspaceRoot()
  const config = root ? readConfig(root) : { ...DEFAULT_CONFIG }
  const settings = configToSettings(config)

  this._panel.webview.postMessage({
    type: 'init',
    features: this._features,
    columns,
    settings
  })
}
```

**Step 5: Replace `_saveSettings()` and remove `_updateConfig()`**

Delete `_updateConfig()` entirely. Replace `_saveSettings()` with:
```typescript
private _saveSettings(settings: CardDisplaySettings): void {
  const root = this._getWorkspaceRoot()
  if (!root) return
  const config = readConfig(root)
  const updated = settingsToConfig(config, settings)
  writeConfig(root, updated)
  this._sendFeaturesToWebview()
}
```

**Step 6: Replace `_saveColumns()`**

Replace with:
```typescript
private _saveColumns(columns: KanbanColumn[]): void {
  const root = this._getWorkspaceRoot()
  if (!root) return
  const config = readConfig(root)
  config.columns = columns
  writeConfig(root, config)
  this._sendFeaturesToWebviewWithColumns(columns)
}
```

**Step 7: Replace `onDidChangeConfiguration` with config file watcher**

In the constructor, replace lines 186-199 (the `onDidChangeConfiguration` block) with:
```typescript
// Watch .kanban.json for changes
this._setupConfigWatcher()
```

Add method:
```typescript
private _setupConfigWatcher(): void {
  if (this._configWatcher) {
    this._configWatcher.dispose()
  }

  const root = this._getWorkspaceRoot()
  if (!root) return

  const pattern = new vscode.RelativePattern(root, CONFIG_FILENAME)
  this._configWatcher = vscode.workspace.createFileSystemWatcher(pattern)

  const handleConfigChange = () => {
    // Re-read config — featuresDirectory may have changed
    const oldFeaturesDir = this._getWorkspaceFeaturesDir()
    // Config is re-read on next call to _getWorkspaceFeaturesDir, _getColumns, etc.
    const newFeaturesDir = this._getWorkspaceFeaturesDir()
    if (oldFeaturesDir !== newFeaturesDir) {
      this._setupFileWatcher()
      this._loadFeatures().then(() => this._sendFeaturesToWebview())
    } else {
      this._sendFeaturesToWebview()
    }
  }

  this._configWatcher.onDidChange(handleConfigChange, null, this._disposables)
  this._configWatcher.onDidCreate(handleConfigChange, null, this._disposables)
  this._configWatcher.onDidDelete(handleConfigChange, null, this._disposables)
  this._disposables.push(this._configWatcher)
}
```

**Step 8: Fix `markdownEditorMode` reads**

Replace all `vscode.workspace.getConfiguration('kanban-lite').get<boolean>('markdownEditorMode', false)` calls (in `createFeature`, `openFeature` cases, and `openFeature` method) with:
```typescript
const root = this._getWorkspaceRoot()
const config = root ? readConfig(root) : DEFAULT_CONFIG
config.markdownEditorMode
```

There are 3 spots:
1. `case 'createFeature'` (line 102-103)
2. `case 'openFeature'` (line 122-123)
3. `public openFeature()` method (line 447-448)

**Step 9: Fix `aiAgent` read in `_startWithAI()`**

Replace line 775-776:
```typescript
const config = vscode.workspace.getConfiguration('kanban-lite')
const selectedAgent = agent || config.get<string>('aiAgent') || 'claude'
```
With:
```typescript
const root = this._getWorkspaceRoot()
const kanbanConfig = root ? readConfig(root) : DEFAULT_CONFIG
const selectedAgent = agent || kanbanConfig.aiAgent || 'claude'
```

**Step 10: Update `openSettings` case**

Replace the `openSettings` message handler (line 144-145). Instead of opening VSCode settings, send the current settings to the webview:
```typescript
case 'openSettings': {
  const root = this._getWorkspaceRoot()
  const config = root ? readConfig(root) : { ...DEFAULT_CONFIG }
  const settings = configToSettings(config)
  this._panel.webview.postMessage({ type: 'showSettings', settings })
  break
}
```

**Step 11: Remove all remaining `vscode.workspace.getConfiguration('kanban-lite')` calls**

Search the file and verify no `getConfiguration('kanban-lite')` calls remain.

**Step 12: Commit**

```bash
git add src/extension/KanbanPanel.ts
git commit -m "refactor: KanbanPanel reads config from .kanban.json"
```

---

### Task 3: Update SidebarViewProvider.ts

**Files:**
- Modify: `src/extension/SidebarViewProvider.ts`

**Step 1: Add imports**

```typescript
import { readConfig, CONFIG_FILENAME } from '../shared/config'
```

**Step 2: Replace `_getFeaturesDir()`**

```typescript
private _getFeaturesDir(): string | null {
  const workspaceFolders = vscode.workspace.workspaceFolders
  if (!workspaceFolders || workspaceFolders.length === 0) return null
  const root = workspaceFolders[0].uri.fsPath
  const config = readConfig(root)
  return path.join(root, config.featuresDirectory)
}
```

**Step 3: Replace `_getColumns()`**

```typescript
private _getColumns(): KanbanColumn[] {
  const workspaceFolders = vscode.workspace.workspaceFolders
  if (!workspaceFolders || workspaceFolders.length === 0) return []
  const root = workspaceFolders[0].uri.fsPath
  const config = readConfig(root)
  return config.columns
}
```

**Step 4: Replace `onDidChangeConfiguration` with config file watcher**

In the constructor, replace the `onDidChangeConfiguration` block (lines 26-33) with:
```typescript
// Watch .kanban.json for config changes
const workspaceFolders = vscode.workspace.workspaceFolders
if (workspaceFolders) {
  const root = workspaceFolders[0].uri.fsPath
  const configPattern = new vscode.RelativePattern(root, CONFIG_FILENAME)
  const configWatcher = vscode.workspace.createFileSystemWatcher(configPattern)

  const handleConfigChange = () => {
    this._setupFileWatcher()
    this._refresh()
  }

  configWatcher.onDidChange(handleConfigChange, null, this._disposables)
  configWatcher.onDidCreate(handleConfigChange, null, this._disposables)
  configWatcher.onDidDelete(handleConfigChange, null, this._disposables)
  this._disposables.push(configWatcher)
}
```

**Step 5: Commit**

```bash
git add src/extension/SidebarViewProvider.ts
git commit -m "refactor: SidebarViewProvider reads config from .kanban.json"
```

---

### Task 4: Update FeatureHeaderProvider.ts

**Files:**
- Modify: `src/extension/FeatureHeaderProvider.ts`

**Step 1: Add import**

```typescript
import { readConfig, CONFIG_FILENAME } from '../shared/config'
```

**Step 2: Replace config reads in `_onActiveEditorChanged()`**

Replace lines 182-185:
```typescript
const config = vscode.workspace.getConfiguration('kanban-lite')
const featuresDirectory = config.get<string>('featuresDirectory') || '.kanban'
const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
const fullFeaturesDir = workspaceRoot ? path.join(workspaceRoot, featuresDirectory) : featuresDirectory
```
With:
```typescript
const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
if (!workspaceRoot) return
const kanbanConfig = readConfig(workspaceRoot)
const fullFeaturesDir = path.join(workspaceRoot, kanbanConfig.featuresDirectory)
```

**Step 3: Replace `onDidChangeConfiguration` with config file watcher**

Replace the configuration listener in `register()` (lines 52-59) with a file watcher:
```typescript
// Listen for .kanban.json changes
const workspaceFolders = vscode.workspace.workspaceFolders
if (workspaceFolders) {
  const root = workspaceFolders[0].uri.fsPath
  const configPattern = new vscode.RelativePattern(root, CONFIG_FILENAME)
  const configWatcher = vscode.workspace.createFileSystemWatcher(configPattern)

  const handleConfigChange = () => {
    provider._onActiveEditorChanged(vscode.window.activeTextEditor)
  }

  configWatcher.onDidChange(handleConfigChange)
  configWatcher.onDidCreate(handleConfigChange)
  configWatcher.onDidDelete(handleConfigChange)
  disposables.push(configWatcher)
}
```

**Step 4: Commit**

```bash
git add src/extension/FeatureHeaderProvider.ts
git commit -m "refactor: FeatureHeaderProvider reads config from .kanban.json"
```

---

### Task 5: Update extension/index.ts

**Files:**
- Modify: `src/extension/index.ts`

**Step 1: Add import**

```typescript
import { readConfig } from '../shared/config'
```

**Step 2: Replace config read at activation**

Replace lines 157-159:
```typescript
const config = vscode.workspace.getConfiguration('kanban-lite')
const featuresDirectory = config.get<string>('featuresDirectory') || '.kanban'
const featuresDir = path.join(workspaceFolders[0].uri.fsPath, featuresDirectory)
```
With:
```typescript
const root = workspaceFolders[0].uri.fsPath
const kanbanConfig = readConfig(root)
const featuresDir = path.join(root, kanbanConfig.featuresDirectory)
```

**Step 3: Replace config read in `createFeatureFromPrompts()`**

Replace lines 71-73:
```typescript
const config = vscode.workspace.getConfiguration('kanban-lite')
const featuresDirectory = config.get<string>('featuresDirectory') || '.kanban'
const featuresDir = path.join(workspaceFolders[0].uri.fsPath, featuresDirectory)
```
With:
```typescript
const root = workspaceFolders[0].uri.fsPath
const kanbanConfig = readConfig(root)
const featuresDir = path.join(root, kanbanConfig.featuresDirectory)
```

**Step 4: Commit**

```bash
git add src/extension/index.ts
git commit -m "refactor: extension index reads config from .kanban.json"
```

---

### Task 6: Update standalone/server.ts

**Files:**
- Modify: `src/standalone/server.ts`

The standalone server currently uses `.kanban-settings.json` inside the features directory. Replace this with the shared config module, but note the standalone receives `featuresDir` as a parameter — we need to derive the workspace root (parent of featuresDir) for config reading.

**Step 1: Add imports**

```typescript
import { readConfig, writeConfig, configToSettings, settingsToConfig, CONFIG_FILENAME } from '../shared/config'
import type { KanbanConfig } from '../shared/config'
```

**Step 2: Replace settings persistence logic**

Remove:
- `DEFAULT_COLUMNS` constant (lines 32-38)
- `DEFAULT_SETTINGS` constant (lines 40-51)
- `settingsFilePath` variable (line 64)
- `currentSettings` and `currentColumns` variables (lines 65-66)
- `loadSettings()` function (lines 68-82)
- `saveSettingsToFile()` function (lines 84-94)
- `saveColumns()` function (lines 96-108)
- `loadSettings()` call (line 110)

Replace with:
```typescript
// Derive workspace root from features directory
// The features dir is typically <root>/<featuresDirectory>, so go up one level
const workspaceRoot = path.dirname(absoluteFeaturesDir)

function getConfig(): KanbanConfig {
  return readConfig(workspaceRoot)
}

function saveConfig(config: KanbanConfig): void {
  writeConfig(workspaceRoot, config)
}
```

**Step 3: Update `buildInitMessage()`**

```typescript
function buildInitMessage(): unknown {
  const config = getConfig()
  const settings = configToSettings(config)
  settings.showBuildWithAI = false
  settings.markdownEditorMode = false
  return {
    type: 'init',
    features,
    columns: config.columns,
    settings
  }
}
```

**Step 4: Update `loadFeatures()`**

Replace `currentColumns.map(c => c.id)` with `getConfig().columns.map(c => c.id)` (2 occurrences — lines 131 and 244).

**Step 5: Update `saveSettings` handler**

Replace the `saveSettings` case:
```typescript
case 'saveSettings': {
  const newSettings = msg.settings as CardDisplaySettings
  const config = getConfig()
  const updated = settingsToConfig(config, newSettings)
  updated.showBuildWithAI = false
  updated.markdownEditorMode = false
  saveConfig(updated)
  broadcast(buildInitMessage())
  break
}
```

**Step 6: Update column handlers**

Replace `addColumn`, `editColumn`, `removeColumn` cases to use `getConfig()` / `saveConfig()`:
```typescript
case 'addColumn': {
  const col = msg.column as { name: string; color: string }
  const config = getConfig()
  const id = col.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  let uniqueId = id
  let counter = 1
  while (config.columns.some(c => c.id === uniqueId)) {
    uniqueId = `${id}-${counter++}`
  }
  config.columns.push({ id: uniqueId, name: col.name, color: col.color })
  saveConfig(config)
  broadcast(buildInitMessage())
  break
}

case 'editColumn': {
  const columnId = msg.columnId as string
  const updates = msg.updates as { name: string; color: string }
  const config = getConfig()
  if (!config.columns.some(c => c.id === columnId)) break
  config.columns = config.columns.map(c =>
    c.id === columnId ? { ...c, name: updates.name, color: updates.color } : c
  )
  saveConfig(config)
  broadcast(buildInitMessage())
  break
}

case 'removeColumn': {
  const columnId = msg.columnId as string
  const hasFeatures = features.some(f => f.status === columnId)
  if (hasFeatures) break
  const config = getConfig()
  const updated = config.columns.filter(c => c.id !== columnId)
  if (updated.length === 0) break
  config.columns = updated
  saveConfig(config)
  broadcast(buildInitMessage())
  break
}
```

**Step 7: Update `openSettings` handler**

```typescript
case 'openSettings': {
  const config = getConfig()
  const settings = configToSettings(config)
  settings.showBuildWithAI = false
  settings.markdownEditorMode = false
  ws.send(JSON.stringify({
    type: 'showSettings',
    settings
  }))
  break
}
```

**Step 8: Commit**

```bash
git add src/standalone/server.ts
git commit -m "refactor: standalone server uses shared .kanban.json config"
```

---

### Task 7: Remove contributes.configuration from package.json

**Files:**
- Modify: `package.json`

**Step 1: Remove the configuration section**

Remove the entire `"configuration": { ... }` block from `contributes` (lines 75-227). Keep `viewsContainers`, `views`, `commands`, and `menus`.

**Step 2: Verify build**

Run: `npm run build:extension`
Expected: Build succeeds without errors

**Step 3: Commit**

```bash
git add package.json
git commit -m "refactor: remove contributes.configuration, config now in .kanban.json"
```

---

### Task 8: Build and verify

**Step 1: Full build**

Run: `npm run build`
Expected: All builds succeed

**Step 2: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 3: Run type check**

Run: `npm run typecheck`
Expected: No type errors

**Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: resolve build/type issues from config migration"
```
