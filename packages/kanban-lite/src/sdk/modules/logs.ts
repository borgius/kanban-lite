import * as path from 'path'
import * as fs from 'fs/promises'
import type { Card } from '../../shared/types'
import type { LogEntry } from '../../shared/types'
import type { SDKContext } from './context'

interface PersistedActivityMetadata extends Record<string, unknown> {
  type: string
  qualifiesForUnread: true
}

export interface PersistedActivityBoundary {
  cardId: string
  boardId: string
  logEntry: LogEntry
  qualifiesForUnread: true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function mergeActivityMetadata(
  object: Record<string, unknown> | undefined,
  activity: PersistedActivityMetadata,
): Record<string, unknown> {
  if (isRecord(object?.activity) && typeof object.activity.type === 'string') {
    return object
  }

  return {
    ...(object ?? {}),
    activity,
  }
}

// --- Log helpers ---

function parseLogLine(line: string): LogEntry | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  const match = trimmed.match(/^(\S+)\s+\[([^\]]+)\]\s+(.+)$/)
  if (!match) return null
  const [, timestamp, source, rest] = match
  const jsonMatch = rest.match(/^(.*?)\s+(\{.+\})\s*$/)
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[2])
      return { timestamp, source, text: jsonMatch[1], object: obj }
    } catch {
      // Not valid JSON, treat entire rest as text
    }
  }
  return { timestamp, source, text: rest }
}

function serializeLogEntry(entry: LogEntry): string {
  let line = `${entry.timestamp} [${entry.source}] ${entry.text}`
  if (entry.object && Object.keys(entry.object).length > 0) {
    line += ` ${JSON.stringify(entry.object)}`
  }
  return line
}

function getLogFileName(card: Card): string {
  return `${card.id}.log`
}

async function resolveExistingLogPath(ctx: SDKContext, card: Card): Promise<string | null> {
  const logFileName = getLogFileName(card)

  if (Array.isArray(card.attachments) && card.attachments.includes(logFileName)) {
    return ctx.materializeAttachment(card, logFileName)
  }

  const dir = ctx.getAttachmentStoragePath(card)
  if (!dir) return null
  return path.join(dir, logFileName)
}

async function readLogText(ctx: SDKContext, card: Card): Promise<string> {
  const logAttachment = await ctx.readAttachment(card, getLogFileName(card))
  if (logAttachment) {
    return new TextDecoder().decode(logAttachment.data)
  }

  const existingPath = await resolveExistingLogPath(ctx, card)
  if (!existingPath) return ''
  try {
    return await fs.readFile(existingPath, 'utf-8')
  } catch {
    return ''
  }
}

async function writeLogText(ctx: SDKContext, card: Card, content: string): Promise<void> {
  await ctx.writeAttachment(card, getLogFileName(card), content)
}

async function appendLogText(ctx: SDKContext, card: Card, content: string): Promise<boolean> {
  return ctx.appendAttachment(card, getLogFileName(card), content)
}

async function appendPersistedLogEntry(
  ctx: SDKContext,
  {
    cardId,
    text,
    options,
    boardId,
  }: {
    cardId: string
    text: string
    options?: { source?: string; timestamp?: string; object?: Record<string, unknown> }
    boardId?: string
  },
): Promise<{ card: Card; boardId: string; entry: LogEntry }> {
  if (!text?.trim()) throw new Error('Log text cannot be empty')
  const visibleCard = await ctx.getCard(cardId, boardId)
  if (!visibleCard) throw new Error(`Card not found: ${cardId}`)
  const card = await ctx._getCardRaw(cardId, boardId)
  if (!card) throw new Error(`Card not found: ${cardId}`)

  const resolvedBoardId = card.boardId || ctx._resolveBoardId(boardId)
  const entry: LogEntry = {
    timestamp: options?.timestamp || new Date().toISOString(),
    source: options?.source || 'default',
    text: text.trim(),
    ...(options?.object && Object.keys(options.object).length > 0 ? { object: options.object } : {}),
  }

  const logFileName = getLogFileName(card)
  const line = serializeLogEntry(entry) + '\n'
  const appendedInPlace = await appendLogText(ctx, card, line)
  if (!appendedInPlace) {
    const existingContent = await readLogText(ctx, card)
    const nextContent = existingContent + line
    await writeLogText(ctx, card, nextContent)
  }

  if (!card.attachments.includes(logFileName)) {
    card.attachments.push(logFileName)
    card.modified = new Date().toISOString()
    await ctx._storage.writeCard(card)
  }

  return {
    card,
    boardId: resolvedBoardId,
    entry,
  }
}

// --- Card-level log management ---

/**
 * Returns the absolute path to the log file for a card.
 */
export async function getLogFilePath(ctx: SDKContext, { cardId, boardId }: { cardId: string; boardId?: string }): Promise<string | null> {
  const card = await ctx.getCard(cardId, boardId)
  if (!card) return null
  return resolveExistingLogPath(ctx, card)
}

/**
 * Lists all log entries for a card.
 */
export async function listLogs(ctx: SDKContext, { cardId, boardId }: { cardId: string; boardId?: string }): Promise<LogEntry[]> {
  const card = await ctx.getCard(cardId, boardId)
  if (!card) throw new Error(`Card not found: ${cardId}`)

  const content = await readLogText(ctx, card)
  const entries: LogEntry[] = []
  for (const line of content.split('\n')) {
    const entry = parseLogLine(line)
    if (entry) entries.push(entry)
  }
  return entries
}

/**
 * Lists all log entries for a pre-loaded card without an extra getCard round-trip.
 *
 * Use this in batch operations where the caller already holds the Card object to
 * avoid the redundant listCards scan that the regular listLogs performs internally.
 */
export async function listLogsForCard(ctx: SDKContext, card: Card): Promise<LogEntry[]> {
  const content = await readLogText(ctx, card)
  const entries: LogEntry[] = []
  for (const line of content.split('\n')) {
    const entry = parseLogLine(line)
    if (entry) entries.push(entry)
  }
  return entries
}

/**
 * Adds a log entry to a card.
 */
export async function addLog(
  ctx: SDKContext,
  { cardId, text, options, boardId }: {
    cardId: string
    text: string
    options?: { source?: string; timestamp?: string; object?: Record<string, unknown> }
    boardId?: string
  }
): Promise<LogEntry> {
  const result = await appendPersistedLogEntry(ctx, {
    cardId,
    text,
    boardId,
    options: {
      ...options,
      object: mergeActivityMetadata(
        options?.object,
        {
          type: 'log.explicit',
          qualifiesForUnread: true,
        },
      ),
    },
  })
  return result.entry
}

/**
 * Appends a readable persisted activity entry that participates in the shared
 * unread-driving log surface.
 */
export async function appendActivityLog(
  ctx: SDKContext,
  {
    cardId,
    text,
    eventType,
    metadata,
    boardId,
    source,
    timestamp,
  }: {
    cardId: string
    text: string
    eventType: string
    metadata?: Record<string, unknown>
    boardId?: string
    source?: string
    timestamp?: string
  },
): Promise<PersistedActivityBoundary> {
  const card = await ctx.getCard(cardId, boardId)
  if (!card) throw new Error(`Card not found: ${cardId}`)

  const resolvedBoardId = card.boardId || ctx._resolveBoardId(boardId)
  const logEntry = await ctx.addLog(
    cardId,
    text,
    {
      source: source ?? 'system',
      timestamp,
      object: mergeActivityMetadata(
        isRecord(metadata) ? metadata : undefined,
        {
          type: eventType,
          qualifiesForUnread: true,
        },
      ),
    },
    resolvedBoardId,
  )

  return {
    cardId,
    boardId: resolvedBoardId,
    logEntry,
    qualifiesForUnread: true,
  }
}

/**
 * Clears all log entries for a card by deleting the `.log` file.
 */
export async function clearLogs(ctx: SDKContext, { cardId, boardId }: { cardId: string; boardId?: string }): Promise<void> {
  const visibleCard = await ctx.getCard(cardId, boardId)
  if (!visibleCard) throw new Error(`Card not found: ${cardId}`)
  const card = await ctx._getCardRaw(cardId, boardId)
  if (!card) throw new Error(`Card not found: ${cardId}`)

  const logFileName = getLogFileName(card)
  const logPath = await resolveExistingLogPath(ctx, card)

  if (logPath) {
    try {
      await fs.unlink(logPath)
    } catch {
      // File may not exist or may only exist remotely — that's fine
    }
  }

  if (card.attachments.includes(logFileName)) {
    card.attachments = card.attachments.filter(a => a !== logFileName)
    card.modified = new Date().toISOString()
    await ctx._storage.writeCard(card)
  }
}

// --- Board-level log management ---

/**
 * Returns the absolute path to the board-level log file for a given board.
 */
export function getBoardLogFilePath(ctx: SDKContext, { boardId }: { boardId?: string } = {}): string {
  return path.join(ctx._boardDir(boardId), 'board.log')
}

/**
 * Lists all log entries from the board-level log file.
 */
export async function listBoardLogs(ctx: SDKContext, { boardId }: { boardId?: string } = {}): Promise<LogEntry[]> {
  const logPath = getBoardLogFilePath(ctx, { boardId })
  let content: string
  try {
    content = await fs.readFile(logPath, 'utf-8')
  } catch {
    return []
  }
  const entries: LogEntry[] = []
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const entry = parseLogLine(trimmed)
    if (entry) entries.push(entry)
  }
  return entries
}

/**
 * Appends a new log entry to the board-level log file.
 */
export async function addBoardLog(
  ctx: SDKContext,
  { text, options, boardId }: {
    text: string
    options?: { source?: string; timestamp?: string; object?: Record<string, unknown> }
    boardId?: string
  }
): Promise<LogEntry> {
  const entry: LogEntry = {
    timestamp: options?.timestamp ?? new Date().toISOString(),
    source: options?.source ?? 'sdk',
    text,
    ...(options?.object ? { object: options.object } : {}),
  }
  const logPath = getBoardLogFilePath(ctx, { boardId })
  await fs.mkdir(path.dirname(logPath), { recursive: true })
  const line = serializeLogEntry(entry) + '\n'
  await fs.appendFile(logPath, line, 'utf-8')
  return entry
}

/**
 * Clears all log entries for a board by deleting the board-level `board.log` file.
 */
export async function clearBoardLogs(ctx: SDKContext, { boardId }: { boardId?: string } = {}): Promise<void> {
  const logPath = getBoardLogFilePath(ctx, { boardId })
  try {
    await fs.unlink(logPath)
  } catch {
    // File may not exist — that's fine
  }
}
