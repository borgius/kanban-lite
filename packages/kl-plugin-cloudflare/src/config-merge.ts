import type { BoardConfig, KanbanColumn } from 'kanban-lite/sdk'
import type { ConfigDocument } from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeMergedBoardConfig(
  document: ConfigDocument,
  boardId: string,
  boardConfig: Record<string, unknown>,
): BoardConfig {
  const rawBoard = structuredClone(boardConfig)
  const documentBoards = isRecord(document.boards) ? document.boards : null
  const defaultBoardId = typeof document.defaultBoard === 'string' ? document.defaultBoard : null
  const defaultBoard = defaultBoardId && documentBoards && isRecord(documentBoards[defaultBoardId])
    ? documentBoards[defaultBoardId] as Record<string, unknown>
    : null
  const fallbackColumns = Array.isArray(defaultBoard?.columns)
    ? structuredClone(defaultBoard.columns) as KanbanColumn[]
    : []
  const columns = Array.isArray(rawBoard.columns)
    ? structuredClone(rawBoard.columns) as KanbanColumn[]
    : fallbackColumns
  const documentDefaultPriority = typeof document.defaultPriority === 'string' && document.defaultPriority
    ? document.defaultPriority as BoardConfig['defaultPriority']
    : 'medium'
  const normalizedBoard = {
    ...rawBoard,
    name: typeof rawBoard.name === 'string' && rawBoard.name.trim() ? rawBoard.name : boardId,
    columns,
    nextCardId: typeof rawBoard.nextCardId === 'number' && rawBoard.nextCardId > 0 ? rawBoard.nextCardId : 1,
    defaultStatus: typeof rawBoard.defaultStatus === 'string' && rawBoard.defaultStatus
      ? rawBoard.defaultStatus
      : (typeof document.defaultStatus === 'string' && document.defaultStatus
          ? document.defaultStatus
          : (columns[0]?.id ?? 'backlog')),
    defaultPriority: typeof rawBoard.defaultPriority === 'string' && rawBoard.defaultPriority
      ? rawBoard.defaultPriority as BoardConfig['defaultPriority']
      : documentDefaultPriority,
  }

  return normalizedBoard as BoardConfig
}

/**
 * Preserves runtime-created boards from D1 while also surfacing any boards that
 * arrive later in a newly deployed Worker bootstrap config.
 */
export function mergeBootstrapBoards(
  document: ConfigDocument,
  bootstrap: ConfigDocument | null | undefined,
): ConfigDocument {
  if (!document.boards || !bootstrap?.boards) {
    return document
  }

  let mergedBoards: Record<string, BoardConfig> | null = null

  for (const [boardId, boardConfig] of Object.entries(bootstrap.boards)) {
    if (Object.prototype.hasOwnProperty.call(document.boards, boardId)) {
      continue
    }

    mergedBoards ??= { ...document.boards }
    mergedBoards[boardId] = normalizeMergedBoardConfig(
      document,
      boardId,
      isRecord(boardConfig) ? boardConfig : {},
    )
  }

  return mergedBoards
    ? { ...document, boards: mergedBoards }
    : document
}
