---
description: "Use when implementing async flows, retries, webhooks, callbacks, payments, queue delivery, or other idempotent side effects. Covers race conditions, bounded retry behavior, state drift, and failure visibility."
name: "async reliability checklist"
---

# Async / retry / webhook reliability

- Check for race conditions and out-of-order resolution, not just the happy path.
- Do not swallow failures in broad `try/catch`; surface actionable error context.
- Do not add retries without bounded backoff and jitter.
- Do not assume clean state; handle stale, partial, duplicated, migrated, or otherwise dirty data.
- Ensure repeated deliveries and retries do not double-apply side effects.
