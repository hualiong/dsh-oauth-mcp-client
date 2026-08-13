import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { mcpGuidance, type ResolvedConfig } from '../src/index.js'
import { listConnections, registerConnection } from '../src/registry.js'

const config: ResolvedConfig = {
  serverName: 'springbrand',
  url: 'https://connector.springbrand.ai/mcp',
  credentialRef: 'SPRINGBRAND_MCP_OAUTH_PRODUCTION',
  headers: {},
  callbackPort: 0,
  authorizationTimeoutMs: 300_000,
  toolCallTimeoutMs: 60_000,
  failOnStartupError: true,
}

describe('Web connection projection', () => {
  it('publishes lifecycle and capability changes as detached snapshots', () => {
    const root = {} as Context
    const reporter = registerConnection(root, config)
    reporter.setStatus('connected')
    reporter.setCapabilities([{ name: 'mcp__springbrand__search_capabilities', description: 'Search capabilities' }])

    const snapshot = listConnections(root)
    expect(snapshot).toEqual([{
      serverName: 'springbrand',
      url: 'https://connector.springbrand.ai/mcp',
      status: 'connected',
      capabilities: [{ name: 'mcp__springbrand__search_capabilities', description: 'Search capabilities' }],
    }])

    snapshot[0]!.capabilities.length = 0
    expect(listConnections(root)[0]!.capabilities).toHaveLength(1)
    reporter.dispose()
    expect(listConnections(root)).toEqual([])
  })

  it('guides capability search and exact-name execution', () => {
    const guidance = mcpGuidance('springbrand')
    expect(guidance).toContain('mcp__springbrand__search_capabilities')
    expect(guidance).toContain('complete capability name')
    expect(guidance).toContain('not a shorter action_id')
  })
})
