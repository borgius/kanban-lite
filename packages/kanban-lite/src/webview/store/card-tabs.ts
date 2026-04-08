import { create } from 'zustand'
import type { Card, KanbanColumn, Priority, CardDisplaySettings, BoardInfo, WorkspaceInfo, LabelDefinition, CardFormAttachment, CardStateReadModelTransport, CardViewMode } from '../../shared/types'
import { matchesCardSearch, parseSearchQuery } from '../../sdk/metaUtils'
import { generateSlug, normalizeBoardBackgroundSettings } from '../../shared/types'
import { clampDrawerWidthPercent } from '../drawerResize'
import type { SettingsTab } from '../settingsTabs'

export type DueDateFilter = 'all' | 'overdue' | 'today' | 'this-week' | 'no-date'
export type LayoutMode = 'horizontal' | 'vertical'
export type SortOrder = 'order' | 'created:asc' | 'created:desc' | 'modified:asc' | 'modified:desc'
export const FIXED_CARD_TABS = ['write', 'preview', 'tasks', 'comments', 'logs'] as const
export const DEFAULT_CARD_TAB = 'preview'

export type FixedCardTab = (typeof FIXED_CARD_TABS)[number]
export type FormCardTab = `form:${string}`
export type CardTab = FixedCardTab | FormCardTab

export const FORM_CARD_TAB_PREFIX = 'form:'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function isFixedCardTab(tab: string): tab is FixedCardTab {
  return (FIXED_CARD_TABS as readonly string[]).includes(tab)
}

export function isFormCardTab(tab: string): tab is FormCardTab {
  return tab.startsWith(FORM_CARD_TAB_PREFIX) && tab.length > FORM_CARD_TAB_PREFIX.length
}

export function isCardTabRouteCandidate(tab: string): tab is CardTab {
  return isFixedCardTab(tab) || isFormCardTab(tab)
}

export function createFormCardTabId(formId: string): FormCardTab {
  return `${FORM_CARD_TAB_PREFIX}${formId}` as FormCardTab
}

export function sanitizeCardTab(tab: string): CardTab {
  return isCardTabRouteCandidate(tab) ? tab : DEFAULT_CARD_TAB
}

export function hasResolvedAttachmentSchema(attachment: CardFormAttachment, board?: BoardInfo): boolean {
  if (isRecord(attachment.schema)) {
    return true
  }

  return Boolean(
    attachment.name
    && board?.forms
    && isRecord(board.forms[attachment.name]?.schema)
  )
}

export function getCardFormTabIds(card?: Pick<Card, 'forms'> | null, board?: BoardInfo): FormCardTab[] {
  const attachments = card?.forms ?? []
  if (attachments.length === 0) {
    return []
  }

  const usedIds = new Set<string>()

  return attachments.flatMap((attachment, index) => {
    if (!hasResolvedAttachmentSchema(attachment, board)) {
      return []
    }

    const schema = isRecord(attachment.schema) ? attachment.schema : undefined
    const baseId = attachment.name
      ?? (schema && typeof schema.title === 'string' && schema.title.trim().length > 0
        ? generateSlug(schema.title)
        : `form-${index}`)

    let candidate = baseId || `form-${index}`
    let suffix = 2

    while (usedIds.has(candidate)) {
      candidate = `${baseId}-${suffix++}`
    }

    usedIds.add(candidate)
    return [createFormCardTabId(candidate)]
  })
}

export function normalizeCardTab(tab: string, card?: Pick<Card, 'forms'> | null, board?: BoardInfo): CardTab {
  const candidate = sanitizeCardTab(tab)

  if (!card || isFixedCardTab(candidate)) {
    return candidate
  }

  return isFormCardTab(candidate) && getCardFormTabIds(card, board).includes(candidate)
    ? candidate
    : DEFAULT_CARD_TAB
}


