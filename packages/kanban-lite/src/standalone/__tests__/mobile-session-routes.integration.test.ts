import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'

import { startServer } from '../server'

const MOBILE_PASSWORD = 'secret123'
const MOBILE_API_TOKEN = 'workspace-api-token'
const MOBILE_BOOTSTRAP_FILE = '.mobile-bootstrap-tokens.json'
const LOCAL_AUTH_TEST_PASSWORD_HASH = '$2b$04$jg1y2jvcM0s3Zr0q/vhBc.HvbMAXNDTS52.VJdC/GfbB2AIYnpWmK'

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function createTempWebviewDir(): string {
  const dir = createTempDir('kanban-mobile-webview-')
  fs.writeFileSync(path.join(dir, 'index.js'), '// mobile session integration test bundle', 'utf-8')
  fs.writeFileSync(path.join(dir, 'style.css'), '/* mobile session integration test styles */', 'utf-8')
  return dir
}

function writeWorkspaceConfig(workspaceRoot: string): string {
  const configPath = path.join(workspaceRoot, '.kanban.json')
  fs.writeFileSync(configPath, JSON.stringify({
    version: 2,
    auth: {
      'auth.identity': {
        provider: 'local',
        options: {
          apiToken: MOBILE_API_TOKEN,
          users: [
            {
              username: 'worker',
              password: LOCAL_AUTH_TEST_PASSWORD_HASH,
              role: 'user',
            },
          ],
        },
      },
      'auth.policy': {
        provider: 'local',
      },
    },
  }, null, 2), 'utf-8')
  return configPath
}

function writeBootstrapGrant(
  kanbanDir: string,
  token: string,
  workspaceOrigin: string,
  username = 'worker',
  expiresAt = Date.now() + 60_000,
): void {
  fs.writeFileSync(
    path.join(kanbanDir, MOBILE_BOOTSTRAP_FILE),
    JSON.stringify({
      [token]: {
        username,
        workspaceOrigin,
        expiresAt,
      },
    }, null, 2),
    'utf-8',
  )
}

function getPort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = http.createServer()
    srv.listen(0, () => {
      const address = srv.address() as { port: number }
      srv.close(() => resolve(address.port))
    })
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function httpRequest(
  method: string,
  url: string,
  body?: unknown,
  headers?: http.OutgoingHttpHeaders,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const payload = body === undefined
      ? undefined
      : typeof body === 'string'
        ? body
        : JSON.stringify(body)
    const resolvedHeaders: http.OutgoingHttpHeaders = {
      ...(payload ? { 'Content-Length': Buffer.byteLength(payload).toString() } : {}),
      ...(payload && typeof body !== 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...(headers ?? {}),
    }
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method,
        headers: resolvedHeaders,
      },
      (res) => {
        let responseBody = ''
        res.on('data', (chunk) => {
          responseBody += chunk
        })
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: responseBody,
          })
        })
      },
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

describe('Standalone mobile bootstrap/session routes', () => {
  let workspaceRoot: string
  let kanbanDir: string
  let webviewDir: string
  let configPath: string
  let server: http.Server
  let port: number

  beforeEach(async () => {
    workspaceRoot = createTempDir('kanban-mobile-session-workspace-')
    kanbanDir = path.join(workspaceRoot, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
    webviewDir = createTempWebviewDir()
    configPath = writeWorkspaceConfig(workspaceRoot)
    port = await getPort()
    server = startServer(kanbanDir, port, webviewDir, configPath)
    await sleep(200)
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    fs.rmSync(workspaceRoot, { recursive: true, force: true })
    fs.rmSync(webviewDir, { recursive: true, force: true })
  })

  it('resolves workspace bootstrap metadata without requiring browser auth', async () => {
    const response = await httpRequest('POST', `http://localhost:${port}/api/mobile/bootstrap`, {
      workspaceOrigin: 'https://Field.Example.com/app/',
    })

    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({
      ok: true,
      data: {
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
      },
    })
  })

  it('exchanges local credentials for an opaque mobile session and validates it through GET /api/mobile/session', async () => {
    const bootstrapResponse = await httpRequest('POST', `http://localhost:${port}/api/mobile/bootstrap`, {
      workspaceOrigin: 'https://field.example.com/mobile/',
    })
    const bootstrapJson = JSON.parse(bootstrapResponse.body) as {
      data: {
        workspaceId: string
      }
    }

    const loginResponse = await httpRequest('POST', `http://localhost:${port}/api/mobile/session`, {
      workspaceOrigin: 'https://field.example.com/mobile/',
      username: 'worker',
      password: MOBILE_PASSWORD,
    })

    expect(loginResponse.status).toBe(200)
    expect(loginResponse.headers['set-cookie']).toBeUndefined()

    const loginJson = JSON.parse(loginResponse.body) as {
      ok: boolean
      data: {
        session: {
          kind: string
          token: string
        }
        status: {
          workspaceOrigin: string
          workspaceId: string
          subject: string
          roles: string[]
          expiresAt: string | null
          authentication: {
            provider: string
            browserLoginTransport: string
            mobileSessionTransport: string
            sessionKind: string
          }
        }
      }
    }

    expect(loginJson.ok).toBe(true)
    expect(loginJson.data.session.kind).toBe('local-mobile-session-v1')
    expect(loginJson.data.session.token.length).toBeGreaterThan(20)
    expect(loginJson.data.status).toMatchObject({
      workspaceOrigin: 'https://field.example.com',
      workspaceId: bootstrapJson.data.workspaceId,
      subject: 'worker',
      roles: ['user'],
      authentication: {
        provider: 'local',
        browserLoginTransport: 'cookie-session',
        mobileSessionTransport: 'opaque-bearer',
        sessionKind: 'local-mobile-session-v1',
      },
    })

    const sessionResponse = await httpRequest(
      'GET',
      `http://localhost:${port}/api/mobile/session?workspaceOrigin=${encodeURIComponent('https://field.example.com/mobile')}`,
      undefined,
      {
        Authorization: `Bearer ${loginJson.data.session.token}`,
      },
    )

    expect(sessionResponse.status).toBe(200)
    expect(JSON.parse(sessionResponse.body)).toEqual({
      ok: true,
      data: loginJson.data.status,
    })
  })

  it('rejects wrong-workspace mobile session validation even when the token is otherwise valid', async () => {
    const loginResponse = await httpRequest('POST', `http://localhost:${port}/api/mobile/session`, {
      workspaceOrigin: 'https://field.example.com/mobile/',
      username: 'worker',
      password: MOBILE_PASSWORD,
    })
    const loginJson = JSON.parse(loginResponse.body) as { data: { session: { token: string } } }

    const sessionResponse = await httpRequest(
      'GET',
      `http://localhost:${port}/api/mobile/session?workspaceOrigin=${encodeURIComponent('https://wrong.example.com/mobile')}`,
      undefined,
      {
        Authorization: `Bearer ${loginJson.data.session.token}`,
      },
    )

    expect(sessionResponse.status).toBe(403)
    expect(JSON.parse(sessionResponse.body)).toEqual({
      ok: false,
      error: 'Mobile session is not valid for the requested workspace.',
    })
  })

  it('revokes an opaque mobile session through DELETE /api/mobile/session', async () => {
    const loginResponse = await httpRequest('POST', `http://localhost:${port}/api/mobile/session`, {
      workspaceOrigin: 'https://field.example.com/mobile/',
      username: 'worker',
      password: MOBILE_PASSWORD,
    })
    const loginJson = JSON.parse(loginResponse.body) as { data: { session: { token: string } } }

    const revokeResponse = await httpRequest(
      'DELETE',
      `http://localhost:${port}/api/mobile/session`,
      undefined,
      {
        Authorization: `Bearer ${loginJson.data.session.token}`,
      },
    )

    expect(revokeResponse.status).toBe(200)
    expect(JSON.parse(revokeResponse.body)).toEqual({ ok: true })

    const sessionResponse = await httpRequest(
      'GET',
      `http://localhost:${port}/api/mobile/session?workspaceOrigin=${encodeURIComponent('https://field.example.com/mobile')}`,
      undefined,
      {
        Authorization: `Bearer ${loginJson.data.session.token}`,
      },
    )

    expect(sessionResponse.status).toBe(401)
    expect(JSON.parse(sessionResponse.body)).toEqual({
      ok: false,
      error: 'Authentication required',
    })
  })

  it('supports one-time bootstrap-token exchange and rejects replay', async () => {
    writeBootstrapGrant(kanbanDir, 'bootstrap-token-1', 'https://field.example.com')

    const bootstrapResponse = await httpRequest('POST', `http://localhost:${port}/api/mobile/bootstrap`, {
      workspaceOrigin: 'https://field.example.com/mobile/',
      bootstrapToken: 'bootstrap-token-1',
    })
    expect(bootstrapResponse.status).toBe(200)
    expect(JSON.parse(bootstrapResponse.body)).toMatchObject({
      ok: true,
      data: {
        workspaceOrigin: 'https://field.example.com',
        workspaceId: expect.any(String),
        bootstrapToken: {
          provided: true,
          mode: 'one-time',
        },
        nextStep: 'redeem-bootstrap-token',
      },
    })

    const exchangeResponse = await httpRequest('POST', `http://localhost:${port}/api/mobile/session`, {
      workspaceOrigin: 'https://field.example.com/mobile/',
      bootstrapToken: 'bootstrap-token-1',
    })

    expect(exchangeResponse.status).toBe(200)
    const exchangeJson = JSON.parse(exchangeResponse.body) as {
      data: {
        session: {
          token: string
        }
        status: {
          workspaceId: string
        }
      }
    }
    expect(exchangeJson.data.session.token.length).toBeGreaterThan(20)
    expect(exchangeJson.data.status.workspaceId).toBe(
      (JSON.parse(bootstrapResponse.body) as { data: { workspaceId: string } }).data.workspaceId,
    )

    const replayResponse = await httpRequest('POST', `http://localhost:${port}/api/mobile/session`, {
      workspaceOrigin: 'https://field.example.com/mobile/',
      bootstrapToken: 'bootstrap-token-1',
    })

    expect(replayResponse.status).toBe(401)
    expect(JSON.parse(replayResponse.body)).toEqual({
      ok: false,
      error: 'ERR_MOBILE_AUTH_LINK_INVALID',
    })
  })

  it('keeps /auth/login JSON interoperability browser-first for standalone clients', async () => {
    const response = await httpRequest('POST', `http://localhost:${port}/auth/login`, {
      username: 'worker',
      password: MOBILE_PASSWORD,
      returnTo: '/api/tasks',
    })

    expect(response.status).toBe(302)
    expect(response.headers.location).toBe('/api/tasks')
    expect(response.headers['set-cookie']).toEqual(
      expect.arrayContaining([
        expect.stringContaining('kanban_lite_session='),
      ]),
    )
  })
})