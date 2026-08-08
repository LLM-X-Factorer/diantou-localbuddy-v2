# M5 Hardening + Packaging Specification

## 1. 目标、威胁模型与边界

M5 解决 M4 后仍会直接影响本地单用户可靠性与可分发性的四类风险：扩展副作用被一次性总授权、Desktop 与 CLI 跨进程争用同一工作区、远程 MCP 只能使用 stdio，以及 Electron 开发态配置不能证明安装包同样安全可运行。

本阶段完成：

- Desktop 对每一次 effectful MCP/browser tool call 展示独立审批，批准只消费一次；
- MCP `Streamable HTTP` client，支持 HTTPS 或 loopback HTTP，以及从环境变量注入静态 Bearer token；
- CLI/Desktop 跨 OS 进程的工作区租约，同时保留单个 Desktop 进程内的多 Run；
- Electron 自定义安全协议、全局 sandbox、严格 CSP 与逐项 Electron fuse；
- Electron Forge macOS arm64 ASAR package、ZIP 和 DMG，内含锁定版本的 Chromium headless shell；
- 可重复执行的签名、fuse、包内浏览器和 Renderer 启动验收脚本。

M5 不实现完整 MCP OAuth 2.1、恶意本地程序的 OS/容器隔离、正式 Developer ID 签名、Apple notarization、自动更新、Windows/Linux 安装包或跨设备协作。这些能力需要外部身份、发布基础设施或更强执行边界，不能用本地 mock 冒充完成。

## 2. 逐次工具审批

M4 的两个扩展开关在 Desktop 中改为“允许发起逐次审批”，不再等于提前批准所有调用。只有风险为 `execute` 的 browser action 或未被本地配置声明为 read-only 的 MCP 工具进入队列；内建代码写入仍受既有 worktree/owned-path/Integration Gate 约束。

每个审批请求固定：

- `approvalId`、Run/Task/Agent/tool；
- 本地工具说明；
- 精确原始参数的 SHA-256；
- 最多 4 KiB 的有界、脱敏参数预览；
- 到期时间。

密码、token、secret、authorization 等敏感字段被替换；`browser_fill.value` 永不展示。事件只记录 ID、工具、参数哈希、decision 和时间，不记录原始参数预览。`approve` 只放行这一条等待中的调用；重复决策、未知 ID 或过期请求被拒绝。Run 取消时，所有等待请求按 deny 收口，防止 Task 永久悬挂。

CLI 保留显式 Run 级命令行开关，适合无人值守任务；CLI 不伪装成具备交互式审批 UI。

## 3. MCP Streamable HTTP

`.localbuddy/mcp.json` 的 stdio 配置保持向后兼容，新增：

```json
{
  "version": 1,
  "servers": [
    {
      "id": "remote-tools",
      "transport": "streamable-http",
      "url": "https://mcp.example.com/mcp",
      "bearerTokenEnv": "REMOTE_MCP_TOKEN",
      "readOnlyTools": ["search"]
    }
  ]
}
```

URL 只允许 HTTPS 或 loopback HTTP，并拒绝内嵌账号、密码、query 与 fragment。`bearerTokenEnv` 只能是环境变量名；token 字面值不进入配置、Run Request、extension contract、checkpoint 或事件。连接、分页发现、调用、大小上限、风险分级和关闭语义与 stdio 共用。

静态 Bearer token 不是 OAuth。官方 MCP authorization 规范要求基于 OAuth 2.1 的发现、授权服务器元数据、PKCE、audience/resource 校验和 token 生命周期管理；在没有真实 authorization server 与 client registration 的本轮中明确不宣称实现。

## 4. 跨进程工作区租约

进程内 `ExecutionCoordinator` 继续控制多 Run Task 容量与细粒度读写锁；M5 在更外层增加：

```text
<workspace>/.localbuddy/runtime-lock/
└── owner.json  # mode 0600, owner UUID / pid / hostname / label / acquiredAt
```

锁目录以原子 `mkdir` 获取。相同进程对同一工作区可重入，因此 Desktop 仍能运行两个 Run；不同进程看到同主机仍存活的 PID 时快速失败，不等待、不抢占。只有同主机 PID 已不存在，或超过保护期的未完整锁，才会先原子 rename 到 quarantine，再创建新锁。外地主机标记和无法解析的 owner metadata 一律 fail closed。

租约覆盖 CLI 整次 Run，以及 Desktop 的 start/resume/replay、worktree cleanup、Integration apply/revert 与启动对账。Desktop 历史列表拿不到锁时只读历史，不执行可能写事件的 reconciliation。

这是“单工作区跨进程互斥”，不是跨进程共享全局 Task 计数，也不是分布式锁。崩溃后的 PID 重用属于小概率残余风险；owner UUID 防止旧 lease 删除后来者的锁。

## 5. Electron 安全与打包

Renderer 从 `file://` 迁移到注册为 standard + secure 的 `localbuddy://app/`。协议 handler 只接受固定 host，解码后再次验证路径仍在 Renderer 根目录，并从 ASAR 读取有界的静态构建文件。Renderer：

- 全局 `app.enableSandbox()`，窗口继续使用 `sandbox: true`；
- `contextIsolation: true`、`nodeIntegration: false`、`webSecurity: true`；
- CSP 使用 `connect-src 'none'`，无 `unsafe-inline`，禁用 object/frame/base/form；
- 拒绝新窗口、webview、非入口导航和所有权限请求；
- IPC 继续校验精确 sender URL 与逐字段输入。

Forge package 使用 `asar: true`，并逐项固定 Electron 43 的 9 个 fuse：关闭 RunAsNode、NODE_OPTIONS、CLI inspect、额外 file 协议权限和 browser-specific snapshot；启用 cookie encryption、ASAR integrity、OnlyLoadAppFromAsar 与 Wasm trap handlers。`strictlyRequireAllFuses=true` 让 Electron 新增 fuse 时构建硬失败。

macOS arm64 包内只安装 Playwright 锁定 revision 的 headless Chromium 与 FFmpeg，不读取用户 Chrome。Forge 生成 `.app` 和 ZIP；DMG 使用系统 `hdiutil` 从同一 `.app` 生成，以避免引入存在未修复 advisory 的旧 DMG maker。

本地包使用 ad-hoc 签名，未启用需要 Developer ID Team identity 的 Hardened Runtime，也未 notarize。它用于本机验收与内部试用；面向其他用户公开分发前必须补正式签名、公证、更新签名和发布渠道验证。

## 6. 上游依据

本阶段只依据公开规范和官方文档，未复制 Craft Agents 或腾讯 WorkBuddy 源码：

- Electron Security，访问于 2026-08-08：<https://www.electronjs.org/docs/latest/tutorial/security>
- Electron Context Isolation，访问于 2026-08-08：<https://www.electronjs.org/docs/latest/tutorial/context-isolation>
- Electron Process Sandboxing，访问于 2026-08-08：<https://www.electronjs.org/docs/latest/tutorial/sandbox>
- Electron Fuses，访问于 2026-08-08：<https://www.electronjs.org/docs/latest/tutorial/fuses>
- Electron Forge overview，访问于 2026-08-08：<https://www.electronjs.org/docs/latest/tutorial/forge-overview>
- Electron Forge configuration，访问于 2026-08-08：<https://www.electronforge.io/config/configuration>
- MCP Streamable HTTP transport，版本 2025-06-18，访问于 2026-08-08：<https://modelcontextprotocol.io/specification/2025-06-18/basic/transports>
- MCP Authorization，版本 2025-06-18，访问于 2026-08-08：<https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization>
- MCP Security and Trust & Safety，版本 2025-06-18，访问于 2026-08-08：<https://modelcontextprotocol.io/specification/2025-06-18/index>
