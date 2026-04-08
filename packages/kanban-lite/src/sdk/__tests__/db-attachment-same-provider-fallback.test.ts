import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Card } from '../../shared/types'
import { KanbanSDK } from '../KanbanSDK'

type DatabaseAttachmentProvider = 'mysql' | 'postgresql'
type DatabaseAttachmentProviderSelection =
  | DatabaseAttachmentProvider
  | 'kl-plugin-storage-mysql'
  | 'kl-plugin-storage-postgresql'

function createCard(attachment: string): Card {
  return {
    version: 2,
    id: 'kl-1',
    boardId: 'default',
    status: 'backlog',
    priority: 'medium',
    assignee: null,
    dueDate: null,
    created: '2026-04-08T00:00:00.000Z',
    modified: '2026-04-08T00:00:00.000Z',
    completedAt: null,
    labels: [],
    attachments: [attachment],
    comments: [],
    order: 'a0',
    content: '# Attachment regression',
    filePath: '',
  }
}

describe.each([
  {
    provider: 'mysql' as const,
    packageProvider: 'kl-plugin-storage-mysql' as const,
    options: { database: 'kanban_test' },
  },
  {
    provider: 'postgresql' as const,
    packageProvider: 'kl-plugin-storage-postgresql' as const,
    options: { database: 'kanban_test' },
  },
])('$provider same-provider attachment runtime fallback', ({ provider, packageProvider, options }) => {
  const workspaceDirs: string[] = []

  afterEach(async () => {
    await Promise.all(workspaceDirs.splice(0).map((workspaceDir) => fsp.rm(workspaceDir, { recursive: true, force: true })))
  })

  function createRuntime({
    attachmentProvider,
    cardProvider = provider,
  }: {
    attachmentProvider?: DatabaseAttachmentProviderSelection
    cardProvider?: DatabaseAttachmentProviderSelection
  } = {}): {
    card: Card
    expectedDir: string
    sdk: KanbanSDK
    sourcePath: string
  } {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), `kanban-${provider}-attachment-fallback-`))
    workspaceDirs.push(workspaceDir)

    const kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })

    const sourcePath = path.join(workspaceDir, 'sample.txt')
    fs.writeFileSync(sourcePath, `hello-${provider}`)

    const sdk = new KanbanSDK(kanbanDir, {
      capabilities: {
        'card.storage': { provider: cardProvider, options },
        ...(attachmentProvider ? { 'attachment.storage': { provider: attachmentProvider } } : {}),
      },
    })

    return {
      card: createCard(path.basename(sourcePath)),
      expectedDir: path.join(kanbanDir, 'boards', 'default', 'backlog', 'attachments'),
      sdk,
      sourcePath,
    }
  }

  it('uses the active card-storage engine for implicit same-provider attachment fallback', async () => {
    const { card, expectedDir, sdk, sourcePath } = createRuntime()

    try {
      expect(sdk.getAttachmentStoragePath(card)).toBe(expectedDir)

      await sdk.copyAttachment(sourcePath, card)

      await expect(fsp.readFile(path.join(expectedDir, path.basename(sourcePath)), 'utf8')).resolves.toBe(`hello-${provider}`)
    } finally {
      sdk.close()
    }
  })

  it('uses the engine-bound attachment plugin when attachment.storage explicitly matches card.storage', async () => {
    const { card, expectedDir, sdk, sourcePath } = createRuntime({ attachmentProvider: provider })

    try {
      expect(sdk.getAttachmentStoragePath(card)).toBe(expectedDir)

      await sdk.copyAttachment(sourcePath, card)

      await expect(fsp.readFile(path.join(expectedDir, path.basename(sourcePath)), 'utf8')).resolves.toBe(`hello-${provider}`)
    } finally {
      sdk.close()
    }
  })

  it('uses the active card-storage engine for implicit same-provider attachment fallback when card.storage uses the package name', async () => {
    const { card, expectedDir, sdk, sourcePath } = createRuntime({ cardProvider: packageProvider })

    try {
      expect(sdk.getAttachmentStoragePath(card)).toBe(expectedDir)

      await sdk.copyAttachment(sourcePath, card)

      await expect(fsp.readFile(path.join(expectedDir, path.basename(sourcePath)), 'utf8')).resolves.toBe(`hello-${provider}`)
    } finally {
      sdk.close()
    }
  })

  it('uses the engine-bound attachment plugin when package-name attachment.storage explicitly matches package-name card.storage', async () => {
    const { card, expectedDir, sdk, sourcePath } = createRuntime({
      attachmentProvider: packageProvider,
      cardProvider: packageProvider,
    })

    try {
      expect(sdk.getAttachmentStoragePath(card)).toBe(expectedDir)

      await sdk.copyAttachment(sourcePath, card)

      await expect(fsp.readFile(path.join(expectedDir, path.basename(sourcePath)), 'utf8')).resolves.toBe(`hello-${provider}`)
    } finally {
      sdk.close()
    }
  })
})