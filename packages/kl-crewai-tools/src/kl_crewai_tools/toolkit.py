"""Convenience toolkit that bundles all kanban-lite CrewAI tools.

Usage::

    from crewai import Agent
    from kl_crewai_tools import KanbanLiteClient, KanbanLiteToolkit

    client = KanbanLiteClient("http://localhost:3000")
    toolkit = KanbanLiteToolkit(client=client)

    pm_agent = Agent(
        role="Project Manager",
        tools=toolkit.get_tools(),
        ...
    )

    # Or pick only read tools for a reporting agent:
    read_tools = toolkit.get_tools(read_only=True)
"""

from __future__ import annotations

from crewai.tools import BaseTool

from kl_crewai_tools.client import KanbanLiteClient
from kl_crewai_tools.tools import (
    AddCommentTool,
    CreateCardTool,
    DeleteCardTool,
    GetCardTool,
    GetCommentsTool,
    ListCardsTool,
    ListColumnsTool,
    MoveCardTool,
    UpdateCardTool,
)


class KanbanLiteToolkit:
    """Bundle of all kanban-lite CrewAI tools sharing a single API client.

    Parameters
    ----------
    client:
        A :class:`KanbanLiteClient` instance pointing at the running
        kanban-lite server.
    """

    def __init__(self, client: KanbanLiteClient) -> None:
        self.client = client

    def get_tools(self, *, read_only: bool = False) -> list[BaseTool]:
        """Return a list of CrewAI tool instances.

        Parameters
        ----------
        read_only:
            When ``True`` only non-mutating tools are returned
            (list cards, get card, list columns, get comments).
        """
        read_tools: list[BaseTool] = [
            ListCardsTool(client=self.client),
            GetCardTool(client=self.client),
            ListColumnsTool(client=self.client),
            GetCommentsTool(client=self.client),
        ]
        if read_only:
            return read_tools

        write_tools: list[BaseTool] = [
            CreateCardTool(client=self.client),
            UpdateCardTool(client=self.client),
            MoveCardTool(client=self.client),
            DeleteCardTool(client=self.client),
            AddCommentTool(client=self.client),
        ]
        return read_tools + write_tools
