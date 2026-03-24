# kl-webhooks-plugin

A [kanban-lite](https://github.com/borgius/kanban-lite) webhook package that owns webhook behavior on every host surface that already supports plugins. It implements:

- `webhook.delivery`

and also exports plugin-owned host integrations for:

- `standalone.http` (`/api/webhooks` route ownership)
- `cliPlugin` (`kl webhooks ...` command ownership)
- `sdkExtensionPlugin` (additive SDK webhook methods via `sdk.getExtension('kl-webhooks-plugin')`)
- `mcpPlugin` (`list_webhooks`, `add_webhook`, `update_webhook`, `remove_webhook`)

The package exports `webhookProviderPlugin` using the provider id `webhooks`.

For runtime delivery it also exports `WebhookListenerPlugin`, a listener-only
after-event subscriber that the SDK registers via `register()` / `unregister()` under the current plugin loader.

It is the canonical owner of webhook registry CRUD, listener-only runtime delivery, standalone webhook routes, CLI webhook commands, and webhook MCP tool registration. Core still provides the shared auth/error context and keeps the direct `KanbanSDK` webhook methods as compatibility shims.

## Install

```bash
npm install kl-webhooks-plugin
```

## Provider id

`webhooks`

## Capabilities

- `webhook.delivery`
- listener-only `event.listener` runtime delivery via `WebhookListenerPlugin`
- `standalone.http` route contribution for `/api/webhooks`
- `cliPlugin` command contribution for `kl webhooks`
- `sdk.extension` additive SDK webhook methods
- `mcp.tools` webhook MCP tool registration

## What it does

- Persists the webhook registry in the workspace `.kanban.json` `webhooks` array — the same shape used by kanban-lite core, so no migration is needed
- Filters each SDK event against active webhooks subscribed to that event (or to `*`)
- Subscribes only to committed SDK after-events, so pending before-events never trigger outbound delivery
- Owns `/api/webhooks` registration through the standalone plugin seam when loaded by the standalone server
- Owns `kl webhooks` command registration through the CLI plugin seam when loaded by the CLI host
- Contributes additive SDK webhook CRUD methods discoverable via `sdk.getExtension('kl-webhooks-plugin')`
- Registers `list_webhooks`, `add_webhook`, `update_webhook`, and `remove_webhook` through the MCP plugin seam when loaded by the MCP host
- Delivers events via HTTP POST with a JSON payload envelope: `{ event, timestamp, data }`
- Signs payloads with HMAC-SHA256 when a `secret` is configured (`X-Webhook-Signature: sha256=…`)
- Sets a 10-second request timeout; delivery failures are logged and swallowed (fire-and-forget)

Webhook CRUD remains capability-based on `webhookProviderPlugin`; runtime delivery is owned by the separate listener export; the SDK extension bag and MCP tool registration seam both converge on that same backing implementation while core preserves stable compatibility entry points.

## `.kanban.json` example

```json
{
  "webhookPlugin": {
    "webhook.delivery": {
      "provider": "webhooks"
    }
  }
}
```

Because `webhooks` is the default provider id, the block above is equivalent to omitting `webhookPlugin` from `.kanban.json` entirely once this package is installed.

A workspace that only sets `webhookPlugin` still activates plugin discovery for this package's provider, standalone route contribution, CLI command contribution, and MCP tool contribution.

Webhooks are registered at runtime via the kanban-lite SDK/API/CLI/MCP and stored in the same config:

```json
{
  "webhooks": [
    {
      "id": "wh_a1b2c3d4e5f6a7b8",
      "url": "https://example.com/hook",
      "events": ["task.created", "task.updated"],
      "secret": "my-signing-secret",
      "active": true
    }
  ]
}
```

## Delivery payload

Every outbound POST carries the following JSON body:

```json
{
  "event": "task.created",
  "timestamp": "2026-03-21T12:00:00.000Z",
  "data": { /* sanitized card / column / comment / board object */ }
}
```

Headers sent with every request:

| Header                  | Value                                          |
| ----------------------- | ---------------------------------------------- |
| `Content-Type`          | `application/json`                             |
| `X-Webhook-Event`       | event name (e.g. `task.created`)               |
| `X-Webhook-Signature`   | `sha256=<hex-digest>` (only when secret is set)|

## Build output

The published CommonJS entry point is:

```text
dist/index.cjs   ← require() entry
dist/index.d.ts  ← TypeScript declarations
```

## Local development / monorepo workflow

To use this package from the landed monorepo:

```bash
# From the repository root
pnpm --filter kl-webhooks-plugin build
pnpm --filter kl-webhooks-plugin test:integration

# Or from this package directory
npm install
npm run build
npm run test:integration
```

Inside this monorepo, Kanban Lite resolves `packages/kl-webhooks-plugin` directly. The legacy sibling checkout fallback at `../kl-webhooks-plugin` intentionally remains for temporary compatibility outside the monorepo, so `npm link ../kl-webhooks-plugin` is optional rather than the primary workflow.

Generated docs such as `docs/webhooks.md` are source-driven from `scripts/generate-webhooks-docs.ts`; update the generator metadata and regenerate instead of editing generated markdown by hand.

## License

MIT
