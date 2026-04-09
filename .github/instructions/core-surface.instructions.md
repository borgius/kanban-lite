---
description: "Use when adding or changing kanban-lite SDK code, standalone API routes, CLI commands, or MCP tools. Covers SDK-first sequencing, interface parity, and generated-doc source rules."
name: "kanban core surface"
applyTo:
  - "packages/kanban-lite/src/sdk/**"
  - "packages/kanban-lite/src/standalone/**"
  - "packages/kanban-lite/src/cli/**"
  - "packages/kanban-lite/src/mcp-server/**"
---

# Kanban core surface changes

- Implement shared behavior in the SDK first, then wire the API, CLI, and MCP surfaces in that order.
- Keep API, CLI, and MCP behavior in feature parity for user-facing capabilities.
- Update JSDoc when logic, parameters, return types, or behavior change; JSDoc is the source of truth for `docs/sdk.md`.
- Never edit generated `docs/api.md`, `docs/sdk.md`, or `docs/webhooks.md` manually; update the source metadata or JSDoc and regenerate them.
- For user-facing changes, update `README.md` and `CHANGELOG.md` in the same task.
