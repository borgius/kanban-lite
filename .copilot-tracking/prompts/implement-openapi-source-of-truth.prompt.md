---
description: 'Align the standalone OpenAPI plan with the implemented contract-driven architecture and record the TSOA decision.'
mode: agent
model: Claude Sonnet 4
---

<!-- markdownlint-disable-file -->

# Implementation Prompt: OpenAPI Source of Truth for HTTP Contracts and Remote SDK Calls

## Task Overview

Keep the current contract-driven standalone OpenAPI pipeline as the production path, sync the tracking docs with the implemented architecture, and explicitly record that TSOA is not the selected migration target for the standalone API.

## Guardrails

- Do NOT add `tsoa`, `@tsoa/runtime`, controller discovery, decorator compiler flags, or a custom Hono route template as part of this task.
- Do NOT replace `packages/kanban-lite/src/standalone/internal/http-contracts.ts` or `StandaloneHttpPlugin.getOpenApiDocs()` as the mainline contract source.
- Do keep `KanbanSDK` as the behavior source of truth and the standalone OpenAPI pipeline as the HTTP contract source of truth.
- If a TSOA proof-of-concept is explicitly requested later, keep it isolated from production runtime and build paths and document clear no-merge boundaries.

## Implementation Instructions

### Step 1: Create Changes Tracking File

You WILL create `20260520-openapi-source-of-truth-changes.md` in #file:../changes/ if it does not exist.
You WILL keep that file aligned with the actual implementation state before closing work.

### Step 2: Execute Implementation

You WILL follow #file:../../AGENTS.md and #file:../../.github/instructions/core-surface.instructions.md
You WILL systematically implement #file:../plans/20260520-openapi-source-of-truth-plan.instructions.md task-by-task
You WILL use #file:../details/20260520-openapi-source-of-truth-details.md for the concrete file targets, success criteria, and dependencies
You WILL use #file:../research/20260520-openapi-source-of-truth-research.md as the source of truth for the current contract-driven architecture, TSOA decision, and remaining follow-up scope
You WILL follow ALL project standards and conventions

**CRITICAL**: If ${input:phaseStop:true} is true, you WILL stop after each Phase for user review.
**CRITICAL**: If ${input:taskStop:false} is true, you WILL stop after each Task for user review.

### Step 3: Cleanup

When ALL Phases are checked off (`[x]`) and completed you WILL do the following:

1. You WILL provide a markdown style link and a summary of all changes from #file:../changes/20260520-openapi-source-of-truth-changes.md to the user:

   - You WILL keep the overall summary brief
   - You WILL add spacing around any lists
   - You MUST wrap any reference to a file in a markdown style link

2. You WILL provide markdown style links to .copilot-tracking/plans/20260520-openapi-source-of-truth-plan.instructions.md, .copilot-tracking/details/20260520-openapi-source-of-truth-details.md, and .copilot-tracking/research/20260520-openapi-source-of-truth-research.md documents. You WILL recommend cleaning these files up as well.
3. **MANDATORY**: You WILL attempt to delete .copilot-tracking/prompts/implement-openapi-source-of-truth.prompt.md

## Success Criteria

- [ ] Changes tracking file is aligned with actual implementation state
- [ ] Planning and documentation artifacts reflect the current contract-driven architecture
- [ ] TSOA is explicitly ruled out as the primary standalone migration path
- [ ] Any remaining follow-up work stays within the current OpenAPI pipeline or an explicitly isolated spike
- [ ] Project conventions followed
- [ ] Changes file updated continuously
