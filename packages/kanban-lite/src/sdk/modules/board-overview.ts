import type { Card, BoardInfo, KanbanColumn } from '../../shared/types'
import { DELETED_STATUS_ID } from '../../shared/types'
import type { CardUnreadSummary } from '../types'

/** Per-column breakdown included in a board overview summary. */
export interface BoardOverviewColumnSummary {
  id: string
  name: string
  color: string
  /** Number of non-deleted cards currently in this column. */
  cardCount: number
  /**
   * Number of cards in this column that have unread activity for the current
   * actor. `null` when the `card.state` plugin is not configured.
   */
  notificationCount: number | null
}

/**
 * Aggregated overview for a single board, returned by `listBoardsOverview`.
 *
 * `notificationCards` is `null` when the `card.state` plugin is unavailable or
 * unconfigured, so callers must treat `null` as "indeterminate" rather than zero.
 */
export interface BoardOverviewSummary {
  board: BoardInfo
  /** Total number of non-deleted cards across all columns. */
  totalCards: number
  /**
   * Number of cards with unread activity for the current actor.
   * `null` when `card.state` is unavailable.
   */
  notificationCards: number | null
  columns: BoardOverviewColumnSummary[]
}

/**
 * Minimal SDK surface required by `listBoardsOverview`.
 * Satisfied by the full `KanbanSDK` instance.
 *
 * @internal
 */
export interface BoardOverviewContext {
  listBoards(): BoardInfo[]
  listColumns(boardId?: string): KanbanColumn[]
  listCards(columns?: string[], boardId?: string): Promise<Card[]>
  getCardStateReadModelForCards(
    cards: readonly Card[],
    fallbackBoardId?: string,
  ): Promise<Map<string, { unread: CardUnreadSummary }>>
}

/**
 * Aggregates per-board card counts and notification summaries for the
 * All Boards overview page. Processes all boards in parallel.
 *
 * Notification counts are `null` for each board when `card.state` throws
 * (plugin not configured or identity unavailable).
 */
export async function listBoardsOverview(
  ctx: BoardOverviewContext,
): Promise<BoardOverviewSummary[]> {
  const boards = ctx.listBoards()
  return Promise.all(
    boards.map(async (board): Promise<BoardOverviewSummary> => {
      const columns = ctx.listColumns(board.id).filter(c => c.id !== DELETED_STATUS_ID)
      const columnIds = columns.map(c => c.id)
      const cards = await ctx.listCards(columnIds, board.id)

      let cardStateMap: Map<string, { unread: CardUnreadSummary }> | null = null
      try {
        cardStateMap = await ctx.getCardStateReadModelForCards(cards, board.id)
      } catch {
        cardStateMap = null
      }

      const notificationCards =
        cardStateMap !== null
          ? [...cardStateMap.values()].filter(s => s.unread.unread).length
          : null

      const columnSummaries: BoardOverviewColumnSummary[] = columns.map(col => ({
        id: col.id,
        name: col.name,
        color: col.color,
        cardCount: cards.filter(c => c.status === col.id).length,
        notificationCount:
          cardStateMap !== null
            ? cards.filter(
                c => c.status === col.id && cardStateMap!.get(c.id)?.unread.unread === true,
              ).length
            : null,
      }))

      return {
        board,
        totalCards: cards.length,
        notificationCards,
        columns: columnSummaries,
      }
    }),
  )
}
