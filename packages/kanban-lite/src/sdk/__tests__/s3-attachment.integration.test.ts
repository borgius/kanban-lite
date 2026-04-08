import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3'
import { KanbanSDK } from '../KanbanSDK'

const ENV_KEYS = [
  'KL_S3_BUCKET',
  'KL_S3_REGION',
  'KL_S3_ENDPOINT',
  'KL_S3_PREFIX',
  'KL_S3_FORCE_PATH_STYLE',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_REGION',
] as const

type EnvKey = typeof ENV_KEYS[number]
type Snapshot = Partial<Record<EnvKey, string | undefined>>

function createTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-s3-integration-'))
}

function snapshotEnv(): Snapshot {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]])) as Snapshot
}

function restoreEnv(snapshot: Snapshot): void {
  for (const key of ENV_KEYS) {
    const value = snapshot[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

function writeWorkspaceEnv(workspaceRoot: string, bucket: string, prefix: string): void {
  fs.writeFileSync(
    path.join(workspaceRoot, '.env'),
    [
      `KL_S3_BUCKET=${bucket}`,
      'KL_S3_REGION=us-east-1',
      'KL_S3_ENDPOINT=http://127.0.0.1:9000',
      `KL_S3_PREFIX=${prefix}`,
      'KL_S3_FORCE_PATH_STYLE=true',
      'AWS_ACCESS_KEY_ID=minioadmin',
      'AWS_SECRET_ACCESS_KEY=minioadmin',
      'AWS_REGION=us-east-1',
      '',
    ].join('\n'),
    'utf-8',
  )
}

function writeWorkspaceConfig(workspaceRoot: string): void {
  fs.writeFileSync(
    path.join(workspaceRoot, '.kanban.json'),
    JSON.stringify(
      {
        version: 2,
        plugins: {
          'attachment.storage': {
            provider: 'kl-plugin-attachment-s3',
          },
        },
      },
      null,
      2,
    ) + '\n',
    'utf-8',
  )
}

function createS3Client(): S3Client {
  return new S3Client({
    region: 'us-east-1',
    endpoint: 'http://127.0.0.1:9000',
    forcePathStyle: true,
    credentials: {
      accessKeyId: 'minioadmin',
      secretAccessKey: 'minioadmin',
    },
  })
}

async function ensureBucket(client: S3Client, bucket: string): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }))
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }))
  }
}

async function clearPrefix(client: S3Client, bucket: string, prefix: string): Promise<void> {
  let continuationToken: string | undefined

  do {
    const listed = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }))

    for (const item of listed.Contents ?? []) {
      if (!item.Key) continue
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: item.Key }))
    }

    continuationToken = listed.NextContinuationToken
  } while (continuationToken)
}

function isMinioReachable(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: 9000 })
    socket.setTimeout(1000)
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => resolve(false))
    socket.once('timeout', () => { socket.destroy(); resolve(false) })
  })
}

async function streamToString(body: unknown): Promise<string> {
  if (!body) return ''
  if (typeof body === 'string') return body
  if (typeof (body as { transformToString?: () => Promise<string> }).transformToString === 'function') {
    return (body as { transformToString: () => Promise<string> }).transformToString()
  }

  const chunks: Buffer[] = []
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf-8')
}

describe.skipIf(!(await isMinioReachable()))('S3 attachment storage integration', () => {
  let workspaceRoot: string
  let kanbanDir: string
  let sdk: KanbanSDK
  let envSnapshot: Snapshot
  let bucket: string
  let prefix: string
  let client: S3Client

  beforeEach(async () => {
    workspaceRoot = createTempWorkspace()
    kanbanDir = path.join(workspaceRoot, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })

    bucket = 'kanban-test'
    prefix = `itest/${path.basename(workspaceRoot)}/`
    envSnapshot = snapshotEnv()

    writeWorkspaceEnv(workspaceRoot, bucket, prefix)
    writeWorkspaceConfig(workspaceRoot)

    client = createS3Client()
    await ensureBucket(client, bucket)
    await clearPrefix(client, bucket, prefix)

    sdk = new KanbanSDK(kanbanDir)
    await sdk.init()
  })

  afterEach(async () => {
    sdk?.close()
    await clearPrefix(client, bucket, prefix)
    restoreEnv(envSnapshot)
    fs.rmSync(workspaceRoot, { recursive: true, force: true })
  })

  it('loads the published attachment plugin from .kanban.json and reports it in storage status', () => {
    expect(sdk.getStorageStatus()).toEqual({
      storageEngine: 'markdown',
      providers: {
        'card.storage': { provider: 'localfs' },
        'attachment.storage': { provider: 'kl-plugin-attachment-s3' },
      },
      configStorage: {
        configured: null,
        effective: { provider: 'localfs' },
        mode: 'fallback',
        failure: null,
      },
      isFileBacked: true,
      watchGlob: 'boards/**/*.md',
    })
  })

  it('copies an attachment into MinIO and materializes it back to a local temp file', async () => {
    const card = await sdk.createCard({
      content: '# S3 Attachment\n\nTesting MinIO-backed attachments.',
      status: 'todo',
    })

    const sourcePath = path.join(workspaceRoot, 'hello.txt')
    fs.writeFileSync(sourcePath, 'hello from minio integration test\n', 'utf-8')

    const updatedCard = await sdk.addAttachment(card.id, sourcePath)
    expect(updatedCard.attachments).toContain('hello.txt')

    const expectedKey = `${prefix}boards/default/${card.id}/hello.txt`
    const objectResponse = await client.send(new GetObjectCommand({
      Bucket: bucket,
      Key: expectedKey,
    }))
    const storedContent = await streamToString(objectResponse.Body)
    expect(storedContent).toBe('hello from minio integration test\n')

    const materializedPath = await sdk.materializeAttachment(updatedCard, 'hello.txt')
    expect(materializedPath).not.toBeNull()
    expect(fs.existsSync(materializedPath!)).toBe(true)
    expect(fs.readFileSync(materializedPath!, 'utf-8')).toBe('hello from minio integration test\n')
    expect(materializedPath).toContain(path.join('kl-s3', 'default', card.id, 'hello.txt'))
  })

  it('stores card logs through the attachment plugin and reads them back via materialization', async () => {
    const card = await sdk.createCard({
      content: '# S3 Logs\n\nTesting MinIO-backed logs.',
      status: 'todo',
    })

    const entry = await sdk.addLog(card.id, 'Build passed', {
      source: 'ci',
      object: { version: '1.0.0' },
    })
    await sdk.addLog(card.id, 'Deploy complete', {
      source: 'ci',
      object: { version: '1.0.1' },
    })

    expect(entry.source).toBe('ci')

    const updatedCard = await sdk.getCard(card.id)
    expect(updatedCard?.attachments).toContain(`${card.id}.log`)

    const expectedKey = `${prefix}boards/default/${card.id}/${card.id}.log`
    const objectResponse = await client.send(new GetObjectCommand({
      Bucket: bucket,
      Key: expectedKey,
    }))
    const storedContent = await streamToString(objectResponse.Body)
    expect(storedContent).toContain('[ci] Build passed')
    expect(storedContent).toContain('[ci] Deploy complete')
    expect(storedContent).toContain('"version":"1.0.0"')
    expect(storedContent).toContain('"version":"1.0.1"')
    expect(storedContent).toContain('"activity":{"type":"log.explicit","qualifiesForUnread":true}')

    const logs = await sdk.listLogs(card.id)
    expect(logs).toEqual([
      expect.objectContaining({
        source: 'ci',
        text: 'Build passed',
        object: {
          version: '1.0.0',
          activity: {
            type: 'log.explicit',
            qualifiesForUnread: true,
          },
        },
      }),
      expect.objectContaining({
        source: 'ci',
        text: 'Deploy complete',
        object: {
          version: '1.0.1',
          activity: {
            type: 'log.explicit',
            qualifiesForUnread: true,
          },
        },
      }),
    ])
  })
})
