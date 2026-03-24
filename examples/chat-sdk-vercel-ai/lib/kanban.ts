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

export interface KanbanTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  body?: string;
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
  const json: ApiEnvelope<T> = await res.json();
  if (!json.ok) {
    throw new Error(json.error ?? `kanban-lite API error ${res.status} – ${url}`);
  }
  return json.data;
}

// ---------------------------------------------------------------------------
// In-memory mock (KANBAN_USE_MOCK=true)
// Used for demos or UI development when the kanban-lite server is unavailable.
// ---------------------------------------------------------------------------

const mockStore: KanbanTask[] = [];
let mockSeq = 0;

function mockCreate(
  title: string,
  description: string | undefined,
  priority: string,
): KanbanTask {
  const task: KanbanTask = {
    id: `mock-${++mockSeq}`,
    title,
    status: 'backlog',
    priority,
    body: description,
  };
  mockStore.push(task);
  return task;
}

function mockList(status?: string): KanbanTask[] {
  return status ? mockStore.filter((t) => t.status === status) : [...mockStore];
}

function mockMove(idFragment: string, status: string): KanbanTask {
  const task = mockStore.find(
    (t) => t.id === idFragment || t.id.startsWith(idFragment),
  );
  if (!task) throw new Error(`No mock task found matching id: ${idFragment}`);
  task.status = status;
  return task;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a new task on the kanban board.
 *
 * The kanban-lite API derives a task's title from the first Markdown `# heading`
 * in the `content` field — this wrapper builds that content string automatically.
 */
export async function createTask(
  title: string,
  description: string | undefined,
  priority = 'medium',
): Promise<KanbanTask> {
  if (USE_MOCK) return mockCreate(title, description, priority);

  const content = description ? `# ${title}\n\n${description}` : `# ${title}`;
  return apiFetch<KanbanTask>(`/api/boards/${KANBAN_BOARD_ID}/tasks`, {
    method: 'POST',
    body: JSON.stringify({ content, priority }),
  });
}

/**
 * List tasks from the kanban board, optionally filtered by status column.
 */
export async function listTasks(status?: string): Promise<KanbanTask[]> {
  if (USE_MOCK) return mockList(status);

  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  return apiFetch<KanbanTask[]>(`/api/boards/${KANBAN_BOARD_ID}/tasks${qs}`);
}

/**
 * Move a task to a different status column.
 * The `taskId` supports partial ID matching (kanban-lite resolves it server-side).
 */
export async function moveTask(taskId: string, status: string): Promise<KanbanTask> {
  if (USE_MOCK) return mockMove(taskId, status);

  return apiFetch<KanbanTask>(
    `/api/boards/${KANBAN_BOARD_ID}/tasks/${encodeURIComponent(taskId)}/move`,
    {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    },
  );
}
