import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  watchMock: vi.fn(),
  broadcastMock: vi.fn(),
  buildInitMessageMock: vi.fn(),
  broadcastCardContentToEditingClientsMock: vi.fn(),
  getClientsEditingCardMock: vi.fn(),
  loadCardsMock: vi.fn(),
}))

vi.mock('chokidar', () => ({
  default: {
    watch: mocks.watchMock,
  },
}))

vi.mock('./broadcastService', () => ({
  broadcast: mocks.broadcastMock,
  broadcastCardContentToEditingClients: mocks.broadcastCardContentToEditingClientsMock,
  buildInitMessage: mocks.buildInitMessageMock,
  getClientsEditingCard: mocks.getClientsEditingCardMock,
  loadCards: mocks.loadCardsMock,
}))

import { setupWatcher } from './watcherSetup'

type MockWatcher = {
  on: (event: string, handler: (...args: unknown[]) => void) => MockWatcher
  close: ReturnType<typeof vi.fn>
  emit: (event: string, ...args: unknown[]) => void
}

function createMockWatcher(): MockWatcher {
  const emitter = new EventEmitter()

  return {
    on(event: string, handler: (...args: unknown[]) => void): MockWatcher {
      emitter.on(event, handler as (...args: any[]) => void)
      return this
    },
    close: vi.fn(),
    emit(event: string, ...args: unknown[]): void {
      emitter.emit(event, ...args)
    },
  }
}

function createContext() {
  return {
    absoluteKanbanDir: '/tmp/kanban-light-watch-test/.kanban',
    workspaceRoot: '/tmp/kanban-light-watch-test',
    sdk: {
      getLocalCardPath: vi.fn(() => undefined),
      getStorageStatus: vi.fn(() => ({ watchGlob: 'boards/**/*.md' })),
      close: vi.fn(),
    },
    wss: {
      close: vi.fn(),
      clients: new Set(),
    },
    cards: [],
    migrating: false,
    suppressWatcherEventsUntil: 0,
    lastWrittenContent: '',
  }
}

describe('setupWatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.watchMock.mockReset()
    mocks.broadcastMock.mockReset()
    mocks.buildInitMessageMock.mockReset()
    mocks.broadcastCardContentToEditingClientsMock.mockReset()
    mocks.getClientsEditingCardMock.mockReset()
    mocks.loadCardsMock.mockReset()

    mocks.buildInitMessageMock.mockReturnValue({ type: 'init' })
    mocks.getClientsEditingCardMock.mockReturnValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('cancels pending watcher reloads when the server closes', async () => {
    const mainWatcher = createMockWatcher()
    const configWatcher = createMockWatcher()
    mocks.watchMock
      .mockReturnValueOnce(mainWatcher)
      .mockReturnValueOnce(configWatcher)
    mocks.loadCardsMock.mockResolvedValue(undefined)

    const server = new EventEmitter()
    const ctx = createContext()

    setupWatcher(ctx as never, server as never)
    mainWatcher.emit('ready')
    mainWatcher.emit('change', '/tmp/kanban-light-watch-test/.kanban/boards/default/backlog/card.md')

    server.emit('close')
    await vi.runAllTimersAsync()

    expect(mocks.loadCardsMock).not.toHaveBeenCalled()
    expect(mainWatcher.close).toHaveBeenCalledTimes(1)
    expect(configWatcher.close).toHaveBeenCalledTimes(1)
    expect(ctx.wss.close).toHaveBeenCalledTimes(1)
  })

  it('ignores missing-path reload failures during shutdown', async () => {
    const mainWatcher = createMockWatcher()
    const configWatcher = createMockWatcher()
    mocks.watchMock
      .mockReturnValueOnce(mainWatcher)
      .mockReturnValueOnce(configWatcher)

    let rejectLoadCards: ((reason?: unknown) => void) | undefined
    mocks.loadCardsMock.mockImplementation(() => new Promise((_, reject) => {
      rejectLoadCards = reject
    }))

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const server = new EventEmitter()
    const ctx = createContext()

    setupWatcher(ctx as never, server as never)
    mainWatcher.emit('ready')
    mainWatcher.emit('change', '/tmp/kanban-light-watch-test/.kanban/boards/default/backlog/card.md')
    await vi.advanceTimersByTimeAsync(100)

    server.emit('close')
    rejectLoadCards?.(Object.assign(new Error('workspace removed during shutdown'), {
      code: 'ENOENT',
      path: '/tmp/kanban-light-watch-test/.kanban/boards/default',
    }))
    await Promise.resolve()

    expect(consoleErrorSpy).not.toHaveBeenCalled()
    expect(ctx.migrating).toBe(false)
  })

  it('logs unexpected watcher reload failures while still running', async () => {
    const mainWatcher = createMockWatcher()
    const configWatcher = createMockWatcher()
    mocks.watchMock
      .mockReturnValueOnce(mainWatcher)
      .mockReturnValueOnce(configWatcher)

    const failure = new Error('watch reload failed')
    mocks.loadCardsMock.mockRejectedValue(failure)

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const server = new EventEmitter()
    const ctx = createContext()

    setupWatcher(ctx as never, server as never)
    mainWatcher.emit('ready')
    mainWatcher.emit('change', '/tmp/kanban-light-watch-test/.kanban/boards/default/backlog/card.md')
    await vi.advanceTimersByTimeAsync(100)
    await Promise.resolve()

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to refresh standalone state after watched file change:',
      failure,
    )
    expect(ctx.migrating).toBe(false)
  })
})
