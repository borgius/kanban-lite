/**
 * Shared CorePilot incident scenario for live seeding, checked-in demo fixtures,
 * and KANBAN_USE_MOCK parity.
 */

/**
 * @typedef {{ author: string, content: string }} DemoComment
 * @typedef {{ name: string }} DemoForm
 * @typedef {{
 *   title: string,
 *   description: string,
 *   status: 'backlog' | 'in-progress' | 'review' | 'done',
 *   priority: 'critical' | 'high' | 'medium' | 'low',
 *   assignee: string,
 *   labels: string[],
 *   metadata?: Record<string, unknown>,
 *   actions?: Record<string, string>,
 *   forms?: DemoForm[],
 *   formData?: Record<string, Record<string, unknown>>,
 *   comments?: DemoComment[]
 * }} DemoScenarioCard
 */

const INCIDENT_ACTIONS = Object.freeze({
  'notify-slack': 'Notify Slack',
  escalate: 'Escalate Incident',
});

/** @type {readonly DemoScenarioCard[]} */
const COREPILOT_SCENARIO_TEMPLATE = Object.freeze([
  {
    title: 'Investigate billing alert spike',
    description:
      'Capture the incident details, confirm customer impact, and keep billing support aligned on the mitigation plan.',
    status: 'in-progress',
    priority: 'high',
    assignee: 'alex',
    labels: ['incident', 'billing', 'customer-impact'],
    metadata: {
      service: 'billing-api',
      affectedTier: 'enterprise-invoices',
    },
    actions: INCIDENT_ACTIONS,
    forms: [{ name: 'incident-report' }],
    formData: {
      'incident-report': {
        severity: 'high',
        owner: 'alex',
        service: 'billing-api',
      },
    },
    comments: [
      {
        author: 'ops-bot',
        content:
          'Alert volume doubled in the last hour on billing-api. Please confirm owner, severity, and current customer impact in the attached form.',
      },
      {
        author: 'support-lead',
        content:
          'Three enterprise customers reported duplicate invoice warnings. Share the next update here before we post externally.',
      },
    ],
  },
  {
    title: 'Triage EU login latency regression',
    description:
      'Validate the auth-edge slowdown in EU regions, confirm blast radius, and decide whether to roll back the latest edge config.',
    status: 'backlog',
    priority: 'critical',
    assignee: 'morgan',
    labels: ['incident', 'auth', 'eu'],
    metadata: {
      service: 'auth-edge',
      region: 'eu-west',
    },
    actions: INCIDENT_ACTIONS,
    forms: [{ name: 'incident-report' }],
    formData: {
      'incident-report': {
        severity: 'critical',
        owner: 'morgan',
        service: 'auth-edge',
      },
    },
    comments: [
      {
        author: 'synthetic-monitor',
        content:
          'EU login p95 crossed 2.8s for three consecutive checks after the latest auth-edge deploy.',
      },
      {
        author: 'customer-success',
        content:
          'Multiple finance admins in Germany report repeated login retries during payroll prep.',
      },
    ],
  },
  {
    title: 'Confirm webhook retry recovery after partner timeout',
    description:
      'Verify the retry queue drained cleanly after the partner timeout and confirm there are no stuck outbound deliveries left to replay.',
    status: 'review',
    priority: 'medium',
    assignee: 'priya',
    labels: ['incident', 'integrations', 'webhooks'],
    metadata: {
      service: 'partner-webhooks',
      partner: 'fulfillment-cloud',
    },
    actions: INCIDENT_ACTIONS,
    forms: [{ name: 'incident-report' }],
    formData: {
      'incident-report': {
        severity: 'medium',
        owner: 'priya',
        service: 'partner-webhooks',
      },
    },
    comments: [
      {
        author: 'integration-bot',
        content:
          'Timeout spike resolved at 09:42 UTC. Retry backlog is shrinking, but the final confirmation run is still pending.',
      },
      {
        author: 'partner-ops',
        content:
          'Partner confirms their endpoint is stable again. Please verify no customer-facing retries remain before closing this out.',
      },
    ],
  },
  {
    title: 'Deploy API v2.4.1',
    description:
      'Finish the rollout checklist and trigger the deploy action once release approval is recorded.',
    status: 'review',
    priority: 'medium',
    assignee: 'jamie',
    labels: ['release'],
    actions: {
      deploy: 'Deploy Release',
      rollback: 'Rollback Release',
    },
    forms: [{ name: 'release-checklist' }],
    formData: {
      'release-checklist': {
        environment: 'production',
        approved: false,
        owner: 'jamie',
      },
    },
    comments: [
      {
        author: 'release-manager',
        content:
          'When the checklist is complete, ask the agent to trigger the deploy action on this card.',
      },
    ],
  },
]);

function cloneRecord(value) {
  return value ? JSON.parse(JSON.stringify(value)) : undefined;
}

/**
 * @returns {DemoScenarioCard[]}
 */
export function buildCorePilotScenarioCards() {
  return COREPILOT_SCENARIO_TEMPLATE.map((card) => ({
    ...card,
    labels: [...card.labels],
    metadata: cloneRecord(card.metadata),
    actions: cloneRecord(card.actions),
    forms: card.forms?.map((form) => ({ ...form })),
    formData: cloneRecord(card.formData),
    comments: card.comments?.map((comment) => ({ ...comment })),
  }));
}

export function buildDemoCardContent(title, description) {
  return description ? `# ${title}\n\n${description}` : `# ${title}`;
}
