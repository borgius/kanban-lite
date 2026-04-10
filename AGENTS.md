# Kanban Markdown - Development Guide

A VSCode extension + standalone server + CLI + MCP server for managing kanban boards stored as markdown files (default) or SQLite.

## Repo-wide defaults

- The SDK is the source of truth for shared business logic. Keep API, CLI, and MCP behavior in feature parity when a capability changes.
- Keep `index.ts` files as barrel-only entrypoints: do not add implementation logic, conditionals, helpers, or side effects there; move real behavior into named modules and only re-export from `index.ts`.
- Make surgical edits only: avoid unrelated refactors, large rewrites, or new dependencies unless the task clearly needs them.
- **No source file may exceed 600 lines** (excluding generated files, test fixtures, and `*.d.ts` declarations). Split oversized modules before adding more logic.
- For user-facing changes, update `README.md` and `CHANGELOG.md`, and regenerate generated docs from source comments or route metadata instead of editing generated docs directly.
- Use the scoped instructions in `.github/instructions/` and repo skills for React/TSX work, kanban core surface changes, capability/provider invariants, plugin option schemas, and reliability-sensitive flows.

## Post-change verification (mandatory)

After **every** code change, before marking a task complete:

1. **TypeScript** — run `pnpm exec tsc --noEmit` (or the package-scoped equivalent) and fix all errors and warnings introduced by the change.
2. **Build** — confirm the project builds successfully (`nr build` or `pnpm build`); do not proceed if the build fails.
3. **Unit tests** — run `nr test` and fix any failing tests introduced by the change.
4. **E2E tests** — run `nr e2e` and fix any failing tests introduced by the change.

A task is **not complete** until all four checks pass with no new failures. Do not hand back to the user with red tests or build errors.

Goal: complete the tasks with the smallest possible code changes and minimal token usage.
