import type {
  AuthPluginManifest,
  AuthVisibilityFilterInput,
  AuthVisibilityPlugin,
  Card,
  PluginSettingsOptionsSchemaFactory,
  PluginSettingsOptionsSchemaMetadata,
  Priority,
} from 'kanban-lite/sdk'

export type {
  AuthPluginManifest,
  AuthVisibilityFilterInput,
  AuthVisibilityPlugin,
  Card,
  PluginSettingsOptionsSchemaFactory,
  PluginSettingsOptionsSchemaMetadata,
  Priority,
} from 'kanban-lite/sdk'

/** Canonical provider/package id for the first-party auth visibility plugin. */
export const AUTH_VISIBILITY_PROVIDER_ID = 'kl-plugin-auth-visibility'

const PRIORITY_VALUES = ['critical', 'high', 'medium', 'low'] as const satisfies readonly Priority[]

/** Declarative role-based visibility rule for filtering cards. */
export interface AuthVisibilityRule {
  /** Resolved caller roles that activate this rule. */
  readonly roles: readonly string[]
  /** Optional allowed statuses/columns. */
  readonly statuses?: readonly string[]
  /** Optional allowed labels. */
  readonly labels?: readonly string[]
  /** Optional allowed priorities. */
  readonly priorities?: readonly Priority[]
  /** Optional allowed assignee names. Supports explicit names plus `@me`. */
  readonly assignees?: readonly string[]
}

/** Persisted options shape for the auth visibility provider. */
export interface AuthVisibilityOptions {
  /** Ordered role rules evaluated as a union across matching roles. */
  readonly rules?: readonly AuthVisibilityRule[]
}

/** Normalized options shape used internally by the evaluator. */
export interface NormalizedAuthVisibilityOptions {
  readonly rules: readonly AuthVisibilityRule[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  const normalized = value
    .filter((entry): entry is string => isNonEmptyString(entry))
    .map((entry) => entry.trim())

  return [...new Set(normalized)]
}

function normalizePriorityList(value: unknown): Priority[] {
  return normalizeStringList(value).filter((entry): entry is Priority =>
    PRIORITY_VALUES.includes(entry as Priority),
  )
}

function normalizeRule(rule: unknown): AuthVisibilityRule | null {
  if (!isRecord(rule)) return null

  const roles = normalizeStringList(rule.roles)
  if (roles.length === 0) return null

  const statuses = normalizeStringList(rule.statuses)
  const labels = normalizeStringList(rule.labels)
  const priorities = normalizePriorityList(rule.priorities)
  const assignees = normalizeStringList(rule.assignees)

  return {
    roles,
    ...(statuses.length > 0 ? { statuses } : {}),
    ...(labels.length > 0 ? { labels } : {}),
    ...(priorities.length > 0 ? { priorities } : {}),
    ...(assignees.length > 0 ? { assignees } : {}),
  }
}

/**
 * Normalizes persisted/raw provider options into the smallest safe rule contract.
 * Invalid rules are ignored rather than widening visibility accidentally.
 */
export function normalizeAuthVisibilityOptions(
  options?: AuthVisibilityOptions | Record<string, unknown>,
): NormalizedAuthVisibilityOptions {
  const rules = Array.isArray(options?.rules)
    ? options.rules
      .map((rule) => normalizeRule(rule))
      .filter((rule): rule is AuthVisibilityRule => rule !== null)
    : []

  return { rules }
}

function createAuthVisibilityOptionsSchema(): PluginSettingsOptionsSchemaMetadata {
  return {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        rules: {
          type: 'array',
          title: 'Visibility rules',
          description: 'Rules match resolved roles only. Matching rules are unioned together. Within each matching rule, every field you set must match, while any listed value inside one field is enough. Use @me in assignees to match the current resolved user.',
          default: [],
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['roles'],
            properties: {
              roles: {
                type: 'array',
                title: 'Roles',
                description: 'Resolved role names that activate this rule.',
                minItems: 1,
                items: {
                  type: 'string',
                  title: 'Role',
                  minLength: 1,
                },
              },
              statuses: {
                type: 'array',
                title: 'Statuses / columns',
                description: 'Optional status or column IDs that cards must match.',
                items: {
                  type: 'string',
                  title: 'Status / column',
                  minLength: 1,
                },
              },
              labels: {
                type: 'array',
                title: 'Labels',
                description: 'Optional labels; any listed label may match.',
                items: {
                  type: 'string',
                  title: 'Label',
                  minLength: 1,
                },
              },
              priorities: {
                type: 'array',
                title: 'Priorities',
                description: 'Optional priority allowlist for this rule.',
                items: {
                  type: 'string',
                  title: 'Priority',
                  enum: [...PRIORITY_VALUES],
                },
              },
              assignees: {
                type: 'array',
                title: 'Assignees',
                description: 'Optional assignee allowlist. Use explicit assignee names or @me for the current resolved user.',
                items: {
                  type: 'string',
                  title: 'Assignee',
                  minLength: 1,
                },
              },
            },
          },
        },
      },
    },
    uiSchema: {
      type: 'VerticalLayout',
      elements: [
        {
          type: 'Group',
          label: 'Visibility rules',
          elements: [
            {
              type: 'Control',
              scope: '#/properties/rules',
              label: 'Role rules',
              options: {
                detail: {
                  type: 'VerticalLayout',
                  elements: [
                    {
                      type: 'Group',
                      label: 'Who this rule applies to',
                      elements: [
                        {
                          type: 'Control',
                          scope: '#/properties/roles',
                          label: 'Matching roles',
                        },
                      ],
                    },
                    {
                      type: 'Group',
                      label: 'Which cards become visible',
                      elements: [
                        {
                          type: 'Control',
                          scope: '#/properties/statuses',
                          label: 'Statuses / columns',
                        },
                        {
                          type: 'Control',
                          scope: '#/properties/labels',
                          label: 'Labels',
                        },
                        {
                          type: 'Control',
                          scope: '#/properties/priorities',
                          label: 'Priorities',
                        },
                        {
                          type: 'Control',
                          scope: '#/properties/assignees',
                          label: 'Assignees',
                        },
                      ],
                    },
                  ],
                },
              },
            },
          ],
        },
      ],
    },
    secrets: [],
  }
}

function resolveCurrentSubject(input: AuthVisibilityFilterInput): string | null {
  const subject = input.identity?.subject ?? input.auth.identity?.subject
  return isNonEmptyString(subject) ? subject.trim() : null
}

function matchesScalarFilter(expected: readonly string[], actual: string | null | undefined): boolean {
  if (expected.length === 0) return true
  if (!isNonEmptyString(actual)) return false
  return expected.includes(actual.trim())
}

function matchesLabelFilter(expected: readonly string[], labels: readonly string[]): boolean {
  if (expected.length === 0) return true
  const actualLabels = new Set(labels)
  return expected.some((label) => actualLabels.has(label))
}

function matchesAssigneeFilter(
  expected: readonly string[],
  assignee: string | null,
  currentSubject: string | null,
): boolean {
  if (expected.length === 0) return true
  if (!isNonEmptyString(assignee)) return false

  return expected.some((candidate) => {
    if (candidate === '@me') {
      return currentSubject !== null && assignee === currentSubject
    }
    return assignee === candidate
  })
}

function cardMatchesRule(card: Card, rule: AuthVisibilityRule, currentSubject: string | null): boolean {
  const statuses = rule.statuses ?? []
  const labels = rule.labels ?? []
  const priorities = rule.priorities ?? []
  const assignees = rule.assignees ?? []

  return matchesScalarFilter(statuses, card.status)
    && matchesLabelFilter(labels, card.labels)
    && (priorities.length === 0 || priorities.includes(card.priority))
    && matchesAssigneeFilter(assignees, card.assignee, currentSubject)
}

/**
 * Pure evaluator for role-based auth visibility rules.
 *
 * Matching rules are selected by role intersection only, then unioned together by
 * returning every card that satisfies at least one selected rule. Inside each
 * rule, defined fields combine with AND semantics while each field's values
 * combine with OR semantics.
 */
export async function evaluateAuthVisibility(
  cards: readonly Card[],
  input: AuthVisibilityFilterInput,
  options?: AuthVisibilityOptions | Record<string, unknown>,
): Promise<Card[]> {
  const normalizedOptions = normalizeAuthVisibilityOptions(options)
  const callerRoles = normalizeStringList(input.roles)
  if (normalizedOptions.rules.length === 0 || callerRoles.length === 0) {
    return []
  }

  const matchingRules = normalizedOptions.rules.filter((rule) =>
    rule.roles.some((role) => callerRoles.includes(role)),
  )
  if (matchingRules.length === 0) {
    return []
  }

  const currentSubject = resolveCurrentSubject(input)
  return cards.filter((card) => matchingRules.some((rule) => cardMatchesRule(card, rule, currentSubject)))
}

/** Creates a configured auth.visibility provider instance from persisted options. */
export function createAuthVisibilityPlugin(
  options?: AuthVisibilityOptions | Record<string, unknown>,
  providerId = AUTH_VISIBILITY_PROVIDER_ID,
): AuthVisibilityPlugin & { optionsSchema: PluginSettingsOptionsSchemaFactory } {
  const normalizedOptions = normalizeAuthVisibilityOptions(options)
  const manifest: AuthPluginManifest = {
    id: providerId,
    provides: ['auth.visibility'],
  }

  return {
    manifest,
    optionsSchema: createAuthVisibilityOptionsSchema,
    async filterVisibleCards(cards: readonly Card[], input: AuthVisibilityFilterInput): Promise<Card[]> {
      return evaluateAuthVisibility(cards, input, normalizedOptions)
    },
  }
}

/** Discovery/runtime export for the package-name provider id. */
export const authVisibilityPlugin = createAuthVisibilityPlugin()

/** Provider map used by the shared external-package auth visibility loader. */
export const authVisibilityPlugins: Record<string, AuthVisibilityPlugin> = {
  [AUTH_VISIBILITY_PROVIDER_ID]: authVisibilityPlugin,
}

/** Options schemas keyed by provider id for shared plugin-settings discovery. */
export const optionsSchemas: Record<string, PluginSettingsOptionsSchemaFactory> = {
  [AUTH_VISIBILITY_PROVIDER_ID]: createAuthVisibilityOptionsSchema,
}

/** Standard package manifest for capability discovery. */
export const pluginManifest = {
  id: AUTH_VISIBILITY_PROVIDER_ID,
  capabilities: {
    'auth.visibility': [AUTH_VISIBILITY_PROVIDER_ID] as const,
  },
} as const

const authVisibilityPluginPackage = {
  pluginManifest,
  authVisibilityPlugin,
  authVisibilityPlugins,
  createAuthVisibilityPlugin,
  evaluateAuthVisibility,
  optionsSchemas,
}

export default authVisibilityPluginPackage
