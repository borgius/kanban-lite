import { useState, useCallback, useRef, useEffect } from 'react'
import { KanbanColumn } from './KanbanColumn'
import { useStore } from '../store'
import type { SortOrder } from '../store'
import type { Feature, FeatureStatus } from '../../shared/types'
import { DELETED_COLUMN } from '../../shared/types'

export interface DropTarget {
  columnId: string
  index: number
}

interface KanbanBoardProps {
  onFeatureClick: (feature: Feature) => void
  onAddFeature: (status: string) => void
  onMoveFeature: (featureId: string, newStatus: string, newOrder: number) => void
  onEditColumn: (columnId: string) => void
  onRemoveColumn: (columnId: string) => void
  onCleanupColumn: (columnId: string) => void
  onPurgeDeletedCards: () => void
  selectedFeatureId?: string
}

export function KanbanBoard({ onFeatureClick, onAddFeature, onMoveFeature, onEditColumn, onRemoveColumn, onCleanupColumn, onPurgeDeletedCards, selectedFeatureId }: KanbanBoardProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!selectedFeatureId) return
    const container = scrollContainerRef.current
    if (!container) return
    // Wait a frame so the panel layout transition has started and the board has shrunk
    requestAnimationFrame(() => {
      const cardEl = container.querySelector<HTMLElement>(`[data-card-id="${selectedFeatureId}"]`)
      if (!cardEl) return
      const containerRect = container.getBoundingClientRect()
      const cardRect = cardEl.getBoundingClientRect()
      // Check if the card is fully visible horizontally inside the scroll container
      const isFullyVisible = cardRect.left >= containerRect.left && cardRect.right <= containerRect.right
      if (!isFullyVisible) {
        // Scroll so the card's right edge is visible with 10px breathing room
        const overflow = cardRect.right - containerRect.right
        container.scrollBy({ left: overflow + 10, behavior: 'smooth' })
      }
    })
  }, [selectedFeatureId])

  const columns = useStore((s) => s.columns)
  const cardSettings = useStore((s) => s.cardSettings)
  const getFilteredFeaturesByStatus = useStore((s) => s.getFilteredFeaturesByStatus)
  const getFeaturesByStatus = useStore((s) => s.getFeaturesByStatus)
  const layout = useStore((s) => s.layout)
  const columnSorts = useStore((s) => s.columnSorts)
  const setColumnSort = useStore((s) => s.setColumnSort)
  const [draggedFeature, setDraggedFeature] = useState<Feature | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)

  const handleDragStart = useCallback((e: React.DragEvent, feature: Feature) => {
    setDraggedFeature(feature)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', feature.id)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const handleDragOverCard = useCallback(
    (e: React.DragEvent, columnId: string, cardIndex: number) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'

      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const midY = rect.top + rect.height / 2
      const insertIndex = e.clientY < midY ? cardIndex : cardIndex + 1

      setDropTarget((prev) => {
        if (prev && prev.columnId === columnId && prev.index === insertIndex) return prev
        return { columnId, index: insertIndex }
      })
    },
    []
  )

  const handleDrop = useCallback(
    (e: React.DragEvent, columnId: string) => {
      e.preventDefault()
      if (!draggedFeature) return

      const filteredFeatures = getFilteredFeaturesByStatus(columnId as FeatureStatus)
      let filteredInsertIndex: number

      if (dropTarget && dropTarget.columnId === columnId) {
        filteredInsertIndex = dropTarget.index
      } else {
        // Dropped on empty area of the column — append to end
        filteredInsertIndex = filteredFeatures.length
      }

      // Adjust index if dragging within the same column and moving downward
      if (draggedFeature.status === columnId) {
        const currentIndex = filteredFeatures.findIndex((f) => f.id === draggedFeature.id)
        if (currentIndex !== -1 && filteredInsertIndex > currentIndex) {
          filteredInsertIndex--
        }
        // No-op if dropping in the same position
        if (currentIndex === filteredInsertIndex) {
          setDraggedFeature(null)
          setDropTarget(null)
          return
        }
      }

      // Translate filtered index to unfiltered index
      const allFeatures = getFeaturesByStatus(columnId as FeatureStatus)
        .filter((f) => f.id !== draggedFeature.id)
      const filteredWithoutDragged = filteredFeatures.filter((f) => f.id !== draggedFeature.id)

      let unfilteredInsertIndex: number

      if (filteredWithoutDragged.length === 0) {
        // No visible features — append to end of unfiltered list
        unfilteredInsertIndex = allFeatures.length
      } else if (filteredInsertIndex >= filteredWithoutDragged.length) {
        // Inserting past end of filtered list — place after last visible feature
        const lastVisible = filteredWithoutDragged[filteredWithoutDragged.length - 1]
        const lastVisibleUnfilteredIdx = allFeatures.findIndex((f) => f.id === lastVisible.id)
        unfilteredInsertIndex = lastVisibleUnfilteredIdx + 1
      } else {
        // Find the anchor feature at the filtered insert position
        const anchorFeature = filteredWithoutDragged[filteredInsertIndex]
        unfilteredInsertIndex = allFeatures.findIndex((f) => f.id === anchorFeature.id)
      }

      onMoveFeature(draggedFeature.id, columnId, unfilteredInsertIndex)
      setDraggedFeature(null)
      setDropTarget(null)
    },
    [draggedFeature, dropTarget, getFilteredFeaturesByStatus, getFeaturesByStatus, onMoveFeature]
  )

  const handleDragEnd = useCallback(() => {
    setDraggedFeature(null)
    setDropTarget(null)
  }, [])

  const isVertical = layout === 'vertical'

  return (
    <div ref={scrollContainerRef} className={isVertical ? "h-full overflow-y-auto p-4" : "h-full overflow-x-auto p-4"}>
      <div className={isVertical ? "flex flex-col gap-4" : "flex gap-4 h-full min-w-max"}>
        {columns.map((column) => (
          <KanbanColumn
            key={column.id}
            column={column}
            features={getFilteredFeaturesByStatus(column.id as FeatureStatus)}
            onFeatureClick={onFeatureClick}
            onAddFeature={onAddFeature}
            onEditColumn={onEditColumn}
            onRemoveColumn={onRemoveColumn}
            onCleanupColumn={onCleanupColumn}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragOverCard={handleDragOverCard}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
            draggedFeature={draggedFeature}
            dropTarget={dropTarget}
            layout={layout}
            selectedFeatureId={selectedFeatureId}
            sort={(columnSorts[column.id] || 'order') as SortOrder}
            onSortChange={(s) => setColumnSort(column.id, s)}
          />
        ))}
        {cardSettings.showDeletedColumn && (
          <KanbanColumn
            key={DELETED_COLUMN.id}
            column={DELETED_COLUMN}
            features={getFilteredFeaturesByStatus(DELETED_COLUMN.id as FeatureStatus)}
            onFeatureClick={onFeatureClick}
            onAddFeature={onAddFeature}
            onEditColumn={onEditColumn}
            onRemoveColumn={onRemoveColumn}
            onCleanupColumn={onCleanupColumn}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragOverCard={handleDragOverCard}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
            draggedFeature={draggedFeature}
            dropTarget={dropTarget}
            layout={layout}
            isDeletedColumn
            onPurgeColumn={onPurgeDeletedCards}
            selectedFeatureId={selectedFeatureId}
            sort={(columnSorts[DELETED_COLUMN.id] || 'order') as SortOrder}
            onSortChange={(s) => setColumnSort(DELETED_COLUMN.id, s)}
          />
        )}
      </div>
    </div>
  )
}
