import * as fs from 'fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SDKContext } from '../modules/context'
import { writeActiveCardState } from '../modules/cards/helpers'
import { resetRuntimeHost } from '../../shared/env'

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises')
  return {
    ...actual,
    mkdir: vi.fn(),
    writeFile: vi.fn(),
  }
})

function createContext(): SDKContext {
  return {
    workspaceRoot: '/virtual/workspace',
    kanbanDir: '/virtual/workspace/.kanban',
    _storage: {} as SDKContext['_storage'],
    capabilities: null,
    _resolveBoardId(boardId?: string) {
      return boardId ?? 'default'
    },
    _boardDir(boardId?: string) {
      return `/virtual/workspace/.kanban/boards/${boardId ?? 'default'}`
    },
    _isCompletedStatus() {
      return false
    },
    async _ensureMigrated() {},
    emitEvent() {},
    getLocalCardPath() {
      return null
    },
    getAttachmentStoragePath() {
      return null
    },
    async appendAttachment() {
      return false
    },
    async readAttachment() {
      return null
    },
    async writeAttachment() {},
    async materializeAttachment() {
      return null
    },
    async copyAttachment() {},
    async listCards() {
      return []
    },
    async _listCardsRaw() {
      return []
    },
    async getCard() {
      return null
    },
    async _getCardRaw() {
      return null
    },
    async canPerformAction() {
      return true
    },
    async getActiveCard() {
      return null
    },
    async setActiveCard() {
      throw new Error('not implemented')
    },
    async clearActiveCard() {},
    async updateCard() {
      throw new Error('not implemented')
    },
    async addLog() {
      throw new Error('not implemented')
    },
    async moveCard() {
      throw new Error('not implemented')
    },
    async permanentlyDeleteCard() {},
  }
}

afterEach(() => {
  resetRuntimeHost()
  vi.clearAllMocks()
})

describe('active-card persistence', () => {
  it('fails soft when the runtime refuses local active-card writes', async () => {
    const mkdirMock = vi.mocked(fs.mkdir)
    const writeFileMock = vi.mocked(fs.writeFile)
    const permissionError = new Error('operation not permitted') as Error & { code?: string }
    permissionError.code = 'EPERM'

    mkdirMock.mockResolvedValue(undefined)
    writeFileMock.mockRejectedValue(permissionError)

    await expect(writeActiveCardState(createContext(), {
      cardId: 'card-1',
      boardId: 'default',
      updatedAt: '2026-04-09T00:00:00.000Z',
    })).resolves.toBeUndefined()

    expect(writeFileMock).toHaveBeenCalledTimes(1)
  })

  it('still surfaces unexpected active-card write failures', async () => {
    const mkdirMock = vi.mocked(fs.mkdir)
    const writeFileMock = vi.mocked(fs.writeFile)
    const unexpectedError = new Error('disk full') as Error & { code?: string }
    unexpectedError.code = 'ENOSPC'

    mkdirMock.mockResolvedValue(undefined)
    writeFileMock.mockRejectedValue(unexpectedError)

    await expect(writeActiveCardState(createContext(), {
      cardId: 'card-2',
      boardId: 'default',
      updatedAt: '2026-04-09T00:00:00.000Z',
    })).rejects.toThrow('disk full')
  })
})
