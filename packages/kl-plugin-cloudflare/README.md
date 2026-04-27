# kl-plugin-cloudflare

Worker-safe first-party Cloudflare bundle for kanban-lite.

## Capabilities

- `card.storage` via D1
- `attachment.storage` via R2
- `card.state` via D1
- `config.storage` via D1
- `callback.runtime` via D1 + Cloudflare Queues
- `auth.identity` via Cloudflare Access JWT validation

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
    },
    "auth.identity": {
      "provider": "cloudflare",
      "options": {
        "teamName": "example",
        "audience": "YOUR_ACCESS_AUD_TAG",
        "defaultRoles": ["user"],
        "roleMappings": {
          "kanban-admins": ["admin"]
        }
      }
    },
    "auth.policy": {
      "provider": "rbac"
    }
  }
}
```

## Cloudflare Access identity

The `auth.identity` provider validates the `CF-Access-Jwt-Assertion` JWT, or a normal bearer token when one is supplied by another host. It verifies RS256 signatures against Cloudflare Access JWKS, requires the exact issuer (`https://<team>.cloudflareaccess.com` unless `issuer` is configured), checks audience, `exp`, `nbf`, and `iat`, and never trusts `CF-Access-Authenticated-User-Email` by itself.

`auth.identity` only resolves who the caller is. Pair it with an enforcing `auth.policy` provider such as `rbac`, or rely on a Cloudflare Access perimeter that blocks unauthenticated traffic before it reaches the Worker.

Options are schema-driven for the shared Plugin Options UI. Configure `teamName` or `issuer`, plus `audience`; optional claim names, default roles, and role mappings control the returned kanban-lite identity.

## Notes

- The v1 bundle is operation-driven only: no polling, timers, caches, cron, or always-on background work.
- `callback.runtime` is module-only for provider `cloudflare`: the Worker persists one durable D1 event record per committed event, enqueues one compact `{ version, kind, eventId }` message per event, retries only failed handlers, and rejects enabled `inline` / `process` rows.
