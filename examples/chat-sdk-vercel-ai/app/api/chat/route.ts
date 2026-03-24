/**
 * app/api/chat/route.ts — streaming chat route
 *
 * Handles POST /api/chat from the useChat client hook.
 * Uses Vercel AI SDK streamText with server-side tools that call kanban-lite
 * via lib/kanban.ts (HTTP to the standalone server, or in-memory mock).
 *
 * Swap the model by replacing:
 *   import { openai } from '@ai-sdk/openai' → import { anthropic } from '@ai-sdk/anthropic'
 *   model: openai('gpt-4o-mini')            → model: anthropic('claude-3-haiku-20240307')
 */
import { openai } from '@ai-sdk/openai';
import { convertToCoreMessages, streamText, tool } from 'ai';
import { z } from 'zod';
import { getDeterministicFollowUpTitle } from '@/lib/action-webhook';
import {
  addComment,
  createCard,
  getCard,
  listCards,
  moveCard,
  submitCardForm,
  triggerCardAction,
} from '@/lib/kanban';

// Use Node.js runtime so fetch and env vars work without Edge limitations.
export const runtime = 'nodejs';
export const maxDuration = 60;

const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4.1-mini';
const FORM_TEMPLATE_IDS = ['incident-report', 'release-checklist'] as const;

function serializeActions(actions: string[] | Record<string, string> | undefined) {
  if (!actions) return [];
  if (Array.isArray(actions)) {
    return actions.map((key) => ({ key, title: key }));
  }

  return Object.entries(actions).map(([key, title]) => ({ key, title }));
}

function serializeForms(forms: { name?: string; schema?: Record<string, unknown> }[] | undefined) {
  return (forms ?? []).map((form, index) => ({
    id: form.name ?? String(form.schema?.title ?? `form-${index + 1}`),
    name: form.name ?? String(form.schema?.title ?? `Form ${index + 1}`),
  }));
}

const SYSTEM_PROMPT = `\
You are the IncidentMind operator copilot for CorePilot, connected to a dedicated local kanban-lite demo board.
IncidentMind is a fictional incident-operations layer built around free kanban-lite, and kanban-lite remains the system of record for board state, comments, forms, statuses, and action webhooks.
You help users manage incidents and release work using natural language and should actively use comments, attached forms, and card actions when a request is about a particular card.

You have several tools available:
- create_card         – add a new card to the board, optionally with actions/forms
- list_cards          – list cards, optionally filtered by status column
- get_card            – inspect a specific card with its comments, actions, and forms
- move_card           – move an existing card to a different column
- add_comment         – leave a note on a card
- submit_card_form    – submit structured data to an attached card form
- trigger_card_action – trigger one of a card's predefined actions

Standard columns: backlog, in-progress, review, done.
Reusable demo forms: incident-report, release-checklist.

Stable seeded cards include "Investigate billing alert spike" and "Deploy API v2.4.1".
Stable seeded action keys include notify-slack, escalate, deploy, and rollback.
Treat card actions as explicit operator-triggered automations routed through action webhooks, not autonomous incident resolution.
After triggering a card action, inspect the updated kanban-lite state returned by the tool result before summarizing what changed.

When the user asks you to create, inspect, comment on, update, or advance a card, you must call the appropriate tool before answering.
If the user refers to a card by title or vaguely describes it, list cards first and then inspect the best match before taking further action.
Prefer comments for freeform notes, forms for structured workflow data, and card actions for named automations.
Never claim a card was created, moved, or listed unless the tool result says ok: true.
Summaries should stay short, concrete, and factual.`;

export async function POST(req: Request) {
  const { messages } = await req.json();

  const tools = {
    create_card: tool({
      description:
        'Create a new kanban card. Use when the user asks to add, log, or create a card.',
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
        actionKeys: z
          .array(z.string())
          .optional()
          .describe('Optional card action keys such as deploy, rollback, notify-slack'),
        formTemplates: z
          .array(z.enum(FORM_TEMPLATE_IDS))
          .optional()
          .describe('Optional reusable form ids to attach to the card'),
      }),
      execute: async ({ title, description, assignee, priority, actionKeys, formTemplates }) => {
        try {
          const card = await createCard(title, description, priority, {
            ...(assignee ? { assignee } : {}),
            ...(actionKeys?.length ? { actions: actionKeys } : {}),
            ...(formTemplates?.length
              ? { forms: formTemplates.map((name) => ({ name })) }
              : {}),
          });

          return {
            ok: true,
            card: {
              id: card.id,
              title: card.title,
              status: card.status,
              priority: card.priority,
              actions: serializeActions(card.actions),
              forms: serializeForms(card.forms),
            },
          };
        } catch (err) {
          return { ok: false, error: String(err) };
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
          const cards = await listCards(status);
          return {
            ok: true,
            count: cards.length,
            cards: cards
              .slice(0, 20)
              .map((card) => ({
                id: card.id,
                title: card.title,
                status: card.status,
                priority: card.priority,
                actions: serializeActions(card.actions),
                forms: serializeForms(card.forms),
                commentCount: card.comments?.length ?? 0,
              })),
          };
        } catch (err) {
          return { ok: false, error: String(err) };
        }
      },
    }),

    get_card: tool({
      description:
        'Inspect a specific card to see its details, comments, attached forms, and actions.',
      parameters: z.object({
        cardId: z.string().describe('Card ID or partial ID to inspect'),
      }),
      execute: async ({ cardId }) => {
        try {
          const card = await getCard(cardId);
          return {
            ok: true,
            card: {
              id: card.id,
              title: card.title,
              status: card.status,
              priority: card.priority,
              assignee: card.assignee ?? null,
              labels: card.labels ?? [],
              actions: serializeActions(card.actions),
              forms: serializeForms(card.forms),
              formData: card.formData ?? {},
              comments: (card.comments ?? []).slice(-10),
              body: card.body ?? '',
            },
          };
        } catch (err) {
          return { ok: false, error: String(err) };
        }
      },
    }),

    move_card: tool({
      description:
        'Move an existing card to a different status column. Partial card ID is supported.',
      parameters: z.object({
        cardId: z.string().describe('Card ID or partial ID (e.g. "mock-1" or first 6 chars)'),
        status: z
          .string()
          .describe('Target column name, e.g. "in-progress", "review", "done"'),
      }),
      execute: async ({ cardId, status }) => {
        try {
          const card = await moveCard(cardId, status);
          return {
            ok: true,
            card: { id: card.id, title: card.title, status: card.status },
          };
        } catch (err) {
          return { ok: false, error: String(err) };
        }
      },
    }),

    add_comment: tool({
      description:
        'Add a markdown comment to a card. Use for freeform notes, updates, or requests tied to a specific card.',
      parameters: z.object({
        cardId: z.string().describe('Card ID or partial ID'),
        content: z.string().describe('Markdown comment body'),
        author: z
          .string()
          .optional()
          .default('kanban-chat-agent')
          .describe('Display name for the comment author'),
      }),
      execute: async ({ cardId, content, author }) => {
        try {
          const comment = await addComment(cardId, author, content);
          return { ok: true, comment };
        } catch (err) {
          return { ok: false, error: String(err) };
        }
      },
    }),

    submit_card_form: tool({
      description:
        'Submit structured data to a form attached to a card, such as incident-report or release-checklist. Always include form field values either under data or as explicit top-level fields.',
      parameters: z.object({
        cardId: z.string().describe('Card ID or partial ID'),
        formId: z.string().describe('Attached form id, e.g. incident-report or release-checklist'),
        data: z
          .record(z.string(), z.any())
          .optional()
          .describe('Submitted form field values as an object'),
        severity: z.string().optional().describe('Incident-report severity field'),
        owner: z.string().optional().describe('Owner field for incident-report or release-checklist'),
        service: z.string().optional().describe('Incident-report service field'),
        environment: z.string().optional().describe('Release-checklist environment field'),
        approved: z.boolean().optional().describe('Release-checklist approval field'),
      }),
      execute: async ({ cardId, formId, data, severity, owner, service, environment, approved }) => {
        try {
          const payload = {
            ...(data ?? {}),
            ...(severity !== undefined ? { severity } : {}),
            ...(owner !== undefined ? { owner } : {}),
            ...(service !== undefined ? { service } : {}),
            ...(environment !== undefined ? { environment } : {}),
            ...(approved !== undefined ? { approved } : {}),
          };

          const result = await submitCardForm(cardId, formId, payload);
          return {
            ok: true,
            boardId: result.boardId,
            form: { id: result.form.id, label: result.form.label },
            data: result.data,
            card: {
              id: result.card.id,
              title: result.card.title,
              status: result.card.status,
            },
          };
        } catch (err) {
          return { ok: false, error: String(err) };
        }
      },
    }),

    trigger_card_action: tool({
      description:
        'Trigger one of a card\'s named actions, then return the updated card state plus any deterministic follow-up card created by the webhook.',
      parameters: z.object({
        cardId: z.string().describe('Card ID or partial ID'),
        action: z.string().describe('Action key to trigger'),
      }),
      execute: async ({ cardId, action }) => {
        try {
          await triggerCardAction(cardId, action);
          const card = await getCard(cardId);
          const followUpTitle = getDeterministicFollowUpTitle(action, card.title);
          const followUpCard = followUpTitle
            ? (await listCards()).find((candidate) => candidate.title === followUpTitle) ?? null
            : null;

          return {
            ok: true,
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
            followUpCard: followUpCard
              ? {
                  id: followUpCard.id,
                  title: followUpCard.title,
                  status: followUpCard.status,
                  priority: followUpCard.priority,
                }
              : null,
          };
        } catch (err) {
          return { ok: false, error: String(err) };
        }
      },
    }),
  };

  const result = streamText({
    model: openai(OPENAI_MODEL),
    system: SYSTEM_PROMPT,
    messages: convertToCoreMessages(messages, { tools }),
    temperature: 0,
    // maxSteps > 1 lets the model call a tool and then compose a final reply
    // in a single streaming response (tool call → execute → text follow-up).
    maxSteps: 8,
    tools,
  });

  return result.toDataStreamResponse({
    getErrorMessage: (error) => (error instanceof Error ? error.message : String(error)),
  });
}
