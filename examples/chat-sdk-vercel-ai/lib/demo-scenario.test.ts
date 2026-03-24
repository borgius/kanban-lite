import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCorePilotScenarioCards } from './demo-scenario.js';

const INCIDENT_TITLES = [
  'Investigate billing alert spike',
  'Triage EU login latency regression',
  'Confirm webhook retry recovery after partner timeout',
] as const;

afterEach(() => {
  delete process.env.KANBAN_USE_MOCK;
  vi.resetModules();
});

describe('CorePilot demo scenario', () => {
  it('defines the canonical incident matrix with stable titles, forms, actions, and comments', () => {
    const cards = buildCorePilotScenarioCards();
    const incidents = cards.filter((card) => INCIDENT_TITLES.includes(card.title as (typeof INCIDENT_TITLES)[number]));

    expect(cards).toHaveLength(4);
    expect(incidents).toHaveLength(3);
    expect(cards.map((card) => card.title)).toEqual(expect.arrayContaining([...INCIDENT_TITLES, 'Deploy API v2.4.1']));

    expect(cards.find((card) => card.title === 'Investigate billing alert spike')).toMatchObject({
      status: 'in-progress',
      priority: 'high',
      assignee: 'alex',
      labels: ['incident', 'billing', 'customer-impact'],
      forms: [{ name: 'incident-report' }],
    });

    expect(cards.find((card) => card.title === 'Triage EU login latency regression')).toMatchObject({
      status: 'backlog',
      priority: 'critical',
      assignee: 'morgan',
      labels: ['incident', 'auth', 'eu'],
      forms: [{ name: 'incident-report' }],
    });

    expect(cards.find((card) => card.title === 'Confirm webhook retry recovery after partner timeout')).toMatchObject({
      status: 'review',
      priority: 'medium',
      assignee: 'priya',
      labels: ['incident', 'integrations', 'webhooks'],
      forms: [{ name: 'incident-report' }],
    });

    for (const incident of incidents) {
      expect(incident.actions).toMatchObject({
        'notify-slack': 'Notify Slack',
        escalate: 'Escalate Incident',
      });
      expect(incident.comments).toHaveLength(2);
      expect(incident.formData?.['incident-report']).toMatchObject({
        owner: incident.assignee,
      });
    }
  });

  it('preloads the same scenario when mock mode is enabled', async () => {
    process.env.KANBAN_USE_MOCK = 'true';
    vi.resetModules();

    const { getCard, listCards } = await import('./kanban');
    const cards = await listCards();

    expect(cards).toHaveLength(4);
    expect(cards.map((card) => card.title)).toEqual(expect.arrayContaining([...INCIDENT_TITLES, 'Deploy API v2.4.1']));

    const billing = cards.find((card) => card.title === 'Investigate billing alert spike');
    expect(billing).toMatchObject({
      status: 'in-progress',
      priority: 'high',
      assignee: 'alex',
      labels: ['incident', 'billing', 'customer-impact'],
    });

    const detailedBilling = await getCard(billing!.id);
    expect(detailedBilling.forms).toEqual([{ name: 'incident-report' }]);
    expect(detailedBilling.formData?.['incident-report']).toMatchObject({
      severity: 'high',
      owner: 'alex',
      service: 'billing-api',
    });
    expect(detailedBilling.comments?.map((comment) => comment.author)).toEqual(['ops-bot', 'support-lead']);
    expect(Object.keys((detailedBilling.actions as Record<string, string>) ?? {})).toEqual(
      expect.arrayContaining(['notify-slack', 'escalate']),
    );
  });
});
