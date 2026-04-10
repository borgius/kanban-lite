/**
 * Cloudflare resource management helpers — create/ensure D1 databases, R2 buckets, and Queues via wrangler.
 */
import { spawnSync } from 'node:child_process'

const nodeConsole = globalThis.console

function spawnCapture(command, args) {
  const result = spawnSync(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  })
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function parseJson(text) {
  try { return JSON.parse(text) } catch { return null }
}

function parseKeyedListValues(text, key) {
  return [...text.matchAll(new RegExp(`^\\s*${key}:\\s*(.+?)\\s*$`, 'gm'))]
    .map((match) => match[1]?.trim())
    .filter(Boolean)
}

function formatCommandFailure(detail) {
  const text = [detail.stdout, detail.stderr]
    .filter((value) => typeof value === 'string' && value.trim())
    .join('\n')
    .trim()

  return text ? `\n${text}` : ''
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
 * Lists all R2 buckets in the account and returns the bucket name when present, or null.
 * @param {string} name
 * @returns {string | null}
 */
export function findR2BucketByName(name) {
  const { status, stdout } = spawnCapture('npx', ['wrangler', 'r2', 'bucket', 'list'])
  if (status !== 0) return null
  return parseKeyedListValues(stdout, 'name').find((bucketName) => bucketName === name) ?? null
}

/**
 * Creates an R2 bucket via wrangler when missing.
 * @param {string} name
 */
export function ensureR2Bucket(name) {
  if (findR2BucketByName(name)) {
    nodeConsole.log(`  Using existing R2 bucket: ${name}`)
    return
  }

  nodeConsole.log(`  Creating R2 bucket: ${name}`)
  const result = spawnCapture('npx', ['wrangler', 'r2', 'bucket', 'create', name])
  if (result.status === 0) return

  if (findR2BucketByName(name)) {
    nodeConsole.log(`  R2 bucket '${name}' already exists — continuing`)
    return
  }

  throw new Error(`Failed to create R2 bucket: ${name}${formatCommandFailure(result)}`)
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
