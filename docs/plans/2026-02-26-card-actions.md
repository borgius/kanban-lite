# Card Actions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add per-card actions (simple string labels) that trigger a global `actionWebhookUrl` configured in `.kanban.json`, with a Run Action dropdown in the card editor and support across SDK, REST API, WebSocket, MCP, CLI, and extension.

**Architecture:** Actions are stored as a `string[]` field on each card's YAML frontmatter. A single global `actionWebhookUrl` in `.kanban.json` receives a `POST { action, board, list, card }` when triggered. The SDK gains a `triggerAction` method; the server, MCP, CLI, and extension all call through it. The webview sends a `triggerAction` WebSocket/postMessage; the standalone shim intercepts it to call the REST endpoint directly.

**Tech Stack:** TypeScript, React, Vitest, existing KanbanSDK patterns, Node.js `fetch` (18+).

---

### Task 1: Data types

**Files:**
- Modify: `src/shared/types.ts:79` (Feature), `src/shared/types.ts:298` (FeatureFrontmatter), `src/shared/types.ts:322` (WebviewMessage createFeature), `src/shared/types.ts:349`
- Modify: `src/shared/config.ts:92` (KanbanConfig)
- Modify: `src/sdk/types.ts:24` (CreateCardInput)

**Step 1: Add `actions` to `Feature` (after `metadata` on line 79)**

In `src/shared/types.ts`, after:
```typescript
  /** Arbitrary user-defined metadata stored as YAML in the frontmatter. */
  metadata?: Record<string, any>
```
Add:
```typescript
  /** Named action strings that can be triggered via the action webhook. */
  actions?: string[]
```

**Step 2: Add `actions` to `FeatureFrontmatter` (after `metadata` on line 298)**

In `src/shared/types.ts`, after:
```typescript
  /** Arbitrary user-defined metadata stored as YAML in the frontmatter. */
  metadata?: Record<string, any>
```
Add:
```typescript
  /** Named action strings that can be triggered via the action webhook. */
  actions?: string[]
```

**Step 3: Update `WebviewMessage` `createFeature` type (line 322)**

Change:
```typescript
  | { type: 'createFeature'; data: { status: string; priority: Priority; content: string; assignee: string | null; dueDate: string | null; labels: string[]; metadata?: Record<string, any> } }
```
To:
```typescript
  | { type: 'createFeature'; data: { status: string; priority: Priority; content: string; assignee: string | null; dueDate: string | null; labels: string[]; metadata?: Record<string, any>; actions?: string[] } }
```

**Step 4: Add `triggerAction` to `WebviewMessage` (line 349, before the closing `|`)**

Add:
```typescript
  | { type: 'triggerAction'; featureId: string; action: string; callbackKey: string }
```

**Step 5: Add `actionResult` to `ExtensionMessage` (line 313)**

Change the `ExtensionMessage` type to add at end:
```typescript
  | { type: 'actionResult'; callbackKey: string; error?: string }
```

**Step 6: Add `actionWebhookUrl` to `KanbanConfig` (after `labels` on line 92)**

In `src/shared/config.ts`, after:
```typescript
  /** Label definitions keyed by label name, with color and optional group. */
  labels?: Record<string, LabelDefinition>
```
Add:
```typescript
  /** Optional URL to POST to when a card action is triggered. */
  actionWebhookUrl?: string
```

**Step 7: Add `actions` to `CreateCardInput` (after `metadata` on line 24)**

In `src/sdk/types.ts`, after:
```typescript
  /** Arbitrary user-defined metadata to store in the card's frontmatter. */
  metadata?: Record<string, any>
```
Add:
```typescript
  /** Named action strings that can be triggered via the action webhook. */
  actions?: string[]
```

**Step 8: No tests needed — pure type changes. Verify with type-check.**

Run: `npx tsc --noEmit`
Expected: No errors (all new fields are optional).

**Step 9: Commit**

```bash
git add src/shared/types.ts src/shared/config.ts src/sdk/types.ts
git commit -m "feat(actions): add actions field to types and config"
```

---

### Task 2: Parser — serialize and parse `actions`

**Files:**
- Modify: `src/sdk/parser.ts`

**Step 1: Write the failing test**

In `src/sdk/__tests__/KanbanSDK.test.ts`, add this test inside the top-level `describe('KanbanSDK')` block:

```typescript
describe('actions', () => {
  it('should persist and reload actions', async () => {
    await sdk.init()
    const card = await sdk.createCard({
      content: '# Action Card',
      actions: ['retry', 'sendEmail'],
    })
    expect(card.actions).toEqual(['retry', 'sendEmail'])

    // Reload to verify round-trip through parser
    const reloaded = await sdk.getCard(card.id)
    expect(reloaded?.actions).toEqual(['retry', 'sendEmail'])
  })

  it('should omit actions from frontmatter when empty', async () => {
    await sdk.init()
    const card = await sdk.createCard({ content: '# No Actions' })
    const reloaded = await sdk.getCard(card.id)
    expect(reloaded?.actions).toBeUndefined()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --reporter=verbose 2>&1 | grep -A5 "actions"`
Expected: FAIL — `card.actions` is undefined.

**Step 3: Parse `actions` in `parseFeatureFile` (src/sdk/parser.ts)**

After the `getArrayValue` helper (line 63), add a `getActionsValue` helper that uses the same inline-array pattern `getArrayValue` uses. Actually, since `getArrayValue` already works for the inline format `[a, b, c]`, we can use it directly.

In `parseFeatureFile`, in the returned object (line 115), after:
```typescript
    ...(meta ? { metadata: meta } : {}),
```
Add:
```typescript
    ...(getArrayValue('actions').length > 0 ? { actions: getArrayValue('actions') } : {}),
```

**Step 4: Serialize `actions` in `serializeFeature` (src/sdk/parser.ts)**

In `serializeFeature` (line 144), after:
```typescript
    `order: "${feature.order}"`,
```
Add:
```typescript
    ...(feature.actions && feature.actions.length > 0
      ? [`actions: [${feature.actions.map(a => `"${a}"`).join(', ')}]`]
      : []),
```

Note: `lines.push(...)` uses spread on the push call or push each. Use:
```typescript
    if (feature.actions && feature.actions.length > 0) {
      lines.push(`actions: [${feature.actions.map(a => `"${a}"`).join(', ')}]`)
    }
```
Place this block after `order` and before the `metadata` block.

**Step 5: Run test to verify it passes**

Run: `npm test -- --reporter=verbose 2>&1 | grep -A5 "actions"`
Expected: PASS

**Step 6: Commit**

```bash
git add src/sdk/parser.ts src/sdk/__tests__/KanbanSDK.test.ts
git commit -m "feat(actions): parse and serialize actions in frontmatter"
```

---

### Task 3: SDK — `createCard` + `triggerAction`

**Files:**
- Modify: `src/sdk/KanbanSDK.ts`

**Step 1: Write the failing test for `triggerAction`**

Add to `src/sdk/__tests__/KanbanSDK.test.ts`:

```typescript
describe('triggerAction', () => {
  it('should throw if no actionWebhookUrl is configured', async () => {
    await sdk.init()
    const card = await sdk.createCard({ content: '# Card', actions: ['retry'] })
    await expect(sdk.triggerAction(card.id, 'retry')).rejects.toThrow('No action webhook URL configured')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --reporter=verbose 2>&1 | grep -A5 "triggerAction"`
Expected: FAIL — `sdk.triggerAction` is not a function.

**Step 3: Update `createCard` to pass through `actions`**

In `src/sdk/KanbanSDK.ts`, in the `card` object constructor (around line 626), after:
```typescript
      ...(data.metadata && Object.keys(data.metadata).length > 0 ? { metadata: data.metadata } : {}),
```
Add:
```typescript
      ...(data.actions && data.actions.length > 0 ? { actions: data.actions } : {}),
```

**Step 4: Add `triggerAction` method to `KanbanSDK`**

Add this method after `updateCard` (around line 713). Insert before the `moveCard` method:

```typescript
  /**
   * Triggers a named action for a card by POSTing to the global `actionWebhookUrl`
   * configured in `.kanban.json`.
   *
   * @param cardId - The ID of the card to trigger the action for.
   * @param action - The action name string to send (e.g. `'retry'`, `'sendEmail'`).
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise that resolves when the webhook responds with 2xx.
   * @throws {Error} If no `actionWebhookUrl` is configured in `.kanban.json`.
   * @throws {Error} If the card is not found.
   * @throws {Error} If the webhook responds with a non-2xx status.
   *
   * @example
   * ```ts
   * await sdk.triggerAction('42', 'retry')
   * await sdk.triggerAction('42', 'sendEmail', 'bugs')
   * ```
   */
  async triggerAction(cardId: string, action: string, boardId?: string): Promise<void> {
    const config = readConfig(this.workspaceRoot)
    const { actionWebhookUrl } = config
    if (!actionWebhookUrl) {
      throw new Error('No action webhook URL configured. Set actionWebhookUrl in .kanban.json')
    }

    const card = await this.getCard(cardId, boardId)
    if (!card) throw new Error(`Card not found: ${cardId}`)

    const resolvedBoardId = card.boardId || this._resolveBoardId(boardId)

    const payload = {
      action,
      board: resolvedBoardId,
      list: card.status,
      card: sanitizeFeature(card),
    }

    const response = await fetch(actionWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      throw new Error(`Action webhook responded with ${response.status}: ${response.statusText}`)
    }
  }
```

**Step 5: Run tests**

Run: `npm test`
Expected: All pass.

**Step 6: Commit**

```bash
git add src/sdk/KanbanSDK.ts src/sdk/__tests__/KanbanSDK.test.ts
git commit -m "feat(actions): add triggerAction to SDK and pass actions through createCard"
```

---

### Task 4: REST API

**Files:**
- Modify: `src/standalone/server.ts`

**Step 1: Update `POST /api/tasks` to pass `actions` (around line 923)**

In the `POST /api/tasks` handler, in `CreateFeatureData`:
Add `actions: (body.actions as string[]) || undefined,` after `metadata`.

Also update the `POST /api/boards/:boardId/tasks` handler (around line 791) the same way.

Locate the line:
```typescript
          metadata: body.metadata as Record<string, any> | undefined,
          boardId,
```
After `metadata`, add:
```typescript
          actions: body.actions as string[] | undefined,
```

Do this for both board-specific and default board `POST` handlers.

**Step 2: Update `CreateFeatureData` type in server.ts**

Near the top of the server where `CreateFeatureData` is defined (search for it), add `actions?: string[]` field.

Run: `grep -n "CreateFeatureData" src/standalone/server.ts`

Find the interface/type and add `actions?: string[]`.

**Step 3: Update `doCreateFeature` to pass `actions`**

Find the `doCreateFeature` function that calls `sdk.createCard`. Add `actions: data.actions` to the `createCard` call.

**Step 4: Update `openFeature` WebSocket handler to include `actions` in frontmatter (around line 460)**

Change:
```typescript
          const frontmatter: FeatureFrontmatter = {
            id: feature.id, status: feature.status, priority: feature.priority,
            assignee: feature.assignee, dueDate: feature.dueDate, created: feature.created,
            modified: feature.modified, completedAt: feature.completedAt,
            labels: feature.labels, attachments: feature.attachments, order: feature.order,
            metadata: feature.metadata
          }
```
To:
```typescript
          const frontmatter: FeatureFrontmatter = {
            id: feature.id, status: feature.status, priority: feature.priority,
            assignee: feature.assignee, dueDate: feature.dueDate, created: feature.created,
            modified: feature.modified, completedAt: feature.completedAt,
            labels: feature.labels, attachments: feature.attachments, order: feature.order,
            metadata: feature.metadata,
            actions: feature.actions,
          }
```

Do the same for every place that constructs a `FeatureFrontmatter` object in `server.ts` (there are multiple — search for `FeatureFrontmatter` and update each).

**Step 5: Add `POST /api/tasks/:id/actions/:action` endpoint**

After the `PATCH /api/tasks/:id/move` block (around line 979), add:

```typescript
    params = route('POST', '/api/tasks/:id/actions/:action')
    if (params) {
      try {
        const { id, action } = params
        await sdk.triggerAction(id, action)
        res.writeHead(204)
        res.end()
        return
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }
```

**Step 6: Add `POST /api/boards/:boardId/tasks/:id/actions/:action` endpoint**

After the `PATCH /api/boards/:boardId/tasks/:id/move` block (around line 838), add:

```typescript
    params = route('POST', '/api/boards/:boardId/tasks/:id/actions/:action')
    if (params) {
      try {
        const { boardId, id, action } = params
        await sdk.triggerAction(id, action, boardId)
        res.writeHead(204)
        res.end()
        return
      } catch (err) {
        return jsonError(res, 400, String(err))
      }
    }
```

**Step 7: Add `case 'triggerAction'` in WebSocket `handleMessage` (around line 410)**

After the last `case` in `handleMessage`, add:

```typescript
      case 'triggerAction': {
        const { featureId, action, callbackKey } = msg as { featureId: string; action: string; callbackKey: string }
        try {
          await sdk.triggerAction(featureId, action)
          ws.send(JSON.stringify({ type: 'actionResult', callbackKey }))
        } catch (err) {
          ws.send(JSON.stringify({ type: 'actionResult', callbackKey, error: String(err) }))
        }
        break
      }
```

**Step 8: Update `saveFeatureContent` to include `actions` (around line 471)**

Change:
```typescript
        await doUpdateFeature(featureId, {
          content: newContent,
          status: fm.status,
          priority: fm.priority,
          assignee: fm.assignee,
          dueDate: fm.dueDate,
          labels: fm.labels,
          attachments: fm.attachments,
        })
```
To:
```typescript
        await doUpdateFeature(featureId, {
          content: newContent,
          status: fm.status,
          priority: fm.priority,
          assignee: fm.assignee,
          dueDate: fm.dueDate,
          labels: fm.labels,
          attachments: fm.attachments,
          actions: fm.actions,
        })
```

**Step 9: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 10: Commit**

```bash
git add src/standalone/server.ts
git commit -m "feat(actions): add REST endpoints and WebSocket handler for triggerAction"
```

---

### Task 5: MCP server

**Files:**
- Modify: `src/mcp-server/index.ts`

**Step 1: Add `actions` param to `create_card` tool (around line 230)**

After:
```typescript
      metadata: z.record(z.string(), z.any()).optional().describe('Custom metadata as key-value pairs (supports nested objects)'),
```
Add:
```typescript
      actions: z.array(z.string()).optional().describe('Named actions that can be triggered for this card'),
```

Update the handler (around line 232) to destructure `actions` and pass it to `sdk.createCard`:
```typescript
    async ({ boardId, title, body, status, priority, assignee, dueDate, labels, metadata, actions }) => {
      const content = `# ${title}${body ? '\n\n' + body : ''}`
      const card = await sdk.createCard({
        content,
        status: status || undefined,
        priority: priority as Priority | undefined,
        assignee: assignee || null,
        dueDate: dueDate || null,
        labels: labels || [],
        metadata,
        actions,
        boardId,
      })
```

**Step 2: Add `actions` param to `update_card` tool (around line 267)**

After:
```typescript
      metadata: z.record(z.string(), z.any()).optional().describe('Custom metadata as key-value pairs (replaces existing)'),
```
Add:
```typescript
      actions: z.array(z.string()).optional().describe('Named actions (replaces existing)'),
```

Update the handler to include `actions` in updates:
```typescript
      if (actions !== undefined) updates.actions = actions
```

**Step 3: Add `trigger_action` tool after `update_card`**

```typescript
  server.tool(
    'trigger_action',
    'Trigger a named action for a card. Posts to the actionWebhookUrl configured in .kanban.json.',
    {
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
      cardId: z.string().describe('Card ID (or partial ID)'),
      action: z.string().describe('Action name to trigger (e.g. "retry", "sendEmail")'),
    },
    async ({ boardId, cardId, action }) => {
      try {
        await sdk.triggerAction(cardId, action, boardId)
        return {
          content: [{ type: 'text' as const, text: `Action "${action}" triggered for card ${cardId}` }],
        }
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: String(err) }],
          isError: true,
        }
      }
    }
  )
```

**Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 5: Commit**

```bash
git add src/mcp-server/index.ts
git commit -m "feat(actions): add actions support and trigger_action tool to MCP server"
```

---

### Task 6: CLI

**Files:**
- Modify: `src/cli/index.ts`

**Step 1: Update `cmdAdd` to support `--actions` flag (after line 316)**

After the `metadata` parsing block in `cmdAdd`, add:
```typescript
  let actions: string[] | undefined
  if (typeof flags.actions === 'string') {
    try {
      actions = JSON.parse(flags.actions)
      if (!Array.isArray(actions)) throw new Error('not an array')
    } catch {
      console.error(red('Error: --actions must be a valid JSON array, e.g. \'["retry","sendEmail"]\''))
      process.exit(1)
    }
  }
```

Pass to `sdk.createCard`:
```typescript
  const card = await sdk.createCard({ content, status, priority, assignee, dueDate, labels, metadata, actions, boardId })
```

**Step 2: Update `cmdEdit` to support `--actions` flag (after line 393)**

After the `metadata` parsing block in `cmdEdit`, add:
```typescript
  if (typeof flags.actions === 'string') {
    try {
      updates.actions = JSON.parse(flags.actions)
      if (!Array.isArray(updates.actions)) throw new Error('not an array')
    } catch {
      console.error(red('Error: --actions must be a valid JSON array'))
      process.exit(1)
    }
  }
```

Also update the error message at line 396 to include `--actions`:
```typescript
    console.error(red('No updates specified. Use --status, --priority, --assignee, --due, --label, --metadata, or --actions'))
```

**Step 3: Add `action` command**

Add a new `cmdAction` function:

```typescript
async function cmdAction(sdk: KanbanSDK, positional: string[], flags: Flags): Promise<void> {
  const subcommand = positional[0]
  if (subcommand !== 'trigger') {
    console.error(red('Usage: kl action trigger <cardId> <action> [--board <boardId>]'))
    process.exit(1)
  }
  const cardId = positional[1]
  const action = positional[2]
  if (!cardId || !action) {
    console.error(red('Usage: kl action trigger <cardId> <action> [--board <boardId>]'))
    process.exit(1)
  }
  const boardId = getBoardId(flags)
  await sdk.triggerAction(cardId, action, boardId)
  console.log(green(`Action "${action}" triggered for card ${cardId}`))
}
```

In the `main` switch statement (around line 1309), add before `default`:
```typescript
    case 'action':
      await cmdAction(sdk, positional, flags)
      break
```

**Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 5: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat(actions): add --actions flag and action trigger command to CLI"
```

---

### Task 7: VSCode Extension

**Files:**
- Modify: `src/extension/KanbanPanel.ts`

**Step 1: Update `_createFeature` to pass `actions` (around line 476)**

Change:
```typescript
      const feature = await sdk.createCard({
        content: data.content,
        status: data.status,
        priority: data.priority,
        assignee: data.assignee ?? undefined,
        dueDate: data.dueDate ?? undefined,
        labels: data.labels,
        boardId: this._currentBoardId
      })
```
To:
```typescript
      const feature = await sdk.createCard({
        content: data.content,
        status: data.status,
        priority: data.priority,
        assignee: data.assignee ?? undefined,
        dueDate: data.dueDate ?? undefined,
        labels: data.labels,
        actions: data.actions,
        boardId: this._currentBoardId
      })
```

**Step 2: Update all `FeatureFrontmatter` construction in KanbanPanel.ts to include `actions`**

Run: `grep -n "FeatureFrontmatter" src/extension/KanbanPanel.ts`

For every object literal assigned to `FeatureFrontmatter`, add `actions: feature.actions` after `metadata`.

**Step 3: Update `_saveFeatureContent` to include `actions` in updates**

Find the `_saveFeatureContent` method and add `actions: fm.actions` to the update object, following the same pattern as Task 4 Step 8.

**Step 4: Add `case 'triggerAction'` in the message handler (around line 100)**

After the last `case` in the `switch (message.type)` block, add:
```typescript
          case 'triggerAction': {
            const sdk = this._getSDK()
            const { featureId, action, callbackKey } = message as { featureId: string; action: string; callbackKey: string }
            if (!sdk) {
              this._panel?.webview.postMessage({ type: 'actionResult', callbackKey, error: 'No workspace folder open' })
              break
            }
            sdk.triggerAction(featureId, action, this._currentBoardId)
              .then(() => {
                this._panel?.webview.postMessage({ type: 'actionResult', callbackKey })
              })
              .catch((err: Error) => {
                this._panel?.webview.postMessage({ type: 'actionResult', callbackKey, error: String(err) })
              })
            break
          }
```

**Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 6: Commit**

```bash
git add src/extension/KanbanPanel.ts
git commit -m "feat(actions): handle triggerAction in VSCode extension"
```

---

### Task 8: Standalone shim — intercept triggerAction

**Files:**
- Modify: `src/webview/standalone-shim.ts`

**Step 1: Add `triggerAction` intercept in `postMessage` (around line 91)**

In the `postMessage` function, after the `openAttachment` intercept, add:

```typescript
    if (msg.type === 'triggerAction') {
      const { featureId, action, callbackKey } = msg as { featureId: string; action: string; callbackKey: string }
      fetch(`/api/tasks/${encodeURIComponent(featureId)}/actions/${encodeURIComponent(action)}`, {
        method: 'POST',
      }).then(res => {
        if (res.ok) {
          window.postMessage({ type: 'actionResult', callbackKey }, '*')
        } else {
          res.text().then(text => {
            window.postMessage({ type: 'actionResult', callbackKey, error: text || `HTTP ${res.status}` }, '*')
          })
        }
      }).catch(err => {
        window.postMessage({ type: 'actionResult', callbackKey, error: String(err) }, '*')
      })
      return
    }
```

**Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/webview/standalone-shim.ts
git commit -m "feat(actions): intercept triggerAction in standalone shim"
```

---

### Task 9: CreateFeatureDialog UI

**Files:**
- Modify: `src/webview/components/CreateFeatureDialog.tsx`

**Step 1: Update `CreateFeatureDialogProps.onCreate` to include `actions`**

Change (line 12):
```typescript
  onCreate: (data: { status: FeatureStatus; priority: Priority; content: string; assignee: string | null; dueDate: string | null; labels: string[] }) => void
```
To:
```typescript
  onCreate: (data: { status: FeatureStatus; priority: Priority; content: string; assignee: string | null; dueDate: string | null; labels: string[]; actions: string[] }) => void
```

**Step 2: Add `ActionsInput` component** (after `LabelInput`, around line 294)

Model it after `LabelInput` but without label definitions/colors (just plain tag chips). Add after the closing `}` of `LabelInput`:

```typescript
function ActionsInput({ actions, onChange }: { actions: string[]; onChange: (actions: string[]) => void }) {
  const [newAction, setNewAction] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const addAction = () => {
    const a = newAction.trim()
    if (a && !actions.includes(a)) {
      onChange([...actions, a])
    }
    setNewAction('')
  }

  return (
    <div
      className="flex items-center gap-1.5 flex-wrap cursor-text"
      onClick={() => inputRef.current?.focus()}
    >
      {actions.map(action => (
        <span
          key={action}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded"
          style={{
            background: 'var(--vscode-badge-background)',
            color: 'var(--vscode-badge-foreground)',
          }}
        >
          {action}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onChange(actions.filter(a => a !== action)) }}
            className="hover:text-red-500 transition-colors"
          >
            <X size={9} />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        value={newAction}
        onChange={(e) => setNewAction(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addAction() }
          if (e.key === 'Backspace' && !newAction && actions.length > 0) {
            onChange(actions.slice(0, -1))
          }
          if (e.key === 'Escape') { setNewAction(''); inputRef.current?.blur() }
        }}
        placeholder={actions.length === 0 ? 'Add actions...' : ''}
        className="flex-1 min-w-[80px] bg-transparent border-none outline-none text-xs"
        style={{ color: 'var(--vscode-foreground)' }}
      />
    </div>
  )
}
```

**Step 3: Add `actions` state and `Zap` icon import**

At the top of `CreateFeatureDialogContent` function (around line 326), add:
```typescript
  const [actions, setActions] = useState<string[]>([])
```

Add `Zap` to the lucide-react import at line 2:
```typescript
import { X, ChevronDown, User, Tag, Check, CircleDot, Signal, Calendar, Zap } from 'lucide-react'
```

**Step 4: Add Actions `PropertyRow` in the metadata section (after Labels row, around line 447)**

After the Labels `PropertyRow`:
```typescript
          <PropertyRow label="Actions" icon={<Zap size={13} />}>
            <ActionsInput actions={actions} onChange={setActions} />
          </PropertyRow>
```

**Step 5: Pass `actions` in `handleSubmit` (around line 348)**

Change:
```typescript
    onCreate({ status, priority, content, assignee: assignee.trim() || null, dueDate: dueDate || null, labels })
```
To:
```typescript
    onCreate({ status, priority, content, assignee: assignee.trim() || null, dueDate: dueDate || null, labels, actions })
```

**Step 6: Build and verify**

Run: `npm run build 2>&1 | tail -20`
Expected: No errors.

**Step 7: Commit**

```bash
git add src/webview/components/CreateFeatureDialog.tsx
git commit -m "feat(actions): add ActionsInput to CreateFeatureDialog"
```

---

### Task 10: FeatureEditor UI

**Files:**
- Modify: `src/webview/components/FeatureEditor.tsx`

**Step 1: Add `onTriggerAction` prop**

In `FeatureEditorProps` interface (around line 12), add after `onTransferToBoard`:
```typescript
  onTriggerAction: (featureId: string, action: string) => Promise<void>
```

Update the function signature at line 543 to include `onTriggerAction`.

**Step 2: Add `Zap` to imports**

Change the lucide-react import line to include `Zap`:
```typescript
import { X, User, ChevronDown, Wand2, Tag, Plus, Check, CircleDot, Signal, Calendar, Trash2, FileText, Paperclip, Clock, Zap } from 'lucide-react'
```

**Step 3: Add `RunActionDropdown` component** (before `FeatureEditor` export, around line 543)

```typescript
function RunActionDropdown({ actions, onTrigger }: { actions: string[]; onTrigger: (action: string) => void }) {
  const [isOpen, setIsOpen] = useState(false)
  const [actionState, setActionState] = useState<{ action: string; status: 'loading' | 'success' | 'error'; error?: string } | null>(null)

  const handleSelect = (action: string) => {
    setIsOpen(false)
    setActionState({ action, status: 'loading' })
    onTrigger(action)
  }

  // actionState is set by parent via onTrigger Promise; parent calls handleActionResult
  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-1.5 px-2 rounded border transition-colors vscode-hover-bg flex items-center gap-1"
        style={{ color: 'var(--vscode-descriptionForeground)', borderColor: 'var(--vscode-widget-border, var(--vscode-contrastBorder, rgba(128,128,128,0.35)))' }}
        title="Run action"
      >
        <Zap size={14} />
        <span className="text-xs">RUN</span>
        <ChevronDown size={11} />
      </button>
      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div
            className="absolute top-full right-0 mt-1 z-20 rounded-lg shadow-lg py-1 min-w-[140px]"
            style={{
              background: 'var(--vscode-dropdown-background)',
              border: '1px solid var(--vscode-dropdown-border, var(--vscode-panel-border))',
            }}
          >
            {actions.map(action => (
              <button
                key={action}
                onClick={() => handleSelect(action)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors"
                style={{ color: 'var(--vscode-dropdown-foreground)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--vscode-list-hoverBackground)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                {action}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
```

Note: The `RunActionDropdown` needs to show loading/success/error. Since `onTrigger` needs to be async (Promise-based), restructure:

The `onTrigger` prop will be `(action: string) => Promise<void>`. The component calls `await onTrigger(action)` inside an async handler with `try/catch`, and manages `actionState` locally.

Replace `handleSelect` in the component:

```typescript
  const handleSelect = async (action: string) => {
    setIsOpen(false)
    setActionState({ action, status: 'loading' })
    try {
      await onTrigger(action)
      setActionState({ action, status: 'success' })
      setTimeout(() => setActionState(null), 2000)
    } catch (err) {
      setActionState({ action, status: 'error', error: String(err) })
      setTimeout(() => setActionState(null), 3000)
    }
  }
```

Add a small status indicator near the button (below or inline):
```typescript
      {actionState && (
        <div
          className="absolute top-full right-0 mt-1 z-30 px-2 py-1 rounded text-[10px] whitespace-nowrap"
          style={{
            background: actionState.status === 'error' ? 'var(--vscode-inputValidation-errorBackground)' : 'var(--vscode-badge-background)',
            color: actionState.status === 'error' ? 'var(--vscode-inputValidation-errorForeground)' : 'var(--vscode-badge-foreground)',
            border: actionState.status === 'error' ? '1px solid var(--vscode-inputValidation-errorBorder)' : 'none',
          }}
        >
          {actionState.status === 'loading' && `Running ${actionState.action}…`}
          {actionState.status === 'success' && `✓ ${actionState.action} triggered`}
          {actionState.status === 'error' && (actionState.error || 'Error')}
        </div>
      )}
```

Change `onTrigger` prop type to `(action: string) => Promise<void>`.

**Step 4: Add `RunActionDropdown` in the header (around line 701)**

In the right side of the header (`<div className="flex items-center gap-2">`), add before `AIDropdown`:

```typescript
          {(currentFrontmatter.actions?.length ?? 0) > 0 && (
            <RunActionDropdown
              actions={currentFrontmatter.actions!}
              onTrigger={(action) => onTriggerAction(featureId, action)}
            />
          )}
```

**Step 5: Build and verify**

Run: `npm run build 2>&1 | tail -20`
Expected: No errors.

**Step 6: Commit**

```bash
git add src/webview/components/FeatureEditor.tsx
git commit -m "feat(actions): add RunActionDropdown to FeatureEditor header"
```

---

### Task 11: App.tsx — wire up triggerAction

**Files:**
- Modify: `src/webview/App.tsx`

**Step 1: Add pending callbacks ref and `handleTriggerAction`**

In `App.tsx`, after the existing `useRef` calls near the top, add:
```typescript
  const pendingActionCallbacks = useRef<Map<string, (err?: string) => void>>(new Map())
```

Add the handler function (after `handleCreateFeature`):
```typescript
  const handleTriggerAction = (featureId: string, action: string): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
      const callbackKey = `${featureId}:${action}:${Date.now()}`
      pendingActionCallbacks.current.set(callbackKey, (err?: string) => {
        pendingActionCallbacks.current.delete(callbackKey)
        if (err) reject(new Error(err))
        else resolve()
      })
      vscode.postMessage({ type: 'triggerAction', featureId, action, callbackKey })
    })
  }
```

**Step 2: Handle `actionResult` in the message listener**

Find the `window.addEventListener('message', ...)` handler in `App.tsx`. In the switch/if-else that handles `message.type`, add:

```typescript
        case 'actionResult': {
          const cb = pendingActionCallbacks.current.get(message.callbackKey)
          if (cb) cb(message.error)
          break
        }
```

**Step 3: Update `handleCreateFeature` to pass `actions`**

Change:
```typescript
  const handleCreateFeature = (data: {
    status: string
    priority: Priority
    content: string
  }): void => {
    vscode.postMessage({
      type: 'createFeature',
      data
    })
  }
```
To:
```typescript
  const handleCreateFeature = (data: {
    status: string
    priority: Priority
    content: string
    assignee: string | null
    dueDate: string | null
    labels: string[]
    actions: string[]
  }): void => {
    vscode.postMessage({
      type: 'createFeature',
      data
    })
  }
```

**Step 4: Pass `onTriggerAction` to `FeatureEditor`**

In the `FeatureEditor` JSX (around line 479), add:
```typescript
              onTriggerAction={handleTriggerAction}
```

**Step 5: Build and verify**

Run: `npm run build 2>&1 | tail -20`
Expected: No errors.

**Step 6: Run all tests**

Run: `npm test`
Expected: All pass.

**Step 7: Commit**

```bash
git add src/webview/App.tsx
git commit -m "feat(actions): wire triggerAction through App.tsx"
```

---

### Task 12: Final verification

**Step 1: Full type-check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

**Step 2: Full test suite**

Run: `npm test`
Expected: All pass.

**Step 3: Full build**

Run: `npm run build`
Expected: No errors.

**Step 4: Commit**

No additional commit needed if all previous tasks committed. Tag for review.
