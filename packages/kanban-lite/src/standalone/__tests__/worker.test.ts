import { describe, expect, it } from 'vitest'
import { createCloudflareWorkerFetchHandler } from '../../worker'

describe('Cloudflare worker entrypoint', () => {
  it('returns an explicit 501 for websocket upgrades', async () => {
    const handler = createCloudflareWorkerFetchHandler({
      kanbanDir: '.kanban',
      config: {
        version: 2,
        defaultBoard: 'default',
        boards: {
          default: {
            columns: [],
          },
        },
      },
    })

    const response = await handler(new Request('https://example.test/ws', {
      headers: { Upgrade: 'websocket' },
    }))

    expect(response.status).toBe(501)
    await expect(response.text()).resolves.toContain('WebSocket upgrades are not supported')
  })
})
