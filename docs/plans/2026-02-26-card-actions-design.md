# Card Actions — Design Document

**Date:** 2026-02-26

## Overview

Add per-card "actions" — named triggers (e.g. `retry`, `sendEmail`, `process`) that a user can fire from the card editor. When triggered, the system POSTs a structured payload to a single global webhook URL configured in `.kanban.json`.

## Requirements

- Actions are a simple string array stored in the card's YAML frontmatter
- A single global `actionWebhookUrl` is configured in `.kanban.json` (no UI for this — edit config directly)
- Actions can be defined at card creation time via the Create dialog
- Existing cards: actions are added/edited by modifying the YAML frontmatter directly
- The FeatureEditor header shows a "Run Action" dropdown (visible only when card has ≥1 action)
- Triggering an action is an SDK operation; server, MCP, and CLI all call through the SDK
- Full feature parity: `actions` field supported in SDK, REST API, MCP, and CLI

## Data Model

### `.kanban.json`

New top-level field:

```json
{
  "actionWebhookUrl": "https://your-server.com/actions"
}
```

### Card frontmatter

New `actions` field — omitted when undefined or empty:

```yaml
---
id: "42"
status: "in-progress"
actions:
  - retry
  - sendEmail
  - process
---
```

### `Feature` type (`src/shared/types.ts`)

```typescript
actions?: string[]
```

### Webhook payload

POST body sent to `actionWebhookUrl`:

```json
{
  "action": "retry",
  "board": "default",
  "list": "in-progress",
  "card": { ...full Feature object (filePath excluded)... }
}
```

## SDK

### Config (`src/shared/config.ts`)

Add `actionWebhookUrl?: string` to the board config type and read/write logic.

### `KanbanSDK.triggerAction`

```typescript
async triggerAction(cardId: string, action: string, boardId?: string): Promise<void>
```

1. Read `actionWebhookUrl` from `.kanban.json` — throw if not configured
2. Fetch the card (existing `getCard`)
3. Build payload: `{ action, board: boardId, list: card.status, card: sanitized }`
4. HTTP POST to `actionWebhookUrl` with `Content-Type: application/json`
5. Throw on non-2xx response

`createCard` and `updateCard` accept `actions?: string[]` in their input types and persist it to frontmatter.

## REST API

```
POST /api/tasks/:id/actions/:action
POST /api/boards/:boardId/tasks/:id/actions/:action
```

Both call `sdk.triggerAction(id, action, boardId)`. Returns `204 No Content` on success.

`POST /api/tasks` and `PUT /api/tasks/:id` accept `actions` in the request body.

## MCP

New tool: `trigger_action`
- Parameters: `cardId` (required), `action` (required), `boardId` (optional)
- Calls `sdk.triggerAction`

`create_card` and `update_card` tools accept `actions?: string[]`.

## CLI

New command: `kanban action trigger <cardId> <action> [--board <boardId>]`

`kanban create` and `kanban update` commands accept `--actions <json-array>` or repeated `--action <name>`.

## UI

### `CreateFeatureDialog`

Add a tag-style input below the labels field:
- Type an action name and press Enter (or comma) to add
- Click the × on a tag to remove it
- Submitted as `actions: string[]` in the `onCreate` payload

### `FeatureEditor` header

Add a "Run Action" split/dropdown button:
- Hidden when `card.actions` is empty or undefined
- Clicking opens a menu listing each action string
- Selecting an action calls `POST /api/tasks/:id/actions/:action`
- Shows a brief toast on success or error

No inline editing of actions in the editor — users edit the YAML file directly.

## Parser

`src/sdk/parser.ts`:
- Serialize `actions` as a YAML sequence when non-empty
- Parse `actions` from frontmatter as `string[]`
- Omit from frontmatter when undefined or `[]`

## Error Handling

- No `actionWebhookUrl` configured → SDK throws a clear error; UI shows toast "No action webhook URL configured"
- Webhook returns non-2xx → SDK throws; UI shows toast with status code
- Card not found → existing `getCard` error propagates normally

## Out of Scope

- Configuring `actionWebhookUrl` via settings UI
- Per-action webhook URLs
- Action history / audit log
- Retry logic for failed deliveries
