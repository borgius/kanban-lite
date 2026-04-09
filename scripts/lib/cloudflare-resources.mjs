/**
 * Cloudflare resource management helpers — create/ensure D1 databases, R2 buckets, and Queues via wrangler.
 */
import { spawnSync } from 'node:child_process'

const nodeConsole = globalThis.console

function spawnCapture(command, args) {
  const result = spawnSync(command, args, {
    stdio: ['inherit', 'pipe', 'inherit'],
    encoding: 'utf8',
  })
  return { status: result.status ?? 1, stdout: result.stdout ?? '' }
}

function parseJson(text) {
  try { return JSON.parse(text) } catch { return null }
}

/**
 * Lists all D1 databases in the account and returns the one matching the given name, or null.
 * @param {string} name
 * @returns {{ name: string, uuid: string } | null}
 */
export function findD1DatabaseByName(name) {
  const { status, stdout } = spawnCapture('npx', ['wrangler', 'd1', 'list', '--json'])
  if (status !== 0) return null
  const list = parseJson(stdout)
  return (Array.isArray(list) ? list.find((db) => db.name === name) : null) ?? null
}

/**
 * Creates a D1 database via wrangler and returns { id, name }.
 * @param {string} name
 * @returns {{ id: string, name: string }}
 */
export function createD1Database(name) {
  nodeConsole.log(`  Creating D1 database: ${name}`)
  const result = spawnSync('npx', ['wrangler', 'd1', 'create', name], {
    stdio: 'inherit',
    encoding: 'utf8',
  })
  const status = result.status ?? 1
  if (status !== 0) throw new Error(`Failed to create D1 database: ${name}`)
  const created = findD1DatabaseByName(name)
  if (!created?.uuid) throw new Error(`Created D1 database was not visible in wrangler d1 list output: ${name}`)
  return { id: created.uuid, name: created.name ?? name }
}

/**
 * Finds or creates a D1 database and returns { id, name }.
 * @param {string} name
 * @returns {{ id: string, name: string }}
 */
export function ensureD1Database(name) {
  const existing = findD1DatabaseByName(name)
  if (existing) {
    nodeConsole.log(`  Using existing D1 database: ${name} (${existing.uuid})`)
    return { id: existing.uuid, name: existing.name ?? name }
  }
  return createD1Database(name)
}

/**
 * Creates an R2 bucket via wrangler. Logs a warning if it already exists (non-zero exit).
 * @param {string} name
 */
export function ensureR2Bucket(name) {
  nodeConsole.log(`  Ensuring R2 bucket: ${name}`)
  const result = spawnSync('npx', ['wrangler', 'r2', 'bucket', 'create', name], {
    stdio: 'inherit',
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    nodeConsole.log(`  R2 bucket '${name}' may already exist — continuing`)
  }
}

/**
 * Creates a Cloudflare Queue via wrangler. Logs a warning if it already exists.
 * @param {string} name
 */
export function ensureQueue(name) {
  nodeConsole.log(`  Ensuring Queue: ${name}`)
  const result = spawnSync('npx', ['wrangler', 'queues', 'create', name], {
    stdio: 'inherit',
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    nodeConsole.log(`  Queue '${name}' may already exist — continuing`)
  }
}
