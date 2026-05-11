---
description: 'Implement the cross-board card ID collision guard in the shared SDK create path.'
mode: agent
model: Claude Sonnet 4
---

<!-- markdownlint-disable-file -->

# Implementation Prompt: Cross-Board Card ID Uniqueness

## Task Overview

Implement the validated fix for cross-board card ID uniqueness so `createCard(...)` never reuses an ID that already exists on another board, even when the workspace-level counter is stale.

## Implementation Instructions

### Step 1: Create Changes Tracking File

You WILL create `20260511-cross-board-card-id-uniqueness-changes.md` in #file:../changes/ if it does not exist.

### Step 2: Execute Implementation

You WILL follow #file:../../.github/instructions/task-implementation.instructions.md
You WILL systematically implement #file:../plans/20260511-cross-board-card-id-uniqueness-plan.instructions.md task-by-task
You WILL use #file:../details/20260511-cross-board-card-id-uniqueness-details.md for the concrete file targets, success criteria, and dependencies
You WILL use #file:../research/20260511-cross-board-card-id-uniqueness-research.md as the source of truth for root cause, storage seams, collision-recovery guidance, and test scope
You WILL follow ALL project standards and conventions

**CRITICAL**: If ${input:phaseStop:true} is true, you WILL stop after each Phase for user review.
**CRITICAL**: If ${input:taskStop:false} is true, you WILL stop after each Task for user review.

### Step 3: Cleanup

When ALL Phases are checked off (`[x]`) and completed you WILL do the following:

1. You WILL provide a markdown style link and a summary of all changes from #file:../changes/20260511-cross-board-card-id-uniqueness-changes.md to the user:

   - You WILL keep the overall summary brief
   - You WILL add spacing around any lists
   - You MUST wrap any reference to a file in a markdown style link

2. You WILL provide markdown style links to .copilot-tracking/plans/20260511-cross-board-card-id-uniqueness-plan.instructions.md, .copilot-tracking/details/20260511-cross-board-card-id-uniqueness-details.md, and .copilot-tracking/research/20260511-cross-board-card-id-uniqueness-research.md documents. You WILL recommend cleaning these files up as well.
3. **MANDATORY**: You WILL attempt to delete .copilot-tracking/prompts/implement-cross-board-card-id-uniqueness.prompt.md

## Success Criteria

- [ ] Changes tracking file created
- [ ] All plan items implemented with working code
- [ ] Card creation skips IDs already used on other boards when the global counter is stale
- [ ] Regression tests cover stale-counter recovery and global counter advancement
- [ ] Project conventions followed
- [ ] Changes file updated continuously