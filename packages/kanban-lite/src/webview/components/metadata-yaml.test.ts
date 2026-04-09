import { describe, expect, it } from 'vitest'
import { metadataToYaml, yamlToMetadata } from './metadata-yaml'

describe('metadataToYaml', () => {
  it('serializes a flat object', () => {
    const result = metadataToYaml({ key: 'value', count: 42 })
    expect(result).toContain('key: value')
    expect(result).toContain('count: 42')
  })

  it('serializes a nested object', () => {
    const result = metadataToYaml({ outer: { inner: 'deep' } })
    expect(result).toContain('outer:')
    expect(result).toContain('inner: deep')
  })

  it('returns empty string for undefined', () => {
    expect(metadataToYaml(undefined)).toBe('')
  })

  it('returns empty string for empty object', () => {
    expect(metadataToYaml({})).toBe('')
  })
})

describe('yamlToMetadata', () => {
  it('parses a flat mapping', () => {
    const result = yamlToMetadata('key: value\ncount: 42')
    expect(result).toEqual({ ok: true, value: { key: 'value', count: 42 } })
  })

  it('parses a nested mapping', () => {
    const result = yamlToMetadata('outer:\n  inner: deep')
    expect(result).toEqual({ ok: true, value: { outer: { inner: 'deep' } } })
  })

  it('returns empty value for empty string', () => {
    expect(yamlToMetadata('')).toEqual({ ok: true, value: {} })
  })

  it('returns empty value for whitespace-only string', () => {
    expect(yamlToMetadata('   \n  ')).toEqual({ ok: true, value: {} })
  })

  it('returns empty value for null YAML', () => {
    expect(yamlToMetadata('null')).toEqual({ ok: true, value: {} })
  })

  it('rejects a YAML list', () => {
    const result = yamlToMetadata('- item1\n- item2')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('mapping')
    }
  })

  it('rejects a scalar string value', () => {
    const result = yamlToMetadata('just a string')
    expect(result.ok).toBe(false)
  })

  it('rejects invalid YAML', () => {
    const result = yamlToMetadata(': broken: yaml:')
    expect(result.ok).toBe(false)
  })

  it('round-trips a nested object', () => {
    const original = { tags: ['a', 'b'], nested: { x: 1 } }
    const yaml = metadataToYaml(original)
    const parsed = yamlToMetadata(yaml)
    expect(parsed).toEqual({ ok: true, value: original })
  })
})
