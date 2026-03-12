import * as path from 'path'
import * as fs from 'fs/promises'
import type { LogEntry } from '../../shared/types'
import type { SDKContext } from './context'

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

// --- Card-level log management ---

/**
 * Returns the absolute path to the log file for a card.
 */
export async function getLogFilePath(ctx: SDKContext, cardId: string, boardId?: string): Promise<string | null> {
  const card = await ctx.getCard(cardId, boardId)
  if (!card) return null
  const dir = ctx._storage.getCardDir(card)
  return path.join(dir, `${card.id}.log`)
}

/**
 * Lists all log entries for a card.
 */
export async function listLogs(ctx: SDKContext, cardId: string, boardId?: string): Promise<LogEntry[]> {
  const logPath = await getLogFilePath(ctx, cardId, boardId)
  if (!logPath) throw new Error(`Card not found: ${cardId}`)
  try {
    const content = await fs.readFile(logPath, 'utf-8')
    const entries: LogEntry[] = []
    for (const line of content.split('\n')) {
      const entry = parseLogLine(line)
      if (entry) entries.push(entry)
    }
    return entries
  } catch {
    return []
  }
}

/**
 * Adds a log entry to a card.
 */
export async function addLog(
  ctx: SDKContext,
  cardId: string,
  text: string,
  options?: { source?: string; timestamp?: string; object?: Record<string, any> },
  boardId?: string
): Promise<LogEntry> {
  if (!text?.trim()) throw new Error('Log text cannot be empty')
  const card = await ctx.getCard(cardId, boardId)
  if (!card) throw new Error(`Card not found: ${cardId}`)

  const entry: LogEntry = {
    timestamp: options?.timestamp || new Date().toISOString(),
    source: options?.source || 'default',
    text: text.trim(),
    ...(options?.object && Object.keys(options.object).length > 0 ? { object: options.object } : {}),
  }

  const dir = ctx._storage.getCardDir(card)
  const logFileName = `${card.id}.log`
  const logPath = path.join(dir, logFileName)

  await fs.mkdir(dir, { recursive: true })

  const line = serializeLogEntry(entry) + '\n'
  await fs.appendFile(logPath, line, 'utf-8')

  if (!card.attachments.includes(logFileName)) {
    card.attachments.push(logFileName)
    card.modified = new Date().toISOString()
    await ctx._storage.writeCard(card)
  }

  ctx.emitEvent('log.added', { cardId, entry })
  return entry
}

/**
 * Clears all log entries for a card by deleting the `.log` file.
 */
export async function clearLogs(ctx: SDKContext, cardId: string, boardId?: string): Promise<void> {
  const card = await ctx.getCard(cardId, boardId)
  if (!card) throw new Error(`Card not found: ${cardId}`)

  const logFileName = `${card.id}.log`
  const dir = ctx._storage.getCardDir(card)
  const logPath = path.join(dir, logFileName)

  try {
    await fs.unlink(logPath)
  } catch {
    // File may not exist — that's fine
  }

  if (card.attachments.includes(logFileName)) {
    card.attachments = card.attachments.filter(a => a !== logFileName)
    card.modified = new Date().toISOString()
    await ctx._storage.writeCard(card)
  }

  ctx.emitEvent('log.cleared', { cardId })
}

// --- Board-level log management ---

/**
 * Returns the absolute path to the board-level log file for a given board.
 */
export function getBoardLogFilePath(ctx: SDKContext, boardId?: string): string {
  return path.join(ctx._boardDir(boardId), 'board.log')
}

/**
 * Lists all log entries from the board-level log file.
 */
export async function listBoardLogs(ctx: SDKContext, boardId?: string): Promise<LogEntry[]> {
  const logPath = getBoardLogFilePath(ctx, boardId)
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
  text: string,
  options?: { source?: string; timestamp?: string; object?: Record<string, unknown> },
  boardId?: string
): Promise<LogEntry> {
  const entry: LogEntry = {
    timestamp: options?.timestamp ?? new Date().toISOString(),
    source: options?.source ?? 'sdk',
    text,
    ...(options?.object ? { object: options.object } : {}),
  }
  const logPath = getBoardLogFilePath(ctx, boardId)
  await fs.mkdir(path.dirname(logPath), { recursive: true })
  const line = serializeLogEntry(entry) + '\n'
  await fs.appendFile(logPath, line, 'utf-8')
  ctx.emitEvent('board.log.added', { boardId, entry })
  return entry
}

/**
 * Clears all log entries for a board by deleting the board-level `board.log` file.
 */
export async function clearBoardLogs(ctx: SDKContext, boardId?: string): Promise<void> {
  const logPath = getBoardLogFilePath(ctx, boardId)
  try {
    await fs.unlink(logPath)
  } catch {
    // File may not exist — that's fine
  }
  ctx.emitEvent('board.log.cleared', { boardId })
}
