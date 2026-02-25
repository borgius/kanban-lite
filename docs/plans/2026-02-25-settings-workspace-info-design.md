# Settings Panel: Workspace Info Section

## Summary

Add a read-only "Workspace" section to the top of the settings panel showing project path and key config params.

## New Fields

| Field | Source | RO |
|---|---|---|
| Project Path | `workspaceRoot` | Yes |
| Features Directory | `config.featuresDirectory` | Yes |
| Server Port | `config.port` | Yes |
| Config Version | `config.version` | Yes |

## Changes Required

### 1. Types (`src/shared/types.ts`)

Add `WorkspaceInfo` interface:
```ts
interface WorkspaceInfo {
  projectPath: string
  featuresDirectory: string
  port: number
  configVersion: number
}
```

Extend `ExtensionMessage` init type to include `workspace?: WorkspaceInfo`.

### 2. Standalone Server (`src/standalone/server.ts`)

In `buildInitMessage()`, add `workspace` field sourced from `workspaceRoot` and `readConfig()`.

### 3. Store (`src/webview/store/index.ts`)

Add `workspace: WorkspaceInfo | null` to state, setter, and update it from init message.

### 4. App (`src/webview/App.tsx`)

Pass `workspace` from store to `SettingsPanel`.

### 5. Settings Panel (`src/webview/components/SettingsPanel.tsx`)

- Add `SettingsInfo` component (label + monospace RO value).
- Add "Workspace" section at top with the 4 info fields.
- Accept `workspace` prop.
