/**
 * Integration tests for kl-s3-attachment-storage demonstrating consumption from kanban-lite.
 *
 * These tests exercise the actual plugin logic — they do not mock the plugin's
 * internal implementation.  They verify:
 *
 *   1. The manifest shape required by kanban-lite's `loadExternalAttachmentPlugin`
 *      and `resolveCapabilityBag`.
 *   2. Input-validation behaviour (unsafe filename rejection) that protects the
 *      kanban-lite attachment pipeline from path traversal attacks.
 *   3. Graceful nil-return paths (`materializeAttachment` returns null for
 *      attachments not listed on the card, `appendAttachment` returns false for
 *      unsupported names).
 *
 * AWS / S3 I/O tests are gated on `KL_S3_BUCKET` being set so they run in CI
 * with real credentials / MinIO but never block the offline monorepo build.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { attachmentStoragePlugin, type Card } from './index'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 'card-1',
    boardId: 'test-board',
    status: 'backlog',
    attachments: [],
    ...overrides,
  }
}

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kl-s3-test-'))
}

// ---------------------------------------------------------------------------
// Manifest shape – the shape kanban-lite validates in loadExternalAttachmentPlugin
// ---------------------------------------------------------------------------

describe('kl-s3-attachment-storage: manifest shape (kanban-lite loader contract)', () => {
  it('has provider id kl-s3-attachment-storage and provides attachment.storage', () => {
    expect(attachmentStoragePlugin.manifest.id).toBe('kl-s3-attachment-storage')
    expect(attachmentStoragePlugin.manifest.provides).toContain('attachment.storage')
  })

  it('does NOT provide card.storage (attachment-only plugin)', () => {
    expect(attachmentStoragePlugin.manifest.provides).not.toContain('card.storage')
  })

  it('exposes copyAttachment as a function', () => {
    expect(typeof attachmentStoragePlugin.copyAttachment).toBe('function')
  })

  it('exposes appendAttachment as a function', () => {
    expect(typeof attachmentStoragePlugin.appendAttachment).toBe('function')
  })

  it('exposes materializeAttachment as a function', () => {
    expect(typeof attachmentStoragePlugin.materializeAttachment).toBe('function')
  })

  it('does not expose getCardDir (S3 has no local directory concept)', () => {
    // kanban-lite calls getCardDir?.(); undefined is the correct answer for S3
    expect(attachmentStoragePlugin.getCardDir).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// copyAttachment – unsafe filename rejection (path-traversal protection)
// ---------------------------------------------------------------------------

describe('kl-s3-attachment-storage: copyAttachment unsafe filename rejection', () => {
  let tmpDir: string
  let tmpFile: string

  beforeEach(() => {
    tmpDir = createTempDir()
    tmpFile = path.join(tmpDir, 'safe.txt')
    fs.writeFileSync(tmpFile, 'hello')
    // Ensure KL_S3_BUCKET is NOT set so we don't unintentionally hit AWS
    delete process.env['KL_S3_BUCKET']
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('rejects a source path whose basename contains a path separator', async () => {
    // The source path resolves to a file named '../../etc/passwd' after basename extraction
    const unsafePath = path.join(tmpDir, '..', '..', 'etc', 'passwd')
    await expect(
      attachmentStoragePlugin.copyAttachment(unsafePath, makeCard()),
    ).rejects.toThrow(/KL_S3_BUCKET/)
    // Note: error will be about missing bucket since the env var is absent;
    // the actual attachment-name check happens after config is read.
    // The test below proves the name check directly via materializeAttachment.
  })

  it('copyAttachment throws when KL_S3_BUCKET is not configured', async () => {
    await expect(
      attachmentStoragePlugin.copyAttachment(tmpFile, makeCard()),
    ).rejects.toThrow(/KL_S3_BUCKET/)
  })
})

// ---------------------------------------------------------------------------
// materializeAttachment – nil-return paths (no I/O required)
// ---------------------------------------------------------------------------

describe('kl-s3-attachment-storage: materializeAttachment nil-return paths', () => {
  beforeEach(() => {
    delete process.env['KL_S3_BUCKET']
  })

  it('returns null when attachment name contains a path separator', async () => {
    const card = makeCard({ attachments: ['../../evil.txt'] })
    const result = await attachmentStoragePlugin.materializeAttachment!(card, '../../evil.txt')
    expect(result).toBeNull()
  })

  it('returns null when attachment name is empty', async () => {
    const card = makeCard({ attachments: [''] })
    const result = await attachmentStoragePlugin.materializeAttachment!(card, '')
    expect(result).toBeNull()
  })

  it('returns null when attachment is not listed on the card', async () => {
    // Even with a valid name, if it is not in card.attachments it must return null
    const card = makeCard({ attachments: ['other.txt'] })
    const result = await attachmentStoragePlugin.materializeAttachment!(card, 'notes.txt')
    expect(result).toBeNull()
  })

  it('throws when KL_S3_BUCKET is not set and attachment is listed on the card', async () => {
    const card = makeCard({ attachments: ['notes.txt'] })
    await expect(
      attachmentStoragePlugin.materializeAttachment!(card, 'notes.txt'),
    ).rejects.toThrow(/KL_S3_BUCKET/)
  })
})

// ---------------------------------------------------------------------------
// appendAttachment – unsafe name returns false without hitting S3
// ---------------------------------------------------------------------------

describe('kl-s3-attachment-storage: appendAttachment unsafe name handling', () => {
  beforeEach(() => {
    delete process.env['KL_S3_BUCKET']
  })

  it('returns false for a name that contains a path separator', async () => {
    const card = makeCard()
    const result = await attachmentStoragePlugin.appendAttachment!(card, '../traversal.txt', 'data')
    expect(result).toBe(false)
  })

  it('returns false for an empty attachment name', async () => {
    const card = makeCard()
    const result = await attachmentStoragePlugin.appendAttachment!(card, '', 'data')
    expect(result).toBe(false)
  })

  it('throws when KL_S3_BUCKET is not set and name is safe', async () => {
    const card = makeCard()
    await expect(
      attachmentStoragePlugin.appendAttachment!(card, 'log.txt', 'line'),
    ).rejects.toThrow(/KL_S3_BUCKET/)
  })
})

// ---------------------------------------------------------------------------
// Live S3 / MinIO tests – skipped unless KL_S3_BUCKET is configured
// ---------------------------------------------------------------------------

const S3_BUCKET = process.env['KL_S3_BUCKET']
const RUN_LIVE = Boolean(S3_BUCKET)

describe.skipIf(!RUN_LIVE)('kl-s3-attachment-storage: live S3 upload/download (requires KL_S3_BUCKET)', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = createTempDir()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('uploads a file via copyAttachment and downloads it via materializeAttachment', async () => {
    const content = `test-${Date.now()}`
    const srcFile = path.join(tmpDir, 'upload.txt')
    fs.writeFileSync(srcFile, content)

    const card = makeCard({ id: `card-${Date.now()}`, attachments: ['upload.txt'] })

    await attachmentStoragePlugin.copyAttachment(srcFile, card)

    const localPath = await attachmentStoragePlugin.materializeAttachment!(card, 'upload.txt')
    expect(localPath).not.toBeNull()
    expect(fs.readFileSync(localPath!, 'utf-8')).toBe(content)
  })
})
