import * as http from 'http'

export const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.xml': 'text/xml',
  '.csv': 'text/csv',
  '.map': 'application/json'
}

/** Extended IncomingMessage that may carry a pre-buffered body injected by Fastify. */
export type IncomingMessageWithRawBody = http.IncomingMessage & { _rawBody?: Buffer }

export function readBody(req: IncomingMessageWithRawBody): Promise<Record<string, unknown>> {
  if (req._rawBody instanceof Buffer) {
    try {
      const text = req._rawBody.toString('utf-8')
      return Promise.resolve(text ? JSON.parse(text) as Record<string, unknown> : {})
    } catch (err) {
      return Promise.reject(err as Error)
    }
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf-8')
        resolve(text ? JSON.parse(text) as Record<string, unknown> : {})
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

export function matchRoute(
  expectedMethod: string,
  actualMethod: string,
  pathname: string,
  pattern: string
): Record<string, string> | null {
  if (expectedMethod !== actualMethod) return null
  const patternParts = pattern.split('/')
  const pathParts = pathname.split('/')
  if (patternParts.length !== pathParts.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i])
    } else if (patternParts[i] !== pathParts[i]) {
      return null
    }
  }
  return params
}

export function jsonOk(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  })
  res.end(JSON.stringify({ ok: true, data }))
}

export function jsonError(res: http.ServerResponse, status: number, error: string): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  })
  res.end(JSON.stringify({ ok: false, error }))
}
