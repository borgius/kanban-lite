# Webhooks

Kanban Lite webhook delivery is owned by `kl-plugin-webhook`. It delivers committed SDK after-events via HTTP POST to any registered endpoint.

## Overview

- Webhooks fire from **all interfaces**: REST API, CLI, MCP server, and the UI (via the standalone server).
- `kl-plugin-webhook` owns runtime delivery, webhook registry CRUD, the standalone `/api/webhooks` routes, the `kl webhooks` CLI family, and webhook MCP tool registration where those plugin seams exist.
- Events are emitted by the SDK event bus and delivered by the resolved `webhook.delivery` provider, ensuring the same behavior regardless of entry point.
- The default runtime provider id is `webhooks`, which resolves to the external `kl-plugin-webhook` package.
- Advanced SDK consumers can use `sdk.getExtension('kl-plugin-webhook')`; the direct webhook SDK methods remain stable compatibility shims.
- Webhook registrations are read from `.kanban.json` `plugins["webhook.delivery"].options.webhooks` when configured, and persist across server restarts.
- Only committed SDK after-events are delivered; before-events such as `form.submit` are not sent as outbound webhooks.
- Delivery is asynchronous and fire-and-forget (10-second timeout, failures are logged but do not block).
- Legacy top-level `.kanban.json` `webhooks` is still supported as a compatibility fallback.
- A workspace that only configures `plugins["webhook.delivery"]` still activates webhook package discovery for provider, standalone, CLI, and MCP surfaces.
- This file is generated from source metadata; do not edit `docs/webhooks.md` by hand.

## Install and linking

Install `kl-plugin-webhook` in the same environment that loads Kanban Lite:

```bash
npm install kl-plugin-webhook
```

For local development, a sibling checkout at `../kl-plugin-webhook` is resolved automatically. `npm link ../kl-plugin-webhook` is optional when you want an explicit local package link.

## Configuration

Webhook delivery uses the capability config under `plugins["webhook.delivery"]`. Persisted registrations are read from `plugins["webhook.delivery"].options.webhooks` when present, with fallback to top-level `.kanban.json` `webhooks`:

```json
{
  "plugins": {
    "webhook.delivery": {
      "provider": "kl-plugin-webhook",
      "options": {
        "webhooks": [
          {
            "id": "wh_a1b2c3d4e5f67890",
            "url": "https://example.com/webhook",
            "events": ["task.created", "task.moved"],
            "secret": "my-signing-key",
            "active": true
          }
        ]
      }
    }
  }
}
```

Legacy fallback format (still accepted):

```json
{
  "webhooks": [
    {
      "id": "wh_a1b2c3d4e5f67890",
      "url": "https://example.com/webhook",
      "events": ["task.created", "task.moved"],
      "secret": "my-signing-key",
      "active": true
    }
  ]
}
```

## Managing Webhooks

### SDK

Webhook CRUD still converges on the same `KanbanSDK` methods: `listWebhooks()`, `createWebhook()`, `updateWebhook()`, `deleteWebhook()`, and `getWebhookStatus()`.

For plugin-aware consumers, `kl-plugin-webhook` also contributes an additive SDK extension bag available through `sdk.getExtension('kl-plugin-webhook')`. Those extension methods and the direct SDK methods share the same backing store; the direct methods remain the compatibility path for existing callers.

### REST API

These routes are plugin-owned when `kl-plugin-webhook` is loaded by the standalone host.

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| `GET` | `/api/webhooks` | List all webhooks |
| `POST` | `/api/webhooks` | Register a new webhook |
| `PUT` | `/api/webhooks/:id` | Update a webhook |
| `DELETE` | `/api/webhooks/:id` | Delete a webhook |
| `POST` | `/api/webhooks/test` | Write a received webhook payload to the board log for local end-to-end verification |

### CLI

These commands are plugin-owned when `kl-plugin-webhook` is loaded by the CLI host.

```bash
# List webhooks
kl webhooks

# Register a webhook
kl webhooks add --url https://example.com/hook --events task.created,task.moved

# Update a webhook
kl webhooks update <id> --active false
kl webhooks update <id> --events task.created,task.deleted --url https://new-url.com

# Delete a webhook
kl webhooks remove <id>
```

### MCP Server

These tools are plugin-owned when `kl-plugin-webhook` is loaded by the MCP host through the narrow `mcpPlugin.registerTools(...)` seam. Public tool names, schemas, auth wrapping, and secret redaction behavior remain unchanged: `list_webhooks`, `add_webhook`, `update_webhook`, `remove_webhook`

## Event filters

- Exact names such as `task.created` match only that event.
- `*` matches every supported after-event.
- Prefix wildcards ending in `.*` match that namespace, for example `task.*`, `board.*`, or `board.log.*`.

## Payload format

Every webhook delivery sends a JSON POST request with the following structure:

```json
{
  "event": "task.created",
  "timestamp": "2026-02-24T12:00:00.000Z",
  "data": { ... }
}
```

**Headers:**

| Header | Description |
| ------ | ----------- |
| `Content-Type` | `application/json` |
| `X-Webhook-Event` | The event type (e.g., `task.created`) |
| `X-Webhook-Signature` | HMAC-SHA256 signature (only if a secret is configured) |
| `Authorization` | `Bearer <token>` when `KANBAN_LITE_TOKEN` is set in the webhook runtime |

## Signature verification

If you provide a `secret` when registering a webhook, every delivery includes an `X-Webhook-Signature` header with the format `sha256=<hex-digest>`.

To verify:

```javascript
const crypto = require('crypto')

function verifySignature(payload, signature, secret) {
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex')
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  )
}
```

## Delivery behavior

- Only committed SDK after-events are delivered.
- Webhooks are delivered **asynchronously** — the SDK operation completes without waiting for delivery.
- Each delivery has a **10-second timeout**.
- Failed deliveries are logged to stderr but **do not retry**.
- Only HTTP `2xx` responses are considered successful.
- Inactive webhooks (`active: false`) are skipped.
- Subscribing to `["*"]` matches all events.

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
