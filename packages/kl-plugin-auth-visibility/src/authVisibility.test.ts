import type { Card } from 'kanban-lite/sdk'
import { describe, expect, it } from 'vitest'
import {
  AUTH_VISIBILITY_PROVIDER_ID,
  authVisibilityPlugin,
  authVisibilityPlugins,
  createAuthVisibilityPlugin,
  evaluateAuthVisibility,
  optionsSchemas,
  pluginManifest,
} from './index'

interface SchemaNode {
  type?: string
  default?: unknown
  minItems?: number
  properties?: Record<string, SchemaNode>
  items?: SchemaNode
  enum?: readonly string[]
}

interface UiSchemaNode {
  scope?: string
  elements?: UiSchemaNode[]
  options?: {
    detail?: UiSchemaNode
  }
}

function makeCard(overrides: Partial<Card> & Pick<Card, 'id'>): Card {
  return {
    version: 1,
    id: overrides.id,
    status: 'todo',
    priority: 'medium',
    assignee: null,
    dueDate: null,
    created: '2026-03-31T00:00:00.000Z',
    modified: '2026-03-31T00:00:00.000Z',
    completedAt: null,
    labels: [],
    attachments: [],
    comments: [],
    order: overrides.id,
    content: `# ${overrides.id}`,
    filePath: `/tmp/${overrides.id}.md`,
    ...overrides,
  }
}

function collectScopes(node: UiSchemaNode | undefined): string[] {
  if (!node) return []
  return [
    ...(node.scope ? [node.scope] : []),
    ...((node.elements ?? []).flatMap((child) => collectScopes(child))),
    ...(node.options?.detail ? collectScopes(node.options.detail) : []),
  ]
}

describe('auth visibility manifest', () => {
  it('advertises a standalone auth.visibility provider with no host integrations', () => {
    expect(pluginManifest.id).toBe(AUTH_VISIBILITY_PROVIDER_ID)
    expect(pluginManifest.capabilities['auth.visibility']).toEqual([AUTH_VISIBILITY_PROVIDER_ID])
    expect(pluginManifest).not.toHaveProperty('integrations')
    expect(authVisibilityPlugin.manifest).toEqual({
      id: AUTH_VISIBILITY_PROVIDER_ID,
      provides: ['auth.visibility'],
    })
    expect(authVisibilityPlugins[AUTH_VISIBILITY_PROVIDER_ID]).toBe(authVisibilityPlugin)
  })
})

describe('auth visibility schema metadata', () => {
  it('limits rules to roles plus status/column, labels, priority, and assignee selectors', () => {
    const metadata = optionsSchemas[AUTH_VISIBILITY_PROVIDER_ID]()
    const rules = (metadata.schema.properties as Record<string, SchemaNode>).rules
    const itemProperties = (rules.items?.properties ?? {}) as Record<string, SchemaNode>

    expect(metadata.secrets).toEqual([])
    expect(rules.type).toBe('array')
    expect(rules.default).toEqual([])
    expect(Object.keys(itemProperties).sort()).toEqual([
      'assignees',
      'labels',
      'priorities',
      'roles',
      'statuses',
    ])
    expect(itemProperties.roles.minItems).toBe(1)
    expect(itemProperties.priorities.items?.enum).toEqual(['critical', 'high', 'medium', 'low'])
    expect(itemProperties).not.toHaveProperty('subject')
    expect(itemProperties).not.toHaveProperty('email')
    expect(itemProperties).not.toHaveProperty('token')
    expect(itemProperties).not.toHaveProperty('metadata')
    expect(itemProperties).not.toHaveProperty('boardId')
    expect(itemProperties).not.toHaveProperty('groups')
  })

  it('ships an explicit uiSchema detail editor for nested role rules', () => {
    const metadata = optionsSchemas[AUTH_VISIBILITY_PROVIDER_ID]()
    const scopes = collectScopes(metadata.uiSchema as UiSchemaNode)

    expect(scopes).toEqual(expect.arrayContaining([
      '#/properties/rules',
      '#/properties/roles',
      '#/properties/statuses',
      '#/properties/labels',
      '#/properties/priorities',
      '#/properties/assignees',
    ]))
  })
})

describe('auth visibility evaluation', () => {
  it('unions matching rules while applying AND across fields and OR within each field', async () => {
    const cards = [
      makeCard({ id: 'design-todo', status: 'todo', labels: ['ux'] }),
      makeCard({ id: 'design-done', status: 'done', labels: ['ux'] }),
      makeCard({ id: 'critical-sam', priority: 'critical', assignee: 'sam' }),
      makeCard({ id: 'critical-alex', priority: 'critical', assignee: 'alex' }),
      makeCard({ id: 'research-progress', status: 'in-progress', labels: ['research'] }),
    ]

    const visible = await evaluateAuthVisibility(
      cards,
      {
        identity: { subject: 'alex', roles: ['designer', 'manager'] },
        roles: ['designer', 'manager'],
        auth: { transport: 'test' },
      },
      {
        rules: [
          {
            roles: ['designer'],
            statuses: ['todo', 'in-progress'],
            labels: ['ux', 'research'],
          },
          {
            roles: ['manager'],
            priorities: ['critical'],
            assignees: ['sam'],
          },
        ],
      },
    )

    expect(visible.map((card) => card.id)).toEqual([
      'design-todo',
      'critical-sam',
      'research-progress',
    ])
  })

  it('selects rules from normalized caller roles instead of raw identity.roles', async () => {
    const cards = [
      makeCard({ id: 'reader-card', labels: ['public'] }),
      makeCard({ id: 'manager-card', labels: ['private'] }),
    ]

    const visible = await evaluateAuthVisibility(
      cards,
      {
        identity: { subject: 'sam', roles: ['manager'] },
        roles: ['reader'],
        auth: { transport: 'test' },
      },
      {
        rules: [
          {
            roles: ['reader'],
            labels: ['public'],
          },
          {
            roles: ['manager'],
            labels: ['private'],
          },
        ],
      },
    )

    expect(visible.map((card) => card.id)).toEqual(['reader-card'])
  })

  it('supports assignee matching by explicit name plus @me', async () => {
    const plugin = createAuthVisibilityPlugin({
      rules: [
        {
          roles: ['agent'],
          assignees: ['@me', 'casey'],
        },
      ],
    })

    const visible = await plugin.filterVisibleCards(
      [
        makeCard({ id: 'mine', assignee: 'jules' }),
        makeCard({ id: 'casey', assignee: 'casey' }),
        makeCard({ id: 'other', assignee: 'pat' }),
        makeCard({ id: 'unassigned', assignee: null }),
      ],
      {
        identity: { subject: 'jules', roles: ['agent'] },
        roles: ['agent'],
        auth: { transport: 'test' },
      },
    )

    expect(visible.map((card) => card.id)).toEqual(['mine', 'casey'])
  })

  it('does not grant implicit admin or manager bypasses without an explicit matching rule', async () => {
    const cards = [
      makeCard({ id: 'reader-card', labels: ['public'] }),
      makeCard({ id: 'admin-card', labels: ['admin-only'] }),
    ]

    const managerVisible = await evaluateAuthVisibility(
      cards,
      {
        identity: { subject: 'morgan', roles: ['manager'] },
        roles: ['manager'],
        auth: { transport: 'test' },
      },
      {
        rules: [
          {
            roles: ['reader'],
            labels: ['public'],
          },
        ],
      },
    )

    const adminVisible = await evaluateAuthVisibility(
      cards,
      {
        identity: { subject: 'ada', roles: ['admin'] },
        roles: ['admin'],
        auth: { transport: 'test' },
      },
      {
        rules: [
          {
            roles: ['reader'],
            labels: ['public'],
          },
          {
            roles: ['admin'],
            labels: ['admin-only'],
          },
        ],
      },
    )

    expect(managerVisible).toEqual([])
    expect(adminVisible.map((card) => card.id)).toEqual(['admin-card'])
  })

  it('returns no cards when the caller matches no visibility rule', async () => {
    const visible = await evaluateAuthVisibility(
      [
        makeCard({ id: 'todo', status: 'todo' }),
        makeCard({ id: 'done', status: 'done' }),
      ],
      {
        identity: { subject: 'lee', roles: ['viewer'] },
        roles: ['viewer'],
        auth: { transport: 'test' },
      },
      {
        rules: [
          {
            roles: ['manager'],
            statuses: ['todo'],
          },
        ],
      },
    )

    expect(visible).toEqual([])
  })
})
