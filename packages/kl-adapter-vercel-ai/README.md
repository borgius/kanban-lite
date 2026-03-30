# kl-adapter-vercel-ai

Vercel AI Chat SDK adapter for [kanban-lite](https://github.com/borgius/kanban-lite) — pre-built tool definitions, a configurable REST client, and streaming comment support.

Drop a single `createKanbanTools()` call into your `streamText()` / `generateText()` route and get full kanban-lite integration: cards CRUD, comments (including streaming), labels, actions, forms, columns, and board info.

## Install

```bash
npm install kl-adapter-vercel-ai ai zod
```

`ai` and `zod` are required peer dependencies (you likely already have them if you use the Vercel AI SDK).

## Quick start

```ts
import { streamText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { createKanbanTools } from 'kl-adapter-vercel-ai'

const tools = createKanbanTools({
  baseUrl: 'http://localhost:3000',
  boardId: 'default',
  apiToken: process.env.KANBAN_API_TOKEN,
})

export async function POST(req: Request) {
  const { messages } = await req.json()

  const result = streamText({
    model: openai('gpt-4o-mini'),
    system: 'You are a helpful assistant that manages a kanban board.',
    messages,
    tools,
    maxSteps: 8,
  })

  return result.toDataStreamResponse()
}
```

## Tools included

| Tool | Description |
| --- | --- |
| `create_card` | Create a new kanban card with title, description, priority, assignee, labels, actions, and form templates |
| `list_cards` | List cards, optionally filtered by status column |
| `get_card` | Inspect a card with full details, comments, forms, actions, and labels |
| `update_card` | Update priority, assignee, labels, or due date on an existing card |
| `move_card` | Move a card to a different status column |
| `delete_card` | Soft-delete a card |
| `add_comment` | Add a markdown comment to a card |
| `stream_comment` | Stream a comment to a card (viewers see it arrive incrementally via WebSocket) |
| `list_comments` | List all comments on a card |
| `submit_card_form` | Submit structured data to an attached card form |
| `trigger_card_action` | Trigger a named card action webhook |
| `get_board` | Get board configuration, columns, and actions |
| `list_columns` | List the status columns on a board |

## API

### `createKanbanTools(config?, options?)`

Returns a record of Vercel AI SDK `tool()` definitions.

**Config** (`KanbanClientConfig`):

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `baseUrl` | `string` | `'http://localhost:3000'` | Base URL of the kanban-lite server |
| `boardId` | `string` | `'default'` | Board ID to operate on |
| `apiToken` | `string` | — | Optional Bearer token for auth |

**Options** (`KanbanToolsOptions`):

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `listLimit` | `number` | `50` | Max cards returned by `list_cards` |
| `commentLimit` | `number` | `20` | Max recent comments in `get_card` |
| `defaultAuthor` | `string` | `'kanban-chat-agent'` | Fallback author for comments |

### `KanbanClient`

A standalone REST client class for the kanban-lite API that can be used independently from the tool definitions:

```ts
import { KanbanClient } from 'kl-adapter-vercel-ai'

const client = new KanbanClient({
  baseUrl: 'http://localhost:3000',
  boardId: 'default',
})

const cards = await client.listCards('in-progress')
const card = await client.getCard('1-my-card')
await client.addComment('1-my-card', 'bot', 'Analysis complete.')
await client.streamComment('1-my-card', 'bot', 'Streaming this content live...')
await client.moveCard('1-my-card', 'done')
```

You can also pass a `KanbanClient` instance directly to `createKanbanTools()`:

```ts
const client = new KanbanClient({ baseUrl: 'http://localhost:3000' })
const tools = createKanbanTools(client, { listLimit: 20 })
```

## Streaming comments

The `stream_comment` tool uses the `POST /api/tasks/:id/comments/stream` endpoint. Connected WebSocket viewers see the comment arrive incrementally with a live blinking-cursor indicator. This is ideal for AI agent outputs that should be visible in real-time.

## Build output

```text
dist/index.cjs   ← require() entry
dist/index.d.ts  ← TypeScript declarations
```

## Development

```bash
# From the repository root
pnpm --filter kl-adapter-vercel-ai build
pnpm --filter kl-adapter-vercel-ai test

# Or from this package directory
npm install
npm run build
npm test
```

## License

MIT
