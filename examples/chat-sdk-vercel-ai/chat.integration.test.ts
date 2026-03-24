import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer } from '../../packages/kanban-lite/src/standalone/server';

type ChatRouteModule = typeof import('./app/api/chat/route');

type CardSummary = {
  id: string;
  status: string;
  priority: string;
  content?: string;
};

function extractTitle(card: CardSummary): string {
  const heading = card.content?.split(/\r?\n/).find((line) => line.startsWith('# '));
  return heading?.replace(/^#\s+/, '').trim() || card.id;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(fn: () => Promise<T | null>, timeoutMs = 30000, intervalMs = 250): Promise<T> {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const result = await fn();
    if (result !== null) return result;
    await sleep(intervalMs);
  }

  throw new Error(`Condition was not met within ${timeoutMs}ms`);
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to allocate a free TCP port'));
        return;
      }
      const { port } = address;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
    server.on('error', reject);
  });
}

function createTempWorkspace() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-chat-sdk-test-'));
  const kanbanDir = path.join(workspaceRoot, '.kanban');
  const configFile = path.join(workspaceRoot, '.kanban.json');

  fs.mkdirSync(kanbanDir, { recursive: true });
  fs.writeFileSync(
    configFile,
    JSON.stringify(
      {
        version: 2,
        defaultBoard: 'default',
        kanbanDirectory: '.kanban',
        boards: {
          default: {
            name: 'Default',
            defaultStatus: 'backlog',
            defaultPriority: 'medium',
            nextCardId: 1,
            columns: [
              { id: 'backlog', name: 'Backlog', color: '#6b7280' },
              { id: 'in-progress', name: 'In Progress', color: '#f59e0b' },
              { id: 'review', name: 'Review', color: '#8b5cf6' },
              { id: 'done', name: 'Done', color: '#22c55e' },
            ],
          },
        },
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  return {
    workspaceRoot,
    kanbanDir,
    configFile,
    cleanup: () => fs.rmSync(workspaceRoot, { recursive: true, force: true }),
  };
}

async function waitForServer(baseUrl: string): Promise<void> {
  await waitFor(async () => {
    try {
      const response = await fetch(`${baseUrl}/api/workspace`);
      return response.ok ? true : null;
    } catch {
      return null;
    }
  }, 30000, 200);
}

async function fetchCards(baseUrl: string, status?: string): Promise<CardSummary[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  const response = await fetch(`${baseUrl}/api/boards/default/tasks${query}`);
  expect(response.ok).toBe(true);

  const payload = (await response.json()) as { ok: boolean; data: CardSummary[]; error?: string };
  if (!payload.ok) {
    throw new Error(payload.error ?? 'Failed to fetch cards');
  }

  return payload.data;
}

function findCardByTitle(cards: CardSummary[], title: string): CardSummary | null {
  return cards.find((card) => extractTitle(card) === title) ?? null;
}

const describeWithOpenAI = process.env.OPENAI_API_KEY ? describe : describe.skip;

describeWithOpenAI('chat-sdk-vercel-ai integration', () => {
  let baseUrl = '';
  let postChat: ChatRouteModule['POST'];
  let server: ReturnType<typeof startServer> | null = null;
  let cleanupWorkspace: (() => void) | null = null;

  beforeAll(async () => {
    const workspace = createTempWorkspace();
    cleanupWorkspace = workspace.cleanup;

    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;

    process.env.KANBAN_API_URL = baseUrl;
    process.env.KANBAN_BOARD_ID = 'default';
    process.env.KANBAN_USE_MOCK = 'false';

    server = startServer(workspace.kanbanDir, port, undefined, workspace.configFile);
    await waitForServer(baseUrl);

    ({ POST: postChat } = await import('./app/api/chat/route'));
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
    cleanupWorkspace?.();
  });

  async function sendPrompt(prompt: string): Promise<string> {
    const response = await postChat(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: [
            {
              id: crypto.randomUUID(),
              role: 'user',
              content: prompt,
            },
          ],
        }),
      }),
    );

    expect(response.ok).toBe(true);
    return await response.text();
  }

  it('creates a real kanban card through the chat route', async () => {
    const title = `Integration Card ${Date.now()} create`;
    const transcript = await sendPrompt(
      `Create exactly one kanban card titled "${title}" with the description "Created by the live integration test." and high priority. Use the tool instead of answering hypothetically.`,
    );

    const created = await waitFor(async () => {
      const cards = await fetchCards(baseUrl);
      return findCardByTitle(cards, title);
    }, 45000, 300).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message}\n\nTranscript:\n${transcript}`);
    });

    expect(created.status).toBe('backlog');
    expect(created.priority).toBe('high');
    expect(transcript.toLowerCase()).not.toContain('ok: false');
  });

  it('moves a created card to done through the chat route', async () => {
    const title = `Integration Card ${Date.now()} move`;
    const createTranscript = await sendPrompt(
      `Create exactly one kanban card titled "${title}" with the description "This card will be moved by the integration test." and medium priority. Use the tool before replying.`,
    );

    const created = await waitFor(async () => {
      const cards = await fetchCards(baseUrl);
      return findCardByTitle(cards, title);
    }, 45000, 300).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message}\n\nCreate transcript:\n${createTranscript}`);
    });

    const transcript = await sendPrompt(
      `Move the kanban card with id "${created.id}" to done. Use the move tool and then confirm the new status briefly.`,
    );

    const moved = await waitFor(async () => {
      const cards = await fetchCards(baseUrl, 'done');
      return cards.find((card) => card.id === created.id) ?? null;
    }, 45000, 300);

    expect(moved.status).toBe('done');
    expect(transcript.toLowerCase()).not.toContain('ok: false');
  });
});
