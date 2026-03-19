import { describe, expect, it, vi } from 'vitest'
import { clampDrawerWidthPercent, createDrawerResizeController } from './drawerResize'

function createEventTarget() {
  const listeners = new Map<string, (event: { clientX: number }) => void>()

  return {
    addEventListener: vi.fn((type: string, listener: (event: { clientX: number }) => void) => {
      listeners.set(type, listener)
    }),
    removeEventListener: vi.fn((type: string, listener: (event: { clientX: number }) => void) => {
      if (listeners.get(type) === listener) {
        listeners.delete(type)
      }
    }),
    dispatch(type: string, clientX: number) {
      const listener = listeners.get(type)
      if (!listener) {
        throw new Error(`Missing ${type} listener`)
      }

      listener({ clientX })
    },
    has(type: string) {
      return listeners.has(type)
    },
  }
}

describe('drawer resize contract', () => {
  it('clamps drawer widths to the supported percentage range', () => {
    expect(clampDrawerWidthPercent(5)).toBe(20)
    expect(clampDrawerWidthPercent(48)).toBe(48)
    expect(clampDrawerWidthPercent(95)).toBe(80)
  })

  it('previews clamped widths during drag and commits once on release', () => {
    const eventTarget = createEventTarget()
    const preview = vi.fn()
    const commit = vi.fn()
    const cancel = vi.fn()
    const controller = createDrawerResizeController({
      eventTarget,
      getPanelMode: () => 'drawer',
      getViewportWidth: () => 1000,
      onPreview: preview,
      onCommit: commit,
      onCancel: cancel,
    })

    expect(controller.start({ clientX: 900 })).toBe(true)
    expect(preview).toHaveBeenLastCalledWith(20)
    expect(commit).not.toHaveBeenCalled()
    expect(eventTarget.has('pointermove')).toBe(true)
    expect(eventTarget.has('pointerup')).toBe(true)
    expect(eventTarget.has('pointercancel')).toBe(true)

    eventTarget.dispatch('pointermove', 150)
    expect(preview).toHaveBeenLastCalledWith(80)
    expect(commit).not.toHaveBeenCalled()

    eventTarget.dispatch('pointerup', 250)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith(75)
    expect(cancel).not.toHaveBeenCalled()
    expect(eventTarget.has('pointermove')).toBe(false)
    expect(eventTarget.has('pointerup')).toBe(false)
    expect(eventTarget.has('pointercancel')).toBe(false)
  })

  it('cancels an active drag without committing and removes listeners', () => {
    const eventTarget = createEventTarget()
    const preview = vi.fn()
    const commit = vi.fn()
    const cancel = vi.fn()
    const controller = createDrawerResizeController({
      eventTarget,
      getPanelMode: () => 'drawer',
      getViewportWidth: () => 1000,
      onPreview: preview,
      onCommit: commit,
      onCancel: cancel,
    })

    controller.start({ clientX: 600 })
    eventTarget.dispatch('pointercancel', 600)

    expect(commit).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(eventTarget.has('pointermove')).toBe(false)
    expect(eventTarget.has('pointerup')).toBe(false)
    expect(eventTarget.has('pointercancel')).toBe(false)

    controller.dispose()
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('ignores popup-mode panels entirely', () => {
    const eventTarget = createEventTarget()
    const preview = vi.fn()
    const commit = vi.fn()
    const cancel = vi.fn()
    const controller = createDrawerResizeController({
      eventTarget,
      getPanelMode: () => 'popup',
      getViewportWidth: () => 1000,
      onPreview: preview,
      onCommit: commit,
      onCancel: cancel,
    })

    expect(controller.start({ clientX: 500 })).toBe(false)
    expect(preview).not.toHaveBeenCalled()
    expect(commit).not.toHaveBeenCalled()
    expect(cancel).not.toHaveBeenCalled()
    expect(eventTarget.addEventListener).not.toHaveBeenCalled()
  })
})