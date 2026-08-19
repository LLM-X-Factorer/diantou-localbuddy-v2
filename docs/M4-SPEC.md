# M4 Extensions Specification

## 1. 目标与非目标

M4 把 LocalBuddy V2 从固定的 DeepSeek + 本地文件工具，扩展为按 Run 选择 Provider、Skills、MCP server 和受限浏览器的本地多 Agent 工作台。四类扩展同时可用于 Research Worker、Code Worker 与 Integrator，并继续受原有事件、审批、checkpoint 和工作区边界约束。

本阶段完成：

- DeepSeek 与 OpenAI 两个远程 LLM Provider；
- 工作区本地、显式选择的 `SKILL.md`；
- MCP stdio client、工具发现与调用；
- Playwright Chromium 隔离浏览器；
- CLI、Desktop、Run Request、历史投影和 checkpoint 的完整配置链路。

M4 不实现 Skills 市场、远程 Skill 下载、MCP OAuth/HTTP transport、日常浏览器用户 Profile 接管、OS/容器沙箱、自动冲突解决或正式安装包。OpenAI Provider 完成协议级自动测试，但没有使用真实 OpenAI Key 做外部账单验收。

## 2. Run 级扩展契约

一次 Run 的可持久化配置为：

```ts
interface RunExtensionSelection {
  skillIds?: readonly string[];
  mcpServerIds?: readonly string[];
  allowMcpWrites?: boolean;
  browser?: {
    allowedOrigins: readonly string[];
    allowActions?: boolean;
  };
}
```

系统在模型规划前规范化并加载配置，计算包含选择项、Skill 内容哈希、MCP server 配置、工具 schema 和风险级别的 `contractSha256`。该哈希进入 Agent 指令，因此 Skill 内容、MCP 配置或远端工具契约变化都会改变 Task contract；旧 checkpoint 在追加 `run.resumed` 之前即被拒绝。

`run-request.json` 使用 version 2 保存 Provider 与扩展选择；version 1 历史请求仍能读取，并默认回退到 DeepSeek、无扩展。`extensions.loaded` 只记录 ID、数量、origin、授权布尔值和哈希，不记录 Skill 正文、MCP 参数值、网页正文或凭证。

## 3. Provider

支持的 Provider ID：

- `deepseek`：默认模型 `deepseek-v4-flash`，默认 base URL `https://api.deepseek.com`；
- `openai`：默认模型 `gpt-5-mini`，默认 base URL `https://api.openai.com/v1`。

两者都实现流式 Chat Completions、文本增量、函数工具调用、JSON Output、usage 和有界错误正文。自定义 base URL 只接受 HTTPS 或 loopback HTTP，拒绝嵌入凭证、query 和 fragment。

API Key 解析顺序是环境变量优先、macOS Keychain 其次：

```bash
pnpm credentials:set -- --provider deepseek
pnpm credentials:set -- --provider openai
```

Key 不进入 Run Request、事件、checkpoint 或 Provider 错误消息。环境变量示例见 `.env.example`。

## 4. Local Skills

Skill 只能来自当前工作区：

```text
.localbuddy/skills/<skill-id>/SKILL.md
```

示例：

```markdown
---
version: 1
id: evidence-review
title: Evidence Review
description: Require grounded evidence before synthesis.
appliesTo: research
allowedTools:
  - browser_navigate
---
Read every selected source and preserve exact evidence boundaries.
```

加载器要求 kebab-case ID、匹配的 version/id、有限大小和合法 YAML frontmatter；目录与文件都不能是符号链接，`realpath` 必须留在 Skill 根目录。Skill 只在用户为该 Run 显式选择后注入，并始终排在 LocalBuddy 本地安全规则之后。

`allowedTools` 是兼容性与审阅元数据，不授予工具、不扩大权限。真正可见的扩展工具只来自该 Run 已配置的 MCP/browser；实际调用继续经过 Tool Registry 与 Approval Policy。

## 5. MCP stdio

工作区配置文件：`.localbuddy/mcp.json`。

```json
{
  "version": 1,
  "servers": [
    {
      "id": "local-tools",
      "command": "node",
      "args": ["tools/server.js"],
      "cwd": ".",
      "env": { "SERVICE_TOKEN": "LOCAL_SERVICE_TOKEN" },
      "readOnlyTools": ["search"]
    }
  ]
}
```

`env` 的 value 是宿主环境变量名，不是 secret 字面值。`cwd` 必须在工作区内。Run 只连接显式选择的 server，并使用 MCP TypeScript SDK 的 `StdioClientTransport` 管理子进程、分页发现工具、调用和关闭。

本地 `readOnlyTools` 是唯一的只读风险真源；MCP server 自报的 annotations 只被视为提示，不能自行获得授权。其他 MCP 工具一律按 `execute` 处理，只有 `allowMcpWrites=true` 才会放行。工具数、单 schema、总 schema、参数、文本、structured content、超时和 transport buffer 均有上限；二进制图像/音频/blob 不进入模型上下文。

## 6. Browser

Browser extension 使用懒启动的 headless Chromium。每个 Run 创建独立 non-persistent BrowserContext，阻止下载与 Service Worker；所有网络请求都经过 exact-origin route allowlist。公开 HTTPS origin 可用，HTTP 只允许 loopback。

工具分级：

| 工具 | 风险 | 默认授权 |
|---|---|---|
| `browser_navigate` | read | 本地 read policy 放行 |
| `browser_snapshot` | read | 本地 read policy 放行 |
| `browser_click` | execute | 拒绝，除非 Run 显式允许 actions |
| `browser_fill` | execute | 拒绝，除非 Run 显式允许 actions |
| `browser_press` | execute | 拒绝，除非 Run 显式允许 actions |

点击按精确 ARIA role/name 定位，填表按精确 label 定位，按键只允许 Enter/Escape/Tab/方向键。弹窗关闭、下载取消、跨 origin 请求阻断。页面文本与 accessibility snapshot 有界；browser storage state 和当前 URL 原子保存到 Run checkpoint，属于本地私有状态。

首次使用前安装浏览器：

```bash
pnpm exec playwright install chromium
```

## 7. CLI 与 Desktop

CLI 示例：

```bash
pnpm cli -- \
  --provider deepseek \
  --workspace /path/to/workspace \
  --goal "读取本地材料、浏览指定页面，并用 MCP 工具生成报告" \
  --skill evidence-review \
  --mcp-server local-tools \
  --browser-origin https://example.com
```

副作用权限必须单独给出：

```bash
--allow-browser-actions --allow-mcp-writes
```

Desktop 从当前运行位置的两个固定入口建立“方法与连接”：只检查 `.localbuddy/skills` 与 `.localbuddy/mcp.json`，不递归扫描工作区。普通任务无需打开这个入口；打开后，Skill 以“按固定方法完成”展示，MCP server 以“使用其他服务或本机工具”展示。主层只显示用户可理解的名称、用途和是否可用，技术 ID、来源、连接/认证类别与网页访问配置放入折叠的高级信息。无效配置单独报告，不会把 Skill 正文、MCP 环境变量名对应的值或绝对路径送进 Renderer。切换运行位置会清空上一个位置的选择。

Skill 与 MCP 都只对当前 Run 显式启用。Skill 只提供工作方法，不授予工具权限。Desktop 中添加 MCP 连接只表示该连接可以为本次 Run 提供工具；任何实际发送、创建、修改或删除仍由 `InteractiveToolApprovalBroker` 在精确调用前逐次审批，因此界面不再要求用户理解一个容易误读的“允许 MCP 写入”预开关。CLI 仍保留 `--allow-mcp-writes` 作为无人值守场景的明确 fail-closed 边界。Browser origin 仍作为高级配置保留。Run 历史显示实际 Provider 与扩展数量，不用当前表单状态伪装历史配置。

“方法与连接”不是安装器或市场：它不下载远程 Skill、不自动写入 MCP 配置、不连接未选择的 server。MCP 配置读取有大小上限，并拒绝符号链接文件或符号链接 `.localbuddy` 目录。

## 8. 上游依据

M4 仅使用公开协议和官方 SDK 文档作为实现依据，未复制 Craft Agents 或腾讯 WorkBuddy 源码：

- Model Context Protocol TypeScript SDK，client 与 stdio transport 文档，访问于 2026-08-08：<https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/client.md>
- MCP first client 示例，访问于 2026-08-08：<https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/get-started/first-client.md>
- Playwright `BrowserContext` 官方 API，访问于 2026-08-08：<https://playwright.dev/docs/api/class-browsercontext>
- OpenAI Skills & Plugins 官方产品文档，访问于 2026-08-19：<https://learn.chatgpt.com/docs/skills-and-plugins>
- OpenAI Plugins 官方产品文档，访问于 2026-08-19：<https://learn.chatgpt.com/docs/plugins>
- OpenAI Permissions 官方产品文档，访问于 2026-08-19：<https://learn.chatgpt.com/docs/permission-modes>

2026-08-19 的 Desktop 调整只借鉴这些公开产品模式：把安装/维护与任务使用分开、以用户目标描述可选能力、把技术元数据渐进披露、在精确外部动作发生时再请求批准。LocalBuddy 保留自己的本地工作区、显式 Run 选择、审计和 fail-closed 合同，没有复制外部产品源码、资产或文案。
- Playwright `Browser` 官方 API，访问于 2026-08-08：<https://playwright.dev/docs/api/class-browser>
- OpenAI API reference，访问于 2026-08-08：<https://platform.openai.com/docs/api-reference>
