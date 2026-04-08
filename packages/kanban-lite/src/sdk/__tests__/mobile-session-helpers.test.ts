import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MOBILE_AUTHENTICATION_CONTRACT,
  buildMobileWorkspaceId,
  cloneMobileAuthenticationContract,
  inspectMobileSession,
  resolveMobileBootstrap,
} from '../mobileSession'

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-mobile-session-helpers-'))
}

describe('mobile session helpers', () => {
  let workspaceRoot: string

  beforeEach(() => {
    workspaceRoot = createTempDir()
  })

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true })
  })

  it('keeps the fixed auth contract immutable while returning fresh caller copies', () => {
    const mutated = cloneMobileAuthenticationContract()
    Reflect.set(mutated, 'mobileSessionTransport', 'mutated')

    expect(MOBILE_AUTHENTICATION_CONTRACT).toEqual({
      provider: 'local',
      browserLoginTransport: 'cookie-session',
      mobileSessionTransport: 'opaque-bearer',
      sessionKind: 'local-mobile-session-v1',
    })
    expect(cloneMobileAuthenticationContract()).toEqual(MOBILE_AUTHENTICATION_CONTRACT)
  })

  it('builds matching bootstrap and session payloads for the same workspace root', () => {
    const workspaceId = buildMobileWorkspaceId(workspaceRoot)

    expect(resolveMobileBootstrap(workspaceRoot, {
      workspaceOrigin: 'https://Field.Example.com/app/',
      bootstrapToken: '  one-time-token  ',
    })).toEqual({
      workspaceOrigin: 'https://field.example.com',
      workspaceId,
      authentication: cloneMobileAuthenticationContract(),
      bootstrapToken: {
        provided: true,
        mode: 'one-time',
      },
      nextStep: 'redeem-bootstrap-token',
    })

    expect(inspectMobileSession(workspaceRoot, {
      workspaceOrigin: 'https://field.example.com/mobile/',
      subject: '  worker-7  ',
      roles: [' technician ', '', 'technician', ' reviewer '],
    })).toEqual({
      workspaceOrigin: 'https://field.example.com',
      workspaceId,
      subject: 'worker-7',
      roles: ['technician', 'reviewer'],
      expiresAt: null,
      authentication: cloneMobileAuthenticationContract(),
    })
  })
})