# kl-plugin-storage-mongodb

A [kanban-lite](https://github.com/borgius/kanban-lite) `card.storage` and `attachment.storage` plugin for MongoDB.

Cards and comments are stored in MongoDB collections. Workspace configuration (boards, columns, settings, labels, webhooks) continues to be sourced from `.kanban.json`. Attachment files are stored on the local filesystem at `.kanban/boards/{boardId}/{status}/attachments/`.

## Install

```bash
npm install kl-plugin-storage-mongodb mongodb
```

`mongodb` is declared as a peer dependency and must be installed separately to keep the package lightweight and to allow consumers to pin their own driver version.

## Provider id

`mongodb`

## Capabilities

- `card.storage` — persists cards and comments in MongoDB collections
- `attachment.storage` — copies attachment files to local filesystem paths under `.kanban/`

## `.kanban.json` example

```json
{
  "plugins": {
    "card.storage": {
      "provider": "mongodb",
      "options": {
        "uri": "mongodb://localhost:27017",
        "database": "kanban_db"
      }
    }
  }
}
```

## Required options

| Option | Required | Default | Description |
|---|---|---|---|
| `database` | **yes** | — | MongoDB database name |
| `uri` | no | `mongodb://localhost:27017` | MongoDB connection URI |
| `collectionPrefix` | no | `kanban` | Prefix for collection names (`{prefix}_cards`, `{prefix}_comments`) |

## Attachment behavior

Attachments are stored on the **local filesystem** under:

```
{kanbanDir}/boards/{boardId}/{status}/attachments/
```

The attachment directory is created lazily on the first `copyAttachment` call. There is no remote/cloud attachment option in this plugin; use [kl-plugin-attachment-s3](https://github.com/borgius/kl-plugin-attachment-s3) alongside a different `card.storage` provider if you need cloud attachments with MongoDB.

## Lazy driver loading

The `mongodb` driver is required at runtime but is **not** bundled into `dist/index.cjs`. The package uses `createRequire` to load `mongodb` lazily on first engine use. If the driver is missing you will see:

```
MongoDB storage requires the mongodb driver.
Install it as a runtime dependency: npm install mongodb
```

## Database collections

The plugin creates two collections on first `init()` / `migrate()` call (idempotent):

- `kanban_cards` — primary card storage with full card fields, unique index on `(id, board_id)`
- `kanban_comments` — comment storage with unique index on `(id, card_id, board_id)`

The collection names can be customized via the `collectionPrefix` option (e.g., `myapp` → `myapp_cards`, `myapp_comments`).

## Running with Docker

```bash
# Start MongoDB
docker run -d --name kanban-mongo -p 27017:27017 mongo:7

# Configure .kanban.json
cat > .kanban.json <<'EOF'
{
  "plugins": {
    "card.storage": {
      "provider": "mongodb",
      "options": {
        "uri": "mongodb://localhost:27017",
        "database": "kanban"
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
