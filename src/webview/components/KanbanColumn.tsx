import { useState, useRef, useEffect } from 'react'
import { Plus, MoreVertical, Pencil, Trash2, Check } from 'lucide-react'
import { CardItem } from './CardItem'
import type { Card, KanbanColumn as KanbanColumnType } from '../../shared/types'
import type { LayoutMode, SortOrder } from '../store'
import type { DropTarget } from './KanbanBoard'

const SORT_OPTIONS: { value: SortOrder; label: string }[] = [
  { value: 'order', label: 'Board Order' },
  { value: 'created:asc', label: 'Created (oldest)' },
  { value: 'created:desc', label: 'Created (newest)' },
  { value: 'modified:asc', label: 'Modified (oldest)' },
  { value: 'modified:desc', label: 'Modified (newest)' },
]

interface KanbanColumnProps {
  column: KanbanColumnType
  cards: Card[]
  onCardClick: (card: Card) => void
  onAddCard: (status: string) => void
  onEditColumn: (columnId: string) => void
  onRemoveColumn: (columnId: string) => void
  onCleanupColumn: (columnId: string) => void
  onDragStart: (e: React.DragEvent, card: Card) => void
  onDragOver: (e: React.DragEvent) => void
  onDragOverCard: (e: React.DragEvent, columnId: string, cardIndex: number) => void
  onDrop: (e: React.DragEvent, status: string) => void
  onDragEnd: () => void
  draggedCard: Card | null
  dropTarget: DropTarget | null
  layout: LayoutMode
  isDeletedColumn?: boolean
  onPurgeColumn?: () => void
  selectedCardId?: string
  sort: SortOrder
  onSortChange: (sort: SortOrder) => void
}

export function KanbanColumn({
  column,
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
  layout,
  isDeletedColumn,
  onPurgeColumn,
  selectedCardId,
  sort,
  onSortChange
}: KanbanColumnProps) {
  const isVertical = layout === 'vertical'
  const isDropTarget = dropTarget && dropTarget.columnId === column.id
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

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

  return (
    <div
      className={
        isVertical
          ? "flex flex-col bg-zinc-100 dark:bg-zinc-800 rounded-lg"
          : "flex-shrink-0 w-72 h-full flex flex-col bg-zinc-100 dark:bg-zinc-800 rounded-lg"
      }
      onDragOver={onDragOver}
      onDrop={(e) => onDrop(e, column.id)}
    >
      {/* Column Header */}
      <div className="flex items-center justify-between w-full px-3 py-2 border-b border-zinc-200 dark:border-zinc-700">
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
              <CardItem card={card} onClick={() => onCardClick(card)} isSelected={card.id === selectedCardId} />
            </div>
          </div>
        ))}

        {/* Drop indicator at end of list */}
        {isDropTarget && dropTarget.index === cards.length && cards.length > 0 && (
          <div className="h-0.5 bg-blue-500 rounded-full mx-1" />
        )}

        {cards.length === 0 && (
          <div className={isVertical ? "text-sm text-zinc-400 dark:text-zinc-500 py-4" : "text-center py-8 text-sm text-zinc-400 dark:text-zinc-500"}>
            No cards
          </div>
        )}
      </div>
    </div>
  )
}
