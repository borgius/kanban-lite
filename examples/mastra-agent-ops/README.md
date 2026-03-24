# Mastra Agent Ops — kanban-lite example

A minimal, runnable TypeScript example that demonstrates **supervisor-style agent orchestration over kanban-lite** using [Mastra](https://mastra.ai/).

A single **Coordinator agent** manages your kanban board through three operational modes — **intake**, **planning**, and **reporting** — with an explicit approval gate in front of every write operation.

> **Docs guide:** `/docs/examples/mastra/` — full step-by-step walkthrough published on the kanban-lite docs site.

---

## What this example shows

| Concept | Where to look |
|---|---|
| Mastra agent registry | [`src/mastra/index.ts`](src/mastra/index.ts) |
| Supervisor agent with tool set | [`src/mastra/agents/coordinator.ts`](src/mastra/agents/coordinator.ts) |
| kanban-lite REST tools (read + write) | [`src/mastra/tools/kanban.ts`](src/mastra/tools/kanban.ts) |
| Streaming chat route (Next.js App Router) | [`app/api/agent/route.ts`](app/api/agent/route.ts) |
| Chat UI with approval buttons | [`app/page.tsx`](app/page.tsx) |

### Approval-aware writes

Before the Coordinator calls any write tool (`createCard`, `updateCard`, `moveCard`) it is instructed to emit a formatted **PROPOSED ACTION** block and wait for the user to type `approve`. The UI detects this block and renders **Approve / Reject** buttons so no manual typing is needed.

Read-only tools (`listCards`, `getCard`) execute immediately without a gate.

### Three project-ops modes

- **INTAKE** — triage new work requests; deduplicates against live board, proposes a card with title, priority, and labels.
- **PLANNING** — surveys all columns, identifies stale or misaligned cards, proposes targeted reorganization moves.
- **REPORTING** — reads all columns and returns a structured status summary (counts, blockers, highlights).

---

## Prerequisites

| Tool | Version |
|---|---|
| Node.js | 20 or later |
| npm / pnpm / yarn | (any; example uses npm) |
| kanban-lite | latest |
| OpenAI API key | (or any supported AI SDK provider) |

---

## Local setup

### 1. Start the kanban-lite server

In a separate terminal, start the kanban-lite standalone API on port 3001.
(Any existing board in the current directory is used automatically.)

```bash
# From any directory that has a .kanban.json, or create a fresh one:
npx kanban-lite serve --port 3001
```

If you don't have an existing board, initialize one first:

```bash
npx kanban-lite init
npx kanban-lite serve --port 3001
```

### 2. Configure environment variables

```bash
cp .env.example .env
# Edit .env and set your OPENAI_API_KEY
```

`.env.example` documents every supported variable. The only required secret is `OPENAI_API_KEY`. `KANBAN_API_URL` defaults to `http://localhost:3001/api`.

### 3. Install dependencies

```bash
# From inside this directory (examples/mastra-agent-ops):
npm install
```

### 4. Run the dev server

```bash
npm run dev
# → http://localhost:3002
```

Open `http://localhost:3002` in your browser to see the Coordinator chat UI.

---

## Using the app

Try these prompts to explore each mode:

| Prompt | Mode |
|---|---|
| `Show current board status` | Reporting |
| `Intake: we need to migrate our auth service to JWT` | Intake |
| `Plan: review the backlog and suggest what to prioritize` | Planning |
| `Report: what's currently in progress?` | Reporting |
| `Move the oldest backlog item to todo` | Planning (write, approval gated) |

When the Coordinator proposes a write action, the UI surfaces **Approve** and **Reject** buttons. Click **Approve** to let the agent write to your kanban board or **Reject** to cancel.

---

## Project structure

```
mastra-agent-ops/
├── app/
│   ├── api/agent/route.ts    ← streaming chat route (Next.js App Router)
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx              ← chat UI with approval UX
├── src/
│   └── mastra/
│       ├── index.ts           ← Mastra registry (agents: { coordinator })
│       ├── agents/
│       │   └── coordinator.ts ← supervisor agent definition + instructions
│       └── tools/
│           └── kanban.ts      ← kanban-lite REST API tools
├── .env.example
├── next.config.ts
├── package.json
├── README.md
└── tsconfig.json
```

---

## Changing the model

Open [`src/mastra/agents/coordinator.ts`](src/mastra/agents/coordinator.ts) and swap the `model` string:

```ts
// Default — OpenAI (uses OPENAI_API_KEY from .env)
model: "openai/gpt-4o-mini",

// Anthropic (uses ANTHROPIC_API_KEY from .env)
model: "anthropic/claude-3-5-haiku-20241022",

// Groq (uses GROQ_API_KEY from .env)
model: "groq/llama-3.3-70b-versatile",
```

Mastra's built-in model router handles provider lookup automatically.
Ensure the matching `API_KEY` variable is set in your `.env` file.
No additional package installs required for providers supported by Mastra's router.

---

## kanban-lite integration seam

This example communicates with kanban-lite exclusively through its documented
[REST API](../../docs/api.md) (`GET /api/tasks`, `POST /api/tasks`,
`PUT /api/tasks/:id`, `PATCH /api/tasks/:id/move`). No internal packages are
imported — the example remains self-contained and would work against any running
kanban-lite server regardless of installation method.

---

## Extending the example

- Add more agents (e.g. a dedicated `reporter` that generates weekly summaries) and register them in `src/mastra/index.ts`.
- Add Mastra [Memory](https://mastra.ai/docs/memory/overview) so the Coordinator remembers cross-session context.
- Add a [Workflow](https://mastra.ai/docs/workflows) to automate the intake → triage → sprint-planning pipeline.
- Integrate [AI SDK `useAssistant`](https://sdk.vercel.ai/docs/reference/ai-sdk-ui/use-assistant) for richer tool-call streaming UI.
