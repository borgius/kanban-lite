import { describe, it, expect } from 'vitest'
import { hashPassword, isHashedPassword, type ScryptHasherResult } from './openauth-issuer'
import { ScryptHasher } from '@openauthjs/openauth/provider/password'

describe('hashPassword', () => {
  it('returns a ScryptHasherResult object with expected shape', async () => {
    const result = await hashPassword('secret123')
    expect(result).toMatchObject({
      hash: expect.any(String),
      salt: expect.any(String),
      N: 16384,
      r: 8,
      p: 1,
    })
  })

  it('produces a different hash on every call (unique salts)', async () => {
    const a = await hashPassword('same-password')
    const b = await hashPassword('same-password')
    expect(a.salt).not.toBe(b.salt)
    expect(a.hash).not.toBe(b.hash)
  })

  it('does not store the plain-text password in the hash object', async () => {
    const plain = 'hunter2'
    const result = await hashPassword(plain)
    expect(result.hash).not.toBe(plain)
    expect(result.salt).not.toBe(plain)
    expect(JSON.stringify(result)).not.toContain(plain)
  })
})

describe('isHashedPassword', () => {
  it('returns true for a ScryptHasherResult produced by hashPassword', async () => {
    const hash = await hashPassword('test')
    expect(isHashedPassword(hash)).toBe(true)
  })

  it('returns false for a plain-text string', () => {
    expect(isHashedPassword('plaintext')).toBe(false)
    expect(isHashedPassword('$2b$12$somestring')).toBe(false)
  })

  it('returns false for null, undefined, and empty object', () => {
    expect(isHashedPassword(null)).toBe(false)
    expect(isHashedPassword(undefined)).toBe(false)
    expect(isHashedPassword({})).toBe(false)
  })

  it('returns false for an object missing required fields', () => {
    expect(isHashedPassword({ hash: 'abc', salt: 'xyz' })).toBe(false)
    expect(isHashedPassword({ hash: 'abc', salt: 'xyz', N: 16384, r: 8 })).toBe(false)
  })
})

describe('hashPassword + ScryptHasher.verify (OpenAuth storage compatibility)', () => {
  it('produces a hash that OpenAuth ScryptHasher can verify with correct password', async () => {
    const hash = await hashPassword('correcthorsebatterystaple')
    const hasher = ScryptHasher()
    expect(await hasher.verify('correcthorsebatterystaple', hash as ScryptHasherResult)).toBe(true)
  })

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correcthorsebatterystaple')
    const hasher = ScryptHasher()
    expect(await hasher.verify('wrongpassword', hash as ScryptHasherResult)).toBe(false)
  })
})
