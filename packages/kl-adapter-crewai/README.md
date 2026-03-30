# kl-adapter-crewai

CrewAI tool adapters for the [kanban-lite](https://github.com/borgius/kanban-lite) REST API.

Wrap kanban-lite board operations as CrewAI `BaseTool` subclasses so that specialized agents (PM, Dev, QA) can each manage their own board lane.

## Installation

```bash
pip install kl-adapter-crewai
```

## Prerequisites

A running kanban-lite standalone server:

```bash
npm install -g kanban-lite
kl init
kl serve            # default: http://localhost:3000
```

## Quick Start

```python
from crewai import Agent, Task, Crew
from kl_adapter_crewai import KanbanLiteClient, KanbanLiteToolkit

# Connect to the running kanban-lite server
client = KanbanLiteClient("http://localhost:3000")
toolkit = KanbanLiteToolkit(client=client)

# Give all tools to an agent
pm_agent = Agent(
    role="Project Manager",
    goal="Keep the board organized and tasks moving forward",
    backstory="You are a seasoned PM who manages a kanban board.",
    tools=toolkit.get_tools(),
)

# Or use read-only tools for reporting agents
reporter = Agent(
    role="Reporter",
    goal="Generate status reports from the board",
    backstory="You analyze board state and produce summaries.",
    tools=toolkit.get_tools(read_only=True),
)
```

### Using Individual Tools

```python
from kl_adapter_crewai import KanbanLiteClient, MoveCardTool, ListCardsTool

client = KanbanLiteClient("http://localhost:3000")

move_tool = MoveCardTool(client=client)
list_tool = ListCardsTool(client=client)

# Use directly
result = move_tool.run(card_id="abc123", target_column="in-progress")
```

## Available Tools

| Tool | Name | Description |
|------|------|-------------|
| `ListCardsTool` | `list_cards` | List cards with optional filters (status, priority, assignee, label) |
| `GetCardTool` | `get_card` | Get full details of a single card by ID |
| `CreateCardTool` | `create_card` | Create a new card (content must start with `# heading`) |
| `UpdateCardTool` | `update_card` | Partial-update card fields |
| `MoveCardTool` | `move_card` | Move a card to a different status column |
| `DeleteCardTool` | `delete_card` | Soft-delete a card |
| `ListColumnsTool` | `list_columns` | List all board columns |
| `GetCommentsTool` | `get_comments` | Get all comments on a card |
| `AddCommentTool` | `add_comment` | Add a comment to a card |

## Configuration

### Server URL

```python
# Explicit
client = KanbanLiteClient("http://localhost:3000")

# Or via environment variable
# export KANBAN_LITE_URL=http://localhost:3000
client = KanbanLiteClient()
```

### Authentication

If the kanban-lite server has auth enabled (via `kl-plugin-auth`):

```python
client = KanbanLiteClient(
    base_url="http://localhost:3000",
    api_token="your-bearer-token",
)

# Or via environment variable
# export KANBAN_LITE_TOKEN=your-bearer-token
client = KanbanLiteClient()
```

## Multi-Agent Example

Specialized agents each managing their own board lane:

```python
from crewai import Agent, Task, Crew
from kl_adapter_crewai import KanbanLiteClient, KanbanLiteToolkit

client = KanbanLiteClient("http://localhost:3000")
toolkit = KanbanLiteToolkit(client=client)

# PM triages incoming work
pm = Agent(
    role="Project Manager",
    goal="Triage new cards and assign priorities",
    backstory="You review backlog cards and move them to 'todo' when ready.",
    tools=toolkit.get_tools(),
)

# Dev works on assigned tasks
dev = Agent(
    role="Developer",
    goal="Pick up todo cards, work on them, and move to review",
    backstory="You implement features and fix bugs from the board.",
    tools=toolkit.get_tools(),
)

# QA reviews completed work
qa = Agent(
    role="QA Engineer",
    goal="Review cards in the review column and move to done",
    backstory="You verify that completed work meets quality standards.",
    tools=toolkit.get_tools(),
)

triage_task = Task(
    description="Review all backlog cards and prioritize them.",
    expected_output="Summary of prioritized cards.",
    agent=pm,
)

crew = Crew(agents=[pm, dev, qa], tasks=[triage_task])
crew.kickoff()
```

## Development

```bash
cd packages/kl-adapter-crewai
pip install -e ".[dev]"
pytest
```

## License

MIT
