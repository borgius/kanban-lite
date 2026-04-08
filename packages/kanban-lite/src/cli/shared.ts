import * as fs from 'fs/promises'
import * as path from 'path'
import { KanbanSDK } from '../sdk/KanbanSDK'
import { resolveKanbanDir as resolveDefaultKanbanDir, resolveWorkspaceRoot } from '../sdk/fileUtils'
import type { Priority } from '../shared/types'
import { AuthError, CardStateError, type AuthContext } from '../sdk/types'
import { red } from './output'

export type Flags = Record<string, string | true | string[]>

export const VALID_PRIORITIES: Priority[] = ['critical', 'high', 'medium', 'low']

function resolveCliAuthContext(flags: Flags = {}): AuthContext {
  const tokenFromFlag = typeof flags.token === 'string' && flags.token.trim().length > 0
    ? flags.token.trim()
    : undefined
  const tokenFromEnv = process.env.KANBAN_LITE_TOKEN || process.env.KANBAN_TOKEN
  const token = tokenFromFlag || tokenFromEnv
  const tokenSource = tokenFromFlag ? 'flag' : tokenFromEnv ? 'env' : undefined
  return token ? { token, tokenSource, transport: 'cli' } : { transport: 'cli' }
}

export function runWithCliAuth<T>(sdk: KanbanSDK, flags: Flags | undefined, fn: () => Promise<T>): Promise<T> {
  return sdk.runWithAuth(resolveCliAuthContext(flags), fn)
}

export function getCliAuthStatus(sdk: KanbanSDK, flags: Flags) {
  const auth = sdk.getAuthStatus()
  const ctx = resolveCliAuthContext(flags)
  return {
    ...auth,
    configured: auth.identityEnabled || auth.policyEnabled,
    tokenPresent: Boolean(ctx.token),
    tokenSource: ctx.tokenSource ?? null,
    transport: ctx.transport ?? 'cli',
  }
}

export function handleAuthError(err: AuthError): never {
  if (err.category === 'auth.identity.missing' || err.category === 'auth.identity.invalid' || err.category === 'auth.identity.expired') {
    console.error(red('Error: Authentication required. Set KANBAN_LITE_TOKEN or pass --token <value>.'))
  } else {
    console.error(red(`Error: Access denied (${err.category})`))
  }
  process.exit(1)
}

export function handleCardStateError(err: CardStateError, flags: Flags): never {
  const payload = {
    code: err.code,
    availability: err.availability,
    message: err.message,
  }
  if (flags.json) {
    console.error(JSON.stringify(payload, null, 2))
  } else {
    console.error(red(`Error: ${err.code} (${err.availability}) ${err.message}`))
  }
  process.exit(1)
}

export function parseArgs(argv: string[]): { command: string; positional: string[]; flags: Flags } {
  const args = argv.slice(2)
  const command = args[0] || 'help'
  const positional: string[] = []
  const flags: Flags = {}

  for (let i = 1; i < args.length; i++) {
    const arg = args[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = args[i + 1]
      if (key === 'meta') {
        if (!next || next.startsWith('--')) {
          console.error(red('--meta requires a value in key=value format'))
          process.exit(1)
        }
        const existing = flags.meta
        flags.meta = Array.isArray(existing) ? [...existing, next] : [next]
        i++
      } else if (next && !next.startsWith('--')) {
        flags[key] = next
        i++
      } else {
        flags[key] = true
      }
    } else {
      positional.push(arg)
    }
  }

  return { command, positional, flags }
}

export function getBoardId(flags: Flags): string | undefined {
  return typeof flags.board === 'string' ? flags.board : undefined
}

export async function getValidStatuses(sdk: KanbanSDK, boardId?: string): Promise<string[]> {
  const columns = await sdk.listColumns(boardId)
  return columns.map(c => c.id)
}

export function getConfigFilePath(flags: Flags): string | undefined {
  return typeof flags.config === 'string' ? path.resolve(flags.config) : undefined
}

export function resolveWorkspaceRootForFlags(flags: Flags): string {
  const configFilePath = getConfigFilePath(flags)
  if (configFilePath) {
    return resolveWorkspaceRoot(process.cwd(), configFilePath)
  }
  if (typeof flags.dir === 'string') {
    return path.dirname(path.resolve(flags.dir))
  }
  return resolveWorkspaceRoot(process.cwd())
}

export function resolveKanbanDirForFlags(flags: Flags): string {
  if (typeof flags.dir === 'string') {
    return path.resolve(flags.dir)
  }
  return resolveDefaultKanbanDir(process.cwd(), getConfigFilePath(flags))
}

async function parseJsonFlagValue(value: string, flagName: string): Promise<unknown> {
  let jsonText = value

  if (value.startsWith('@')) {
    const jsonPath = path.resolve(value.slice(1))
    try {
      jsonText = await fs.readFile(jsonPath, 'utf-8')
    } catch {
      console.error(red(`Error: --${flagName} could not read JSON file: ${jsonPath}`))
      process.exit(1)
    }
  }

  try {
    return JSON.parse(jsonText)
  } catch {
    console.error(red(`Error: --${flagName} must be valid JSON or @path to a JSON file`))
    process.exit(1)
  }
}

export async function parseJsonObjectFlag(value: string, flagName: string): Promise<Record<string, unknown>> {
  const parsed = await parseJsonFlagValue(value, flagName)
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    console.error(red(`Error: --${flagName} must be a JSON object`))
    process.exit(1)
  }
  return parsed as Record<string, unknown>
}

export async function parseJsonArrayFlag<T>(value: string, flagName: string): Promise<T[]> {
  const parsed = await parseJsonFlagValue(value, flagName)
  if (!Array.isArray(parsed)) {
    console.error(red(`Error: --${flagName} must be a JSON array`))
    process.exit(1)
  }
  return parsed as T[]
}

export async function resolveCardId(
  sdk: KanbanSDK,
  cardId: string,
  boardId: string | undefined,
  flags: Flags,
): Promise<string> {
  const card = await runWithCliAuth(sdk, flags, () => sdk.getCard(cardId, boardId))
  if (card) return cardId

  const all = await runWithCliAuth(sdk, flags, () => sdk.listCards(undefined, boardId))
  const matches = all.filter(c => c.id.includes(cardId))
  if (matches.length === 1) return matches[0].id
  if (matches.length > 1) {
    console.error(red(`Multiple cards match "${cardId}":`))
    for (const match of matches) console.error(`  ${match.id}`)
    process.exit(1)
  }
  console.error(red(`Card not found: ${cardId}`))
  process.exit(1)
}
