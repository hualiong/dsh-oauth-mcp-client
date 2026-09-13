# dsh-oauth-mcp-client

English | [简体中文](./README.zh-CN.md)

An OAuth 2.1 Streamable HTTP MCP client plugin for
[DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness).

It extends the native `dsh-mcp-client` connection flow with PKCE, dynamic
client registration, browser authorization, a loopback callback, persistent
token storage, reconnect handling, and MCP tool registration.

This plugin is **host-side only and configuration-driven**. It ships no UI and
activates nothing on install: every MCP connection is declared by you in the
profile patch layer. See [Add a connection](#add-a-connection).

## Features

- OAuth 2.1 authorization code flow with PKCE
- Dynamic OAuth client registration and authorization-server discovery
- Browser login with a loopback callback
- Token and client metadata storage through the DSH credential service
- Streamable HTTP transport with automatic reconnects
- MCP tool discovery, registration, and execution
- No UI, no bundled endpoint, no auto-connect: pure `cordis.patch.yml` config

## Requirements

- Node.js 22.19 or later
- A browser for the first OAuth login
- An MCP server that speaks Streamable HTTP and supports OAuth 2.1 with dynamic
  client registration (or a pre-registered client whose redirect URI you pin)

## Install

Build the plugin from this checkout:

```sh
git clone https://github.com/hualiong/dsh-oauth-mcp-client.git
cd dsh-oauth-mcp-client
corepack enable
pnpm install
pnpm build
```

Install it into a DSH profile and restart DSH:

```sh
npx --yes @deepseek-ai/dsh@latest plugin --profile desktop add "$PWD"
```

Use the profile your DSH Desktop actually loads. On this machine that is
`desktop`, which maps to `~/.dsh/profiles/desktop/`. Running `dsh web` is not
required for DSH Desktop — just restart the application.

## Add a connection

Append an entry to the profile patch layer at
`~/.dsh/profiles/<profile>/cordis.patch.yml`:

```yaml
- insert:
    - id: oauth-mcp-example
      name: '@dsh-external/dsh-oauth-mcp-client'
      config:
        serverName: example
        url: https://mcp.example.com/mcp
        credentialRef: EXAMPLE_MCP_OAUTH
        failOnStartupError: false
```

Then restart DSH Desktop. On the first start the connection is attempted, the
server answers `401`, and the plugin opens your default browser for
authorization. After you approve, tokens are stored in the DSH credential
service and later starts reconnect silently — the browser is only used again if
the refresh token expires or is revoked.

Rules:

- `serverName` must be unique within the DSH process and match
  `[A-Za-z0-9_-]{1,32}`. It becomes part of the tool names, e.g.
  `mcp__example__search`.
- `url` must be HTTPS. Plain HTTP is accepted only for `127.0.0.1`,
  `localhost`, or `[::1]`.
- Do not set an `Authorization` header; the OAuth client owns it. If a server
  only accepts a static personal access token, it does not need this plugin —
  use the native `@deepseek-ai/dsh-mcp-client` with `headers` instead.

## Configuration

| Field | Description | Default |
| --- | --- | --- |
| `serverName` | Namespace used in registered DSH tool names | required |
| `url` | HTTPS Streamable HTTP MCP endpoint | required |
| `credentialRef` | DSH credential reference holding OAuth state | `DSH_MCP_OAUTH_<SERVERNAME>` |
| `scope` | Optional OAuth scope | Discovered from the server |
| `headers` | Extra non-authorization headers for MCP and discovery requests | `{}` |
| `callbackPort` | Loopback callback port; `0` selects a free port | `0` |
| `authorizationTimeoutMs` | Browser authorization timeout | `300000` |
| `toolCallTimeoutMs` | Timeout for one MCP tool call | `60000` |
| `failOnStartupError` | Fail activation when the first attempt fails | `false` |
| `reconnect` | Exponential reconnect policy | Enabled |

### `callbackPort` and dynamic client registration

The plugin stores the OAuth client registration keyed by its redirect URI. With
the default `callbackPort: 0` the OS picks a new port each start, so the stored
registration is treated as stale and dynamic client registration runs again.
That is harmless for servers with open registration, but it costs one extra
round trip. If your authorization server pins redirect URIs, or does not support
dynamic client registration at all, set an explicit `callbackPort` so the
redirect URI stays stable across restarts.

If a pinned port is already occupied, the plugin logs a warning and falls back
to an ephemeral port rather than failing — see below.

## Startup safety

A DSH loader entry whose `apply()` rejects can prevent the whole application
from starting. This plugin is built so that ordinary runtime conditions never
do that:

- `failOnStartupError` defaults to **`false`**. An unreachable server, a slow
  login, or an unfinished authorization is logged and retried by the reconnect
  policy instead of failing activation.
- A pinned `callbackPort` that is already in use falls back to an ephemeral
  port with a warning instead of throwing.

Set `failOnStartupError: true` only when you want a wrong configuration caught
immediately, and accept that a failed startup can block DSH.

Configuration errors that are deterministic — a malformed `url`, an invalid
`serverName`, a duplicate `serverName`, or a bad `reconnect` value — still throw
at load, because they cannot succeed on retry. If DSH then fails to start,
remove or disable the entry in `cordis.patch.yml`:

```yaml
- id: oauth-mcp-example
  disabled: true
```

## How OAuth works here

The plugin implements the MCP SDK's `OAuthClientProvider` interface and lets
`@modelcontextprotocol/sdk` own the protocol itself (PKCE, dynamic client
registration, authorization-server discovery, token refresh). The plugin
supplies only the host-specific pieces:

1. A loopback HTTP listener binds `127.0.0.1` on `callbackPort` **before** the
   transport is created, so the real port can be advertised as `redirect_uri`
   during dynamic client registration.
2. The first connect is expected to fail with `UnauthorizedError`; that is
   treated as an authorization prompt rather than a connection error. The plugin
   opens the browser, waits for the callback, then reconnects.
3. Authorization state is persisted through the DSH credential service as a
   single JSON blob, with serialized read-modify-write updates. The PKCE code
   verifier stays in memory only.
4. The callback validates `state` with a constant-time comparison before parsing
   the authorization code or error parameter.

## Security notes

- OAuth state is stored through the DSH credential service, not in this repo.
- The callback listener binds to the local loopback interface only.
- `url` must use HTTPS; plain HTTP is accepted only for loopback development.
- Do not configure an `Authorization` header; the OAuth client owns it.
- Never commit access tokens, refresh tokens, or exported credential data.

## Development and self-check

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm pack --dry-run
```

## License

MIT. `src/connection.ts` and `src/tools.ts` are adapted from DeepSeek Harness
`@deepseek-ai/dsh-mcp-client` under the MIT License.
