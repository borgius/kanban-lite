"""CrewAI ``BaseTool`` subclasses for kanban-lite operations.

Each tool wraps a single REST API call via :class:`KanbanLiteClient`.
Input validation is handled by Pydantic models (``args_schema``).

Usage::

    from kl_crewai_tools import KanbanLiteClient, ListCardsTool

    client = KanbanLiteClient("http://localhost:3000")
    tool = ListCardsTool(client=client)
    result = tool.run()
"""

from __future__ import annotations

import json
from typing import Any, Optional, Type

from crewai.tools import BaseTool
from pydantic import BaseModel, Field

from kl_crewai_tools.client import KanbanLiteClient


# ------------------------------------------------------------------ #
# Input schemas                                                        #
# ------------------------------------------------------------------ #


class ListCardsInput(BaseModel):
    """Input schema for listing kanban cards."""

    status: Optional[str] = Field(
        default=None,
        description="Filter by status column, e.g. backlog | todo | in-progress | review | done",
    )
    priority: Optional[str] = Field(
        default=None,
        description="Filter by priority level: critical | high | medium | low",
    )
    assignee: Optional[str] = Field(
        default=None, description="Filter by assignee name"
    )
    label: Optional[str] = Field(
        default=None, description="Filter by label name"
    )


class GetCardInput(BaseModel):
    """Input schema for getting a single card."""

    card_id: str = Field(description="Card ID or partial card ID")


class CreateCardInput(BaseModel):
    """Input schema for creating a card."""

    content: str = Field(
        description=(
            "Markdown content for the card. "
            "Must start with a # heading that becomes the card title, "
            "e.g. '# Fix login regression\\n\\nDetails here.'"
        )
    )
    status: Optional[str] = Field(
        default=None,
        description="Initial status column (defaults to board default)",
    )
    priority: Optional[str] = Field(
        default=None,
        description="Priority level: critical | high | medium | low",
    )
    assignee: Optional[str] = Field(
        default=None, description="Assigned team member"
    )
    labels: Optional[str] = Field(
        default=None,
        description="Comma-separated label names, e.g. 'bug,frontend'",
    )
    due_date: Optional[str] = Field(
        default=None, description="Due date in ISO 8601 format, e.g. 2026-04-01"
    )


class UpdateCardInput(BaseModel):
    """Input schema for updating a card."""

    card_id: str = Field(description="Card ID or partial card ID")
    content: Optional[str] = Field(
        default=None, description="Updated Markdown content"
    )
    priority: Optional[str] = Field(
        default=None,
        description="Priority level: critical | high | medium | low",
    )
    assignee: Optional[str] = Field(
        default=None, description="Assigned team member"
    )
    labels: Optional[str] = Field(
        default=None,
        description="Comma-separated label names, e.g. 'bug,frontend'",
    )
    due_date: Optional[str] = Field(
        default=None, description="Due date in ISO 8601 format"
    )


class MoveCardInput(BaseModel):
    """Input schema for moving a card."""

    card_id: str = Field(description="Card ID or partial card ID")
    target_column: str = Field(
        description="Target status column, e.g. todo | in-progress | review | done"
    )
    position: Optional[int] = Field(
        default=None,
        description="Zero-based position within the target column (default: top)",
    )


class DeleteCardInput(BaseModel):
    """Input schema for deleting a card."""

    card_id: str = Field(description="Card ID or partial card ID")


class ListColumnsInput(BaseModel):
    """Input schema for listing columns (no parameters needed)."""


class GetCommentsInput(BaseModel):
    """Input schema for getting comments on a card."""

    card_id: str = Field(description="Card ID or partial card ID")


class AddCommentInput(BaseModel):
    """Input schema for adding a comment to a card."""

    card_id: str = Field(description="Card ID or partial card ID")
    content: str = Field(description="Markdown comment body")
    author: Optional[str] = Field(
        default=None,
        description="Display name for the comment author (default: crewai-agent)",
    )


# ------------------------------------------------------------------ #
# Tool helpers                                                         #
# ------------------------------------------------------------------ #


def _format(data: Any) -> str:
    """Return a JSON string from API response data."""
    return json.dumps(data, indent=2, default=str)


def _parse_labels(raw: str | None) -> list[str] | None:
    """Split comma-separated label string into a list."""
    if not raw:
        return None
    return [l.strip() for l in raw.split(",") if l.strip()]


# ------------------------------------------------------------------ #
# CrewAI Tools                                                         #
# ------------------------------------------------------------------ #


class ListCardsTool(BaseTool):
    """List kanban cards on the default board with optional filters."""

    name: str = "list_cards"
    description: str = (
        "List kanban cards on the default board. "
        "Optionally filter by status column, priority, assignee, or label."
    )
    args_schema: Type[BaseModel] = ListCardsInput
    client: KanbanLiteClient

    def _run(
        self,
        status: str | None = None,
        priority: str | None = None,
        assignee: str | None = None,
        label: str | None = None,
    ) -> str:
        cards = self.client.list_cards(
            status=status, priority=priority, assignee=assignee, label=label
        )
        return _format(cards)


class GetCardTool(BaseTool):
    """Retrieve full details of a single kanban card by its ID."""

    name: str = "get_card"
    description: str = (
        "Retrieve full details of a single kanban card by its ID or partial ID."
    )
    args_schema: Type[BaseModel] = GetCardInput
    client: KanbanLiteClient

    def _run(self, card_id: str) -> str:
        card = self.client.get_card(card_id)
        return _format(card)


class CreateCardTool(BaseTool):
    """Create a new kanban card on the default board."""

    name: str = "create_card"
    description: str = (
        "Create a new kanban card on the default board. "
        "Content must start with a # heading that becomes the card title."
    )
    args_schema: Type[BaseModel] = CreateCardInput
    client: KanbanLiteClient

    def _run(
        self,
        content: str,
        status: str | None = None,
        priority: str | None = None,
        assignee: str | None = None,
        labels: str | None = None,
        due_date: str | None = None,
    ) -> str:
        card = self.client.create_card(
            content=content,
            status=status,
            priority=priority,
            assignee=assignee,
            labels=_parse_labels(labels),
            due_date=due_date,
        )
        return _format(card)


class UpdateCardTool(BaseTool):
    """Update fields on an existing kanban card."""

    name: str = "update_card"
    description: str = (
        "Update fields on an existing kanban card. "
        "Only supplied fields are changed; omitted fields are left unchanged."
    )
    args_schema: Type[BaseModel] = UpdateCardInput
    client: KanbanLiteClient

    def _run(
        self,
        card_id: str,
        content: str | None = None,
        priority: str | None = None,
        assignee: str | None = None,
        labels: str | None = None,
        due_date: str | None = None,
    ) -> str:
        fields: dict[str, Any] = {}
        if content is not None:
            fields["content"] = content
        if priority is not None:
            fields["priority"] = priority
        if assignee is not None:
            fields["assignee"] = assignee
        if labels is not None:
            fields["labels"] = _parse_labels(labels)
        if due_date is not None:
            fields["dueDate"] = due_date
        card = self.client.update_card(card_id, **fields)
        return _format(card)


class MoveCardTool(BaseTool):
    """Move a kanban card to a different status column."""

    name: str = "move_card"
    description: str = "Move a kanban card to a different status column."
    args_schema: Type[BaseModel] = MoveCardInput
    client: KanbanLiteClient

    def _run(
        self,
        card_id: str,
        target_column: str,
        position: int | None = None,
    ) -> str:
        result = self.client.move_card(card_id, target_column, position=position)
        return f"Card {card_id} moved to {target_column}"


class DeleteCardTool(BaseTool):
    """Soft-delete a kanban card."""

    name: str = "delete_card"
    description: str = "Soft-delete a kanban card by its ID."
    args_schema: Type[BaseModel] = DeleteCardInput
    client: KanbanLiteClient

    def _run(self, card_id: str) -> str:
        self.client.delete_card(card_id)
        return f"Card {card_id} deleted"


class ListColumnsTool(BaseTool):
    """List all columns on the default board."""

    name: str = "list_columns"
    description: str = "List all columns (status lanes) on the default kanban board."
    args_schema: Type[BaseModel] = ListColumnsInput
    client: KanbanLiteClient

    def _run(self) -> str:
        columns = self.client.list_columns()
        return _format(columns)


class GetCommentsTool(BaseTool):
    """Retrieve all comments for a kanban card."""

    name: str = "get_comments"
    description: str = "Retrieve all comments for a kanban card by its ID."
    args_schema: Type[BaseModel] = GetCommentsInput
    client: KanbanLiteClient

    def _run(self, card_id: str) -> str:
        comments = self.client.get_comments(card_id)
        return _format(comments)


class AddCommentTool(BaseTool):
    """Add a comment to a kanban card."""

    name: str = "add_comment"
    description: str = "Add a comment to a kanban card."
    args_schema: Type[BaseModel] = AddCommentInput
    client: KanbanLiteClient

    def _run(
        self,
        card_id: str,
        content: str,
        author: str | None = None,
    ) -> str:
        comment = self.client.add_comment(
            card_id, content, author=author or "crewai-agent"
        )
        return _format(comment)
