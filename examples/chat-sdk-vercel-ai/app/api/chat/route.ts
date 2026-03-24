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
import { createCard, listCards, moveCard } from '@/lib/kanban';

// Use Node.js runtime so fetch and env vars work without Edge limitations.
export const runtime = 'nodejs';
export const maxDuration = 60;

const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4.1-mini';

const SYSTEM_PROMPT = `\
You are a kanban card triage assistant. You help users manage their kanban board using natural language.

You have three tools available:
- create_card  – add a new card to the board
- list_cards   – list cards, optionally filtered by status column
- move_card    – move an existing card to a different column

Standard columns: backlog, in-progress, review, done.

When the user asks you to create, list, or move cards, you must call the appropriate tool before answering.
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
        priority: z
          .enum(['critical', 'high', 'medium', 'low'])
          .default('medium')
          .describe('Card priority level'),
      }),
      execute: async ({ title, description, priority }) => {
        try {
          const card = await createCard(title, description, priority);
          return {
            ok: true,
            card: {
              id: card.id,
              title: card.title,
              status: card.status,
              priority: card.priority,
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
              .map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority })),
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
  };

  const result = streamText({
    model: openai(OPENAI_MODEL),
    system: SYSTEM_PROMPT,
    messages: convertToCoreMessages(messages, { tools }),
    temperature: 0,
    // maxSteps > 1 lets the model call a tool and then compose a final reply
    // in a single streaming response (tool call → execute → text follow-up).
    maxSteps: 5,
    tools,
  });

  return result.toDataStreamResponse({
    getErrorMessage: (error) => (error instanceof Error ? error.message : String(error)),
  });
}
