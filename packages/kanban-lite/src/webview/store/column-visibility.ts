import { create } from 'zustand'
import type { Card, KanbanColumn, Priority, CardDisplaySettings, BoardInfo, WorkspaceInfo, LabelDefinition, CardFormAttachment, CardStateReadModelTransport, CardViewMode } from '../../shared/types'
import { matchesCardSearch, parseSearchQuery } from '../../sdk/metaUtils'
import { generateSlug, normalizeBoardBackgroundSettings } from '../../shared/types'
import { clampDrawerWidthPercent } from '../drawerResize'
import type { SettingsTab } from '../settingsTabs'
import type { DueDateFilter } from './card-tabs'
export function getBoardInfo(boards: BoardInfo[], boardId: string): BoardInfo | undefined {
  return boards.find((board) => board.id === boardId)
}

export interface SavedView {
  id: string
  name: string
  searchQuery: string
  fuzzySearch: boolean
  priorityFilter: Priority | 'all'
  assigneeFilter: string | 'all'
  labelFilter: string[]
  dueDateFilter: DueDateFilter
}

export interface ColumnVisibilityState {
  hiddenColumnIds: string[]
  minimizedColumnIds: string[]
}

export type ColumnVisibilityByBoard = Record<string, ColumnVisibilityState>

export const EMPTY_COLUMN_VISIBILITY: ColumnVisibilityState = {
  hiddenColumnIds: [],
  minimizedColumnIds: [],
}

export function normalizeColumnVisibilityState(visibility?: Partial<ColumnVisibilityState>): ColumnVisibilityState {
  const hiddenColumnIds = Array.from(new Set(visibility?.hiddenColumnIds ?? []))
  const hiddenSet = new Set(hiddenColumnIds)

  return {
    hiddenColumnIds,
    minimizedColumnIds: Array.from(new Set(visibility?.minimizedColumnIds ?? [])).filter((columnId) => !hiddenSet.has(columnId)),
  }
}

export function sanitizeColumnVisibilityState(
  visibility: ColumnVisibilityState,
  validColumnIds: readonly string[]
): ColumnVisibilityState {
  const validIds = new Set(validColumnIds)

  return normalizeColumnVisibilityState({
    hiddenColumnIds: visibility.hiddenColumnIds.filter((columnId) => validIds.has(columnId)),
    minimizedColumnIds: visibility.minimizedColumnIds.filter((columnId) => validIds.has(columnId)),
  })
}

export function hasColumnVisibilityState(visibility: ColumnVisibilityState): boolean {
  return visibility.hiddenColumnIds.length > 0 || visibility.minimizedColumnIds.length > 0
}

export function getColumnVisibilityState(
  columnVisibilityByBoard: ColumnVisibilityByBoard,
  boardId: string
): ColumnVisibilityState {
  return columnVisibilityByBoard[boardId] ?? EMPTY_COLUMN_VISIBILITY
}

export function setBoardColumnVisibility(
  columnVisibilityByBoard: ColumnVisibilityByBoard,
  boardId: string,
  visibility: ColumnVisibilityState
): ColumnVisibilityByBoard {
  if (!hasColumnVisibilityState(visibility)) {
    if (!(boardId in columnVisibilityByBoard)) {
      return columnVisibilityByBoard
    }

    return Object.fromEntries(Object.entries(columnVisibilityByBoard).filter(([id]) => id !== boardId))
  }

  return {
    ...columnVisibilityByBoard,
    [boardId]: visibility,
  }
}

export function columnVisibilityStateEquals(a: ColumnVisibilityState, b: ColumnVisibilityState): boolean {
  return a.hiddenColumnIds.length === b.hiddenColumnIds.length
    && a.minimizedColumnIds.length === b.minimizedColumnIds.length
    && a.hiddenColumnIds.every((columnId, index) => columnId === b.hiddenColumnIds[index])
    && a.minimizedColumnIds.every((columnId, index) => columnId === b.minimizedColumnIds[index])
}

export function sanitizeColumnVisibilityByBoard(
  columnVisibilityByBoard: ColumnVisibilityByBoard,
  boardId: string,
  validColumnIds: readonly string[]
): ColumnVisibilityByBoard {
  const currentVisibility = getColumnVisibilityState(columnVisibilityByBoard, boardId)
  const sanitizedVisibility = sanitizeColumnVisibilityState(currentVisibility, validColumnIds)

  return columnVisibilityStateEquals(currentVisibility, sanitizedVisibility)
    ? columnVisibilityByBoard
    : setBoardColumnVisibility(columnVisibilityByBoard, boardId, sanitizedVisibility)
}


