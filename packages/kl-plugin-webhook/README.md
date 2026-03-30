# kl-plugin-webhook

A [kanban-lite](https://github.com/borgius/kanban-lite) webhook package that owns webhook behavior on every host surface that already supports plugins. It implements:

- `webhook.delivery`

and also exports plugin-owned host integrations for:

- `standalone.http` (`/api/webhooks` route ownership)
- `cliPlugin` (`kl webhooks ...` command ownership)
- `sdkExtensionPlugin` (additive SDK webhook methods via `sdk.getExtension('kl-plugin-webhook')`)
- `mcpPlugin` (`list_webhooks`, `add_webhook`, `update_webhook`, `remove_webhook`)

The package exports `webhookProviderPlugin` using the provider id `webhooks`.

For runtime delivery it also exports `WebhookListenerPlugin`, a listener-only
after-event subscriber that the SDK registers via `register()` / `unregister()` under the current plugin loader.

It is the canonical owner of webhook registry CRUD, listener-only runtime delivery, standalone webhook routes, CLI webhook commands, and webhook MCP tool registration. Core still provides the shared auth/error context and keeps the direct `KanbanSDK` webhook methods as compatibility shims.

## Install

```bash
npm install kl-plugin-webhook
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

- Reads webhook registrations from `plugins["webhook.delivery"].options.webhooks` when configured, with fallback to top-level `.kanban.json` `webhooks` for compatibility
- Filters each SDK event against active webhooks subscribed to that event (or to `*`)
- Subscribes only to committed SDK after-events, so pending before-events never trigger outbound delivery
- Owns `/api/webhooks` registration through the standalone plugin seam when loaded by the standalone server
- Owns `kl webhooks` command registration through the CLI plugin seam when loaded by the CLI host
- Contributes additive SDK webhook CRUD methods discoverable via `sdk.getExtension('kl-plugin-webhook')`
- Registers `list_webhooks`, `add_webhook`, `update_webhook`, and `remove_webhook` through the MCP plugin seam when loaded by the MCP host
- Delivers events via HTTP POST with a JSON payload envelope: `{ event, timestamp, data }`
- Signs payloads with HMAC-SHA256 when a `secret` is configured (`X-Webhook-Signature: sha256=…`)
- Sets a 10-second request timeout; delivery failures are logged and swallowed (fire-and-forget)

Webhook CRUD remains capability-based on `webhookProviderPlugin`; runtime delivery is owned by the separate listener export; the SDK extension bag and MCP tool registration seam both converge on that same backing implementation while core preserves stable compatibility entry points.

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

Because `webhooks` is the default provider id, the block above is equivalent to omitting `plugins["webhook.delivery"]` from `.kanban.json` entirely once this package is installed.

A workspace that only sets `plugins["webhook.delivery"]` still activates plugin discovery for this package's provider, standalone route contribution, CLI command contribution, and MCP tool contribution.

Webhooks are registered at runtime via the kanban-lite SDK/API/CLI/MCP and stored under plugin options:

```json
{
  "plugins": {
    "webhook.delivery": {
      "provider": "kl-plugin-webhook",
      "options": {
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
    }
  }
}
```

For compatibility, legacy top-level `.kanban.json` `webhooks` is still recognized.

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

If `KANBAN_LITE_TOKEN` is present in the runtime environment, outbound webhook
requests also include `Authorization: Bearer <token>`.

## Event filters

Webhook subscriptions support three match styles:

- exact event names such as `task.created`
- `*` to receive every supported after-event
- prefix wildcards ending in `.*`, such as `task.*`, `board.*`, or `board.log.*`

Only committed SDK after-events are delivered. Before-events such as
`form.submit`, `card.action.trigger`, or `storage.migrate` are part of the SDK
integration lifecycle, but they are not sent as outbound webhooks.

## Supported after-events

| Event | Category | Description |
| ----- | -------- | ----------- |
| `task.created` | Task | A card was created. |
| `task.updated` | Task | A card changed without moving columns. |
| `task.moved` | Task | A card moved columns or boards. |
| `task.deleted` | Task | A card was deleted. |
| `comment.created` | Comment | A comment was added. |
| `comment.updated` | Comment | A comment was edited. |
| `comment.deleted` | Comment | A comment was removed. |
| `column.created` | Column | A board column was added. |
| `column.updated` | Column | A board column was renamed or recolored. |
| `column.deleted` | Column | A board column was removed. |
| `attachment.added` | Attachment | A card attachment was added. |
| `attachment.removed` | Attachment | A card attachment was removed. |
| `settings.updated` | Settings | Board display settings changed. |
| `board.created` | Board | A board was created. |
| `board.updated` | Board | A board configuration changed. |
| `board.deleted` | Board | A board was deleted. |
| `board.action` | Board | A named board action was triggered. |
| `card.action.triggered` | Card action | A named card action was triggered. |
| `board.log.added` | Board log | A board log entry was appended. |
| `board.log.cleared` | Board log | Board log entries were cleared. |
| `log.added` | Card log | A card log entry was appended. |
| `log.cleared` | Card log | Card log entries were cleared. |
| `storage.migrated` | Storage | Card storage was migrated between providers. |
| `form.submitted` | Form | A card form payload was validated, persisted, and submitted. |

## Standalone test receiver

When the standalone host loads this package, it also exposes
`POST /api/webhooks/test`. Point a webhook at that route to verify end-to-end
delivery locally; the receiver writes the incoming event to the board log
instead of forwarding it elsewhere.

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
pnpm --filter kl-plugin-webhook build
pnpm --filter kl-plugin-webhook test:integration

# Or from this package directory
npm install
npm run build
npm run test:integration
```

Inside this monorepo, Kanban Lite resolves `packages/kl-plugin-webhook` directly. The legacy sibling checkout fallback at `../kl-plugin-webhook` intentionally remains for temporary compatibility outside the monorepo, so `npm link ../kl-plugin-webhook` is optional rather than the primary workflow.

Generated docs such as `docs/webhooks.md` are source-driven from `scripts/generate-webhooks-docs.ts`; update the generator metadata and regenerate instead of editing generated markdown by hand.

## License

MIT
