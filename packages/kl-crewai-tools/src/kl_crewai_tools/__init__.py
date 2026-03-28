"""kl-crewai-tools — CrewAI tool adapters for the kanban-lite REST API.

Wrap kanban-lite board operations as CrewAI ``BaseTool`` subclasses so that
specialized agents (PM, Dev, QA) can each manage their own board lane.

Quick start::

    from kl_crewai_tools import KanbanLiteClient, KanbanLiteToolkit

    client = KanbanLiteClient("http://localhost:3000")
    toolkit = KanbanLiteToolkit(client=client)
    tools = toolkit.get_tools()   # list[BaseTool] ready for CrewAI Agent

Individual tools can also be imported directly::

    from kl_crewai_tools import ListCardsTool, MoveCardTool
"""

from kl_crewai_tools.client import KanbanLiteClient, KanbanLiteError
from kl_crewai_tools.toolkit import KanbanLiteToolkit
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

__all__ = [
    "KanbanLiteClient",
    "KanbanLiteError",
    "KanbanLiteToolkit",
    "AddCommentTool",
    "CreateCardTool",
    "DeleteCardTool",
    "GetCardTool",
    "GetCommentsTool",
    "ListCardsTool",
    "ListColumnsTool",
    "MoveCardTool",
    "UpdateCardTool",
]
