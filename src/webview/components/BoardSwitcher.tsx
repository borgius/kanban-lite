import { useState, useEffect, useRef, useMemo } from 'react'
import { Search, Check, Star } from 'lucide-react'
import type { BoardInfo } from '../../shared/types'

interface BoardSwitcherProps {
  boards: BoardInfo[]
  currentBoard: string
  starredBoards: string[]
  onSelect: (boardId: string) => void
  onClose: () => void
}

export function BoardSwitcher({ boards, currentBoard, starredBoards, onSelect, onClose }: BoardSwitcherProps) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    const all = q
      ? boards.filter(b => b.name.toLowerCase().includes(q) || b.id.toLowerCase().includes(q))
      : boards
    return all.slice().sort((a, b) => {
      const aS = starredBoards.includes(a.id)
      const bS = starredBoards.includes(b.id)
      if (aS && !bS) return -1
      if (!aS && bS) return 1
      return 0
    })
  }, [boards, query, starredBoards])

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex(i => Math.min(i + 1, filtered.length - 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex(i => Math.max(i - 1, 0)); return }
      if (e.key === 'Enter' && filtered[activeIndex]) {
        onSelect(filtered[activeIndex].id)
        onClose()
      }
    }
    document.addEventListener('keydown', handleKey, true)
    return () => document.removeEventListener('keydown', handleKey, true)
  }, [filtered, activeIndex, onSelect, onClose])

  const starredItems = filtered.filter(b => starredBoards.includes(b.id))
  const unstarredItems = filtered.filter(b => !starredBoards.includes(b.id))
  const showSections = starredItems.length > 0

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute top-full left-0 mt-1 z-50 w-72 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded-lg shadow-xl overflow-hidden">
        <div className="p-2 border-b border-zinc-200 dark:border-zinc-700">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search boards..."
              className="w-full pl-8 pr-3 py-1.5 text-sm bg-zinc-50 dark:bg-zinc-700 rounded-md border border-zinc-200 dark:border-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400"
            />
          </div>
        </div>
        <div className="py-1 max-h-72 overflow-y-auto">
          {filtered.length === 0 && (
            <div className="px-4 py-3 text-sm text-zinc-400 dark:text-zinc-500 text-center">No boards found</div>
          )}
          {showSections && (
            <>
              <div className="px-3 pt-1 pb-0.5 flex items-center gap-1.5">
                <Star size={11} className="text-amber-400 fill-amber-400" />
                <span className="text-[10px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wide">Starred</span>
              </div>
              {starredItems.map((board) => {
                const idx = filtered.indexOf(board)
                return (
                  <BoardItem
                    key={board.id}
                    board={board}
                    isActive={idx === activeIndex}
                    isCurrent={board.id === currentBoard}
                    onSelect={() => { onSelect(board.id); onClose() }}
                  />
                )
              })}
              {unstarredItems.length > 0 && (
                <div className="px-3 pt-2 pb-0.5">
                  <span className="text-[10px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wide">All boards</span>
                </div>
              )}
            </>
          )}
          {unstarredItems.map((board) => {
            const idx = filtered.indexOf(board)
            return (
              <BoardItem
                key={board.id}
                board={board}
                isActive={idx === activeIndex}
                isCurrent={board.id === currentBoard}
                onSelect={() => { onSelect(board.id); onClose() }}
              />
            )
          })}
        </div>
        <div className="px-3 py-1.5 border-t border-zinc-200 dark:border-zinc-700">
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500">↑↓ navigate · Enter select · Esc close</span>
        </div>
      </div>
    </>
  )
}

function BoardItem({ board, isActive, isCurrent, onSelect }: {
  board: BoardInfo
  isActive: boolean
  isCurrent: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors ${
        isActive
          ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
          : 'text-zinc-900 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-700'
      }`}
    >
      <Check size={14} className={isCurrent ? 'text-blue-500 shrink-0' : 'invisible shrink-0'} />
      <span className="truncate">{board.name}</span>
    </button>
  )
}
