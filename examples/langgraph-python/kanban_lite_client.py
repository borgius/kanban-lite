"""kanban_lite_client.py
~~~~~~~~~~~~~~~~~~~~~~~
Minimal synchronous HTTP client for the kanban-lite REST API.

The standalone kanban-lite server must be running at KANBAN_LITE_URL
(default: http://localhost:3000).

Start with:   kl serve     (repo root)
              kanban-md    (repo root, alternative)
API docs:     http://localhost:3000/api/docs
OpenAPI JSON: http://localhost:3000/api/docs/json
"""

from __future__ import annotations

import os
from typing import Any

import requests


class KanbanLiteError(Exception):
    """Raised when the kanban-lite API returns a non-ok response."""


class KanbanLiteClient:
    """Thin wrapper around the kanban-lite REST API.

    All methods target the **default board** via the /api/tasks/* routes.
    To target a specific board, use /api/boards/{boardId}/tasks/* instead
    (extend this client with a board_id parameter if needed).

    Authentication: the standalone server ships with no auth by default.
    If you have enabled the kl-auth-plugin, set KL_API_KEY in .env and
    pass it as a Bearer token in self._headers().
    """

    def __init__(self, base_url: str | None = None) -> None:
        self.base_url = (
            base_url or os.getenv("KANBAN_LITE_URL", "http://localhost:3000")
        ).rstrip("/")

    # ------------------------------------------------------------------ #
    # Private helpers                                                      #
    # ------------------------------------------------------------------ #

    def _get(self, path: str, params: dict[str, str] | None = None) -> Any:
        url = f"{self.base_url}{path}"
        resp = requests.get(url, params=params, timeout=10)
        resp.raise_for_status()
        payload = resp.json()
        if not payload.get("ok"):
            raise KanbanLiteError(payload.get("error", "Unknown API error"))
        return payload["data"]

    def _put(self, path: str, body: dict) -> Any:
        url = f"{self.base_url}{path}"
        resp = requests.put(url, json=body, timeout=10)
        resp.raise_for_status()
        payload = resp.json()
        if not payload.get("ok"):
            raise KanbanLiteError(payload.get("error", "Unknown API error"))
        return payload["data"]

    # ------------------------------------------------------------------ #
    # Public API                                                           #
    # ------------------------------------------------------------------ #

    def list_tasks(
        self,
        status: str | None = None,
        priority: str | None = None,
        assignee: str | None = None,
    ) -> list[dict]:
        """Return all tasks from the default board, with optional filters.

        Args:
            status:   Filter to a specific column name (e.g. "backlog").
            priority: Filter by priority level: critical | high | medium | low.
            assignee: Filter by assignee name.

        Returns:
            List of task dicts (id, title, status, priority, assignee, labels, …).
        """
        params: dict[str, str] = {}
        if status:
            params["status"] = status
        if priority:
            params["priority"] = priority
        if assignee:
            params["assignee"] = assignee
        return self._get("/api/tasks", params=params)

    def get_task(self, task_id: str) -> dict:
        """Return a single task by full or partial ID."""
        return self._get(f"/api/tasks/{task_id}")

    def update_task(self, task_id: str, **fields: Any) -> dict:
        """Apply field changes to an existing task.

        Only the supplied fields are modified; omitted fields are left
        unchanged (server-side partial-update semantics).

        Supported fields: status, priority, assignee, labels, metadata,
                          content, dueDate, actions, forms, formData.

        Args:
            task_id: Full or partial task ID.
            **fields: Field names and new values to apply.

        Returns:
            The updated task dict as returned by the API.
        """
        return self._put(f"/api/tasks/{task_id}", fields)
