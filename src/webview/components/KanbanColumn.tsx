import { useState, useRef, useEffect, useMemo } from 'react'
import { Plus, MoreVertical, Pencil, Trash2, Check, CheckSquare, LayoutList, Maximize2, Minimize2, Zap } from 'lucide-react'
import { CardItem } from './CardItem'
import { QuickAddInput } from './QuickAddInput'
import type { Card, KanbanColumn as KanbanColumnType, CardStatus, Priority } from '../../shared/types'
import type { LayoutMode, SortOrder } from '../store'
import type { DropTarget } from './KanbanBoard'

const SORT_OPTIONS: { value: SortOrder; label: string }[] = [
  { value: 'order', label: 'Board Order' },
  { value: 'created:asc', label: 'Created (oldest)' },
  { value: 'created:desc', label: 'Created (newest)' },
  { value: 'modified:asc', label: 'Modified (oldest)' },
  { value: 'modified:desc', label: 'Modified (newest)' },
]

const COLUMN_DRAG_MIME_TYPE = 'application/x-column-id'

function isColumnDragEvent(event: Pick<React.DragEvent, 'dataTransfer'>): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes(COLUMN_DRAG_MIME_TYPE)
}

interface KanbanColumnProps {
  column: KanbanColumnType
  columnIndex: number
  cards: Card[]
  onCardClick: (card: Card, e: React.MouseEvent) => void
  onAddCard: (status: string) => void
  onEditColumn: (columnId: string) => void
  onRemoveColumn: (columnId: string) => void
  onCleanupColumn: (columnId: string) => void
  onDragStart: (e: React.DragEvent, card: Card) => void
  onDragOver: (e: React.DragEvent, columnId: string) => void
  onDragOverCard: (e: React.DragEvent, columnId: string, cardIndex: number) => void
  onDrop: (e: React.DragEvent, status: string) => void
  onDragEnd: () => void
  draggedCard: Card | null
  dropTarget: DropTarget | null
  draggedColumnId: string | null
  dropColumnIndex: number | null
  onColumnDragStart: (e: React.DragEvent, columnId: string) => void
  onColumnDragOver: (e: React.DragEvent, colIdx: number) => void
  onColumnDrop: (e: React.DragEvent) => void
  onColumnDragEnd: () => void
  isMinimized?: boolean
  onToggleMinimized: () => void
  layout: LayoutMode
  isDeletedColumn?: boolean
  onPurgeColumn?: () => void
  selectedCardId?: string
  selectedCardIds: string[]
  onSelectAll: (status: string) => void
  sort: SortOrder
  onSortChange: (sort: SortOrder) => void
  onQuickAdd?: (data: { status: CardStatus; priority: Priority; content: string }) => void
  onTriggerAction?: (cardId: string, action: string) => void
}

export function KanbanColumn({
  column,
  columnIndex,
  cards,
  onCardClick,
  onAddCard,
  onEditColumn,
  onRemoveColumn,
  onCleanupColumn,
  onDragStart,
  onDragOver,
  onDragOverCard,
  onDrop,
  onDragEnd,
  draggedCard,
  dropTarget,
  draggedColumnId,
  dropColumnIndex,
  onColumnDragStart,
  onColumnDragOver,
  onColumnDrop,
  onColumnDragEnd,
  isMinimized = false,
  onToggleMinimized,
  layout,
  isDeletedColumn,
  onPurgeColumn,
  selectedCardId,
  selectedCardIds,
  onSelectAll,
  sort,
  onSortChange,
  onQuickAdd,
  onTriggerAction
}: KanbanColumnProps) {
  const isVertical = layout === 'vertical'
  const isDropTarget = dropTarget && dropTarget.columnId === column.id
  const isColumnDropBefore = !isVertical && !isDeletedColumn && dropColumnIndex === columnIndex && draggedColumnId !== column.id
  const isColumnDropAfter = !isVertical && !isDeletedColumn && dropColumnIndex === columnIndex + 1 && draggedColumnId !== column.id
  const isBeingDragged = draggedColumnId === column.id
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Compute deduplicated actions from relevant cards:
  // use column-selected cards if any are selected, otherwise use all column cards
  const columnSelectedCardIds = useMemo(
    () => selectedCardIds.filter(id => cards.some(c => c.id === id)),
    [selectedCardIds, cards]
  )
  const relevantCards = columnSelectedCardIds.length > 0
    ? cards.filter(c => columnSelectedCardIds.includes(c.id))
    : cards
  const columnActionEntries = useMemo(() => {
    const map: Record<string, { label: string; cardIds: string[] }> = {}
    for (const card of relevantCards) {
      if (!card.actions) continue
      const pairs: [string, string][] = Array.isArray(card.actions)
        ? card.actions.map(a => [a, a])
        : Object.entries(card.actions as Record<string, string>)
      for (const [key, label] of pairs) {
        if (!map[key]) map[key] = { label, cardIds: [] }
        map[key].cardIds.push(card.id)
      }
    }
    return Object.entries(map)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relevantCards])

  useEffect(() => {
    if (!menuOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [menuOpen])

  if (isMinimized && !isDeletedColumn) {
    return (
      <div
        className={
          [
            isVertical
              ? 'flex items-center gap-2 bg-zinc-100 dark:bg-zinc-800 rounded-lg px-2 py-1.5'
              : 'flex-shrink-0 w-10 h-full flex flex-col bg-zinc-100 dark:bg-zinc-800 rounded-lg',
            isBeingDragged ? 'opacity-40' : '',
            isColumnDropBefore ? 'border-l-2 border-blue-500' : '',
            isColumnDropAfter ? 'border-r-2 border-blue-500' : '',
            isDropTarget && draggedCard ? 'ring-2 ring-blue-400 dark:ring-blue-500' : '',
          ].filter(Boolean).join(' ')
        }
        onDragOver={(e) => onDragOver(e, column.id)}
        onDrop={(e) => onDrop(e, column.id)}
      >
        <div
          className={
            isVertical
              ? 'flex items-center gap-2 w-full cursor-grab active:cursor-grabbing'
              : 'flex flex-col items-center gap-1.5 px-1.5 py-1.5 cursor-grab active:cursor-grabbing h-full'
          }
          draggable
          onDragStart={(e) => onColumnDragStart(e, column.id)}
          onDragOver={(e) => {
            if (!isColumnDragEvent(e)) return
            e.stopPropagation()
            onColumnDragOver(e, columnIndex)
          }}
          onDrop={(e) => {
            if (!isColumnDragEvent(e)) return
            e.stopPropagation()
            onColumnDrop(e)
          }}
          onDragEnd={onColumnDragEnd}
        >
          {/* Expand button at the top */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleMinimized() }}
            className="p-0.5 rounded hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60 transition-colors flex-shrink-0"
            title={`Expand ${column.name}`}
          >
            <Maximize2 size={12} className="text-zinc-500" />
          </button>
          {isVertical ? (
            /* Horizontal chip layout (vertical board mode): dot → title → count left-to-right */
            <>
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: column.color }} />
              <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate" title={column.name}>
                {column.name}
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium tabular-nums">
                {cards.length}
              </span>
            </>
          ) : (
            /* Vertical rail layout: DOM order count→title→dot so reading bottom-to-top gives dot→title→count */
            <div className="flex flex-col items-center gap-1.5 flex-1 justify-start min-h-0 overflow-hidden">
              <span
                className="text-xs text-zinc-500 dark:text-zinc-400 font-medium tabular-nums"
                style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
              >
                {cards.length}
              </span>
              <span
                className="text-xs font-medium text-zinc-900 dark:text-zinc-100 tracking-wide"
                style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                title={column.name}
              >
                {column.name}
              </span>
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-0.5" style={{ backgroundColor: column.color }} />
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      className={
        [
          isVertical
            ? "flex flex-col bg-zinc-100 dark:bg-zinc-800 rounded-lg"
            : "flex-shrink-0 w-72 h-full flex flex-col bg-zinc-100 dark:bg-zinc-800 rounded-lg",
          isBeingDragged ? "opacity-40" : "",
          isColumnDropBefore ? "border-l-2 border-blue-500" : "",
          isColumnDropAfter ? "border-r-2 border-blue-500" : "",
          isDropTarget && draggedCard ? "ring-2 ring-blue-400 dark:ring-blue-500" : "",
        ].filter(Boolean).join(' ')
      }
      onDragOver={(e) => onDragOver(e, column.id)}
      onDrop={(e) => onDrop(e, column.id)}
    >
      {/* Column Header */}
      <div
        className="flex items-center justify-between w-full px-3 py-2 border-b border-zinc-200 dark:border-zinc-700 cursor-grab active:cursor-grabbing"
        draggable={!isDeletedColumn}
        onDragStart={(e) => { if (!isDeletedColumn) onColumnDragStart(e, column.id) }}
        onDragOver={(e) => {
          if (isDeletedColumn || !isColumnDragEvent(e)) return
          e.stopPropagation()
          onColumnDragOver(e, columnIndex)
        }}
        onDrop={(e) => {
          if (!isColumnDragEvent(e)) return
          e.stopPropagation()
          onColumnDrop(e)
        }}
        onDragEnd={onColumnDragEnd}
      >
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: column.color }} />
          <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{column.name}</h3>
          <span className="text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-200 dark:bg-zinc-700 px-1.5 py-0.5 rounded-full">
            {cards.length}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          {isDeletedColumn ? (
            <button
              type="button"
              onClick={() => {
                if (cards.length === 0) return
                if (window.confirm(`Permanently delete all ${cards.length} card${cards.length === 1 ? '' : 's'} from disk?`)) {
                  onPurgeColumn?.()
                }
              }}
              className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
              title="Permanently delete all cards"
            >
              <Trash2 size={16} className="text-red-500" />
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => onAddCard(column.id)}
                className="p-1 rounded hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60 transition-colors"
                title={`Add to ${column.name}`}
              >
                <Plus size={16} className="text-zinc-500" />
              </button>
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setMenuOpen(!menuOpen)}
                  className="p-1 rounded hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60 transition-colors"
                  title="Column options"
                >
                  <MoreVertical size={16} className="text-zinc-500" />
                </button>
                {menuOpen && (
                  <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded-md shadow-lg py-1 min-w-[170px]">
                    <div className="px-3 py-1 text-xs font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wide">Sort by</div>
                    {SORT_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => { onSortChange(opt.value) }}
                        className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                      >
                        <Check size={14} className={sort === opt.value ? 'text-blue-500' : 'invisible'} />
                        {opt.label}
                      </button>
                    ))}
                    <div className="border-t border-zinc-200 dark:border-zinc-600 my-1" />
                    <button
                      type="button"
                      onClick={() => { setMenuOpen(false); onEditColumn(column.id) }}
                      className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                    >
                      <Pencil size={14} />
                      Edit List
                    </button>
                    <button
                      type="button"
                      onClick={() => { setMenuOpen(false); onRemoveColumn(column.id) }}
                      className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                    >
                      <Trash2 size={14} />
                      Remove List
                    </button>
                    <button
                      type="button"
                      onClick={() => { setMenuOpen(false); onCleanupColumn(column.id) }}
                      className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-orange-600 dark:text-orange-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                    >
                      <Trash2 size={14} />
                      Cleanup List
                    </button>
                    <div className="border-t border-zinc-200 dark:border-zinc-600 my-1" />
                    <button
                      type="button"
                      onClick={() => { setMenuOpen(false); onToggleMinimized() }}
                      className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                    >
                      <Minimize2 size={14} />
                      Minimize List
                    </button>
                    <button
                      type="button"
                      onClick={() => { setMenuOpen(false); onSelectAll(column.id) }}
                      className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                    >
                      <CheckSquare size={14} />
                      Select All
                    </button>
                    {columnActionEntries.length > 0 && onTriggerAction && (
                      <>
                        <div className="border-t border-zinc-200 dark:border-zinc-600 my-1" />
                        <div className="px-3 py-1 text-xs font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wide">Actions</div>
                        {columnActionEntries.map(([key, { label, cardIds }]) => (
                          <button
                            key={key}
                            type="button"
                            onClick={() => {
                              setMenuOpen(false)
                              cardIds.forEach(cardId => onTriggerAction!(cardId, key))
                            }}
                            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                          >
                            <Zap size={14} className="text-amber-500 flex-shrink-0" />
                            <span className="flex-1 text-left truncate">{label}</span>
                            <span className="text-xs text-zinc-400 dark:text-zinc-500 bg-zinc-200 dark:bg-zinc-700 px-1.5 py-0.5 rounded-full flex-shrink-0">{cardIds.length}</span>
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Column Content */}
      <div
        className={
          isVertical
            ? "flex-1 p-2 flex flex-wrap gap-2"
            : "flex-1 overflow-y-auto p-2 space-y-2 min-h-[200px]"
        }
      >
        {cards.map((card, index) => (
          <div key={card.id}>
            {/* Drop indicator before this card */}
            {isDropTarget && dropTarget.index === index && (
              <div className="h-0.5 bg-blue-500 rounded-full mx-1 mb-1" />
            )}
            <div
              draggable
              data-card-id={card.id}
              onDragStart={(e) => onDragStart(e, card)}
              onDragOver={(e) => onDragOverCard(e, column.id, index)}
              onDragEnd={onDragEnd}
              className={`${isVertical ? "w-64" : ""} ${
                draggedCard?.id === card.id ? "opacity-40" : ""
              }`}
            >
              <CardItem card={card} onClick={(e) => onCardClick(card, e)} isSelected={selectedCardIds.includes(card.id) || card.id === selectedCardId} />
            </div>
          </div>
        ))}

        {/* Drop indicator at end of list */}
        {isDropTarget && dropTarget.index === cards.length && cards.length > 0 && (
          <div className="h-0.5 bg-blue-500 rounded-full mx-1" />
        )}

        {cards.length === 0 && (
          <div className={isVertical ? "flex items-center gap-2 py-4 px-1 text-zinc-400 dark:text-zinc-500" : "flex flex-col items-center gap-1.5 py-8 text-zinc-400 dark:text-zinc-500"}>
            <LayoutList size={isVertical ? 14 : 20} className="shrink-0 opacity-50" />
            <span className={isVertical ? "text-sm" : "text-sm text-center"}>
              No cards yet
            </span>
            {!isVertical && (
              <span className="text-[11px] text-center text-zinc-300 dark:text-zinc-600 max-w-[120px]">
                Drag cards here or click + to add one
              </span>
            )}
          </div>
        )}
      </div>

      {/* Inline quick add — only for real (non-deleted) columns */}
      {!isDeletedColumn && onQuickAdd && (
        <div className="px-2 pb-2">
          <QuickAddInput
            status={column.id as CardStatus}
            onAdd={onQuickAdd}
          />
        </div>
      )}
    </div>
  )
}
