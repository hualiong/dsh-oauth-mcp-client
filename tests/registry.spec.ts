import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { mcpGuidance, type ResolvedConfig } from '../src/index.js'
import { listConnections, registerConnection } from '../src/registry.js'

const config: ResolvedConfig = {
  serverName: 'example',
  url: 'https://mcp.example.com/mcp',
  credentialRef: 'EXAMPLE_MCP_OAUTH',
  headers: {},
  callbackPort: 0,
  authorizationTimeoutMs: 300_000,
  toolCallTimeoutMs: 60_000,
  failOnStartupError: true,
}

describe('Web connection projection', () => {
  it('publishes lifecycle and capability changes as detached snapshots', () => {
    const root = {} as Context
    const reporter = registerConnection(root, config, 'example-mcp-oauth')
    reporter.setStatus('connected')
    reporter.setCapabilities([{ name: 'mcp__example__search', description: 'Search records' }])

    const snapshot = listConnections(root)
    expect(snapshot).toEqual([{
      entryId: 'example-mcp-oauth',
      serverName: 'example',
      url: 'https://mcp.example.com/mcp',
      status: 'connected',
      capabilities: [{ name: 'mcp__example__search', description: 'Search records' }],
    }])

    snapshot[0]!.capabilities.length = 0
    expect(listConnections(root)[0]!.capabilities).toHaveLength(1)
    reporter.dispose()
    expect(listConnections(root)).toEqual([])
  })

  it('namespaces model guidance by server without assuming any tool', () => {
    const guidance = mcpGuidance('example')
    expect(guidance).toContain('mcp__example__')
    expect(guidance).toContain('best match the request')
    expect(guidance).toContain('does not expose it')
  })
})
