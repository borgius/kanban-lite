import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type {
  CardStateCursor,
  CardStateKey,
  CardStateValue,
  CardStateModuleContext,
  CardStateProvider,
  CardStateRecord,
  CardStateUnreadKey,
  CardStateWriteInput,
  CardStateReadThroughInput,
} from './index'

interface StoredCardStateDomain<TValue = CardStateValue> {
  value: TValue
  updatedAt: string
}

interface StoredCardStateDocument {
  actorId: string
  boardId: string
  cardId: string
  domains: Record<string, StoredCardStateDomain<CardStateValue>>
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value)
}

function getCardStateRoot(context: CardStateModuleContext): string {
  return path.join(context.kanbanDir, 'card-state')
}

function getCardStateFilePath(context: CardStateModuleContext, input: Pick<CardStateKey, 'actorId' | 'boardId' | 'cardId'>): string {
  return path.join(
    getCardStateRoot(context),
    encodePathSegment(input.actorId),
    encodePathSegment(input.boardId),
    `${encodePathSegment(input.cardId)}.json`,
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isStoredCardStateDomain(value: unknown): value is StoredCardStateDomain {
  return isRecord(value)
    && typeof value.updatedAt === 'string'
    && 'value' in value
}

function isStoredCardStateDocument(value: unknown): value is StoredCardStateDocument {
  if (!isRecord(value)) return false
  if (typeof value.actorId !== 'string' || typeof value.boardId !== 'string' || typeof value.cardId !== 'string') {
    return false
  }

  if (!isRecord(value.domains)) return false
  return Object.values(value.domains).every((entry) => isStoredCardStateDomain(entry))
}

function isCardStateCursor(value: unknown): value is CardStateCursor {
  return isRecord(value)
    && typeof value.cursor === 'string'
    && (value.updatedAt === undefined || typeof value.updatedAt === 'string')
}

function createStoredDocument(input: Pick<CardStateKey, 'actorId' | 'boardId' | 'cardId'>): StoredCardStateDocument {
  return {
    actorId: input.actorId,
    boardId: input.boardId,
    cardId: input.cardId,
    domains: {},
  }
}

function toCardStateRecord<TValue>(
  input: CardStateKey,
  domain: string,
  entry: StoredCardStateDomain<TValue>,
): CardStateRecord<TValue> {
  return {
    actorId: input.actorId,
    boardId: input.boardId,
    cardId: input.cardId,
    domain,
    value: entry.value,
    updatedAt: entry.updatedAt,
  }
}

async function readStoredDocument(
  context: CardStateModuleContext,
  input: Pick<CardStateKey, 'actorId' | 'boardId' | 'cardId'>,
): Promise<StoredCardStateDocument | null> {
  try {
    const raw = await fs.readFile(getCardStateFilePath(context, input), 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    return isStoredCardStateDocument(parsed) ? parsed : null
  } catch {
    return null
  }
}

async function writeStoredDocument(context: CardStateModuleContext, document: StoredCardStateDocument): Promise<void> {
  const filePath = getCardStateFilePath(context, document)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(document, null, 2), 'utf-8')
}

function getDomainUpdatedAt(updatedAt?: string): string {
  return updatedAt ?? new Date().toISOString()
}

export function createFileBackedCardStateProvider(context: CardStateModuleContext): CardStateProvider {
  return {
    manifest: { id: 'localfs', provides: ['card.state'] },
    async getCardState(input: CardStateKey): Promise<CardStateRecord | null> {
      const stored = await readStoredDocument(context, input)
      if (!stored) return null
      const entry = stored.domains[input.domain]
      if (!isStoredCardStateDomain(entry)) return null
      return toCardStateRecord(input, input.domain, entry)
    },
    async setCardState(input: CardStateWriteInput): Promise<CardStateRecord> {
      const stored = await readStoredDocument(context, input) ?? createStoredDocument(input)
      const updatedAt = getDomainUpdatedAt(input.updatedAt)
      stored.domains[input.domain] = {
        value: input.value,
        updatedAt,
      }
      await writeStoredDocument(context, stored)
      return {
        actorId: input.actorId,
        boardId: input.boardId,
        cardId: input.cardId,
        domain: input.domain,
        value: input.value,
        updatedAt,
      }
    },
    async getUnreadCursor(input: CardStateUnreadKey): Promise<CardStateCursor | null> {
      const record = await this.getCardState({ ...input, domain: 'unread' })
      return record && isCardStateCursor(record.value)
        ? record.value
        : null
    },
    async markUnreadReadThrough(input: CardStateReadThroughInput): Promise<CardStateRecord<CardStateCursor>> {
      const updatedAt = getDomainUpdatedAt(input.cursor.updatedAt)
      await this.setCardState({
        actorId: input.actorId,
        boardId: input.boardId,
        cardId: input.cardId,
        domain: 'unread',
        value: {
          cursor: input.cursor.cursor,
          updatedAt,
        },
        updatedAt,
      })
      return {
        actorId: input.actorId,
        boardId: input.boardId,
        cardId: input.cardId,
        domain: 'unread',
        value: {
          cursor: input.cursor.cursor,
          updatedAt,
        },
        updatedAt,
      }
    },
  }
}
