/**
 * kanban.ts — Mastra tools that wrap the kanban-lite REST API.
 *
 * Read tools (listCards, getCard) execute immediately without approval.
 * Write tools (createCard, updateCard, moveCard) are gated by the Coordinator
 * agent instructions: the agent MUST present a PROPOSED ACTION block and
 * receive an explicit "approve" before calling any write tool.
 *
 * Integration seam: kanban-lite REST API (documented at /docs/api.md).
 *   Base URL is read from KANBAN_API_URL (default: http://localhost:3001/api).
 *   Start the server with: npx kanban-lite serve --port 3001
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared fetch helper
// ---------------------------------------------------------------------------

interface KanbanResponse<T = unknown> {
  ok: boolean;
  data: T;
  error?: string;
}

async function kanbanFetch<T = unknown>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const base =
    process.env.KANBAN_API_URL?.replace(/\/$/, "") ??
    "http://localhost:3001/api";
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const json = (await res.json()) as KanbanResponse<T>;
  if (!json.ok) {
    throw new Error(
      json.error ?? `kanban-lite API error ${res.status} on ${path}`
    );
  }
  return json.data;
}

// ---------------------------------------------------------------------------
// Read tools — no approval required
// ---------------------------------------------------------------------------

export const listCardsTool = createTool({
  id: "list-cards",
  description:
    "List kanban cards on the default board. Optionally filter by status column. " +
    "Read-only — no approval required.",
  inputSchema: z.object({
    status: z
      .string()
      .optional()
      .describe(
        "Filter by status column, e.g. backlog | todo | in-progress | review | done"
      ),
    priority: z
      .enum(["critical", "high", "medium", "low"])
      .optional()
      .describe("Filter by priority level"),
    assignee: z.string().optional().describe("Filter by assignee name"),
  }),
  execute: async (inputData) => {
    const params = new URLSearchParams();
    if (inputData.status) params.set("status", inputData.status);
    if (inputData.priority) params.set("priority", inputData.priority);
    if (inputData.assignee) params.set("assignee", inputData.assignee);
    const qs = params.toString() ? `?${params.toString()}` : "";
    return kanbanFetch(`/tasks${qs}`);
  },
});

export const getCardTool = createTool({
  id: "get-card",
  description:
    "Retrieve full details of a single kanban card by its ID. " +
    "Read-only — no approval required.",
  inputSchema: z.object({
    cardId: z.string().describe("Card ID or partial card ID"),
  }),
  execute: async (inputData) => {
    return kanbanFetch(`/tasks/${encodeURIComponent(inputData.cardId)}`);
  },
});

// ---------------------------------------------------------------------------
// Write tools — REQUIRE EXPLICIT USER APPROVAL (enforced by agent instructions)
// ---------------------------------------------------------------------------

/**
 * Create a new kanban card.
 *
 * The API derives the title from the first Markdown `# heading` in `content`.
 * Example content: "# Fix login regression\n\nUsers cannot log in on Safari."
 */
export const createCardTool = createTool({
  id: "create-card",
  description:
    "Create a new kanban card on the default board. " +
    "REQUIRES USER APPROVAL — only call this tool after presenting the full " +
    "proposal in a PROPOSED ACTION block and receiving explicit 'approve'.",
  inputSchema: z.object({
    content: z
      .string()
      .describe(
        "Markdown content for the card. " +
          "Must start with a # heading that becomes the card title, " +
          "e.g. '# Fix login regression\\n\\nDetails here.'"
      ),
    status: z
      .string()
      .optional()
      .describe("Initial status column (defaults to board default: backlog)"),
    priority: z
      .enum(["critical", "high", "medium", "low"])
      .optional()
      .describe("Priority level (default: medium)"),
    assignee: z.string().optional().describe("Assigned team member"),
    labels: z.array(z.string()).optional().describe("Label names"),
    dueDate: z
      .string()
      .optional()
      .describe("Due date in ISO 8601 format, e.g. 2026-04-01"),
  }),
  execute: async (inputData) => {
    return kanbanFetch("/tasks", {
      method: "POST",
      body: JSON.stringify(inputData),
    });
  },
});

export const updateCardTool = createTool({
  id: "update-card",
  description:
    "Update fields on an existing kanban card. Only supplied fields change. " +
    "REQUIRES USER APPROVAL — only call this tool after presenting the full " +
    "proposal in a PROPOSED ACTION block and receiving explicit 'approve'.",
  inputSchema: z.object({
    cardId: z.string().describe("Card ID or partial card ID"),
    content: z
      .string()
      .optional()
      .describe("Updated Markdown content (preserves # heading as title)"),
    priority: z.enum(["critical", "high", "medium", "low"]).optional(),
    assignee: z.string().optional(),
    labels: z.array(z.string()).optional(),
    dueDate: z.string().optional().describe("ISO 8601 date string"),
  }),
  execute: async (inputData) => {
    const { cardId, ...fields } = inputData;
    return kanbanFetch(`/tasks/${encodeURIComponent(cardId)}`, {
      method: "PUT",
      body: JSON.stringify(fields),
    });
  },
});

export const moveCardTool = createTool({
  id: "move-card",
  description:
    "Move a kanban card to a different status column. " +
    "REQUIRES USER APPROVAL — only call this tool after presenting the full " +
    "proposal in a PROPOSED ACTION block and receiving explicit 'approve'.",
  inputSchema: z.object({
    cardId: z.string().describe("Card ID or partial card ID"),
    status: z
      .string()
      .describe("Target status column, e.g. todo | in-progress | review | done"),
    position: z
      .number()
      .int()
      .optional()
      .describe("Zero-based position within the target column (default: 0)"),
  }),
  execute: async (inputData) => {
    const { cardId, ...body } = inputData;
    return kanbanFetch(`/tasks/${encodeURIComponent(cardId)}/move`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },
});
