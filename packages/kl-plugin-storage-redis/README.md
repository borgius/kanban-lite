# kl-plugin-storage-redis

A [kanban-lite](https://github.com/borgius/kanban-lite) `card.storage` and `attachment.storage` plugin for Redis.

Cards and comments are stored in Redis hashes. Workspace configuration (boards, columns, settings, labels, webhooks) continues to be sourced from `.kanban.json`. Attachment files are stored on the local filesystem at `.kanban/boards/{boardId}/{status}/attachments/`.

## Install

```bash
npm install kl-plugin-storage-redis ioredis
```

`ioredis` is declared as a peer dependency and must be installed separately to keep the package lightweight and to allow consumers to pin their own driver version.

## Provider id

`redis`

## Capabilities

- `card.storage` — persists cards and comments in Redis hashes
- `attachment.storage` — copies attachment files to local filesystem paths under `.kanban/`

`card.state` is auto-derived by kanban-lite from the active `card.storage` provider, so selecting `redis` here also enables the package's Redis-backed card-state provider without a separate `plugins["card.state"]` entry.

## `.kanban.json` example

```json
{
  "plugins": {
    "card.storage": {
      "provider": "redis",
      "options": {
        "host": "localhost",
        "port": 6379,
        "db": 0
      }
    }
  }
}
```

## Options

| Option | Required | Default | Description |
|---|---|---|---|
| `host` | no | `localhost` | Redis host |
| `port` | no | `6379` | Redis port |
| `password` | no | — | Redis password |
| `db` | no | `0` | Redis database index |
| `keyPrefix` | no | `kanban` | Prefix for Redis keys |

## Data layout

Cards and comments are stored in Redis hashes:

- `{prefix}:cards:{boardId}` — Hash where each field is a card ID and each value is the JSON-serialized card document
- `{prefix}:comments:{boardId}:{cardId}` — Hash where each field is a comment ID and each value is the JSON-serialized comment document

## Attachment behavior

Attachments are stored on the **local filesystem** under:

```
{kanbanDir}/boards/{boardId}/{status}/attachments/
```

The attachment directory is created lazily on the first `copyAttachment` call. There is no remote/cloud attachment option in this plugin; use [kl-plugin-attachment-s3](https://github.com/borgius/kl-plugin-attachment-s3) alongside a different `card.storage` provider if you need cloud attachments with Redis.

## Lazy driver loading

The `ioredis` driver is required at runtime but is **not** bundled into `dist/index.cjs`. The package uses `createRequire` to load `ioredis` lazily on first engine use. If the driver is missing you will see:

```
Redis storage requires the ioredis driver.
Install it as a runtime dependency: npm install ioredis
```

## Running with Docker

```bash
# Start Redis
docker run -d --name kanban-redis -p 6379:6379 redis:7

# Configure .kanban.json
cat > .kanban.json <<'EOF'
{
  "plugins": {
    "card.storage": {
      "provider": "redis",
      "options": {
        "host": "localhost",
        "port": 6379
      }
    }
  }
}
EOF

# Start kanban-lite
kl serve
```

## License

MIT
