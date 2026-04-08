import type {
  PluginSettingsOptionsSchemaMetadata,
  PluginSettingsRedactedValues,
  PluginSettingsRedactionPolicy,
  PluginSettingsSecretFieldMetadata,
} from '../../../shared/types'
import type { ProviderRef } from '../../../shared/config'

type UnknownRecord = Record<string, unknown>
type ProviderOptionsRecord = Record<string, unknown>

const PLUGIN_SETTINGS_SECRET_KEY_PATTERN = /(secret|token|password|passphrase|private[-_]?key|client[-_]?secret|secret[-_]?key|session[-_]?token|api[-_]?key)/i

function isRecord(value: unknown): value is UnknownRecord
function isRecord<T extends object>(value: unknown): value is T & UnknownRecord
function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function tokenizePluginSettingsPath(value: string): string[] {
  const tokens: string[] = []
  const pattern = /([^.[\]]+)|\[(\d+)\]/g

  for (const match of value.matchAll(pattern)) {
    tokens.push(match[1] ?? match[2])
  }

  return tokens
}

function matchesSecretPathPattern(pattern: string, currentPath: string): boolean {
  const patternTokens = tokenizePluginSettingsPath(pattern)
  const currentTokens = tokenizePluginSettingsPath(currentPath)

  if (patternTokens.length !== currentTokens.length) return false

  return patternTokens.every((token, index) => token === '*' || token === currentTokens[index])
}

function isSecretPath(patterns: readonly string[], currentPath: string): boolean {
  return patterns.some((pattern) => matchesSecretPathPattern(pattern, currentPath))
}

function getLastPluginSettingsPathToken(currentPath: string): string | null {
  const tokens = tokenizePluginSettingsPath(currentPath)
  return tokens.length > 0 ? tokens[tokens.length - 1] : null
}

function isSecretKeyName(key: string): boolean {
  return PLUGIN_SETTINGS_SECRET_KEY_PATTERN.test(key)
}

export function mergeProviderOptionsUpdate(
  currentValue: unknown,
  nextValue: unknown,
  currentPath: string,
  secretPaths: readonly string[],
  redaction: PluginSettingsRedactionPolicy,
): unknown {
  const currentToken = currentPath ? getLastPluginSettingsPathToken(currentPath) : null
  if (currentPath && (isSecretPath(secretPaths, currentPath) || (currentToken !== null && isSecretKeyName(currentToken)))) {
    if (nextValue === undefined || nextValue === redaction.maskedValue) {
      return currentValue === undefined ? undefined : structuredClone(currentValue)
    }
    return structuredClone(nextValue)
  }

  if (Array.isArray(nextValue)) {
    const currentArray = Array.isArray(currentValue) ? currentValue : []
    return nextValue.map((entry, index) => mergeProviderOptionsUpdate(
      currentArray[index],
      entry,
      `${currentPath}[${index}]`,
      secretPaths,
      redaction,
    ))
  }

  if (!isRecord(nextValue)) {
    return structuredClone(nextValue)
  }

  const currentRecord = isRecord(currentValue) ? currentValue : {}
  const merged: Record<string, unknown> = {}

  for (const [key, entry] of Object.entries(currentRecord)) {
    merged[key] = structuredClone(entry)
  }

  for (const [key, entry] of Object.entries(nextValue)) {
    const childPath = currentPath ? `${currentPath}.${key}` : key
    const mergedValue = mergeProviderOptionsUpdate(currentRecord[key], entry, childPath, secretPaths, redaction)

    if (mergedValue === undefined) {
      delete merged[key]
      continue
    }

    merged[key] = mergedValue
  }

  return merged
}

function redactProviderOptionsValue(
  value: unknown,
  currentPath: string,
  secretPaths: readonly string[],
  redactedPaths: string[],
  redaction: PluginSettingsRedactionPolicy,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry, index) => redactProviderOptionsValue(
      entry,
      `${currentPath}[${index}]`,
      secretPaths,
      redactedPaths,
      redaction,
    ))
  }

  if (!isRecord(value)) return value

  const next: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    const childPath = currentPath ? `${currentPath}.${key}` : key
    if (isSecretPath(secretPaths, childPath) || isSecretKeyName(key)) {
      next[key] = redaction.maskedValue
      redactedPaths.push(childPath)
      continue
    }

    next[key] = redactProviderOptionsValue(entry, childPath, secretPaths, redactedPaths, redaction)
  }

  return next
}

export function createRedactedProviderOptions(
  options: Record<string, unknown> | undefined,
  optionsSchema: PluginSettingsOptionsSchemaMetadata | undefined,
  redaction: PluginSettingsRedactionPolicy,
): PluginSettingsRedactedValues | null {
  if (options === undefined) return null

  const redactedPaths: string[] = []
  const secretPaths = optionsSchema?.secrets.map((secret) => secret.path) ?? []
  const values = redactProviderOptionsValue(structuredClone(options), '', secretPaths, redactedPaths, redaction)

  return {
    values: isRecord(values) ? values : {},
    redactedPaths,
    redaction,
  }
}

