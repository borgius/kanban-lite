# kl-plugin-storage-postgresql

A [kanban-lite](https://github.com/borgius/kanban-lite) `card.storage` and `attachment.storage` plugin for PostgreSQL.

Cards and comments are stored in a PostgreSQL database. Workspace configuration (boards, columns, settings, labels, webhooks) continues to be sourced from `.kanban.json`. Attachment files are stored on the local filesystem at `.kanban/boards/{boardId}/{status}/attachments/`.

## Install

```bash
npm install kl-plugin-storage-postgresql pg
```

`pg` is declared as a peer dependency and must be installed separately to keep the package lightweight and to allow consumers to pin their own driver version.

## Provider id

`postgresql`

## Capabilities

- `card.storage` — persists cards and comments in PostgreSQL tables
- `attachment.storage` — copies attachment files to local filesystem paths under `.kanban/`

`card.state` is auto-derived by kanban-lite from the active `card.storage` provider, so selecting `postgresql` here also enables the package's PostgreSQL-backed card-state provider without a separate `plugins["card.state"]` entry.

## `.kanban.json` example

```json
{
  "plugins": {
    "card.storage": {
      "provider": "postgresql",
      "options": {
        "host": "localhost",
        "port": 5432,
        "user": "kanban",
        "password": "secret",
        "database": "kanban_db"
      }
    }
  }
}
```

## Required options

| Option | Required | Default | Description |
|---|---|---|---|
| `database` | **yes** | — | PostgreSQL database name |
| `host` | no | `localhost` | PostgreSQL server hostname |
| `port` | no | `5432` | PostgreSQL server port |
| `user` | no | `postgres` | PostgreSQL user |
| `password` | no | `""` | PostgreSQL password |
| `ssl` | no | — | SSL options passed through to `pg` |

## Attachment behavior

Attachments are stored on the **local filesystem** under:

```
{kanbanDir}/boards/{boardId}/{status}/attachments/
```

The attachment directory is created lazily on the first `copyAttachment` call. There is no remote/cloud attachment option in this plugin; use [kl-plugin-attachment-s3](https://github.com/borgius/kl-plugin-attachment-s3) alongside a different `card.storage` provider if you need cloud attachments with PostgreSQL.

## Lazy driver loading

The `pg` driver is required at runtime but is **not** bundled into `dist/index.cjs`. The package uses `createRequire` to load `pg` lazily on first engine use. If the driver is missing you will see:

```
PostgreSQL storage requires the pg driver.
Install it as a runtime dependency: npm install pg
```

## Database schema

The plugin creates two tables on first `init()` / `migrate()` call (idempotent):

- `kanban_cards` — primary card storage with full card fields
- `kanban_comments` — comment storage keyed by `(card_id, board_id)`

## Running workspace and live integration tests

This package ships **two** integration paths:

- `npm run test:integration` → lightweight workspace integration test proving the plugin works with `kanban-lite` inside the monorepo
- `npm run test:integration:service` → live PostgreSQL-backed suite in `src/index.integration.test.ts`

### Prerequisites

- Docker (for the test PostgreSQL container) or an existing PostgreSQL 14+ instance
- `pg` installed as a devDependency (included in the package)

### With Docker Compose (recommended)

```bash
# Start a throwaway PostgreSQL container
docker compose -f docker-compose.test.yml up -d

# Wait for PostgreSQL to be ready (health check polling)
docker compose -f docker-compose.test.yml ps

# Run the live PostgreSQL-backed integration tests
npm run test:integration:service

# Tear down
docker compose -f docker-compose.test.yml down
```

### With an existing PostgreSQL instance

```bash
export PG_HOST=127.0.0.1
export PG_PORT=5432
export PG_USER=postgres
export PG_PASSWORD=postgres
export PG_DATABASE=kanban_test

# Create the database if needed
psql -h "$PG_HOST" -U "$PG_USER" -c "CREATE DATABASE kanban_test"

npm run test:integration:service
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PG_HOST` | `127.0.0.1` | PostgreSQL hostname |
| `PG_PORT` | `5432` | PostgreSQL port |
| `PG_USER` | `postgres` | PostgreSQL user |
| `PG_PASSWORD` | `postgres` | PostgreSQL password |
| `PG_DATABASE` | `kanban_test` | Test database name |

> **Note:** If PostgreSQL is not reachable, the live tests are automatically skipped with a warning. Only manifest/shape tests run in offline mode.

## Exports

```ts
import {
  cardStoragePlugin,              // CardStoragePlugin — register with kanban-lite
  attachmentStoragePlugin,        // AttachmentStoragePlugin — register with kanban-lite
  createPostgresqlAttachmentPlugin, // factory: accepts a StorageEngine; use for same-engine attachment delegation
  PostgresqlStorageEngine,        // class: direct engine access
} from 'kl-plugin-storage-postgresql'
```

## License

MIT
