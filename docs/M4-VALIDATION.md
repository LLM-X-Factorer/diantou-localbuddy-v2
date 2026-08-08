# M4 Extensions Validation Record

验收日期：2026-08-08<br>
Node：25.8.2（项目契约为 22+）<br>
真实 Provider：DeepSeek API（`deepseek-v4-flash`）<br>
协议级 Provider：OpenAI Chat Completions mock SSE

## 自动验证

- `pnpm check`：Core/Main/Preload/Renderer TypeScript 检查与 69 项测试全部通过。
- `pnpm build`：Core、Electron Main/Preload 与 Renderer production build 通过；Renderer 输出 HTML 0.61 kB、CSS 15.22 kB、JS 209.16 kB。
- `pnpm audit --prod --audit-level high`：无已知生产依赖漏洞。
- 凭证扫描：仓库内未发现非空 DeepSeek/OpenAI Key 或 Bearer token；`.localbuddy/`、`.env`、Run/浏览器状态均被忽略。
- 真实 Chromium 覆盖 exact-origin 导航、ARIA 点击、跨 origin 阻断、状态持久化与恢复。
- 真实 MCP stdio 子进程覆盖工具发现、名称规范化、只读/副作用分级、调用结果与关闭。
- Research 全链路同时覆盖 Skill 指令、本地文件、浏览器、MCP、Integrator Artifact 和审计事件。
- Coding 全链路覆盖 Code Skill、MCP 调用、detached worktree patch、主工作区不变和 Integration awaiting approval。
- 授权测试证明 MCP effectful tool 与 browser click 默认拒绝，只有 Run 显式授权才放行。
- 修改已参与运行的 `SKILL.md` 后，同 Run checkpoint resume 在 `run.resumed` 之前因 Task contract changed 被阻断。
- DeepSeek 与 OpenAI adapter 均覆盖流式文本、分片 tool call、usage、JSON Output 字段和 1,000 字节错误正文上限。

## 真实 DeepSeek M4 纵向烟测

烟测使用临时工作区、真实 DeepSeek Keychain 凭证、一个 loopback HTTP 页面和真实 MCP fixture 子进程。所有临时 Prompt、event、checkpoint、browser state 与 Artifact 在验收后删除。

目标要求同一 Worker 独立取得三项哨兵：

- `read_file`：`local-file-sentinel`；
- `browser_navigate`：`live-browser-sentinel`；
- MCP `echo`：`live-mcp-sentinel`。

结果：

- Run 状态：`succeeded`；
- 模型完成事件：7；
- 登记 Artifact：`m4-live-report.md`，1 个；
- 实际完成工具：`read_file`、`browser_navigate`、`mcp_fixture_echo_092c79e8`、`write_artifact`；
- `extensions.loaded`：存在；
- 三个精确哨兵全部出现在最终 Artifact；
- Artifact SHA-256：`7b1e1de0a7bf5213cd0fe4eae20ac5f590d9a3cdf3b1c91baaa3fae713c180a5`。

首轮验收还发现 Planner 没有明确要求保留用户指定的安全输出文件名。运行时成功，但烟测脚本无法按约定路径读取产物。修复后 Planner 明确保留显式请求的简单 `.md` 文件名，第二轮真实烟测产出准确的 `m4-live-report.md`。

## Desktop 实窗验收

Electron production build 从 JSONL 重建一个已完成的 M4 Run，真实窗口验证：

- 历史 Run 显示已完成 Task、登记 Artifact 与 8 个 append-only event；
- 事件轨显示 `extensions.loaded`；
- Runtime 卡显示历史 Provider 为 OpenAI，而不是新 Run 表单的 DeepSeek 默认值；
- Runtime 卡显示 `1 Skills · 1 MCP · Browser`；
- Composer 提供 M4 扩展配置入口和 Provider 选择。

截图：临时验收目录中的 `m4-desktop.png`（不进入 Git）。

- 尺寸：2880 × 1718；
- 文件大小：239,487 bytes；
- SHA-256：`1237549faaf2a44e39414a866960f3340b487c23b1309740b594e19d98897c87`。

## 明确边界

- 浏览器是隔离的 headless Chromium，不读取用户日常 Chrome Profile、扩展、密码或登录态。
- exact-origin allowlist 不是 OS 网络沙箱；MCP server 和项目检查命令仍是本机进程。
- MCP stdio command 来自用户工作区配置，本身等同本地程序执行；M4 没有容器隔离。
- `readOnlyTools` 是本地人工声明；错误声明可能把有副作用的远端工具降级为只读，因此应只信任用户审阅过的 MCP 配置。
- Browser action/MCP write 是 Run 级总开关，不是每次 tool call 的交互式批准。
- Skills 是用户显式启用的本地指令，不做签名、市场安装或远程更新。
- OpenAI 只完成 adapter 协议测试，未在本次会话使用真实 OpenAI Key 产生账单请求。
- OS/容器隔离、HTTP MCP/OAuth、自动冲突解决、跨进程全局协调和正式安装包属于 M4 之后的 hardening/packaging。
