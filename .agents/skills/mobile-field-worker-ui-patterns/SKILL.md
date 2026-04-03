---
name: mobile-field-worker-ui-patterns
description: 'Modern field-worker mobile UI/UX patterns for Kanban Lite. Use when designing, reviewing, or refining React Native or Expo mobile screens for field workers, iOS, Android, safe area, navigation, gestures, deep links, offline sync, camera, QR, task detail, forms, comments, attachments, or checklist flows.'
license: MIT
metadata:
  author: kanban-lite
  version: "1.0.0"
---

# Mobile Field-Worker UI Patterns

Use this skill when the user wants **mobile design guidance** for Kanban Lite field-worker flows rather than generic desktop-kanban UI.

## When to Use

Use when the request mentions any of these ideas:

- React Native or Expo mobile UI
- field-worker flows on iOS or Android
- safe area, bottom navigation, thumb reach, or large tap targets
- gestures, bottom sheets, action docks, or mobile task detail
- deep links, QR entry, restore gate, or session-aware task opening
- offline sync, pending drafts, conflict review, or reconnect states
- camera-first attachments, document capture, or QR scanning
- mobile comments, checklist, forms, or attachment workflows

## Repo Truths to Anchor On

Start from these workspace documents before inventing new patterns:

- `docs/mobile-field-worker-ui.md`
- `docs/mobile-task-flow-patterns.md`
- `docs/mobile-permission-visibility-matrix.md`
- `docs/mobile-v1-auth-contract.md`

Treat these as the current mobile UX contract:

- mobile is **assigned-work first**, not a desktop board clone
- the shell is **thumb-first** and **camera-first**
- safe offline behavior means **explicit resend**, not silent replay
- `auth.visibility` decides whether a task exists for the caller at all
- capability checks decide whether controls show, hide, or become read-only
- protected content must never flash before workspace, subject, and session validation

## Procedure

1. **Pick the mobile surface first.**
   - Choose one of the approved flows: restore gate, `My Work`, `Due`, task detail, deep-linked open, QR open, or account/sync.
   - Do not design a new top-level information architecture unless the request explicitly changes the product contract.

2. **Design for one-handed field use.**
   - Keep the primary action in the bottom thumb zone.
   - Respect safe area insets at the top and bottom.
   - Use large tap targets: at least `48x48 pt`, preferably roomier for gloves and outdoor use.
   - Prefer one high-emphasis primary action at a time.

3. **Prefer mobile-native structure over dense desktop chrome.**
   - Use a single-column task execution layout.
   - Prefer bottom sheets for secondary or destructive actions.
   - Avoid hover affordances, tiny inline icon rows, cramped toolbars, and multi-column task detail panels.

4. **Make state impossible to miss.**
   - Show sync, auth, offline, pending resend, and conflict states explicitly.
   - Keep only one dominant warning banner at a time.
   - If the app is validating session or workspace state, show a neutral shell instead of cached task content.

5. **Keep deep links and QR opens safe.**
   - Route link and QR entry through the neutral restore gate first.
   - Resolve workspace target, validate session, re-check task visibility, then mount task detail.
   - Never show a stale task title while validation is still in flight.

6. **Use capability-first control rules.**
   - If `auth.visibility` denies the task, omit or replace the whole task view.
   - If a mutation capability is denied, hide that control.
   - If a mutation is allowed but offline, either switch to a local-draft flow or disable it with clear copy.
   - Only show read-only sections when the task itself remains visible.

7. **Keep capture flows fast.**
   - Prefer `Take photo`, then `Scan document`, then `Choose file`.
   - Treat camera, QR, and attachment capture as first-class field-worker actions.
   - Store unsent capture results as durable local drafts and label them clearly.

8. **Finish with a mobile-specific review pass.**
   - Check dark-mode contrast and outdoor legibility.
   - Check keyboard overlap, safe area clearance, and sticky bottom action behavior.
   - Check that copy is short, calm, and explicit during offline or auth recovery.

## Good Defaults

Reach for these defaults unless the request says otherwise:

- three-tab bottom navigation: `My Work`, `Due`, `Account`
- sticky bottom action dock for the single most likely next action
- full-card tap targets for task list items
- chip-based filtering instead of dense dropdowns
- bottom sheets for secondary actions and destructive confirmations
- dark-first surfaces with high-contrast text and badges

## Avoid

Avoid these patterns unless the request explicitly requires them:

- desktop board metaphors copied into mobile
- protected-content flash during restore, reauth, workspace switch, deep links, or QR opens
- silent offline replay of destructive or irreversible side effects
- multiple competing primary buttons in the same view
- tiny icon-only navigation or icon-only destructive actions
- capability decisions based on guessed role names instead of actual action gates

## Done When

The proposed design is ready when:

- the flow matches one of the approved mobile surfaces
- safe area, navigation, gestures, and bottom actions are intentional
- offline sync, auth, and conflict states are visible and understandable
- deep links, QR, camera, and form/checklist/comment actions follow the repo’s contracts
- the solution feels like a field-worker mobile app, not a squeezed desktop page
