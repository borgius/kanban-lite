# Move Card to Another Board — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to move a card to a different board via the status dropdown (tree: current board statuses flat, other boards grouped below), and ensure the transfer operation is handled across all interfaces.

**Architecture:** Extend `BoardInfo` to include columns, build a `StatusDropdown` component that renders current board statuses flat then other boards as expandable groups, add a `transferCard` webview message, handle it in both extension and standalone server.

**Tech Stack:** TypeScript, React, Zustand, VSCode Extension API

---

### Task 1: Extend `BoardInfo` type and `transferCard` message

**Files:**
- Modify: `src/shared/types.ts:31-35` (BoardInfo interface)
- Modify: `src/shared/types.ts:118-141` (WebviewMessage union)

**Step 1: Add `columns` to `BoardInfo`**

In `src/shared/types.ts`, update the `BoardInfo` interface:

```typescript
export interface BoardInfo {
  id: string`
  name: string
  description?: string
  columns?: KanbanColumn[]
}
```

**Step 2: Add `transferCard` to `WebviewMessage`**

In the `WebviewMessage` union type in `src/shared/types.ts`, add a new variant after the `createBoard` line:

```typescript
  | { type: 'transferCard'; featureId: string; toBoard: string; targetStatus: string }
```

**Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: extend BoardInfo with columns, add transferCard message type"
```

---

### Task 2: Include columns in `listBoards()` return

**Files:**
- Modify: `src/sdk/KanbanSDK.ts:58-65` (listBoards method)

**Step 1: Update `listBoards()` to include columns**

In `src/sdk/KanbanSDK.ts`, update the `listBoards()` method:

```typescript
  listBoards(): BoardInfo[] {
    const config = readConfig(this.workspaceRoot)
    return Object.entries(config.boards).map(([id, board]) => ({
      id,
      name: board.name,
      description: board.description,
      columns: board.columns
    }))
  }
```

**Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS (no type errors)

**Step 3: Commit**

```bash
git add src/sdk/KanbanSDK.ts
git commit -m "feat: include columns in listBoards() return"
```

---

### Task 3: Build the `StatusDropdown` component in `FeatureEditor.tsx`

**Files:**
- Modify: `src/webview/components/FeatureEditor.tsx`

This is the main UI change. Replace the hardcoded status dropdown with a tree-structured dropdown.

**Step 1: Add the `StatusDropdown` component**

Add this new component in `FeatureEditor.tsx` after the existing `Dropdown` component (around line 168), before `PropertyRow`:

```tsx
interface StatusDropdownProps {
  value: string
  featureId: string
  onChange: (status: string) => void
  onTransferToBoard: (toBoard: string, targetStatus: string) => void
}

function StatusDropdown({ value, featureId, onChange, onTransferToBoard }: StatusDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const columns = useStore(s => s.columns)
  const boards = useStore(s => s.boards)
  const currentBoard = useStore(s => s.currentBoard)

  // Current board's columns as flat options
  const currentBoardColumns = columns

  // Other boards (exclude current)
  const otherBoards = boards.filter(b => b.id !== currentBoard)

  // Generate a dot color from column color
  const dotStyle = (color: string) => ({ backgroundColor: color })

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-2 py-1 text-xs font-medium rounded transition-colors vscode-hover-bg"
        style={{ color: 'var(--vscode-foreground)' }}
      >
        {(() => {
          const col = currentBoardColumns.find(c => c.id === value)
          return col ? (
            <>
              <span className="w-2 h-2 rounded-full shrink-0" style={dotStyle(col.color)} />
              <span>{col.name}</span>
            </>
          ) : (
            <span>{value}</span>
          )
        })()}
        <ChevronDown size={12} style={{ color: 'var(--vscode-descriptionForeground)' }} className="ml-0.5" />
      </button>
      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div
            className="absolute top-full left-0 mt-1 z-20 rounded-lg shadow-lg py-1 min-w-[180px] max-h-[320px] overflow-y-auto"
            style={{
              background: 'var(--vscode-dropdown-background)',
              border: '1px solid var(--vscode-dropdown-border, var(--vscode-panel-border))',
            }}
          >
            {/* Current board statuses (flat) */}
            {currentBoardColumns.map(col => (
              <button
                key={col.id}
                onClick={() => {
                  onChange(col.id)
                  setIsOpen(false)
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors"
                style={{
                  color: 'var(--vscode-dropdown-foreground)',
                  background: col.id === value ? 'var(--vscode-list-activeSelectionBackground)' : undefined,
                }}
                onMouseEnter={e => {
                  if (col.id !== value) e.currentTarget.style.background = 'var(--vscode-list-hoverBackground)'
                }}
                onMouseLeave={e => {
                  if (col.id !== value) e.currentTarget.style.background = 'transparent'
                }}
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={dotStyle(col.color)} />
                <span className="flex-1 text-left">{col.name}</span>
                {col.id === value && <Check size={12} style={{ color: 'var(--vscode-focusBorder)' }} className="shrink-0" />}
              </button>
            ))}

            {/* Other boards section */}
            {otherBoards.length > 0 && (
              <>
                <div
                  className="mx-2 my-1"
                  style={{ borderTop: '1px solid var(--vscode-panel-border)' }}
                />
                <div
                  className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider"
                  style={{ color: 'var(--vscode-descriptionForeground)' }}
                >
                  Move to...
                </div>
                {otherBoards.map(board => (
                  <div key={board.id}>
                    <div
                      className="px-3 py-1 text-[10px] font-semibold"
                      style={{ color: 'var(--vscode-descriptionForeground)' }}
                    >
                      {board.name}
                    </div>
                    {(board.columns || []).map(col => (
                      <button
                        key={`${board.id}-${col.id}`}
                        onClick={() => {
                          onTransferToBoard(board.id, col.id)
                          setIsOpen(false)
                        }}
                        className="w-full flex items-center gap-2 pl-5 pr-3 py-1.5 text-xs transition-colors"
                        style={{ color: 'var(--vscode-dropdown-foreground)' }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'var(--vscode-list-hoverBackground)' }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                      >
                        <span className="w-2 h-2 rounded-full shrink-0" style={dotStyle(col.color)} />
                        <span className="flex-1 text-left">{col.name}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
```

**Step 2: Add `onTransferToBoard` prop to `FeatureEditorProps`**

Add to the `FeatureEditorProps` interface (around line 11-28):

```typescript
  onTransferToBoard: (toBoard: string, targetStatus: string) => void
```

**Step 3: Replace the status `Dropdown` usage with `StatusDropdown`**

In the metadata section (around line 519-524), replace:

```tsx
        <PropertyRow label="Status" icon={<CircleDot size={13} />}>
          <Dropdown
            value={currentFrontmatter.status}
            options={statuses.map(s => ({ value: s, label: statusLabels[s], dot: statusDots[s] }))}
            onChange={(v) => handleFrontmatterUpdate({ status: v as FeatureStatus })}
          />
        </PropertyRow>
```

With:

```tsx
        <PropertyRow label="Status" icon={<CircleDot size={13} />}>
          <StatusDropdown
            value={currentFrontmatter.status}
            featureId={featureId}
            onChange={(v) => handleFrontmatterUpdate({ status: v as FeatureStatus })}
            onTransferToBoard={onTransferToBoard}
          />
        </PropertyRow>
```

**Step 4: Destructure the new prop in the component function**

In the `FeatureEditor` function signature, add `onTransferToBoard` to the destructured props.

**Step 5: Remove the hardcoded `statusLabels`, `statuses`, and `statusDots` constants**

These are no longer needed since `StatusDropdown` reads columns from the store. The `priorityLabels`, `priorities`, and `priorityDots` remain as they are still used by the priority dropdown.

**Step 6: Run type check**

Run: `npx tsc --noEmit`
Expected: FAIL — `App.tsx` doesn't pass `onTransferToBoard` yet. That's next.

**Step 7: Commit**

```bash
git add src/webview/components/FeatureEditor.tsx
git commit -m "feat: add StatusDropdown component with board tree structure"
```

---

### Task 4: Wire up `onTransferToBoard` in App.tsx

**Files:**
- Modify: `src/webview/App.tsx`

**Step 1: Add the transfer handler**

After `handleSaveFeature` (around line 263-271), add:

```typescript
  const handleTransferToBoard = (toBoard: string, targetStatus: string): void => {
    if (!editingFeature) return
    vscode.postMessage({
      type: 'transferCard',
      featureId: editingFeature.id,
      toBoard,
      targetStatus
    })
    setEditingFeature(null)
  }
```

**Step 2: Pass the prop to `FeatureEditor`**

In the `<FeatureEditor>` JSX (around line 442-459), add the new prop:

```tsx
              onTransferToBoard={handleTransferToBoard}
```

Add it after the `onDeleteComment` prop.

**Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: FAIL — extension and standalone don't handle the message yet. That's next.

**Step 4: Commit**

```bash
git add src/webview/App.tsx
git commit -m "feat: wire up transferCard message in App.tsx"
```

---

### Task 5: Handle `transferCard` in extension

**Files:**
- Modify: `src/extension/KanbanPanel.ts`

**Step 1: Add `transferCard` case to the message handler**

In the `onDidReceiveMessage` switch statement (after the `switchBoard` case, around line 196-200), add:

```typescript
          case 'transferCard': {
            const sdk = this._getSDK()
            if (!sdk) break
            this._migrating = true
            try {
              await sdk.transferCard(
                message.featureId,
                this._currentBoardId,
                message.toBoard,
                message.targetStatus
              )
              this._currentEditingFeatureId = null
              await this._loadFeatures()
              this._sendFeaturesToWebview()
            } catch (err) {
              vscode.window.showErrorMessage(`Failed to transfer card: ${err}`)
            } finally {
              this._migrating = false
            }
            break
          }
```

**Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS or minor issues to fix

**Step 3: Commit**

```bash
git add src/extension/KanbanPanel.ts
git commit -m "feat: handle transferCard message in extension"
```

---

### Task 6: Handle `transferCard` in standalone server WebSocket handler

**Files:**
- Modify: `src/standalone/server.ts`

**Step 1: Add `transferCard` case to the WebSocket message handler**

In the `handleMessage` function's switch statement (after the `switchBoard` case, around line 528-536), add:

```typescript
      case 'transferCard': {
        const featureId = msg.featureId as string
        const toBoard = msg.toBoard as string
        const targetStatus = msg.targetStatus as string
        migrating = true
        try {
          const card = await sdk.transferCard(featureId, currentBoardId, toBoard, targetStatus)
          await loadFeatures()
          broadcast(buildInitMessage())
          fireWebhooks(workspaceRoot, 'task.moved', sanitizeFeature(card))
        } catch (err) {
          console.error('Failed to transfer card:', err)
        } finally {
          migrating = false
        }
        break
      }
```

**Step 2: Run type check and tests**

Run: `npx tsc --noEmit && npm test`
Expected: PASS

**Step 3: Commit**

```bash
git add src/standalone/server.ts
git commit -m "feat: handle transferCard in standalone WebSocket handler"
```

---

### Task 7: Build and verify

**Step 1: Build everything**

Run: `npm run build`
Expected: PASS

**Step 2: Run tests**

Run: `npm test`
Expected: PASS

**Step 3: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "feat: move card to another board from status dropdown"
```
