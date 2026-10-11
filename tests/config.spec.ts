import { describe, expect, it } from 'vitest'
import { defaultCredentialRef, mcpGuidance, resolveConfig } from '../src/index.js'

describe('configuration defaults', () => {
  const base = { serverName: 'example', url: 'https://mcp.example.com/mcp' }

  it('derives the credential ref from the loader entry id', () => {
    expect(defaultCredentialRef('cloudflare-mcp')).toBe('CLOUDFLARE_MCP')
    expect(defaultCredentialRef('123 mcp')).toBe('MCP_123_MCP')
    expect(resolveConfig({ ...base, credentialRef: 'CLOUDFLARE_MCP_OAUTH' }).credentialRef)
      .toBe('CLOUDFLARE_MCP_OAUTH')
  })

  it('defaults the callback port to 45179 but still honours an explicit 0', () => {
    expect(resolveConfig(base).callbackPort).toBe(45179)
    expect(resolveConfig({ ...base, callbackPort: 0 }).callbackPort).toBe(0)
  })
})

describe('model guidance', () => {
  it('namespaces guidance by server without assuming any tool', () => {
    const guidance = mcpGuidance('example')
    expect(guidance).toContain('mcp__example__')
    expect(guidance).toContain('best match the request')
    expect(guidance).toContain('does not expose it')
  })
})
