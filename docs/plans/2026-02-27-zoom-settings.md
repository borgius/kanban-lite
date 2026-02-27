# Zoom Settings Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add two zoom settings (board zoom + card detail zoom) with sliders and keyboard shortcuts so users can scale font sizes in the kanban UI.

**Architecture:** Two numeric settings (`boardZoom`, `cardZoom`) stored in `CardDisplaySettings` and `.kanban.json`. CSS custom properties `--board-zoom` and `--card-zoom` are set on `:root` and used in `calc()` multipliers on font-size rules. A `useEffect` in `App.tsx` syncs settings to CSS vars. Keyboard shortcuts adjust zoom by ±5%.

**Tech Stack:** TypeScript, React, Zustand, Tailwind CSS, CSS custom properties

---

### Task 1: Add zoom fields to CardDisplaySettings type

**Files:**
- Modify: `src/shared/types.ts:230-253`

**Step 1: Add boardZoom and cardZoom to CardDisplaySettings**

In `src/shared/types.ts`, add two new fields at the end of the `CardDisplaySettings` interface (before the closing `}`):

```typescript
  /** Zoom level for the board view as a percentage (75–150). Default 100. */
  boardZoom: number
  /** Zoom level for the card detail panel as a percentage (75–150). Default 100. */
  cardZoom: number
```

**Step 2: Verify types compile**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: Type errors in files that construct `CardDisplaySettings` without the new fields (config.ts, store/index.ts). This is expected — we fix them in the next tasks.

**Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(types): add boardZoom and cardZoom to CardDisplaySettings"
```

---

### Task 2: Add zoom defaults to config and store

**Files:**
- Modify: `src/shared/config.ts:54-95` (KanbanConfig interface)
- Modify: `src/shared/config.ts:129-150` (DEFAULT_CONFIG)
- Modify: `src/shared/config.ts:377-391` (configToSettings)
- Modify: `src/shared/config.ts:406-419` (settingsToConfig)
- Modify: `src/webview/store/index.ts:122-134` (initial cardSettings)

**Step 1: Add zoom fields to KanbanConfig interface**

In `src/shared/config.ts`, add after the `showDeletedColumn` field (line 86) in the `KanbanConfig` interface:

```typescript
  /** Zoom level for the board view (75–150). */
  boardZoom: number
  /** Zoom level for the card detail panel (75–150). */
  cardZoom: number
```

**Step 2: Add defaults to DEFAULT_CONFIG**

In `src/shared/config.ts`, add after `showDeletedColumn: false,` (line 147):

```typescript
  boardZoom: 100,
  cardZoom: 100,
```

**Step 3: Add zoom to configToSettings**

In `src/shared/config.ts`, in the `configToSettings` function, add after the `defaultStatus` line (line 389):

```typescript
    boardZoom: config.boardZoom,
    cardZoom: config.cardZoom
```

**Step 4: Add zoom to settingsToConfig**

In `src/shared/config.ts`, in the `settingsToConfig` function, add after the `defaultStatus` line (line 417):

```typescript
    boardZoom: settings.boardZoom,
    cardZoom: settings.cardZoom
```

**Step 5: Add defaults to Zustand store**

In `src/webview/store/index.ts`, add after `defaultStatus: 'backlog'` (line 133) in the initial `cardSettings`:

```typescript
    boardZoom: 100,
    cardZoom: 100
```

**Step 6: Verify types compile**

Run: `npx tsc --noEmit`
Expected: Clean compile (0 errors)

**Step 7: Commit**

```bash
git add src/shared/config.ts src/webview/store/index.ts
git commit -m "feat(config): add boardZoom and cardZoom defaults"
```

---

### Task 3: Add CSS zoom custom properties and calc() multipliers

**Files:**
- Modify: `src/webview/assets/main.css`
- Modify: `src/webview/App.tsx`

**Step 1: Add useEffect to App.tsx to sync CSS vars**

In `src/webview/App.tsx`, add a new `useEffect` after the existing theme-change effect (after line 203):

```typescript
  // Sync zoom CSS custom properties
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--board-zoom', String(cardSettings.boardZoom / 100))
    root.style.setProperty('--card-zoom', String(cardSettings.cardZoom / 100))
  }, [cardSettings.boardZoom, cardSettings.cardZoom])
```

**Step 2: Add zoom multipliers to comment-markdown in main.css**

In `src/webview/assets/main.css`, change the `.comment-markdown` font-size (line 333) from:

```css
  font-size: 0.75rem;
```

to:

```css
  font-size: calc(0.75rem * var(--card-zoom, 1));
```

**Step 3: Add zoom multiplier to prose base**

In `src/webview/assets/main.css`, add a font-size to the `.prose` rule (line 78), changing from:

```css
.prose {
  line-height: 1.625;
}
```

to:

```css
.prose {
  font-size: calc(1rem * var(--card-zoom, 1));
  line-height: 1.625;
}
```

**Step 4: Add zoom multiplier to markdown editor textarea**

In `src/webview/assets/main.css`, change the `.markdown-editor-textarea` font-size (line 284) from:

```css
  font-size: var(--vscode-editor-font-size, 13px);
```

to:

```css
  font-size: calc(var(--vscode-editor-font-size, 13px) * var(--card-zoom, 1));
```

**Step 5: Add board-zoom scoping class**

In `src/webview/assets/main.css`, add at the end of the file:

```css
/* Board zoom scaling */
.board-zoom-scope {
  font-size: calc(1em * var(--board-zoom, 1));
}
```

**Step 6: Apply board-zoom-scope class to board container**

In `src/webview/App.tsx`, find the board container div (line 486):

```tsx
        <div className={editingFeature ? 'w-1/2' : 'w-full'}>
```

Change to:

```tsx
        <div className={`board-zoom-scope ${editingFeature ? 'w-1/2' : 'w-full'}`}>
```

**Step 7: Apply card-zoom scoping to card detail container**

In `src/webview/App.tsx`, find the card detail container div (line 498):

```tsx
          <div className="w-1/2">
```

Change to:

```tsx
          <div className="w-1/2" style={{ fontSize: `calc(1em * var(--card-zoom, 1))` }}>
```

**Step 8: Build and verify**

Run: `npm run build`
Expected: Clean build. Open the board — everything should look the same at default zoom (100%).

**Step 9: Commit**

```bash
git add src/webview/assets/main.css src/webview/App.tsx
git commit -m "feat(zoom): add CSS custom properties and calc() multipliers for zoom"
```

---

### Task 4: Add SettingsSlider component and Zoom section to Settings panel

**Files:**
- Modify: `src/webview/components/SettingsPanel.tsx`

**Step 1: Add SettingsSlider component**

In `src/webview/components/SettingsPanel.tsx`, add a new component after the `SettingsDropdown` component (after line 183):

```typescript
function SettingsSlider({ label, description, value, min, max, step, unit, onChange }: {
  label: string
  description?: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  onChange: (v: number) => void
}) {
  return (
    <div
      className="flex items-center justify-between gap-4 px-4 py-2 transition-colors"
      onMouseEnter={e => e.currentTarget.style.background = 'var(--vscode-list-hoverBackground)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm" style={{ color: 'var(--vscode-foreground)' }}>{label}</div>
        {description && (
          <div className="text-xs mt-0.5" style={{ color: 'var(--vscode-descriptionForeground)' }}>{description}</div>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="w-20 h-1 rounded-full appearance-none cursor-pointer"
          style={{
            background: `linear-gradient(to right, var(--vscode-button-background) ${((value - min) / (max - min)) * 100}%, var(--vscode-badge-background, #6b7280) ${((value - min) / (max - min)) * 100}%)`,
          }}
        />
        <span
          className="text-xs font-mono w-10 text-right"
          style={{ color: 'var(--vscode-foreground)' }}
        >
          {value}{unit || '%'}
        </span>
      </div>
    </div>
  )
}
```

**Step 2: Add Zoom section to General tab**

In `src/webview/components/SettingsPanel.tsx`, inside the General tab content (after the Card Display `SettingsSection` closing tag around line 647), add:

```tsx
              <div style={{ borderTop: '1px solid var(--vscode-panel-border)' }} />
              <SettingsSection title="Zoom">
                <SettingsSlider
                  label="Board Zoom"
                  description="Scale text size on the board view"
                  value={local.boardZoom}
                  min={75}
                  max={150}
                  step={5}
                  onChange={v => update({ boardZoom: v })}
                />
                <SettingsSlider
                  label="Card Detail Zoom"
                  description="Scale text size in the card detail panel"
                  value={local.cardZoom}
                  min={75}
                  max={150}
                  step={5}
                  onChange={v => update({ cardZoom: v })}
                />
              </SettingsSection>
```

**Step 3: Build and verify**

Run: `npm run build`
Expected: Clean build. Open Settings → General tab → see Zoom section with two sliders at 100%.

**Step 4: Commit**

```bash
git add src/webview/components/SettingsPanel.tsx
git commit -m "feat(settings): add zoom sliders to General tab"
```

---

### Task 5: Add keyboard shortcuts for zoom

**Files:**
- Modify: `src/webview/App.tsx`

**Step 1: Add zoom keyboard shortcuts**

In `src/webview/App.tsx`, in the existing keyboard shortcuts `useEffect` (starting at line 109), add zoom handling inside the `handleKeyDown` function. Add this block **before** the `// Ignore if user is typing in an input` check (before line 134), right after the Ctrl+Z undo block:

```typescript
      // Ctrl/Cmd +/- for board zoom, Ctrl/Cmd+Shift +/- for card detail zoom
      if ((e.key === '=' || e.key === '+' || e.key === '-') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        const delta = (e.key === '-') ? -5 : 5
        const { cardSettings } = useStore.getState()
        if (e.shiftKey) {
          const newZoom = Math.max(75, Math.min(150, cardSettings.cardZoom + delta))
          if (newZoom !== cardSettings.cardZoom) {
            const next = { ...cardSettings, cardZoom: newZoom }
            setCardSettings(next)
            vscode.postMessage({ type: 'saveSettings', settings: next })
          }
        } else {
          const newZoom = Math.max(75, Math.min(150, cardSettings.boardZoom + delta))
          if (newZoom !== cardSettings.boardZoom) {
            const next = { ...cardSettings, boardZoom: newZoom }
            setCardSettings(next)
            vscode.postMessage({ type: 'saveSettings', settings: next })
          }
        }
        return
      }
```

**Step 2: Build and verify**

Run: `npm run build`
Expected: Clean build. Ctrl+= increases board zoom, Ctrl+- decreases it. Ctrl+Shift+= increases card detail zoom, Ctrl+Shift+- decreases it.

**Step 3: Commit**

```bash
git add src/webview/App.tsx
git commit -m "feat(zoom): add Ctrl+/- keyboard shortcuts for zoom"
```

---

### Task 6: Type-check and final build

**Files:** None (verification only)

**Step 1: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 errors

**Step 2: Full build**

Run: `npm run build`
Expected: Clean build with no warnings related to zoom

**Step 3: Final commit (if any fixups needed)**

Only commit if fixes were needed. Otherwise, the feature is complete.
