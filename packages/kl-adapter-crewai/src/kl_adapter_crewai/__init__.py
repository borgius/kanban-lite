"""kl-adapter-crewai — CrewAI tool adapters for the kanban-lite REST API.

Wrap kanban-lite board operations as CrewAI ``BaseTool`` subclasses so that
specialized agents (PM, Dev, QA) can each manage their own board lane.

Quick start::

    from kl_adapter_crewai import KanbanLiteClient, KanbanLiteToolkit

    client = KanbanLiteClient("http://localhost:3000")
    toolkit = KanbanLiteToolkit(client=client)
    tools = toolkit.get_tools()   # list[BaseTool] ready for CrewAI Agent

Individual tools can also be imported directly::

    from kl_adapter_crewai import ListCardsTool, MoveCardTool
"""

from kl_adapter_crewai.client import KanbanLiteClient, KanbanLiteError
from kl_adapter_crewai.toolkit import KanbanLiteToolkit
from kl_adapter_crewai.tools import (
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
