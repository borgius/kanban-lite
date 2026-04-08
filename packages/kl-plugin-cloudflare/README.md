# kl-plugin-cloudflare

Worker-safe first-party Cloudflare bundle for kanban-lite.

## Capabilities

- `card.storage` via D1
- `attachment.storage` via R2
- `card.state` via D1
- `config.storage` via D1
- `callback.runtime` via D1 + Cloudflare Queues

Provider id: `cloudflare`

## Install

Add the package to the workspace and deploy it with the rest of the kanban-lite Worker build.

## Worker binding contract

This package reads Cloudflare services only through the shared Worker provider context:

- logical D1 handle: `database`
- logical R2 handle: `attachments`
- logical Queue handle: `callbacks`
- `config.storage` document id comes from the host context seam

## Example `.kanban.json`

```json
{
  "version": 2,
  "plugins": {
    "card.storage": { "provider": "cloudflare" },
    "config.storage": { "provider": "cloudflare" },
    "callback.runtime": {
      "provider": "cloudflare",
      "options": {
        "handlers": [
          {
            "id": "task-created",
            "name": "task created",
            "type": "module",
            "events": ["task.created"],
            "enabled": true,
            "module": "./callbacks/task-created",
            "handler": "onTaskCreated"
          }
        ]
      }
    }
  }
}
```

## Notes

- The v1 bundle is operation-driven only: no polling, timers, caches, cron, or always-on background work.
- `callback.runtime` is module-only for provider `cloudflare`: the Worker persists one durable D1 event record per committed event, enqueues one compact `{ version, kind, eventId }` message per event, retries only failed handlers, and rejects enabled `inline` / `process` rows.
