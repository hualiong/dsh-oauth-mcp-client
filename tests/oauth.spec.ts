import { Context } from '@deepseek-ai/cordis'
import type { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { describe, expect, it, vi } from 'vitest'
import { resolveConfig } from '../src/index.js'
import { createOAuthRuntime } from '../src/oauth.js'

const config = resolveConfig({
  serverName: 'test',
  url: 'https://mcp.example.com/mcp',
  authorizationTimeoutMs: 2_000,
})

describe('OAuth loopback flow', () => {
  it('rejects a forged state and exchanges a valid callback code', async () => {
    const ctx = new Context()

    const rejected = await createOAuthRuntime(ctx, config, async () => {})
    try {
      const state = String(await rejected.provider.state?.())
      await rejected.provider.redirectToAuthorization(new URL(`https://auth.example.com/?state=${state}`))
      const callback = new URL(rejected.provider.redirectUrl!)
      callback.search = new URLSearchParams({ code: 'forged', state: 'wrong' }).toString()
      expect((await fetch(callback)).status).toBe(400)
      await expect(rejected.waitForAuthorization()).rejects.toThrow('state does not match')
    } finally {
      await rejected.dispose()
    }

    const opened: URL[] = []
    const accepted = await createOAuthRuntime(ctx, config, async url => { opened.push(url) })
    const finishAuth = vi.fn(async (_code: string) => {})
    accepted.bindTransport({ finishAuth } as unknown as StreamableHTTPClientTransport)
    try {
      const state = String(await accepted.provider.state?.())
      const authorizationUrl = new URL(`https://auth.example.com/?state=${state}`)
      await accepted.provider.redirectToAuthorization(authorizationUrl)
      expect(opened).toEqual([authorizationUrl])

      const callback = new URL(accepted.provider.redirectUrl!)
      callback.search = new URLSearchParams({ code: 'valid-code', state }).toString()
      const wait = accepted.waitForAuthorization()
      expect((await fetch(callback)).status).toBe(200)
      await wait
      expect(finishAuth).toHaveBeenCalledWith('valid-code')
    } finally {
      await accepted.dispose()
    }
  })
})
