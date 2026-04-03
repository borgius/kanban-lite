# Mobile permission and visibility matrix

This document defines how the mobile app decides whether to show, hide, disable, or render read-only task-detail controls. It complements `docs/mobile-field-worker-ui.md` and `docs/mobile-task-flow-patterns.md`.

## Source-of-truth rules

1. **`auth.visibility` decides whether the task exists for the caller.** If a task is hidden, mobile treats it as unavailable/not found.
2. **Capability checks decide control visibility.** The app must not hardcode role names as the authority.
3. **Built-in RBAC role names are examples only.** In the shipped matrix, `user`, `manager`, and `admin` all include the listed field-worker mutation capabilities, but custom policies may differ.
4. **Denied is different from temporarily unavailable.**
   - **Denied** -> hide the mutating control
   - **Allowed but offline** -> disable or switch to a local-draft flow, depending on safety
   - **Allowed but in-flight** -> disable with progress feedback
5. **No stale-content flash.** When session, workspace, or subject validation is incomplete, the app shows a neutral shell instead of cached protected content.

## Example capability profiles

| Profile | Task visibility | Field-worker mutation capabilities | Mobile result |
| --- | --- | --- | --- |
| Unauthenticated or stale session | None until revalidated | None | Neutral shell or sign-in recovery |
| Visible read-only worker (custom policy example) | Visible tasks only | No mutation capabilities | Task content visible, mutating controls hidden |
| Built-in `user` | Visible tasks only | Includes comment, attachment, form, checklist, and card action capabilities | Full field-worker task flow |
| Built-in `manager` | Visible tasks only | Inherits built-in `user` capabilities | Same mobile task-detail controls as `user` |
| Built-in `admin` | Visible tasks only | Inherits built-in `manager` + `user` capabilities | Same field-worker controls; admin-only config stays out of mobile v1 |

## Global visibility gates

| Surface | Gate | Allowed behavior | Denied behavior |
| --- | --- | --- | --- |
| Task card in `My Work` / `Due` | `auth.visibility` | Render task card | Omit task entirely |
| Deep-linked task open | `auth.visibility` after workspace/session validation | Open task detail | Show unavailable state |
| Restore from cached task | workspace + subject + session validation | Hydrate the matching caller-scoped cache | Purge mismatched cache before render |
| Checklist section presence | `card.checklist.show` | Render checklist section | Hide checklist section and checklist indicators |

## Control visibility matrix

| Surface / control | Protected action | If visible task + allowed | If visible task + denied | Offline behavior | Built-in RBAC example |
| --- | --- | --- | --- | --- | --- |
| Add comment composer | `comment.create` | Show composer and `Send` | Hide composer | Allow local draft and explicit resend later | `user`, `manager`, `admin` |
| Edit comment action | `comment.update` | Show edit affordance only on comments the current caller may mutate; open edit sheet/composer | Hide edit affordance | Allow local edit draft; mark `Edit pending`; explicit resend required | `user`, `manager`, `admin` |
| Delete comment action | `comment.delete` | Show destructive action in comment overflow with confirmation | Hide delete affordance | Keep visible only if allowed, but disable with `Needs a live connection.`; do not queue delete | `user`, `manager`, `admin` |
| Add attachment | `attachment.add` | Show `Take photo`, `Scan document`, and `Choose file` entry points | Hide capture entry points | Allow durable local draft copy and explicit resend later | `user`, `manager`, `admin` |
| Remove synced attachment | `attachment.remove` | Show `Remove attachment` on synced server attachments | Hide remove affordance | Disable with `Needs a live connection.`; do not queue removal | `user`, `manager`, `admin` |
| Discard unsent attachment draft | Device-local only | Show `Discard draft` for local unsent attachments | N/A | Always allowed because no server mutation occurs | Not policy-gated |
| Submit form CTA | `form.submit` | Show editable form inputs and `Submit` CTA | Hide submit CTA; render read-only summary when form data is relevant | Replace submit with `Save draft`; explicit online resend required later | `user`, `manager`, `admin` |
| Checklist section | `card.checklist.show` | Show checklist section near top of task detail | Hide section completely | Cached checklist may be shown only after the task itself is validated | `user`, `manager`, `admin` |
| Add checklist item | `card.checklist.add` | Show add row / add button | Hide add affordance | Allow pending local add intent and explicit resend later | `user`, `manager`, `admin` |
| Edit checklist item | `card.checklist.edit` | Show edit affordance for editable items | Hide edit affordance | Allow pending local edit intent and explicit resend later | `user`, `manager`, `admin` |
| Delete checklist item | `card.checklist.delete` | Show destructive delete affordance with undo-friendly confirmation | Hide delete affordance | Allow `Pending removal` local intent with undo; explicit resend later | `user`, `manager`, `admin` |
| Check checklist item | `card.checklist.check` | Render interactive unchecked item | Render read-only unchecked item | Allow pending local check intent with `Pending sync` marker | `user`, `manager`, `admin` |
| Uncheck checklist item | `card.checklist.uncheck` | Render interactive checked item | Render read-only checked item | Allow pending local uncheck intent with `Pending sync` marker | `user`, `manager`, `admin` |
| Named card action button | `card.action.trigger` | Show button in bottom dock or action sheet | Hide action entirely | Keep visible but disabled with `Needs a live connection.`; never queue | `user`, `manager`, `admin` |

## Interpretation notes by surface

### Comments

- The comment thread can remain visible while edit/delete controls are hidden.
- The client must not infer edit/delete permission from local ownership alone; current task context and server-owned policy remain authoritative.

### Attachments

- Viewing a synced attachment is separate from removing it.
- `Remove attachment` is server-backed and permission-gated.
- `Discard draft` is local-only and must not reuse destructive server-removal styling.

### Forms

- `form.submit` governs submission affordances, not whether the task itself is visible.
- When submit is denied, avoid rendering an inviting editable form that cannot be sent.
- Preserve server validation messages without clearing the local draft.

### Checklists

- `card.checklist.show` is the container gate.
- `card.checklist.add`, `card.checklist.edit`, `card.checklist.delete`, `card.checklist.check`, and `card.checklist.uncheck` each gate their own control.
- If only `card.checklist.show` is allowed, the checklist is visible but read-only.
- Any replay failure caused by stale `expectedToken` / `expectedRaw` must go through the conflict review pattern.

### Named card actions

- `card.action.trigger` is capability-gated and **always online-only**.
- If the capability is denied, hide the action rather than showing a disabled tease.
- If the capability is allowed but the connection is offline, show the action disabled with an explicit reconnect explanation.

## Hide vs disable summary

| Condition | Use `hide` | Use `disable/read-only` |
| --- | --- | --- |
| Policy denial | Yes | No |
| Task hidden by `auth.visibility` | Entire task omitted/replaced | No |
| Allowed but offline and safe to draft | No | Yes, or route into a local-draft pattern |
| Allowed but offline and unsafe to replay | No | Yes, disabled with online-required copy |
| Allowed but pending server response | No | Yes, disabled with progress state |

## Required implementation outcomes

- The app never renders a task-detail mutation control without the corresponding capability.
- The app never hides task denial behind a brief flash of cached content.
- The app distinguishes **policy denial**, **offline temporary unavailability**, and **local pending draft** states clearly.
- The matrix remains capability-first even when built-in role examples are helpful for testing.
