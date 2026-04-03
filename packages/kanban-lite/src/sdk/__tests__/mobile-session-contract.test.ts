import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { KanbanSDK } from '../KanbanSDK'

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-mobile-session-contract-'))
}

describe('KanbanSDK mobile bootstrap/session contract', () => {
  let workspaceDir: string
  let kanbanDir: string
  let sdk: KanbanSDK

  beforeEach(async () => {
    workspaceDir = createTempDir()
    kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
    sdk = new KanbanSDK(kanbanDir)
    await sdk.init()
  })

  afterEach(() => {
    sdk.close()
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('reuses the local auth contract while advertising the mobile opaque-bearer transport', async () => {
    await expect(sdk.resolveMobileBootstrap({ workspaceOrigin: 'https://Field.Example.com/app/' })).resolves.toEqual({
      workspaceOrigin: 'https://field.example.com',
      workspaceId: expect.any(String),
      authentication: {
        provider: 'local',
        browserLoginTransport: 'cookie-session',
        mobileSessionTransport: 'opaque-bearer',
        sessionKind: 'local-mobile-session-v1',
      },
      bootstrapToken: {
        provided: false,
        mode: 'none',
      },
      nextStep: 'local-login',
    })
  })

  it('treats a provided bootstrap token as a one-time redemption path without inventing a second login abstraction', async () => {
    await expect(sdk.resolveMobileBootstrap({
      workspaceOrigin: 'https://example.com/workspace',
      bootstrapToken: '  one-time-token  ',
    })).resolves.toMatchObject({
      workspaceOrigin: 'https://example.com',
      authentication: {
        provider: 'local',
        browserLoginTransport: 'cookie-session',
        mobileSessionTransport: 'opaque-bearer',
        sessionKind: 'local-mobile-session-v1',
      },
      bootstrapToken: {
        provided: true,
        mode: 'one-time',
      },
      nextStep: 'redeem-bootstrap-token',
    })
  })

  it('builds a safe session-status payload from validated mobile session metadata', async () => {
    const bootstrap = await sdk.resolveMobileBootstrap({ workspaceOrigin: 'https://example.com/mobile/' })

    await expect(sdk.inspectMobileSession({
      workspaceOrigin: 'https://example.com/mobile/',
      subject: 'worker-7',
      roles: [' technician ', '', 'technician', ' reviewer '],
      expiresAt: '2026-04-02T12:00:00.000Z',
    })).resolves.toEqual({
      workspaceOrigin: 'https://example.com',
      workspaceId: bootstrap.workspaceId,
      subject: 'worker-7',
      roles: ['technician', 'reviewer'],
      expiresAt: '2026-04-02T12:00:00.000Z',
      authentication: {
        provider: 'local',
        browserLoginTransport: 'cookie-session',
        mobileSessionTransport: 'opaque-bearer',
        sessionKind: 'local-mobile-session-v1',
      },
    })
  })
})
