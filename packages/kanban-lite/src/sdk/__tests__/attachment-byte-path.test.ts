import { describe, expect, it, vi } from 'vitest'
import type { Card } from '../../shared/types'
import type { StorageEngine } from '../plugins/types'
import type { SDKContext } from '../modules/context'
import { addAttachmentData, getAttachmentData } from '../modules/attachments'
import { addLog, listLogs } from '../modules/logs'

function toBytes(value: string | Uint8Array): Uint8Array {
  return typeof value === 'string' ? new TextEncoder().encode(value) : value
}

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    version: 2,
    id: 'card-1',
    boardId: 'default',
    status: 'backlog',
    priority: 'medium',
    title: 'Card 1',
    content: 'Card 1',
    created: '2026-04-06T00:00:00.000Z',
    modified: '2026-04-06T00:00:00.000Z',
    labels: [],
    attachments: [],
    comments: [],
    tasks: [],
    ...overrides,
  }
}

function createContext(initialCard: Card): SDKContext & {
  readonly copyAttachment: ReturnType<typeof vi.fn>
  readonly materializeAttachment: ReturnType<typeof vi.fn>
  readonly attachmentWrites: Uint8Array[]
} {
  const cards = new Map<string, Card>([[initialCard.id, structuredClone(initialCard)]])
  const attachmentStore = new Map<string, Uint8Array>()
  const attachmentWrites: Uint8Array[] = []
  const copyAttachment = vi.fn(async () => {
    throw new Error('copyAttachment should not be used when byte helpers are available')
  })
  const materializeAttachment = vi.fn(async () => {
    throw new Error('materializeAttachment should not be used when byte helpers are available')
  })
  const storage: Pick<StorageEngine, 'writeCard'> = {
    async writeCard(card: Card): Promise<void> {
      cards.set(card.id, structuredClone(card))
    },
  }

  return {
    workspaceRoot: '/virtual/workspace',
    kanbanDir: '/virtual/workspace/.kanban',
    _storage: storage as StorageEngine,
    capabilities: null,
    _resolveBoardId(boardId?: string): string {
      return boardId ?? 'default'
    },
    _boardDir(boardId?: string): string {
      return `/virtual/workspace/.kanban/boards/${boardId ?? 'default'}`
    },
    _isCompletedStatus(status: string): boolean {
      return status === 'done'
    },
    async _ensureMigrated(): Promise<void> {},
    emitEvent(): void {},
    getLocalCardPath(): string | null {
      return null
    },
    getAttachmentStoragePath(): string | null {
      return null
    },
    async appendAttachment(): Promise<boolean> {
      return false
    },
    materializeAttachment,
    copyAttachment,
    async readAttachment(card: Card, attachment: string) {
      const bytes = attachmentStore.get(`${card.id}:${attachment}`)
      return bytes ? { data: bytes.slice() } : null
    },
    async writeAttachment(card: Card, attachment: string, content: string | Uint8Array): Promise<void> {
      const bytes = toBytes(content)
      attachmentWrites.push(bytes.slice())
      attachmentStore.set(`${card.id}:${attachment}`, bytes)
    },
    async listCards(): Promise<Card[]> {
      return [...cards.values()].map((card) => structuredClone(card))
    },
    async _listCardsRaw(): Promise<Card[]> {
      return [...cards.values()].map((card) => structuredClone(card))
    },
    async getCard(cardId: string): Promise<Card | null> {
      return structuredClone(cards.get(cardId) ?? null)
    },
    async _getCardRaw(cardId: string): Promise<Card | null> {
      return structuredClone(cards.get(cardId) ?? null)
    },
    async canPerformAction(): Promise<boolean> {
      return true
    },
    async getActiveCard(): Promise<Card | null> {
      return null
    },
    async setActiveCard(): Promise<Card> {
      throw new Error('not implemented')
    },
    async clearActiveCard(): Promise<void> {},
    async updateCard(): Promise<Card> {
      throw new Error('not implemented')
    },
    async addLog(): Promise<never> {
      throw new Error('not implemented')
    },
    async moveCard(): Promise<Card> {
      throw new Error('not implemented')
    },
    async permanentlyDeleteCard(): Promise<void> {
      throw new Error('not implemented')
    },
    attachmentWrites,
  }
}

describe('attachment byte path', () => {
  it('adds and reads attachment data through byte helpers without temp-file copy fallback', async () => {
    const ctx = createContext(makeCard())

    const updated = await addAttachmentData(ctx, {
      cardId: 'card-1',
      filename: 'diagram.txt',
      data: toBytes('hello bytes'),
    })

    expect(updated.attachments).toContain('diagram.txt')
    expect(ctx.copyAttachment).not.toHaveBeenCalled()

    await expect(getAttachmentData(ctx, {
      cardId: 'card-1',
      filename: 'diagram.txt',
    })).resolves.toEqual({
      data: toBytes('hello bytes'),
      contentType: undefined,
    })
  })

  it('uses direct attachment bytes for logs when available', async () => {
    const ctx = createContext(makeCard())

    await addLog(ctx, {
      cardId: 'card-1',
      text: 'First entry',
      options: { timestamp: '2026-04-06T00:00:00.000Z', source: 'test' },
    })
    await addLog(ctx, {
      cardId: 'card-1',
      text: 'Second entry',
      options: { timestamp: '2026-04-06T00:00:01.000Z', source: 'test' },
    })

    expect(ctx.copyAttachment).not.toHaveBeenCalled()
    expect(ctx.materializeAttachment).not.toHaveBeenCalled()
    expect(ctx.attachmentWrites).toHaveLength(2)

    await expect(listLogs(ctx, { cardId: 'card-1' })).resolves.toEqual([
      {
        timestamp: '2026-04-06T00:00:00.000Z',
        source: 'test',
        text: 'First entry',
        object: { activity: { type: 'log.explicit', qualifiesForUnread: true } },
      },
      {
        timestamp: '2026-04-06T00:00:01.000Z',
        source: 'test',
        text: 'Second entry',
        object: { activity: { type: 'log.explicit', qualifiesForUnread: true } },
      },
    ])
  })
})
