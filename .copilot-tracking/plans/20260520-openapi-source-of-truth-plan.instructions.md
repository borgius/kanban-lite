---
applyTo: ".copilot-tracking/changes/20260520-openapi-source-of-truth-changes.md"
---

<!-- markdownlint-disable-file -->

# Task Checklist: OpenAPI Source of Truth and TSOA Fit for Standalone HTTP Contracts

## Overview

Keep the current contract-driven standalone OpenAPI pipeline as the production architecture, sync the tracking docs with the implemented codebase, and explicitly record that TSOA is not the chosen migration path for the standalone API.

## Objectives

- Align the planning artifacts with the already-implemented route-contract, plugin-doc, and generated-client architecture.
- Record that TSOA is not the selected standalone migration target because it does not fit the repo’s dispatcher, plugin, and cross-runtime contract model.
- Keep any remaining follow-up work inside the current OpenAPI pipeline, with a TSOA experiment allowed only as an isolated spike if it is explicitly requested later.

## Research Summary

### Project Files

- `packages/kanban-lite/src/standalone/internal/http-contracts.ts` - current built-in standalone route-contract registry and OpenAPI path generator
- `packages/kanban-lite/src/sdk/plugins/mcp-sdk-plugins.ts` - current plugin-owned runtime and OpenAPI seam via `registerMiddleware()`, `registerRoutes()`, and `getOpenApiDocs()`
- `packages/kanban-lite/src/standalone/internal/openapi-spec/build.ts` - current standalone spec aggregation path for built-ins plus plugin fragments
- `packages/kanban-lite/src/sdk/remote/openapi-client.ts` - current generated typed client helper consumed by remote callers
- `packages/kanban-lite/src/worker/worker-entry.ts` - current Worker reuse of the same standalone OpenAPI build path
- `.copilot-tracking/changes/20260520-openapi-source-of-truth-changes.md` - current implementation-state snapshot showing the contract-driven work already landed

### External References

- #file:../research/20260520-openapi-source-of-truth-research.md - validated repo and external research for the current contract path and the TSOA decision
- #fetch:https://tsoa-community.github.io/docs/introduction.html - TSOA’s controller/model source-of-truth assumptions
- #fetch:https://tsoa-community.github.io/docs/routes.html - TSOA route generation and static controller-discovery model
- #fetch:https://tsoa-community.github.io/docs/templates.html - TSOA custom-template escape hatch and its maintenance cost

### Standards References

- #file:../../AGENTS.md - repo-wide SDK-first rules, generated-doc expectations, and mandatory verification commands
- #file:../../.github/instructions/core-surface.instructions.md - SDK/API/CLI/MCP sequencing and generated-doc source rules

## Implementation Checklist

### [ ] Phase 1: Align planning with the implemented contract architecture

- [ ] Task 1.1: Sync the tracking docs to the implemented standalone contract pipeline
  - Details: .copilot-tracking/details/20260520-openapi-source-of-truth-details.md (Lines 11-34)

- [ ] Task 1.2: Record that TSOA is not the chosen migration path for the standalone API
  - Details: .copilot-tracking/details/20260520-openapi-source-of-truth-details.md (Lines 36-57)

### [ ] Phase 2: Finish the current contract-driven follow-through without TSOA scaffolding

- [ ] Task 2.1: Complete remaining verification and residual cleanup inside the current OpenAPI pipeline
  - Details: .copilot-tracking/details/20260520-openapi-source-of-truth-details.md (Lines 61-84)

- [ ] Task 2.2: Treat any TSOA investigation as an isolated spike with explicit no-merge boundaries
  - Details: .copilot-tracking/details/20260520-openapi-source-of-truth-details.md (Lines 86-106)

## Dependencies

- Existing `packages/kanban-lite/src/standalone/internal/http-contracts.ts` contract registry
- Existing `StandaloneHttpPlugin.getOpenApiDocs()` plugin seam for plugin-owned routes
- Existing `buildStandaloneOpenApiSpec()` plus generated client/type workflow
- `KanbanSDK` as the shared business-logic and parity seam for SDK/API/CLI/MCP
- Required verification commands from `AGENTS.md`

## Success Criteria

- Planning artifacts match the current contract-driven standalone architecture.
- TSOA is explicitly rejected as the primary migration target for the production standalone API.
- Remaining follow-up work stays inside the current OpenAPI pipeline or inside an isolated spike only.
- The shared Node server, Worker, docs, and generated-client contract path remains intact.
