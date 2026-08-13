/** Minimal DSH Web RPC seam consumed by the optional manager plugin. */

import '@deepseek-ai/cordis'

export type RpcResult<T> =
  | { ok: true; value: T }
  | {
    ok: false
    error: {
      code: 'bad-request' | 'internal'
      message: string
      details: { issues: Array<{ code: 'custom'; path: string[]; message: string }> } | Record<string, never>
    }
  }

export interface HostConnectionHandle {
  rpc: {
    handle(
      channel: string,
      handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<RpcResult<unknown>>,
      options: { authority: 'loopback' | 'trusted-host' },
    ): () => Promise<void>
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    connection: HostConnectionHandle
  }
}
