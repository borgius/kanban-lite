# Examples

This directory reserves the canonical home for runnable kanban-lite integration examples.

## Canonical example apps

| Folder | Runtime | Purpose | Local install/run expectation |
| --- | --- | --- | --- |
| `chat-sdk-vercel-ai/` | TypeScript / Node.js | Show a kanban-lite workflow integrated with the Chat SDK / Vercel AI ecosystem. | Install and run **inside the example folder only** using the app-local manifest and commands; `npm test` there runs the live chat→card integration suite. |
| `langgraph-python/` | Python | Show durable task orchestration and approval flows backed by kanban-lite. | Create a local virtual environment inside the example folder and install only that app's Python dependencies. |
| `mastra-agent-ops/` | TypeScript / Node.js | Show supervisor-style agent orchestration around kanban-lite operations. | Install and run **inside the example folder only** using the app-local manifest and commands. |

These folder names are fixed for downstream docs and implementation tasks.

## Runtime-boundary contract

- `examples/*` stays **outside** the root `pnpm` workspace by default.
- Do **not** add `examples/*` to `pnpm-workspace.yaml` unless an example proves it needs explicit workspace wiring for a concrete build or developer-experience payoff.
- Do **not** rely on root-level scripts to install, build, or run example apps.
- Each example owns its own runtime manifest, lockfile (if needed), source entrypoints, README, and local commands.
- Root `build` / `watch` behavior must remain unchanged unless a future task documents and justifies an opt-in exception.

## Local install and run expectations

Use the repo root for the main product and each example folder for its own dependencies:

- TypeScript examples should install dependencies from within the example directory with the package manager chosen by that example.
- The Python example should create an app-local virtual environment and install from its own dependency manifest.
- Example-specific commands should be documented in each example README rather than added to the root repo scripts.
- Cross-example shared tooling should be avoided unless there is a clear maintenance benefit.

## Environment file convention

Examples must use placeholder-only environment templates:

- Commit `.env.example` for every example that needs runtime configuration.
- Keep committed env templates free of real secrets, tokens, account ids, or live endpoints.
- Use obvious placeholder values such as `YOUR_API_KEY_HERE` or `http://localhost:3000`.
- Prefer example-local runtime files such as `.env.local` or `.env` only after copying from `.env.example`.
- Document supported providers or model vendors in the example README without making one secret-bearing vendor config mandatory at the repo root.

## What is intentionally not happening here

- No root `package.json` script changes.
- No `pnpm-workspace.yaml` enrollment for `examples/*`.
- No shared secret file at the repo root for example apps.

That keeps the examples self-contained, easy to delete, and nicely isolated from the main monorepo build graph — like good neighbors with their own fences.
