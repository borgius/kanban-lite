import { KanbanSDK } from '../sdk/KanbanSDK'
import { buildChecklistReadModel } from '../sdk/modules/checklist'
import type { Card } from '../shared/types'
import { getTitleFromContent } from '../shared/types'

export const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
export const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
export const green = (s: string) => `\x1b[32m${s}\x1b[0m`
export const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
export const red = (s: string) => `\x1b[31m${s}\x1b[0m`
export const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`
export const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`

export function colorStatus(status: string): string {
  switch (status) {
    case 'backlog': return dim(status)
    case 'todo': return cyan(status)
    case 'in-progress': return yellow(status)
    case 'review': return magenta(status)
    case 'done': return green(status)
    default: return status
  }
}

export function colorPriority(priority: string): string {
  switch (priority) {
    case 'critical': return red(priority)
    case 'high': return yellow(priority)
    case 'medium': return priority
    case 'low': return dim(priority)
    default: return priority
  }
}

function formatCardStateCursor(cursor: unknown): string {
  return cursor ? JSON.stringify(cursor) : '-'
}

export function printCardStateStatus(status: ReturnType<KanbanSDK['getCardStateStatus']>): void {
  console.log(`Card-state provider: ${bold(status.provider)}`)
  console.log(`Backend:             ${status.backend}`)
  console.log(`Availability:        ${status.availability === 'available' ? green(status.availability) : yellow(status.availability)}`)
  console.log(`Active:              ${status.active ? green('yes') : yellow('no')}`)
  console.log(`Default actor:       ${status.defaultActor.id} (${status.defaultActor.source}, ${status.defaultActor.mode})`)
  console.log(`Default actor ready: ${status.defaultActorAvailable ? green('yes') : yellow('no')}`)
  if (status.errorCode) console.log(`Error code:          ${status.errorCode}`)
}

export function printCardStateReadModel(label: string, payload: {
  cardId: string
  boardId: string
  cardState: {
    unread: Awaited<ReturnType<KanbanSDK['getUnreadSummary']>>
    open: Awaited<ReturnType<KanbanSDK['getCardState']>>
  }
}): void {
  console.log(`${bold(label)} ${bold(payload.cardId)}`)
  console.log(`  Board:            ${payload.boardId}`)
  console.log(`  Actor:            ${payload.cardState.unread.actorId}`)
  console.log(`  Unread:           ${payload.cardState.unread.unread ? yellow('yes') : green('no')}`)
  console.log(`  Latest activity:  ${formatCardStateCursor(payload.cardState.unread.latestActivity)}`)
  console.log(`  Read through:     ${formatCardStateCursor(payload.cardState.unread.readThrough)}`)
  console.log(`  Open state:       ${payload.cardState.open ? formatCardStateCursor(payload.cardState.open.value) : '-'}`)
}

export function printCardStateMutationModel(label: string, payload: {
  unread: Awaited<ReturnType<KanbanSDK['getUnreadSummary']>>
  cardState: {
    unread: Awaited<ReturnType<KanbanSDK['getUnreadSummary']>>
    open: Awaited<ReturnType<KanbanSDK['getCardState']>>
  }
}): void {
  printCardStateReadModel(label, {
    cardId: payload.unread.cardId,
    boardId: payload.unread.boardId,
    cardState: payload.cardState,
  })
}

export function printChecklistReadModel(payload: ReturnType<typeof buildChecklistReadModel>): void {
  console.log(`${bold(payload.cardId)} (${payload.summary.completed}/${payload.summary.total} complete)`)
  console.log(`  Token:            ${payload.token}`)
  if (payload.items.length === 0) {
    console.log(dim('  No checklist items.'))
    return
  }

  for (const item of payload.items) {
    console.log(`  ${bold(String(item.index))}. ${item.checked ? green('[x]') : dim('[ ]')} ${item.title || dim('(empty)')}`)
    if (item.description.trim().length > 0) {
      console.log(`     ${dim(item.description.split('\n').join('\n     '))}`)
    }
  }
}

type PluginSettingsListModel = Awaited<ReturnType<KanbanSDK['listPluginSettings']>>
type PluginSettingsReadModel = NonNullable<Awaited<ReturnType<KanbanSDK['getPluginSettings']>>>
type PluginSettingsInstallModel = Awaited<ReturnType<KanbanSDK['installPluginSettingsPackage']>>

export function printPluginSettingsList(payload: PluginSettingsListModel): void {
  for (const capability of payload.capabilities) {
    console.log(bold(capability.capability))
    console.log(`  Selected provider: ${capability.selected.providerId ?? 'none'} (${capability.selected.source})`)
    if (capability.providers.length === 0) {
      console.log('  Providers: none discovered')
      continue
    }

    for (const provider of capability.providers) {
      console.log(`  - ${provider.providerId}${provider.isSelected ? ' [selected]' : ''} (${provider.packageName}, ${provider.discoverySource})`)
    }
  }
}

export function printPluginSettingsReadModel(payload: PluginSettingsReadModel): void {
  console.log(`Capability:        ${bold(payload.capability)}`)
  console.log(`Provider:          ${bold(payload.providerId)}`)
  console.log(`Package:           ${payload.packageName}`)
  console.log(`Discovery source:  ${payload.discoverySource}`)
  console.log(`Selected provider: ${payload.selected.providerId ?? 'none'} (${payload.selected.source})`)
  if (payload.optionsSchema?.secrets?.length) {
    console.log(`Secret fields:     ${payload.optionsSchema.secrets.map(secret => secret.path).join(', ')}`)
  }
  if (payload.options) {
    console.log('Options:')
    console.log(JSON.stringify(payload.options.values, null, 2))
  } else {
    console.log('Options:           none')
  }
}

export function printPluginSettingsDisabledSelection(capability: string): void {
  console.log(`Capability:        ${bold(capability)}`)
  console.log('Selected provider: none (none)')
  console.log('Options:           preserved in config until you re-enable a provider')
}

function formatPluginSettingsCommand(command: { command: string; args: string[] }): string {
  return [command.command, ...command.args].join(' ')
}

export function printPluginSettingsInstallResult(result: PluginSettingsInstallModel): void {
  console.log(green(result.message))
  console.log(`Package:           ${bold(result.packageName)}`)
  console.log(`Scope:             ${result.scope}`)
  console.log(`Command:           ${formatPluginSettingsCommand(result.command)}`)
  if (result.stdout) {
    console.log('Sanitized stdout:')
    console.log(result.stdout)
  }
  if (result.stderr) {
    console.log('Sanitized stderr:')
    console.log(result.stderr)
  }
}

export function formatCardRow(c: Card, title: string = getTitleFromContent(c.content)): string {
  const truncTitle = title.length > 40 ? title.slice(0, 37) + '...' : title
  const assignee = c.assignee || '-'
  return `  ${bold(c.id.slice(0, 30).padEnd(30))}  ${colorStatus(c.status.padEnd(12))}  ${colorPriority(c.priority.padEnd(8))}  ${assignee.padEnd(12)}  ${truncTitle}`
}

export function formatCardDetail(c: Card, title: string = getTitleFromContent(c.content)): string {
  const lines = [
    `${bold(title)}`,
    '',
    `  ID:        ${c.id}`,
    `  Status:    ${colorStatus(c.status)}`,
    `  Priority:  ${colorPriority(c.priority)}`,
    `  Assignee:  ${c.assignee || '-'}`,
    `  Due:       ${c.dueDate || '-'}`,
    `  Labels:    ${c.labels.length > 0 ? c.labels.join(', ') : '-'}`,
    `  Created:   ${c.created}`,
    `  Modified:  ${c.modified}`,
    `  File:      ${c.filePath}`,
  ]
  if (c.boardId) {
    lines.push(`  Board:     ${c.boardId}`)
  }
  if (c.completedAt) {
    lines.push(`  Completed: ${c.completedAt}`)
  }
  if (c.metadata && Object.keys(c.metadata).length > 0) {
    lines.push(`  Metadata:  ${JSON.stringify(c.metadata, null, 2).split('\n').join('\n             ')}`)
  }
  const body = c.content.replace(/^#\s+.+\n?/, '').trim()
  if (body) {
    lines.push('', dim('  --- Content ---'), '', '  ' + body.split('\n').join('\n  '))
  }
  return lines.join('\n')
}

export function printAvailableEvents(events: ReturnType<KanbanSDK['listAvailableEvents']>): void {
  if (events.length === 0) {
    console.log(dim('  No events matched.'))
    return
  }

  console.log(`  ${dim('EVENT'.padEnd(36))}  ${dim('PHASE'.padEnd(8))}  ${dim('SOURCE'.padEnd(8))}  ${dim('PLUGINS')}`)
  console.log(dim(`  ${'-'.repeat(90)}`))
  for (const event of events) {
    const plugins = event.pluginIds && event.pluginIds.length > 0 ? event.pluginIds.join(', ') : '-'
    console.log(`  ${bold(event.event.padEnd(36))}  ${event.phase.padEnd(8)}  ${event.source.padEnd(8)}  ${plugins}`)
  }
}
