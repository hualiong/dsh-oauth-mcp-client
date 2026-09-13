# dsh-oauth-mcp-client

[English](./README.md) | 简体中文

一个适用于 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness)
的 OAuth 2.1 Streamable HTTP MCP 客户端插件。

它在原生 `dsh-mcp-client` 连接流程上增加了 PKCE、动态客户端注册、浏览器授权、
本地回调、令牌持久化、断线重连和 MCP 工具注册。

本插件是**纯宿主侧、纯配置驱动**的：不带任何界面，安装后也不激活任何东西。每一条
MCP 连接都由你在 profile 补丁层里声明。详见[添加连接](#添加连接)。

## 功能

- 使用 PKCE 的 OAuth 2.1 授权码流程
- 动态 OAuth 客户端注册与授权服务器发现
- 浏览器登录与本地回调
- 通过 DSH credential service 保存令牌和客户端元数据
- 支持自动重连的 Streamable HTTP transport
- MCP 工具发现、注册和调用
- 无界面、无内置端点、不自动连接：完全由 `cordis.patch.yml` 驱动

## 环境要求

- Node.js 22.19 或更高版本
- 首次 OAuth 登录所需的浏览器
- 一个支持 Streamable HTTP 且支持 OAuth 2.1 的 MCP 服务端（需支持动态客户端
  注册，或你自行固定已注册客户端的 redirect URI）

## 安装

在当前 checkout 中构建插件：

```sh
git clone https://github.com/hualiong/dsh-oauth-mcp-client.git
cd dsh-oauth-mcp-client
corepack enable
pnpm install
pnpm build
```

安装到 DSH profile，然后重启 DSH：

```sh
npx --yes @deepseek-ai/dsh@latest plugin --profile desktop add "$PWD"
```

profile 名要填 DSH Desktop 实际加载的那个。本机是 `desktop`，对应
`~/.dsh/profiles/desktop/`。DSH Desktop 不需要跑 `dsh web`，重启应用即可。

## 添加连接

在 profile 补丁层 `~/.dsh/profiles/<profile>/cordis.patch.yml` 中追加：

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

然后重启 DSH Desktop。首次启动会发起连接，服务端返回 `401`，插件随即用系统默认
浏览器打开授权页面。你确认后，令牌写入 DSH credential service；之后启动都是静默
重连，只有 refresh token 过期或被撤销时才会再次打开浏览器。

规则：

- `serverName` 在同一个 DSH 进程内必须唯一，且需匹配 `[A-Za-z0-9_-]{1,32}`。
  它也会成为工具名的一部分，例如 `mcp__example__search`。
- `url` 必须使用 HTTPS；仅 `127.0.0.1`、`localhost`、`[::1]` 允许明文 HTTP。
- 不要配置 `Authorization` header，它由 OAuth 客户端管理。如果某个服务端只接受
  静态 personal access token，那它不需要本插件——用原生
  `@deepseek-ai/dsh-mcp-client` 配 `headers` 即可。

## 配置

| 字段 | 说明 | 默认值 |
| --- | --- | --- |
| `serverName` | 注册到 DSH 的工具命名空间 | 必填 |
| `url` | HTTPS Streamable HTTP MCP 地址 | 必填 |
| `credentialRef` | 保存 OAuth 状态的 DSH credential 引用名 | `DSH_MCP_OAUTH_<SERVERNAME>` |
| `scope` | 可选 OAuth scope | 由服务端发现 |
| `headers` | 附加到 MCP 与发现请求的非 Authorization header | `{}` |
| `callbackPort` | 本地回调端口；`0` 表示自动选择 | `0` |
| `authorizationTimeoutMs` | 浏览器授权超时 | `300000` |
| `toolCallTimeoutMs` | 单次 MCP 工具调用超时 | `60000` |
| `failOnStartupError` | 首次尝试失败时终止插件激活 | `false` |
| `reconnect` | 指数退避重连策略 | 已启用 |

### `callbackPort` 与动态客户端注册

插件保存的 OAuth 客户端注册是和 redirect URI 绑定的。默认 `callbackPort: 0` 时每次
启动由系统分配新端口，已保存的注册会被判定为过期，于是重新执行一次动态客户端注册。
对支持开放注册的服务端这没有影响，只是多一次往返。如果你的授权服务器会固定
redirect URI，或者根本不支持动态客户端注册，就应显式指定 `callbackPort`，让
redirect URI 在重启之间保持稳定。

如果指定的端口已被占用，插件会记一条警告并回退到随机端口，而不是让加载失败——见下节。

## 启动安全

DSH 加载器中的一个条目如果 `apply()` 抛错，可能导致整个应用无法启动。本插件被设计成
让常规运行时状况绝不触发这种情况：

- `failOnStartupError` 默认为 **`false`**。服务端不可达、登录太慢、授权未完成，都只记
  日志并由重连策略重试，而不是让激活失败。
- 指定的 `callbackPort` 被占用时，回退到随机端口并记警告，而不是抛错。

只有当你希望配置错误被立刻发现、并且接受启动失败可能阻塞 DSH 时，才设置
`failOnStartupError: true`。

确定性配置错误——`url` 格式错误、`serverName` 非法或重复、`reconnect` 取值非法——
仍然会在加载时抛错，因为它们重试也不会成功。若此时 DSH 无法启动，在
`cordis.patch.yml` 中禁用该条目：

```yaml
- id: oauth-mcp-example
  disabled: true
```

## OAuth 实现说明

插件实现 MCP SDK 的 `OAuthClientProvider` 接口，把协议本身（PKCE、动态客户端
注册、授权服务器发现、令牌刷新）完全交给 `@modelcontextprotocol/sdk`；插件只提供
宿主环境相关的部分：

1. 在创建 transport **之前**先在 `127.0.0.1` 上按 `callbackPort` 监听，这样动态
   客户端注册时就能拿到真实端口作为 `redirect_uri`。
2. 首次连接预期会因 `UnauthorizedError` 失败，插件将其视为授权提示而不是连接错误：
   打开浏览器、等待回调，然后重新连接。
3. 授权状态以单个 JSON blob 通过 DSH credential service 持久化，读-改-写串行化；
   PKCE code verifier 只保留在内存中。
4. 回调会先用常数时间比较校验 `state`，然后才解析授权码或 error 参数。

## 安全说明

- OAuth 状态由 DSH credential service 保存，不写入本仓库。
- 回调服务只监听本地 loopback 地址。
- `url` 必须使用 HTTPS；仅 loopback 开发端点允许明文 HTTP。
- 不要配置 `Authorization` header；该 header 由 OAuth 客户端管理。
- 不要提交 access token、refresh token 或导出的 credential 数据。

## 开发与自检

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm pack --dry-run
```

## 许可证

MIT。`src/connection.ts` 和 `src/tools.ts` 基于 MIT License 下的 DeepSeek Harness
`@deepseek-ai/dsh-mcp-client` 改造。
