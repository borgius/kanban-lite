<!-- markdownlint-disable-file -->

# Task Details: OpenAPI Source of Truth for HTTP Contracts and Remote SDK Calls

## Research Reference

**Source Research**: #file:../research/20260520-openapi-source-of-truth-research.md

## Phase 1: Align planning with the implemented contract architecture

### Task 1.1: Sync the tracking docs to the implemented standalone contract pipeline

The repo already has the shared built-in contract registry, plugin-owned OpenAPI fragments, generated standalone path types, and downstream client adoption. Update the tracking artifacts so they describe the code that exists today instead of a future-state migration that has already landed.

- **Files**:
  - `.copilot-tracking/plans/20260520-openapi-source-of-truth-plan.instructions.md` - update checklist phases so they match the current contract-driven baseline
  - `.copilot-tracking/details/20260520-openapi-source-of-truth-details.md` - replace stale pre-implementation assumptions with current-state guidance
  - `.copilot-tracking/prompts/implement-openapi-source-of-truth.prompt.md` - ensure the implementation prompt follows the current architecture rather than a superseded migration story
  - `.copilot-tracking/changes/20260520-openapi-source-of-truth-changes.md` - keep the status log aligned with any remaining follow-up work when implementation resumes
- **Implementation**:
  - Remove or rewrite tasks that still describe `packages/kanban-lite/src/standalone/internal/http-contracts.ts`, `StandaloneHttpPlugin.getOpenApiDocs()`, generated standalone path types, and downstream client adoption as missing work.
  - Treat the current contract-driven standalone pipeline as the baseline architecture for all follow-up tasks.
  - Recompute all cross-file line references after editing the planning artifacts.
- **Success**:
  - The planning artifacts no longer describe already-landed contract work as future phases.
  - The tracking set points to the current implementation state instead of a stale pre-implementation snapshot.
- **Research References**:
  - #file:../research/20260520-openapi-source-of-truth-research.md (Lines 13-20) - built-in route-contract registry, parity coverage, and spec aggregation are already in place
  - #file:../research/20260520-openapi-source-of-truth-research.md (Lines 21-48) - plugin docs/runtime ownership and generated client adoption across remote consumers
  - #file:../research/20260520-openapi-source-of-truth-research.md (Lines 49-56) - existing plan/details drift versus the current codebase
  - #file:../research/20260520-openapi-source-of-truth-research.md (Lines 109-133) - current standalone contract architecture and reuse across Node, Worker, docs, and clients
- **Dependencies**:
  - Validated research file for the current architecture snapshot
  - Existing changes tracker as the best summary of already-completed implementation

### Task 1.2: Record that TSOA is not the chosen migration path for the standalone API

Capture the architectural decision clearly so future implementation work does not reopen the controller-migration question by accident.

- **Files**:
  - `.copilot-tracking/plans/20260520-openapi-source-of-truth-plan.instructions.md` - call out the decision in the checklist and success criteria
  - `.copilot-tracking/details/20260520-openapi-source-of-truth-details.md` - preserve the repo-specific reasons and scope boundaries
  - `.copilot-tracking/prompts/implement-openapi-source-of-truth.prompt.md` - prevent an implementation agent from adding TSOA infrastructure to the mainline task
  - `README.md` or a repo-visible architecture note only if maintainers explicitly want this rationale outside tracking docs
- **Implementation**:
  - State that the standalone API keeps the current `internal/http-contracts.ts` plus `StandaloneHttpPlugin.getOpenApiDocs()` model as the production contract path.
  - Explicitly reject adding `tsoa`, `@tsoa/runtime`, controller discovery, decorator compiler flags, or a custom Hono template as part of the mainline standalone strategy.
  - Clarify that SDK types can continue flowing into the HTTP contract through the existing OpenAPI and generated-type pipeline rather than through controller annotations.
- **Success**:
  - Future work references one chosen contract path for the standalone API.
  - No mainline checklist item assumes a TSOA migration is still pending.
- **Research References**:
  - #file:../research/20260520-openapi-source-of-truth-research.md (Lines 83-98) - TSOA’s controller/runtime assumptions from the official docs
  - #file:../research/20260520-openapi-source-of-truth-research.md (Lines 145-169) - repo-specific mismatch between TSOA and the current dispatcher/plugin model
  - #file:../research/20260520-openapi-source-of-truth-research.md (Lines 280-339) - impacted surfaces, blockers, and explicit recommendation to reject TSOA as the main migration target
- **Dependencies**:
  - Task 1.1 completion

## Phase 2: Finish the current contract-driven follow-through without TSOA scaffolding

### Task 2.1: Complete remaining verification and residual cleanup inside the current OpenAPI pipeline

Any remaining implementation work should strengthen the existing contract-driven path rather than replace it.

- **Files**:
  - `packages/kanban-lite/src/standalone/internal/http-contracts.ts` - retain as the built-in standalone contract registry
  - `packages/kanban-lite/src/standalone/internal/openapi-spec/build.ts` - retain as the spec aggregation point for built-ins plus plugin fragments
  - `scripts/generate-api-docs.ts` - keep as the generated-doc path for `docs/api.md`
  - `scripts/generate-openapi-types.ts` - keep as the generated TypeScript contract path
  - `packages/kanban-lite/src/sdk/remote/openapi-client.ts` and downstream HTTP consumers - limit cleanup to the current typed-client pipeline
- **Implementation**:
  - Finish full repo verification for the already-landed contract-driven changes.
  - Limit cleanup to remaining consumer drift, documentation wording, generated artifact sync, or follow-up parity work inside the existing OpenAPI pipeline.
  - Do not introduce controller files, decorator config, or framework rewrites while closing the remaining work.
- **Success**:
  - Verification is green for the current contract-driven implementation.
  - The shared Node, Worker, docs, and generated-type pipeline remains intact.
- **Research References**:
  - #file:../research/20260520-openapi-source-of-truth-research.md (Lines 124-131) - current reuse of the standalone contract across docs and remote consumers
  - #file:../research/20260520-openapi-source-of-truth-research.md (Lines 210-227) - the current standalone contract chain that should remain authoritative
  - #file:../research/20260520-openapi-source-of-truth-research.md (Lines 320-346) - recommended direction and implementation guidance for follow-up work
- **Dependencies**:
  - Phase 1 completion
  - Repo verification requirements from `AGENTS.md`

### Task 2.2: Treat any TSOA investigation as an isolated spike with explicit no-merge boundaries

If maintainers still want firsthand data, keep it isolated from the production standalone stack.

- **Files**:
  - `tmp/**` or another disposable spike-only location - hold any experiment away from the production standalone server
  - `.copilot-tracking/research/**` - capture findings from a spike without rewriting the mainline architecture plan
  - No production standalone runtime, plugin, Worker, or SDK files unless a later explicit task approves a migration
- **Implementation**:
  - Limit any spike to a non-plugin route and document the custom-template, middleware/auth, and decorator/compiler overhead.
  - Keep the spike disposable and out of the production build, release, and generated-contract path.
  - Require a follow-up decision before any production adoption or dependency changes.
- **Success**:
  - Exploration does not destabilize the current standalone pipeline.
  - The mainline HTTP contract remains single-source and contract-driven.
- **Research References**:
  - #file:../research/20260520-openapi-source-of-truth-research.md (Lines 229-239) - TSOA-specific configuration and template requirements this repo would inherit
  - #file:../research/20260520-openapi-source-of-truth-research.md (Lines 297-339) - repo-specific blockers, risks, and the “optional spike only” boundary
- **Dependencies**:
  - Explicit maintainer approval after Phase 1
  - Task 2.1 should not wait on the spike

## Dependencies

- Existing `packages/kanban-lite/src/standalone/internal/http-contracts.ts` registry
- Existing `StandaloneHttpPlugin.getOpenApiDocs()` plugin seam
- Existing `buildStandaloneOpenApiSpec()` plus `scripts/generate-openapi-types.ts` workflow
- Repo verification requirements in `AGENTS.md`

## Success Criteria

- Planning artifacts describe the current contract-driven architecture accurately.
- TSOA is explicitly rejected as the primary standalone migration target.
- Remaining follow-up work stays inside the current OpenAPI pipeline or inside an isolated spike only.
- Node server, Worker, docs generation, and generated client types keep sharing one standalone OpenAPI build path.
