# kl-plugin-storage-redis

A [kanban-lite](https://github.com/borgius/kanban-lite) `card.storage`, `config.storage`, and `attachment.storage` plugin for Redis.

Cards and comments are stored in Redis hashes. Workspace configuration can also be stored in Redis with the same connection options when `config.storage` is selected or derived from `card.storage`. Attachment files are stored on the local filesystem at `.kanban/boards/{boardId}/{status}/attachments/`.

## Install

```bash
npm install kl-plugin-storage-redis ioredis
```

`ioredis` is declared as a peer dependency and must be installed separately to keep the package lightweight and to allow consumers to pin their own driver version.

## Provider id

`redis`

## Capabilities

- `card.storage` — persists cards and comments in Redis hashes
- `config.storage` — persists workspace config documents in Redis with the same connection options as `card.storage`
- `attachment.storage` — copies attachment files to local filesystem paths under `.kanban/`

In kanban-lite, selecting `redis` under `card.storage` is enough to auto-derive this package's `attachment.storage`, `card.state`, and `config.storage` providers with the same options. You only need an explicit `plugins["attachment.storage"]` entry when choosing a different attachment backend such as S3. If you keep an explicit `plugins["config.storage"]` override (for example `localfs` from bootstrap config), kanban-lite preserves that override instead of pruning it as redundant.

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

The same options payload is used when `redis` owns `config.storage`, whether you select it explicitly under `plugins["config.storage"]` or let kanban-lite derive it from `card.storage`.

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
