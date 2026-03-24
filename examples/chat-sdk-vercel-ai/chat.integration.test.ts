import * as http from 'node:http';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer } from '../../packages/kanban-lite/src/standalone/server';
import { POST as postActionWebhook } from './app/api/action-webhook/route';
import { buildActionWebhookUrl } from './lib/action-webhook-auth.js';

type ChatRouteModule = typeof import('./app/api/chat/route');

type CardSummary = {
  id: string;
  status: string;
  priority: string;
  content?: string;
  comments?: Array<{ author: string; content: string }>;
  formData?: Record<string, Record<string, unknown>>;
  actions?: string[] | Record<string, string>;
  forms?: Array<{ name?: string }>;
};

type ActionWebhookPayload = {
  action: string;
  board: string;
  list: string;
  card: { id: string };
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

function createTempWorkspace(actionWebhookUrl: string) {
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
        forms: {
          'incident-report': {
            schema: {
              type: 'object',
              title: 'Incident Report',
              properties: {
                severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
                owner: { type: 'string' },
                service: { type: 'string' },
              },
              required: ['severity', 'owner'],
            },
            data: {
              severity: 'medium',
            },
          },
        },
        actionWebhookUrl,
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

async function fetchCard(baseUrl: string, cardId: string): Promise<CardSummary> {
  const response = await fetch(`${baseUrl}/api/boards/default/tasks/${encodeURIComponent(cardId)}`);
  expect(response.ok).toBe(true);

  const payload = (await response.json()) as { ok: boolean; data: CardSummary; error?: string };
  if (!payload.ok) {
    throw new Error(payload.error ?? 'Failed to fetch card');
  }

  return payload.data;
}

async function createCardViaApi(
  baseUrl: string,
  body: Record<string, unknown>,
): Promise<CardSummary> {
  const response = await fetch(`${baseUrl}/api/boards/default/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  expect(response.ok).toBe(true);

  const payload = (await response.json()) as { ok: boolean; data: CardSummary; error?: string };
  if (!payload.ok) {
    throw new Error(payload.error ?? 'Failed to create seeded card');
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
  let actionServer: http.Server | null = null;
  const actionEvents: ActionWebhookPayload[] = [];
  let cleanupWorkspace: (() => void) | null = null;

  beforeAll(async () => {
    const actionPort = await getFreePort();
    const actionWebhookSecret = 'integration-action-secret-0123456789';
    const actionWebhookUrl = buildActionWebhookUrl(`http://127.0.0.1:${actionPort}/actions`, actionWebhookSecret);
    process.env.ACTION_WEBHOOK_SECRET = actionWebhookSecret;

    actionServer = http.createServer(async (req, res) => {
      const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');

      if (req.method !== 'POST' || requestUrl.pathname !== '/actions') {
        res.writeHead(404);
        res.end();
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }

      const actionPayload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as ActionWebhookPayload;
      actionEvents.push(actionPayload);

      const routeResponse = await postActionWebhook(
        new Request(`http://localhost/api/action-webhook${requestUrl.search}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(actionPayload),
        }),
      );

      const responseBody = await routeResponse.text();

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(responseBody);
    });

    await new Promise<void>((resolve, reject) => {
      actionServer!.listen(actionPort, '127.0.0.1', (err?: Error) => {
        if (err) reject(err);
        else resolve();
      });
    });

    const workspace = createTempWorkspace(actionWebhookUrl);
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
    if (actionServer) {
      await new Promise<void>((resolve, reject) => {
        actionServer!.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
    cleanupWorkspace?.();
    delete process.env.ACTION_WEBHOOK_SECRET;
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

  it('adds comments and submits attached forms through the chat route', async () => {
    const seeded = await createCardViaApi(baseUrl, {
      content: '# Billing Incident\n\nCapture the incident owner and severity.',
      priority: 'high',
      forms: [{ name: 'incident-report' }],
      formData: {
        'incident-report': {
          service: 'billing-api',
        },
      },
    });

    const commentTranscript = await sendPrompt(
      `Add a comment to the kanban card with id "${seeded.id}" from "incident-commander" that says "Owner is Alice and severity is critical." Use the comment tool before replying.`,
    );

    const cardWithComment = await waitFor(async () => {
      const card = await fetchCard(baseUrl, seeded.id);
      return card.comments?.some(
        (comment) =>
          comment.author === 'incident-commander'
          && comment.content.includes('Owner is Alice and severity is critical.'),
      )
        ? card
        : null;
    }, 45000, 300).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message}\n\nComment transcript:\n${commentTranscript}`);
    });

    expect(cardWithComment.comments?.length ?? 0).toBeGreaterThan(0);

    const formTranscript = await sendPrompt(
      `Submit the incident-report form on the kanban card with id "${seeded.id}" using severity "critical", owner "Alice", and service "billing-api". Use the form tool before replying.`,
    );

    const submitted = await waitFor(async () => {
      const card = await fetchCard(baseUrl, seeded.id);
      const formData = card.formData?.['incident-report'];
      return formData?.severity === 'critical' && formData?.owner === 'Alice' ? card : null;
    }, 45000, 300).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message}\n\nForm transcript:\n${formTranscript}`);
    });

    expect(submitted.formData?.['incident-report']).toMatchObject({
      severity: 'critical',
      owner: 'Alice',
      service: 'billing-api',
    });
    expect(commentTranscript.toLowerCase()).not.toContain('ok: false');
    expect(formTranscript.toLowerCase()).not.toContain('ok: false');
  });

  it('triggers card actions through the chat route', async () => {
    const seeded = await createCardViaApi(baseUrl, {
      content: '# Release Deployment\n\nTrigger the deploy action when the release-checklist is approved.',
      priority: 'medium',
      status: 'review',
      actions: {
        deploy: 'Deploy Release',
      },
      forms: [{ name: 'release-checklist' }],
      formData: {
        'release-checklist': {
          environment: 'production',
          approved: true,
          owner: 'jamie',
        },
      },
    });

    const existingEvents = actionEvents.length;
    const transcript = await sendPrompt(
      `Trigger the deploy action on the kanban card with id "${seeded.id}". Use the action tool before replying.`,
    );

    const actionEvent = await waitFor(async () => actionEvents[existingEvents] ?? null, 45000, 300).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message}\n\nAction transcript:\n${transcript}`);
    });

    expect(actionEvent.action).toBe('deploy');
    expect(actionEvent.card.id).toBe(seeded.id);
    const updated = await waitFor(async () => {
      const card = await fetchCard(baseUrl, seeded.id);
      return card.comments?.some(
        (comment) => comment.author === 'IncidentMind automation' && comment.content.includes('`deploy`'),
      )
        ? card
        : null;
    }, 45000, 300);

    expect(updated.status).toBe('done');
    expect(transcript.toLowerCase()).not.toContain('ok: false');
  });

  it('creates deterministic incident follow-up state when an incident escalation action is triggered through chat', async () => {
    const seeded = await createCardViaApi(baseUrl, {
      content: '# Investigate billing alert spike\n\nCapture the incident details and escalate if customer impact grows.',
      priority: 'high',
      status: 'in-progress',
      assignee: 'alex',
      labels: ['incident', 'billing'],
      actions: {
        escalate: 'Escalate Incident',
      },
      forms: [{ name: 'incident-report' }],
      formData: {
        'incident-report': {
          severity: 'critical',
          owner: 'alex',
          service: 'billing-api',
        },
      },
    });

    const transcript = await sendPrompt(
      `Trigger the escalate action on the kanban card with id "${seeded.id}". Use the action tool before replying and summarize any board-side follow-up that appears.`,
    );

    const updated = await waitFor(async () => {
      const card = await fetchCard(baseUrl, seeded.id);
      return card.comments?.some(
        (comment) => comment.author === 'IncidentMind automation' && comment.content.includes('`escalate`'),
      )
        ? card
        : null;
    }, 45000, 300).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message}\n\nEscalation transcript:\n${transcript}`);
    });

    const followUp = await waitFor(async () => {
      const cards = await fetchCards(baseUrl);
      return findCardByTitle(cards, 'Escalation follow-up: Investigate billing alert spike');
    }, 45000, 300);

    expect(updated.status).toBe('review');
    expect(followUp).not.toBeNull();
    expect(followUp?.status).toBe('backlog');
    expect(transcript.toLowerCase()).not.toContain('ok: false');
  });
});
