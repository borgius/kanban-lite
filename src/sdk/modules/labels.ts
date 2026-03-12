import { readConfig, writeConfig } from '../../shared/config'
import type { LabelDefinition, Card } from '../../shared/types'
import type { SDKContext } from './context'

// --- Label definition management ---

/**
 * Returns all label definitions from the workspace configuration.
 */
export function getLabels(ctx: SDKContext): Record<string, LabelDefinition> {
  const config = readConfig(ctx.workspaceRoot)
  return config.labels || {}
}

/**
 * Creates or updates a label definition in the workspace configuration.
 */
export function setLabel(ctx: SDKContext, name: string, definition: LabelDefinition): void {
  const config = readConfig(ctx.workspaceRoot)
  if (!config.labels) config.labels = {}
  config.labels[name] = definition
  writeConfig(ctx.workspaceRoot, config)
}

/**
 * Removes a label definition and cascades the deletion to all cards.
 */
export async function deleteLabel(ctx: SDKContext, name: string): Promise<void> {
  const config = readConfig(ctx.workspaceRoot)
  if (config.labels) {
    delete config.labels[name]
    writeConfig(ctx.workspaceRoot, config)
  }

  const cards = await ctx.listCards()
  for (const card of cards) {
    if (card.labels.includes(name)) {
      await ctx.updateCard(card.id, { labels: card.labels.filter(l => l !== name) })
    }
  }
}

/**
 * Renames a label in the configuration and cascades the change to all cards.
 */
export async function renameLabel(ctx: SDKContext, oldName: string, newName: string): Promise<void> {
  const config = readConfig(ctx.workspaceRoot)
  if (config.labels && config.labels[oldName]) {
    config.labels[newName] = config.labels[oldName]
    delete config.labels[oldName]
    writeConfig(ctx.workspaceRoot, config)
  }

  const cards = await ctx.listCards()
  for (const card of cards) {
    if (card.labels.includes(oldName)) {
      const newLabels = card.labels.map(l => l === oldName ? newName : l)
      await ctx.updateCard(card.id, { labels: newLabels })
    }
  }
}

/**
 * Returns a sorted list of label names that belong to the given group.
 */
export function getLabelsInGroup(ctx: SDKContext, group: string): string[] {
  const labels = getLabels(ctx)
  return Object.entries(labels)
    .filter(([, def]) => def.group === group)
    .map(([name]) => name)
    .sort()
}

/**
 * Returns all cards that have at least one label belonging to the given group.
 */
export async function filterCardsByLabelGroup(ctx: SDKContext, group: string, boardId?: string): Promise<Card[]> {
  const groupLabels = getLabelsInGroup(ctx, group)
  if (groupLabels.length === 0) return []
  const cards = await ctx.listCards(undefined, boardId)
  return cards.filter(c => c.labels.some(l => groupLabels.includes(l)))
}
