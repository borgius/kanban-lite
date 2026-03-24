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
import { streamText, tool } from 'ai';
import { z } from 'zod';
import { createTask, listTasks, moveTask } from '@/lib/kanban';

// Use Node.js runtime so fetch and env vars work without Edge limitations.
export const runtime = 'nodejs';

const SYSTEM_PROMPT = `\
You are a kanban triage assistant. You help users manage their task board using natural language.

You have three tools available:
- create_task  – add a new task to the board
- list_tasks   – list tasks, optionally filtered by status column
- move_task    – move a task to a different column

Standard columns: backlog, in-progress, review, done.

When the user asks you to create, list, or move tasks, call the appropriate tool and then
summarize what happened in a short, clear sentence. Keep responses concise and direct.`;

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: openai('gpt-4o-mini'),
    system: SYSTEM_PROMPT,
    messages,
    // maxSteps > 1 lets the model call a tool and then compose a final reply
    // in a single streaming response (tool call → execute → text follow-up).
    maxSteps: 5,
    tools: {
      create_task: tool({
        description:
          'Create a new task on the kanban board. Use when the user asks to add, log, or create a task.',
        parameters: z.object({
          title: z.string().describe('Short, clear task title'),
          description: z
            .string()
            .optional()
            .describe('Optional detailed description of the task'),
          priority: z
            .enum(['critical', 'high', 'medium', 'low'])
            .default('medium')
            .describe('Task priority level'),
        }),
        execute: async ({ title, description, priority }) => {
          try {
            const task = await createTask(title, description, priority);
            return {
              ok: true,
              task: {
                id: task.id,
                title: task.title,
                status: task.status,
                priority: task.priority,
              },
            };
          } catch (err) {
            return { ok: false, error: String(err) };
          }
        },
      }),

      list_tasks: tool({
        description:
          'List tasks from the kanban board. Optionally filter by status column.',
        parameters: z.object({
          status: z
            .string()
            .optional()
            .describe(
              'Column to filter by, e.g. "backlog", "in-progress", "done". Omit to list all tasks.',
            ),
        }),
        execute: async ({ status }) => {
          try {
            const tasks = await listTasks(status);
            return {
              ok: true,
              count: tasks.length,
              tasks: tasks
                .slice(0, 20)
                .map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority })),
            };
          } catch (err) {
            return { ok: false, error: String(err) };
          }
        },
      }),

      move_task: tool({
        description:
          'Move an existing task to a different status column. Partial task ID is supported.',
        parameters: z.object({
          taskId: z.string().describe('Task ID or partial ID (e.g. "mock-1" or first 6 chars)'),
          status: z
            .string()
            .describe('Target column name, e.g. "in-progress", "review", "done"'),
        }),
        execute: async ({ taskId, status }) => {
          try {
            const task = await moveTask(taskId, status);
            return {
              ok: true,
              task: { id: task.id, title: task.title, status: task.status },
            };
          } catch (err) {
            return { ok: false, error: String(err) };
          }
        },
      }),
    },
  });

  return result.toDataStreamResponse();
}
