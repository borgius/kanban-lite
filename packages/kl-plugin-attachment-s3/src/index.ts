import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, type GetObjectCommandOutput } from '@aws-sdk/client-s3'
import type {
  AttachmentStoragePlugin,
  Card,
  PluginSettingsOptionsSchemaMetadata,
} from 'kanban-lite/sdk'

export type { AttachmentStoragePlugin, Card } from 'kanban-lite/sdk'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROVIDER_ID = 'kl-plugin-attachment-s3'

// ---------------------------------------------------------------------------
// Helper: sanitize attachment filename
// ---------------------------------------------------------------------------

/**
 * Returns the sanitized filename, or `null` if the name contains path
 * separators, null bytes, or other control characters that could cause
 * path-traversal issues in S3 keys or local tmp paths.
 */
function sanitizeAttachmentName(name: string): string | null {
  // Normalize backslashes then reject anything with a path separator
  const normalized = name.replace(/\\/g, '/')
  if (!normalized || normalized.includes('/') || normalized.includes('\0')) return null
  const base = path.basename(normalized)
  if (!base || base !== normalized || base === '.' || base === '..') return null
  // Reject control characters (0x00–0x1f, 0x7f)
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(base)) return null
  return base
}

// ---------------------------------------------------------------------------
// Helper: build deterministic S3 object key
// ---------------------------------------------------------------------------

/**
 * Builds a deterministic S3 object key for a card attachment.
 *
 * Pattern: `{prefix}boards/{boardId}/{cardId}/{filename}`
 *
 * boardId and cardId are slug-safe: any character that is not alphanumeric,
 * an underscore, a hyphen, or a dot is replaced with `_`.
 */
function buildS3Key(prefix: string, card: Card, filename: string): string {
  const boardId = String(card.boardId ?? 'default').replace(/[^a-zA-Z0-9_.-]/g, '_')
  const cardId = String(card.id ?? 'unknown').replace(/[^a-zA-Z0-9_.-]/g, '_')
  return `${prefix}boards/${boardId}/${cardId}/${filename}`
}

// ---------------------------------------------------------------------------
// Helper: read configuration from environment variables
// ---------------------------------------------------------------------------

/**
 * Reads S3 configuration from environment variables.
 *
 * Required:
 *   KL_S3_BUCKET  — S3 bucket name
 *
 * Optional (all fall back to AWS defaults / safe values when absent):
 *   KL_S3_REGION          — AWS region (falls back to AWS_REGION, then 'us-east-1')
 *   KL_S3_ENDPOINT        — custom S3-compatible endpoint URL (MinIO, LocalStack, etc.)
 *   KL_S3_PREFIX          — object key prefix, e.g. "kanban/" (default: "")
 *   KL_S3_FORCE_PATH_STYLE — set "true" for path-style addressing (required by MinIO)
 *
 * Credentials use the standard AWS credential chain:
 * env vars → ~/.aws/credentials → EC2/ECS instance metadata → etc.
 */
function readEnvConfig(): { bucket: string; prefix: string } {
  const bucket = process.env['KL_S3_BUCKET']
  if (!bucket) {
    throw new Error(
      '[kl-plugin-attachment-s3] KL_S3_BUCKET environment variable is required. ' +
      'Set it to the name of the S3 bucket where attachments should be stored.'
    )
  }
  const prefix = process.env['KL_S3_PREFIX'] ?? ''
  return { bucket, prefix }
}

/**
 * Creates an S3Client from environment variables. Credentials are resolved
 * via the standard AWS credential provider chain.
 */
function createS3Client(): S3Client {
  const region = process.env['KL_S3_REGION'] ?? process.env['AWS_REGION'] ?? 'us-east-1'
  const endpoint = process.env['KL_S3_ENDPOINT']
  const forcePathStyle = process.env['KL_S3_FORCE_PATH_STYLE'] === 'true'

  return new S3Client({
    region,
    ...(endpoint ? { endpoint } : {}),
    forcePathStyle,
  })
}

function toBodyBytes(content: string | Uint8Array): Uint8Array {
  return typeof content === 'string' ? Buffer.from(content, 'utf-8') : content
}

function isAppendUnsupportedError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const message = `${err.name} ${err.message}`.toLowerCase()
  return message.includes('writeoffsetbytes')
    || message.includes('invalid request')
    || message.includes('invalidargument')
    || message.includes('not implemented')
    || message.includes('notimplemented')
    || message.includes('unsupported')
}

// ---------------------------------------------------------------------------
// Plugin implementation
// ---------------------------------------------------------------------------

/**
 * kanban-lite `attachment.storage` plugin for Amazon S3.
 *
 * Uploads attachments to S3 via `copyAttachment` and downloads them to a
 * deterministic local temp path via `materializeAttachment`. S3 has no
 * meaningful local directory concept, so `getCardDir` is intentionally absent.
 *
 * Configure using environment variables — see README.md.
 *
 * @example .kanban.json
 * ```json
 * {
 *   "plugins": {
 *     "attachment.storage": {
 *       "provider": "kl-plugin-attachment-s3"
 *     }
 *   }
 * }
 * ```
 */
export const attachmentStoragePlugin: AttachmentStoragePlugin = {
  manifest: {
    id: PROVIDER_ID,
    provides: ['attachment.storage'],
  },

  /**
   * Uploads `sourcePath` to S3 under the deterministic key
   * `{prefix}boards/{boardId}/{cardId}/{filename}`.
   *
   * The attachment filename is sanitized before use; unsafe names (path
   * traversal characters, control characters) are rejected with an error.
   */
  async copyAttachment(sourcePath: string, card: Card): Promise<void> {
    const filename = path.basename(sourcePath)
    const safeFilename = sanitizeAttachmentName(filename)
    if (!safeFilename) {
      throw new Error(
        `[kl-plugin-attachment-s3] Unsafe attachment filename: "${filename}". ` +
        'Filenames must not contain path separators or control characters.'
      )
    }

    const { bucket, prefix } = readEnvConfig()
    const key = buildS3Key(prefix, card, safeFilename)
    const client = createS3Client()
    const body = await fs.readFile(sourcePath)

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
      })
    )
  },

  /**
   * Attempts an in-place append using S3's `WriteOffsetBytes` support.
   *
   * This is supported by S3 directory buckets / S3 Express One Zone. For
   * standard buckets and S3-compatible APIs such as MinIO that do not support
   * native append, the method returns `false` so callers can fall back to a
   * read/modify/write flow.
   */
  async appendAttachment(card: Card, attachment: string, content: string | Uint8Array): Promise<boolean> {
    const safeAttachment = sanitizeAttachmentName(attachment)
    if (!safeAttachment) return false

    const { bucket, prefix } = readEnvConfig()
    const key = buildS3Key(prefix, card, safeAttachment)
    const client = createS3Client()
    const body = toBodyBytes(content)

    let writeOffsetBytes = 0
    try {
      const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
      writeOffsetBytes = Number(head.ContentLength ?? 0)
    } catch (err: unknown) {
      if (!(err instanceof Error) || (err.name !== 'NotFound' && err.name !== 'NoSuchKey' && err.name !== 'NoSuchObject')) {
        throw err
      }
    }

    try {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ...(writeOffsetBytes > 0 ? { WriteOffsetBytes: writeOffsetBytes } : {}),
        })
      )
      return true
    } catch (err: unknown) {
      if (writeOffsetBytes > 0 && isAppendUnsupportedError(err)) {
        return false
      }
      throw err
    }
  },

  /**
   * Downloads the named attachment from S3 to a deterministic temp-file path:
   * `{os.tmpdir()}/kl-s3/{boardId}/{cardId}/{attachment}`
   *
   * Returns the local path on success, or `null` when:
   * - the attachment name is unsafe
   * - the attachment is not listed on the card
   * - the S3 object does not exist (NoSuchKey / NotFound)
   *
   * The caller is responsible for cleaning up the temp file when no longer
   * needed. The OS will eventually clear the temp directory on its own.
   */
  async materializeAttachment(card: Card, attachment: string): Promise<string | null> {
    const safeAttachment = sanitizeAttachmentName(attachment)
    if (!safeAttachment) return null

    // Only materialize attachments that are registered on the card
    if (!Array.isArray(card.attachments) || !card.attachments.includes(safeAttachment)) {
      return null
    }

    const { bucket, prefix } = readEnvConfig()
    const key = buildS3Key(prefix, card, safeAttachment)
    const client = createS3Client()

    let response: GetObjectCommandOutput
    try {
      response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    } catch (err: unknown) {
      if (err instanceof Error && (err.name === 'NoSuchKey' || err.name === 'NotFound')) {
        return null
      }
      throw err
    }

    if (!response.Body) return null

    // Write the S3 stream to a deterministic temp path
    const boardId = String(card.boardId ?? 'default').replace(/[^a-zA-Z0-9_.-]/g, '_')
    const cardId = String(card.id ?? 'unknown').replace(/[^a-zA-Z0-9_.-]/g, '_')
    const tmpDir = path.join(os.tmpdir(), 'kl-s3', boardId, cardId)
    await fs.mkdir(tmpDir, { recursive: true })
    const tmpFile = path.join(tmpDir, safeAttachment)

    await pipeline(response.Body as Readable, createWriteStream(tmpFile))
    return tmpFile
  },
}

/** Standard package manifest for engine discovery. */
export const pluginManifest = {
  id: 'kl-plugin-attachment-s3',
  capabilities: {
    'attachment.storage': ['kl-plugin-attachment-s3'] as const,
  },
} as const

// ---------------------------------------------------------------------------
// Options schema — plugin-settings discovery
// ---------------------------------------------------------------------------

function createS3OptionsSchema(): PluginSettingsOptionsSchemaMetadata {
  return {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['bucket'],
      properties: {
        bucket: {
          type: 'string',
          title: 'S3 bucket',
          description: 'Name of the S3 bucket where attachments are stored.',
          minLength: 1,
        },
        region: {
          type: 'string',
          title: 'AWS region',
          description: 'AWS region for the S3 bucket. Falls back to AWS_REGION, then us-east-1.',
          default: 'us-east-1',
        },
        endpoint: {
          type: 'string',
          title: 'Custom endpoint',
          description: 'Custom S3-compatible endpoint URL (MinIO, LocalStack, etc.).',
        },
        prefix: {
          type: 'string',
          title: 'Key prefix',
          description: 'Object key prefix for all stored attachments.',
          default: '',
        },
        forcePathStyle: {
          type: 'boolean',
          title: 'Force path-style',
          description: 'Use path-style addressing (required by MinIO).',
          default: false,
        },
      },
    },
    secrets: [],
  }
}

/** Options schemas keyed by provider id for plugin-settings discovery. */
export const optionsSchemas: Record<string, () => PluginSettingsOptionsSchemaMetadata> = {
  'kl-plugin-attachment-s3': createS3OptionsSchema,
}
