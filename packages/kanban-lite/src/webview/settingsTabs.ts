export type SettingsTab = 'general' | 'board' | 'pluginOptions'

/** Sub-tab within the "Board" tab */
export type BoardSubTab = 'defaults' | 'title' | 'actions' | 'labels' | 'meta'

/** URL-safe slug → internal SettingsTab */
export const SETTINGS_TAB_FROM_SLUG: Record<string, SettingsTab> = {
  general: 'general',
  board: 'board',
  /** Legacy slugs for backward-compat URL navigation */
  defaults: 'board',
  labels: 'board',
  plugins: 'pluginOptions',
}

/** Internal SettingsTab → URL-safe slug */
export const SETTINGS_TAB_TO_SLUG: Record<SettingsTab, string> = {
  general: 'general',
  board: 'board',
  pluginOptions: 'plugins',
}
