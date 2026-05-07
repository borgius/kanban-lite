---
description: 'Implement the All Boards overview page plan for Kanban Lite.'
mode: agent
model: Claude Sonnet 4
argument-hint: 'Optional scope notes or review-stop preferences'
---

<!-- markdownlint-disable-file -->

# Implementation Prompt: All Boards Overview Page

## Implementation Instructions

### Step 1: Create Changes Tracking File

You WILL create `20260506-all-boards-overview-page-changes.md` in #file:../changes/ if it does not exist.

### Step 2: Execute Implementation

You WILL follow #file:../../.github/instructions/task-implementation.instructions.md
You WILL systematically implement #file:../plans/20260506-all-boards-overview-page-plan.instructions.md task-by-task
You WILL follow ALL project standards and conventions

**CRITICAL**: If ${input:phaseStop:true} is true, you WILL stop after each Phase for user review.
**CRITICAL**: If ${input:taskStop:false} is true, you WILL stop after each Task for user review.

During implementation you WILL:

1. Keep board-summary aggregation in the SDK first, then wire REST, CLI, MCP, and webview usage to that shared capability.
2. Add a lazy overview-loading transport instead of expanding the normal active-board `init` payload.
3. Add a routed all-boards page and toolbar dropdown entry without regressing existing board/settings flows.
4. Treat notification counts as actor-scoped unread counts and preserve an explicit unavailable state instead of faking zeroes.
5. Update `README.md` and `CHANGELOG.md` for the user-facing feature.
6. Run the required verification commands before marking the work complete.

### Step 3: Cleanup

When ALL Phases are checked off (`[x]`) and completed you WILL do the following:

1. You WILL provide a markdown style link and a summary of all changes from #file:../changes/20260506-all-boards-overview-page-changes.md to the user:

   - You WILL keep the overall summary brief
   - You WILL add spacing around any lists
   - You MUST wrap any reference to a file in a markdown style link

2. You WILL provide markdown style links to .copilot-tracking/plans/20260506-all-boards-overview-page-plan.instructions.md, .copilot-tracking/details/20260506-all-boards-overview-page-details.md, and .copilot-tracking/research/20260506-all-boards-overview-page-research.md documents. You WILL recommend cleaning these files up as well.
3. **MANDATORY**: You WILL attempt to delete .copilot-tracking/prompts/implement-all-boards-overview-page.prompt.md

## Success Criteria

- [ ] Changes tracking file created
- [ ] All plan items implemented with working code
- [ ] All detailed specifications satisfied
- [ ] Project conventions followed
- [ ] Changes file updated continuously
