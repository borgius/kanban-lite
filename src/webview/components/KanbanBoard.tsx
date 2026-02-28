import { useState, useCallback, useRef, useEffect } from 'react'
import { KanbanColumn } from './KanbanColumn'
import { useStore } from '../store'
import type { SortOrder } from '../store'
import type { Card, CardStatus } from '../../shared/types'
import { DELETED_COLUMN } from '../../shared/types'

export interface DropTarget {
  columnId: string
  index: number
}

interface KanbanBoardProps {
  onCardClick: (card: Card) => void
  onAddCard: (status: string) => void
  onMoveCard: (cardId: string, newStatus: string, newOrder: number) => void
  onEditColumn: (columnId: string) => void
  onRemoveColumn: (columnId: string) => void
  onCleanupColumn: (columnId: string) => void
  onPurgeDeletedCards: () => void
  selectedCardId?: string
}

export function KanbanBoard({ onCardClick, onAddCard, onMoveCard, onEditColumn, onRemoveColumn, onCleanupColumn, onPurgeDeletedCards, selectedCardId }: KanbanBoardProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!selectedCardId) return
    const container = scrollContainerRef.current
    if (!container) return
    // Wait a frame so the panel layout transition has started and the board has shrunk
    requestAnimationFrame(() => {
      const cardEl = container.querySelector<HTMLElement>(`[data-card-id="${selectedCardId}"]`)
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
  }, [selectedCardId])

  const columns = useStore((s) => s.columns)
  const cardSettings = useStore((s) => s.cardSettings)
  const getFilteredCardsByStatus = useStore((s) => s.getFilteredCardsByStatus)
  const getCardsByStatus = useStore((s) => s.getCardsByStatus)
  const layout = useStore((s) => s.layout)
  const columnSorts = useStore((s) => s.columnSorts)
  const setColumnSort = useStore((s) => s.setColumnSort)
  const [draggedCard, setDraggedCard] = useState<Card | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)

  const handleDragStart = useCallback((e: React.DragEvent, card: Card) => {
    setDraggedCard(card)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', card.id)
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
      if (!draggedCard) return

      const filteredCards = getFilteredCardsByStatus(columnId as CardStatus)
      let filteredInsertIndex: number

      if (dropTarget && dropTarget.columnId === columnId) {
        filteredInsertIndex = dropTarget.index
      } else {
        // Dropped on empty area of the column — append to end
        filteredInsertIndex = filteredCards.length
      }

      // Adjust index if dragging within the same column and moving downward
      if (draggedCard.status === columnId) {
        const currentIndex = filteredCards.findIndex((f) => f.id === draggedCard.id)
        if (currentIndex !== -1 && filteredInsertIndex > currentIndex) {
          filteredInsertIndex--
        }
        // No-op if dropping in the same position
        if (currentIndex === filteredInsertIndex) {
          setDraggedCard(null)
          setDropTarget(null)
          return
        }
      }

      // Translate filtered index to unfiltered index
      const allCards = getCardsByStatus(columnId as CardStatus)
        .filter((f) => f.id !== draggedCard.id)
      const filteredWithoutDragged = filteredCards.filter((f) => f.id !== draggedCard.id)

      let unfilteredInsertIndex: number

      if (filteredWithoutDragged.length === 0) {
        // No visible cards — append to end of unfiltered list
        unfilteredInsertIndex = allCards.length
      } else if (filteredInsertIndex >= filteredWithoutDragged.length) {
        // Inserting past end of filtered list — place after last visible card
        const lastVisible = filteredWithoutDragged[filteredWithoutDragged.length - 1]
        const lastVisibleUnfilteredIdx = allCards.findIndex((f) => f.id === lastVisible.id)
        unfilteredInsertIndex = lastVisibleUnfilteredIdx + 1
      } else {
        // Find the anchor card at the filtered insert position
        const anchorCard = filteredWithoutDragged[filteredInsertIndex]
        unfilteredInsertIndex = allCards.findIndex((f) => f.id === anchorCard.id)
      }

      onMoveCard(draggedCard.id, columnId, unfilteredInsertIndex)
      setDraggedCard(null)
      setDropTarget(null)
    },
    [draggedCard, dropTarget, getFilteredCardsByStatus, getCardsByStatus, onMoveCard]
  )

  const handleDragEnd = useCallback(() => {
    setDraggedCard(null)
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
            cards={getFilteredCardsByStatus(column.id as CardStatus)}
            onCardClick={onCardClick}
            onAddCard={onAddCard}
            onEditColumn={onEditColumn}
            onRemoveColumn={onRemoveColumn}
            onCleanupColumn={onCleanupColumn}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragOverCard={handleDragOverCard}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
            draggedCard={draggedCard}
            dropTarget={dropTarget}
            layout={layout}
            selectedCardId={selectedCardId}
            sort={(columnSorts[column.id] || 'order') as SortOrder}
            onSortChange={(s) => setColumnSort(column.id, s)}
          />
        ))}
        {cardSettings.showDeletedColumn && (
          <KanbanColumn
            key={DELETED_COLUMN.id}
            column={DELETED_COLUMN}
            cards={getFilteredCardsByStatus(DELETED_COLUMN.id as CardStatus)}
            onCardClick={onCardClick}
            onAddCard={onAddCard}
            onEditColumn={onEditColumn}
            onRemoveColumn={onRemoveColumn}
            onCleanupColumn={onCleanupColumn}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragOverCard={handleDragOverCard}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
            draggedCard={draggedCard}
            dropTarget={dropTarget}
            layout={layout}
            isDeletedColumn
            onPurgeColumn={onPurgeDeletedCards}
            selectedCardId={selectedCardId}
            sort={(columnSorts[DELETED_COLUMN.id] || 'order') as SortOrder}
            onSortChange={(s) => setColumnSort(DELETED_COLUMN.id, s)}
          />
        )}
      </div>
    </div>
  )
}
