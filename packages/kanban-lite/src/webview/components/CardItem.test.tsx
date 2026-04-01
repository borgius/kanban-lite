import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Card, CardDisplaySettings } from '../../shared/types'

const DEFAULT_CARD_SETTINGS: CardDisplaySettings = {
  showPriorityBadges: true,
  showAssignee: true,
  showDueDate: true,
  showLabels: true,
  showBuildWithAI: true,
  showFileName: false,
  cardViewMode: 'large',
  markdownEditorMode: false,
  showDeletedColumn: false,
  defaultPriority: 'medium',
  defaultStatus: 'backlog',
  boardZoom: 100,
  cardZoom: 100,
  boardBackgroundMode: 'fancy',
  boardBackgroundPreset: 'aurora',
  panelMode: 'drawer',
  drawerWidth: 50,
}

const storeState = {
  cardSettings: { ...DEFAULT_CARD_SETTINGS },
  labelDefs: {},
  boards: [{ id: 'default', name: 'Default', title: ['customer', 'ticket'] }],
  currentBoard: 'default',
  applyLabelFilter: vi.fn(),
}

vi.mock('../store', () => ({
  useStore: Object.assign((selector?: (state: typeof storeState) => unknown) => selector ? selector(storeState) : storeState, {
    getState: () => storeState,
  }),
}))

vi.mock('marked', () => ({
  marked: { parse: (text: string) => `<p>${text}</p>` },
}))

import { CardItem } from './CardItem'

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    version: 1,
    id: 'test-1',
    status: 'todo',
    priority: 'medium',
    assignee: null,
    dueDate: null,
    created: '2026-03-01T12:00:00.000Z',
    modified: '2026-03-22T10:00:00.000Z',
    completedAt: null,
    labels: [],
    attachments: [],
    comments: [],
    order: 'a0',
    content: '# Test Card',
    ...overrides,
  } as Card
}

describe('CardItem — premium card surface', () => {
  it('renders kb-card base class on outer element', () => {
    const markup = renderToStaticMarkup(
      <CardItem card={makeCard()} onClick={vi.fn()} />,
    )
    expect(markup).toContain('kb-card')
  })

  it('renders kb-card-priority class for each priority level', () => {
    for (const priority of ['critical', 'high', 'medium', 'low'] as const) {
      const markup = renderToStaticMarkup(
        <CardItem card={makeCard({ priority })} onClick={vi.fn()} />,
      )
      expect(markup).toContain(`kb-card-priority--${priority}`)
    }
  })

  it('renders kb-card--selected when isSelected=true', () => {
    const markup = renderToStaticMarkup(
      <CardItem card={makeCard()} onClick={vi.fn()} isSelected />,
    )
    expect(markup).toContain('kb-card--selected')
  })

  it('keeps the priority class when selected so selection can use the priority tint', () => {
    const markup = renderToStaticMarkup(
      <CardItem card={makeCard({ priority: 'critical' })} onClick={vi.fn()} isSelected />,
    )
    expect(markup).toContain('kb-card--selected')
    expect(markup).toContain('kb-card-priority--critical')
  })

  it('does NOT render kb-card--selected when isSelected=false', () => {
    const markup = renderToStaticMarkup(
      <CardItem card={makeCard()} onClick={vi.fn()} isSelected={false} />,
    )
    expect(markup).not.toContain('kb-card--selected')
  })

  it('renders all labels when count <= 4 in normal mode', () => {
    const labels = ['alpha', 'beta', 'gamma', 'delta']
    const markup = renderToStaticMarkup(
      <CardItem card={makeCard({ labels })} onClick={vi.fn()} />,
    )
    expect(markup).toContain('alpha')
    expect(markup).toContain('delta')
    expect(markup).not.toContain('+')
  })

  it('renders labels as clickable filter buttons', () => {
    const markup = renderToStaticMarkup(
      <CardItem card={makeCard({ labels: ['ops'] })} onClick={vi.fn()} />,
    )

    expect(markup).toContain('<button')
    expect(markup).toContain('Filter cards by label ops')
  })

  it('clamps to 4 labels with +N overflow indicator in normal mode', () => {
    const labels = ['a', 'b', 'c', 'd', 'e', 'f']
    const markup = renderToStaticMarkup(
      <CardItem card={makeCard({ labels })} onClick={vi.fn()} />,
    )
    expect(markup).toContain('a')
    expect(markup).toContain('d')
    // 5th and 6th labels should be hidden (clipped at 4)
    expect(markup).toContain('+2')
    expect(markup).not.toContain('>e<')
  })

  it('hides labels in normal mode', () => {
    storeState.cardSettings = { ...DEFAULT_CARD_SETTINGS, cardViewMode: 'normal' }
    const labels = ['a', 'b', 'c', 'd']
    const markup = renderToStaticMarkup(
      <CardItem card={makeCard({ labels })} onClick={vi.fn()} />,
    )
    expect(markup).not.toContain('>a<')
    storeState.cardSettings = { ...DEFAULT_CARD_SETTINGS }
  })

  it('renders card title from markdown content with configured metadata prefixes', () => {
    const markup = renderToStaticMarkup(
      <CardItem card={makeCard({ content: '# My Task Title', metadata: { customer: 'Acme', ticket: 'OPS-42' } })} onClick={vi.fn()} />,
    )
    expect(markup).toContain('Acme OPS-42 My Task Title')
  })

  it('renders description preview when content has body after heading', () => {
    const markup = renderToStaticMarkup(
      <CardItem card={makeCard({ content: '# Title\nSome details here' })} onClick={vi.fn()} />,
    )
    expect(markup).toContain('Some details here')
  })

  it('renders an unread circle badge and unread label when the card is unread', () => {
    const markup = renderToStaticMarkup(
      <CardItem
        card={makeCard({
          comments: [
            { id: 'c1', author: 'bob', created: '2026-03-25T10:00:00.000Z', content: 'hello' },
          ],
          cardState: {
            unread: {
              actorId: 'default-user',
              boardId: 'default',
              cardId: 'test-1',
              latestActivity: { cursor: 'card:default:test-1:2', updatedAt: '2026-03-24T12:00:00.000Z' },
              readThrough: null,
              unread: true,
            },
            open: null,
            status: {
              backend: 'builtin',
              availability: 'available',
              configured: false,
            },
          },
        })}
        onClick={vi.fn()}
      />,
    )

    expect(markup).toContain('kb-card-unread-badge')
    expect(markup).toContain('>unread<')
    expect(markup).not.toContain('kb-card-state-badge--unread')
  })

  it('does not render unread badge or opened badge when the card has been read', () => {
    const markup = renderToStaticMarkup(
      <CardItem
        card={makeCard({
          cardState: {
            unread: {
              actorId: 'default-user',
              boardId: 'default',
              cardId: 'test-1',
              latestActivity: { cursor: 'card:default:test-1:2', updatedAt: '2026-03-24T12:00:00.000Z' },
              readThrough: { cursor: 'card:default:test-1:2', updatedAt: '2026-03-24T12:00:00.000Z' },
              unread: false,
            },
            open: {
              actorId: 'default-user',
              boardId: 'default',
              cardId: 'test-1',
              domain: 'open',
              value: {
                openedAt: '2026-03-24T12:00:00.000Z',
                readThrough: { cursor: 'card:default:test-1:2', updatedAt: '2026-03-24T12:00:00.000Z' },
              },
              updatedAt: '2026-03-24T12:00:00.000Z',
            },
            status: {
              backend: 'builtin',
              availability: 'available',
              configured: false,
            },
          },
        })}
        onClick={vi.fn()}
      />,
    )

    expect(markup).not.toContain('kb-card-unread-badge')
    expect(markup).not.toContain('kb-card-state-badge--opened')
    expect(markup).not.toContain('>unread<')
  })

  it('renders a sign-in badge when card-state identity resolution is unavailable', () => {
    const markup = renderToStaticMarkup(
      <CardItem
        card={makeCard({
          cardState: {
            unread: null,
            open: null,
            status: {
              backend: 'builtin',
              availability: 'identity-unavailable',
              configured: true,
              errorCode: 'ERR_CARD_STATE_IDENTITY_UNAVAILABLE',
            },
            error: {
              code: 'ERR_CARD_STATE_IDENTITY_UNAVAILABLE',
              availability: 'identity-unavailable',
              message: 'Sign in required for card state',
            },
          },
        })}
        onClick={vi.fn()}
      />,
    )

    expect(markup).toContain('kb-card-state-badge--identity')
    expect(markup).toContain('Sign in')
  })

  it('preserves selected-state when isSelected prop changes', () => {
    const selected = renderToStaticMarkup(
      <CardItem card={makeCard()} onClick={vi.fn()} isSelected />,
    )
    const plain = renderToStaticMarkup(
      <CardItem card={makeCard()} onClick={vi.fn()} isSelected={false} />,
    )
    expect(selected).toContain('kb-card--selected')
    expect(plain).not.toContain('kb-card--selected')
  })
})
