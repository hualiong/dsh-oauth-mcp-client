/**
 * OAuth-enabled Streamable HTTP MCP client for DeepSeek Harness.
 *
 * The plugin preserves the tool discovery, naming, execution, and reconnect
 * behavior of `@deepseek-ai/dsh-mcp-client`, while adding an interactive
 * OAuth authorization-code flow backed by the Harness credential service.
 *
 * @module @hualiong/dsh-oauth-mcp-client
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from './dsh.js'
import type {} from './dsh.js'
import { createOAuthRuntime } from './oauth.js'
import { RECONNECT_DEFAULTS, resolveReconnectPolicy, startConnection } from './connection.js'
import type { ReconnectConfig } from './connection.js'

export type { McpResult } from './tools.js'
export type { ReconnectConfig, ResolvedReconnectPolicy } from './connection.js'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-oauth-mcp-client'

/** Services required by the OAuth client. */
export const inject = ['tools', 'credentials']

const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000
const DEFAULT_AUTHORIZATION_TIMEOUT_MS = 5 * 60_000
const DEFAULT_CALLBACK_PORT = 45179
const MAX_TIMER_DELAY_MS = 2_147_483_647
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/** User configuration for one OAuth-protected Streamable HTTP MCP server. */
export interface Config {
  /** Stable namespace used in public tool names (`mcp__<serverName>__<tool>`). */
  serverName: string
  /** HTTPS MCP endpoint; loopback HTTP is accepted for local development. */
  url: string
  /** Harness credential reference holding the serialized OAuth state; derives from the loader entry id when omitted. */
  credentialRef?: string
  /** Optional fallback OAuth scope when server metadata does not declare one. */
  scope?: string
  /** Non-authorization headers attached to MCP and OAuth discovery requests. */
  headers?: Record<string, string>
  /** Loopback callback port; `0` asks the OS for an available port. Defaults to 45179. */
  callbackPort?: number
  /** Maximum wait for the browser authorization callback. */
  authorizationTimeoutMs?: number
  /** Per-tool MCP request timeout. */
  toolCallTimeoutMs?: number
  /**
   * Fail plugin activation when the first connect/auth/sync attempt fails.
   *
   * Defaults to `false` on purpose: a DSH loader entry whose `apply()` rejects
   * can prevent the whole application from starting, and "server unreachable"
   * or "authorization not finished yet" are ordinary runtime conditions. With
   * `false` those are logged and retried by the reconnect policy instead of
   * taking DSH down. Set `true` only when a wrong configuration must be caught
   * immediately and you accept that a failed startup blocks DSH.
   */
  failOnStartupError?: boolean
  /** Automatic reconnect policy after a lost MCP connection. */
  reconnect?: ReconnectConfig
}

/** Configuration after validation and deployment defaults are resolved once. */
export interface ResolvedConfig {
  serverName: string
  url: string
  /** Always resolved: explicit `config.credentialRef`, else derived from the loader entry id. */
  credentialRef: string
  scope?: string
  headers: Record<string, string>
  callbackPort: number
  authorizationTimeoutMs: number
  toolCallTimeoutMs: number
  failOnStartupError: boolean
}

const Reconnect: z<ReconnectConfig> = z.object({
  enabled: z.boolean().default(RECONNECT_DEFAULTS.enabled),
  initialDelayMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(RECONNECT_DEFAULTS.initialDelayMs),
  maxDelayMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(RECONNECT_DEFAULTS.maxDelayMs),
  maxAttempts: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(RECONNECT_DEFAULTS.maxAttempts),
})

/** Cordis configuration schema. */
export const Config: z<Config> = z.object({
  serverName: z.string().required().pattern(SERVER_NAME_PATTERN),
  url: z.string().required(),
  credentialRef: z.string(),
  scope: z.string(),
  headers: z.dict(String).default({}),
  callbackPort: z.number().step(1).min(0).max(65_535).default(DEFAULT_CALLBACK_PORT),
  authorizationTimeoutMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_AUTHORIZATION_TIMEOUT_MS),
  toolCallTimeoutMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_TOOL_CALL_TIMEOUT_MS),
  failOnStartupError: z.boolean().default(false),
  reconnect: Reconnect,
})

const activeServerNames = new WeakMap<Context, Set<string>>()

/** Derive a valid credential reference from a loader entry id when the deployment does not name one. */
export function defaultCredentialRef(entryId: string): string {
  const normalized = entryId.toUpperCase().replaceAll(/[^A-Z0-9]/g, '_')
  return /^[A-Z_]/.test(normalized) ? normalized : `MCP_${normalized}`
}

/** Model guidance for discovering and executing tools from one MCP server. */
export function mcpGuidance(serverName: string): string {
  const prefix = `mcp__${serverName}__`
  return `Tools whose names begin with ${prefix} are provided by the "${serverName}" MCP server. `
    + 'Pick the tool whose name and description best match the request, and pass arguments exactly as that tool schema requires. '
    + `If no ${prefix} tool covers the request, say that this MCP server does not expose it rather than inventing a tool name.`
}

/** Resolve defaults and reject unsafe or internally conflicting configuration. */
export function resolveConfig(config: Config): ResolvedConfig {
  if (!SERVER_NAME_PATTERN.test(config.serverName)) {
    throw new Error(`dsh-oauth-mcp-client: serverName must match ${String(SERVER_NAME_PATTERN)}`)
  }

  const url = new URL(config.url)
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('dsh-oauth-mcp-client: url must use HTTPS, except for loopback development endpoints')
  }
  if (url.username || url.password) throw new Error('dsh-oauth-mcp-client: url must not contain credentials')

  const headers = { ...(config.headers ?? {}) }
  if (Object.keys(headers).some(key => key.toLowerCase() === 'authorization')) {
    throw new Error('dsh-oauth-mcp-client: headers.Authorization is owned by OAuth and must not be configured')
  }

  const callbackPort = config.callbackPort ?? DEFAULT_CALLBACK_PORT
  if (!Number.isInteger(callbackPort) || callbackPort < 0 || callbackPort > 65_535) {
    throw new Error('dsh-oauth-mcp-client: callbackPort must be an integer from 0 through 65535')
  }
  const authorizationTimeoutMs = config.authorizationTimeoutMs ?? DEFAULT_AUTHORIZATION_TIMEOUT_MS
  const toolCallTimeoutMs = config.toolCallTimeoutMs ?? DEFAULT_TOOL_CALL_TIMEOUT_MS
  for (const [key, value] of Object.entries({ authorizationTimeoutMs, toolCallTimeoutMs })) {
    if (!Number.isFinite(value) || value <= 0 || value > MAX_TIMER_DELAY_MS) {
      throw new Error(`dsh-oauth-mcp-client: ${key} must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
    }
  }

  // apply() passes the entry-derived ref; this fallback only serves direct callers (tests).
  const ref = config.credentialRef ?? defaultCredentialRef(config.serverName)
  credentialRef(ref)
  const scope = config.scope?.trim()
  if (config.scope !== undefined && !scope) throw new Error('dsh-oauth-mcp-client: scope must not be empty')

  return Object.freeze({
    serverName: config.serverName,
    url: url.toString(),
    credentialRef: ref,
    ...(scope === undefined ? {} : { scope }),
    headers,
    callbackPort,
    authorizationTimeoutMs,
    toolCallTimeoutMs,
    failOnStartupError: config.failOnStartupError ?? false,
  })
}

/** Connect, authorize when needed, and publish the remote MCP tools. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const entryId = (ctx.fiber as typeof ctx.fiber & { entry?: { options?: { id?: unknown } } }).entry?.options?.id
  if (typeof entryId !== 'string' || !entryId) throw new Error('dsh-oauth-mcp-client: loader entry id is required')
  const resolved = resolveConfig({
    ...config,
    credentialRef: config.credentialRef ?? defaultCredentialRef(entryId),
  })
  const reconnect = resolveReconnectPolicy(config.reconnect, `dsh-oauth-mcp-client(${resolved.serverName}): reconnect`)

  ctx.effect(() => {
    let names = activeServerNames.get(ctx.root)
    if (!names) {
      names = new Set()
      activeServerNames.set(ctx.root, names)
    }
    if (names.has(resolved.serverName)) {
      throw new Error(
        `dsh-oauth-mcp-client: serverName "${resolved.serverName}" is already in use by another instance`,
      )
    }
    names.add(resolved.serverName)
    return () => void names.delete(resolved.serverName)
  }, 'dsh-oauth-mcp-client.serverName')

  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.systemPrompt.section({
      name: `tool:mcp:${resolved.serverName}`,
      order: 118,
      text: mcpGuidance(resolved.serverName),
    })
  })

  const oauth = await createOAuthRuntime(ctx, resolved)
  ctx.effect(() => () => oauth.dispose(), 'dsh-oauth-mcp-client.oauth')

  const connection = startConnection(ctx, resolved, reconnect, oauth)
  ctx.effect(() => () => connection.dispose(), 'dsh-oauth-mcp-client.connection')

  const outcome = await connection.ready
  if (outcome.error !== undefined && resolved.failOnStartupError) {
    throw new Error(
      `dsh-oauth-mcp-client(${resolved.serverName}): initial authorization, connection, or tool synchronization failed`,
      { cause: outcome.error },
    )
  }
}
