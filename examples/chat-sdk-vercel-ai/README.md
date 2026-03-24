# Chat SDK + Vercel AI × kanban-lite

A minimal Next.js app that lets you manage a **kanban-lite** board through a streaming AI chat interface powered by the [Vercel AI SDK](https://sdk.vercel.ai).

## What this demo shows

| Feature | Detail |
|---|---|
| **Chat → Kanban** | The AI calls tools to create cards, list cards, and move cards between columns on a live kanban-lite board. |
| **Streaming UI** | Messages stream in real-time via the Vercel AI SDK `useChat` hook and server-sent events. |
| **Real integration** | `lib/kanban.ts` calls the documented kanban-lite REST API (`GET/POST /api/boards/:boardId/tasks`, `PATCH .../move`). The example test suite verifies real card-state mutations end to end. |
| **Mock mode** | Set `KANBAN_USE_MOCK=true` to run the whole demo in-memory without a live server. |

## Architecture

```
app/page.tsx            ← useChat hook, renders chat + tool result bubbles
       ↓  POST /api/chat (Server-Sent Events)
app/api/chat/route.ts   ← streamText + tool definitions
       ↓  tool execute()
lib/kanban.ts           ← kanban-lite HTTP client (or in-memory mock)
       ↓  fetch()
kanban-lite server      ← GET/POST /api/boards/:id/tasks  PATCH .../move
```

## Prerequisites

- **Node.js 20+**
- A running **kanban-lite standalone server** — _or_ set `KANBAN_USE_MOCK=true` to skip it

  ```bash
  # Start kanban-lite in another terminal (from any directory)
  npx kanban-lite serve          # uses port 3000 by default
  # or if you have it installed globally:
  kl serve
  ```

- An **OpenAI API key** — either exported in your shell as `OPENAI_API_KEY` or stored in `.env.local` / `.env`
- _Or_ swap in any [Vercel AI SDK provider](https://sdk.vercel.ai/providers/ai-sdk-providers)

## Installation

```bash
cd examples/chat-sdk-vercel-ai
npm install          # or: pnpm install / yarn install
```

## Configuration

Copy the env template:

```bash
cp .env.example .env.local
```

Then edit `.env.local` and fill in your values:

| Variable | Default | Description |
|---|---|---|
| `OPENAI_API_KEY` | _(required)_ | Your OpenAI API key |
| `OPENAI_MODEL` | `gpt-4.1-mini` | Optional model override for the chat route |
| `KANBAN_API_URL` | `http://localhost:3000` | URL of the kanban-lite standalone server |
| `KANBAN_BOARD_ID` | `default` | Board ID to use for triage tasks |
| `KANBAN_API_TOKEN` | _(blank)_ | Bearer token if the server has `kl-auth-plugin` enabled |
| `KANBAN_USE_MOCK` | `false` | Set `true` for an in-memory mock (no server needed) |

The example folder also includes a placeholder-only `.env` file so local defaults exist even when you prefer to keep the real `OPENAI_API_KEY` in your shell environment.

## Run

```bash
npm run dev
```

Open [http://localhost:3001](http://localhost:3001).
(Port 3001 avoids clashing with the kanban-lite server on 3000.)

## Integration tests

This example ships a live integration test that exercises the real chat route and verifies kanban card state:

```bash
npm test
```

What it does:

- boots the standalone kanban server from the repo source in a temporary workspace
- calls `app/api/chat/route.ts` with a real OpenAI model using your `OPENAI_API_KEY`
- verifies that the conversation creates a card and then moves it to `done`

If `OPENAI_API_KEY` is missing, the integration suite skips itself instead of failing noisily.

## Example prompts

- `Create a card: Fix the signup email flow, high priority`
- `List all backlog cards`
- `What cards are in progress?`
- `Move card mock-1 to done`
- `Create 3 tasks for the next release`

## Swapping the AI provider

Replace `@ai-sdk/openai` with any Vercel AI SDK compatible provider:

```bash
npm install @ai-sdk/anthropic
```

Then in `app/api/chat/route.ts`:

```diff
-import { openai } from '@ai-sdk/openai';
+import { anthropic } from '@ai-sdk/anthropic';

-  model: openai('gpt-4o-mini'),
+  model: anthropic('claude-3-haiku-20240307'),
```

Remove the `OPENAI_API_KEY` env var and add the chosen provider's key instead.

## Docs reference

- [kanban-lite REST API](../../docs/api.md)
- [Vercel AI SDK](https://sdk.vercel.ai/docs)
- [Next.js App Router](https://nextjs.org/docs/app)

---

_This example is intentionally minimal — one UI route, one API route, one kanban client file, and one integration test that keeps the whole thing honest. Extend freely for your own use case._
