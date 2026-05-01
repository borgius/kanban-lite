/**
 * Cloudflare Access JWT validation utility for kanban-lite-worker.
 * Validates the `Cf-Access-Jwt-Assertion` header injected by CF Access.
 * Uses Web Crypto API (available in Workers runtime without npm dependencies).
 */

// Module-level JWKS cache — reused across requests in the same isolate.
const jwksCache = new Map<string, CryptoKey[]>()

/**
 * Validates the CF Access JWT from the request header.
 * Returns true if valid (or if CF Access env vars are absent).
 * Returns false if the JWT is present but invalid or expired.
 */
export async function verifyCfAccessJwt(
  request: Request,
  teamDomain: string,
  audience: string,
): Promise<boolean> {
  const jwt = request.headers.get('Cf-Access-Jwt-Assertion')
  if (!jwt) return false

  const parts = jwt.split('.')
  if (parts.length !== 3) return false
  const headerB64 = parts[0] as string
  const payloadB64 = parts[1] as string
  const sigB64 = parts[2] as string

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(
      atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')),
    )
  } catch {
    return false
  }

  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
  if (!aud.includes(audience)) return false

  if (typeof payload.exp !== 'number' || payload.exp < Date.now() / 1000) {
    return false
  }

  if (payload.iss !== `https://${teamDomain}`) return false

  let keys = jwksCache.get(teamDomain)
  if (!keys) {
    const jwksRes = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`)
    if (!jwksRes.ok) return false
    const jwks = (await jwksRes.json()) as { keys: JsonWebKey[] }
    keys = await Promise.all(
      jwks.keys.map((k) =>
        crypto.subtle.importKey(
          'jwk',
          k,
          { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
          false,
          ['verify'],
        ),
      ),
    )
    jwksCache.set(teamDomain, keys)
  }

  const encoder = new TextEncoder()
  const data = encoder.encode(`${headerB64}.${payloadB64}`)
  const sig = Uint8Array.from(
    atob(sigB64.replace(/-/g, '+').replace(/_/g, '/')),
    (c) => c.charCodeAt(0),
  )

  for (const key of keys) {
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, data)
    if (valid) return true
  }
  return false
}
