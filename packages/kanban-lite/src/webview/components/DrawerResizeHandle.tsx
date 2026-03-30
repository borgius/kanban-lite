import { useEffect, useRef } from 'react'
import { createDrawerResizeController, type DrawerResizeController } from '../drawerResize'

interface DrawerResizeHandleProps {
  panelMode: 'drawer' | 'popup'
  onPreview: (width: number) => void
  onCommit: (width: number) => void
  onCancel: () => void
}

export function DrawerResizeHandle({ panelMode, onPreview, onCommit, onCancel }: DrawerResizeHandleProps) {
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
      getViewportWidth: () => window.innerWidth,
      onPreview: (w) => onPreviewRef.current(w),
      onCommit: (w) => onCommitRef.current(w),
      onCancel: () => onCancelRef.current(),
    })

    controllerRef.current = controller

    return () => {
      controller.dispose()
      controllerRef.current = null
    }
  }, [panelMode])

  if (panelMode !== 'drawer') {
    return null
  }

  return (
    <button
      type="button"
      aria-label="Resize drawer"
      title="Drag to resize drawer"
      data-panel-resize-handle=""
      className="absolute inset-y-0 left-0 z-10 w-3 cursor-ew-resize touch-none pointer-events-auto"
      onPointerDown={(event) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture?.(event.pointerId)
        controllerRef.current?.start({ clientX: event.clientX })
      }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2"
        style={{ background: 'var(--vscode-panel-border)' }}
      />
    </button>
  )
}
