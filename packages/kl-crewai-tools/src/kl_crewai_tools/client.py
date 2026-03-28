"""Minimal synchronous HTTP client for the kanban-lite REST API.

Based on the reference client at ``examples/langgraph-python/kanban_lite_client.py``.
Extended with POST, PATCH and DELETE verbs so the CrewAI tools can perform
the full CRUD surface.
"""

from __future__ import annotations

import os
from typing import Any

import requests


class KanbanLiteError(Exception):
    """Raised when the kanban-lite API returns a non-ok response."""


class KanbanLiteClient:
    """Thin wrapper around the kanban-lite REST API.

    All methods target the **default board** via the ``/api/tasks/*`` routes.

    Parameters
    ----------
    base_url:
        Root URL of the running kanban-lite server
        (default: ``KANBAN_LITE_URL`` env var or ``http://localhost:3000``).
    api_token:
        Optional Bearer token sent on every request.  Reads from
        ``KANBAN_LITE_TOKEN`` / ``KANBAN_TOKEN`` env vars when omitted.
    timeout:
        HTTP request timeout in seconds (default: ``10``).
    """

    def __init__(
        self,
        base_url: str | None = None,
        api_token: str | None = None,
        timeout: int = 10,
    ) -> None:
        self.base_url = (
            base_url or os.getenv("KANBAN_LITE_URL", "http://localhost:3000")
        ).rstrip("/")
        self.api_token = api_token or os.getenv("KANBAN_LITE_TOKEN") or os.getenv("KANBAN_TOKEN")
        self.timeout = timeout

    # ------------------------------------------------------------------ #
    # Private helpers                                                      #
    # ------------------------------------------------------------------ #

    def _headers(self) -> dict[str, str]:
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if self.api_token:
            headers["Authorization"] = f"Bearer {self.api_token}"
        return headers

    def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        url = f"{self.base_url}{path}"
        resp = requests.request(
            method,
            url,
            headers=self._headers(),
            timeout=self.timeout,
            **kwargs,
        )
        try:
            payload = resp.json()
        except (ValueError, requests.exceptions.JSONDecodeError):
            resp.raise_for_status()
            raise KanbanLiteError(f"Unexpected non-JSON response ({resp.status_code})")
        if not resp.ok or not payload.get("ok"):
            msg = payload.get("error", f"API error {resp.status_code}")
            raise KanbanLiteError(msg)
        return payload.get("data")

    # ------------------------------------------------------------------ #
    # Cards                                                                #
    # ------------------------------------------------------------------ #

    def list_cards(
        self,
        status: str | None = None,
        priority: str | None = None,
        assignee: str | None = None,
        label: str | None = None,
    ) -> list[dict[str, Any]]:
        """Return all cards from the default board, with optional filters."""
        params: dict[str, str] = {}
        if status:
            params["status"] = status
        if priority:
            params["priority"] = priority
        if assignee:
            params["assignee"] = assignee
        if label:
            params["label"] = label
        return self._request("GET", "/api/tasks", params=params)

    def get_card(self, card_id: str) -> dict[str, Any]:
        """Return a single card by full or partial ID."""
        return self._request("GET", f"/api/tasks/{card_id}")

    def create_card(
        self,
        content: str,
        status: str | None = None,
        priority: str | None = None,
        assignee: str | None = None,
        labels: list[str] | None = None,
        due_date: str | None = None,
    ) -> dict[str, Any]:
        """Create a new card on the default board.

        ``content`` must start with a ``# heading`` that becomes the card title.
        """
        body: dict[str, Any] = {"content": content}
        if status:
            body["status"] = status
        if priority:
            body["priority"] = priority
        if assignee:
            body["assignee"] = assignee
        if labels:
            body["labels"] = labels
        if due_date:
            body["dueDate"] = due_date
        return self._request("POST", "/api/tasks", json=body)

    def update_card(self, card_id: str, **fields: Any) -> dict[str, Any]:
        """Partial-update an existing card.  Only supplied fields change."""
        return self._request("PUT", f"/api/tasks/{card_id}", json=fields)

    def move_card(
        self, card_id: str, target_column: str, position: int | None = None
    ) -> dict[str, Any]:
        """Move a card to a different status column."""
        body: dict[str, Any] = {"status": target_column}
        if position is not None:
            body["position"] = position
        return self._request("PATCH", f"/api/tasks/{card_id}/move", json=body)

    def delete_card(self, card_id: str) -> dict[str, Any] | None:
        """Soft-delete a card."""
        return self._request("DELETE", f"/api/tasks/{card_id}")

    # ------------------------------------------------------------------ #
    # Columns                                                              #
    # ------------------------------------------------------------------ #

    def list_columns(self) -> list[dict[str, Any]]:
        """Return all columns for the default board."""
        return self._request("GET", "/api/columns")

    # ------------------------------------------------------------------ #
    # Comments                                                             #
    # ------------------------------------------------------------------ #

    def get_comments(self, card_id: str) -> list[dict[str, Any]]:
        """Return all comments for a card."""
        return self._request("GET", f"/api/tasks/{card_id}/comments")

    def add_comment(
        self, card_id: str, content: str, author: str = "crewai-agent"
    ) -> dict[str, Any]:
        """Add a comment to a card."""
        body = {"content": content, "author": author}
        return self._request("POST", f"/api/tasks/{card_id}/comments", json=body)
