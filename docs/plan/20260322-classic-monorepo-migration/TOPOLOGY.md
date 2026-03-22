# Monorepo Topology Contract

**Plan:** `20260322-classic-monorepo-migration`  
**Established by:** T1  
**Status:** LOCKED — subsequent tasks must not deviate without updating this document.

---

## 1. Target Package Layout

```
/Users/admin/dev/kanban-light/          ← private workspace root (orchestrator only)
  package.json                           ← private: true, no publishable exports
  pnpm-workspace.yaml                    ← packages: ["packages/*"]
  tsconfig.json                          ← shared TypeScript baseline
  vitest.config.ts                       ← workspace-level Vitest orchestration
  eslint.config.mjs                      ← shared lint config
  docs/                                  ← docs, plans, generated outputs (stays at root)
  scripts/                               ← doc-gen and release scripts (stays at root)
  packages/
    kanban-lite/                         ← main product (package name: "kanban-lite")
      src/
      bin/
      package.json
      tsconfig.json (or wrapper)
      vite.standalone.config.ts (or wrapper)
    kl-auth-plugin/                      ← package name: "kl-auth-plugin"
    kl-mysql-storage/                    ← package name: "kl-mysql-storage"
    kl-s3-attachment-storage/            ← package name: "kl-s3-attachment-storage"
    kl-sqlite-storage/                   ← package name: "kl-sqlite-storage"
    kl-webhooks-plugin/                  ← package name: "kl-webhooks-plugin"
```

---

## 2. Package Naming Contract

All public npm package names are **frozen** for this migration.

| Directory                           | `name` in package.json         | Must not change |
|-------------------------------------|--------------------------------|-----------------|
| `packages/kanban-lite`              | `kanban-lite`                  | YES             |
| `packages/kl-auth-plugin`           | `kl-auth-plugin`               | YES             |
| `packages/kl-mysql-storage`         | `kl-mysql-storage`             | YES             |
| `packages/kl-s3-attachment-storage` | `kl-s3-attachment-storage`     | YES             |
| `packages/kl-sqlite-storage`        | `kl-sqlite-storage`            | YES             |
| `packages/kl-webhooks-plugin`       | `kl-webhooks-plugin`           | YES             |

Plugin provider IDs (the string registered in the kanban-lite SDK) must also remain unchanged.

---

## 3. Backward-Compatibility Requirements

### 3.1 Main package (`packages/kanban-lite`)

The following entrypoints must survive the move from root → `packages/kanban-lite` **unchanged**:

| Entrypoint           | Current value                  | Must remain valid after move    |
|----------------------|--------------------------------|---------------------------------|
| SDK export           | `kanban-lite/sdk`              | YES (same `exports` key)        |
| CLI bins             | `bin/kanban-md`, `bin/kl`, etc. | YES (same bin names)           |
| Extension main       | `dist/extension.js`            | YES (same `main` field path)    |
| Standalone build     | `dist/standalone/*`            | YES (vite config preserved)     |
| MCP entrypoint       | `bin/kanban-mcp`               | YES (same bin name)             |

### 3.2 Plugin packages

- Plugin package names stay equal to their directory names (see §2).
- The plugin loader's resolution order must remain: installed package → workspace-local `packages/kl-*` → legacy sibling `../kl-*`.
- Provider IDs used in `.kanban.json` must stay stable — no migrations required for existing user configs.

### 3.3 TypeScript import paths

- Host surfaces currently importing `src/sdk/**` and `src/shared/**` (CLI, MCP, standalone, extension, tests, docs generators) must switch to package-local paths or explicit temporary shims during T3/T4/T5.
- No import path changes are permitted to cause silent compile errors — all switches must be verified by the build/type check gate.

---

## 4. Allowed Compatibility Shims

Shims are **temporarily** permitted in exactly three categories. Each shim must be removed no later than T10.

| # | Shim type                     | Where                         | Purpose                                                                      | Removal trigger          |
|---|-------------------------------|-------------------------------|------------------------------------------------------------------------------|--------------------------|
| 1 | Root script/bin forwarding    | Root `package.json` scripts   | Keep `npm run build` / `npm test` / `npm run dev` working from repo root     | After all CI paths use workspace filters directly |
| 2 | Plugin loader fallback path   | SDK plugin loader             | Support both `packages/kl-*` and legacy sibling `../kl-*` during transition | After all plugin packages are inside `packages/*` |
| 3 | Import re-export barrels      | Root-level or package-level   | Bridge host surfaces that cannot be atomically switched in one pass           | After all host surfaces use new package-local paths |

**Shims that are NOT permitted:**
- Duplicating business logic between root and package.
- Aliasing the main product under a different package name.
- Publishing the workspace root package (`private: true` must be enforced).

---

## 5. Ownership Boundaries

| Concern                        | Owner                          | Notes                                              |
|--------------------------------|--------------------------------|----------------------------------------------------|
| Published product code         | `packages/kanban-lite`         | No product source files remain at root after T3    |
| Plugin implementations         | `packages/kl-*/`               | Fully owned by each package after T4/T5            |
| Build/test orchestration       | Root `package.json` + configs  | Points into packages via `pnpm --filter`           |
| Shared TypeScript config       | Root `tsconfig.json`           | Packages extend it; root does not publish types     |
| Shared Vitest config           | Root `vitest.config.ts`        | Packages register workspaces; root runs all         |
| Docs and changelog             | Root `docs/`, `README.md`, `CHANGELOG.md` | Always in root, never inside packages    |
| Generated docs                 | Root `docs/api.md`, `docs/sdk.md` | Run from root `scripts/`; source data lives in packages |

---

## 6. Staged Migration Policy

1. **T1 (this task):** Contract established. No files moved.
2. **T2:** Root becomes private workspace orchestrator; `pnpm-workspace.yaml` gains `packages/*`. No product source moved yet.
3. **T3:** Main product moved to `packages/kanban-lite` with published entrypoints preserved.
4. **T4:** `kl-sqlite-storage`, `kl-mysql-storage`, `kl-webhooks-plugin` moved into `packages/*`.
5. **T5:** `kl-auth-plugin`, `kl-s3-attachment-storage` moved into `packages/*`; missing tests added.
6. **T6:** Shared configs and import paths converged under workspace topology.
7. **T7:** Plugin integration verified end-to-end from monorepo.
8. **T8:** Playwright E2E suite added for standalone UI.
9. **T9:** Full verification pass; shim lifecycle reviewed.
10. **T10:** Docs, README, and CHANGELOG updated to reflect final monorepo topology. All approved shims listed or removed.

**Rule:** No wave-N task may delete a compatibility shim before the downstream task that depends on that shim has been completed and verified.
