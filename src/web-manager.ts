/** Loopback-only DSH Web API for listing connections and adding permanent config. */

import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from './dsh-web.js'
import type { RpcResult } from './dsh-web.js'
import { resolveConfig } from './index.js'
import { addConnectionConfig, removeConnectionConfig } from './profile-config.js'
import { listConnections } from './registry.js'

const CHANNEL = '/dsh-oauth-mcp'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-oauth-mcp-web-manager'

/** The manager is mounted only by the Web bundle row. */
export const inject = ['connection']

/** Web manager configuration. */
export interface Config {
  /** Absolute permanent profile patch path updated by the Add action. */
  profilePatchPath: string
}

/** Cordis configuration schema. */
export const Config: z<Config> = z.object({
  profilePatchPath: z.string().required(),
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function badRequest(message: string): RpcResult<never> {
  return {
    ok: false,
    error: {
      code: 'bad-request',
      message,
      details: { issues: [{ code: 'custom', path: [], message }] },
    },
  }
}

function internal(error: unknown): RpcResult<never> {
  return {
    ok: false,
    error: {
      code: 'internal',
      message: error instanceof Error ? error.message : String(error),
      details: {},
    },
  }
}

function parseAddRequest(payload: unknown): { serverName: string; url: string } {
  if (!isRecord(payload) || typeof payload.serverName !== 'string' || typeof payload.url !== 'string') {
    throw new TypeError('serverName and url are required strings')
  }
  const resolved = resolveConfig({ serverName: payload.serverName, url: payload.url })
  return { serverName: resolved.serverName, url: resolved.url }
}

function parseRemoveRequest(payload: unknown): string {
  if (!isRecord(payload) || typeof payload.serverName !== 'string' || !payload.serverName) {
    throw new TypeError('serverName is required')
  }
  return payload.serverName
}

/** Register the browser manager's loopback-only RPC channel. */
export function apply(ctx: Context, config: Config): void {
  if (!isAbsolute(config.profilePatchPath)) {
    throw new Error('dsh-oauth-mcp-web-manager: profilePatchPath must be absolute')
  }

  ctx.effect(() => ctx.connection.rpc.handle(CHANNEL, async (endpoint, payload) => {
    if (endpoint === 'connections/list') {
      return { ok: true, value: { connections: listConnections(ctx.root) } }
    }
    if (endpoint === 'connections/remove') {
      let serverName: string
      try {
        serverName = parseRemoveRequest(payload)
      } catch (error) {
        return badRequest(error instanceof Error ? error.message : String(error))
      }
      const connection = listConnections(ctx.root).find(entry => entry.serverName === serverName)
      if (!connection) return badRequest(`MCP connection "${serverName}" does not exist`)
      try {
        await removeConnectionConfig(config.profilePatchPath, connection)
        return { ok: true, value: { removed: serverName } }
      } catch (error) {
        return internal(error)
      }
    }
    if (endpoint !== 'connections/add') return badRequest(`unknown endpoint ${JSON.stringify(endpoint)}`)

    let input: { serverName: string; url: string }
    try {
      input = parseAddRequest(payload)
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : String(error))
    }
    if (listConnections(ctx.root).some(connection => connection.serverName === input.serverName)) {
      return badRequest(`MCP connection "${input.serverName}" already exists`)
    }
    try {
      await addConnectionConfig(config.profilePatchPath, input)
      return { ok: true, value: { added: input.serverName } }
    } catch (error) {
      return internal(error)
    }
  }, { authority: 'loopback' }), 'dsh-oauth-mcp-client.web-rpc')
}
