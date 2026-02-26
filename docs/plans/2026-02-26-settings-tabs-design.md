# Settings Panel Tabs Design

**Date:** 2026-02-26

## Problem

The Settings panel currently renders all sections (Workspace, Card Display, Defaults, Labels) in a single scrollable list. The Labels section is large (manage many labels) and conceptually distinct from display settings and defaults. Scrolling past all the toggles to reach label management is cumbersome.

## Solution

Split the Settings panel into three tabs:

| Tab | Contents |
|---|---|
| General | Workspace info + Card Display toggles |
| Defaults | Default Priority + Default Status dropdowns |
| Labels | Full label management (LabelsSection) |

## Design Details

### Tab Bar
- Rendered directly below the panel header, above the scrollable content area
- Three pill/underline-style tab buttons
- Active tab indicated by underline using `var(--vscode-button-background)` color
- Inactive tabs use `var(--vscode-descriptionForeground)`

### State
- `activeTab: 'general' | 'defaults' | 'labels'` in `SettingsPanelContent` via `useState`
- Default: `'general'`

### Rendering
- Conditional rendering: only the active tab's content is rendered inside the scrollable area
- All existing child components (`SettingsSection`, `SettingsToggle`, `SettingsInfo`, `SettingsDropdown`, `LabelsSection`) are unchanged

## Scope

Single file change: `src/webview/components/SettingsPanel.tsx`

- Modify `SettingsPanelContent` to add tab bar and conditional content rendering
- No changes to props interfaces, no new files
