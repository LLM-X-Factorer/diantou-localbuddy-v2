# LocalBuddy V2 Internal Quickstart

> 适用版本：三平台源码候选 `0.11.1 / M10.3 Provider Setup`。macOS 本机包已验证；Windows/Linux 同版本原生构建与同步发布流程已准备，但最新私有 GitHub Release 仍为 `v0.11.0 / M10.2`。开始前先阅读 [`KNOWN-LIMITATIONS.md`](KNOWN-LIMITATIONS.md)。

## 1. 选择可用入口

| 平台 | 当前可用入口 | 已证明范围 |
|---|---|---|
| macOS arm64 | 从仓库执行 `pnpm desktop`，或使用本机生成的 ad-hoc ZIP/DMG | 本机 Renderer、Fuse、ASAR、内置浏览器和包完整性烟测 |
| Windows x64 | 私有 [`v0.11.0` Release](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/releases/tag/v0.11.0) 的 Setup/ZIP | Windows Runner 合同、构建与 Release 哈希；真机运行待验收 |
| Linux x64 | 既有 GitHub CI DEB artifact；`v0.11.1` 起计划随同 Windows 资产进入同一私有 Release | Ubuntu Runner 合同与构建；`0.11.1` 原生运行和图形桌面安装/启动待验收 |

Windows 包未签名。只有明确获准参与内部测试时才下载；不要把 SmartScreen 提示解释为已完成发布信誉或代码签名。

## 2. 从源码启动

需要 Node.js 22、pnpm 9.15.9 和 Git：

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm check
pnpm desktop
```

不要把 API Key 写入 `.env` 后提交。`.localbuddy/` 包含目标、checkpoint、事件和产物，也不得进入版本库。

## 2.1 第一次可信运行

首次打开时使用侧边栏“指引与示例”：

1. 没有安全测试目录时，点击“创建教程工作区并预填”；
2. LocalBuddy 会在应用数据目录创建三份虚构材料，不会触碰 Documents 或已有工作区；
3. 检查编辑器中的目标、Provider、信任档和模式；
4. 只有点击“开始任务”才会把必要上下文发送给所选 Provider；
5. 完成后依次查看任务图、运行轨迹和经过哈希验证的 Artifact。

Guide 本身不调用模型，也不生成假 Run。用户可以进入工作台，并随时从侧边栏重新打开。

## 3. 配置 Provider

1. 点击侧边栏固定的“Provider 设置”；
2. 选择 DeepSeek 或 OpenAI，并确认状态是“环境变量”“系统安全存储”或“未配置”；
3. 在密码框输入 API Key，点击“安全保存”；已有系统凭据时可“替换并保存”；
4. 成功后输入框会清空，Renderer 不会读取或回显已有凭证；
5. 如需确认认证和网络，主动点击“验证连接”。它会向当前 Provider/Base URL 请求 `/models`，不会生成内容或消耗模型 token；
6. Model 和 HTTPS/loopback Base URL 位于“当前 Run 高级设置”，只影响之后的验证或 Run。

凭证写入 macOS Keychain、Linux Secret Service 或 Windows Credential Manager。系统凭据可经原生确认删除。也可以在 CLI 进程环境中使用 `DEEPSEEK_API_KEY` / `OPENAI_API_KEY`；环境变量优先，应用只能显示其存在，不能替换或删除进程环境。

Linux DEB 声明 `libsecret-tools` 依赖以提供 `secret-tool`；系统仍必须运行可用的 Secret Service/桌面 Keyring。没有该会话时，应用应报告系统凭据不可用，而不是回退到明文文件。

保存本身不会联网。只有点击“验证连接”或“开始任务”才会把凭据发送到界面所示端点。没有所选 Provider 的可用凭据时，“开始任务”会保持禁用并提供直达设置入口。

## 4. 完成第一个 Research Run

1. 选择一个不含敏感外发限制的本地工作区；
2. 模式选择“研究”；
3. 信任档先使用“平衡（推荐）”；
4. 并发选择 2 或 3；
5. 输入明确目标，例如“读取当前目录中的会议记录，生成一份标注来源文件的行动清单”；
6. 启动后观察 Task Graph、事件轨迹、审批请求和最终 Artifact。

默认不会让 Browser/MCP 执行外部副作用。启用扩展时必须填写精确 Skill ID、MCP Server ID 或 Browser Origin；允许动作只代表调用可以进入逐次审批，不代表预先批准。

## 5. 使用 Coding 模式

Coding 工作区必须：

- 是 Git 仓库根目录；
- 有可解析的 `HEAD`；
- 主工作区干净；
- 已忽略 `.localbuddy/`。

Code Worker 只在 detached worktree 中修改授权路径。组合补丁通过预检后仍停在 `awaiting_approval`；必须阅读 inline diff，再决定仅应用、应用并提交或拒绝。LocalBuddy 不会把 Agent 判断当成人类批准。

Windows `0.11.x` 没有受支持的本地进程隔离宿主，涉及检查命令或 stdio 进程的能力会 fail closed；不要把 Windows 包当成 Coding 全功能版本。

## 6. 中断、恢复与诊断

- 有可验证 checkpoint 时使用“恢复执行”，继续原 Run；
- 失败 Run 只在安全 checkpoint 可验证时恢复未完成 Task 链；已经完成的 Task 不会重跑；
- checkpoint 不可用或工作区漂移时使用“重新运行”，创建新 Run 并保留旧历史；
- 不要手动删除受保护的 worktree；在 Run 终态后使用界面的显式清理；
- 需要反馈问题时导出脱敏诊断包，并另行描述复现步骤；诊断包不包含目标正文、模型内容、工具参数、凭证或绝对工作区路径。

已登记的有限文本 Artifact 可以在校验路径、大小和 SHA-256 后内嵌预览。“基于此产物继续”只会把可审计引用预填到组合器，仍需用户检查并手工启动新 Run；不会自动发送 Artifact 正文。

真实试用记录方式见 [`DOGFOOD.md`](DOGFOOD.md)。
