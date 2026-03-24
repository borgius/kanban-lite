import {
  addComment,
  createCard,
  getCard,
  listCards,
  moveCard,
  type KanbanCard,
} from './kanban';

export interface ActionWebhookPayload {
  action: string;
  board?: string;
  list?: string;
  card: {
    id: string;
    title?: string;
    status?: string;
    priority?: string;
    labels?: string[];
    actions?: string[] | Record<string, string>;
    forms?: Array<{ name?: string }>;
    formData?: Record<string, Record<string, unknown>>;
    metadata?: Record<string, unknown>;
  };
}

export interface ActionWebhookEffects {
  ok: true;
  action: string;
  boardId: string;
  updatedCard: KanbanCard;
  followUpCard: KanbanCard | null;
  createdFollowUp: boolean;
  effects: string[];
}

const INCIDENTMIND_AUTOMATION_AUTHOR = 'IncidentMind automation';

function getIncidentReport(card: KanbanCard): Record<string, unknown> {
  return card.formData?.['incident-report'] ?? {};
}

function getReleaseChecklist(card: KanbanCard): Record<string, unknown> {
  return card.formData?.['release-checklist'] ?? {};
}

function resolveCardTitle(card: Pick<KanbanCard, 'title' | 'id'>): string {
  return card.title?.trim() || card.id;
}

function buildIncidentAutomationComment(card: KanbanCard, action: string): string {
  const report = getIncidentReport(card);
  const severity = String(report.severity ?? 'unknown');
  const owner = String(report.owner ?? card.assignee ?? 'unassigned');
  const service = String(report.service ?? card.metadata?.service ?? 'unknown-service');

  if (action === 'notify-slack') {
    return `IncidentMind automation recorded \`${action}\` for "${resolveCardTitle(card)}" and posted the current CorePilot update (severity: ${severity}, owner: ${owner}, service: ${service}).`;
  }

  return `IncidentMind automation recorded \`${action}\` for "${resolveCardTitle(card)}" and escalated the CorePilot follow-up (severity: ${severity}, owner: ${owner}, service: ${service}).`;
}

function buildReleaseAutomationComment(card: KanbanCard, action: string): string {
  const checklist = getReleaseChecklist(card);
  const owner = String(checklist.owner ?? card.assignee ?? 'unassigned');
  const environment = String(checklist.environment ?? 'unknown-environment');
  const approved = checklist.approved === true ? 'approved' : 'not-yet-approved';

  if (action === 'deploy') {
    return `IncidentMind automation recorded \`${action}\` for "${resolveCardTitle(card)}" (${environment}, owner: ${owner}, checklist: ${approved}).`;
  }

  return `IncidentMind automation recorded \`${action}\` for "${resolveCardTitle(card)}" and returned the release to active mitigation (${environment}, owner: ${owner}).`;
}

function buildGenericAutomationComment(card: KanbanCard, action: string): string {
  return `IncidentMind automation recorded \`${action}\` for "${resolveCardTitle(card)}" and synced the board-side follow-up in kanban-lite.`;
}

function buildEscalationFollowUpTitle(cardTitle: string): string {
  return `Escalation follow-up: ${cardTitle}`;
}

async function ensureComment(card: KanbanCard, content: string): Promise<boolean> {
  const alreadyPresent = (card.comments ?? []).some(
    (comment) => comment.author === INCIDENTMIND_AUTOMATION_AUTHOR && comment.content === content,
  );

  if (alreadyPresent) {
    return false;
  }

  await addComment(card.id, INCIDENTMIND_AUTOMATION_AUTHOR, content);
  return true;
}

async function ensureMoved(card: KanbanCard, status: string): Promise<boolean> {
  if (card.status === status) {
    return false;
  }

  await moveCard(card.id, status);
  return true;
}

async function ensureEscalationFollowUp(card: KanbanCard): Promise<{ card: KanbanCard; created: boolean }> {
  const title = buildEscalationFollowUpTitle(resolveCardTitle(card));
  const existing = (await listCards()).find((candidate) => candidate.title === title);

  if (existing) {
    return { card: existing, created: false };
  }

  const created = await createCard(
    title,
    `Track explicit CorePilot escalation follow-up for "${resolveCardTitle(card)}". Source card: ${card.id}.`,
    card.priority,
    {
      status: 'backlog',
      assignee: card.assignee ?? null,
      labels: ['incident', 'escalation-follow-up'],
      metadata: {
        sourceCardId: card.id,
        sourceCardTitle: resolveCardTitle(card),
        automation: 'incidentmind',
        followUpType: 'escalation',
      },
    },
  );

  return { card: created, created: true };
}

export async function applyActionWebhookEffects(
  payload: ActionWebhookPayload,
): Promise<ActionWebhookEffects> {
  const boardId = payload.board ?? 'default';
  let currentCard = await getCard(payload.card.id);
  const effects: string[] = [];
  let followUpCard: KanbanCard | null = null;
  let createdFollowUp = false;

  const isIncidentAction = payload.action === 'notify-slack' || payload.action === 'escalate';
  const isReleaseAction = payload.action === 'deploy' || payload.action === 'rollback';

  const comment = isIncidentAction
    ? buildIncidentAutomationComment(currentCard, payload.action)
    : isReleaseAction
      ? buildReleaseAutomationComment(currentCard, payload.action)
      : buildGenericAutomationComment(currentCard, payload.action);

  if (await ensureComment(currentCard, comment)) {
    effects.push('comment-added');
  }

  if (payload.action === 'escalate') {
    if (await ensureMoved(currentCard, 'review')) {
      effects.push('status-moved-to-review');
    }

    const followUp = await ensureEscalationFollowUp(currentCard);
    followUpCard = followUp.card;
    createdFollowUp = followUp.created;
    effects.push(followUp.created ? 'follow-up-card-created' : 'follow-up-card-reused');
  }

  if (payload.action === 'deploy') {
    const checklist = getReleaseChecklist(currentCard);
    const shouldMoveToDone = checklist.approved === true;

    if (shouldMoveToDone && await ensureMoved(currentCard, 'done')) {
      effects.push('status-moved-to-done');
    }
  }

  if (payload.action === 'rollback' && await ensureMoved(currentCard, 'in-progress')) {
    effects.push('status-moved-to-in-progress');
  }

  currentCard = await getCard(payload.card.id);

  if (payload.action === 'escalate' && followUpCard) {
    followUpCard = await getCard(followUpCard.id);
  }

  return {
    ok: true,
    action: payload.action,
    boardId,
    updatedCard: currentCard,
    followUpCard,
    createdFollowUp,
    effects,
  };
}

export function getDeterministicFollowUpTitle(action: string, sourceCardTitle: string): string | null {
  if (action === 'escalate') {
    return buildEscalationFollowUpTitle(sourceCardTitle);
  }

  return null;
}
