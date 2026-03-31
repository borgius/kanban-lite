# kl-plugin-storage-mysql

A [kanban-lite](https://github.com/borgius/kanban-lite) `card.storage` and `attachment.storage` plugin for MySQL.

Cards and comments are stored in a MySQL database. Workspace configuration (boards, columns, settings, labels, webhooks) continues to be sourced from `.kanban.json`. Attachment files are stored on the local filesystem at `.kanban/boards/{boardId}/{status}/attachments/`.

## Install

```bash
npm install kl-plugin-storage-mysql mysql2
```

`mysql2` is declared as a peer dependency and must be installed separately to keep the package lightweight and to allow consumers to pin their own driver version.

## Provider id

`mysql`

## Capabilities

- `card.storage` — persists cards and comments in MySQL tables
- `attachment.storage` — copies attachment files to local filesystem paths under `.kanban/`

In kanban-lite, selecting `mysql` under `card.storage` is enough to auto-derive this package's `attachment.storage` and `card.state` providers with the same options. You only need an explicit `plugins["attachment.storage"]` entry when choosing a different attachment backend such as S3.

## `.kanban.json` example

```json
{
  "plugins": {
    "card.storage": {
      "provider": "mysql",
      "options": {
        "host": "localhost",
        "port": 3306,
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
| `database` | **yes** | — | MySQL schema / database name |
| `host` | no | `localhost` | MySQL server hostname |
| `port` | no | `3306` | MySQL server port |
| `user` | no | `root` | MySQL user |
| `password` | no | `""` | MySQL password |
| `ssl` | no | — | SSL options passed through to `mysql2` |

## Attachment behavior

Attachments are stored on the **local filesystem** under:

```
{kanbanDir}/boards/{boardId}/{status}/attachments/
```

The attachment directory is created lazily on the first `copyAttachment` call. There is no remote/cloud attachment option in this plugin; use [kl-plugin-attachment-s3](https://github.com/borgius/kl-plugin-attachment-s3) alongside a different `card.storage` provider if you need cloud attachments with MySQL.

## Lazy driver loading

The `mysql2/promise` driver is required at runtime but is **not** bundled into `dist/index.cjs`. The package uses `createRequire` to load `mysql2` lazily on first engine use. If the driver is missing you will see:

```
MySQL storage requires the mysql2 driver.
Install it as a runtime dependency: npm install mysql2
```

## Database schema

The plugin creates two tables on first `init()` / `migrate()` call (idempotent):

- `kanban_cards` — primary card storage with full card fields
- `kanban_comments` — comment storage keyed by `(card_id, board_id)`

## Running workspace and live integration tests

This package ships **two** integration paths:

- `npm run test:integration` → lightweight workspace integration test proving the plugin works with `kanban-lite` inside the monorepo
- `npm run test:integration:service` → live MySQL-backed suite in `src/index.integration.test.ts`

The package ships with a live integration test suite in `src/index.integration.test.ts`.

### Prerequisites

- Docker (for the test MySQL container) or an existing MySQL 8+ instance
- `mysql2` installed as a devDependency (included in the package)

### With Docker Compose (recommended)

```bash
# Start a throwaway MySQL container
docker compose -f docker-compose.test.yml up -d

# Wait for MySQL to be ready (health check polling)
docker compose -f docker-compose.test.yml ps

# Run the live MySQL-backed integration tests
npm run test:integration:service

# Tear down
docker compose -f docker-compose.test.yml down
```

### With an existing MySQL instance

```bash
export MYSQL_HOST=127.0.0.1
export MYSQL_PORT=3306
export MYSQL_USER=root
export MYSQL_PASSWORD=''
export MYSQL_DATABASE=kanban_test

# Create the database if needed
mysql -h "$MYSQL_HOST" -u "$MYSQL_USER" -e "CREATE DATABASE IF NOT EXISTS kanban_test"

npm run test:integration:service
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `MYSQL_HOST` | `127.0.0.1` | MySQL hostname |
| `MYSQL_PORT` | `3306` | MySQL port |
| `MYSQL_USER` | `root` | MySQL user |
| `MYSQL_PASSWORD` | `""` | MySQL password |
| `MYSQL_DATABASE` | `kanban_test` | Test database name |

> **Note:** If MySQL is not reachable, the live tests are automatically skipped with a warning. Only manifest/shape tests run in offline mode.

From the repository root, the matching monorepo commands are:

```bash
pnpm test:plugins:mysql           # workspace integration only
pnpm test:plugins:mysql:service   # live MySQL-backed suite
```

## Exports

```ts
import {
  cardStoragePlugin,        // CardStoragePlugin — register with kanban-lite
  attachmentStoragePlugin,  // AttachmentStoragePlugin — register with kanban-lite
  createMysqlAttachmentPlugin, // factory: accepts a StorageEngine; use for same-engine attachment delegation
  MysqlStorageEngine,       // class: direct engine access
} from 'kl-plugin-storage-mysql'
```

## License

MIT
