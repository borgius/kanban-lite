import { useEffect, useRef } from 'react'
import { createDrawerResizeController, type DrawerResizeController, type DrawerPosition } from '../drawerResize'

interface DrawerResizeHandleProps {
  panelMode: 'drawer' | 'popup'
  drawerPosition?: DrawerPosition
  onPreview: (width: number) => void
  onCommit: (width: number) => void
  onCancel: () => void
}

const HANDLE_CONFIG: Record<DrawerPosition, { className: string; lineClassName: string; cursor: string }> = {
  right: {
    className: 'absolute inset-y-0 left-0 z-10 w-3 touch-none pointer-events-auto',
    lineClassName: 'absolute inset-y-0 left-1/2 w-px -translate-x-1/2',
    cursor: 'cursor-ew-resize',
  },
  left: {
    className: 'absolute inset-y-0 right-0 z-10 w-3 touch-none pointer-events-auto',
    lineClassName: 'absolute inset-y-0 left-1/2 w-px -translate-x-1/2',
    cursor: 'cursor-ew-resize',
  },
  top: {
    className: 'absolute inset-x-0 bottom-0 z-10 h-3 touch-none pointer-events-auto',
    lineClassName: 'absolute inset-x-0 top-1/2 h-px -translate-y-1/2',
    cursor: 'cursor-ns-resize',
  },
  bottom: {
    className: 'absolute inset-x-0 top-0 z-10 h-3 touch-none pointer-events-auto',
    lineClassName: 'absolute inset-x-0 top-1/2 h-px -translate-y-1/2',
    cursor: 'cursor-ns-resize',
  },
}

export function DrawerResizeHandle({ panelMode, drawerPosition = 'right', onPreview, onCommit, onCancel }: DrawerResizeHandleProps) {
  const controllerRef = useRef<DrawerResizeController | null>(null)
  const onPreviewRef = useRef(onPreview)
  const onCommitRef = useRef(onCommit)
  const onCancelRef = useRef(onCancel)

  useEffect(() => {
    onPreviewRef.current = onPreview
  }, [onPreview])

  useEffect(() => {
    onCommitRef.current = onCommit
  }, [onCommit])

  useEffect(() => {
    onCancelRef.current = onCancel
  }, [onCancel])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const controller = createDrawerResizeController({
      eventTarget: window,
      getPanelMode: () => panelMode,
      getDrawerPosition: () => drawerPosition,
      getViewportWidth: () => window.innerWidth,
      getViewportHeight: () => window.innerHeight,
      onPreview: (w) => onPreviewRef.current(w),
      onCommit: (w) => onCommitRef.current(w),
      onCancel: () => onCancelRef.current(),
    })

    controllerRef.current = controller

    return () => {
      controller.dispose()
      controllerRef.current = null
    }
  }, [panelMode, drawerPosition])

  if (panelMode !== 'drawer') {
    return null
  }

  const config = HANDLE_CONFIG[drawerPosition]

  return (
    <button
      type="button"
      aria-label="Resize drawer"
      title="Drag to resize drawer"
      data-panel-resize-handle=""
      className={`${config.className} ${config.cursor}`}
      onPointerDown={(event) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture?.(event.pointerId)
        controllerRef.current?.start({ clientX: event.clientX, clientY: event.clientY })
      }}
    >
      <span
        aria-hidden="true"
        className={config.lineClassName}
        style={{ background: 'var(--vscode-panel-border)' }}
      />
    </button>
  )
}
