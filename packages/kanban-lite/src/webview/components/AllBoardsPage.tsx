import { useEffect } from 'react'
import { useStore } from '../store'
import { getVsCodeApi } from '../vsCodeApi'

function NotificationBadge({ count }: { count: number }) {
  if (count === 0) return null
  return (
    <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full text-xs font-semibold bg-blue-500 text-white">
      {count}
    </span>
  )
}

function BoardOverviewCard({ summary }: { summary: import('../../sdk/modules/board-overview').BoardOverviewSummary }) {
  const setCurrentBoard = useStore(s => s.setCurrentBoard)
  const setWorkspaceView = useStore(s => s.setWorkspaceView)

  function handleOpen() {
    setCurrentBoard(summary.board.id)
    setWorkspaceView('board')
  }

  return (
    <div className="rounded-lg border border-[var(--vscode-panel-border,#3c3c3c)] bg-[var(--vscode-editor-background)] overflow-hidden flex flex-col">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-[var(--vscode-editor-foreground)] truncate leading-tight">
            {summary.board.name}
          </h3>
          {summary.board.description && (
            <p className="mt-0.5 text-xs text-[var(--vscode-descriptionForeground)] line-clamp-2">
              {summary.board.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-xs text-[var(--vscode-descriptionForeground)]">
            {summary.totalCards} {summary.totalCards === 1 ? 'card' : 'cards'}
          </span>
          {summary.notificationCards !== null && (
            <NotificationBadge count={summary.notificationCards} />
          )}
        </div>
      </div>

      {/* Column breakdown */}
      {summary.columns.length > 0 && (
        <div className="px-4 pb-3 flex flex-wrap gap-2">
          {summary.columns.map(col => (
            <div key={col.id} className="flex items-center gap-1">
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: col.color }}
              />
              <span className="text-xs text-[var(--vscode-descriptionForeground)]">
                {col.name}
              </span>
              <span className="text-xs font-medium text-[var(--vscode-editor-foreground)]">
                {col.cardCount}
              </span>
              {col.notificationCount !== null && col.notificationCount > 0 && (
                <NotificationBadge count={col.notificationCount} />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="mt-auto px-4 pb-4">
        <button
          onClick={handleOpen}
          className="w-full text-xs px-3 py-1.5 rounded border border-[var(--vscode-button-border,transparent)] bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)] transition-colors"
        >
          Open board
        </button>
      </div>
    </div>
  )
}

export function AllBoardsPage() {
  const boardsOverview = useStore(s => s.boardsOverview)
  const boardsOverviewStatus = useStore(s => s.boardsOverviewStatus)
  const boardsOverviewError = useStore(s => s.boardsOverviewError)
  const setWorkspaceView = useStore(s => s.setWorkspaceView)

  // Trigger data load on every mount (covers menu-click, direct-URL, and back-navigation)
  useEffect(() => {
    getVsCodeApi().postMessage({ type: 'loadBoardsOverview' })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative z-[1] flex flex-1 flex-col h-full overflow-hidden bg-[var(--vscode-editor-background)]">
      {/* Page header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--vscode-panel-border,#3c3c3c)] flex-shrink-0">
        <button
          onClick={() => setWorkspaceView('board')}
          title="Back to board"
          className="flex items-center gap-1 text-xs text-[var(--vscode-textLink-foreground)] hover:underline"
        >
          ← Back
        </button>
        <h2 className="text-sm font-semibold text-[var(--vscode-editor-foreground)]">All Boards</h2>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4">
        {boardsOverviewStatus === 'loading' && (
          <div className="flex items-center justify-center h-32 text-sm text-[var(--vscode-descriptionForeground)]">
            Loading boards…
          </div>
        )}
        {boardsOverviewStatus === 'error' && (
          <div className="flex items-center justify-center h-32 text-sm text-red-400">
            {boardsOverviewError ?? 'Failed to load boards overview.'}
          </div>
        )}
        {boardsOverviewStatus === 'ready' && boardsOverview.length === 0 && (
          <div className="flex items-center justify-center h-32 text-sm text-[var(--vscode-descriptionForeground)]">
            No boards found.
          </div>
        )}
        {boardsOverviewStatus === 'ready' && boardsOverview.length > 0 && (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
            {boardsOverview.map(summary => (
              <BoardOverviewCard key={summary.board.id} summary={summary} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
