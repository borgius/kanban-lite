# Card Metadata Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to attach arbitrary nested key-value metadata to kanban cards, stored as native YAML in frontmatter, exposed via all interfaces (SDK, CLI, API, MCP, UI).

**Architecture:** Add `metadata?: Record<string, any>` to the `Feature` type. Use `js-yaml` to parse/serialize just the metadata block inside the existing regex-based frontmatter parser. All three interfaces (CLI, API, MCP) pass metadata through to the SDK. The webview shows a collapsible metadata section in the card detail panel and a small key-count chip on the card grid.

**Tech Stack:** TypeScript, js-yaml, React (webview), Tailwind CSS, vitest

---

### Task 1: Add js-yaml dependency

**Files:**
- Modify: `package.json`

**Step 1: Install js-yaml**

Run: `npm install js-yaml && npm install -D @types/js-yaml`

**Step 2: Verify installation**

Run: `npx tsc --noEmit`
Expected: No new errors

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add js-yaml dependency for metadata parsing"
```

---

### Task 2: Add metadata field to types

**Files:**
- Modify: `src/shared/types.ts:38-69` (Feature interface)
- Modify: `src/shared/types.ts:261-264` (FeatureFrontmatter interface)
- Modify: `src/sdk/types.ts:6-23` (CreateCardInput interface)

**Step 1: Write the failing test**

Create: `src/sdk/__tests__/metadata.test.ts`

```typescript
import { describe, expect, it } from 'vitest'
import { parseFeatureFile, serializeFeature } from '../parser'
import type { Feature } from '../../shared/types'

describe('metadata - parsing', () => {
  it('should parse a card with flat metadata', () => {
    const content = `---
id: "meta-flat"
status: "todo"
priority: "medium"
assignee: null
dueDate: null
created: "2025-01-01T00:00:00.000Z"
modified: "2025-01-01T00:00:00.000Z"
completedAt: null
labels: []
order: "a0"
metadata:
  sprint: "2026-Q1"
  estimate: 5
---
# Flat Metadata Card`

    const feature = parseFeatureFile(content, '/tmp/meta-flat.md')
    expect(feature).not.toBeNull()
    expect(feature?.metadata).toEqual({ sprint: '2026-Q1', estimate: 5 })
  })

  it('should parse a card with nested metadata', () => {
    const content = `---
id: "meta-nested"
status: "todo"
priority: "medium"
assignee: null
dueDate: null
created: "2025-01-01T00:00:00.000Z"
modified: "2025-01-01T00:00:00.000Z"
completedAt: null
labels: []
order: "a0"
metadata:
  links:
    jira: "PROJ-123"
    figma: "https://figma.com/file/abc"
  tags:
    - v2
    - backend
---
# Nested Metadata Card`

    const feature = parseFeatureFile(content, '/tmp/meta-nested.md')
    expect(feature).not.toBeNull()
    expect(feature?.metadata).toEqual({
      links: { jira: 'PROJ-123', figma: 'https://figma.com/file/abc' },
      tags: ['v2', 'backend'],
    })
  })

  it('should return undefined metadata when no metadata block exists', () => {
    const content = `---
id: "no-meta"
status: "todo"
priority: "medium"
assignee: null
dueDate: null
created: "2025-01-01T00:00:00.000Z"
modified: "2025-01-01T00:00:00.000Z"
completedAt: null
labels: []
order: "a0"
---
# No Metadata`

    const feature = parseFeatureFile(content, '/tmp/no-meta.md')
    expect(feature).not.toBeNull()
    expect(feature?.metadata).toBeUndefined()
  })
})

describe('metadata - serialization', () => {
  it('should serialize and round-trip metadata', () => {
    const original: Feature = {
      id: 'meta-roundtrip',
      status: 'todo',
      priority: 'medium',
      assignee: null,
      dueDate: null,
      created: '2025-01-01T00:00:00.000Z',
      modified: '2025-01-01T00:00:00.000Z',
      completedAt: null,
      labels: [],
      attachments: [],
      comments: [],
      order: 'a0',
      content: '# Metadata Round Trip',
      filePath: '/tmp/meta-roundtrip.md',
      metadata: {
        sprint: '2026-Q1',
        links: { jira: 'PROJ-123' },
        estimate: 5,
      },
    }

    const serialized = serializeFeature(original)
    expect(serialized).toContain('metadata:')
    expect(serialized).toContain('sprint:')

    const parsed = parseFeatureFile(serialized, original.filePath)
    expect(parsed).not.toBeNull()
    expect(parsed?.metadata).toEqual(original.metadata)
  })

  it('should omit metadata block when metadata is undefined', () => {
    const feature: Feature = {
      id: 'no-meta',
      status: 'todo',
      priority: 'medium',
      assignee: null,
      dueDate: null,
      created: '2025-01-01T00:00:00.000Z',
      modified: '2025-01-01T00:00:00.000Z',
      completedAt: null,
      labels: [],
      attachments: [],
      comments: [],
      order: 'a0',
      content: '# No Metadata',
      filePath: '/tmp/no-meta.md',
    }

    const serialized = serializeFeature(feature)
    expect(serialized).not.toContain('metadata:')
  })

  it('should omit metadata block when metadata is empty object', () => {
    const feature: Feature = {
      id: 'empty-meta',
      status: 'todo',
      priority: 'medium',
      assignee: null,
      dueDate: null,
      created: '2025-01-01T00:00:00.000Z',
      modified: '2025-01-01T00:00:00.000Z',
      completedAt: null,
      labels: [],
      attachments: [],
      comments: [],
      order: 'a0',
      content: '# Empty Metadata',
      filePath: '/tmp/empty-meta.md',
      metadata: {},
    }

    const serialized = serializeFeature(feature)
    expect(serialized).not.toContain('metadata:')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/sdk/__tests__/metadata.test.ts`
Expected: FAIL — `metadata` property doesn't exist on Feature type

**Step 3: Add metadata to types**

In `src/shared/types.ts`, add to `Feature` interface (after `content: string`):
```typescript
  /** Custom user-defined metadata as key-value pairs. Supports nested objects. */
  metadata?: Record<string, any>
```

In `src/shared/types.ts`, add to `FeatureFrontmatter` interface (after `order: string`):
```typescript
  /** Custom user-defined metadata. */
  metadata?: Record<string, any>
```

In `src/sdk/types.ts`, add to `CreateCardInput` interface (after `boardId?: string`):
```typescript
  /** Custom metadata to attach to the card. */
  metadata?: Record<string, any>
```

**Step 4: Run type-check**

Run: `npx tsc --noEmit`
Expected: PASS (metadata is optional so no existing code breaks)

**Step 5: Commit**

```bash
git add src/shared/types.ts src/sdk/types.ts src/sdk/__tests__/metadata.test.ts
git commit -m "feat: add metadata field to Feature, FeatureFrontmatter, and CreateCardInput types"
```

---

### Task 3: Update parser to handle metadata

**Files:**
- Modify: `src/sdk/parser.ts`
- Test: `src/sdk/__tests__/metadata.test.ts` (already written in Task 2)

**Step 1: Verify tests still fail**

Run: `npx vitest run src/sdk/__tests__/metadata.test.ts`
Expected: FAIL — parser doesn't extract metadata

**Step 2: Update parseFeatureFile to extract metadata**

In `src/sdk/parser.ts`, add import at top:
```typescript
import * as yaml from 'js-yaml'
```

Add a `getMetadata` helper inside `parseFeatureFile`, after the existing `getArrayValue` helper:

```typescript
  const getMetadata = (): Record<string, any> | undefined => {
    // Find the metadata: line and collect all subsequent indented lines
    const lines = frontmatter.split('\n')
    const metaIndex = lines.findIndex(l => /^metadata:\s*$/.test(l))
    if (metaIndex === -1) return undefined

    const metaLines = ['metadata:']
    for (let j = metaIndex + 1; j < lines.length; j++) {
      if (lines[j].match(/^\s+/) || lines[j].trim() === '') {
        metaLines.push(lines[j])
      } else {
        break
      }
    }

    if (metaLines.length <= 1) return undefined

    try {
      const parsed = yaml.load(metaLines.join('\n')) as { metadata: Record<string, any> }
      return parsed?.metadata && Object.keys(parsed.metadata).length > 0 ? parsed.metadata : undefined
    } catch {
      return undefined
    }
  }
```

In the return object of `parseFeatureFile`, add after `order`:
```typescript
    metadata: getMetadata(),
```

Remove `undefined` values: if metadata is undefined, don't include the property. Use a spread pattern:
```typescript
    ...(getMetadata() !== undefined ? { metadata: getMetadata() } : {}),
```

Actually simpler — just assign it and let undefined be natural:
```typescript
    const meta = getMetadata()
    // ... in return:
    ...(meta ? { metadata: meta } : {}),
```

**Step 3: Update serializeFeature to output metadata**

In `src/sdk/parser.ts`, update `serializeFeature`. After the `order` line and before `'---'`, add:

```typescript
  // Add metadata block if present and non-empty
  if (feature.metadata && Object.keys(feature.metadata).length > 0) {
    const metaYaml = yaml.dump(feature.metadata, { indent: 2, lineWidth: -1 })
    const indented = metaYaml
      .trimEnd()
      .split('\n')
      .map(line => '  ' + line)
      .join('\n')
    frontmatterLines.push('metadata:')
    frontmatterLines.push(indented)
  }
```

Note: The frontmatter is currently built as an array joined by `\n`. You'll need to convert the array literal to a mutable variable (e.g., `const frontmatterLines = [...]`) and push the metadata lines before the closing `---` and empty line. The closing `'---'` and `''` should be added after metadata.

Specifically, refactor `serializeFeature` so that:
```typescript
export function serializeFeature(feature: Feature): string {
  const lines = [
    '---',
    `id: "${feature.id}"`,
    `status: "${feature.status}"`,
    `priority: "${feature.priority}"`,
    `assignee: ${feature.assignee ? `"${feature.assignee}"` : 'null'}`,
    `dueDate: ${feature.dueDate ? `"${feature.dueDate}"` : 'null'}`,
    `created: "${feature.created}"`,
    `modified: "${feature.modified}"`,
    `completedAt: ${feature.completedAt ? `"${feature.completedAt}"` : 'null'}`,
    `labels: [${feature.labels.map(l => `"${l}"`).join(', ')}]`,
    `attachments: [${(feature.attachments || []).map(a => `"${a}"`).join(', ')}]`,
    `order: "${feature.order}"`,
  ]

  if (feature.metadata && Object.keys(feature.metadata).length > 0) {
    const metaYaml = yaml.dump(feature.metadata, { indent: 2, lineWidth: -1 })
    lines.push('metadata:')
    for (const line of metaYaml.trimEnd().split('\n')) {
      lines.push('  ' + line)
    }
  }

  lines.push('---', '')

  let result = lines.join('\n') + feature.content

  // ... rest stays the same (comment serialization)
```

**Step 4: Run tests**

Run: `npx vitest run src/sdk/__tests__/metadata.test.ts`
Expected: PASS

**Step 5: Run all parser tests to verify no regressions**

Run: `npx vitest run src/sdk/__tests__/parser.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/sdk/parser.ts
git commit -m "feat: parse and serialize metadata in YAML frontmatter"
```

---

### Task 4: Wire metadata through SDK createCard and updateCard

**Files:**
- Modify: `src/sdk/KanbanSDK.ts:598-614` (createCard — add metadata to card object)

**Step 1: Write the failing test**

Add to `src/sdk/__tests__/metadata.test.ts`:

```typescript
import { beforeEach, afterEach } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import { KanbanSDK } from '../KanbanSDK'

describe('metadata - SDK integration', () => {
  let sdk: KanbanSDK
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = path.join('/tmp', `kanban-meta-test-${Date.now()}`)
    const featuresDir = path.join(tmpDir, '.kanban')
    await fs.mkdir(featuresDir, { recursive: true })
    // Write minimal .kanban.json
    await fs.writeFile(path.join(tmpDir, '.kanban.json'), JSON.stringify({ version: 2, boards: { default: {} }, defaultBoard: 'default' }))
    sdk = new KanbanSDK(featuresDir)
    await sdk.init()
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('should create a card with metadata', async () => {
    const card = await sdk.createCard({
      content: '# Meta Card',
      metadata: { sprint: '2026-Q1', estimate: 3 },
    })

    expect(card.metadata).toEqual({ sprint: '2026-Q1', estimate: 3 })

    // Verify persisted to disk
    const fetched = await sdk.getCard(card.id)
    expect(fetched?.metadata).toEqual({ sprint: '2026-Q1', estimate: 3 })
  })

  it('should update card metadata', async () => {
    const card = await sdk.createCard({ content: '# Update Meta' })
    expect(card.metadata).toBeUndefined()

    const updated = await sdk.updateCard(card.id, {
      metadata: { sprint: '2026-Q2' },
    } as any)
    expect(updated.metadata).toEqual({ sprint: '2026-Q2' })

    // Verify round-trip
    const fetched = await sdk.getCard(card.id)
    expect(fetched?.metadata).toEqual({ sprint: '2026-Q2' })
  })

  it('should create a card without metadata (backward compat)', async () => {
    const card = await sdk.createCard({ content: '# No Meta' })
    expect(card.metadata).toBeUndefined()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/sdk/__tests__/metadata.test.ts`
Expected: FAIL — createCard doesn't pass metadata

**Step 3: Update createCard in KanbanSDK**

In `src/sdk/KanbanSDK.ts`, in the `createCard` method, add metadata to the card object (around line 598-614):

```typescript
    const card: Feature = {
      // ... existing fields ...
      ...(data.metadata && Object.keys(data.metadata).length > 0 ? { metadata: data.metadata } : {}),
    }
```

Add it after `content: data.content` and before `filePath`.

**Step 4: Run tests**

Run: `npx vitest run src/sdk/__tests__/metadata.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `npx vitest run`
Expected: PASS (no regressions)

**Step 6: Commit**

```bash
git add src/sdk/KanbanSDK.ts src/sdk/__tests__/metadata.test.ts
git commit -m "feat: wire metadata through SDK createCard and updateCard"
```

---

### Task 5: Add metadata to CLI

**Files:**
- Modify: `src/cli/index.ts:235-274` (cmdAdd — add --metadata flag)
- Modify: `src/cli/index.ts:300-339` (cmdEdit — add --metadata flag)

**Step 1: Update cmdAdd to accept --metadata**

After the `labels` parsing (around line 265), add:
```typescript
  let metadata: Record<string, any> | undefined
  if (typeof flags.metadata === 'string') {
    try {
      metadata = JSON.parse(flags.metadata)
    } catch {
      console.error(red('Error: --metadata must be valid JSON'))
      process.exit(1)
    }
  }
```

Pass `metadata` to `sdk.createCard({ ..., metadata })`.

**Step 2: Update cmdEdit to accept --metadata**

After the label parsing in cmdEdit, add similar parsing:
```typescript
  if (typeof flags.metadata === 'string') {
    try {
      updates.metadata = JSON.parse(flags.metadata)
    } catch {
      console.error(red('Error: --metadata must be valid JSON'))
      process.exit(1)
    }
  }
```

**Step 3: Update the cmdGet display**

In the `cmdGet` function, after showing existing fields, add metadata display:
```typescript
  if (card.metadata && Object.keys(card.metadata).length > 0) {
    console.log(`  Metadata: ${JSON.stringify(card.metadata, null, 2)}`)
  }
```

**Step 4: Update help text**

Add `--metadata` to the help text for `add` and `edit` commands.

**Step 5: Type-check and test**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 6: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat: add --metadata flag to CLI create and edit commands"
```

---

### Task 6: Add metadata to REST API

**Files:**
- Modify: `src/standalone/server.ts:13-20` (CreateFeatureData — add metadata)
- Modify: `src/standalone/server.ts:162-180` (doCreateFeature — pass metadata)
- Modify: `src/standalone/server.ts:842-860` (POST /api/tasks — extract metadata)
- Modify: `src/standalone/server.ts:723-743` (POST /api/boards/:boardId/tasks — extract metadata)

**Step 1: Add metadata to CreateFeatureData**

```typescript
interface CreateFeatureData {
  status: string
  priority: Priority
  content: string
  assignee: string | null
  dueDate: string | null
  labels: string[]
  metadata?: Record<string, any>
}
```

**Step 2: Pass metadata in doCreateFeature**

```typescript
async function doCreateFeature(data: CreateFeatureData): Promise<Feature> {
  // ...
  const feature = await sdk.createCard({
    // ... existing fields ...
    metadata: data.metadata,
    boardId: currentBoardId,
  })
  // ...
}
```

**Step 3: Extract metadata in POST /api/tasks**

```typescript
const data: CreateFeatureData = {
  // ... existing fields ...
  metadata: body.metadata as Record<string, any> | undefined,
}
```

**Step 4: Extract metadata in POST /api/boards/:boardId/tasks**

Add `metadata: body.metadata` to the `sdk.createCard()` call.

**Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 6: Commit**

```bash
git add src/standalone/server.ts
git commit -m "feat: add metadata support to REST API create and update routes"
```

---

### Task 7: Add metadata to MCP server

**Files:**
- Modify: `src/mcp-server/index.ts:200-233` (create_card tool — add metadata param)
- Modify: `src/mcp-server/index.ts:235-287` (update_card tool — add metadata param)

**Step 1: Add metadata parameter to create_card**

In the tool schema (zod), add:
```typescript
metadata: z.record(z.any()).optional().describe('Custom metadata as key-value pairs (supports nested objects)'),
```

Pass it to `sdk.createCard({ ..., metadata })`.

**Step 2: Add metadata parameter to update_card**

Same zod schema addition. Pass to updates:
```typescript
if (metadata !== undefined) updates.metadata = metadata
```

**Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add src/mcp-server/index.ts
git commit -m "feat: add metadata support to MCP create_card and update_card tools"
```

---

### Task 8: Add metadata to WebviewMessage types and server handler

**Files:**
- Modify: `src/shared/types.ts` (WebviewMessage — add metadata to createFeature)
- Modify: `src/standalone/server.ts` (WebSocket handler — pass metadata)

**Step 1: Update WebviewMessage createFeature type**

In `src/shared/types.ts`, update the `createFeature` message type:
```typescript
| { type: 'createFeature'; data: { status: string; priority: Priority; content: string; assignee: string | null; dueDate: string | null; labels: string[]; metadata?: Record<string, any> } }
```

**Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add src/shared/types.ts src/standalone/server.ts
git commit -m "feat: add metadata to WebviewMessage types"
```

---

### Task 9: UI — Metadata indicator on FeatureCard

**Files:**
- Modify: `src/webview/components/FeatureCard.tsx`

**Step 1: Add metadata chip to card footer**

In `FeatureCard.tsx`, in the footer section (around line 154-183), add a metadata key-count chip next to the attachments indicator:

```tsx
{feature.metadata && Object.keys(feature.metadata).length > 0 && (
  <div className="flex items-center gap-1 text-zinc-400 dark:text-zinc-500">
    <span className="text-[10px] font-mono">{`{${Object.keys(feature.metadata).length}}`}</span>
  </div>
)}
```

Place this after the attachments indicator block.

**Step 2: Visual check**

Run the dev server and verify the chip shows on cards with metadata.

**Step 3: Commit**

```bash
git add src/webview/components/FeatureCard.tsx
git commit -m "feat: show metadata key count indicator on card grid"
```

---

### Task 10: UI — Collapsible metadata section in card detail (FeatureEditor)

**Files:**
- Modify: `src/webview/components/FeatureEditor.tsx`

**Step 1: Identify where to add metadata section**

Read the FeatureEditor component to find where card properties are displayed (priority, assignee, labels, etc.) and add a metadata section below them.

**Step 2: Add MetadataSection component**

Add an inline component within FeatureEditor (or above it) that renders metadata:

```tsx
function MetadataSection({ metadata }: { metadata?: Record<string, any> }) {
  const [expanded, setExpanded] = useState(false)

  if (!metadata || Object.keys(metadata).length === 0) return null

  const keys = Object.keys(metadata)

  return (
    <div className="mt-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
      >
        <span className="text-[10px]">{expanded ? '▼' : '▶'}</span>
        <span>Metadata</span>
        <span className="text-zinc-400 dark:text-zinc-500">({keys.length})</span>
      </button>
      {!expanded && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {keys.map(key => (
            <span key={key} className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300 font-mono">
              {key}
            </span>
          ))}
        </div>
      )}
      {expanded && (
        <div className="mt-1.5 text-xs font-mono bg-zinc-50 dark:bg-zinc-900 rounded p-2 border border-zinc-200 dark:border-zinc-700">
          <MetadataTree data={metadata} depth={0} />
        </div>
      )}
    </div>
  )
}

function MetadataTree({ data, depth }: { data: Record<string, any>; depth: number }) {
  return (
    <div style={{ paddingLeft: depth > 0 ? 12 : 0 }}>
      {Object.entries(data).map(([key, value]) => (
        <div key={key} className="py-0.5">
          {value && typeof value === 'object' && !Array.isArray(value) ? (
            <>
              <span className="text-zinc-500 dark:text-zinc-400">{key}:</span>
              <MetadataTree data={value} depth={depth + 1} />
            </>
          ) : Array.isArray(value) ? (
            <div>
              <span className="text-zinc-500 dark:text-zinc-400">{key}: </span>
              <span className="text-zinc-700 dark:text-zinc-300">[{value.join(', ')}]</span>
            </div>
          ) : (
            <div>
              <span className="text-zinc-500 dark:text-zinc-400">{key}: </span>
              <span className="text-zinc-700 dark:text-zinc-300">{String(value)}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
```

**Step 3: Place MetadataSection in FeatureEditor**

Add `<MetadataSection metadata={feature.metadata} />` after the labels/properties section in the editor panel.

**Step 4: Visual check**

Test with cards that have metadata to verify collapse/expand behavior.

**Step 5: Commit**

```bash
git add src/webview/components/FeatureEditor.tsx
git commit -m "feat: add collapsible metadata section to card detail panel"
```

---

### Task 11: Final verification

**Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

**Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Build**

Run: `npm run build`
Expected: PASS

**Step 4: Manual verification**

1. Create a card via CLI with metadata: `kl add --title "Test" --metadata '{"sprint":"Q1","links":{"jira":"PROJ-1"}}'`
2. Verify `kl get <id>` shows metadata
3. Open the standalone server, verify the card shows metadata chip
4. Click the card, verify collapsed metadata shows keys, expanded shows tree

**Step 5: Commit any remaining fixes**

```bash
git add -A
git commit -m "feat: card metadata feature complete"
```
