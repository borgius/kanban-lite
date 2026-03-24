/**
 * kanban.ts — kanban-lite REST API client
 *
 * Integration seam: this module calls the kanban-lite standalone server's
 * documented REST API to create, list, and move tasks on a kanban board.
 *
 * Env vars (see .env.example):
 *   KANBAN_API_URL     – base URL of the kanban-lite server (default: http://localhost:3000)
 *   KANBAN_BOARD_ID    – board to use (default: "default")
 *   KANBAN_API_TOKEN   – optional Bearer token for auth-plugin-protected servers
 *   KANBAN_USE_MOCK    – set "true" to bypass the server with an in-memory mock
 *
 * API reference: ../../docs/api.md
 *   GET    /api/boards/:boardId/tasks           – list tasks
 *   POST   /api/boards/:boardId/tasks           – create task (title from first # heading)
 *   GET    /api/boards/:boardId/tasks/:id       – inspect task details
 *   PATCH  /api/boards/:boardId/tasks/:id/move  – move task to a column
 *   POST   /api/tasks/:id/comments              – add a task comment
 *   POST   /api/boards/:boardId/tasks/:id/forms/:formId/submit – submit a form
 *   POST   /api/boards/:boardId/tasks/:id/actions/:action      – trigger a card action
 */

import { buildCorePilotScenarioCards } from './demo-scenario.js';

export interface KanbanComment {
  id: string;
  author: string;
  created: string;
  content: string;
}

export interface KanbanFormAttachment {
  name?: string;
  schema?: Record<string, unknown>;
  ui?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

export interface KanbanResolvedForm {
  id: string;
  label: string;
  name?: string;
  description?: string;
  schema?: Record<string, unknown>;
  ui?: Record<string, unknown>;
}

export interface KanbanCard {
  id: string;
  title: string;
  status: string;
  priority: string;
  assignee?: string | null;
  dueDate?: string | null;
  labels?: string[];
  metadata?: Record<string, unknown>;
  actions?: string[] | Record<string, string>;
  forms?: KanbanFormAttachment[];
  formData?: Record<string, Record<string, unknown>>;
  comments?: KanbanComment[];
  created?: string;
  modified?: string;
  completedAt?: string | null;
  body?: string;
  content?: string;
}

export interface CreateCardOptions {
  assignee?: string | null;
  status?: string;
  dueDate?: string | null;
  labels?: string[];
  metadata?: Record<string, unknown>;
  actions?: string[] | Record<string, string>;
  forms?: KanbanFormAttachment[];
  formData?: Record<string, Record<string, unknown>>;
}

export interface KanbanFormSubmitResult {
  boardId: string;
  card: KanbanCard;
  form: KanbanResolvedForm;
  data: Record<string, unknown>;
}

interface ApiEnvelope<T> {
  ok: boolean;
  data: T;
  error?: string;
}

function getKanbanApiUrl(): string {
  return process.env.KANBAN_API_URL ?? 'http://localhost:3000';
}

function getKanbanBoardId(): string {
  return process.env.KANBAN_BOARD_ID ?? 'default';
}

function getKanbanApiToken(): string | undefined {
  return process.env.KANBAN_API_TOKEN;
}

function shouldUseMockStore(): boolean {
  return process.env.KANBAN_USE_MOCK === 'true';
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'form';
}

function resolveFormId(form: KanbanFormAttachment, index: number): string {
  return form.name ?? slugify(String(form.schema?.title ?? `form-${index + 1}`));
}

function resolveFormLabel(form: KanbanFormAttachment, index: number): string {
  return form.name ?? String(form.schema?.title ?? `Form ${index + 1}`);
}

function parseCardContent(content: string | undefined, fallbackTitle: string): Pick<KanbanCard, 'title' | 'body'> {
  if (!content) {
    return { title: fallbackTitle };
  }

  const lines = content.split(/\r?\n/);
  const headingLine = lines.find((line) => line.startsWith('# '));
  const title = headingLine?.replace(/^#\s+/, '').trim() || fallbackTitle;
  const body = lines
    .filter((line, index) => !(index === lines.indexOf(headingLine ?? '') && line === headingLine))
    .join('\n')
    .trim();

  return {
    title,
    ...(body ? { body } : {}),
  };
}

function normalizeCard(card: Partial<KanbanCard> & { id: string; status: string; priority: string }): KanbanCard {
  const { title, body } = parseCardContent(card.content, card.id);

  return {
    id: card.id,
    title,
    status: card.status,
    priority: card.priority,
    ...(card.assignee !== undefined ? { assignee: card.assignee } : {}),
    ...(card.dueDate !== undefined ? { dueDate: card.dueDate } : {}),
    ...(card.labels ? { labels: card.labels } : {}),
    ...(card.metadata ? { metadata: card.metadata } : {}),
    ...(card.actions ? { actions: card.actions } : {}),
    ...(card.forms ? { forms: card.forms } : {}),
    ...(card.formData ? { formData: card.formData } : {}),
    ...(card.comments ? { comments: card.comments } : {}),
    ...(card.created ? { created: card.created } : {}),
    ...(card.modified ? { modified: card.modified } : {}),
    ...(card.completedAt !== undefined ? { completedAt: card.completedAt } : {}),
    ...(body ? { body } : {}),
    ...(card.content ? { content: card.content } : {}),
  };
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const apiToken = getKanbanApiToken();
  if (apiToken) {
    headers['Authorization'] = `Bearer ${apiToken}`;
  }
  return headers;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${getKanbanApiUrl()}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { ...getHeaders(), ...(init?.headers ?? {}) },
  });
  const contentType = res.headers.get('content-type') ?? '';
  const json = contentType.includes('application/json')
    ? (await res.json()) as ApiEnvelope<T>
    : null;
  if (!res.ok || !json?.ok) {
    throw new Error(json?.error ?? `kanban-lite API error ${res.status} – ${url}`);
  }
  return json.data;
}

async function apiNoContent(path: string, init?: RequestInit): Promise<void> {
  const url = `${getKanbanApiUrl()}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { ...getHeaders(), ...(init?.headers ?? {}) },
  });
  if (res.ok) return;

  const contentType = res.headers.get('content-type') ?? '';
  const json = contentType.includes('application/json')
    ? (await res.json()) as ApiEnvelope<unknown>
    : null;
  throw new Error(json?.error ?? `kanban-lite API error ${res.status} – ${url}`);
}

// ---------------------------------------------------------------------------
// In-memory mock (KANBAN_USE_MOCK=true)
// Used for demos or UI development when the kanban-lite server is unavailable.
// ---------------------------------------------------------------------------

const mockStore: KanbanCard[] = [];
let mockSeq = 0;
let mockCommentSeq = 0;

function mockCreate(
  title: string,
  description: string | undefined,
  priority: string,
  options: CreateCardOptions = {},
): KanbanCard {
  const card: KanbanCard = {
    id: `mock-${++mockSeq}`,
    title,
    status: options.status ?? 'backlog',
    priority,
    assignee: options.assignee ?? null,
    dueDate: options.dueDate ?? null,
    labels: options.labels ?? [],
    metadata: options.metadata,
    actions: options.actions,
    forms: options.forms,
    formData: options.formData,
    comments: [],
    body: description,
  };
  mockStore.push(card);
  return card;
}

function ensureMockScenarioSeeded(): void {
  if (mockStore.length > 0) return;

  for (const seed of buildCorePilotScenarioCards()) {
    const card = mockCreate(seed.title, seed.description, seed.priority, {
      status: seed.status,
      assignee: seed.assignee,
      labels: seed.labels,
      metadata: seed.metadata,
      actions: seed.actions,
      forms: seed.forms,
      formData: seed.formData,
    });

    for (const comment of seed.comments ?? []) {
      mockAddComment(card.id, comment.author, comment.content);
    }
  }
}

function mockList(status?: string): KanbanCard[] {
  ensureMockScenarioSeeded();
  return status ? mockStore.filter((t) => t.status === status) : [...mockStore];
}

function mockMove(idFragment: string, status: string): KanbanCard {
  ensureMockScenarioSeeded();
  const card = mockStore.find(
    (t) => t.id === idFragment || t.id.startsWith(idFragment),
  );
  if (!card) throw new Error(`No mock card found matching id: ${idFragment}`);
  card.status = status;
  return card;
}

function mockGetCard(idFragment: string): KanbanCard {
  ensureMockScenarioSeeded();
  const card = mockStore.find(
    (item) => item.id === idFragment || item.id.startsWith(idFragment),
  );
  if (!card) throw new Error(`No mock card found matching id: ${idFragment}`);
  return card;
}

function mockAddComment(idFragment: string, author: string, content: string): KanbanComment {
  const card = mockGetCard(idFragment);
  const comment: KanbanComment = {
    id: `mock-comment-${++mockCommentSeq}`,
    author,
    created: new Date().toISOString(),
    content,
  };
  card.comments = [...(card.comments ?? []), comment];
  return comment;
}

function mockListComments(idFragment: string): KanbanComment[] {
  return [...(mockGetCard(idFragment).comments ?? [])];
}

function mockSubmitForm(
  idFragment: string,
  formId: string,
  data: Record<string, unknown>,
): KanbanFormSubmitResult {
  const card = mockGetCard(idFragment);
  const forms = card.forms ?? [];
  const formIndex = forms.findIndex((form, index) => resolveFormId(form, index) === formId);
  if (formIndex === -1) {
    throw new Error(`No mock form found matching id: ${formId}`);
  }

  const form = forms[formIndex];
  const resolvedId = resolveFormId(form, formIndex);
  const nextData = {
    ...(card.formData?.[resolvedId] ?? {}),
    ...data,
  };

  card.formData = {
    ...(card.formData ?? {}),
    [resolvedId]: nextData,
  };

  return {
    boardId: getKanbanBoardId(),
    card,
    form: {
      id: resolvedId,
      label: resolveFormLabel(form, formIndex),
      name: form.name,
      schema: form.schema,
      ui: form.ui,
    },
    data: nextData,
  };
}

function mockTriggerAction(idFragment: string, action: string): void {
  const card = mockGetCard(idFragment);
  const actionKeys = Array.isArray(card.actions)
    ? card.actions
    : Object.keys(card.actions ?? {});
  if (!actionKeys.includes(action)) {
    throw new Error(`No mock action found matching key: ${action}`);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a new card on the kanban board.
 *
 * The kanban-lite API derives a task's title from the first Markdown `# heading`
 * in the `content` field — this wrapper builds that content string automatically.
 */
export async function createCard(
  title: string,
  description: string | undefined,
  priority = 'medium',
  options: CreateCardOptions = {},
): Promise<KanbanCard> {
  if (shouldUseMockStore()) {
    ensureMockScenarioSeeded();
    return mockCreate(title, description, priority, options);
  }

  const content = description ? `# ${title}\n\n${description}` : `# ${title}`;
  const card = await apiFetch<KanbanCard>(`/api/boards/${getKanbanBoardId()}/tasks`, {
    method: 'POST',
    body: JSON.stringify({
      content,
      priority,
      ...(options.assignee !== undefined ? { assignee: options.assignee } : {}),
      ...(options.status ? { status: options.status } : {}),
      ...(options.dueDate !== undefined ? { dueDate: options.dueDate } : {}),
      ...(options.labels ? { labels: options.labels } : {}),
      ...(options.metadata ? { metadata: options.metadata } : {}),
      ...(options.actions ? { actions: options.actions } : {}),
      ...(options.forms ? { forms: options.forms } : {}),
      ...(options.formData ? { formData: options.formData } : {}),
    }),
  });

  return normalizeCard(card);
}

/**
 * List cards from the kanban board, optionally filtered by status column.
 */
export async function listCards(status?: string): Promise<KanbanCard[]> {
  if (shouldUseMockStore()) return mockList(status);

  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  const cards = await apiFetch<KanbanCard[]>(`/api/boards/${getKanbanBoardId()}/tasks${qs}`);
  return cards.map((card) => normalizeCard(card));
}

/**
 * Fetch one card with full metadata, attached forms/actions, and comments.
 */
export async function getCard(cardId: string): Promise<KanbanCard> {
  if (shouldUseMockStore()) return mockGetCard(cardId);

  const card = await apiFetch<KanbanCard>(
    `/api/boards/${getKanbanBoardId()}/tasks/${encodeURIComponent(cardId)}`,
  );

  return normalizeCard(card);
}

/**
 * Move a card to a different status column.
 * The `cardId` supports partial ID matching (kanban-lite resolves it server-side).
 */
export async function moveCard(cardId: string, status: string): Promise<KanbanCard> {
  if (shouldUseMockStore()) return mockMove(cardId, status);

  const card = await apiFetch<KanbanCard>(
    `/api/boards/${getKanbanBoardId()}/tasks/${encodeURIComponent(cardId)}/move`,
    {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    },
  );

  return normalizeCard(card);
}

/**
 * List comments attached to a card.
 */
export async function listComments(cardId: string): Promise<KanbanComment[]> {
  if (shouldUseMockStore()) return mockListComments(cardId);

  return apiFetch<KanbanComment[]>(`/api/tasks/${encodeURIComponent(cardId)}/comments`);
}

/**
 * Add a markdown comment to a card.
 */
export async function addComment(cardId: string, author: string, content: string): Promise<KanbanComment> {
  if (shouldUseMockStore()) return mockAddComment(cardId, author, content);

  return apiFetch<KanbanComment>(`/api/tasks/${encodeURIComponent(cardId)}/comments`, {
    method: 'POST',
    body: JSON.stringify({ author, content }),
  });
}

/**
 * Submit a named card form and persist the validated payload.
 */
export async function submitCardForm(
  cardId: string,
  formId: string,
  data: Record<string, unknown>,
): Promise<KanbanFormSubmitResult> {
  if (shouldUseMockStore()) return mockSubmitForm(cardId, formId, data);

  const result = await apiFetch<KanbanFormSubmitResult>(
    `/api/boards/${getKanbanBoardId()}/tasks/${encodeURIComponent(cardId)}/forms/${encodeURIComponent(formId)}/submit`,
    {
      method: 'POST',
      body: JSON.stringify({ data }),
    },
  );

  return {
    ...result,
    card: normalizeCard(result.card),
  };
}

/**
 * Trigger a card-level action webhook.
 */
export async function triggerCardAction(cardId: string, action: string): Promise<void> {
  if (shouldUseMockStore()) {
    mockTriggerAction(cardId, action);
    return;
  }

  await apiNoContent(
    `/api/boards/${getKanbanBoardId()}/tasks/${encodeURIComponent(cardId)}/actions/${encodeURIComponent(action)}`,
    {
      method: 'POST',
    },
  );
}
