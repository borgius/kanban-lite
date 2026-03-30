# kl-plugin-storage-sqlite

A [kanban-lite](https://github.com/borgius/kanban-lite) storage provider package that implements both:

- `card.storage`
- `attachment.storage`

The package exports `cardStoragePlugin` and `attachmentStoragePlugin`, both using the provider id `sqlite`.

It stores cards, comments, board/config metadata, labels, and webhooks in a SQLite database via `better-sqlite3`, while keeping attachment files on local disk under the kanban workspace.

## Install

```bash
npm install kl-plugin-storage-sqlite better-sqlite3
```

> `better-sqlite3` is declared as a runtime dependency of this package. The separate install line above is still a practical reminder because native SQLite modules usually need to be present in the actual host runtime that loads kanban-lite plugins.

## Provider id

`sqlite`

## Capabilities

- `card.storage`
- `attachment.storage`

## What it does

- Persists cards and comments in a SQLite database
- Persists board/config-style workspace data in SQLite as well
- Keeps attachments on local disk at:
  `.kanban/boards/<boardId>/<status>/attachments/`
- Reports non-file-backed card behavior to kanban-lite hosts:
  - `isFileBacked: false`
  - `getLocalCardPath(): null`
  - `getWatchGlob(): null`

## `.kanban.json` example

Minimal setup using the default SQLite path:

```json
{
  "plugins": {
    "card.storage": {
      "provider": "sqlite"
    },
    "attachment.storage": {
      "provider": "sqlite"
    }
  }
}
```

Explicit database path:

```json
{
  "plugins": {
    "card.storage": {
      "provider": "sqlite",
      "options": {
        "sqlitePath": ".kanban/kanban.db"
      }
    },
    "attachment.storage": {
      "provider": "sqlite"
    }
  }
}
```

Legacy-compatible shape still works in kanban-lite itself, but new configs should prefer capability-based selection:

```json
{
  "storageEngine": "sqlite",
  "sqlitePath": ".kanban/kanban.db"
}
```

## Attachment behavior

This package keeps attachment files on the local filesystem, even though card/comment persistence is handled by SQLite.

Attachment paths are derived from the active SQLite engine and follow the same board/status layout used by kanban-lite:

```text
.kanban/boards/<boardId>/<status>/attachments/<filename>
```

`materializeAttachment(...)` returns the existing local file path when the attachment exists and is registered on the card.

## Build output

The published CommonJS entrypoint is:

```text
dist/index.cjs
```

The package exports map points `require` and `default` at that file, and declarations are emitted to `dist/index.d.ts`.

## Development

```bash
npm install
npm run build
npm test
npm run test:integration
npm run typecheck
```

From the repository root you can also run:

```bash
pnpm --filter kl-plugin-storage-sqlite build
pnpm --filter kl-plugin-storage-sqlite test:integration
```

## Validation in this package

The package-local test suite covers real SQLite behavior, including:

- schema creation
- card CRUD
- comment persistence
- metadata / forms / formData round-trips
- board-scoped scans and deletes
- attachment copy/materialization behavior
