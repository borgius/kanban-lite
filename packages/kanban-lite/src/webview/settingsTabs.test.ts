import { describe, expect, it } from 'vitest'
import {
  BOARD_SETTINGS_TAB_FROM_SLUG,
  BOARD_SETTINGS_TAB_TO_SLUG,
  DEFAULT_BOARD_SUBTAB,
  LEGACY_BOARD_SETTINGS_TAB_FROM_SETTINGS_SLUG,
  SETTINGS_TAB_FROM_SLUG,
  SETTINGS_TAB_TO_SLUG,
} from './settingsTabs'

describe('settings tab slug mappings', () => {
  it('round-trips top-level settings tabs through URL-safe slugs', () => {
    expect(SETTINGS_TAB_FROM_SLUG[SETTINGS_TAB_TO_SLUG.general]).toBe('general')
    expect(SETTINGS_TAB_FROM_SLUG[SETTINGS_TAB_TO_SLUG.board]).toBe('board')
    expect(SETTINGS_TAB_FROM_SLUG[SETTINGS_TAB_TO_SLUG.pluginOptions]).toBe('pluginOptions')
  })

  it('round-trips board settings sub-tabs through nested route slugs', () => {
    expect(BOARD_SETTINGS_TAB_FROM_SLUG[BOARD_SETTINGS_TAB_TO_SLUG.defaults]).toBe('defaults')
    expect(BOARD_SETTINGS_TAB_FROM_SLUG[BOARD_SETTINGS_TAB_TO_SLUG.title]).toBe('title')
    expect(BOARD_SETTINGS_TAB_FROM_SLUG[BOARD_SETTINGS_TAB_TO_SLUG.actions]).toBe('actions')
    expect(BOARD_SETTINGS_TAB_FROM_SLUG[BOARD_SETTINGS_TAB_TO_SLUG.labels]).toBe('labels')
    expect(BOARD_SETTINGS_TAB_FROM_SLUG[BOARD_SETTINGS_TAB_TO_SLUG.meta]).toBe('meta')
    expect(DEFAULT_BOARD_SUBTAB).toBe('defaults')
  })

  it('maps legacy top-level defaults and labels URLs into board sub-tabs', () => {
    expect(LEGACY_BOARD_SETTINGS_TAB_FROM_SETTINGS_SLUG.defaults).toBe('defaults')
    expect(LEGACY_BOARD_SETTINGS_TAB_FROM_SETTINGS_SLUG.labels).toBe('labels')
  })
})
