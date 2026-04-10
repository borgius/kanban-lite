import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { BoardMetaFieldDef } from '../../shared/config'
import { MetaBuilderSection } from './MetaBuilderSection'

describe('MetaBuilderSection', () => {
  it('renders overview stats and polished field summaries for existing metadata', () => {
    const boardMeta: Record<string, BoardMetaFieldDef> = {
      ticketId: {
        default: 'INC-42',
        description: 'Customer-facing ticket reference.',
        highlighted: true,
      },
      location: {
        description: 'Site or office where the work is happening.',
      },
      company: {},
    }

    const markup = renderToStaticMarkup(
      <MetaBuilderSection boardMeta={boardMeta} />,
    )

    expect(markup).toContain('Shape richer card context without cluttering the board.')
    expect(markup).toContain('Shown on cards')
    expect(markup).toContain('Documented')
    expect(markup).toContain('Default · INC-42')
    expect(markup).toContain('Preview behavior')
    expect(markup).toContain('ticketId')
    expect(markup).toContain('location')
  })

  it('renders an empty-state call to action when no metadata fields exist', () => {
    const markup = renderToStaticMarkup(
      <MetaBuilderSection boardMeta={{}} />,
    )

    expect(markup).toContain('No metadata fields yet')
    expect(markup).toContain('Create first field')
    expect(markup).toContain('customer names, or locations')
  })
})
