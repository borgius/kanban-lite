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
 *   PATCH  /api/boards/:boardId/tasks/:id/move  – move task to a column
 */

export interface KanbanCard {
  id: string;
  title: string;
  status: string;
  priority: string;
  body?: string;
  content?: string;
}

interface ApiEnvelope<T> {
  ok: boolean;
  data: T;
  error?: string;
}

const KANBAN_API_URL = process.env.KANBAN_API_URL ?? 'http://localhost:3000';
const KANBAN_BOARD_ID = process.env.KANBAN_BOARD_ID ?? 'default';
const KANBAN_API_TOKEN = process.env.KANBAN_API_TOKEN;
const USE_MOCK = process.env.KANBAN_USE_MOCK === 'true';

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
    ...(body ? { body } : {}),
    ...(card.content ? { content: card.content } : {}),
  };
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (KANBAN_API_TOKEN) {
    headers['Authorization'] = `Bearer ${KANBAN_API_TOKEN}`;
  }
  return headers;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${KANBAN_API_URL}${path}`;
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

// ---------------------------------------------------------------------------
// In-memory mock (KANBAN_USE_MOCK=true)
// Used for demos or UI development when the kanban-lite server is unavailable.
// ---------------------------------------------------------------------------

const mockStore: KanbanCard[] = [];
let mockSeq = 0;

function mockCreate(
  title: string,
  description: string | undefined,
  priority: string,
): KanbanCard {
  const card: KanbanCard = {
    id: `mock-${++mockSeq}`,
    title,
    status: 'backlog',
    priority,
    body: description,
  };
  mockStore.push(card);
  return card;
}

function mockList(status?: string): KanbanCard[] {
  return status ? mockStore.filter((t) => t.status === status) : [...mockStore];
}

function mockMove(idFragment: string, status: string): KanbanCard {
  const card = mockStore.find(
    (t) => t.id === idFragment || t.id.startsWith(idFragment),
  );
  if (!card) throw new Error(`No mock card found matching id: ${idFragment}`);
  card.status = status;
  return card;
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
): Promise<KanbanCard> {
  if (USE_MOCK) return mockCreate(title, description, priority);

  const content = description ? `# ${title}\n\n${description}` : `# ${title}`;
  const card = await apiFetch<KanbanCard>(`/api/boards/${KANBAN_BOARD_ID}/tasks`, {
    method: 'POST',
    body: JSON.stringify({ content, priority }),
  });

  return normalizeCard(card);
}

/**
 * List cards from the kanban board, optionally filtered by status column.
 */
export async function listCards(status?: string): Promise<KanbanCard[]> {
  if (USE_MOCK) return mockList(status);

  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  const cards = await apiFetch<KanbanCard[]>(`/api/boards/${KANBAN_BOARD_ID}/tasks${qs}`);
  return cards.map((card) => normalizeCard(card));
}

/**
 * Move a card to a different status column.
 * The `cardId` supports partial ID matching (kanban-lite resolves it server-side).
 */
export async function moveCard(cardId: string, status: string): Promise<KanbanCard> {
  if (USE_MOCK) return mockMove(cardId, status);

  const card = await apiFetch<KanbanCard>(
    `/api/boards/${KANBAN_BOARD_ID}/tasks/${encodeURIComponent(cardId)}/move`,
    {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    },
  );

  return normalizeCard(card);
}
