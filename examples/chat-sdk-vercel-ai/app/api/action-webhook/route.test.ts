import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ACTION_WEBHOOK_SECRET_MIN_LENGTH,
  buildActionWebhookUrl,
} from '@/lib/action-webhook-auth.js';

const VALID_TEST_SECRET = 'test-action-secret-0123456789';

afterEach(() => {
  delete process.env.ACTION_WEBHOOK_SECRET;
  delete process.env.KANBAN_USE_MOCK;
  vi.resetModules();
});

function createActionWebhookRequest(body: Record<string, unknown>, token?: string) {
  const url = token
    ? buildActionWebhookUrl('http://localhost/api/action-webhook', token)
    : 'http://localhost/api/action-webhook';

  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/action-webhook', () => {
  it('returns 503 when the action webhook secret is not configured', async () => {
    process.env.KANBAN_USE_MOCK = 'true';

    const { POST } = await import('./route');

    const response = await POST(
      createActionWebhookRequest({
        action: 'deploy',
        board: 'default',
        list: 'review',
        card: { id: 'card_123' },
      }, VALID_TEST_SECRET),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'Action webhook secret is not configured. Set ACTION_WEBHOOK_SECRET or start the local stack launcher.',
    });
  });

  it('returns 503 when the configured action webhook secret is too short', async () => {
    process.env.ACTION_WEBHOOK_SECRET = 'too-short-secret';
    process.env.KANBAN_USE_MOCK = 'true';

    const { POST } = await import('./route');

    const response = await POST(
      createActionWebhookRequest({
        action: 'deploy',
        board: 'default',
        list: 'review',
        card: { id: 'card_123' },
      }, 'too-short-secret'),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: `ACTION_WEBHOOK_SECRET must be at least ${ACTION_WEBHOOK_SECRET_MIN_LENGTH} characters long for the local demo.`,
    });
  });

  it('rejects unauthenticated action webhook requests without the shared secret', async () => {
    process.env.ACTION_WEBHOOK_SECRET = VALID_TEST_SECRET;
    process.env.KANBAN_USE_MOCK = 'true';

    const { listCards } = await import('@/lib/kanban');
    const { POST } = await import('./route');
    const seeded = (await listCards())[0];

    const response = await POST(
      createActionWebhookRequest({
        action: 'deploy',
        board: 'default',
        list: 'review',
        card: { id: seeded.id },
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'Unauthorized action webhook request.',
    });
  });

  it('rejects action webhook requests with the wrong shared secret', async () => {
    process.env.ACTION_WEBHOOK_SECRET = VALID_TEST_SECRET;
    process.env.KANBAN_USE_MOCK = 'true';

    const { listCards } = await import('@/lib/kanban');
    const { POST } = await import('./route');
    const seeded = (await listCards())[0];

    const response = await POST(
      createActionWebhookRequest({
        action: 'deploy',
        board: 'default',
        list: 'review',
        card: { id: seeded.id },
      }, 'wrong-secret'),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'Unauthorized action webhook request.',
    });
  });

  it('adds a deterministic automation comment and incident follow-up card for escalate', async () => {
    process.env.ACTION_WEBHOOK_SECRET = VALID_TEST_SECRET;
    process.env.KANBAN_USE_MOCK = 'true';

    const { listCards, getCard } = await import('@/lib/kanban');
    const { POST } = await import('./route');
    const seeded = (await listCards()).find((card) => card.title === 'Investigate billing alert spike');

    expect(seeded).toBeTruthy();

    const response = await POST(
      createActionWebhookRequest({
        action: 'escalate',
        board: 'default',
        list: seeded!.status,
        card: { id: seeded!.id },
      }, VALID_TEST_SECRET),
    );

    expect(response.ok).toBe(true);

    const updated = await getCard(seeded!.id);
    const followUp = (await listCards()).find(
      (card) => card.title === 'Escalation follow-up: Investigate billing alert spike',
    );

    expect(updated.status).toBe('review');
    expect(updated.comments?.some(
      (comment) => comment.author === 'IncidentMind automation' && comment.content.includes('`escalate`'),
    )).toBe(true);
    expect(followUp).toMatchObject({
      status: 'backlog',
      priority: 'high',
      labels: ['incident', 'escalation-follow-up'],
    });
  });

  it('moves approved release deploy actions to done and records an automation comment', async () => {
    process.env.ACTION_WEBHOOK_SECRET = VALID_TEST_SECRET;
    process.env.KANBAN_USE_MOCK = 'true';

    const { createCard, getCard, submitCardForm } = await import('@/lib/kanban');
    const { POST } = await import('./route');
    const seeded = await createCard(
      'Deploy API v2.4.1',
      'Finish the rollout checklist and trigger the deploy action once release approval is recorded.',
      'medium',
      {
        status: 'review',
        assignee: 'jamie',
        actions: { deploy: 'Deploy Release' },
        forms: [{ name: 'release-checklist' }],
      },
    );

    await submitCardForm(seeded.id, 'release-checklist', {
      approved: true,
      owner: 'jamie',
      environment: 'production',
    });

    const response = await POST(
      createActionWebhookRequest({
        action: 'deploy',
        board: 'default',
        list: seeded.status,
        card: { id: seeded.id },
      }, VALID_TEST_SECRET),
    );

    expect(response.ok).toBe(true);

    const updated = await getCard(seeded.id);
    expect(updated.status).toBe('done');
    expect(updated.comments?.some(
      (comment) => comment.author === 'IncidentMind automation' && comment.content.includes('`deploy`'),
    )).toBe(true);
  });

  it('keeps deploy actions in review until release approval is recorded', async () => {
    process.env.ACTION_WEBHOOK_SECRET = VALID_TEST_SECRET;
    process.env.KANBAN_USE_MOCK = 'true';

    const { createCard, getCard } = await import('@/lib/kanban');
    const { POST } = await import('./route');
    const seeded = await createCard(
      'Deploy API v2.4.2',
      'Trigger the deploy action only after the release-checklist is approved.',
      'medium',
      {
        status: 'review',
        assignee: 'jamie',
        actions: { deploy: 'Deploy Release' },
      },
    );

    const response = await POST(
      createActionWebhookRequest({
        action: 'deploy',
        board: 'default',
        list: seeded.status,
        card: { id: seeded.id },
      }, VALID_TEST_SECRET),
    );

    expect(response.ok).toBe(true);

    const updated = await getCard(seeded.id);
    expect(updated.status).toBe('review');
    expect(updated.comments?.some(
      (comment) =>
        comment.author === 'IncidentMind automation'
        && comment.content.includes('`deploy`')
        && comment.content.includes('not-yet-approved'),
    )).toBe(true);
  });
});
