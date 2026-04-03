# Mobile field-worker UI blueprint

This document is the implementation-ready UX contract for the Kanban Lite mobile app's field-worker surfaces. It defines the mobile-first information architecture, screen blueprints, component rules, and system-state behavior for `My Work`, `Due`, deep-linked task opens, and task-detail execution.

## Product stance

- **Assigned-work first:** mobile starts from the worker's visible assigned tasks, not from a desktop board clone.
- **Thumb-first:** the default path must be comfortable one-handed on modern iPhone and Android devices.
- **Camera-first:** capture flows prioritize photo and document intake before generic file picking.
- **Visibility-safe:** `auth.visibility` controls whether a task exists for the caller at all; the app must never flash protected cached content before validation.
- **Capability-driven controls:** the task can be visible while individual controls remain hidden or read-only. Control visibility is defined in `docs/mobile-permission-visibility-matrix.md`.
- **Explicit trust state:** sync, auth, offline, conflict, and deep-link status must always be visible.
- **Dark mode by default:** dark surfaces, high contrast, and outdoor legibility are baseline requirements, not polish.
- **Safe offline behavior:** drafts can be stored locally, but side effects must not replay implicitly.

## Experience goals

1. Let a worker open the app and reach the next task in under two taps.
2. Keep the primary action in the bottom thumb zone on every task detail screen.
3. Make camera capture faster than navigating a generic file picker.
4. Make offline, stale-session, and conflict states impossible to miss.
5. Preserve a calm, neutral shell during restore, deep-link resolution, wrong-user handling, and denied task opens.

## Top-level navigation model

### Primary routes

| Route | Purpose | Notes |
| --- | --- | --- |
| Restore gate | Validate stored workspace + subject before any protected content mounts | Neutral shell only; never show cached task titles before validation succeeds |
| `My Work` | Default landing screen for assigned work | Primary home screen |
| `Due` | Overdue, due today, and due soon work | Same card pattern as `My Work`, different grouping |
| Task detail | Complete work on a single task | Reached from list, deep link, QR, or reconnect recovery |
| Account & sync | Workspace identity, connection, resend queue, sign out | No board/admin controls in v1 |

### Bottom navigation

Use a **three-tab bottom bar** with large labels and icons:

1. **My Work**
2. **Due**
3. **Account**

Rules:

- Bottom bar height: **64-72 pt** inclusive of safe-area padding.
- Tap target per tab: **at least 48x48 pt**, preferably **56 pt** high.
- The active tab label remains visible at all times; do not rely on icon-only navigation.
- A **pending resend pill** may float above the bottom bar, but it does not replace the main navigation.

## Screen blueprints

### 1. Restore and auth gate

This is the first screen on cold start, deep-link entry, resume, and workspace switch.

#### What it shows

- App mark
- Workspace chip only after the workspace target is known
- Progress state (`Checking session…`, `Opening workspace…`, `Refreshing permissions…`)
- Neutral background illustration or subtle skeleton blocks
- No task names, counts, comments, attachments, or checklist snippets

#### Why this exists

The app must avoid protected-content flash while validating:

- stored credentials,
- current workspace,
- current subject,
- and visible-task access.

#### Allowed transitions

- Validation success -> `My Work`, `Due`, or the deep-linked task
- Validation failure -> auth challenge or recovery screen
- Workspace mismatch -> mismatch recovery screen before any cached content appears
- Wrong user -> account correction screen before any cached content appears

### 2. `My Work`

`My Work` is the mobile home screen and should feel like a prioritized task inbox rather than a board.

#### Layout

- Top app bar with workspace name, sync state chip, and optional avatar/account shortcut
- Large page title: `My Work`
- Sticky filter chips in the first scroll region:
  - `All`
  - `Due today`
  - `Needs sync`
  - `With checklist`
  - `With forms`
- Section order:
  1. **Needs attention** — pending resend, conflicts, blocked items
  2. **Due now** — overdue or due today
  3. **Up next** — assigned items without immediate urgency
  4. **Recently updated** — latest visible activity

#### Task card design

Each task card should show:

- title
- status/column pill derived from visible task state
- due badge
- optional site/location metadata
- compact indicators for comments, attachments, forms, checklist progress
- last sync freshness if offline or stale

#### Interaction rules

- Entire card is a single large tap target.
- Secondary row actions are limited to non-destructive quick actions that remain in the thumb zone.
- Do not use dense desktop table rows, hover affordances, or tiny inline icon buttons.

### 3. `Due`

`Due` reuses the same card design as `My Work` but groups by urgency instead of assignment context.

#### Sections

1. **Overdue**
2. **Today**
3. **Tomorrow / next**

#### Behavior

- Empty sections collapse automatically.
- If all sections are empty, show a positive empty state: `Nothing due right now.`
- If offline, keep the last synced grouping and mark the screen as cached.

### 4. Deep-linked and QR task opens

Deep-link and QR flows always enter through the neutral gate first.

#### Required sequence

1. Resolve workspace target
2. Validate session for that workspace
3. If needed, present auth challenge
4. Revalidate task visibility
5. Open task detail only after the task is confirmed visible

#### Never do this

- mount cached task detail before workspace/subject validation,
- show a stale task title while checking a link,
- or briefly show one workspace's cached content while opening another.

### 5. Task detail

Task detail is a **single-column execution workspace** optimized for gloved/outdoor and one-handed use.

#### Section order

1. Task summary
2. Sync / auth / conflict banner (when needed)
3. Checklist (if `card.checklist.show` allows it)
4. Form section
5. Attachments
6. Comments
7. Online-only actions

#### Task summary card

The top summary card includes:

- title
- status pill
- due state
- assignee summary
- location / metadata chips
- latest sync timestamp
- permission-safe indicators only

#### Bottom action dock

Use a sticky bottom dock for the most likely next action.

Priority order:

1. **Submit form** when the current step is form-centric and `form.submit` is allowed
2. **Add checklist item / update checklist** when checklist work is primary
3. **Take photo** when attachment capture is a core path and `attachment.add` is allowed
4. **Add comment** when discussion is the likely next step
5. **Run action** only when `card.action.trigger` is allowed and the task defines an action worth surfacing

Rules:

- Primary button height: **56 pt** minimum
- Sticky dock must clear safe-area inset
- Only one high-emphasis primary button at a time
- Additional actions live in a bottom sheet, not in a dense icon toolbar

## Component and interaction rules

### Touch and spacing

| Element | Minimum spec |
| --- | --- |
| Tap target | `48x48 pt` minimum |
| Primary button height | `56 pt` |
| List row height | `72 pt` preferred for task rows |
| Section header action tap target | `44x44 pt` minimum |
| Bottom sheet grab area | `24 pt` high plus safe spacing |
| Horizontal padding | `16 pt` compact, `20 pt` roomy |

### Typography

- Page title: large, high-contrast, short (`My Work`, `Due`, `Account`)
- Card title: readable at arm's length; avoid ultra-light weights
- Helper text: never below accessible minimum sizing
- Timestamps and sync text should remain readable in direct sunlight and dark mode

### Visual tokens

Use semantic tokens rather than hardcoded component colors.

| Token | Light intent | Dark intent |
| --- | --- | --- |
| `bg.app` | neutral warm/gray canvas | deep navy/graphite canvas |
| `bg.surface` | elevated white surface | elevated blue-gray surface |
| `text.primary` | near-black | near-white |
| `text.secondary` | muted gray | muted cool gray |
| `border.subtle` | low-contrast border | low-contrast edge highlight |
| `state.success` | synced / success | synced / success |
| `state.warning` | offline / stale | offline / stale |
| `state.danger` | denied / failed | denied / failed |
| `state.info` | pending / in progress | pending / in progress |

### Camera-friendly attachment pattern

- First attachment CTA is **Take photo**.
- Second CTA is **Scan document** when supported.
- Third CTA is **Choose file**.
- Show the capture sheet as a bottom sheet with big rows and clear thumbnails.
- Once a capture is taken, create a durable local draft copy immediately and show a local preview before upload state resolves.

## System-state contract

The app must make trust states visible without flooding the screen. Use a single banner or shell message per state, not stacked warning soup.

| Situation | Surface | Required copy | Primary action |
| --- | --- | --- | --- |
| Cold start validation | Neutral restore gate | `Checking your session…` | None |
| Deep link resolving | Neutral restore gate | `Opening task…` | None |
| Offline with cached work | Screen banner | `Offline — showing last synced work.` | `Retry sync` |
| Pending resend exists | Banner or pill | `Saved on this device. Review before sending.` | `Review` |
| Conflict after reconnect | Banner + sheet | `This task changed somewhere else.` | `Review latest` |
| Session expired | Full-screen state | `Your session expired. Sign in again to continue.` | `Sign in` |
| Wrong workspace on restore | Full-screen state | `This device has saved work for a different workspace.` | `Switch workspace` |
| Wrong user on restore | Full-screen state | `This task is not available for the current account.` | `Sign in with another account` |
| QR cancelled | Lightweight state | `QR scan cancelled.` | `Scan again` |
| Task hidden or denied | Full-screen state | `This task is no longer available for your account.` | `Back to My Work` |
| Online-only action while offline | Inline helper on action button | `Needs a live connection.` | `Try again online` |

## Visibility and permission model summary

1. **Task existence comes first.** If `auth.visibility` denies the task, the task behaves as unavailable or not found.
2. **Section visibility comes second.** Example: if `card.checklist.show` is denied, the checklist section and any checklist count indicators stay hidden.
3. **Control visibility comes third.** Example: comments may remain visible while edit/delete affordances are hidden.
4. **Temporary unavailability is not the same as denial.** If a control is allowed but the device is offline, show a disabled state or a local-draft path as defined in `docs/mobile-task-flow-patterns.md`.
5. **The app must not infer policy from role names alone.** Role names are examples; per-capability decisions remain authoritative.

## Anti-patterns

Do not ship any of the following in mobile v1:

- desktop board columns squeezed into phone width
- hover-only controls or hidden swipe-only destructive actions
- tiny icon-only affordances for primary work
- optimistic flash of cached protected content before session/visibility validation
- silent background replay of destructive or side-effecting operations
- offline queuing for `card.action.trigger`

## Related documents

- `docs/mobile-task-flow-patterns.md`
- `docs/mobile-permission-visibility-matrix.md`
- `docs/PRD.yaml`
