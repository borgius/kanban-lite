# Settings Panel Tabs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split the Settings panel into three tabs: General (Workspace + Card Display), Defaults, and Labels.

**Architecture:** Add `activeTab` state to `SettingsPanelContent`, render a tab bar below the header, and conditionally render each section based on the active tab. No child components change; only the `SettingsPanelContent` render function is modified.

**Tech Stack:** React, TypeScript, Tailwind CSS, VSCode CSS variables

---

### Task 1: Add tab bar and conditional rendering to SettingsPanelContent

**Files:**
- Modify: `src/webview/components/SettingsPanel.tsx` — `SettingsPanelContent` function (lines 510–657)

No tests exist for React components in this project — manual visual verification is sufficient.

**Step 1: Add `activeTab` state**

Inside `SettingsPanelContent`, after the existing `local` state on line 511, add:

```tsx
const [activeTab, setActiveTab] = useState<'general' | 'defaults' | 'labels'>('general')
```

**Step 2: Replace the tab bar and content area**

Replace the entire `{/* Content */}` block (lines 559–643) with:

```tsx
{/* Tab Bar */}
<div
  className="flex"
  style={{ borderBottom: '1px solid var(--vscode-panel-border)' }}
>
  {(['general', 'defaults', 'labels'] as const).map(tab => (
    <button
      key={tab}
      type="button"
      onClick={() => setActiveTab(tab)}
      className="px-4 py-2.5 text-xs font-medium capitalize transition-colors relative"
      style={{
        color: activeTab === tab
          ? 'var(--vscode-foreground)'
          : 'var(--vscode-descriptionForeground)',
        background: 'transparent',
      }}
    >
      {tab.charAt(0).toUpperCase() + tab.slice(1)}
      {activeTab === tab && (
        <span
          className="absolute bottom-0 left-0 right-0 h-0.5"
          style={{ background: 'var(--vscode-button-background)' }}
        />
      )}
    </button>
  ))}
</div>

{/* Content */}
<div className="flex-1 overflow-auto">
  {activeTab === 'general' && (
    <>
      {workspace && (
        <>
          <SettingsSection title="Workspace">
            <SettingsInfo label="Project Path" value={workspace.projectPath} />
            <SettingsInfo label="Features Directory" value={workspace.featuresDirectory} />
            <SettingsInfo label="Server Port" value={String(workspace.port)} />
            <SettingsInfo label="Config Version" value={String(workspace.configVersion)} />
          </SettingsSection>
          <div style={{ borderTop: '1px solid var(--vscode-panel-border)' }} />
        </>
      )}
      <SettingsSection title="Card Display">
        <SettingsToggle
          label="Show Priority Badges"
          description="Display priority indicators on feature cards"
          checked={local.showPriorityBadges}
          onChange={v => update({ showPriorityBadges: v })}
        />
        <SettingsToggle
          label="Show Assignee"
          description="Display assigned person on feature cards"
          checked={local.showAssignee}
          onChange={v => update({ showAssignee: v })}
        />
        <SettingsToggle
          label="Show Due Date"
          description="Display due dates on feature cards"
          checked={local.showDueDate}
          onChange={v => update({ showDueDate: v })}
        />
        <SettingsToggle
          label="Show Labels"
          description="Display labels on feature cards and in editors"
          checked={local.showLabels}
          onChange={v => update({ showLabels: v })}
        />
        <SettingsToggle
          label="Show Filename"
          description="Display the source markdown filename on cards"
          checked={local.showFileName}
          onChange={v => update({ showFileName: v })}
        />
        <SettingsToggle
          label="Compact Mode"
          description="Use compact card layout to show more features"
          checked={local.compactMode}
          onChange={v => update({ compactMode: v })}
        />
        <SettingsToggle
          label="Show Deleted Column"
          description="Display the Deleted column to manage soft-deleted cards"
          checked={local.showDeletedColumn}
          onChange={v => update({ showDeletedColumn: v })}
        />
      </SettingsSection>
    </>
  )}

  {activeTab === 'defaults' && (
    <SettingsSection title="Defaults">
      <SettingsDropdown
        label="Default Priority"
        value={local.defaultPriority}
        options={priorityConfig}
        onChange={v => update({ defaultPriority: v as Priority })}
      />
      <SettingsDropdown
        label="Default Status"
        value={local.defaultStatus}
        options={statusConfig}
        onChange={v => update({ defaultStatus: v as FeatureStatus })}
      />
    </SettingsSection>
  )}

  {activeTab === 'labels' && (
    <SettingsSection title="Labels">
      <LabelsSection
        onSetLabel={onSetLabel}
        onRenameLabel={onRenameLabel}
        onDeleteLabel={onDeleteLabel}
      />
    </SettingsSection>
  )}
</div>
```

**Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 4: Commit**

```bash
git add src/webview/components/SettingsPanel.tsx
git commit -m "feat(settings): split settings panel into General / Defaults / Labels tabs"
```
