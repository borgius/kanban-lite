import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { spawnSyncMock } = vi.hoisted(() => ({
  spawnSyncMock: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  spawnSync: spawnSyncMock,
}))

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '../../../../')
const cloudflareResourcesPath = pathToFileURL(path.join(repoRoot, 'scripts', 'lib', 'cloudflare-resources.mjs')).href

type SpawnResult = {
  status?: number | null
  stdout?: string | null
  stderr?: string | null
}

type CloudflareResourcesModule = {
  ensureR2Bucket: (name: string) => void
}

function formatR2BucketList(names: string[]): string {
  return names
    .map((name) => `name:           ${name}\ncreation_date:  2026-04-09T19:56:01.303Z`)
    .join('\n\n')
}

function queueSpawnResults(...results: SpawnResult[]): void {
  spawnSyncMock.mockReset()
  for (const result of results) {
    spawnSyncMock.mockImplementationOnce(() => ({
      status: result.status ?? 0,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    }))
  }
}

async function loadCloudflareResourcesModule(): Promise<CloudflareResourcesModule> {
  vi.resetModules()
  return await import(`${cloudflareResourcesPath}?t=${Date.now()}`) as unknown as CloudflareResourcesModule
}

afterEach(() => {
  spawnSyncMock.mockReset()
})

describe('cloudflare resource helper scripts', () => {
  describe('ensureR2Bucket', () => {
    it('reuses an existing bucket without attempting to create it', async () => {
      queueSpawnResults({
        status: 0,
        stdout: formatR2BucketList(['first', 'kanban-lite-attachments']),
      })

      const { ensureR2Bucket } = await loadCloudflareResourcesModule()
      ensureR2Bucket('kanban-lite-attachments')

      expect(spawnSyncMock).toHaveBeenCalledTimes(1)
      expect(spawnSyncMock).toHaveBeenNthCalledWith(
        1,
        'npx',
        ['wrangler', 'r2', 'bucket', 'list'],
        expect.objectContaining({ encoding: 'utf8' }),
      )
    })

    it('treats a create failure as benign when the bucket appears on the follow-up list', async () => {
      queueSpawnResults(
        {
          status: 0,
          stdout: formatR2BucketList(['first']),
        },
        {
          status: 1,
          stderr: 'The bucket you tried to create already exists, and you own it. [code: 10004]',
        },
        {
          status: 0,
          stdout: formatR2BucketList(['first', 'kanban-lite-attachments']),
        },
      )

      const { ensureR2Bucket } = await loadCloudflareResourcesModule()

      expect(() => ensureR2Bucket('kanban-lite-attachments')).not.toThrow()
      expect(spawnSyncMock).toHaveBeenCalledTimes(3)
      expect(spawnSyncMock).toHaveBeenNthCalledWith(
        2,
        'npx',
        ['wrangler', 'r2', 'bucket', 'create', 'kanban-lite-attachments'],
        expect.objectContaining({ encoding: 'utf8' }),
      )
    })

    it('throws actionable output when bucket creation genuinely fails', async () => {
      queueSpawnResults(
        {
          status: 0,
          stdout: formatR2BucketList(['first']),
        },
        {
          status: 1,
          stderr: 'permission denied',
        },
        {
          status: 0,
          stdout: formatR2BucketList(['first']),
        },
      )

      const { ensureR2Bucket } = await loadCloudflareResourcesModule()

      expect(() => ensureR2Bucket('kanban-lite-attachments')).toThrow(/Failed to create R2 bucket: kanban-lite-attachments[\s\S]*permission denied/i)
    })
  })
})
