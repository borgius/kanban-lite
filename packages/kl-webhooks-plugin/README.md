# kl-webhooks-plugin

A [kanban-lite](https://github.com/borgius/kanban-lite) webhook delivery provider that implements:

- `webhook.delivery`

The package exports `webhookProviderPlugin` using the provider id `webhooks`.

It ports the full webhook CRUD registry and outbound HTTP delivery behavior out of kanban-lite core into a standalone, versioned package, with no behavior drift from the built-in implementation.

## Install

```bash
npm install kl-webhooks-plugin
```

## Provider id

`webhooks`

## Capabilities

- `webhook.delivery`

## What it does

- Persists the webhook registry in the workspace `.kanban.json` `webhooks` array — the same shape used by kanban-lite core, so no migration is needed
- Filters each SDK event against active webhooks subscribed to that event (or to `*`)
- Delivers events via HTTP POST with a JSON payload envelope: `{ event, timestamp, data }`
- Signs payloads with HMAC-SHA256 when a `secret` is configured (`X-Webhook-Signature: sha256=…`)
- Sets a 10-second request timeout; delivery failures are logged and swallowed (fire-and-forget)

## `.kanban.json` example

```json
{
  "plugins": {
    "webhook.delivery": {
      "provider": "webhooks"
    }
  }
}
```

Because `webhooks` is the default provider id, the block above is equivalent to omitting `webhookPlugin` from `.kanban.json` entirely once this package is installed.

Webhooks are registered at runtime via the kanban-lite SDK/API/CLI/MCP and stored in the same config:

```json
{
  "webhooks": [
    {
      "id": "wh_a1b2c3d4e5f6",
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

## License

MIT
