# kanban-lite &times; LangGraph Python — Backlog Orchestrator

A minimal, runnable Python example showing how to use **LangGraph** to build a
durable, interrupt-driven backlog-management agent backed by **kanban-lite** as
the task board.

## What it demonstrates

```
fetch_backlog  -->  propose_updates  -->  (interrupt) human_approval  -->  apply_updates
```

| Concept | Where |
| --- | --- |
| **StateGraph + typed state** | `graph.py` — `BacklogState` TypedDict, four nodes |
| **Durable execution / thread_id** | `main.py` — `THREAD_ID` config key; same ID resumes from checkpoint |
| **MemorySaver checkpointer** | `graph.py` — `build_graph()`, swappable for SQLite |
| **interrupt() — human-in-the-loop** | `graph.py` — `human_approval` node calls `interrupt(payload)` |
| **Command(resume=...)** | `main.py` — Phase 3 resumes graph with operator-approved indices |
| **Real kanban-lite integration** | `kanban_lite_client.py` — live REST API calls (no mocks) |

## Quick start

### Prerequisites

- Python 3.11 or later
- A running **kanban-lite** server — from the repo root run `kl serve` (or `kanban-md`)

### 1 — Configure environment

```bash
cp .env.example .env
# Edit .env if your server is not at http://localhost:3000
```

### 2 — Install dependencies

```bash
cd examples/langgraph-python
python -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 3 — Run

```bash
python main.py
```

For a no-write dry run (fetches + proposes but skips approval and writes):

```bash
python main.py --dry-run
```

---

## File structure

```
langgraph-python/
├── kanban_lite_client.py   # Thin HTTP client for the kanban-lite REST API
├── graph.py                # LangGraph state graph + node definitions
├── main.py                 # Entry point — runs graph, collects approval, resumes
├── requirements.txt        # Python dependencies
├── .env.example            # Environment variable template (safe to commit)
└── README.md               # This file
```

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `KANBAN_LITE_URL` | `http://localhost:3000` | Base URL of the running kanban-lite server |
| `THREAD_ID` | `backlog-review-001` | LangGraph thread ID for checkpointing |

See `.env.example` for the full template including optional LLM provider keys.

---

## How the approval flow works

```
                ┌────────────────────────────────────────────┐
  graph.stream()│  fetch_backlog  ->  propose_updates         │
  (Phase 1)     │        ->  human_approval                  │
                │               interrupt() <-- paused here  │
                └────────────────────────────────────────────┘
                                    |
                    operator reviews proposals in terminal
                    enters comma-separated indices to approve
                                    |
                ┌────────────────────────────────────────────┐
  graph.stream()│  human_approval (resumed with indices)     │
  Command(...)  │        ->  apply_updates  ->  END          │
  (Phase 3)     └────────────────────────────────────────────┘
```

1. **Phase 1** — `graph.stream()` runs `fetch_backlog` and `propose_updates`,
   then hits `interrupt()` inside `human_approval` and suspends.  Graph state
   is serialised to the checkpointer under the current `thread_id`.
2. **Phase 2** — `main.py` calls `graph.get_state(config)` to retrieve the
   interrupt payload, formats the proposals, and waits for operator input.
3. **Phase 3** — `graph.stream(Command(resume=approved_indices), ...)` resumes
   the suspended node.  `interrupt()` returns the approved indices, the node
   builds `approved_proposals`, and `apply_updates` writes changes to
   kanban-lite via `PUT /api/tasks/{id}`.

The `THREAD_ID` ties all three phases together and ensures the checkpointer
hands state across the pause/resume boundary.

---

## Swapping in an LLM

The default `_generate_proposals()` function in `graph.py` is rule-based so
the example runs with no API keys.

To replace it with an LLM:

1. Uncomment one of the provider libraries in `requirements.txt` and reinstall:
   ```bash
   pip install langchain-openai   # or langchain-anthropic
   ```
2. Set the relevant key in `.env`:
   ```bash
   OPENAI_API_KEY=sk-...
   ```
3. Replace `_generate_proposals(tasks)` in `graph.py` with an LLM chain that
   returns the **same list shape**:
   ```python
   from langchain_openai import ChatOpenAI
   from langchain_core.output_parsers import JsonOutputParser

   llm = ChatOpenAI(model="gpt-4o-mini")

   def _generate_proposals(tasks: list[dict]) -> list[dict]:
       result = llm.invoke(
           f"You are a project manager. Propose priority field changes for "
           f"these backlog tasks. Return a JSON list with keys: "
           f"task_id, task_title, changes (dict of field -> value).\n\nTasks: {tasks}"
       )
       return JsonOutputParser().parse(result.content)
   ```

---

## Using a persistent checkpointer

`MemorySaver` keeps state in RAM — it is lost when the process exits.

For durability across restarts, swap in `SqliteSaver`:

```python
from langgraph.checkpoint.sqlite import SqliteSaver

with SqliteSaver.from_conn_string(".checkpoints.db") as checkpointer:
    graph = builder.compile(checkpointer=checkpointer)
```

Install the extra dependency first:

```bash
pip install langgraph-checkpoint-sqlite
```

With `SqliteSaver`, re-running `main.py` with the same `THREAD_ID` resumes the
graph from exactly where it left off — including across process restarts.

---

## Docs guide

A step-by-step build guide for this example is published at
`/docs/examples/langgraph-python/` in the kanban-lite docs site.

## kanban-lite integration seam

This example uses only the public kanban-lite REST API:

| HTTP method | Endpoint | Used by |
| --- | --- | --- |
| `GET /api/tasks` | List all tasks (default board) | `fetch_backlog` node |
| `PUT /api/tasks/{id}` | Update task fields | `apply_updates` node |

Start the server with `kl serve` (repo root) and optionally browse the
interactive API docs at `http://localhost:3000/api/docs`.
