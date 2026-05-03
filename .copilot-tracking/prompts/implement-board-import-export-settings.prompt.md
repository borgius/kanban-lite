---
description: 'Implement board settings import/export across SDK, settings UI, and parity surfaces.'
mode: agent
model: Claude Sonnet 4
---

<!-- markdownlint-disable-file -->

# Implementation Prompt: Board Import/Export in Settings Page

## Task Overview

Implement JSON-based board settings export/import for the board settings page using the validated research, SDK-first architecture, and parity requirements already captured for this task.

## Implementation Instructions

### Step 1: Create Changes Tracking File

You WILL create `20260502-board-import-export-settings-changes.md` in #file:../changes/ if it does not exist.

### Step 2: Execute Implementation

You WILL follow #file:../../.github/instructions/task-implementation.instructions.md
You WILL systematically implement #file:../plans/20260502-board-import-export-settings-plan.instructions.md task-by-task
You WILL use #file:../details/20260502-board-import-export-settings-details.md for the concrete file targets, success criteria, and dependencies
You WILL use #file:../research/20260502-board-import-export-settings-research.md as the source of truth for scope, payload design, host file-flow patterns, and parity requirements
You WILL follow ALL project standards and conventions

**CRITICAL**: If ${input:phaseStop:true} is true, you WILL stop after each Phase for user review.
**CRITICAL**: If ${input:taskStop:false} is true, you WILL stop after each Task for user review.

### Step 3: Cleanup

When ALL Phases are checked off (`[x]`) and completed you WILL do the following:

1. You WILL provide a markdown style link and a summary of all changes from #file:../changes/20260502-board-import-export-settings-changes.md to the user:

   - You WILL keep the overall summary brief
   - You WILL add spacing around any lists
   - You MUST wrap any reference to a file in a markdown style link

2. You WILL provide markdown style links to .copilot-tracking/plans/20260502-board-import-export-settings-plan.instructions.md, .copilot-tracking/details/20260502-board-import-export-settings-details.md, and .copilot-tracking/research/20260502-board-import-export-settings-research.md documents. You WILL recommend cleaning these files up as well.
3. **MANDATORY**: You WILL attempt to delete .copilot-tracking/prompts/implement-board-import-export-settings.prompt.md

## Success Criteria

- [ ] Changes tracking file created
- [ ] All plan items implemented with working code
- [ ] Board settings JSON export/import works across the intended host surfaces
- [ ] Tests cover SDK behavior, UI wiring, host file flows, and standalone end-to-end restore
- [ ] Project conventions followed
- [ ] Changes file updated continuously
