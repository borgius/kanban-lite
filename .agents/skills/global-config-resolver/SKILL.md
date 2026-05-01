---
name: global-config-resolver
description: >
  Use when reading workspace configuration inside any kanban-lite plugin, SDK module, CLI
  command, MCP tool, or standalone route. Ensures all code paths use the shared `readConfig`
  from `kanban-lite/sdk` instead of private `fs.readFileSync` / `JSON.parse` calls against
  `.kanban.json`. Triggers: "read config", "parse kanban.json", "load workspace config",
  "plugin reads .kanban.json", "self-made config resolver".
license: MIT
metadata:
  author: kanban-lite
  version: "1.0.0"
---

# Global Config Resolver

All code that needs to read workspace configuration **must** use the global `readConfig` function
exported from `kanban-lite/sdk`. Never open `.kanban.json` directly with `fs.readFileSync` /
`JSON.parse` inside a plugin or any other module.

## Why

`readConfig` is the single source of truth for kanban workspace configuration. It provides:

- **Environment variable interpolation** – `${VAR_NAME}` placeholders in string values are
  resolved against `process.env` with a clear error when a variable is missing.
- **Migration** – v1 configs are automatically migrated to v2 format and persisted.
- **Caching** – a request-scoped read cache (`withConfigReadCache`) collapses redundant
  disk reads within a single request or event cycle.
- **Provider abstraction** – config can be stored in an alternative config-storage provider
  (not just the local file system). A raw `fs.readFileSync` bypasses that entirely.
- **Error semantics** – read/parse failures throw a typed, actionable error instead of
  silently returning empty config or crashing with a raw `SyntaxError`.

Bypassing `readConfig` means env vars are not resolved, the cache is not used, alternative
config-storage providers are ignored, and migration is skipped.

## Correct pattern

```typescript
import { readConfig } from 'kanban-lite/sdk'

// Access plugin options from the global config:
const options = readConfig(workspaceRoot).plugins?.['my-capability.namespace']?.options
```

`options` is typed as `Record<string, unknown> | undefined` because `ProviderRef.options` is
open-ended. Guard with `Array.isArray`, `typeof`, or your own type-guard before using values.

## Anti-patterns to remove

These patterns must not appear in plugins or SDK modules:

```typescript
// ❌ WRONG – bypasses env-var resolution, caching, migration, and provider abstraction
import * as fs from 'node:fs'
import * as path from 'node:path'

const CONFIG_FILENAME = '.kanban.json'

function parseMyPluginConfig(workspaceRoot: string) {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(workspaceRoot, CONFIG_FILENAME), 'utf-8')
    ) as MyPluginConfig
  } catch {
    return {}
  }
}

// Use inside the plugin:
const events = parseMyPluginConfig(workspaceRoot).plugins?.['my.namespace']?.options?.events
```

Replace entirely with:

```typescript
// ✅ CORRECT
import { readConfig } from 'kanban-lite/sdk'

const events = readConfig(workspaceRoot).plugins?.['my.namespace']?.options?.events
```

## Checklist when adding or reviewing plugin config reads

1. **No `fs.readFileSync` on `.kanban.json`** anywhere in plugin source files.
2. **No private `parseXxxConfig` / `parseCronConfig` / `parseCallbackConfig`** helper that
   opens the config file directly.
3. **No local `CONFIG_FILENAME = '.kanban.json'` constant** whose sole purpose is to be
   joined with `workspaceRoot` for a raw file read.
4. **Import `readConfig` from `kanban-lite/sdk`** (value import, not `import type`).
5. Access plugin-specific options via:
   ```typescript
   readConfig(workspaceRoot).plugins?.['capability.namespace']?.options
   ```
6. Remove any `PersistedXxxConfig` / `PersistedXxxPluginConfig` interfaces that modelled the
   raw JSON shape – they are no longer needed once you use `readConfig`.
7. Remove any unused `import * as fs from 'node:fs'` left behind after the migration.
8. Run `pnpm --filter <plugin-name> exec tsc --noEmit` to confirm no new type errors.
   If `PluginCapabilityNamespace` in the dist types doesn't yet include a new capability
   namespace, rebuild `kanban-lite` first (`pnpm --filter kanban-lite build`).

## Known cases fixed

| Plugin | File | Change |
|---|---|---|
| `kl-plugin-cron` | `src/runtime.ts` | Removed `parseCronConfig`; now uses `readConfig` |
| `kl-plugin-callback` | `src/handlers.ts` | Removed `parseCallbackConfig`; now uses `readConfig` |
