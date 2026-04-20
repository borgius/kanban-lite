import type {
  AttachmentStoragePlugin,
  Card,
  CardStateCursor,
  CardStateKey,
  CardStateModuleContext,
  CardStateProvider,
  CardStateReadThroughInput,
  CardStateRecord,
  CardStateWriteInput,
  CardStoragePlugin,
  CloudflareWorkerProviderContext,
  ConfigStorageModuleContext,
  ConfigStorageProviderPlugin,
  StorageEngine,
} from 'kanban-lite/sdk'
import {
  PROVIDER_ID,
  CREATE_SCHEMA_SQL,
  schemaReady,
  type CloudflareD1Database,
  type CardRow,
  type ConfigDocumentRow,
  type CardStateRow,
  type ConfigDocument,
  type WorkerConfigRepositoryBridge,
} from './types'
import {
  isRecord,
  normalizeBoardId,
  safeClone,
  isPromiseLike,
  buildRemoteCardPath,
  buildRemoteCardDir,
  normalizeAttachmentName,
  getAttachmentNameFromSourcePath,
  buildAttachmentKey,
  getCachedConfigDocument,
  cacheConfigDocument,
  normalizeCard,
  parseStoredCard,
  parseConfigDocument,
  parseCardStateValue,
  getUpdatedAt,
  createWorkerOnlyError,
  getDatabase,
  getAttachmentsBucket,
  ensureSchema,
  toUint8Array,
  concatUint8Arrays,
} from './helpers'

class CloudflareAttachmentStore {
  constructor(private readonly worker: CloudflareWorkerProviderContext) {}

  getCardDir(card: Card): string {
    return buildRemoteCardDir(card)
  }

  async copyAttachment(sourcePath: string, card: Card): Promise<void> {
    const fileName = getAttachmentNameFromSourcePath(sourcePath)
    const fs = await import('node:fs/promises')
    const bytes = await fs.readFile(sourcePath)
    const bucket = getAttachmentsBucket(this.worker, 'attachment.storage')
    await bucket.put(buildAttachmentKey(card, fileName), bytes)
  }

  async appendAttachment(card: Card, attachment: string, content: string | Uint8Array): Promise<boolean> {
    const fileName = normalizeAttachmentName(attachment)
    if (!fileName) return false

    const bucket = getAttachmentsBucket(this.worker, 'attachment.storage')
    const key = buildAttachmentKey(card, fileName)
    const existing = await bucket.get(key)
    const nextChunk = toUint8Array(content)
    const existingBytes = existing ? new Uint8Array(await existing.arrayBuffer()) : new Uint8Array()
    await bucket.put(key, concatUint8Arrays(existingBytes, nextChunk))
    return true
  }

  async writeAttachment(card: Card, attachment: string, content: string | Uint8Array): Promise<void> {
    const fileName = normalizeAttachmentName(attachment)
    if (!fileName) {
      throw new Error(`kl-plugin-cloudflare: invalid attachment name '${attachment}'.`)
    }

    const bucket = getAttachmentsBucket(this.worker, 'attachment.storage')
    await bucket.put(buildAttachmentKey(card, fileName), toUint8Array(content))
  }

  async readAttachment(
    card: Card,
    attachment: string,
  ): Promise<{ data: Uint8Array; contentType?: string } | null> {
    const fileName = normalizeAttachmentName(attachment)
    if (!fileName) return null

    const bucket = getAttachmentsBucket(this.worker, 'attachment.storage')
    const stored = await bucket.get(buildAttachmentKey(card, fileName))
    if (!stored) return null

    return {
      data: new Uint8Array(await stored.arrayBuffer()),
      contentType: stored.httpMetadata?.contentType,
    }
  }

  async materializeAttachment(card: Card, attachment: string): Promise<string | null> {
    const fileName = normalizeAttachmentName(attachment)
    if (!fileName) return null
    if (!Array.isArray(card.attachments) || !card.attachments.includes(fileName)) return null

    const bucket = getAttachmentsBucket(this.worker, 'attachment.storage')
    const stored = await bucket.get(buildAttachmentKey(card, fileName))
    if (!stored) return null

    try {
      const [os, pathModule, fs] = await Promise.all([
        import('node:os'),
        import('node:path'),
        import('node:fs/promises'),
      ])
      const tempDir = await fs.mkdtemp(pathModule.join(os.tmpdir(), 'kl-plugin-cloudflare-attachment-'))
      const materializedPath = pathModule.join(tempDir, fileName)
      await fs.writeFile(materializedPath, new Uint8Array(await stored.arrayBuffer()))
      return materializedPath
    } catch {
      return null
    }
  }
}

class CloudflareStorageEngine implements StorageEngine {
  readonly type = PROVIDER_ID

  constructor(
    readonly kanbanDir: string,
    private readonly worker: CloudflareWorkerProviderContext,
    private readonly attachments: CloudflareAttachmentStore,
  ) {}

  private async ensureReady(): Promise<CloudflareD1Database> {
    const database = getDatabase(this.worker, 'card.storage')
    await ensureSchema(database)
    return database
  }

  async init(): Promise<void> {
    await this.ensureReady()
  }

  close(): void {}

  async migrate(): Promise<void> {
    await this.ensureReady()
  }

  async ensureBoardDirs(): Promise<void> {}

  async deleteBoardData(_boardDir: string, boardId: string): Promise<void> {
    const database = await this.ensureReady()
    await database
      .prepare('DELETE FROM cards WHERE board_id = ?')
      .bind(boardId)
      .run()
  }

  async scanCards(_boardDir: string, boardId: string): Promise<Card[]> {
    const database = await this.ensureReady()
    const rows = await database
      .prepare('SELECT board_id, card_id, status, card_json FROM cards WHERE board_id = ? ORDER BY card_id ASC')
      .bind(boardId)
      .all<CardRow>()

    return rows.results
      .map((row) => parseStoredCard(row))
      .filter((card): card is Card => card !== null)
  }

  async getCardById(_boardDir: string, boardId: string, cardId: string): Promise<Card | null> {
    const database = await this.ensureReady()
    const row = await database
      .prepare('SELECT board_id, card_id, status, card_json FROM cards WHERE board_id = ? AND card_id = ?')
      .bind(boardId, cardId)
      .first<CardRow>()

    return row ? parseStoredCard(row) : null
  }

  async writeCard(card: Card): Promise<void> {
    const normalized = normalizeCard(card)
    const database = await this.ensureReady()
    await database
      .prepare(`
        INSERT INTO cards (card_id, board_id, status, card_json)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(board_id, card_id)
        DO UPDATE SET
          status = excluded.status,
          card_json = excluded.card_json
      `)
      .bind(
        normalized.id,
        normalizeBoardId(normalized.boardId),
        normalized.status,
        JSON.stringify(normalized),
      )
      .run()
  }

  async moveCard(card: Card, _boardDir: string, newStatus: string): Promise<string> {
    const boardId = normalizeBoardId(card.boardId)
    const database = await this.ensureReady()
    const existing = await database
      .prepare('SELECT board_id, card_id, status, card_json FROM cards WHERE board_id = ? AND card_id = ?')
      .bind(boardId, card.id)
      .first<CardRow>()

    const baseCard = existing ? parseStoredCard(existing) ?? normalizeCard(card) : normalizeCard(card)
    const movedCard = {
      ...baseCard,
      boardId,
      status: newStatus as Card['status'],
      filePath: buildRemoteCardPath(boardId, newStatus, card.id),
    }

    await database
      .prepare('UPDATE cards SET status = ?, card_json = ? WHERE board_id = ? AND card_id = ?')
      .bind(newStatus, JSON.stringify(movedCard), boardId, card.id)
      .run()

    return ''
  }

  async renameCard(): Promise<string> {
    return ''
  }

  async deleteCard(card: Card): Promise<void> {
    const database = await this.ensureReady()
    await database
      .prepare('DELETE FROM cards WHERE board_id = ? AND card_id = ?')
      .bind(normalizeBoardId(card.boardId), card.id)
      .run()
  }

  getCardDir(card: Card): string {
    return this.attachments.getCardDir(card)
  }

  async copyAttachment(sourcePath: string, card: Card): Promise<void> {
    await this.attachments.copyAttachment(sourcePath, card)
  }
}

export function createFallbackCardStoragePlugin(): CardStoragePlugin {
  return {
    manifest: { id: PROVIDER_ID, provides: ['card.storage'] as const },
    createEngine() {
      throw createWorkerOnlyError('card.storage')
    },
    nodeCapabilities: {
      isFileBacked: false,
      getLocalCardPath() { return null },
      getWatchGlob() { return null },
    },
  }
}

export function createFallbackAttachmentStoragePlugin(): AttachmentStoragePlugin {
  return {
    manifest: { id: PROVIDER_ID, provides: ['attachment.storage'] as const },
    getCardDir(): string | null {
      return null
    },
    async copyAttachment(): Promise<void> {
      throw createWorkerOnlyError('attachment.storage')
    },
    async materializeAttachment(): Promise<string | null> {
      return null
    },
  }
}

export function createCardStoragePlugin(context: CloudflareWorkerProviderContext): CardStoragePlugin {
  const attachments = new CloudflareAttachmentStore(context)
  return {
    manifest: { id: PROVIDER_ID, provides: ['card.storage'] as const },
    createEngine(kanbanDir: string): StorageEngine {
      return new CloudflareStorageEngine(kanbanDir, context, attachments)
    },
    nodeCapabilities: {
      isFileBacked: false,
      getLocalCardPath() { return null },
      getWatchGlob() { return null },
    },
  }
}

export function createAttachmentStoragePlugin(context: CloudflareWorkerProviderContext): AttachmentStoragePlugin {
  const attachments = new CloudflareAttachmentStore(context)
  return {
    manifest: { id: PROVIDER_ID, provides: ['attachment.storage'] as const },
    getCardDir(): string | null {
      return null
    },
    async copyAttachment(sourcePath: string, card: Card): Promise<void> {
      await attachments.copyAttachment(sourcePath, card)
    },
    async appendAttachment(card: Card, attachment: string, content: string | Uint8Array): Promise<boolean> {
      return attachments.appendAttachment(card, attachment, content)
    },
    async writeAttachment(card: Card, attachment: string, content: string | Uint8Array): Promise<void> {
      await attachments.writeAttachment(card, attachment, content)
    },
    async readAttachment(card: Card, attachment: string): Promise<{ data: Uint8Array; contentType?: string } | null> {
      return attachments.readAttachment(card, attachment)
    },
    async materializeAttachment(card: Card, attachment: string): Promise<string | null> {
      return attachments.materializeAttachment(card, attachment)
    },
  }
}

export function createCardStateProvider(context: CardStateModuleContext): CardStateProvider {
  async function ensureReady(): Promise<CloudflareD1Database> {
    const database = getDatabase(context.worker, 'card.state')
    await ensureSchema(database)
    return database
  }

  return {
    manifest: { id: PROVIDER_ID, provides: ['card.state'] as const },
    async getCardState(input: CardStateKey): Promise<CardStateRecord | null> {
      const database = await ensureReady()
      const row = await database
        .prepare(`
          SELECT value_json, updated_at
          FROM card_state
          WHERE actor_id = ? AND board_id = ? AND card_id = ? AND domain = ?
        `)
        .bind(input.actorId, input.boardId, input.cardId, input.domain)
        .first<CardStateRow>()

      if (!row) return null
      const value = parseCardStateValue(row.value_json)
      if (!value) return null
      return {
        actorId: input.actorId,
        boardId: input.boardId,
        cardId: input.cardId,
        domain: input.domain,
        value,
        updatedAt: row.updated_at,
      }
    },
    async setCardState(input: CardStateWriteInput): Promise<CardStateRecord> {
      const database = await ensureReady()
      const updatedAt = getUpdatedAt(input.updatedAt)
      await database
        .prepare(`
          INSERT INTO card_state (actor_id, board_id, card_id, domain, value_json, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(actor_id, board_id, card_id, domain)
          DO UPDATE SET
            value_json = excluded.value_json,
            updated_at = excluded.updated_at
        `)
        .bind(
          input.actorId,
          input.boardId,
          input.cardId,
          input.domain,
          JSON.stringify(input.value),
          updatedAt,
        )
        .run()

      return {
        actorId: input.actorId,
        boardId: input.boardId,
        cardId: input.cardId,
        domain: input.domain,
        value: safeClone(input.value),
        updatedAt,
      }
    },
    async getUnreadCursor(input) {
      const record = await this.getCardState({ ...input, domain: 'unread' })
      return record && isRecord(record.value) && typeof record.value.cursor === 'string'
        ? record.value as CardStateCursor
        : null
    },
    async batchGetCardStates(input): Promise<CardStateRecord[]> {
      if (input.cardIds.length === 0 || input.domains.length === 0) return []
      const database = await ensureReady()
      // D1 caps bound parameters per prepared statement (~100 on free,
      // documented safe ceiling well under 1000). Chunk card ids so one
      // call covers all 644+ cards on large boards without hitting the
      // "too many SQL variables" D1 error.
      const domainCount = input.domains.length
      // Reserve 2 slots for actor_id + board_id, so max cards per chunk =
      // floor((LIMIT - 2 - domainCount) / 1). Use a conservative cap.
      const BIND_LIMIT = 60
      const perChunk = Math.max(1, BIND_LIMIT - 2 - domainCount)
      const records: CardStateRecord[] = []
      const domainPlaceholders = input.domains.map(() => '?').join(',')

      const chunks: string[][] = []
      for (let i = 0; i < input.cardIds.length; i += perChunk) {
        chunks.push(input.cardIds.slice(i, i + perChunk) as string[])
      }

      // Run all chunk queries concurrently. D1 can serialize under
      // contention, but firing them together lets the platform pipeline
      // where possible and is still much faster than N per-card reads.
      const results = await Promise.all(chunks.map(async (chunk) => {
        const cardPlaceholders = chunk.map(() => '?').join(',')
        const stmt = database
          .prepare(`
            SELECT card_id, domain, value_json, updated_at
            FROM card_state
            WHERE actor_id = ? AND board_id = ?
              AND card_id IN (${cardPlaceholders})
              AND domain IN (${domainPlaceholders})
          `)
          .bind(input.actorId, input.boardId, ...chunk, ...input.domains)
        return stmt.all<{ card_id: string; domain: string; value_json: string; updated_at: string }>()
      }))

      for (const chunkResult of results) {
        for (const row of chunkResult.results ?? []) {
          const value = parseCardStateValue(row.value_json)
          if (!value) continue
          records.push({
            actorId: input.actorId,
            boardId: input.boardId,
            cardId: row.card_id,
            domain: row.domain,
            value,
            updatedAt: row.updated_at,
          })
        }
      }
      return records
    },
    async markUnreadReadThrough(input: CardStateReadThroughInput): Promise<CardStateRecord<CardStateCursor>> {
      const updatedAt = getUpdatedAt(input.cursor.updatedAt)
      const value: CardStateCursor = {
        cursor: input.cursor.cursor,
        updatedAt,
      }
      const record = await this.setCardState({
        actorId: input.actorId,
        boardId: input.boardId,
        cardId: input.cardId,
        domain: 'unread',
        value,
        updatedAt,
      })
      return record as CardStateRecord<CardStateCursor>
    },
  }
}

export function createWorkerConfigRepositoryBridge(context: ConfigStorageModuleContext): WorkerConfigRepositoryBridge {
  return {
    async readConfigDocument(): Promise<ConfigDocument | null> {
      const database = getDatabase(context.worker, 'config.storage')
      await ensureSchema(database)

      const row = await database
        .prepare('SELECT document_json FROM config_documents WHERE document_id = ?')
        .bind(context.documentId)
        .first<ConfigDocumentRow>()

      if (!row) {
        return getCachedConfigDocument(context)
      }

      return cacheConfigDocument(context, parseConfigDocument(row.document_json))
    },
    async writeConfigDocument(document: ConfigDocument): Promise<void> {
      const database = getDatabase(context.worker, 'config.storage')
      const nextDocument = safeClone(document)
      await ensureSchema(database)
      await database
        .prepare(`
          INSERT INTO config_documents (document_id, document_json)
          VALUES (?, ?)
          ON CONFLICT(document_id)
          DO UPDATE SET document_json = excluded.document_json
        `)
        .bind(context.documentId, JSON.stringify(nextDocument))
        .run()

      cacheConfigDocument(context, nextDocument)
    },
  }
}

export function createConfigStorageProvider(context: ConfigStorageModuleContext): ConfigStorageProviderPlugin {
  return {
    manifest: { id: PROVIDER_ID, provides: ['config.storage'] as const },
    readConfigDocument(): ConfigDocument | null {
      const database = getDatabase(context.worker, 'config.storage')
      const ready = ensureSchema(database)
      if (isPromiseLike(ready)) {
        const cached = getCachedConfigDocument(context)
        if (cached !== null) return cached
        throw new Error(
          'kl-plugin-cloudflare: direct config.storage reads require a cached bootstrap document under the current synchronous config seam.',
        )
      }

      const row = database
        .prepare('SELECT document_json FROM config_documents WHERE document_id = ?')
        .bind(context.documentId)
        .first<ConfigDocumentRow>()

      if (isPromiseLike(row)) {
        const cached = getCachedConfigDocument(context)
        if (cached !== null) return cached
        throw new Error(
          'kl-plugin-cloudflare: direct config.storage reads cannot synchronously await D1. Use the Worker bootstrap/runtime-host cache for runtime reads.',
        )
      }

      if (!row) return getCachedConfigDocument(context)

      return cacheConfigDocument(context, parseConfigDocument(row.document_json))
    },
    writeConfigDocument(document: ConfigDocument): void {
      const database = getDatabase(context.worker, 'config.storage')
      const ready = ensureSchema(database)
      if (isPromiseLike(ready)) {
        throw new Error(
          'kl-plugin-cloudflare: direct config.storage writes cannot synchronously await D1 under the current Worker config seam. Use runtimeHost.writeConfig() for live Worker writes.',
        )
      }

      const nextDocument = safeClone(document)

      const result = database
        .prepare(`
          INSERT INTO config_documents (document_id, document_json)
          VALUES (?, ?)
          ON CONFLICT(document_id)
          DO UPDATE SET document_json = excluded.document_json
        `)
        .bind(context.documentId, JSON.stringify(nextDocument))
        .run()

      if (isPromiseLike(result)) {
        throw new Error(
          'kl-plugin-cloudflare: direct config.storage writes cannot synchronously await D1 under the current Worker config seam. Use runtimeHost.writeConfig() for live Worker writes.',
        )
      }

      cacheConfigDocument(context, nextDocument)
    },
  }
}
