# Mobile offline cache and persistence ADR

Status: accepted for implementation waves
Date: 2026-04-02
Audience: developers
Primary implementation target: `packages/mobile/src/features/sync/cache-store.ts`
Related docs: [`mobile-v1-auth-contract.md`](./mobile-v1-auth-contract.md), [`mobile-onboarding-support-matrix.md`](./mobile-onboarding-support-matrix.md)

This ADR freezes the offline cache, draft persistence, attachment durability, and resend rules for MF2. It documents the approved persistence contract for later implementation work; it does **not** claim the mobile cache exists yet.

## Current codebase truth

- The mobile cache layer does not exist yet.
- The PRD already fixes the safety direction: server remains authoritative, cached reading is allowed, local draft capture is allowed, and side-effecting work must not replay blindly in the background.
- Checklist conflicts already matter at the product contract level because checklist mutations use `expectedToken` / `expectedRaw` semantics.

## Approved v1 decision

### Summary

Mobile v1 uses a **versioned, workspace+subject-scoped persistence envelope** with **explicit resend only**:

- persisted state lives in `packages/mobile/src/features/sync/cache-store.ts`
- every record is versioned with `version: 1`
- every record is scoped by `workspaceOrigin + workspaceId + subject`
- hydration happens **only after** session validation succeeds for the same namespace
- protected cached content must never flash before that validation succeeds
- offline writes are local drafts plus explicit resend, never silent background replay
- attachment drafts must be copied immediately into app-owned durable storage before they enter resend flow

## Persisted envelope

The store contract for v1 is a single namespace envelope per `workspaceOrigin + workspaceId + subject`.

```json
{
  "version": 1,
  "namespace": {
    "workspaceOrigin": "https://example-kanban.company",
    "workspaceId": "workspace_123",
    "subject": "alice"
  },
  "persistedAt": "2026-04-02T12:00:00.000Z",
  "snapshots": {
    "home": {},
    "tasks": {}
  },
  "drafts": {
    "comments": [],
    "forms": [],
    "checklists": []
  },
  "attachments": {
    "items": []
  }
}
```

### Envelope rules

- `version` is mandatory and starts at `1`.
- `namespace` is mandatory and must match the validated session namespace before hydration.
- `persistedAt` is informational only.
- `snapshots` store last-known visible data only; they are never authoritative.
- `drafts` store user-entered unsent work.
- `attachments.items` store metadata for durable local files; the file bytes live outside the JSON envelope in app-owned storage.
- The cache store must not persist the secret mobile session token.

## Versioning, migrations, and corruption handling

### Known-version migration

When the app encounters a supported older version, it runs a **pure forward migration** before reading any cached content.

Rules:

1. Migrations are deterministic and side-effect free.
2. A migration may rewrite JSON metadata but must not silently mutate or discard attachment files without recording that outcome.
3. Migrated data must still pass namespace validation before any UI reads it.

### Unknown version fallback

If the store sees an unknown version, especially a future version it cannot understand:

- purge the namespace envelope,
- keep the shell in neutral/loading state until fresh server data is available,
- do not try to partially hydrate mixed-version data.

### Corruption fallback

If JSON is unreadable, structurally invalid, or inconsistent with the namespace:

- purge the broken namespace envelope,
- mark any attachment metadata as invalid,
- schedule durable file cleanup on the next cleanup pass,
- return to a fresh sync path rather than rendering partially trusted content.

When in doubt, v1 prefers **purge and refetch** over best-effort merge.

## No-stale-flash rule

Protected cached content must never flash during:

- cold start,
- resume from background,
- deep-link handling,
- QR entry,
- failed restore,
- wrong-user restore,
- wrong-workspace restore,
- auth revocation.

### Required shell behavior

Until `GET /api/mobile/session` validates the current token **and** confirms the requested namespace matches the restored namespace, the app may render only:

- splash/loading shell,
- locked/auth-required shell,
- workspace resolution shell,
- explicit error/recovery UI.

It may **not** render:

- last synced task lists,
- cached task detail,
- cached checklist state,
- cached attachment previews,
- cached comments or forms

for a namespace that has not just been validated.

## Cache purge triggers

The following events must purge the affected namespace before protected content can render again:

| Trigger | Purge requirement |
| --- | --- |
| logout | purge all cache, draft, and attachment metadata for the active namespace |
| login as a different subject | purge the previous subject namespace before hydrating the new one |
| workspace switch | purge the old workspace namespace before hydrating the new one |
| `401` from `GET /api/mobile/session` | purge token-adjacent namespace state before any protected route mounts |
| `403` / auth revocation for active workspace | purge protected cache before showing recovery UI |
| unknown cache version | purge namespace |
| corrupted envelope | purge namespace |
| manual clear / reset | purge namespace and delete durable draft files |
| attachment expiry or durable file missing | purge that draft record and surface explicit recovery |

## Draft and resend semantics

### Core rule

Offline-capable writes are **local drafts + explicit resend only**.

That means:

- the app may save draft work locally while offline or on flaky networks;
- the app may show that work as draft/pending/failed for the same validated namespace;
- reconnecting does **not** silently resend mutations in the background;
- the user must explicitly confirm the first send or any resend after a failure/conflict.

### Draft state model

| State | Meaning | Exit path |
| --- | --- | --- |
| `draft` | local work exists, never sent successfully | user taps send/resend |
| `sending` | an explicit user-triggered send is in flight | transitions to `sent`, `failed`, or `conflict` |
| `failed` | send failed for a retryable reason such as network/auth/upload failure | user taps resend or discards |
| `conflict` | server rejected the write because current state changed | refresh latest data, review, then user explicitly retries |
| `sent` | the server accepted the write | remove or compact record on next sync |

### Per-feature resend rules

- **Comments:** draft text is stored locally; failed sends expose `Resend` and `Discard`.
- **Forms:** local unsent answers are stored locally; resend always revalidates against the current server form definition.
- **Checklist changes:** local intent may be stored, but resend must re-run with fresh `expectedToken` / `expectedRaw` values after refresh when conflicts occur.
- **Card actions:** never enter the offline resend model. `card.action.trigger` remains online-only.

## Attachment draft durability

Attachment capture has stricter rules because temporary OS picker paths are not durable enough.

### Durable-copy contract

Before an attachment draft is considered persisted, the app must:

1. copy the selected/captured file into an app-owned durable directory,
2. assign a stable draft id,
3. persist attachment metadata into `cache-store.ts`, and
4. only then show the draft as available for resend.

### V1 limits

These limits are frozen for v1 unless later implementation evidence forces a replan:

- **per-file limit:** `25 MiB`
- **total durable-draft budget per workspace+subject namespace:** `200 MiB`
- **expiry:** `7 days` after the last local modification or failed send attempt

If a new capture would exceed either size limit, the app must reject it with a clear recovery message instead of silently dropping older drafts.

### Attachment metadata fields

Each attachment draft record should track at least:

- `draftId`
- `taskId`
- `workspaceOrigin`
- `workspaceId`
- `subject`
- `fileName`
- `mimeType`
- `sizeBytes`
- `sha256` or equivalent content fingerprint when available
- durable local `uri` / path
- `createdAt`
- `updatedAt`
- `expiresAt`
- `status`
- `lastError` when present

### Cleanup rules

Delete the durable file and metadata when:

- upload succeeds,
- the user discards the draft,
- the namespace is purged on logout / workspace switch / subject switch,
- the draft expires,
- the app runs manual storage cleanup.

### Missing-file recovery

If metadata exists but the durable file is gone:

- mark the draft `failed`,
- set a machine-readable reason like `missing_local_file`,
- do not silently remove the draft before the user sees the failure,
- offer only `Remove` or `Recapture`, not blind resend.

## Cross-document constraints

This ADR depends on the auth contract in [`mobile-v1-auth-contract.md`](./mobile-v1-auth-contract.md):

- secure session validation must finish before namespace hydration;
- wrong-user and wrong-workspace restores must purge before render;
- the cache store must not become a second credential store.

## Frozen v1 guardrails

1. `version: 1` is the initial persisted schema.
2. Hydration is blocked on session + namespace validation.
3. Unknown versions and corruption purge instead of partially hydrating.
4. Protected content never stale-flashes.
5. Offline writes require explicit resend.
6. Attachment drafts use durable local copies with quota, expiry, cleanup, and missing-file recovery.
7. Card actions remain online-only.
