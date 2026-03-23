import * as os from 'node:os'
import * as path from 'path'
import * as fs from 'fs/promises'
import type { Card } from '../../shared/types'
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
  const existingPath = await resolveExistingLogPath(ctx, card)
  if (!existingPath) return ''
  try {
    return await fs.readFile(existingPath, 'utf-8')
  } catch {
    return ''
  }
}

async function writeLogText(ctx: SDKContext, card: Card, content: string): Promise<void> {
  const logFileName = getLogFileName(card)
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kanban-log-'))
  const tempPath = path.join(tempDir, logFileName)

  try {
    await fs.writeFile(tempPath, content, 'utf-8')
    await ctx.copyAttachment(tempPath, card)
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}

async function appendLogText(ctx: SDKContext, card: Card, content: string): Promise<boolean> {
  return ctx.appendAttachment(card, getLogFileName(card), content)
}

// --- Card-level log management ---

/**
 * Returns the absolute path to the log file for a card.
 */
export async function getLogFilePath(ctx: SDKContext, cardId: string, boardId?: string): Promise<string | null> {
  const card = await ctx.getCard(cardId, boardId)
  if (!card) return null
  return resolveExistingLogPath(ctx, card)
}

/**
 * Lists all log entries for a card.
 */
export async function listLogs(ctx: SDKContext, cardId: string, boardId?: string): Promise<LogEntry[]> {
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

  return entry
}

/**
 * Clears all log entries for a card by deleting the `.log` file.
 */
export async function clearLogs(ctx: SDKContext, cardId: string, boardId?: string): Promise<void> {
  const card = await ctx.getCard(cardId, boardId)
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
}
