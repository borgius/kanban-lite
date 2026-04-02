import { readConfig, writeConfig } from '../../shared/config'
import type { LabelDefinition, Card } from '../../shared/types'
import type { SDKContext } from './context'
import type { AuthContext } from '../types'
import { isReservedChecklistLabel, projectCardChecklistState } from './checklist'

type AuthScopedLabelsContext = SDKContext & {
  readonly _currentAuthContext?: AuthContext
}

async function canShowChecklistLabels(ctx: SDKContext): Promise<boolean> {
  const capabilities = ctx.capabilities
  if (!capabilities) {
    return true
  }

  const activeAuthContext = (ctx as AuthScopedLabelsContext)._currentAuthContext ?? {}

  try {
    const identity = await capabilities.authIdentity.resolveIdentity(activeAuthContext)
    const decision = await capabilities.authPolicy.checkPolicy(identity, 'card.checklist.show', activeAuthContext)
    return decision.allowed
  } catch {
    return false
  }
}

function getCascadeLabels(card: Card, checklistVisible: boolean): string[] {
  return projectCardChecklistState(card, checklistVisible).labels
}

// --- Label definition management ---

function filterReservedChecklistLabelDefinitions(labels: Record<string, LabelDefinition> | undefined): Record<string, LabelDefinition> {
  if (!labels) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(labels).filter(([name]) => !isReservedChecklistLabel(name)),
  )
}

/**
 * Returns all label definitions from the workspace configuration.
 */
export function getLabels(ctx: SDKContext): Record<string, LabelDefinition> {
  const config = readConfig(ctx.workspaceRoot)
  return filterReservedChecklistLabelDefinitions(config.labels)
}

/**
 * Creates or updates a label definition in the workspace configuration.
 */
export function setLabel(ctx: SDKContext, { name, definition }: { name: string; definition: LabelDefinition }): void {
  if (isReservedChecklistLabel(name)) {
    throw new Error(`Cannot define reserved checklist label: ${name}`)
  }

  const config = readConfig(ctx.workspaceRoot)
  config.labels = {
    ...filterReservedChecklistLabelDefinitions(config.labels),
    [name]: definition,
  }
  writeConfig(ctx.workspaceRoot, config)
}

/**
 * Removes a label definition and cascades the deletion to all cards.
 */
export async function deleteLabel(ctx: SDKContext, { name }: { name: string }): Promise<void> {
  if (isReservedChecklistLabel(name)) {
    throw new Error(`Cannot delete reserved checklist label: ${name}`)
  }

  const config = readConfig(ctx.workspaceRoot)
  if (config.labels) {
    delete config.labels[name]
    writeConfig(ctx.workspaceRoot, config)
  }

  const cards = await ctx._listCardsRaw()
  const checklistVisible = await canShowChecklistLabels(ctx)
  for (const card of cards) {
    if (card.labels.includes(name)) {
      await ctx.updateCard(card.id, { labels: getCascadeLabels(card, checklistVisible).filter(l => l !== name) })
    }
  }
}

/**
 * Renames a label in the configuration and cascades the change to all cards.
 */
export async function renameLabel(ctx: SDKContext, { oldName, newName }: { oldName: string; newName: string }): Promise<void> {
  if (isReservedChecklistLabel(oldName)) {
    throw new Error(`Cannot rename reserved checklist label: ${oldName}`)
  }
  if (isReservedChecklistLabel(newName)) {
    throw new Error(`Cannot rename a label into reserved checklist label: ${newName}`)
  }

  const config = readConfig(ctx.workspaceRoot)
  if (config.labels && config.labels[oldName]) {
    config.labels[newName] = config.labels[oldName]
    delete config.labels[oldName]
    writeConfig(ctx.workspaceRoot, config)
  }

  const cards = await ctx._listCardsRaw()
  const checklistVisible = await canShowChecklistLabels(ctx)
  for (const card of cards) {
    if (card.labels.includes(oldName)) {
      const newLabels = getCascadeLabels(card, checklistVisible).map(l => l === oldName ? newName : l)
      await ctx.updateCard(card.id, { labels: newLabels })
    }
  }
}

/**
 * Returns a sorted list of label names that belong to the given group.
 */
export function getLabelsInGroup(ctx: SDKContext, { group }: { group: string }): string[] {
  const labels = getLabels(ctx)
  return Object.entries(labels)
    .filter(([, def]) => def.group === group)
    .map(([name]) => name)
    .sort()
}

/**
 * Returns all cards that have at least one label belonging to the given group.
 */
export async function filterCardsByLabelGroup(ctx: SDKContext, { group, boardId }: { group: string; boardId?: string }): Promise<Card[]> {
  const groupLabels = getLabelsInGroup(ctx, { group })
  if (groupLabels.length === 0) return []
  const cards = await ctx.listCards(undefined, boardId)
  return cards.filter(c => c.labels.some(l => groupLabels.includes(l)))
}
