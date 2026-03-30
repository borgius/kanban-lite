export type SettingsTab = 'general' | 'defaults' | 'labels' | 'pluginOptions'

/** URL-safe slug → internal SettingsTab */
export const SETTINGS_TAB_FROM_SLUG: Record<string, SettingsTab> = {
  general: 'general',
  defaults: 'defaults',
  labels: 'labels',
  plugins: 'pluginOptions',
}

/** Internal SettingsTab → URL-safe slug */
export const SETTINGS_TAB_TO_SLUG: Record<SettingsTab, string> = {
  general: 'general',
  defaults: 'defaults',
  labels: 'labels',
  pluginOptions: 'plugins',
}