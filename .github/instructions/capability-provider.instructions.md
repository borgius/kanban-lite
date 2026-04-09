---
description: "Use when working on card.state, callback.runtime, Cloudflare callback providers, plugin settings provider selection, display-title helpers, plugin installs, or attachment.storage same-provider resolution. Covers actor-scoped state, fail-closed runtime checks, and provider wiring invariants."
name: "capability provider invariants"
---

# Capability / provider invariants

- `card.state` and `callback.runtime` are first-class capability/provider namespaces.
- Actor-scoped card state must live outside shared card content/frontmatter.
- Standalone transports that expose `card.state` must decorate cards per request/session auth context; raw shared broadcasts must not carry actor-scoped state.
- Board-configured card display titles must use the shared display-title helper; raw markdown title extraction remains the source of truth for storage, filenames, and rename logic.
- Callback configuration lives in shared plugin settings; plugin enablement maps to `plugins[capability].provider`, not a separate enabled boolean.
- Cloudflare `callback.runtime` uses `plugins["callback.runtime"].provider === "cloudflare"` with `type: "module"` handlers only.
- Enabled Cloudflare callback module-set changes are bootstrap/redeploy gated and must fail closed on runtime drift.
- Cloudflare queue delivery is event-scoped; durable checkpoints and idempotency are tracked per handler.
- For MySQL/PostgreSQL same-provider `attachment.storage`, use `createMysqlAttachmentPlugin(engine)` / `createPostgresqlAttachmentPlugin(engine)` instead of placeholder exports.
- In-product plugin installs accept only exact unscoped `kl-*` package names; reject scopes, specifiers, flags, URLs, paths, and extra args.
- Plugin-settings reads, lists, errors, and install output must reuse the shared redaction policy across SDK, API, CLI, MCP, and UI surfaces.
- JSON Forms provider-option UIs should reuse the shared `.card-jsonforms` wrapper/styling hook instead of introducing a second theme.
