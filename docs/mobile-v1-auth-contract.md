# Mobile v1 auth and session contract

Status: shipped local-provider mobile contract
Date: 2026-04-02
Audience: developers
Related docs: [`mobile-offline-cache-adr.md`](./mobile-offline-cache-adr.md), [`mobile-onboarding-support-matrix.md`](./mobile-onboarding-support-matrix.md), [`auth.md`](./auth.md)

This document records the shipped mobile auth/session contract for the `local` provider and the guardrails later mobile work must preserve.

## Current codebase truth

Today the shipped `local` auth provider exposes a browser transport and a mobile transport:

- `POST /auth/login` validates a local username/password pair.
- Successful browser login sets the `kanban_lite_session` cookie and redirects the user back to the requested page.
- Unauthenticated standalone page requests redirect to `/auth/login`.
- `POST /auth/logout` and `GET /auth/logout` clear the cookie-backed session.
- `POST /api/mobile/bootstrap` normalizes `workspaceOrigin`, returns the stable `workspaceId`, reports whether a one-time bootstrap token was supplied, and returns the next mobile auth step.
- `POST /api/mobile/session` exchanges either `local` credentials or a validated one-time bootstrap token for `{ session: { kind: "local-mobile-session-v1", token }, status }` and does **not** set `kanban_lite_session`.
- `GET /api/mobile/session` validates `Authorization: Bearer <opaque token>` against a required `workspaceOrigin` query parameter and returns only safe status metadata, including the stable `workspaceId` needed for namespace checks.
- `DELETE /api/mobile/session` revokes the current opaque mobile bearer token for mobile logout and accepts only the mobile bearer credential, not a browser cookie or shared automation token.
- The same `local` provider also accepts a **shared API bearer token** from `KANBAN_LITE_TOKEN`, `KANBAN_TOKEN`, or `auth.identity.options.apiToken` for CLI, MCP, scripts, and automation.

The browser redirect/cookie flow remains correct for standalone browsers. Expo uses the opaque bearer mobile session transport instead, and `GET /api/mobile/session` does not accept the shared automation token or a browser cookie as its native credential.

## Contract summary

### Summary

Mobile v1 keeps auth **server-owned** and **local-provider-scoped**, but refines the transport for Expo:

- Browser login stays on the existing `/auth/login` + `kanban_lite_session` redirect flow.
- Expo does **not** persist or rely on the browser cookie as its long-lived mobile credential.
- Expo uses `POST /api/mobile/session`, which returns a **user-scoped opaque bearer session token**.
- That bearer token is backed by the **existing server-side session model**: server-owned lifetime, revocation, and subject/workspace binding remain authoritative.
- V1 does **not** introduce a generic mobile auth abstraction, JWT refresh stack, or provider-agnostic session broker.
- V1 interactive mobile auth is limited to the existing `local` provider plus optional one-time bootstrap-token redemption.

In short: **reuse the existing local auth architecture, but change the mobile transport from browser cookie redirect to opaque bearer session exchange.**

## Shipped mobile route contract

These routes and behaviors are the current shipped mobile contract.

| Route | Status in code | Purpose | Notes |
| --- | --- | --- | --- |
| `POST /api/mobile/bootstrap` | shipped | Resolve workspace from typed origin, deep link, or QR payload; report whether a one-time bootstrap token was supplied | Returns `workspaceOrigin`, stable `workspaceId`, the fixed mobile auth contract, and `nextStep`; must not mint shared API tokens |
| `POST /api/mobile/session` | shipped | Exchange `local` credentials or a validated one-time bootstrap grant for a mobile session | Returns `session.kind = "local-mobile-session-v1"`, the opaque bearer `session.token`, and safe session status including `workspaceId`; response does not set a browser cookie |
| `GET /api/mobile/session` | shipped | Validate a stored mobile session on cold start, resume, and deep-link entry | Requires `Authorization: Bearer <token>` plus `workspaceOrigin`; drives no-stale-flash gating and cache namespace validation with stable `workspaceId` |
| `DELETE /api/mobile/session` | shipped | Revoke the current mobile bearer session during logout | Requires `Authorization: Bearer <token>` and returns `{ ok: true }` on successful revoke |
| `POST /auth/login` | shipped browser surface | Browser-only local login | Remains cookie + redirect based |
| `POST /auth/logout` / `GET /auth/logout` | shipped browser surface | Browser-only local logout | Clears the browser cookie; not the native Expo logout transport |

### Explicit non-goals

- No `/api/mobile/session/login` subtree.
- No reuse of the shared `KANBAN_LITE_TOKEN` / `options.apiToken` as a worker mobile credential.
- No long-lived refresh-token/JWT stack in v1.
- No attempt to scrape, share, or sync the standalone browser cookie jar into Expo.
- No provider-agnostic mobile auth contract for OIDC/SAML/email-link/custom providers in v1.

## Session token contract

The mobile bearer token is intentionally narrow:

- **Opaque**: the client cannot inspect claims locally.
- **User-scoped**: one token represents one authenticated subject.
- **Workspace-scoped**: the validated session returns the workspace identity needed to namespace cache state.
- **Server-backed**: expiry, revocation, and subject resolution live on the server, not in the client.
- **Transport-specific**: the mobile token is not a replacement for the browser cookie and not a replacement for the shared automation token.

The current implementation reuses the server-side local session store and tags mobile records with `kind = "local-mobile-session-v1"`, but the externally visible guarantees stay the same:

1. the server owns the session record;
2. the client stores only an opaque token;
3. `GET /api/mobile/session` is the authority on whether restore is valid.

## Stored credential model

The app stores **only** the minimum material needed to resume the same user/workspace safely.

### Secret material

Persist in secure device storage only:

- `session.kind = "local-mobile-session-v1"`
- `session.token` — opaque user-scoped bearer session token

### Non-secret namespace metadata

Persist only if needed for namespacing or UX, and derive it from the returned `status` payload after login/validation:

- `workspaceOrigin`
- `workspaceId`
- `subject`
- `roles`, if returned
- optional `expiresAt` hint for UX only

### Never persist

- passwords
- raw one-time bootstrap tokens
- `kanban_lite_session` browser cookies
- `KANBAN_LITE_TOKEN` / `KANBAN_TOKEN`
- shared `auth.identity.options.apiToken` values
- any provider-secret material not required for local session restore

`packages/mobile/src/features/sync/cache-store.ts` must not become a second secret store. It may persist non-secret namespace metadata, but it must not own the bearer token itself.

## Logout, revocation, and restore rules

`GET /api/mobile/session` is authoritative for restore and revocation detection. Explicit mobile logout can revoke the current bearer credential through `DELETE /api/mobile/session`, and the client must still clear the secure-store token, purge protected cache/draft namespaces, and return to onboarding. Browser `/auth/logout` remains browser-only, and server-side expiry or invalidation is surfaced back to mobile when `GET /api/mobile/session` returns `401` or `403`.

The mobile shell must purge stored session material and all protected cache namespaces before rendering protected UI when any of the following happens:

| Trigger | Required behavior |
| --- | --- |
| explicit logout | Revoke the current bearer token with `DELETE /api/mobile/session` when possible, then clear secure-store token and purge cache/draft namespaces before returning to onboarding; do not treat browser `/auth/logout` as the native mobile logout path |
| session validation returns `401` | Treat token as expired/invalid, purge before any protected screen mounts |
| session validation returns `403` for the requested workspace | Purge the mismatched namespace before showing onboarding or workspace switch UI |
| restored `subject` differs from cached namespace subject | Purge cached namespaces before render |
| restored `workspaceOrigin` differs from cached namespace | Purge cached namespaces before render |
| restored `workspaceId` differs from cached namespace | Purge cached namespaces before render |
| deep link targets a different workspace than the restored session | Resolve the target workspace first; do not flash cached content from the old namespace |
| bootstrap token replay / invalid bootstrap exchange | Do not create a session; clear transient bootstrap state and return to a safe onboarding step |

These rules intentionally pair with the no-stale-flash rules in [`mobile-offline-cache-adr.md`](./mobile-offline-cache-adr.md).

## Checklist authorization stance

Mobile checklist UI must reuse the existing protected-action catalog from `packages/kanban-lite/src/sdk/plugins/index.ts`.

| Mobile affordance | Protected action |
| --- | --- |
| show checklist section at all | `card.checklist.show` |
| add checklist item | `card.checklist.add` |
| edit checklist item text | `card.checklist.edit` |
| delete checklist item | `card.checklist.delete` |
| mark item complete | `card.checklist.check` |
| mark item incomplete | `card.checklist.uncheck` |

Rules:

- The client must not invent a separate checklist permission model.
- Rendering existing checklist data does **not** imply mutation rights.
- If `card.checklist.show` is denied, checklist UI is absent.
- If show is allowed but one or more mutation actions are denied, read-only checklist UI is allowed.

## Supported and deferred auth scope

### Supported in v1

- `local` interactive login through the mobile session exchange
- typed workspace origin entry
- deep links and QR codes that resolve a workspace and optionally carry a one-time bootstrap token
- cold-start and resume validation through `GET /api/mobile/session`

### Deferred from v1

- OIDC / SAML / enterprise SSO provider support in Expo
- generic email-link / magic-link providers outside the one-time local bootstrap contract
- shared-token onboarding for workers
- cookie-copy or browser-webview login as the supported mobile session path

## Implementation guardrails

Later implementation tasks should treat these as hard constraints:

1. Browser local auth stays browser-first.
2. Expo local auth uses `POST /api/mobile/session` and validates restore with `GET /api/mobile/session`.
3. The session token remains server-backed and user-scoped.
4. Cache hydration is blocked on session validation.
5. Checklist affordances use the exact existing protected-action names above.
6. Explicit mobile logout uses `DELETE /api/mobile/session` when the current bearer token is available, and still purges local token/cache state before protected UI can render again.
7. The offline queue remains explicit-resend only; see [`mobile-offline-cache-adr.md`](./mobile-offline-cache-adr.md).
