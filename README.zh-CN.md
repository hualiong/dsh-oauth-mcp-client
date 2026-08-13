# dsh-oauth-mcp-client

[English](./README.md) | 简体中文

一个适用于 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness)
的 OAuth 2.1 Streamable HTTP MCP 客户端插件。

它在原生 `dsh-mcp-client` 连接流程上增加了 PKCE、动态客户端注册、浏览器授权、
本地回调、令牌持久化、断线重连和 MCP 工具注册。仓库自带的默认配置连接
Springbrand 生产 MCP Gateway。

## 功能

- 使用 PKCE 的 OAuth 2.1 授权码流程
- 动态 OAuth 客户端注册
- 浏览器登录与本地回调
- 通过 DSH credential service 保存令牌和客户端元数据
- 支持自动重连的 Streamable HTTP transport
- MCP 工具发现、注册和调用
- 在 DSH Web 中管理连接并查看实时状态和能力
- 一键持久化连接配置并进入浏览器 OAuth

## 环境要求

- Node.js 22.19 或更高版本
- Git
- 首次 OAuth 登录所需的浏览器

## 安装

克隆并构建插件：

```sh
git clone https://github.com/springbrand-lab/dsh-oauth-mcp-client.git
cd dsh-oauth-mcp-client
corepack enable
pnpm install
pnpm build
```

把已经构建好的当前目录安装到 DSH profile，然后启动 DSH：

```sh
PLUGIN_DIR="$PWD"
npx --yes @deepseek-ai/dsh@latest plugin --profile web add "$PLUGIN_DIR"
npx --yes @deepseek-ai/dsh@latest web
```

本仓库目前没有发布到 npm，因此使用本地 checkout 安装。把这个 bundle 添加到 profile
时，默认的 Springbrand MCP 连接也会自动添加，不需要再执行一次 MCP 注册操作。

首次启动会打开浏览器进行 Springbrand 登录和授权。授权成功后，打开
**设置 → 插件 → MCP 连接**，即可查看实时连接状态和已经注册的能力。也可以用以下工具
验证默认连接：

- `mcp__springbrand__search_capabilities`
- `mcp__springbrand__execute_capability`

## 使用

可以直接让 Agent 搜索 Springbrand capability 目录，例如：

```text
搜索 Springbrand 市场中的资源，并列出前 10 个。
```

正常调用流程：

```mermaid
flowchart LR
  User["用户请求"] --> Search["search_capabilities"]
  Search --> Name["复制完整 capability name"]
  Name --> Execute["execute_capability"]
  Execute --> Result["MCP 返回结果"]
```

调用 `execute_capability` 时，必须使用 `search_capabilities` 返回的完整 `name`，
例如 `platform:springbrand@0:springbrand.resources.list`。不要改用较短的
`action_id`，例如 `springbrand.resources.list`。

插件会自动把这条工具选择规则加入 Agent 指引，因此用户只需正常描述需求，不必手动指定
工具调用。

## 在 DSH Web 中管理连接

打开 **设置 → 插件 → MCP 连接**，填写唯一的服务名和服务端 HTTPS MCP 地址，然后点击
**添加并登录**。在自动打开的浏览器中完成 OAuth。DSH 会加载新连接，页面随后显示实时状态和
实际注册的工具能力。点击连接上的 **移除**，即可卸载其工具，并在永久 profile 中删除或停用
该连接。

该按钮会把连接永久写入 `~/.dsh/profiles/web/cordis.patch.yml`。重启 DSH 后连接仍然存在，
不需要临时的 `--patch` 命令。

```mermaid
flowchart LR
  Add["添加并登录"] --> Config["Web profile 永久配置"]
  Config --> OAuth["浏览器 OAuth"]
  OAuth --> Tools["DSH Web 展示已连接工具"]
```

## 配置

默认配置位于 [`springbrand.cordis.yml`](./springbrand.cordis.yml)：

| 字段 | 说明 | 默认值 |
| --- | --- | --- |
| `serverName` | 注册到 DSH 的工具命名空间 | `springbrand` |
| `url` | HTTPS Streamable HTTP MCP 地址 | `https://connector.springbrand.ai/mcp` |
| `credentialRef` | DSH credential 引用名 | `SPRINGBRAND_MCP_OAUTH_PRODUCTION` |
| `scope` | 可选 OAuth scope | 由服务端发现 |
| `callbackPort` | 本地回调端口；`0` 表示自动选择 | `0` |
| `authorizationTimeoutMs` | 浏览器授权超时 | `300000` |
| `toolCallTimeoutMs` | 单次 MCP 工具调用超时 | `60000` |
| `failOnStartupError` | 首次连接失败时终止激活 | `true` |
| `reconnect` | 指数退避重连策略 | 已启用 |

## 手动配置

Web 页面是默认配置方式。如果需要手动配置，把连接添加到同一个 Web profile 永久配置文件
`~/.dsh/profiles/web/cordis.patch.yml`：

```yaml
- insert:
    - id: my-oauth-mcp
      name: '@dsh-external/dsh-oauth-mcp-client'
      config:
        serverName: my-mcp
        url: https://mcp.example.com/mcp
        credentialRef: MY_MCP_OAUTH
        failOnStartupError: true
```

服务端必须支持 OAuth 和 MCP Streamable HTTP。首次连接时会打开浏览器进行授权。
同一个 DSH 进程中的 `serverName` 必须唯一，它也会成为工具名的一部分，例如
`mcp__my-mcp__search`。

## 安全说明

- OAuth 状态由 DSH credential service 保存，不写入本仓库。
- 回调服务只监听本地 loopback 地址。
- 不要配置 `Authorization` header；该 header 由 OAuth 客户端管理。
- 不要提交 access token、refresh token 或导出的 credential 数据。

## 开发与自检

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm pack --dry-run
```

进行 DSH 加载级自检时，把当前 checkout 安装到一个 profile 并启动；出现提示后完成
OAuth 登录：

```sh
PLUGIN_DIR="$PWD"
npx --yes @deepseek-ai/dsh@latest plugin --profile headless add "$PLUGIN_DIR"
npx --yes @deepseek-ai/dsh@latest --profile headless "hi"
```

## 生态元数据

- 包名：`@dsh-external/dsh-oauth-mcp-client`
- 自动发现 topic：`dsh-plugin`
- 插件目录：[Awesome DSH Plugins](https://github.com/AdamPlatin123/awesome-dsh-plugins)

## 许可证

MIT。`src/connection.ts` 和 `src/tools.ts` 基于 MIT License 下的 DeepSeek Harness
`@deepseek-ai/dsh-mcp-client` 改造。
