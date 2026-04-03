# Mobile task-flow patterns

This document captures reusable interaction patterns for the field-worker mobile app. The goal is to keep implementation consistent across screens while preserving safe offline behavior, clear auth/sync state, and capability-based visibility.

## Shared interaction primitives

| Primitive | Use | Notes |
| --- | --- | --- |
| Neutral gate | Restore, deep-link entry, workspace switch, stale-session recovery | Never renders protected task content |
| Sticky bottom dock | Single most likely next action | One high-emphasis primary action at a time |
| Bottom sheet | Secondary actions, capture choices, destructive confirmation | Large rows, thumb reachable |
| Inline composer | Comments and small edits | Keeps the user near task context |
| Pending chip | Local-only unsent work | Distinct from synced server state |
| Conflict review sheet | Checklist/form/comment replay conflicts | Compare latest server state vs local draft |
| Sync banner | Offline, pending resend, failed resend | Only one banner at a time |

## Core state rules

- **Allowed + online:** execute against the existing REST contract.
- **Allowed + offline + safe to draft:** store a local draft or pending intent and require **explicit resend** later.
- **Allowed + offline + unsafe to replay:** keep the control visible but disabled with an online-required message.
- **Denied:** hide the mutating control; do not tease unreachable actions.
- **Hidden task:** replace the entire task view with the standard unavailable state.

## Flow 1: Cold start and restore

1. Open the app into the neutral gate.
2. Validate stored workspace and subject.
3. Revalidate session.
4. If validation succeeds, hydrate visible cached state and open the target screen.
5. If validation fails, purge mismatched protected caches before showing the next screen.

### Restore UI pattern

- Full-screen neutral shell
- Optional workspace chip once known
- No list items or task previews until validation succeeds

### Restore failure handling

- Stale session -> `Sign in`
- Wrong workspace -> `Switch workspace`
- Wrong user -> `Sign in with another account`
- Offline with no valid cache -> offline empty shell, not stale content

## Flow 2: My Work triage

1. Land on `My Work`.
2. Surface the highest urgency visible tasks first.
3. Let the worker tap the full card to open task detail.
4. If pending local work exists, pin it in `Needs attention` above the normal list.

### My Work pattern details

- Filters are chips, not dense dropdowns.
- Pull-to-refresh is allowed, but sync state must also be readable without performing the gesture.
- Empty state copy stays concise: `No assigned work right now.`

## Flow 3: Due-work triage

1. Land on `Due`.
2. Group visible tasks into `Overdue`, `Today`, and `Next`.
3. Collapse empty groups automatically.
4. Reuse the same card layout as `My Work` so task recognition is instant.

### Due pattern details

- Do not create a second visual language for due items.
- Overdue items get stronger urgency styling, but not a different interaction pattern.

## Flow 4: Deep link and QR entry

1. Enter through a link or QR scan.
2. Resolve workspace target.
3. Validate session for that workspace.
4. If auth is needed, complete auth before task detail mounts.
5. Revalidate task visibility.
6. Open task detail or show the unavailable state.

### Deep link special cases

- QR cancelled -> lightweight state with `Scan again`
- Invalid/expired link -> recovery copy with a retry path
- Wrong workspace -> neutral mismatch screen
- Wrong user -> reauth path before showing task data

## Flow 5: Comment create / update / delete

### Comment create

#### Comment create when online

1. Open inline composer.
2. Type comment.
3. Tap `Send`.
4. Append the server-confirmed comment in chronological order.

#### Comment create when offline

1. Open inline composer.
2. Save the comment as a local draft.
3. Show it in the thread with a `Pending` chip.
4. Require explicit resend later; do not auto-send on reconnect.

### Comment update (`comment.update`)

#### Comment update when online

- Launch an edit sheet from the comment overflow menu.
- Save in place after server confirmation.

#### Comment update when offline

- Allow a local edit draft.
- Mark the comment as `Edit pending`.
- On reconnect, ask the user to review and resend explicitly.

### Comment delete (`comment.delete`)

#### Comment delete when online

- Use a destructive confirmation sheet.
- Remove only after server confirmation.

#### Comment delete when offline

- Keep delete visible only if the capability is allowed.
- Disable the destructive action with `Needs a live connection.`
- Never queue comment deletion silently.

## Flow 6: Attachment capture / upload / remove

### Attachment add (`attachment.add`)

#### Attachment add entry order

1. `Take photo`
2. `Scan document`
3. `Choose file`

#### Attachment add pattern

- Open a capture sheet with large rows and previews.
- After capture, copy the asset into an app-owned durable draft location immediately.
- Show a preview tile with upload state.

#### Attachment add offline behavior

- Durable local draft is allowed.
- Show `Saved on this device` until the user explicitly resends when online.
- Do not imply the server already has the attachment.

### Attachment remove (`attachment.remove`)

#### For a synced server attachment

- Removal is destructive and server-backed.
- Require online confirmation before removal.
- If offline, disable the remove control with a reconnect message.

#### For a local unsent draft attachment

- `Discard draft` is always allowed because it is device-local, not a server mutation.
- Keep `Discard draft` visually distinct from server-backed `Remove attachment`.

## Flow 7: Form fill and submit (`form.submit`)

1. Open the form section.
2. Keep input fields large, stacked, and readable in dark mode.
3. Save in-progress input locally as a draft while editing.
4. Submit only from an explicit primary action.

### Form submit online behavior

- `Submit` calls the existing task form submit endpoint.
- Server validation errors appear inline and preserve the local draft.

### Form submit offline behavior

- Replace `Submit` with `Save draft` when the user has no connection.
- Keep the draft local until the worker explicitly reviews and submits when online.
- Never background-submit a form automatically after reconnect.

### Form submit denied behavior

- Keep the form section read-only when relevant task data should still be visible.
- Hide the submit CTA entirely when `form.submit` is denied.

## Flow 8: Checklist show / add / edit / delete / check / uncheck

### Checklist visibility (`card.checklist.show`)

- If allowed, render the checklist as its own section near the top of task detail.
- If denied, hide the entire checklist section and any checklist preview/count.

### Checklist add / edit / delete / check / uncheck

Use one consistent pattern for all checklist mutations:

1. Apply the change locally as a **pending intent**.
2. Mark the affected item with a pending visual treatment:
   - dotted outline,
   - muted pending chip,
   - or `Pending sync` helper text.
3. Keep the change separate from confirmed server state.
4. Require explicit resend when the connection returns.
5. If the server rejects the resend because `expectedToken` or `expectedRaw` is stale, open the conflict review sheet.

#### Per-action guidance

- `card.checklist.add`: show a full-width add row; offline adds become pending items
- `card.checklist.edit`: edit in place or in a small sheet; offline edits become `Edit pending`
- `card.checklist.delete`: mark as `Pending removal` with undo until resent
- `card.checklist.check`: show the checked state with a pending chip until confirmed
- `card.checklist.uncheck`: same as check, but for reopening work

## Flow 9: Card action trigger (`card.action.trigger`)

This flow is always **online-only**.

### Action trigger when online

1. Show the action in the bottom dock or actions sheet.
2. Trigger the existing action endpoint.
3. Surface success/failure clearly.

### Action trigger when offline

- Keep the action visible if the caller is authorized.
- Disable it with `Needs a live connection.`
- Never queue `card.action.trigger` for replay.

### Action trigger when denied

- Hide the action button completely.
- Do not show disabled ghost actions for unauthorized users.

## Flow 10: Conflict recovery

Use the same conflict pattern for comments, forms, and checklist mutations that can be retried safely.

1. Show a conflict banner: `This task changed somewhere else.`
2. Open a review sheet with:
   - latest server state,
   - local pending draft,
   - clear next actions.
3. Offer:
   - `Review latest`
   - `Retry with latest`
   - `Discard local draft`

Rules:

- Conflicts must never silently overwrite newer server state.
- The worker must understand whether data is local-only, server-confirmed, or blocked.

## Flow 11: Auth loss and denied-task recovery

### Session expired

- Show a full-screen auth recovery state.
- Keep the original destination in memory, but do not render it until revalidation succeeds.

### Task denied or hidden

- Replace the task detail screen with `This task is no longer available for your account.`
- Provide a direct path back to `My Work`.

### Wrong user / wrong workspace during restore

- Show a neutral correction screen.
- Explain the mismatch without exposing cached task content.

## Anti-patterns

Avoid these implementation choices:

- auto-retrying drafts without explicit worker consent
- swipe-only destructive actions with no visible alternative
- mixing local pending state into confirmed server counts without a clear marker
- using offline banners as the only indicator of unsent work
- hiding auth/session problems behind generic `Something went wrong` copy
