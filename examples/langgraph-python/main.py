#!/usr/bin/env python3
"""main.py — LangGraph Backlog Orchestrator entry point.

Runs the durable backlog-review graph against a live kanban-lite server,
pauses at the human-approval interrupt gate, collects operator input from the
terminal, then resumes the graph to apply approved updates.

Usage::

    python main.py              # interactive run
    python main.py --dry-run    # fetch + propose but skip writes

Environment (copy .env.example → .env and fill in):
    KANBAN_LITE_URL   Base URL of the running kanban-lite server (default: http://localhost:3000)
    THREAD_ID         LangGraph thread identifier (default: backlog-review-001)

See README.md for full setup instructions and background on LangGraph
interrupt / Command / thread_id concepts.
"""

from __future__ import annotations

import os
import sys

from dotenv import load_dotenv
from langgraph.types import Command

from graph import BacklogState, build_graph

load_dotenv()

# Each unique THREAD_ID is an independent durable execution session.
# Reusing the same ID on a second run within the same process would replay
# from the last checkpoint; change the value to start a fresh run.
# With MemorySaver, state lives only in RAM — every new process begins clean.
THREAD_ID = os.getenv("THREAD_ID", "backlog-review-001")

_INITIAL_STATE: BacklogState = {
    "tasks": [],
    "proposals": [],
    "approved_proposals": [],
    "applied_results": [],
}


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────


def _get_interrupt_payload(graph, config: dict) -> dict | None:
    """Return the interrupt payload if the graph is currently paused.

    Inspects the checkpointed state snapshot for pending tasks that carry
    an interrupt raised by interrupt() inside a node.  Returns None when the
    graph has already completed or has not yet produced any interrupt.
    """
    snapshot = graph.get_state(config)
    if not snapshot.next:
        return None
    for task in snapshot.tasks:
        for intr in task.interrupts:
            return intr.value  # return the first interrupt payload found
    return None


def _parse_approval_input(raw: str, n_proposals: int) -> list[int]:
    """Convert operator input string to a list of approved proposal indices.

    Accepted formats:
      - "all"           → approve every proposal
      - "none" or ""    → approve nothing (skip all)
      - "0, 2, 3"       → approve proposals at those indices
    """
    raw = raw.strip().lower()
    if raw == "all":
        return list(range(n_proposals))
    if raw in ("none", ""):
        return []
    return [
        int(x.strip())
        for x in raw.split(",")
        if x.strip().isdigit()
    ]


# ─────────────────────────────────────────────────────────────────────────────
# Main orchestration loop
# ─────────────────────────────────────────────────────────────────────────────


def run(dry_run: bool = False) -> None:
    """Execute one full backlog-review cycle.

    Phase 1 — graph runs until interrupt()
        fetch_backlog  →  propose_updates  →  human_approval (paused)

    Phase 2 — operator reviews proposals in the terminal
        (skipped in dry-run mode; approved_indices = [])

    Phase 3 — graph resumes via Command(resume=approved_indices)
        human_approval (resumed)  →  apply_updates  →  END
    """
    graph = build_graph()
    config = {"configurable": {"thread_id": THREAD_ID}}
    kanban_url = os.getenv("KANBAN_LITE_URL", "http://localhost:3000")

    print("=" * 54)
    print("  Kanban-Lite Backlog Orchestrator (LangGraph)")
    print("=" * 54)
    print(f"  Board  : {kanban_url}")
    print(f"  Thread : {THREAD_ID}")
    if dry_run:
        print("  Mode   : dry-run (no writes)")
    print()

    # ── Phase 1: run graph until the human-approval interrupt ─────────────────
    print("Phase 1 — Fetching backlog and generating proposals...")
    for _ in graph.stream(_INITIAL_STATE, config=config, stream_mode="values"):
        pass  # consume events; stream ends when interrupt() fires or graph ends

    interrupt_payload = _get_interrupt_payload(graph, config)

    if interrupt_payload is None:
        # No proposals were generated or the graph finished without an
        # approval gate (e.g. all tasks already triaged).
        print("\nGraph completed — no pending approval gate. Nothing to do.")
        return

    # ── Phase 2: present proposals to the operator ────────────────────────────
    proposals: list[dict] = interrupt_payload.get("proposals", [])
    print()
    print("Phase 2 — Proposals for Review")
    print("-" * 40)

    if not proposals:
        print("No actionable proposals generated for the current backlog.")
        approved_indices: list[int] = []
    else:
        for p in proposals:
            change_str = ", ".join(f"{k} -> {v}" for k, v in p["changes"].items())
            print(f"  [{p['index']}] {p['task_title']}")
            print(f"       set  {change_str}")
            print()

        if dry_run:
            print("[dry-run] Skipping approval prompt — no writes will be made.")
            approved_indices = []
        else:
            raw = input(
                "Enter comma-separated indices to approve "
                "(or 'all' / 'none' / blank to skip): "
            )
            approved_indices = _parse_approval_input(raw, len(proposals))

    # ── Phase 3: resume graph and apply approved updates ─────────────────────
    print()
    print(f"Phase 3 — Applying {len(approved_indices)} update(s)...")

    for _ in graph.stream(
        Command(resume=approved_indices), config=config, stream_mode="values"
    ):
        pass  # apply_updates runs here; consume to completion

    # ── Summary ───────────────────────────────────────────────────────────────
    final = graph.get_state(config)
    applied: list[dict] = final.values.get("applied_results", [])

    print()
    print("=" * 54)
    if applied:
        print(f"Applied {len(applied)} update(s) to kanban-lite:")
        for r in applied:
            title = r.get("title") or r.get("id", "unknown")
            priority = r.get("priority", "?")
            status = r.get("status", "?")
            print(f"  [OK] {title}")
            print(f"       priority={priority}  status={status}")
    else:
        print("No updates applied.")

    print()
    print(f"Thread '{THREAD_ID}' state is preserved in the checkpointer.")
    print(
        "To replay: reuse the same THREAD_ID.  "
        "To start fresh: change THREAD_ID or restart the process."
    )
    print("=" * 54)


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    run(dry_run="--dry-run" in sys.argv)
