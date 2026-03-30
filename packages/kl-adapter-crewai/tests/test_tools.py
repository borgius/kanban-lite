"""Unit tests for kl-adapter-crewai.

Uses the ``responses`` library to mock HTTP calls to the kanban-lite REST API
so tests run without a live server.
"""

from __future__ import annotations

import json

import pytest
import responses

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

BASE = "http://localhost:3000"


# ------------------------------------------------------------------ #
# Client tests                                                         #
# ------------------------------------------------------------------ #


class TestKanbanLiteClient:
    def setup_method(self) -> None:
        self.client = KanbanLiteClient(base_url=BASE)

    @responses.activate
    def test_list_cards(self) -> None:
        cards = [{"id": "abc", "title": "Task 1", "status": "backlog"}]
        responses.add(
            responses.GET,
            f"{BASE}/api/tasks",
            json={"ok": True, "data": cards},
            status=200,
        )
        result = self.client.list_cards()
        assert result == cards

    @responses.activate
    def test_list_cards_with_filters(self) -> None:
        responses.add(
            responses.GET,
            f"{BASE}/api/tasks",
            json={"ok": True, "data": []},
            status=200,
        )
        self.client.list_cards(status="done", priority="high", assignee="alice")
        assert "status=done" in responses.calls[0].request.url
        assert "priority=high" in responses.calls[0].request.url
        assert "assignee=alice" in responses.calls[0].request.url

    @responses.activate
    def test_get_card(self) -> None:
        card = {"id": "abc123", "title": "Task 1"}
        responses.add(
            responses.GET,
            f"{BASE}/api/tasks/abc",
            json={"ok": True, "data": card},
            status=200,
        )
        result = self.client.get_card("abc")
        assert result == card

    @responses.activate
    def test_create_card(self) -> None:
        card = {"id": "new1", "title": "New Card"}
        responses.add(
            responses.POST,
            f"{BASE}/api/tasks",
            json={"ok": True, "data": card},
            status=200,
        )
        result = self.client.create_card("# New Card\n\nDescription")
        assert result == card
        body = json.loads(responses.calls[0].request.body)
        assert body["content"] == "# New Card\n\nDescription"

    @responses.activate
    def test_update_card(self) -> None:
        card = {"id": "abc", "title": "Task 1", "priority": "high"}
        responses.add(
            responses.PUT,
            f"{BASE}/api/tasks/abc",
            json={"ok": True, "data": card},
            status=200,
        )
        result = self.client.update_card("abc", priority="high")
        assert result == card
        body = json.loads(responses.calls[0].request.body)
        assert body["priority"] == "high"

    @responses.activate
    def test_move_card(self) -> None:
        responses.add(
            responses.PATCH,
            f"{BASE}/api/tasks/abc/move",
            json={"ok": True, "data": None},
            status=200,
        )
        self.client.move_card("abc", "done", position=0)
        body = json.loads(responses.calls[0].request.body)
        assert body["status"] == "done"
        assert body["position"] == 0

    @responses.activate
    def test_delete_card(self) -> None:
        responses.add(
            responses.DELETE,
            f"{BASE}/api/tasks/abc",
            json={"ok": True, "data": None},
            status=200,
        )
        self.client.delete_card("abc")
        assert len(responses.calls) == 1

    @responses.activate
    def test_list_columns(self) -> None:
        cols = [{"name": "backlog"}, {"name": "done"}]
        responses.add(
            responses.GET,
            f"{BASE}/api/columns",
            json={"ok": True, "data": cols},
            status=200,
        )
        result = self.client.list_columns()
        assert result == cols

    @responses.activate
    def test_get_comments(self) -> None:
        comments = [{"id": "c1", "content": "hello"}]
        responses.add(
            responses.GET,
            f"{BASE}/api/tasks/abc/comments",
            json={"ok": True, "data": comments},
            status=200,
        )
        result = self.client.get_comments("abc")
        assert result == comments

    @responses.activate
    def test_add_comment(self) -> None:
        comment = {"id": "c2", "content": "new comment"}
        responses.add(
            responses.POST,
            f"{BASE}/api/tasks/abc/comments",
            json={"ok": True, "data": comment},
            status=200,
        )
        result = self.client.add_comment("abc", "new comment")
        assert result == comment

    @responses.activate
    def test_api_error(self) -> None:
        responses.add(
            responses.GET,
            f"{BASE}/api/tasks",
            json={"ok": False, "error": "something went wrong"},
            status=200,
        )
        with pytest.raises(KanbanLiteError, match="something went wrong"):
            self.client.list_cards()

    def test_auth_header(self) -> None:
        client = KanbanLiteClient(base_url=BASE, api_token="secret-token")
        headers = client._headers()
        assert headers["Authorization"] == "Bearer secret-token"

    def test_no_auth_header(self) -> None:
        client = KanbanLiteClient(base_url=BASE)
        headers = client._headers()
        assert "Authorization" not in headers


# ------------------------------------------------------------------ #
# Tool tests                                                           #
# ------------------------------------------------------------------ #


class TestTools:
    def setup_method(self) -> None:
        self.client = KanbanLiteClient(base_url=BASE)

    @responses.activate
    def test_list_cards_tool(self) -> None:
        responses.add(
            responses.GET,
            f"{BASE}/api/tasks",
            json={"ok": True, "data": [{"id": "1"}]},
            status=200,
        )
        tool = ListCardsTool(client=self.client)
        result = tool._run()
        assert '"id": "1"' in result

    @responses.activate
    def test_get_card_tool(self) -> None:
        responses.add(
            responses.GET,
            f"{BASE}/api/tasks/abc",
            json={"ok": True, "data": {"id": "abc", "title": "T"}},
            status=200,
        )
        tool = GetCardTool(client=self.client)
        result = tool._run(card_id="abc")
        assert '"title": "T"' in result

    @responses.activate
    def test_create_card_tool(self) -> None:
        responses.add(
            responses.POST,
            f"{BASE}/api/tasks",
            json={"ok": True, "data": {"id": "new1"}},
            status=200,
        )
        tool = CreateCardTool(client=self.client)
        result = tool._run(content="# New\n\nbody")
        assert '"id": "new1"' in result

    @responses.activate
    def test_update_card_tool(self) -> None:
        responses.add(
            responses.PUT,
            f"{BASE}/api/tasks/abc",
            json={"ok": True, "data": {"id": "abc"}},
            status=200,
        )
        tool = UpdateCardTool(client=self.client)
        result = tool._run(card_id="abc", priority="high")
        assert '"id": "abc"' in result

    @responses.activate
    def test_move_card_tool(self) -> None:
        responses.add(
            responses.PATCH,
            f"{BASE}/api/tasks/abc/move",
            json={"ok": True, "data": None},
            status=200,
        )
        tool = MoveCardTool(client=self.client)
        result = tool._run(card_id="abc", target_column="done")
        assert "moved to done" in result

    @responses.activate
    def test_delete_card_tool(self) -> None:
        responses.add(
            responses.DELETE,
            f"{BASE}/api/tasks/abc",
            json={"ok": True, "data": None},
            status=200,
        )
        tool = DeleteCardTool(client=self.client)
        result = tool._run(card_id="abc")
        assert "deleted" in result

    @responses.activate
    def test_list_columns_tool(self) -> None:
        responses.add(
            responses.GET,
            f"{BASE}/api/columns",
            json={"ok": True, "data": [{"name": "todo"}]},
            status=200,
        )
        tool = ListColumnsTool(client=self.client)
        result = tool._run()
        assert '"name": "todo"' in result

    @responses.activate
    def test_get_comments_tool(self) -> None:
        responses.add(
            responses.GET,
            f"{BASE}/api/tasks/abc/comments",
            json={"ok": True, "data": [{"id": "c1"}]},
            status=200,
        )
        tool = GetCommentsTool(client=self.client)
        result = tool._run(card_id="abc")
        assert '"id": "c1"' in result

    @responses.activate
    def test_add_comment_tool(self) -> None:
        responses.add(
            responses.POST,
            f"{BASE}/api/tasks/abc/comments",
            json={"ok": True, "data": {"id": "c2"}},
            status=200,
        )
        tool = AddCommentTool(client=self.client)
        result = tool._run(card_id="abc", content="hello")
        assert '"id": "c2"' in result

    def test_tool_metadata(self) -> None:
        """All tools must have name, description, and args_schema."""
        tool_classes = [
            ListCardsTool,
            GetCardTool,
            CreateCardTool,
            UpdateCardTool,
            MoveCardTool,
            DeleteCardTool,
            ListColumnsTool,
            GetCommentsTool,
            AddCommentTool,
        ]
        for cls in tool_classes:
            tool = cls(client=self.client)
            assert tool.name, f"{cls.__name__} missing name"
            assert tool.description, f"{cls.__name__} missing description"
            assert tool.args_schema is not None, f"{cls.__name__} missing args_schema"


# ------------------------------------------------------------------ #
# Toolkit tests                                                        #
# ------------------------------------------------------------------ #


class TestToolkit:
    def setup_method(self) -> None:
        self.client = KanbanLiteClient(base_url=BASE)

    def test_get_all_tools(self) -> None:
        toolkit = KanbanLiteToolkit(client=self.client)
        tools = toolkit.get_tools()
        assert len(tools) == 9
        names = {t.name for t in tools}
        assert names == {
            "list_cards",
            "get_card",
            "create_card",
            "update_card",
            "move_card",
            "delete_card",
            "list_columns",
            "get_comments",
            "add_comment",
        }

    def test_read_only_tools(self) -> None:
        toolkit = KanbanLiteToolkit(client=self.client)
        tools = toolkit.get_tools(read_only=True)
        assert len(tools) == 4
        names = {t.name for t in tools}
        assert names == {"list_cards", "get_card", "list_columns", "get_comments"}
