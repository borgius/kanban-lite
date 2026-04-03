# Mobile onboarding support matrix

Status: accepted for implementation waves
Date: 2026-04-02
Audience: developers
Related docs: [`mobile-v1-auth-contract.md`](./mobile-v1-auth-contract.md), [`mobile-offline-cache-adr.md`](./mobile-offline-cache-adr.md), [`PRD.yaml`](./PRD.yaml)

This document narrows mobile v1 onboarding to the paths that are explicitly supported, rejected, or deferred. It captures the approved target behavior for later implementation tasks; it does **not** claim the mobile onboarding flow ships today.

## Current codebase truth

- The current `local` auth implementation is browser-first and cookie-based for standalone browsers.
- Mobile onboarding is not implemented yet.
- The PRD wants domain entry, deep links, and QR entry, but MF2 must freeze what each path actually means for v1.

## V1 support rules at a glance

- Every entry path must resolve a **workspace** first.
- Browser cookie redirect remains a **browser** experience, not the primary Expo session transport.
- Expo local auth uses the first-class mobile session exchange from [`mobile-v1-auth-contract.md`](./mobile-v1-auth-contract.md).
- Deep links and QR codes may optionally include a **one-time bootstrap token**, but they must never carry long-lived credentials.
- Shared API tokens are not a worker onboarding mechanism.

## Supported entry paths

| Entry path | Required input | V1 status | Result |
| --- | --- | --- | --- |
| typed workspace origin / domain entry | workspace origin or canonical base URL | supported | `POST /api/mobile/bootstrap` resolves workspace, then the app calls `POST /api/mobile/session` for the local mobile session flow |
| deep link with workspace + target only | workspace origin plus optional task/deep-link target | supported | app resolves workspace, validates stored session if present, otherwise lands in local login for that workspace |
| QR code with workspace + target only | workspace origin plus optional task/deep-link target | supported | same as deep link; QR is just another workspace-resolution transport |
| deep link with one-time bootstrap token | workspace origin plus one-time bootstrap token | supported | `POST /api/mobile/bootstrap` resolves workspace and returns the token-redemption next step; `POST /api/mobile/session` validates and redeems the one-time token into a mobile opaque bearer session |
| QR code with one-time bootstrap token | workspace origin plus one-time bootstrap token | supported | same as deep link token redemption |
| app resume with stored mobile session token | validated stored token plus namespace metadata | supported | `GET /api/mobile/session` validates session before any protected content renders |

## Rejected or deferred entry paths

| Path | Status | Why |
| --- | --- | --- |
| Expo webview or external-browser `/auth/login` cookie flow as the primary mobile session path | rejected for v1 | the current local flow is browser-first; Expo should use the dedicated opaque bearer session exchange instead |
| manual copy/paste of `KANBAN_LITE_TOKEN`, `KANBAN_TOKEN`, or `auth.identity.options.apiToken` by field workers | rejected for v1 | those are shared automation credentials, not user-scoped mobile sessions |
| deep links or QR codes carrying raw passwords | rejected | passwords must only be entered into the live login form or session exchange request |
| deep links or QR codes carrying raw browser cookies | rejected | cookies are browser transport state, not shareable onboarding payloads |
| deep links or QR codes carrying long-lived mobile bearer session tokens | rejected | long-lived credentials must never ride in link payloads |
| OIDC / SAML / enterprise SSO mobile login | deferred | requires a provider-specific mobile contract; v1 remains local-provider-scoped |
| generic email-link or magic-link providers outside the local bootstrap contract | deferred | same reason: provider-specific server contract is not frozen in v1 |

## Allowed payload shape for link and QR entry

### Required

- `workspaceOrigin` or another canonical workspace identifier resolvable by `POST /api/mobile/bootstrap`

### Optional

- `target` route information, such as a task id or deep-link destination
- a **one-time bootstrap token** for the local-provider mobile session flow

### Forbidden

- passwords
- `kanban_lite_session` cookie values
- shared API tokens
- long-lived opaque mobile session tokens
- anything that would let the link/QR act as a reusable credential by itself

## One-time bootstrap token rules

The bootstrap token exists only to speed up local mobile onboarding safely.

Rules:

- single use
- short lived
- bound to one workspace
- rejected on replay
- never persisted after successful exchange
- never shown back to the user after intake

A replayed or expired token must fail closed and route the user to a safe recovery path rather than partially restoring stale state.

## Negative-path behavior

| Scenario | Required behavior |
| --- | --- |
| workspace cannot be resolved | show `ERR_MOBILE_WORKSPACE_UNRESOLVED`; do not create session or cache namespace |
| bootstrap token invalid, expired, or replayed | show `ERR_MOBILE_AUTH_LINK_INVALID`; clear transient token state; return to workspace/login step |
| stored session belongs to a different subject than the cache namespace | purge the namespace before rendering any protected content |
| stored session belongs to a different workspace than the incoming link/QR | resolve the target workspace first; do not flash cached content from the previous workspace |
| linked task is hidden or unavailable for the caller | show `ERR_MOBILE_TASK_NOT_VISIBLE` after auth + visibility checks, not stale cached task detail |
| device is offline before workspace resolution | allow only previously validated cached reading for the same namespace; do not fake onboarding success |

## Minimal v1 flow map

### Domain entry

1. User enters workspace origin.
2. `POST /api/mobile/bootstrap` resolves the workspace.
3. The app calls `POST /api/mobile/session` with local credentials.
4. On success, the app stores the opaque bearer session token and validated namespace metadata.
5. `GET /api/mobile/session` confirms restore/resume on subsequent launches before protected UI mounts.

### Deep link / QR without bootstrap token

1. Link or QR resolves workspace and optional target.
2. If a valid stored session exists for that workspace+subject, validate it first.
3. Otherwise route to the local login step for that workspace.
4. After session validation, navigate to the requested target if still visible.

### Deep link / QR with bootstrap token

1. Link or QR resolves workspace and carries a one-time bootstrap token.
2. `POST /api/mobile/bootstrap` resolves the workspace, notes that a bootstrap token was supplied, and returns the token-redemption next step.
3. The app calls `POST /api/mobile/session`, which validates that bootstrap token, rejects replay/expiry, and stores only the resulting opaque bearer token.
4. The raw bootstrap token is discarded immediately.

## Release stance for v1

The implementation waves should treat the following as fixed:

1. Local-provider mobile onboarding is supported.
2. Domain entry, deep links, and QR are supported only insofar as they resolve a workspace and feed the local mobile session contract.
3. Browser cookie redirect remains browser-only.
4. Shared API tokens are not worker onboarding.
5. Unsupported providers stay clearly deferred instead of being implied.
6. No-stale-flash and purge rules from the auth/offline ADRs apply to every onboarding path.
