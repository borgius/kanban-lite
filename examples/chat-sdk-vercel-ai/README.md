# Chat SDK + Vercel AI × kanban-lite

A self-hosted Next.js demo that launches its **own local kanban-lite instance** and presents **IncidentMind** as a fictional incident-operations layer for **CorePilot**. The chat experience is powered by the [Vercel AI SDK](https://sdk.vercel.ai), while kanban-lite remains the central system of record for board state, comments, forms, statuses, and action webhooks.

## What this demo shows

| Feature | Detail |
| --- | --- |
| **IncidentMind framing** | The UI frames the example as IncidentMind for CorePilot, a fictional incident-operations layer built around free kanban-lite rather than a separate system replacing it. |
| **Chat → kanban-lite** | The AI calls real kanban-lite REST endpoints to create cards, inspect cards, move cards, add comments, submit forms, and trigger card actions. |
| **Streaming UI** | Messages stream in real time via the Vercel AI SDK `useChat` hook and server-sent events. |
| **Private demo workspace** | `npm run dev` / `npm run start` boot a dedicated kanban-lite workspace with its own `demo-workspace/.kanban.json`. |
| **Seeded workflows** | The local board is automatically seeded with the stable cards `Investigate billing alert spike` and `Deploy API v2.4.1`, both wired for comments, reusable forms, and named actions. |
| **Operator-triggered automations** | Card actions fire explicit action-webhook requests such as `notify-slack`, `escalate`, `deploy`, and `rollback`; the demo keeps automation honest by persisting deterministic kanban-lite follow-up comments/cards/status changes instead of pretending an unsupported autonomous incident loop exists. |
| **Real integration** | `lib/kanban.ts` calls the documented kanban-lite REST API, and the example test suite verifies card create/move/comment/form/action flows end to end. |

## Architecture

```text
app/page.tsx            ← useChat hook, renders chat + tool result bubbles
       ↓  POST /api/chat (Server-Sent Events)
app/api/chat/route.ts   ← streamText + tool definitions
       ↓  tool execute()
lib/kanban.ts           ← kanban-lite HTTP client for cards/comments/forms/actions
       ↓  fetch()
local kanban-lite       ← own standalone instance + own demo-workspace/.kanban.json
```

## Prerequisites

- **Node.js 20+**
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
| --- | --- | --- |
| `OPENAI_API_KEY` | _(required)_ | Your OpenAI API key |
| `OPENAI_MODEL` | `gpt-4.1-mini` | Optional model override for the chat route |
| `KANBAN_PORT` | `3000` | Port for the local kanban-lite instance started by the launcher |
| `CHAT_PORT` | `3001` | Port for the local Next.js chat app started by the launcher |
| `ACTION_WEBHOOK_SECRET` | auto-generated per run when unset | Optional local shared secret embedded into the configured action webhook URL and validated by `/api/action-webhook`; if you set it manually, use a random value with at least 24 characters |

The launcher reads `.env`, `.env.local`, and the usual mode-specific env files, then derives the internal Kanban/chat URLs automatically from `KANBAN_PORT` and `CHAT_PORT`. If `ACTION_WEBHOOK_SECRET` is blank or unset, the launcher generates a fresh local secret for that run and rewrites `demo-workspace/.kanban.json` before either app starts.

## Run

```bash
npm run dev
```

The command starts both apps:

- **kanban-lite board** → [http://127.0.0.1:3000](http://127.0.0.1:3000)
- **IncidentMind chat** → [http://127.0.0.1:3001](http://127.0.0.1:3001)

Both URLs are also printed in the terminal every time you run `npm run dev` or `npm run start`.

The local kanban-lite instance uses this example's dedicated workspace config:

- `demo-workspace/.kanban.json`
- `demo-workspace/.kanban/` (runtime-generated cards; ignored in git)

On first launch, the stack seeds the stable CorePilot demo cards `Investigate billing alert spike` and `Deploy API v2.4.1` so you can immediately try comments, form submissions, status changes, and explicit action triggers without creating setup data by hand.

## Integration tests

This example ships a live integration test that exercises the real chat route and verifies kanban card state:

```bash
npm test
```

What it does:

- boots the standalone kanban server from the repo source in a temporary workspace
- calls `app/api/chat/route.ts` with a real OpenAI model using your `OPENAI_API_KEY`
- verifies that the conversation can create/move cards, add comments, submit attached forms, and trigger card actions

If `OPENAI_API_KEY` is missing, the integration suite skips itself instead of failing noisily.

## Example prompts

- `List the CorePilot incident board and tell me which cards already expose actions or attached forms in kanban-lite`
- `Add a comment to "Investigate billing alert spike" saying "Owner is Alice and this looks critical."`
- `Submit the incident-report form on "Investigate billing alert spike" with severity critical, owner Alice, and service billing-api`
- `Trigger the notify-slack action on "Investigate billing alert spike"`
- `Submit the release-checklist form on "Deploy API v2.4.1" with environment production, approved true, and owner Jamie`
- `Trigger the deploy action on "Deploy API v2.4.1" after the approved release-checklist is recorded`

## Live demo guide

- Presenter-ready walkthrough: [`./INCIDENTMIND-COREPILOT-LIVE-DEMO.md`](./INCIDENTMIND-COREPILOT-LIVE-DEMO.md)
- Slidev presentation deck: [`./INCIDENTMIND-COREPILOT-LIVE-DEMO.slides.md`](./INCIDENTMIND-COREPILOT-LIVE-DEMO.slides.md)

## Demo workflow notes

- **Comments** are the best fit for freeform card-specific instructions, notes, or follow-ups in IncidentMind, but they are still stored as kanban-lite card comments.
- **Forms** are the best fit when you want the agent to persist structured data such as incident metadata in `incident-report` or release approval details in `release-checklist`.
- **Actions** are the best fit when the card already exposes a named operator-triggered automation like `notify-slack`, `escalate`, `deploy`, or `rollback`.
- The committed `demo-workspace/.kanban.json` only carries a placeholder action-webhook token. `npm run dev` / `npm run start` rewrites it locally with either your env-provided `ACTION_WEBHOOK_SECRET` or a freshly generated per-run secret before the demo starts.
- That local webhook now adds a visible `IncidentMind automation` comment for every supported action, creates a deterministic escalation follow-up card for incident escalations, and only moves deploy cards to `done` after the `release-checklist` records `approved: true`.
- This protection is intentionally lightweight and local-demo-oriented: it blocks blind unauthenticated mutation requests against the bare route and avoids shipping a predictable token, but it is not a replacement for production auth, signatures, or network isolation.

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

_This example is intentionally compact but self-contained: one launcher script starts the local kanban-lite stack, seeds a focused CorePilot board, and keeps the IncidentMind framing honest with live integration coverage._
