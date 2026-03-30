// ---------------------------------------------------------------------------
// Vercel AI SDK tool definitions for kanban-lite.
//
// Exports a factory function that accepts a KanbanClient (or config) and
// returns a record of `tool()` definitions ready for use with `streamText()`
// or `generateText()` from the Vercel AI SDK.
// ---------------------------------------------------------------------------

import { tool } from 'ai'
import { z } from 'zod'
import { KanbanClient } from './client'
import type { KanbanClientConfig } from './types'

// ---------------------------------------------------------------------------
// Serialisation helpers (same as in the example route.ts)
// ---------------------------------------------------------------------------

function serializeActions(actions: string[] | Record<string, string> | undefined) {
  if (!actions) return []
  if (Array.isArray(actions)) {
    return actions.map((key) => ({ key, title: key }))
  }
  return Object.entries(actions).map(([key, title]) => ({ key, title }))
}

function serializeForms(forms: { name?: string; schema?: Record<string, unknown> }[] | undefined) {
  return (forms ?? []).map((form, index) => ({
    id: form.name ?? String(form.schema?.title ?? `form-${index + 1}`),
    name: form.name ?? String(form.schema?.title ?? `Form ${index + 1}`),
  }))
}

// ---------------------------------------------------------------------------
// Tool set configuration
// ---------------------------------------------------------------------------

/** Options for customising the generated tool set. */
export interface KanbanToolsOptions {
  /**
   * Maximum number of cards returned by the `list_cards` tool.
   * @default 50
   */
  listLimit?: number
  /**
   * Maximum number of recent comments included in the `get_card` tool result.
   * @default 20
   */
  commentLimit?: number
  /**
   * Default author name used when the LLM does not provide one.
   * @default 'kanban-chat-agent'
   */
  defaultAuthor?: string
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a complete set of Vercel AI SDK tool definitions for kanban-lite.
 *
 * The returned object can be spread directly into the `tools` option of
 * `streamText()` or `generateText()`.
 *
 * @example
 * ```ts
 * import { streamText } from 'ai'
 * import { openai } from '@ai-sdk/openai'
 * import { createKanbanTools } from 'kl-adapter-vercel-ai'
 *
 * const tools = createKanbanTools({
 *   baseUrl: 'http://localhost:3000',
 *   boardId: 'default',
 * })
 *
 * const result = streamText({
 *   model: openai('gpt-4o-mini'),
 *   tools,
 *   messages,
 * })
 * ```
 */
export function createKanbanTools(
  clientOrConfig: KanbanClient | KanbanClientConfig = {},
  options: KanbanToolsOptions = {},
) {
  const client =
    clientOrConfig instanceof KanbanClient
      ? clientOrConfig
      : new KanbanClient(clientOrConfig)

  const listLimit = options.listLimit ?? 50
  const commentLimit = options.commentLimit ?? 20
  const defaultAuthor = options.defaultAuthor ?? 'kanban-chat-agent'

  return {
    // -------------------------------------------------------------------
    // Cards
    // -------------------------------------------------------------------

    create_card: tool({
      description:
        'Create a new kanban card. Use when the user asks to add, log, or create a task.',
      parameters: z.object({
        title: z.string().describe('Short, clear card title'),
        description: z
          .string()
          .optional()
          .describe('Optional detailed description of the card'),
        assignee: z.string().optional().describe('Optional assignee name'),
        priority: z
          .enum(['critical', 'high', 'medium', 'low'])
          .default('medium')
          .describe('Card priority level'),
        status: z
          .string()
          .optional()
          .describe('Initial column, e.g. "backlog", "in-progress". Defaults to the board default.'),
        labels: z
          .array(z.string())
          .optional()
          .describe('Optional labels to assign to the card'),
        actionKeys: z
          .array(z.string())
          .optional()
          .describe('Optional card action keys such as deploy, rollback, notify-slack'),
        formTemplates: z
          .array(z.string())
          .optional()
          .describe('Optional reusable form ids to attach to the card'),
      }),
      execute: async ({ title, description, assignee, priority, status, labels, actionKeys, formTemplates }) => {
        try {
          const card = await client.createCard(title, description, priority, {
            ...(assignee ? { assignee } : {}),
            ...(status ? { status } : {}),
            ...(labels?.length ? { labels } : {}),
            ...(actionKeys?.length ? { actions: actionKeys } : {}),
            ...(formTemplates?.length
              ? { forms: formTemplates.map((name) => ({ name })) }
              : {}),
          })
          return {
            ok: true as const,
            card: {
              id: card.id,
              title: card.title,
              status: card.status,
              priority: card.priority,
              labels: card.labels ?? [],
              actions: serializeActions(card.actions),
              forms: serializeForms(card.forms),
            },
          }
        } catch (err) {
          return { ok: false as const, error: String(err) }
        }
      },
    }),

    list_cards: tool({
      description:
        'List cards from the kanban board. Optionally filter by status column.',
      parameters: z.object({
        status: z
          .string()
          .optional()
          .describe(
            'Column to filter by, e.g. "backlog", "in-progress", "done". Omit to list all cards.',
          ),
      }),
      execute: async ({ status }) => {
        try {
          const cards = await client.listCards(status)
          return {
            ok: true as const,
            count: cards.length,
            cards: cards.slice(0, listLimit).map((card) => ({
              id: card.id,
              title: card.title,
              status: card.status,
              priority: card.priority,
              assignee: card.assignee ?? null,
              labels: card.labels ?? [],
              actions: serializeActions(card.actions),
              forms: serializeForms(card.forms),
              commentCount: card.comments?.length ?? 0,
            })),
          }
        } catch (err) {
          return { ok: false as const, error: String(err) }
        }
      },
    }),

    get_card: tool({
      description:
        'Inspect a specific card to see its details, comments, attached forms, actions, and labels.',
      parameters: z.object({
        cardId: z.string().describe('Card ID or partial ID to inspect'),
      }),
      execute: async ({ cardId }) => {
        try {
          const card = await client.getCard(cardId)
          return {
            ok: true as const,
            card: {
              id: card.id,
              title: card.title,
              status: card.status,
              priority: card.priority,
              assignee: card.assignee ?? null,
              dueDate: card.dueDate ?? null,
              labels: card.labels ?? [],
              metadata: card.metadata ?? {},
              actions: serializeActions(card.actions),
              forms: serializeForms(card.forms),
              formData: card.formData ?? {},
              comments: (card.comments ?? []).slice(-commentLimit),
              body: card.body ?? '',
            },
          }
        } catch (err) {
          return { ok: false as const, error: String(err) }
        }
      },
    }),

    update_card: tool({
      description:
        'Update an existing card. Only provided fields are changed.',
      parameters: z.object({
        cardId: z.string().describe('Card ID or partial ID'),
        priority: z
          .enum(['critical', 'high', 'medium', 'low'])
          .optional()
          .describe('New priority level'),
        assignee: z.string().optional().describe('New assignee name'),
        labels: z
          .array(z.string())
          .optional()
          .describe('Replace card labels'),
        dueDate: z.string().optional().describe('New due date (ISO 8601)'),
      }),
      execute: async ({ cardId, priority, assignee, labels, dueDate }) => {
        try {
          const updates: Record<string, unknown> = {}
          if (priority !== undefined) updates.priority = priority
          if (assignee !== undefined) updates.assignee = assignee
          if (labels !== undefined) updates.labels = labels
          if (dueDate !== undefined) updates.dueDate = dueDate
          const card = await client.updateCard(cardId, updates)
          return {
            ok: true as const,
            card: {
              id: card.id,
              title: card.title,
              status: card.status,
              priority: card.priority,
              assignee: card.assignee ?? null,
              labels: card.labels ?? [],
            },
          }
        } catch (err) {
          return { ok: false as const, error: String(err) }
        }
      },
    }),

    move_card: tool({
      description:
        'Move an existing card to a different status column. Partial card ID is supported.',
      parameters: z.object({
        cardId: z.string().describe('Card ID or partial ID'),
        status: z
          .string()
          .describe('Target column name, e.g. "in-progress", "review", "done"'),
      }),
      execute: async ({ cardId, status }) => {
        try {
          const card = await client.moveCard(cardId, status)
          return {
            ok: true as const,
            card: { id: card.id, title: card.title, status: card.status },
          }
        } catch (err) {
          return { ok: false as const, error: String(err) }
        }
      },
    }),

    delete_card: tool({
      description: 'Delete (soft-delete) a card from the board.',
      parameters: z.object({
        cardId: z.string().describe('Card ID or partial ID to delete'),
      }),
      execute: async ({ cardId }) => {
        try {
          await client.deleteCard(cardId)
          return { ok: true as const, cardId }
        } catch (err) {
          return { ok: false as const, error: String(err) }
        }
      },
    }),

    // -------------------------------------------------------------------
    // Comments
    // -------------------------------------------------------------------

    add_comment: tool({
      description:
        'Add a markdown comment to a card. Use for freeform notes, updates, or requests tied to a specific card.',
      parameters: z.object({
        cardId: z.string().describe('Card ID or partial ID'),
        content: z.string().describe('Markdown comment body'),
        author: z
          .string()
          .optional()
          .default(defaultAuthor)
          .describe('Display name for the comment author'),
      }),
      execute: async ({ cardId, content, author }) => {
        try {
          const comment = await client.addComment(cardId, author, content)
          return { ok: true as const, comment }
        } catch (err) {
          return { ok: false as const, error: String(err) }
        }
      },
    }),

    stream_comment: tool({
      description:
        'Stream a comment to a card so connected viewers see it arrive incrementally. Use this instead of add_comment when the text is long or the comment should appear in real-time.',
      parameters: z.object({
        cardId: z.string().describe('Card ID or partial ID'),
        content: z.string().describe('Full comment text to stream (supports markdown)'),
        author: z
          .string()
          .optional()
          .default(defaultAuthor)
          .describe('Display name for the comment author'),
      }),
      execute: async ({ cardId, content, author }) => {
        try {
          const comment = await client.streamComment(cardId, author, content)
          return { ok: true as const, comment }
        } catch (err) {
          return { ok: false as const, error: String(err) }
        }
      },
    }),

    list_comments: tool({
      description: 'List all comments on a card.',
      parameters: z.object({
        cardId: z.string().describe('Card ID or partial ID'),
      }),
      execute: async ({ cardId }) => {
        try {
          const comments = await client.listComments(cardId)
          return { ok: true as const, count: comments.length, comments }
        } catch (err) {
          return { ok: false as const, error: String(err) }
        }
      },
    }),

    // -------------------------------------------------------------------
    // Forms
    // -------------------------------------------------------------------

    submit_card_form: tool({
      description:
        'Submit structured data to a form attached to a card. Include form field values in the data object.',
      parameters: z.object({
        cardId: z.string().describe('Card ID or partial ID'),
        formId: z
          .string()
          .describe('Attached form id, e.g. incident-report or release-checklist'),
        data: z
          .record(z.string(), z.any())
          .describe('Submitted form field values as an object'),
      }),
      execute: async ({ cardId, formId, data }) => {
        try {
          const result = await client.submitCardForm(cardId, formId, data)
          return {
            ok: true as const,
            boardId: result.boardId,
            form: { id: result.form.id, label: result.form.label },
            data: result.data,
            card: {
              id: result.card.id,
              title: result.card.title,
              status: result.card.status,
            },
          }
        } catch (err) {
          return { ok: false as const, error: String(err) }
        }
      },
    }),

    // -------------------------------------------------------------------
    // Actions
    // -------------------------------------------------------------------

    trigger_card_action: tool({
      description:
        "Trigger one of a card's named actions (e.g. deploy, rollback, notify-slack).",
      parameters: z.object({
        cardId: z.string().describe('Card ID or partial ID'),
        action: z.string().describe('Action key to trigger'),
      }),
      execute: async ({ cardId, action }) => {
        try {
          await client.triggerCardAction(cardId, action)
          const card = await client.getCard(cardId)
          return {
            ok: true as const,
            action,
            card: {
              id: card.id,
              title: card.title,
              status: card.status,
              priority: card.priority,
              commentCount: card.comments?.length ?? 0,
              actions: serializeActions(card.actions),
              forms: serializeForms(card.forms),
            },
          }
        } catch (err) {
          return { ok: false as const, error: String(err) }
        }
      },
    }),

    // -------------------------------------------------------------------
    // Board info
    // -------------------------------------------------------------------

    get_board: tool({
      description:
        'Get board configuration including columns, actions, and metadata fields.',
      parameters: z.object({
        boardId: z
          .string()
          .optional()
          .describe('Board ID. Defaults to the configured board.'),
      }),
      execute: async ({ boardId }) => {
        try {
          const board = await client.getBoard(boardId)
          return { ok: true as const, board }
        } catch (err) {
          return { ok: false as const, error: String(err) }
        }
      },
    }),

    list_columns: tool({
      description:
        'List the status columns configured on the board.',
      parameters: z.object({
        boardId: z
          .string()
          .optional()
          .describe('Board ID. Defaults to the configured board.'),
      }),
      execute: async ({ boardId }) => {
        try {
          const columns = await client.listColumns(boardId)
          return { ok: true as const, columns }
        } catch (err) {
          return { ok: false as const, error: String(err) }
        }
      },
    }),
  }
}
