/** DSH Web settings tab for OAuth MCP connections. */

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'

type ConnectionStatus = 'connecting' | 'authorizing' | 'connected' | 'reconnecting' | 'error'

interface McpCapability {
  name: string
  description: string
}

interface McpConnectionView {
  serverName: string
  url: string
  status: ConnectionStatus
  capabilities: McpCapability[]
  error?: string
}

interface ConnectionSnapshot {
  connections: McpConnectionView[]
}

interface RpcResult {
  ok: boolean
  value?: unknown
  error?: { message?: unknown }
}

interface ClientContext extends Context {
  locale: {
    register(namespace: string, dictionaries: { zh: Record<string, string>; en: Record<string, string> }): () => void
    bind(namespace: string): (key: LocaleKey) => string
  }
  slots: {
    inject(name: string, setup: () => unknown): void
    register(options: Record<string, unknown>, component: (props: McpConnectionsProps) => ReactNode): () => void
  }
  connection: {
    rpc: {
      call(channel: string, endpoint: string, payload: unknown): Promise<RpcResult>
    }
  }
}

const CHANNEL = '/dsh-oauth-mcp'
const NS = 'settings.oauthMcp'

const zh = {
  tab: 'MCP 连接',
  title: 'OAuth MCP 连接',
  intro: '添加后会自动打开浏览器完成 OAuth 登录；登录成功后，连接提供的工具能力会显示在这里。',
  addTitle: '添加连接',
  serverName: '连接名称',
  serverNameHint: '用于工具名称，例如 springbrand。',
  url: 'MCP 地址',
  add: '添加并登录',
  adding: '正在添加…',
  added: '配置已写入。请在自动打开的浏览器中完成登录。',
  remove: '移除',
  removing: '正在移除…',
  removeConfirm: '确定移除 {serverName}？该连接及其工具将从 DSH 中卸载。',
  removed: '连接已从永久配置中移除。',
  loading: '正在读取连接…',
  empty: '还没有 OAuth MCP 连接。',
  retry: '重试',
  capabilities: '插件能力',
  noCapabilities: '连接后将在这里显示 MCP 工具。',
  connecting: '连接中',
  authorizing: '等待登录',
  connected: '已连接',
  reconnecting: '重新连接中',
  error: '连接失败',
} as const

type LocaleKey = keyof typeof zh

const en: Record<LocaleKey, string> = {
  tab: 'MCP Connections',
  title: 'OAuth MCP connections',
  intro: 'Adding a connection opens the browser for OAuth. After login, the tools exposed by that connection appear here.',
  addTitle: 'Add connection',
  serverName: 'Connection name',
  serverNameHint: 'Used in tool names, for example springbrand.',
  url: 'MCP endpoint',
  add: 'Add and sign in',
  adding: 'Adding…',
  added: 'The permanent configuration was added. Complete sign-in in the browser that opened.',
  remove: 'Remove',
  removing: 'Removing…',
  removeConfirm: 'Remove {serverName}? The connection and its tools will be unloaded from DSH.',
  removed: 'The connection was removed from the permanent configuration.',
  loading: 'Loading connections…',
  empty: 'No OAuth MCP connections yet.',
  retry: 'Retry',
  capabilities: 'Plugin capabilities',
  noCapabilities: 'MCP tools will appear here after the connection succeeds.',
  connecting: 'Connecting',
  authorizing: 'Waiting for sign-in',
  connected: 'Connected',
  reconnecting: 'Reconnecting',
  error: 'Connection failed',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseSnapshot(value: unknown): ConnectionSnapshot {
  if (!isRecord(value) || !Array.isArray(value.connections)) throw new Error('Host returned an invalid connection list')
  const connections = value.connections.map((entry): McpConnectionView => {
    if (!isRecord(entry)
      || typeof entry.serverName !== 'string'
      || typeof entry.url !== 'string'
      || !['connecting', 'authorizing', 'connected', 'reconnecting', 'error'].includes(String(entry.status))
      || !Array.isArray(entry.capabilities)) {
      throw new Error('Host returned an invalid MCP connection')
    }
    const capabilities = entry.capabilities.map((capability): McpCapability => {
      if (!isRecord(capability) || typeof capability.name !== 'string' || typeof capability.description !== 'string') {
        throw new Error('Host returned an invalid MCP capability')
      }
      return { name: capability.name, description: capability.description }
    })
    return {
      serverName: entry.serverName,
      url: entry.url,
      status: entry.status as ConnectionStatus,
      capabilities,
      ...(typeof entry.error === 'string' ? { error: entry.error } : {}),
    }
  })
  return { connections }
}

async function unwrap(call: Promise<RpcResult>): Promise<unknown> {
  const result = await call
  if (result.ok) return result.value
  throw new Error(typeof result.error?.message === 'string' ? result.error.message : 'DSH Web request failed')
}

interface McpConnectionsInjected {
  list(): Promise<ConnectionSnapshot>
  add(input: { serverName: string; url: string }): Promise<void>
  remove(serverName: string): Promise<void>
}

interface McpConnectionsProps extends McpConnectionsInjected {
  t(key: LocaleKey): string
}

function McpConnectionsTab({ list, add, remove, t }: McpConnectionsProps): ReactNode {
  const [snapshot, setSnapshot] = useState<ConnectionSnapshot>()
  const [loadError, setLoadError] = useState('')
  const [serverName, setServerName] = useState('')
  const [url, setUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await list())
      setLoadError('')
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    }
  }, [list])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 2_000)
    return () => { window.clearInterval(timer) }
  }, [refresh])

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setSaving(true)
    setNotice('')
    try {
      await add({ serverName, url })
      setServerName('')
      setUrl('')
      setNotice(t('added'))
      await refresh()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const removeConnection = async (name: string): Promise<void> => {
    if (!window.confirm(t('removeConfirm').replace('{serverName}', name))) return
    setRemoving(name)
    setNotice('')
    try {
      await remove(name)
      setNotice(t('removed'))
      await refresh()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setRemoving('')
    }
  }

  return (
    <section>
      <h3>{t('title')}</h3>
      <p>{t('intro')}</p>
      <form onSubmit={(event) => { void submit(event) }}>
        <fieldset disabled={saving}>
          <legend>{t('addTitle')}</legend>
          <p>
            <label>
              {t('serverName')}
              <br />
              <input
                required
                pattern="[A-Za-z0-9_-]{1,32}"
                value={serverName}
                onChange={(event) => { setServerName(event.currentTarget.value) }}
              />
            </label>
            <br />
            <small>{t('serverNameHint')}</small>
          </p>
          <p>
            <label>
              {t('url')}
              <br />
              <input
                required
                type="url"
                placeholder="https://mcp.example.com/mcp"
                value={url}
                onChange={(event) => { setUrl(event.currentTarget.value) }}
              />
            </label>
          </p>
          <button type="submit">{saving ? t('adding') : t('add')}</button>
        </fieldset>
      </form>
      {notice ? <p aria-live="polite">{notice}</p> : null}

      {!snapshot && !loadError ? <p>{t('loading')}</p> : null}
      {loadError ? <p role="alert">{loadError} <button type="button" onClick={() => { void refresh() }}>{t('retry')}</button></p> : null}
      {snapshot?.connections.length === 0 ? <p>{t('empty')}</p> : null}
      {snapshot?.connections.map(connection => (
        <article key={connection.serverName}>
          <h4>{connection.serverName} — {t(connection.status)}</h4>
          <p><code>{connection.url}</code></p>
          <button type="button" disabled={Boolean(removing)} onClick={() => { void removeConnection(connection.serverName) }}>
            {removing === connection.serverName ? t('removing') : t('remove')}
          </button>
          {connection.error ? <p role="alert">{connection.error}</p> : null}
          <details open={connection.capabilities.length > 0}>
            <summary>{t('capabilities')} ({connection.capabilities.length})</summary>
            {connection.capabilities.length === 0 ? <p>{t('noCapabilities')}</p> : (
              <ul>
                {connection.capabilities.map(capability => (
                  <li key={capability.name}>
                    <code>{capability.name}</code>
                    {capability.description ? <p>{capability.description}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </details>
        </article>
      ))}
    </section>
  )
}

/** Required browser services. */
export const inject = ['slots', 'locale', 'connection']

/** Register the OAuth MCP tab in DSH Web's Plugins settings section. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-oauth-mcp-client: Web locale')
  const t = ctx.locale.bind(NS)
  const injected: McpConnectionsInjected = {
    async list() {
      return parseSnapshot(await unwrap(ctx.connection.rpc.call(CHANNEL, 'connections/list', {})))
    },
    async add(input) {
      await unwrap(ctx.connection.rpc.call(CHANNEL, 'connections/add', input))
    },
    async remove(serverName) {
      await unwrap(ctx.connection.rpc.call(CHANNEL, 'connections/remove', { serverName }))
    },
  }

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'oauth-mcp',
    order: 20,
    label: () => t('tab'),
    locale: NS,
    inject: () => injected,
  }, McpConnectionsTab))
}
