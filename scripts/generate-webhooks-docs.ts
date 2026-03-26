#!/usr/bin/env npx tsx
/**
 * Generates docs/webhooks.md from structured event metadata.
 *
 * All webhook documentation lives in this file as structured data.
 * To update webhook docs, edit the metadata below and run:
 *   npx tsx scripts/generate-webhooks-docs.ts
 */
import * as fs from 'fs'
import * as path from 'path'

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'docs', 'webhooks.md')

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EventMeta {
  event: string
  category: string
  description: string
}

// ---------------------------------------------------------------------------
// Event metadata — the single source of truth for docs/webhooks.md
// ---------------------------------------------------------------------------

const EVENTS: EventMeta[] = [
  {
    event: 'task.created',
    category: 'Task',
    description: 'A card was created.',
  },
  {
    event: 'task.updated',
    category: 'Task',
    description: 'A card changed without moving columns.',
  },
  {
    event: 'task.moved',
    category: 'Task',
    description: 'A card moved columns or boards.',
  },
  {
    event: 'task.deleted',
    category: 'Task',
    description: 'A card was deleted.',
  },
  {
    event: 'comment.created',
    category: 'Comment',
    description: 'A comment was added.',
  },
  {
    event: 'comment.updated',
    category: 'Comment',
    description: 'A comment was edited.',
  },
  {
    event: 'comment.deleted',
    category: 'Comment',
    description: 'A comment was removed.',
  },
  {
    event: 'column.created',
    category: 'Column',
    description: 'A board column was added.',
  },
  {
    event: 'column.updated',
    category: 'Column',
    description: 'A board column was renamed or recolored.',
  },
  {
    event: 'column.deleted',
    category: 'Column',
    description: 'A board column was removed.',
  },
  {
    event: 'attachment.added',
    category: 'Attachment',
    description: 'A card attachment was added.',
  },
  {
    event: 'attachment.removed',
    category: 'Attachment',
    description: 'A card attachment was removed.',
  },
  {
    event: 'settings.updated',
    category: 'Settings',
    description: 'Board display settings changed.',
  },
  {
    event: 'board.created',
    category: 'Board',
    description: 'A board was created.',
  },
  {
    event: 'board.updated',
    category: 'Board',
    description: 'A board configuration changed.',
  },
  {
    event: 'board.deleted',
    category: 'Board',
    description: 'A board was deleted.',
  },
  {
    event: 'board.action',
    category: 'Board',
    description: 'A named board action was triggered.',
  },
  {
    event: 'card.action.triggered',
    category: 'Card action',
    description: 'A named card action was triggered.',
  },
  {
    event: 'board.log.added',
    category: 'Board log',
    description: 'A board log entry was appended.',
  },
  {
    event: 'board.log.cleared',
    category: 'Board log',
    description: 'Board log entries were cleared.',
  },
  {
    event: 'log.added',
    category: 'Card log',
    description: 'A card log entry was appended.',
  },
  {
    event: 'log.cleared',
    category: 'Card log',
    description: 'Card log entries were cleared.',
  },
  {
    event: 'storage.migrated',
    category: 'Storage',
    description: 'Card storage was migrated between providers.',
  },
  {
    event: 'form.submitted',
    category: 'Form',
    description: 'A card form payload was validated, persisted, and submitted.',
  },
]

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

function generate(): string {
  const lines: string[] = []

  lines.push('# Webhooks')
  lines.push('')
  lines.push('Kanban Lite webhook delivery is owned by `kl-webhooks-plugin`. It delivers committed SDK after-events via HTTP POST to any registered endpoint.')
  lines.push('')
  lines.push('## Overview')
  lines.push('')
  lines.push('- Webhooks fire from **all interfaces**: REST API, CLI, MCP server, and the UI (via the standalone server).')
  lines.push('- `kl-webhooks-plugin` owns runtime delivery, webhook registry CRUD, the standalone `/api/webhooks` routes, the `kl webhooks` CLI family, and webhook MCP tool registration where those plugin seams exist.')
  lines.push('- Events are emitted by the SDK event bus and delivered by the resolved `webhook.delivery` provider, ensuring the same behavior regardless of entry point.')
  lines.push('- The default runtime provider id is `webhooks`, which resolves to the external `kl-webhooks-plugin` package.')
  lines.push('- Advanced SDK consumers can use `sdk.getExtension(\'kl-webhooks-plugin\')`; the direct webhook SDK methods remain stable compatibility shims.')
  lines.push('- Webhook registrations are read from `.kanban.json` `plugins["webhook.delivery"].options.webhooks` when configured, and persist across server restarts.')
  lines.push('- Only committed SDK after-events are delivered; before-events such as `form.submit` are not sent as outbound webhooks.')
  lines.push('- Delivery is asynchronous and fire-and-forget (10-second timeout, failures are logged but do not block).')
  lines.push('- Legacy top-level `.kanban.json` `webhooks` is still supported as a compatibility fallback.')
  lines.push('- A workspace that only configures `plugins["webhook.delivery"]` still activates webhook package discovery for provider, standalone, CLI, and MCP surfaces.')
  lines.push('- This file is generated from source metadata; do not edit `docs/webhooks.md` by hand.')
  lines.push('')

  lines.push('## Install and linking')
  lines.push('')
  lines.push('Install `kl-webhooks-plugin` in the same environment that loads Kanban Lite:')
  lines.push('')
  lines.push('```bash')
  lines.push('npm install kl-webhooks-plugin')
  lines.push('```')
  lines.push('')
  lines.push('For local development, a sibling checkout at `../kl-webhooks-plugin` is resolved automatically. `npm link ../kl-webhooks-plugin` is optional when you want an explicit local package link.')
  lines.push('')

  // Configuration section
  lines.push('## Configuration')
  lines.push('')
  lines.push('Webhook delivery uses the capability config under `plugins["webhook.delivery"]`. Persisted registrations are read from `plugins["webhook.delivery"].options.webhooks` when present, with fallback to top-level `.kanban.json` `webhooks`:')
  lines.push('')
  lines.push('```json')
  lines.push('{')
  lines.push('  "plugins": {')
  lines.push('    "webhook.delivery": {')
  lines.push('      "provider": "kl-webhooks-plugin",')
  lines.push('      "options": {')
  lines.push('        "webhooks": [')
  lines.push('          {')
  lines.push('            "id": "wh_a1b2c3d4e5f67890",')
  lines.push('            "url": "https://example.com/webhook",')
  lines.push('            "events": ["task.created", "task.moved"],')
  lines.push('            "secret": "my-signing-key",')
  lines.push('            "active": true')
  lines.push('          }')
  lines.push('        ]')
  lines.push('      }')
  lines.push('    }')
  lines.push('  }')
  lines.push('}')
  lines.push('```')
  lines.push('')
  lines.push('Legacy fallback format (still accepted):')
  lines.push('')
  lines.push('```json')
  lines.push('{')
  lines.push('  "webhooks": [')
  lines.push('    {')
  lines.push('      "id": "wh_a1b2c3d4e5f67890",')
  lines.push('      "url": "https://example.com/webhook",')
  lines.push('      "events": ["task.created", "task.moved"],')
  lines.push('      "secret": "my-signing-key",')
  lines.push('      "active": true')
  lines.push('    }')
  lines.push('  ]')
  lines.push('}')
  lines.push('```')
  lines.push('')

  // CRUD section
  lines.push('## Managing Webhooks')
  lines.push('')
  lines.push('### SDK')
  lines.push('')
  lines.push('Webhook CRUD still converges on the same `KanbanSDK` methods: `listWebhooks()`, `createWebhook()`, `updateWebhook()`, `deleteWebhook()`, and `getWebhookStatus()`.')
  lines.push('')
  lines.push('For plugin-aware consumers, `kl-webhooks-plugin` also contributes an additive SDK extension bag available through `sdk.getExtension(\'kl-webhooks-plugin\')`. Those extension methods and the direct SDK methods share the same backing store; the direct methods remain the compatibility path for existing callers.')
  lines.push('')
  lines.push('### REST API')
  lines.push('')
  lines.push('These routes are plugin-owned when `kl-webhooks-plugin` is loaded by the standalone host.')
  lines.push('')
  lines.push('| Method | Endpoint | Description |')
  lines.push('| ------ | -------- | ----------- |')
  lines.push('| `GET` | `/api/webhooks` | List all webhooks |')
  lines.push('| `POST` | `/api/webhooks` | Register a new webhook |')
  lines.push('| `PUT` | `/api/webhooks/:id` | Update a webhook |')
  lines.push('| `DELETE` | `/api/webhooks/:id` | Delete a webhook |')
  lines.push('| `POST` | `/api/webhooks/test` | Write a received webhook payload to the board log for local end-to-end verification |')
  lines.push('')
  lines.push('### CLI')
  lines.push('')
  lines.push('These commands are plugin-owned when `kl-webhooks-plugin` is loaded by the CLI host.')
  lines.push('')
  lines.push('```bash')
  lines.push('# List webhooks')
  lines.push('kl webhooks')
  lines.push('')
  lines.push('# Register a webhook')
  lines.push('kl webhooks add --url https://example.com/hook --events task.created,task.moved')
  lines.push('')
  lines.push('# Update a webhook')
  lines.push('kl webhooks update <id> --active false')
  lines.push('kl webhooks update <id> --events task.created,task.deleted --url https://new-url.com')
  lines.push('')
  lines.push('# Delete a webhook')
  lines.push('kl webhooks remove <id>')
  lines.push('```')
  lines.push('')
  lines.push('### MCP Server')
  lines.push('')
  lines.push('These tools are plugin-owned when `kl-webhooks-plugin` is loaded by the MCP host through the narrow `mcpPlugin.registerTools(...)` seam. Public tool names, schemas, auth wrapping, and secret redaction behavior remain unchanged: `list_webhooks`, `add_webhook`, `update_webhook`, `remove_webhook`')
  lines.push('')

  lines.push('## Event filters')
  lines.push('')
  lines.push('- Exact names such as `task.created` match only that event.')
  lines.push('- `*` matches every supported after-event.')
  lines.push('- Prefix wildcards ending in `.*` match that namespace, for example `task.*`, `board.*`, or `board.log.*`.')
  lines.push('')

  // Payload format
  lines.push('## Payload format')
  lines.push('')
  lines.push('Every webhook delivery sends a JSON POST request with the following structure:')
  lines.push('')
  lines.push('```json')
  lines.push('{')
  lines.push('  "event": "task.created",')
  lines.push('  "timestamp": "2026-02-24T12:00:00.000Z",')
  lines.push('  "data": { ... }')
  lines.push('}')
  lines.push('```')
  lines.push('')
  lines.push('**Headers:**')
  lines.push('')
  lines.push('| Header | Description |')
  lines.push('| ------ | ----------- |')
  lines.push('| `Content-Type` | `application/json` |')
  lines.push('| `X-Webhook-Event` | The event type (e.g., `task.created`) |')
  lines.push('| `X-Webhook-Signature` | HMAC-SHA256 signature (only if a secret is configured) |')
  lines.push('| `Authorization` | `Bearer <token>` when `KANBAN_LITE_TOKEN` is set in the webhook runtime |')
  lines.push('')

  // Signing
  lines.push('## Signature verification')
  lines.push('')
  lines.push('If you provide a `secret` when registering a webhook, every delivery includes an `X-Webhook-Signature` header with the format `sha256=<hex-digest>`.')
  lines.push('')
  lines.push('To verify:')
  lines.push('')
  lines.push('```javascript')
  lines.push('const crypto = require(\'crypto\')')
  lines.push('')
  lines.push('function verifySignature(payload, signature, secret) {')
  lines.push('  const expected = \'sha256=\' + crypto')
  lines.push('    .createHmac(\'sha256\', secret)')
  lines.push('    .update(payload)')
  lines.push('    .digest(\'hex\')')
  lines.push('  return crypto.timingSafeEqual(')
  lines.push('    Buffer.from(signature),')
  lines.push('    Buffer.from(expected)')
  lines.push('  )')
  lines.push('}')
  lines.push('```')
  lines.push('')

  // Delivery
  lines.push('## Delivery behavior')
  lines.push('')
  lines.push('- Only committed SDK after-events are delivered.')
  lines.push('- Webhooks are delivered **asynchronously** — the SDK operation completes without waiting for delivery.')
  lines.push('- Each delivery has a **10-second timeout**.')
  lines.push('- Failed deliveries are logged to stderr but **do not retry**.')
  lines.push('- Only HTTP `2xx` responses are considered successful.')
  lines.push('- Inactive webhooks (`active: false`) are skipped.')
  lines.push('- Subscribing to `["*"]` matches all events.')
  lines.push('')

  // Event reference
  lines.push('## Supported after-events')
  lines.push('')

  lines.push('| Event | Category | Description |')
  lines.push('| ----- | -------- | ----------- |')
  for (const e of EVENTS) {
    lines.push(`| \`${e.event}\` | ${e.category} | ${e.description} |`)
  }
  lines.push('')

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const content = generate()
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, content, 'utf-8')
console.log(`Generated ${OUT} (${content.length} bytes)`)
