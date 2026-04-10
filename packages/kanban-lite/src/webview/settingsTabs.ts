export type SettingsTab = 'general' | 'board' | 'pluginOptions'

/** Sub-tab within the "Board" tab */
export type BoardSubTab = 'defaults' | 'title' | 'actions' | 'labels' | 'meta'

export const DEFAULT_BOARD_SUBTAB: BoardSubTab = 'defaults'

/** URL-safe slug → internal SettingsTab */
export const SETTINGS_TAB_FROM_SLUG: Record<string, SettingsTab> = {
  general: 'general',
  board: 'board',
  plugins: 'pluginOptions',
}

/** Internal SettingsTab → URL-safe slug */
export const SETTINGS_TAB_TO_SLUG: Record<SettingsTab, string> = {
  general: 'general',
  board: 'board',
  pluginOptions: 'plugins',
}

/** URL-safe slug → internal BoardSubTab */
export const BOARD_SETTINGS_TAB_FROM_SLUG: Record<string, BoardSubTab> = {
  defaults: 'defaults',
  title: 'title',
  actions: 'actions',
  labels: 'labels',
  meta: 'meta',
}

/** Internal BoardSubTab → URL-safe slug */
export const BOARD_SETTINGS_TAB_TO_SLUG: Record<BoardSubTab, string> = {
  defaults: 'defaults',
  title: 'title',
  actions: 'actions',
  labels: 'labels',
  meta: 'meta',
}

/** Legacy top-level settings slugs that now live under /settings/board/* */
export const LEGACY_BOARD_SETTINGS_TAB_FROM_SETTINGS_SLUG: Partial<Record<string, BoardSubTab>> = {
  defaults: 'defaults',
  labels: 'labels',
}
