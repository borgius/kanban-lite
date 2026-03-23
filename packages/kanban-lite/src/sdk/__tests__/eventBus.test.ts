import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventBus } from '../eventBus'
import type { BeforeEventPayload, SDKEvent } from '../types'

function makeEvent(type: string, data: unknown = {}): SDKEvent {
  return { type, data, timestamp: new Date().toISOString() }
}

describe('EventBus', () => {
  let bus: EventBus

  beforeEach(() => { bus = new EventBus() })
  afterEach(() => { bus.destroy() })

  it('emits events to registered listeners', () => {
    const listener = vi.fn()
    bus.on('task.created', listener)
    const event = makeEvent('task.created', { id: '1' })
    bus.emit('task.created', event)
    expect(listener).toHaveBeenCalledWith(event)
  })

  it('supports wildcard subscriptions', () => {
    const listener = vi.fn()
    bus.on('task.*', listener)
    bus.emit('task.created', makeEvent('task.created'))
    bus.emit('task.updated', makeEvent('task.updated'))
    bus.emit('board.created', makeEvent('board.created'))
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('supports multi-level wildcards', () => {
    const listener = vi.fn()
    bus.on('**', listener)
    bus.emit('task.created', makeEvent('task.created'))
    bus.emit('board.deleted', makeEvent('board.deleted'))
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('onAny receives all events with event name', () => {
    const listener = vi.fn()
    bus.onAny(listener)
    bus.emit('task.created', makeEvent('task.created'))
    bus.emit('board.deleted', makeEvent('board.deleted'))
    expect(listener).toHaveBeenCalledTimes(2)
    expect(listener).toHaveBeenCalledWith('task.created', expect.objectContaining({ type: 'task.created' }))
    expect(listener).toHaveBeenCalledWith('board.deleted', expect.objectContaining({ type: 'board.deleted' }))
  })

  it('returns unsubscribe function from on()', () => {
    const listener = vi.fn()
    const unsub = bus.on('task.created', listener)
    bus.emit('task.created', makeEvent('task.created'))
    expect(listener).toHaveBeenCalledTimes(1)
    unsub()
    bus.emit('task.created', makeEvent('task.created'))
    expect(listener).toHaveBeenCalledTimes(1) // not called again
  })

  it('returns unsubscribe function from onAny()', () => {
    const listener = vi.fn()
    const unsub = bus.onAny(listener)
    bus.emit('test', makeEvent('test'))
    expect(listener).toHaveBeenCalledTimes(1)
    unsub()
    bus.emit('test', makeEvent('test'))
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('once() only fires a listener once', () => {
    const listener = vi.fn()
    bus.once('task.created', listener)

    bus.emit('task.created', makeEvent('task.created', { id: '1' }))
    bus.emit('task.created', makeEvent('task.created', { id: '2' }))

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ data: { id: '1' } }))
  })

  it('many() only fires a listener the requested number of times', () => {
    const listener = vi.fn()
    bus.many('task.created', 2, listener)

    bus.emit('task.created', makeEvent('task.created', { id: '1' }))
    bus.emit('task.created', makeEvent('task.created', { id: '2' }))
    bus.emit('task.created', makeEvent('task.created', { id: '3' }))

    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('isolates listener errors — one failing does not prevent others', () => {
    const error = new Error('listener boom')
    const failingListener = vi.fn(() => { throw error })
    const goodListener = vi.fn()
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    bus.on('task.created', failingListener)
    bus.on('task.created', goodListener)
    bus.emit('task.created', makeEvent('task.created'))

    expect(failingListener).toHaveBeenCalled()
    expect(goodListener).toHaveBeenCalled()
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('destroy() removes all listeners', () => {
    const listener = vi.fn()
    bus.on('task.created', listener)
    bus.onAny(vi.fn())
    bus.destroy()
    bus.emit('task.created', makeEvent('task.created'))
    expect(listener).not.toHaveBeenCalled()
  })

  it('listenerCount returns accurate count', () => {
    expect(bus.listenerCount('task.created')).toBe(0)
    bus.on('task.created', vi.fn())
    bus.on('task.created', vi.fn())
    expect(bus.listenerCount('task.created')).toBe(2)
  })

  it('hasListeners returns correct state', () => {
    expect(bus.hasListeners('task.created')).toBe(false)
    const unsub = bus.on('task.created', vi.fn())
    expect(bus.hasListeners('task.created')).toBe(true)
    unsub()
    expect(bus.hasListeners('task.created')).toBe(false)
  })

  it('SDKEvent payload has correct shape', () => {
    const listener = vi.fn()
    bus.on('task.created', listener)
    const ts = new Date().toISOString()
    bus.emit('task.created', { type: 'task.created', data: { id: '1' }, timestamp: ts, actor: 'admin', boardId: 'b1' })
    const received = listener.mock.calls[0][0] as SDKEvent
    expect(received.type).toBe('task.created')
    expect(received.data).toEqual({ id: '1' })
    expect(received.timestamp).toBe(ts)
    expect(received.actor).toBe('admin')
    expect(received.boardId).toBe('b1')
  })

  it('off() removes a specific listener', () => {
    const listener = vi.fn()
    bus.on('task.created', listener)
    bus.off('task.created', listener)
    bus.emit('task.created', makeEvent('task.created'))
    expect(listener).not.toHaveBeenCalled()
  })

  it('offAny() removes a specific catch-all listener', () => {
    const listener = vi.fn()
    bus.onAny(listener)

    bus.offAny(listener)
    bus.emit('task.created', makeEvent('task.created'))

    expect(listener).not.toHaveBeenCalled()
  })

  it('removeAllListeners clears all subscriptions', () => {
    bus.on('task.created', vi.fn())
    bus.on('board.created', vi.fn())
    bus.removeAllListeners()
    expect(bus.hasListeners('task.created')).toBe(false)
    expect(bus.hasListeners('board.created')).toBe(false)
  })

  it('eventNames() returns registered event names', () => {
    bus.on('task.created', vi.fn())
    bus.on('board.*', vi.fn())

    expect(bus.eventNames().sort()).toEqual(['board.*', 'task.created'])
  })

  it('listenerCount() includes onAny listeners when called without an event name', () => {
    bus.on('task.created', vi.fn())
    bus.onAny(vi.fn())

    expect(bus.listenerCount()).toBe(2)
  })

  it('waitFor() resolves when the matching event is emitted', async () => {
    const pending = bus.waitFor('task.created')
    const event = makeEvent('task.created', { id: '1' })

    bus.emit('task.created', event)

    await expect(pending).resolves.toEqual(event)
  })

  it('waitFor() supports a payload filter', async () => {
    const pending = bus.waitFor('task.*', {
      filter: payload => payload.data !== 'skip',
    })

    bus.emit('task.created', makeEvent('task.created', 'skip'))
    bus.emit('task.updated', makeEvent('task.updated', 'take'))

    await expect(pending).resolves.toEqual(expect.objectContaining({ type: 'task.updated', data: 'take' }))
  })

  it('waitFor() rejects on timeout', async () => {
    await expect(bus.waitFor('task.created', { timeout: 5 })).rejects.toThrow('Timed out waiting for event "task.created"')
  })

  it('should isolate errors in onAny listeners', () => {
    const results: string[] = []

    bus.onAny(() => { throw new Error('boom') })
    bus.onAny((event) => { results.push(event) })

    bus.emit('test.event', { type: 'test.event', data: {}, timestamp: new Date().toISOString() })

    expect(results).toEqual(['test.event'])
  })
})

// ---------------------------------------------------------------------------
// emitAsync — async before-event dispatch with deterministic merge semantics
// ---------------------------------------------------------------------------

describe('EventBus.emitAsync', () => {
  let bus: EventBus

  beforeEach(() => { bus = new EventBus() })
  afterEach(() => { bus.destroy() })

  function makeBeforePayload<T extends Record<string, unknown>>(
    event: string,
    input: T,
  ): BeforeEventPayload<T> {
    return { event: event as BeforeEventPayload<T>['event'], input, timestamp: new Date().toISOString() }
  }

  it('returns an empty array when no listeners are registered', async () => {
    const input = { title: 'card' }
    const result = await bus.emitAsync('card.create', makeBeforePayload('card.create', input))
    expect(result).toEqual([])
  })

  it('returns empty array when listener returns void', async () => {
    bus.on('card.create', vi.fn().mockReturnValue(undefined))
    const result = await bus.emitAsync('card.create', makeBeforePayload('card.create', { title: 'card' }))
    expect(result).toEqual([]) // void return is not collected
  })

  it('collects plain-object listener responses into an ordered array', async () => {
    bus.on('card.create', vi.fn().mockReturnValue({ status: 'in-progress' }))
    const result = await bus.emitAsync('card.create', makeBeforePayload('card.create', { title: 'card', status: 'backlog' }))
    expect(result).toEqual([{ status: 'in-progress' }])
  })

  it('collects outputs from multiple listeners in registration order', async () => {
    bus.on('card.create', vi.fn().mockReturnValue({ status: 'first', extra: 'a' }))
    bus.on('card.create', vi.fn().mockReturnValue({ status: 'second' }))
    const result = await bus.emitAsync<Record<string, unknown>>('card.create', makeBeforePayload('card.create', { status: 'original' }))
    expect(result).toEqual([{ status: 'first', extra: 'a' }, { status: 'second' }])
  })

  it('ignores array return values', async () => {
    bus.on('card.create', vi.fn().mockReturnValue(['not', 'plain']))
    const result = await bus.emitAsync('card.create', makeBeforePayload('card.create', { title: 'x' }))
    expect(result).toEqual([]) // arrays are not collected
  })

  it('ignores primitive return values', async () => {
    bus.on('card.create', vi.fn().mockReturnValue(42 as unknown as void))
    bus.on('card.create', vi.fn().mockReturnValue('string' as unknown as void))
    const result = await bus.emitAsync('card.create', makeBeforePayload('card.create', { title: 'x' }))
    expect(result).toEqual([]) // primitives are not collected
  })

  it('ignores class instance return values', async () => {
    bus.on('card.create', vi.fn().mockReturnValue(new Date() as unknown as void))
    const result = await bus.emitAsync('card.create', makeBeforePayload('card.create', { title: 'x' }))
    expect(result).toEqual([]) // class instances are not collected
  })

  it('awaits async (Promise-returning) listeners', async () => {
    bus.on('card.create', vi.fn().mockResolvedValue({ status: 'async-override' }))
    const result = await bus.emitAsync('card.create', makeBeforePayload('card.create', { status: 'original' }))
    expect(result).toEqual([{ status: 'async-override' }])
  })

  it('awaits multiple async listeners in registration order', async () => {
    const order: number[] = []
    bus.on('card.create', vi.fn().mockImplementation(async () => {
      await new Promise(r => setTimeout(r, 5))
      order.push(1)
      return { from: 1 }
    }))
    bus.on('card.create', vi.fn().mockImplementation(async () => {
      order.push(2)
      return { from: 2 }
    }))
    const result = await bus.emitAsync<Record<string, unknown>>('card.create', makeBeforePayload('card.create', {}))
    expect(order).toEqual([1, 2])
    expect(result).toEqual([{ from: 1 }, { from: 2 }]) // both outputs collected in order
  })

  it('each listener receives the same original unmodified input', async () => {
    const seenInputs: Array<Record<string, unknown>> = []
    bus.on('card.create', vi.fn().mockImplementation(({ input }) => {
      seenInputs.push({ ...input })
      return { step: 'first' }
    }))
    bus.on('card.create', vi.fn().mockImplementation(({ input }) => {
      seenInputs.push({ ...input })
      return { step: 'second' }
    }))
    const result = await bus.emitAsync('card.create', makeBeforePayload('card.create', { step: 'original' }))
    expect(seenInputs[0].step).toBe('original')  // first sees original
    expect(seenInputs[1].step).toBe('original')  // second also sees original (bus is a pure dispatcher)
    expect(result).toEqual([{ step: 'first' }, { step: 'second' }]) // outputs collected in order
  })

  it('propagates listener errors immediately (mutation abort)', async () => {
    const err = new Error('auth denied')
    bus.on('card.create', vi.fn().mockRejectedValue(err))
    await expect(
      bus.emitAsync('card.create', makeBeforePayload('card.create', {})),
    ).rejects.toThrow('auth denied')
  })

  it('aborts on the first erroring listener — subsequent listeners are not called', async () => {
    const second = vi.fn().mockReturnValue({ reached: true })
    bus.on('card.create', vi.fn().mockRejectedValue(new Error('abort')))
    bus.on('card.create', second)
    await expect(
      bus.emitAsync('card.create', makeBeforePayload('card.create', {})),
    ).rejects.toThrow('abort')
    expect(second).not.toHaveBeenCalled()
  })

  it('wildcard-registered listeners contribute to ordered outputs array', async () => {
    const listener = vi.fn().mockReturnValue({ wildcardKey: 'yes' })
    bus.on('card.*', listener)
    const result = await bus.emitAsync<Record<string, unknown>>('card.create', makeBeforePayload('card.create', {}))
    expect(listener).toHaveBeenCalled()
    expect(result).toEqual([{ wildcardKey: 'yes' }])
  })

  it('onAny listeners are fired non-blocking after specific-event listeners settle', async () => {
    const anyListener = vi.fn()
    bus.onAny(anyListener)
    await bus.emitAsync('card.create', makeBeforePayload('card.create', { title: 'x' }))
    expect(anyListener).toHaveBeenCalledWith('card.create', expect.any(Object))
  })

  it('onAny errors are isolated and do not propagate', async () => {
    bus.onAny(vi.fn(() => { throw new Error('onAny boom') }))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(
      bus.emitAsync('card.create', makeBeforePayload('card.create', {})),
    ).resolves.toBeDefined()
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('onAny errors do not prevent the ordered outputs from being returned', async () => {
    bus.on('card.create', vi.fn().mockReturnValue({ status: 'from-specific' }))
    bus.onAny(vi.fn(() => { throw new Error('onAny boom') }))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await bus.emitAsync('card.create', makeBeforePayload('card.create', { status: 'original' }))
    expect(result).toEqual([{ status: 'from-specific' }])
    consoleSpy.mockRestore()
  })
})
