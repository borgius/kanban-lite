"""graph.py
~~~~~~~~~~
LangGraph state graph for the kanban-lite backlog orchestrator.

Graph topology (linear, with human-approval interrupt gate):

    fetch_backlog  -->  propose_updates  -->  human_approval  -->  apply_updates  -->  END
                                                    ^
                                             interrupt() pauses here
                                         resumed via Command(resume=[...])

Key LangGraph concepts illustrated:
  - StateGraph + TypedDict schema for typed, mutable shared state
  - MemorySaver checkpointer for durable (per-thread) execution
  - interrupt() for human-in-the-loop approval before writes
  - Command(resume=...) to hand control back to the graph

The proposal engine (_generate_proposals) is rule-based by default so the
example runs with no API keys.  See README § "Swapping in an LLM" for how
to replace it with a LangChain / OpenAI / Anthropic call.
"""

from __future__ import annotations

from typing import TypedDict

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, StateGraph
from langgraph.types import interrupt


# ─────────────────────────────────────────────────────────────────────────────
# State schema
# ─────────────────────────────────────────────────────────────────────────────


class BacklogState(TypedDict):
    """Shared mutable state threaded through every node.

    Field lifecycle
    ---------------
    tasks              → populated by fetch_backlog
    proposals          → populated by propose_updates; read by human_approval
    approved_proposals → set by human_approval (post-interrupt resume)
    applied_results    → set by apply_updates; final output of the run
    """

    tasks: list[dict]
    proposals: list[dict]
    approved_proposals: list[dict]
    applied_results: list[dict]


# ─────────────────────────────────────────────────────────────────────────────
# Proposal engine  (rule-based default; swap for LLM — see README)
# ─────────────────────────────────────────────────────────────────────────────

_URGENCY_KEYWORDS = frozenset({"urgent", "bug", "blocker", "critical", "hotfix", "fix"})


def _generate_proposals(tasks: list[dict]) -> list[dict]:
    """Analyse backlog tasks and return a list of proposed field changes.

    Rules applied (in descending specificity):
      1. Title contains an urgency keyword  →  priority = "high"
      2. Priority is absent or "low"        →  priority = "medium"

    Only tasks whose status is an unstarted column (backlog / todo / empty)
    are considered.  Tasks already in-progress or done are left alone.

    Returns:
        List of proposal dicts:
          [{"task_id": str, "task_title": str, "changes": {field: value}}, …]

    To replace with an LLM, substitute this function with a LangChain chain
    or direct SDK call that produces the same list shape.  Example sketch::

        from langchain_openai import ChatOpenAI
        llm = ChatOpenAI(model="gpt-4o-mini")

        def _generate_proposals(tasks):
            result = llm.invoke(
                f"Propose priority changes for these tasks: {tasks}"
            )
            # parse result.content → same list shape
            ...
    """
    proposals: list[dict] = []

    for task in tasks:
        status = (task.get("status") or "").lower()
        if status not in ("backlog", "todo", ""):
            continue  # skip in-progress or completed work

        title_lower = (task.get("title") or "").lower()
        current_priority = (task.get("priority") or "").lower()
        changes: dict[str, str] = {}

        if any(kw in title_lower for kw in _URGENCY_KEYWORDS):
            if current_priority not in ("high", "critical"):
                changes["priority"] = "high"
        elif current_priority not in ("medium", "high", "critical"):
            changes["priority"] = "medium"

        if changes:
            proposals.append(
                {
                    "task_id": task["id"],
                    "task_title": task.get("title") or task["id"],
                    "changes": changes,
                }
            )

    return proposals


# ─────────────────────────────────────────────────────────────────────────────
# Graph nodes
# ─────────────────────────────────────────────────────────────────────────────


def fetch_backlog(state: BacklogState) -> dict:
    """Node 1 — Fetch the current task list from kanban-lite.

    Calls GET /api/tasks on the default board and stores the results in
    state["tasks"].  The kanban-lite server URL is read from KANBAN_LITE_URL
    (default: http://localhost:3000).
    """
    from kanban_lite_client import KanbanLiteClient

    client = KanbanLiteClient()
    tasks = client.list_tasks()
    print(f"[fetch_backlog] Retrieved {len(tasks)} task(s) from kanban-lite.")
    return {"tasks": tasks}


def propose_updates(state: BacklogState) -> dict:
    """Node 2 — Generate proposed field changes for unstarted tasks.

    Delegates to _generate_proposals() which is rule-based by default.
    Swap that function for an LLM call to enable AI-driven triage.
    """
    proposals = _generate_proposals(state["tasks"])
    print(f"[propose_updates] Generated {len(proposals)} proposal(s).")
    return {"proposals": proposals}


def human_approval(state: BacklogState) -> dict:
    """Node 3 — Pause graph execution to collect human approval.

    LangGraph interrupt gate
    ------------------------
    Calling interrupt() serialises the current graph state to the checkpointer
    and **suspends execution**.  The value passed becomes the interrupt payload
    surfaced to the caller via graph.get_state(config).

    To resume, the caller passes Command(resume=approved_indices) on the next
    graph.stream() call for the same thread_id.  interrupt() then *returns*
    that value and execution continues below the call site.

    If there are no proposals (e.g. the board is already triaged), the gate is
    skipped entirely and the graph advances to apply_updates with an empty list.
    """
    if not state["proposals"]:
        print("[human_approval] No proposals — skipping approval gate.")
        return {"approved_proposals": []}

    # ── interrupt() pauses the graph here ────────────────────────────────────
    # The dict below is the interrupt *payload* visible to the caller.
    # The graph resumes when Command(resume=approved_indices) is passed.
    approved_indices: list[int] = interrupt(
        {
            "message": (
                "Review the proposed backlog updates and reply with the "
                "indices you want to apply (e.g. [0, 2]) or [] to skip all."
            ),
            "proposals": [
                {
                    "index": i,
                    "task_id": p["task_id"],
                    "task_title": p["task_title"],
                    "changes": p["changes"],
                }
                for i, p in enumerate(state["proposals"])
            ],
        }
    )
    # ── execution resumes here after Command(resume=approved_indices) ─────────

    safe_indices = [
        i
        for i in (approved_indices or [])
        if isinstance(i, int) and 0 <= i < len(state["proposals"])
    ]
    approved = [state["proposals"][i] for i in safe_indices]
    print(f"[human_approval] Operator approved {len(approved)} proposal(s).")
    return {"approved_proposals": approved}


def apply_updates(state: BacklogState) -> dict:
    """Node 4 — Write approved field changes back to kanban-lite.

    Calls PUT /api/tasks/{id} for each approved proposal.  Only the fields
    listed in proposal["changes"] are modified; all other task fields are
    left unchanged (server-side partial-update semantics).
    """
    from kanban_lite_client import KanbanLiteClient

    client = KanbanLiteClient()
    results: list[dict] = []

    for proposal in state["approved_proposals"]:
        updated = client.update_task(proposal["task_id"], **proposal["changes"])
        results.append(updated)
        change_str = ", ".join(f"{k}={v}" for k, v in proposal["changes"].items())
        print(f"[apply_updates] Updated '{proposal['task_title']}' → {change_str}")

    return {"applied_results": results}


# ─────────────────────────────────────────────────────────────────────────────
# Graph assembly
# ─────────────────────────────────────────────────────────────────────────────


def build_graph() -> StateGraph:
    """Compile and return the orchestration graph with an in-memory checkpointer.

    Graph topology::

        fetch_backlog -> propose_updates -> human_approval -> apply_updates -> END
                                                  ^
                                           interrupt() gate

    Checkpointer
    ------------
    MemorySaver stores state in RAM for the current process lifetime.  Thread
    state is keyed by thread_id (set in the config dict passed to stream/invoke).
    Swapping in SqliteSaver or another persistent backend gives cross-process
    durability without any node-level code changes — see README for details.

    Returns:
        Compiled LangGraph CompiledStateGraph ready for stream() / invoke().
    """
    builder = StateGraph(BacklogState)

    builder.add_node("fetch_backlog", fetch_backlog)
    builder.add_node("propose_updates", propose_updates)
    builder.add_node("human_approval", human_approval)
    builder.add_node("apply_updates", apply_updates)

    builder.set_entry_point("fetch_backlog")
    builder.add_edge("fetch_backlog", "propose_updates")
    builder.add_edge("propose_updates", "human_approval")
    builder.add_edge("human_approval", "apply_updates")
    builder.add_edge("apply_updates", END)

    checkpointer = MemorySaver()
    return builder.compile(checkpointer=checkpointer)
