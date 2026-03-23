import { describe, it, expect, vi, beforeEach } from 'vitest'
import { KanbanTransportError } from '../types'
import { buildApiHeaders, normalizeResult, resolveApiRoute, throwApiError, DEFAULT_EVENT_CAPABILITIES } from '../normalize'
import { SdkTransport } from '../sdkAdapter'
import type { KanbanSdkLike } from '../sdkAdapter'
import { ApiTransport } from '../apiAdapter'
import type { FetchFn } from '../apiAdapter'

// ---------------------------------------------------------------------------
// normalize helpers
// ---------------------------------------------------------------------------

describe('normalizeResult', () => {
  it('wraps data without statusCode when omitted', () => {
    const result = normalizeResult({ id: '1' })
    expect(result.data).toEqual({ id: '1' })
    expect(result.statusCode).toBeUndefined()
  })

  it('includes statusCode when provided', () => {
    const result = normalizeResult(['a', 'b'], 200)
    expect(result.data).toEqual(['a', 'b'])
    expect(result.statusCode).toBe(200)
  })
})

describe('buildApiHeaders', () => {
  it('returns content-type and accept for authMode none', () => {
    const h = buildApiHeaders({ baseUrl: 'http://x', authMode: 'none' })
    expect(h['Content-Type']).toBe('application/json')
    expect(h['Accept']).toBe('application/json')
    expect(h['Authorization']).toBeUndefined()
  })

  it('adds Authorization header for bearerToken', () => {
    const h = buildApiHeaders({ baseUrl: 'http://x', authMode: 'bearerToken', token: 'mytoken' })
    expect(h['Authorization']).toBe('Bearer mytoken')
  })

  it('adds custom header for apiKey', () => {
    const h = buildApiHeaders({ baseUrl: 'http://x', authMode: 'apiKey', token: 'key123', apiKeyHeader: 'X-Custom-Key' })
    expect(h['X-Custom-Key']).toBe('key123')
    expect(h['Authorization']).toBeUndefined()
  })

  it('uses default X-Api-Key when apiKeyHeader is omitted', () => {
    const h = buildApiHeaders({ baseUrl: 'http://x', authMode: 'apiKey', token: 'k' })
    expect(h['X-Api-Key']).toBe('k')
  })
})

describe('throwApiError', () => {
  it('parses error field from JSON body', () => {
    expect(() => throwApiError(400, JSON.stringify({ error: 'Bad input' }))).toThrow('Bad input')
  })

  it('uses HTTP status code in KanbanTransportError', () => {
    try {
      throwApiError(404, '{}')
    } catch (err) {
      expect(err).toBeInstanceOf(KanbanTransportError)
      expect((err as KanbanTransportError).statusCode).toBe(404)
      expect((err as KanbanTransportError).code).toBe('transport.not_found')
    }
  })

  it('maps 401 to transport.unauthorized', () => {
    expect(() => throwApiError(401, '')).toThrowError()
    try { throwApiError(401, '') } catch (e) {
      expect((e as KanbanTransportError).code).toBe('transport.unauthorized')
    }
  })

  it('maps 500 to transport.server_error', () => {
    try { throwApiError(500, '') } catch (e) {
      expect((e as KanbanTransportError).code).toBe('transport.server_error')
    }
  })
})

describe('resolveApiRoute', () => {
  const base = 'http://localhost:3000'

  it('maps card/list to GET /api/cards', () => {
    const r = resolveApiRoute(base, 'card', 'list', {})
    expect(r?.method).toBe('GET')
    expect(r?.url).toBe('http://localhost:3000/api/cards')
  })

  it('maps card/create to POST /api/cards with body', () => {
    const r = resolveApiRoute(base, 'card', 'create', { title: 'Task 1' })
    expect(r?.method).toBe('POST')
    expect(r?.url).toBe('http://localhost:3000/api/cards')
    expect(r?.body).toMatchObject({ title: 'Task 1' })
  })

  it('maps board/delete to DELETE /api/boards/:id', () => {
    const r = resolveApiRoute(base, 'board', 'delete', { id: 'b1' })
    expect(r?.method).toBe('DELETE')
    expect(r?.url).toBe('http://localhost:3000/api/boards/b1')
  })

  it('returns undefined for unknown operation', () => {
    expect(resolveApiRoute(base, 'unknown', 'foo', {})).toBeUndefined()
  })

  it('maps webhook/create to POST /api/webhooks', () => {
    const r = resolveApiRoute(base, 'webhook', 'create', { url: 'http://n8n/hook', events: ['task.created'] })
    expect(r?.method).toBe('POST')
    expect(r?.url).toBe('http://localhost:3000/api/webhooks')
  })

  it('strips trailing slash from baseUrl', () => {
    const r = resolveApiRoute('http://localhost:3000/', 'board', 'list', {})
    expect(r?.url).toBe('http://localhost:3000/api/boards')
  })
})

// ---------------------------------------------------------------------------
// DEFAULT_EVENT_CAPABILITIES
// ---------------------------------------------------------------------------

describe('DEFAULT_EVENT_CAPABILITIES', () => {
  it('contains after-events with apiAfter=true', () => {
    const afterEvents = DEFAULT_EVENT_CAPABILITIES.filter(e => e.apiAfter)
    expect(afterEvents.length).toBeGreaterThan(0)
    expect(afterEvents.every(e => !e.sdkBefore)).toBe(true)
  })

  it('contains before-events with sdkBefore=true and apiAfter=false', () => {
    const beforeEvents = DEFAULT_EVENT_CAPABILITIES.filter(e => e.sdkBefore)
    expect(beforeEvents.length).toBeGreaterThan(0)
    expect(beforeEvents.every(e => !e.apiAfter)).toBe(true)
  })

  it('includes task.created as apiAfter', () => {
    const entry = DEFAULT_EVENT_CAPABILITIES.find(e => e.event === 'task.created')
    expect(entry?.apiAfter).toBe(true)
    expect(entry?.sdkBefore).toBe(false)
  })

  it('includes card.create as sdkBefore only', () => {
    const entry = DEFAULT_EVENT_CAPABILITIES.find(e => e.event === 'card.create')
    expect(entry?.sdkBefore).toBe(true)
    expect(entry?.apiAfter).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// SdkTransport
// ---------------------------------------------------------------------------

function makeMockSdk(): KanbanSdkLike {
  return {
    on: vi.fn().mockReturnValue(() => { /* noop unsub */ }),
    off: vi.fn(),
    listBoards: vi.fn().mockResolvedValue([]),
    getBoard: vi.fn().mockResolvedValue({ id: 'b1' }),
    createBoard: vi.fn().mockResolvedValue({ id: 'b2' }),
    updateBoard: vi.fn().mockResolvedValue({ id: 'b1' }),
    deleteBoard: vi.fn().mockResolvedValue(null),
    setDefaultBoard: vi.fn().mockResolvedValue(null),
    triggerBoardAction: vi.fn().mockResolvedValue(null),
    listCards: vi.fn().mockResolvedValue([]),
    getCard: vi.fn().mockResolvedValue({ id: 'c1' }),
    createCard: vi.fn().mockResolvedValue({ id: 'c2' }),
    updateCard: vi.fn().mockResolvedValue({ id: 'c1' }),
    moveCard: vi.fn().mockResolvedValue({ id: 'c1' }),
    deleteCard: vi.fn().mockResolvedValue(null),
    transferCard: vi.fn().mockResolvedValue(null),
    purgeDeletedCards: vi.fn().mockResolvedValue(null),
    triggerCardAction: vi.fn().mockResolvedValue(null),
    listComments: vi.fn().mockResolvedValue([]),
    addComment: vi.fn().mockResolvedValue({ id: 'cm1' }),
    updateComment: vi.fn().mockResolvedValue({ id: 'cm1' }),
    deleteComment: vi.fn().mockResolvedValue(null),
    listAttachments: vi.fn().mockResolvedValue([]),
    addAttachment: vi.fn().mockResolvedValue(null),
    removeAttachment: vi.fn().mockResolvedValue(null),
    listColumns: vi.fn().mockResolvedValue([]),
    addColumn: vi.fn().mockResolvedValue({ id: 'col1' }),
    updateColumn: vi.fn().mockResolvedValue({ id: 'col1' }),
    removeColumn: vi.fn().mockResolvedValue(null),
    reorderColumns: vi.fn().mockResolvedValue(null),
    setMinimizedColumns: vi.fn().mockResolvedValue(null),
    cleanupColumn: vi.fn().mockResolvedValue(null),
    listLabels: vi.fn().mockResolvedValue([]),
    setLabel: vi.fn().mockResolvedValue(null),
    renameLabel: vi.fn().mockResolvedValue(null),
    deleteLabel: vi.fn().mockResolvedValue(null),
    getSettings: vi.fn().mockResolvedValue({}),
    updateSettings: vi.fn().mockResolvedValue({}),
    getStorageStatus: vi.fn().mockReturnValue({ storageEngine: 'markdown' }),
    migrateToSqlite: vi.fn().mockResolvedValue(null),
    migrateToMarkdown: vi.fn().mockResolvedValue(null),
    listWebhooks: vi.fn().mockResolvedValue([]),
    createWebhook: vi.fn().mockResolvedValue({ id: 'wh1' }),
    updateWebhook: vi.fn().mockResolvedValue({ id: 'wh1' }),
    deleteWebhook: vi.fn().mockResolvedValue(null),
    getAuthStatus: vi.fn().mockReturnValue({ identityProvider: 'noop', policyProvider: 'noop' }),
  }
}

describe('SdkTransport', () => {
  let sdk: KanbanSdkLike
  let transport: SdkTransport

  beforeEach(() => {
    sdk = makeMockSdk()
    transport = new SdkTransport({ sdk })
  })

  it('has mode === sdk', () => {
    expect(transport.mode).toBe('sdk')
  })

  describe('canSubscribe', () => {
    it('returns true for after-events', () => {
      expect(transport.canSubscribe('task.created')).toBe(true)
    })

    it('returns true for before-events (SDK mode)', () => {
      expect(transport.canSubscribe('card.create')).toBe(true)
    })

    it('returns false for unknown events', () => {
      expect(transport.canSubscribe('unknown.event')).toBe(false)
    })
  })

  describe('subscribe', () => {
    it('calls sdk.on with the event name and handler', async () => {
      const handler = vi.fn()
      const reg = await transport.subscribe('task.created', handler)
      expect(sdk.on).toHaveBeenCalledWith('task.created', handler)
      expect(reg.id).toContain('sdk:task.created')
    })

    it('dispose() calls the unsub function returned by sdk.on', async () => {
      const unsub = vi.fn()
      ;(sdk.on as ReturnType<typeof vi.fn>).mockReturnValue(unsub)
      const reg = await transport.subscribe('task.created', vi.fn())
      await reg.dispose()
      expect(unsub).toHaveBeenCalledOnce()
    })

    it('dispose() is idempotent', async () => {
      const unsub = vi.fn()
      ;(sdk.on as ReturnType<typeof vi.fn>).mockReturnValue(unsub)
      const reg = await transport.subscribe('task.created', vi.fn())
      await reg.dispose()
      await reg.dispose()
      expect(unsub).toHaveBeenCalledOnce()
    })

    it('throws for unknown event names', async () => {
      await expect(transport.subscribe('not.an.event', vi.fn())).rejects.toThrow(KanbanTransportError)
    })
  })

  describe('execute', () => {
    it('routes board/list to sdk.listBoards()', async () => {
      const result = await transport.execute('board', 'list', {})
      expect(sdk.listBoards).toHaveBeenCalled()
      expect(result.data).toEqual([])
    })

    it('routes card/create to sdk.createCard with params', async () => {
      await transport.execute('card', 'create', { content: 'New task', boardId: 'b1' })
      expect(sdk.createCard).toHaveBeenCalledWith(expect.objectContaining({ content: 'New task' }), 'b1')
    })

    it('routes settings/get to sdk.getSettings', async () => {
      await transport.execute('settings', 'get', { boardId: 'b1' })
      expect(sdk.getSettings).toHaveBeenCalledWith('b1')
    })

    it('routes auth/getStatus to sdk.getAuthStatus', async () => {
      const r = await transport.execute('auth', 'getStatus', {})
      expect(sdk.getAuthStatus).toHaveBeenCalled()
      expect(r.data).toMatchObject({ identityProvider: 'noop' })
    })

    it('throws KanbanTransportError for unsupported operations', async () => {
      await expect(transport.execute('unknown', 'foo', {})).rejects.toThrow(KanbanTransportError)
      await expect(transport.execute('unknown', 'foo', {})).rejects.toMatchObject({
        code: 'transport.unsupported_operation',
      })
    })

    it('normalizes result without statusCode for SDK adapter', async () => {
      const r = await transport.execute('board', 'list', {})
      expect(r.statusCode).toBeUndefined()
    })
  })
})

// ---------------------------------------------------------------------------
// ApiTransport
// ---------------------------------------------------------------------------

function makeOkFetch(body: unknown, status = 200): FetchFn {
  return vi.fn().mockResolvedValue({
    ok: true,
    status,
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
    json: vi.fn().mockResolvedValue(body),
  })
}

function makeErrorFetch(status: number, bodyText = ''): FetchFn {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    text: vi.fn().mockResolvedValue(bodyText),
    json: vi.fn().mockRejectedValue(new Error('not json')),
  })
}

describe('ApiTransport', () => {
  const creds = { baseUrl: 'http://localhost:3000', authMode: 'none' as const }

  it('has mode === api', () => {
    const t = new ApiTransport({ credentials: creds, fetchFn: makeOkFetch([]) })
    expect(t.mode).toBe('api')
  })

  describe('canSubscribe', () => {
    it('returns true for after-events (apiAfter=true)', () => {
      const t = new ApiTransport({ credentials: creds, fetchFn: makeOkFetch([]) })
      expect(t.canSubscribe('task.created')).toBe(true)
    })

    it('returns false for before-events (sdkBefore only)', () => {
      const t = new ApiTransport({ credentials: creds, fetchFn: makeOkFetch([]) })
      expect(t.canSubscribe('card.create')).toBe(false)
    })

    it('returns false for unknown events', () => {
      const t = new ApiTransport({ credentials: creds, fetchFn: makeOkFetch([]) })
      expect(t.canSubscribe('unknown.event')).toBe(false)
    })
  })

  describe('subscribe – before-event explicit failure', () => {
    it('throws with code transport.unsupported_event for sdkBefore events', async () => {
      const t = new ApiTransport({ credentials: creds, fetchFn: makeOkFetch({}) })
      await expect(
        t.subscribe('card.create', vi.fn(), { callbackUrl: 'http://n8n/hook' }),
      ).rejects.toMatchObject({
        code: 'transport.unsupported_event',
        message: expect.stringContaining('before-event'),
      })
    })

    it('error message instructs user to switch to SDK mode or use after-event', async () => {
      const t = new ApiTransport({ credentials: creds, fetchFn: makeOkFetch({}) })
      try {
        await t.subscribe('card.create', vi.fn(), { callbackUrl: 'http://n8n/hook' })
      } catch (err) {
        expect((err as KanbanTransportError).message).toContain('SDK transport')
      }
    })
  })

  describe('subscribe – API webhook registration', () => {
    it('POSTs to /api/webhooks with event and callbackUrl', async () => {
      const fetchFn = makeOkFetch({ id: 'wh-123' })
      const t = new ApiTransport({ credentials: creds, fetchFn })
      await t.subscribe('task.created', vi.fn(), { callbackUrl: 'http://n8n/webhook/abc' })
      expect(fetchFn).toHaveBeenCalledWith(
        'http://localhost:3000/api/webhooks',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"task.created"'),
        }),
      )
    })

    it('includes the callbackUrl in the POST body', async () => {
      const fetchFn = makeOkFetch({ id: 'wh-456' })
      const t = new ApiTransport({ credentials: creds, fetchFn })
      await t.subscribe('task.updated', vi.fn(), { callbackUrl: 'http://n8n/webhook/xyz' })
      const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(init.body as string) as Record<string, unknown>
      expect(body['url']).toBe('http://n8n/webhook/xyz')
    })

    it('includes secret when provided', async () => {
      const fetchFn = makeOkFetch({ id: 'wh-789' })
      const t = new ApiTransport({ credentials: creds, fetchFn })
      await t.subscribe('task.deleted', vi.fn(), { callbackUrl: 'http://n8n/hook', secret: 'mysecret' })
      const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(init.body as string) as Record<string, unknown>
      expect(body['secret']).toBe('mysecret')
    })

    it('throws when callbackUrl is missing', async () => {
      const t = new ApiTransport({ credentials: creds, fetchFn: makeOkFetch({}) })
      await expect(t.subscribe('task.created', vi.fn())).rejects.toMatchObject({
        code: 'transport.missing_callback_url',
      })
    })

    it('returns registration with id containing event and webhook id', async () => {
      const fetchFn = makeOkFetch({ id: 'wh-999' })
      const t = new ApiTransport({ credentials: creds, fetchFn })
      const reg = await t.subscribe('task.created', vi.fn(), { callbackUrl: 'http://n8n/hook' })
      expect(reg.id).toContain('api:task.created:wh-999')
      expect(reg.externalId).toBe('wh-999')
    })
  })

  describe('subscribe – dispose lifecycle', () => {
    it('dispose() DELETEs the registered webhook', async () => {
      const fetchFn = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 201, text: vi.fn().mockResolvedValue(JSON.stringify({ id: 'wh-del' })), json: vi.fn().mockResolvedValue({ id: 'wh-del' }) })
        .mockResolvedValueOnce({ ok: true, status: 204, text: vi.fn().mockResolvedValue(''), json: vi.fn().mockResolvedValue({}) })
      const t = new ApiTransport({ credentials: creds, fetchFn: fetchFn as FetchFn })
      const reg = await t.subscribe('task.created', vi.fn(), { callbackUrl: 'http://n8n/hook' })
      await reg.dispose()
      expect(fetchFn).toHaveBeenCalledTimes(2)
      const [deleteUrl, deleteInit] = fetchFn.mock.calls[1] as [string, RequestInit]
      expect(deleteUrl).toContain('/api/webhooks/wh-del')
      expect(deleteInit.method).toBe('DELETE')
    })

    it('dispose() is idempotent (only one DELETE call)', async () => {
      const fetchFn = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 201, text: vi.fn().mockResolvedValue(JSON.stringify({ id: 'wh-idem' })), json: vi.fn().mockResolvedValue({ id: 'wh-idem' }) })
        .mockResolvedValue({ ok: true, status: 204, text: vi.fn().mockResolvedValue(''), json: vi.fn().mockResolvedValue({}) })
      const t = new ApiTransport({ credentials: creds, fetchFn: fetchFn as FetchFn })
      const reg = await t.subscribe('task.created', vi.fn(), { callbackUrl: 'http://n8n/hook' })
      await reg.dispose()
      await reg.dispose()
      expect(fetchFn).toHaveBeenCalledTimes(2) // POST + one DELETE
    })

    it('dispose() tolerates 404 (webhook already removed)', async () => {
      const fetchFn = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 201, text: vi.fn().mockResolvedValue(JSON.stringify({ id: 'wh-gone' })), json: vi.fn().mockResolvedValue({ id: 'wh-gone' }) })
        .mockResolvedValueOnce({ ok: false, status: 404, text: vi.fn().mockResolvedValue('not found'), json: vi.fn().mockRejectedValue(new Error()) })
      const t = new ApiTransport({ credentials: creds, fetchFn: fetchFn as FetchFn })
      const reg = await t.subscribe('task.created', vi.fn(), { callbackUrl: 'http://n8n/hook' })
      await expect(reg.dispose()).resolves.toBeUndefined()
    })
  })

  describe('execute', () => {
    it('calls fetch with correct URL and method for card/list', async () => {
      const fetchFn = makeOkFetch([{ id: 'c1' }])
      const t = new ApiTransport({ credentials: creds, fetchFn })
      const r = await t.execute('card', 'list', {})
      expect(fetchFn).toHaveBeenCalledWith('http://localhost:3000/api/cards', expect.objectContaining({ method: 'GET' }))
      expect(r.statusCode).toBe(200)
    })

    it('sends body for POST operations', async () => {
      const fetchFn = makeOkFetch({ id: 'c2' }, 201)
      const t = new ApiTransport({ credentials: creds, fetchFn })
      await t.execute('card', 'create', { content: 'Hello' })
      const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body as string)).toMatchObject({ content: 'Hello' })
    })

    it('sends Authorization header for bearerToken auth', async () => {
      const fetchFn = makeOkFetch([])
      const t = new ApiTransport({
        credentials: { baseUrl: 'http://server', authMode: 'bearerToken', token: 't123' },
        fetchFn,
      })
      await t.execute('card', 'list', {})
      const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
      expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer t123')
    })

    it('throws KanbanTransportError on HTTP 404', async () => {
      const t = new ApiTransport({ credentials: creds, fetchFn: makeErrorFetch(404, JSON.stringify({ error: 'Not found' })) })
      await expect(t.execute('card', 'get', { id: 'nope' })).rejects.toMatchObject({
        code: 'transport.not_found',
        statusCode: 404,
      })
    })

    it('throws KanbanTransportError for unmapped operations', async () => {
      const t = new ApiTransport({ credentials: creds, fetchFn: makeOkFetch({}) })
      await expect(t.execute('ghost', 'ops', {})).rejects.toMatchObject({
        code: 'transport.unsupported_operation',
      })
    })

    it('returns null data for 204 No Content', async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        text: vi.fn().mockResolvedValue(''),
        json: vi.fn().mockResolvedValue({}),
      })
      const t = new ApiTransport({ credentials: creds, fetchFn: fetchFn as FetchFn })
      const r = await t.execute('card', 'delete', { id: 'c1' })
      expect(r.data).toBeNull()
      expect(r.statusCode).toBe(204)
    })
  })

  describe('parity: SdkTransport and ApiTransport implement same interface', () => {
    it('both have execute, subscribe, canSubscribe, mode', () => {
      const sdk = new SdkTransport({ sdk: makeMockSdk() })
      const api = new ApiTransport({ credentials: creds, fetchFn: makeOkFetch({}) })
      for (const t of [sdk, api] as const) {
        expect(typeof t.execute).toBe('function')
        expect(typeof t.subscribe).toBe('function')
        expect(typeof t.canSubscribe).toBe('function')
        expect(typeof t.mode).toBe('string')
      }
    })

    it('sdk returns after-events as canSubscribe=true; api does same', () => {
      const sdk = new SdkTransport({ sdk: makeMockSdk() })
      const api = new ApiTransport({ credentials: creds, fetchFn: makeOkFetch({}) })
      expect(sdk.canSubscribe('task.created')).toBe(true)
      expect(api.canSubscribe('task.created')).toBe(true)
    })

    it('sdk returns before-events as canSubscribe=true; api returns false', () => {
      const sdk = new SdkTransport({ sdk: makeMockSdk() })
      const api = new ApiTransport({ credentials: creds, fetchFn: makeOkFetch({}) })
      expect(sdk.canSubscribe('card.create')).toBe(true)
      expect(api.canSubscribe('card.create')).toBe(false)
    })
  })
})
