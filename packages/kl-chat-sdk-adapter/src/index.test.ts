import { describe, it, expect, vi, beforeEach } from 'vitest'
import { KanbanClient } from './client'
import { createKanbanTools } from './tools'
import type { KanbanCard, KanbanComment, KanbanColumn, KanbanBoardInfo } from './types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchJson<T>(data: T, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({ ok: true, data }),
  } as unknown as Response)
}

function mockFetchError(error: string, status = 400) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({ ok: false, error }),
  } as unknown as Response)
}

const sampleCard: KanbanCard = {
  id: '1-test-card',
  title: 'Test Card',
  status: 'backlog',
  priority: 'medium',
  labels: ['bug'],
  content: '# Test Card\n\nSome description',
  comments: [],
}

const sampleComment: KanbanComment = {
  id: 'c1',
  author: 'agent',
  created: '2026-01-01T00:00:00.000Z',
  content: 'Hello world',
}

// ---------------------------------------------------------------------------
// KanbanClient tests
// ---------------------------------------------------------------------------

describe('KanbanClient', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('uses default config values', () => {
    const client = new KanbanClient()
    expect(client.baseUrl).toBe('http://localhost:3000')
    expect(client.boardId).toBe('default')
  })

  it('accepts custom config', () => {
    const client = new KanbanClient({
      baseUrl: 'https://my-server.example.com/',
      boardId: 'ops',
      apiToken: 'secret-123',
    })
    expect(client.baseUrl).toBe('https://my-server.example.com')
    expect(client.boardId).toBe('ops')
  })

  it('strips trailing slashes from baseUrl', () => {
    const client = new KanbanClient({ baseUrl: 'http://localhost:3000///' })
    expect(client.baseUrl).toBe('http://localhost:3000')
  })

  describe('listCards', () => {
    it('fetches cards from the API', async () => {
      const client = new KanbanClient({ baseUrl: 'http://test:3000' })
      globalThis.fetch = mockFetchJson([sampleCard])

      const cards = await client.listCards()
      expect(cards).toHaveLength(1)
      expect(cards[0].title).toBe('Test Card')
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://test:3000/api/boards/default/tasks',
        expect.objectContaining({ headers: expect.objectContaining({ 'Content-Type': 'application/json' }) }),
      )
    })

    it('passes status filter as query param', async () => {
      const client = new KanbanClient({ baseUrl: 'http://test:3000' })
      globalThis.fetch = mockFetchJson([])
      await client.listCards('in-progress')
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://test:3000/api/boards/default/tasks?status=in-progress',
        expect.any(Object),
      )
    })

    it('throws on API error', async () => {
      const client = new KanbanClient({ baseUrl: 'http://test:3000' })
      globalThis.fetch = mockFetchError('Board not found', 404)
      await expect(client.listCards()).rejects.toThrow('Board not found')
    })
  })

  describe('createCard', () => {
    it('sends content with markdown heading', async () => {
      const client = new KanbanClient({ baseUrl: 'http://test:3000' })
      globalThis.fetch = mockFetchJson(sampleCard)

      await client.createCard('My Card', 'Description here', 'high')
      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body)
      expect(body.content).toBe('# My Card\n\nDescription here')
      expect(body.priority).toBe('high')
    })

    it('includes labels and actions in the request', async () => {
      const client = new KanbanClient({ baseUrl: 'http://test:3000' })
      globalThis.fetch = mockFetchJson(sampleCard)

      await client.createCard('Card', undefined, 'low', {
        labels: ['urgent', 'frontend'],
        actions: ['deploy'],
      })
      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body)
      expect(body.labels).toEqual(['urgent', 'frontend'])
      expect(body.actions).toEqual(['deploy'])
    })
  })

  describe('getCard', () => {
    it('fetches a single card', async () => {
      const client = new KanbanClient({ baseUrl: 'http://test:3000' })
      globalThis.fetch = mockFetchJson(sampleCard)
      const card = await client.getCard('1-test')
      expect(card.id).toBe('1-test-card')
    })
  })

  describe('moveCard', () => {
    it('sends PATCH with status', async () => {
      const client = new KanbanClient({ baseUrl: 'http://test:3000' })
      globalThis.fetch = mockFetchJson({ ...sampleCard, status: 'done' })
      const card = await client.moveCard('1-test', 'done')
      expect(card.status).toBe('done')
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/move'),
        expect.objectContaining({ method: 'PATCH' }),
      )
    })
  })

  describe('addComment', () => {
    it('posts a comment', async () => {
      const client = new KanbanClient({ baseUrl: 'http://test:3000' })
      globalThis.fetch = mockFetchJson(sampleComment)
      const comment = await client.addComment('1-test', 'alice', 'Great work!')
      expect(comment.author).toBe('agent')
      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body)
      expect(body.author).toBe('alice')
      expect(body.content).toBe('Great work!')
    })
  })

  describe('streamComment', () => {
    it('sends plain text body with author query param', async () => {
      const client = new KanbanClient({ baseUrl: 'http://test:3000' })
      globalThis.fetch = mockFetchJson(sampleComment)
      await client.streamComment('1-test', 'bot', 'Streaming content')
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://test:3000/api/tasks/1-test/comments/stream?author=bot',
        expect.objectContaining({
          method: 'POST',
          body: 'Streaming content',
          headers: expect.objectContaining({ 'Content-Type': 'text/plain' }),
        }),
      )
    })
  })

  describe('auth header', () => {
    it('includes Authorization when apiToken is set', async () => {
      const client = new KanbanClient({ baseUrl: 'http://test:3000', apiToken: 'tok_abc' })
      globalThis.fetch = mockFetchJson([])
      await client.listCards()
      const headers = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].headers
      expect(headers['Authorization']).toBe('Bearer tok_abc')
    })

    it('omits Authorization when no apiToken', async () => {
      const client = new KanbanClient({ baseUrl: 'http://test:3000' })
      globalThis.fetch = mockFetchJson([])
      await client.listCards()
      const headers = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].headers
      expect(headers['Authorization']).toBeUndefined()
    })
  })
})

// ---------------------------------------------------------------------------
// Tool definitions tests
// ---------------------------------------------------------------------------

describe('createKanbanTools', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('returns an object with all expected tool names', () => {
    const tools = createKanbanTools({ baseUrl: 'http://test:3000' })
    const names = Object.keys(tools)
    expect(names).toContain('create_card')
    expect(names).toContain('list_cards')
    expect(names).toContain('get_card')
    expect(names).toContain('update_card')
    expect(names).toContain('move_card')
    expect(names).toContain('delete_card')
    expect(names).toContain('add_comment')
    expect(names).toContain('stream_comment')
    expect(names).toContain('list_comments')
    expect(names).toContain('submit_card_form')
    expect(names).toContain('trigger_card_action')
    expect(names).toContain('get_board')
    expect(names).toContain('list_columns')
  })

  it('each tool has description, parameters, and execute', () => {
    const tools = createKanbanTools({ baseUrl: 'http://test:3000' })
    for (const [name, t] of Object.entries(tools)) {
      expect(t).toHaveProperty('description')
      expect(t).toHaveProperty('parameters')
      expect(t).toHaveProperty('execute')
      expect(typeof (t as { execute: Function }).execute).toBe('function')
    }
  })

  it('accepts a KanbanClient instance directly', () => {
    const client = new KanbanClient({ baseUrl: 'http://custom:3000' })
    const tools = createKanbanTools(client)
    expect(Object.keys(tools).length).toBeGreaterThan(0)
  })

  describe('tool execute functions', () => {
    it('list_cards returns ok result on success', async () => {
      globalThis.fetch = mockFetchJson([sampleCard])
      const tools = createKanbanTools({ baseUrl: 'http://test:3000' })
      const result = await tools.list_cards.execute({ status: undefined }, { toolCallId: 'test', messages: [], abortSignal: undefined as unknown as AbortSignal })
      expect(result).toHaveProperty('ok', true)
      expect((result as { cards: unknown[] }).cards).toHaveLength(1)
    })

    it('list_cards returns error on failure', async () => {
      globalThis.fetch = mockFetchError('Server down', 500)
      const tools = createKanbanTools({ baseUrl: 'http://test:3000' })
      const result = await tools.list_cards.execute({ status: undefined }, { toolCallId: 'test', messages: [], abortSignal: undefined as unknown as AbortSignal })
      expect(result).toHaveProperty('ok', false)
      expect(result).toHaveProperty('error')
    })

    it('create_card returns card shape on success', async () => {
      globalThis.fetch = mockFetchJson(sampleCard)
      const tools = createKanbanTools({ baseUrl: 'http://test:3000' })
      const result = await tools.create_card.execute(
        { title: 'New', priority: 'high' as const },
        { toolCallId: 'test', messages: [], abortSignal: undefined as unknown as AbortSignal },
      )
      expect(result).toHaveProperty('ok', true)
      expect((result as { card: { id: string } }).card.id).toBe('1-test-card')
    })

    it('move_card returns updated status', async () => {
      globalThis.fetch = mockFetchJson({ ...sampleCard, status: 'done' })
      const tools = createKanbanTools({ baseUrl: 'http://test:3000' })
      const result = await tools.move_card.execute(
        { cardId: '1-test', status: 'done' },
        { toolCallId: 'test', messages: [], abortSignal: undefined as unknown as AbortSignal },
      )
      expect(result).toHaveProperty('ok', true)
      expect((result as { card: { status: string } }).card.status).toBe('done')
    })

    it('add_comment returns comment on success', async () => {
      globalThis.fetch = mockFetchJson(sampleComment)
      const tools = createKanbanTools({ baseUrl: 'http://test:3000' })
      const result = await tools.add_comment.execute(
        { cardId: '1-test', content: 'Note', author: 'bot' },
        { toolCallId: 'test', messages: [], abortSignal: undefined as unknown as AbortSignal },
      )
      expect(result).toHaveProperty('ok', true)
    })

    it('get_board returns board info', async () => {
      const board: KanbanBoardInfo = {
        id: 'default',
        name: 'Default Board',
        columns: [{ id: 'backlog', name: 'Backlog', color: '#ccc' }],
      }
      globalThis.fetch = mockFetchJson(board)
      const tools = createKanbanTools({ baseUrl: 'http://test:3000' })
      const result = await tools.get_board.execute(
        { boardId: undefined },
        { toolCallId: 'test', messages: [], abortSignal: undefined as unknown as AbortSignal },
      )
      expect(result).toHaveProperty('ok', true)
      expect((result as { board: KanbanBoardInfo }).board.name).toBe('Default Board')
    })

    it('list_columns returns columns', async () => {
      const columns: KanbanColumn[] = [
        { id: 'backlog', name: 'Backlog', color: '#ccc' },
        { id: 'done', name: 'Done', color: '#0f0' },
      ]
      globalThis.fetch = mockFetchJson(columns)
      const tools = createKanbanTools({ baseUrl: 'http://test:3000' })
      const result = await tools.list_columns.execute(
        { boardId: undefined },
        { toolCallId: 'test', messages: [], abortSignal: undefined as unknown as AbortSignal },
      )
      expect(result).toHaveProperty('ok', true)
      expect((result as { columns: KanbanColumn[] }).columns).toHaveLength(2)
    })
  })

  describe('options', () => {
    it('respects listLimit option', async () => {
      const manyCards = Array.from({ length: 10 }, (_, i) => ({
        ...sampleCard,
        id: `card-${i}`,
      }))
      globalThis.fetch = mockFetchJson(manyCards)
      const tools = createKanbanTools({ baseUrl: 'http://test:3000' }, { listLimit: 3 })
      const result = await tools.list_cards.execute(
        { status: undefined },
        { toolCallId: 'test', messages: [], abortSignal: undefined as unknown as AbortSignal },
      )
      expect((result as { count: number; cards: unknown[] }).count).toBe(10)
      expect((result as { cards: unknown[] }).cards).toHaveLength(3)
    })
  })
})

// ---------------------------------------------------------------------------
// Import / export tests
// ---------------------------------------------------------------------------

describe('package exports', () => {
  it('exports KanbanClient class', async () => {
    const mod = await import('./index')
    expect(mod.KanbanClient).toBeDefined()
    expect(typeof mod.KanbanClient).toBe('function')
  })

  it('exports createKanbanTools function', async () => {
    const mod = await import('./index')
    expect(mod.createKanbanTools).toBeDefined()
    expect(typeof mod.createKanbanTools).toBe('function')
  })
})

// Need to import afterEach at the top level
import { afterEach } from 'vitest'
