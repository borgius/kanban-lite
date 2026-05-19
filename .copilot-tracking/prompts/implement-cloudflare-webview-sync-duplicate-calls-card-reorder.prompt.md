---
description: 'Implement the Cloudflare hybrid sync dedup fix for repeated webview-sync calls and card-order bounce.'
mode: agent
model: Claude Sonnet 4
---

<!-- markdownlint-disable-file -->

# Implementation Prompt: Cloudflare Webview Sync Duplicate Calls and Card Reorder

## Task Overview

Implement the validated Cloudflare hybrid sync fix so the originating tab no longer replays redundant `POST /api/webview-sync` snapshot requests after its own successful mutation, while preserving cross-tab freshness, reconnect-driven resyncs, and move-card ordering stability.

## Implementation Instructions

### Step 1: Create Changes Tracking File

You WILL create `20260513-cloudflare-webview-sync-duplicate-calls-card-reorder-changes.md` in #file:../changes/ if it does not exist.

### Step 2: Execute Implementation

You WILL follow #file:../../.github/instructions/task-implementation.instructions.md
You WILL systematically implement #file:../plans/20260513-cloudflare-webview-sync-duplicate-calls-card-reorder-plan.instructions.md task-by-task
You WILL use #file:../details/20260513-cloudflare-webview-sync-duplicate-calls-card-reorder-details.md for the concrete file targets, success criteria, dependencies, and regression scope
You WILL use #file:../research/20260513-cloudflare-webview-sync-duplicate-calls-card-reorder-research.md as the source of truth for the verified transport flow, root cause, Cloudflare constraints, and recommended fix direction
You WILL follow ALL project standards and conventions

**CRITICAL**: If ${input:phaseStop:true} is true, you WILL stop after each Phase for user review.
**CRITICAL**: If ${input:taskStop:false} is true, you WILL stop after each Task for user review.

### Step 3: Cleanup

When ALL Phases are checked off (`[x]`) and completed you WILL do the following:

1. You WILL provide a markdown style link and a summary of all changes from #file:../changes/20260513-cloudflare-webview-sync-duplicate-calls-card-reorder-changes.md to the user:

   - You WILL keep the overall summary brief
   - You WILL add spacing around any lists
   - You MUST wrap any reference to a file in a markdown style link

2. You WILL provide markdown style links to .copilot-tracking/plans/20260513-cloudflare-webview-sync-duplicate-calls-card-reorder-plan.instructions.md, .copilot-tracking/details/20260513-cloudflare-webview-sync-duplicate-calls-card-reorder-details.md, and .copilot-tracking/research/20260513-cloudflare-webview-sync-duplicate-calls-card-reorder-research.md documents. You WILL recommend cleaning these files up as well.
3. **MANDATORY**: You WILL attempt to delete .copilot-tracking/prompts/implement-cloudflare-webview-sync-duplicate-calls-card-reorder.prompt.md

## Success Criteria

- [ ] Changes tracking file created
- [ ] All plan items implemented with working code
- [ ] Cloudflare hybrid mode no longer echoes a redundant origin-tab `syncRequired` refresh after the same successful local mutation
- [ ] Other sessions still receive live-sync invalidations and refresh correctly
- [ ] Move-card order bounce caused by duplicate authoritative snapshots is covered by regression tests
- [ ] Project conventions followed
- [ ] Changes file updated continuously
