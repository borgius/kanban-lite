/**
 * Shared mock SDK factory for unit tests.
 */

import { vi } from 'vitest'
import type { KanbanSDK } from 'kl-langchain-tools'

export function createMockSDK(): KanbanSDK & Record<string, any> {
  return {
    workspaceRoot: '/tmp/test-workspace',
    init: vi.fn().mockResolvedValue(undefined),

    // Board
    listBoards: vi.fn().mockReturnValue([{ id: 'default', name: 'Default Board' }]),
    getBoard: vi.fn().mockReturnValue({ id: 'default', name: 'Default Board', columns: [] }),
    createBoard: vi.fn().mockReturnValue({ id: 'sprint-1', name: 'Sprint 1' }),
    deleteBoard: vi.fn(),
    updateBoard: vi.fn().mockReturnValue({ id: 'default', name: 'Updated' }),
    getBoardActions: vi.fn().mockReturnValue({ deploy: 'Deploy to prod' }),

    // Card
    listCards: vi.fn().mockResolvedValue([
      {
        id: '1', content: '# Fix auth bug\n\nDetails', status: 'todo', priority: 'high',
        assignee: 'alice', labels: ['bug'], dueDate: '2025-12-31',
        comments: [{ id: 'c1', author: 'alice', content: 'Hello', created: '2025-01-01T00:00:00Z' }],
        created: '2025-01-01T00:00:00Z', modified: '2025-01-02T00:00:00Z',
      },
      {
        id: '2', content: '# Add dark mode', status: 'backlog', priority: 'medium',
        assignee: 'bob', labels: ['feature'], dueDate: null, comments: [],
        created: '2025-01-03T00:00:00Z', modified: '2025-01-03T00:00:00Z',
      },
    ]),
    getCard: vi.fn().mockResolvedValue({
      id: '1', content: '# Fix auth bug\n\nDetails', status: 'todo', priority: 'high',
      assignee: 'alice', labels: ['bug'], comments: [],
    }),
    createCard: vi.fn().mockResolvedValue({ id: '3', status: 'todo', created: '2025-01-01T00:00:00Z' }),
    updateCard: vi.fn().mockResolvedValue({ id: '1', modified: '2025-01-02T00:00:00Z' }),
    moveCard: vi.fn().mockResolvedValue({ id: '1', status: 'done', modified: '2025-01-02T00:00:00Z' }),
    deleteCard: vi.fn().mockResolvedValue(undefined),
    triggerAction: vi.fn().mockResolvedValue({ success: true }),
    getCardsByStatus: vi.fn().mockResolvedValue([
      { id: '1', content: '# Fix auth bug', status: 'todo', priority: 'high', assignee: 'alice', labels: ['bug'] },
    ]),
    getUniqueAssignees: vi.fn().mockResolvedValue(['alice', 'bob']),
    getUniqueLabels: vi.fn().mockResolvedValue(['bug', 'feature']),

    // Comment
    listComments: vi.fn().mockResolvedValue([
      { id: 'c1', author: 'alice', content: 'Hello', created: '2025-01-01T00:00:00Z' },
    ]),
    addComment: vi.fn().mockResolvedValue({
      comments: [{ id: 'c1', author: 'bot', content: 'Hello', created: '2025-01-01T00:00:00Z' }],
    }),
    updateComment: vi.fn().mockResolvedValue({
      comments: [{ id: 'c1', author: 'bot', content: 'Updated', created: '2025-01-01T00:00:00Z' }],
    }),
    deleteComment: vi.fn().mockResolvedValue({ comments: [] }),
    streamComment: vi.fn().mockResolvedValue({
      comments: [{ id: 'c2', author: 'agent', content: 'Streamed text', created: '2025-01-01T00:00:00Z' }],
    }),

    // Column
    listColumns: vi.fn().mockReturnValue([
      { id: 'todo', name: 'To Do', color: '#3b82f6' },
      { id: 'in-progress', name: 'In Progress', color: '#f59e0b' },
      { id: 'done', name: 'Done', color: '#22c55e' },
    ]),
    addColumn: vi.fn().mockReturnValue({ id: 'testing', name: 'QA' }),
    updateColumn: vi.fn().mockReturnValue({ id: 'todo', name: 'Backlog' }),
    removeColumn: vi.fn(),
    reorderColumns: vi.fn(),

    // Label
    getLabels: vi.fn().mockReturnValue({ bug: { color: '#ef4444' }, feature: { color: '#22c55e' } }),
    setLabel: vi.fn(),
    deleteLabel: vi.fn(),
    renameLabel: vi.fn(),
    filterCardsByLabelGroup: vi.fn().mockResolvedValue([
      { id: '1', content: '# Fix auth bug', labels: ['bug'] },
    ]),

    // Attachment
    listAttachments: vi.fn().mockResolvedValue(['screenshot.png']),
    addAttachment: vi.fn().mockResolvedValue({ filename: 'file.txt', cardId: '1' }),
    removeAttachment: vi.fn().mockResolvedValue(undefined),

    // Log
    listLogs: vi.fn().mockResolvedValue([
      { timestamp: '2025-01-01T00:00:00Z', source: 'ci', text: 'Build passed' },
    ]),
    addLog: vi.fn().mockResolvedValue({ timestamp: '2025-01-01T00:00:00Z', source: 'agent', text: 'Deployed' }),
    clearLogs: vi.fn().mockResolvedValue(undefined),
    listBoardLogs: vi.fn().mockResolvedValue([]),
    addBoardLog: vi.fn().mockResolvedValue({
      timestamp: '2025-01-01T00:00:00Z', source: 'system', text: 'Sprint started',
    }),
    clearBoardLogs: vi.fn().mockResolvedValue(undefined),

    // Settings
    getSettings: vi.fn().mockReturnValue({ zoom: 1 }),
    updateSettings: vi.fn(),
  }
}
