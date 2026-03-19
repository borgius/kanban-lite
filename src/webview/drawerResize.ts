import type { CardDisplaySettings } from '../shared/types'

export const MIN_DRAWER_WIDTH_PERCENT = 20
export const MAX_DRAWER_WIDTH_PERCENT = 80
export const DEFAULT_DRAWER_WIDTH_PERCENT = 50

export interface DrawerResizePointerEvent {
  clientX: number
}

export interface DrawerResizeEventTarget {
  addEventListener: (type: 'pointermove' | 'pointerup' | 'pointercancel', listener: (event: DrawerResizePointerEvent) => void) => void
  removeEventListener: (type: 'pointermove' | 'pointerup' | 'pointercancel', listener: (event: DrawerResizePointerEvent) => void) => void
}

export interface DrawerResizeControllerOptions {
  eventTarget: DrawerResizeEventTarget
  getPanelMode: () => CardDisplaySettings['panelMode']
  getViewportWidth: () => number
  onPreview: (width: number) => void
  onCommit: (width: number) => void
  onCancel: () => void
}

export interface DrawerResizeController {
  start: (event: DrawerResizePointerEvent) => boolean
  cancel: () => void
  dispose: () => void
  isActive: () => boolean
}

export function clampDrawerWidthPercent(width: number): number {
  if (!Number.isFinite(width)) {
    return DEFAULT_DRAWER_WIDTH_PERCENT
  }

  return Math.max(MIN_DRAWER_WIDTH_PERCENT, Math.min(MAX_DRAWER_WIDTH_PERCENT, width))
}

export function getDrawerWidthPercentFromClientX(clientX: number, viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    return DEFAULT_DRAWER_WIDTH_PERCENT
  }

  return clampDrawerWidthPercent(((viewportWidth - clientX) / viewportWidth) * 100)
}

export function createDrawerResizeController(options: DrawerResizeControllerOptions): DrawerResizeController {
  let active = false
  let lastWidth = DEFAULT_DRAWER_WIDTH_PERCENT

  const readWidth = (clientX: number): number => {
    lastWidth = getDrawerWidthPercentFromClientX(clientX, options.getViewportWidth())
    return lastWidth
  }

  const handlePointerMove = (event: DrawerResizePointerEvent): void => {
    if (!active) {
      return
    }

    options.onPreview(readWidth(event.clientX))
  }

  const removeListeners = (): void => {
    options.eventTarget.removeEventListener('pointermove', handlePointerMove)
    options.eventTarget.removeEventListener('pointerup', handlePointerUp)
    options.eventTarget.removeEventListener('pointercancel', handlePointerCancel)
  }

  const cleanup = (): void => {
    if (!active) {
      return
    }

    active = false
    removeListeners()
  }

  const handlePointerUp = (event: DrawerResizePointerEvent): void => {
    if (!active) {
      return
    }

    const width = readWidth(event.clientX)
    cleanup()
    options.onCommit(width)
  }

  const handlePointerCancel = (): void => {
    if (!active) {
      return
    }

    cleanup()
    options.onCancel()
  }

  return {
    start(event) {
      if ((options.getPanelMode() ?? 'drawer') !== 'drawer') {
        return false
      }

      cleanup()
      active = true
      options.eventTarget.addEventListener('pointermove', handlePointerMove)
      options.eventTarget.addEventListener('pointerup', handlePointerUp)
      options.eventTarget.addEventListener('pointercancel', handlePointerCancel)
      options.onPreview(readWidth(event.clientX))
      return true
    },
    cancel() {
      handlePointerCancel()
    },
    dispose() {
      handlePointerCancel()
    },
    isActive() {
      return active
    },
  }
}
