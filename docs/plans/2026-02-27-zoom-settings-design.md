# Zoom Settings Design

## Problem

Base font for comments and description previews is too small. Rather than changing font sizes directly, add a zoom setting so users can increase/decrease zoom level.

## Solution

Two independent zoom levels:
1. **Board Zoom** — scales text on the board view (card titles, descriptions, labels, metadata)
2. **Card Detail Zoom** — scales text in the open card panel (prose editor, comments, markdown editor)

## Settings

Two new numeric fields on `CardDisplaySettings`:

| Field | Type | Default | Range | Step |
|-------|------|---------|-------|------|
| `boardZoom` | `number` | `100` | 75–150 | 5 |
| `cardZoom` | `number` | `100` | 75–150 | 5 |

Values are percentages. Persisted in `.kanban.json`.

## CSS Implementation

Two CSS custom properties set on `document.documentElement`:
- `--board-zoom` (decimal, e.g. `1.0`, `1.2`)
- `--card-zoom` (decimal, e.g. `1.0`, `1.2`)

Applied via `calc()` multipliers on font-size rules in `main.css`:

**Board scope** (`--board-zoom`): Applied to the board container element. Affects card text via a `font-size: calc(1em * var(--board-zoom, 1))` on the board wrapper, so all `em`-relative child sizes scale automatically. For Tailwind `text-xs`/`text-sm` classes (which use `rem`), override with explicit `font-size` on the board container.

**Card detail scope** (`--card-zoom`): Applied to the card detail panel container.
- `.comment-markdown { font-size: calc(0.75rem * var(--card-zoom, 1)); }`
- `.prose` base and heading sizes multiplied by `--card-zoom`
- `.markdown-editor-textarea` font-size multiplied by `--card-zoom`

A `useEffect` in `App.tsx` sets these CSS variables whenever `cardSettings.boardZoom` or `cardSettings.cardZoom` changes.

## Settings UI

New "Zoom" section in the General tab of SettingsPanel (placed after "Card Display" section).

New `SettingsSlider` component:
- Range input (75–150, step 5)
- Displays current percentage value (e.g. "100%")
- Styled to match VSCode theme

Two sliders:
- "Board Zoom" — controls `boardZoom`
- "Card Detail Zoom" — controls `cardZoom`

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+=` / `Cmd+=` | Board zoom +5% |
| `Ctrl+-` / `Cmd+-` | Board zoom -5% |
| `Ctrl+Shift+=` / `Cmd+Shift+=` | Card detail zoom +5% |
| `Ctrl+Shift+-` / `Cmd+Shift+-` | Card detail zoom -5% |

Handled via a `useEffect` keydown listener in `App.tsx` that increments/decrements zoom values and triggers `saveSettings`.

## Data Flow

1. `.kanban.json` stores `boardZoom` and `cardZoom` as integers (75–150)
2. `configToSettings()` / `settingsToConfig()` map these fields
3. Init message sends settings to webview
4. `App.tsx` useEffect sets `--board-zoom` and `--card-zoom` CSS vars on `:root`
5. CSS rules use `calc()` to multiply base font sizes
6. Keyboard shortcuts and slider changes trigger `saveSettings` message
7. Backend persists to `.kanban.json`

## Files to Modify

- `src/shared/types.ts` — add `boardZoom` and `cardZoom` to `CardDisplaySettings`
- `src/shared/config.ts` — add defaults in `configToSettings` / `settingsToConfig`
- `src/webview/store/index.ts` — add defaults to initial `cardSettings`
- `src/webview/assets/main.css` — add `calc()` zoom multipliers to font-size rules
- `src/webview/components/SettingsPanel.tsx` — add `SettingsSlider` component and Zoom section
- `src/webview/App.tsx` — add `useEffect` for CSS vars and keyboard shortcuts
