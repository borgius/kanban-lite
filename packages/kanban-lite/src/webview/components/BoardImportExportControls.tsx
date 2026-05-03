interface BoardImportExportControlsProps {
  onExport?: () => void
  onImport?: () => void
}

/**
 * A small utility strip rendered inside the Settings panel's board tab,
 * providing Export and Import buttons for board settings.
 */
export function BoardImportExportControls({ onExport, onImport }: BoardImportExportControlsProps) {
  return (
    <div className="settings-import-export-strip" style={{ display: 'flex', gap: '8px', padding: '8px 0 12px' }}>
      <button
        className="settings-btn settings-btn-secondary"
        onClick={onExport}
        title="Export board settings as a JSON file"
        type="button"
      >
        Export Settings
      </button>
      <button
        className="settings-btn settings-btn-secondary"
        onClick={onImport}
        title="Import board settings from a JSON file"
        type="button"
      >
        Import Settings
      </button>
    </div>
  )
}
