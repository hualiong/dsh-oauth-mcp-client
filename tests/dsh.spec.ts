import { describe, expect, it } from 'vitest'
import { assertSupportedJsonSchema, credentialRef } from '../src/dsh.js'

describe('public DSH seam', () => {
  it('validates credential references and the supported JSON Schema subset', () => {
    expect(credentialRef('EXAMPLE_MCP_OAUTH')).toBe('EXAMPLE_MCP_OAUTH')
    expect(() => credentialRef('invalid-ref')).toThrow('credential ref')
    expect(() => assertSupportedJsonSchema({ type: 'object', properties: { name: { type: 'string' } } })).not.toThrow()
    expect(() => assertSupportedJsonSchema({ type: ['string', 'null'] })).toThrow('unsupported JSON schema')
  })
})
