# LocalBuddy V2 Internal Quickstart

> 适用版本：`v0.13.0 / User-first Workflows` 发布候选。固定 Tag 通过前，当前公开但未签名的 Engineering Alpha 仍是 `v0.12.8 / First-party Windows Update Feed`。当前灰度与发布优先 Windows；macOS 保留回归，Linux 降为维护。开始前先阅读 [`KNOWN-LIMITATIONS.md`](KNOWN-LIMITATIONS.md)。

## 1. 选择可用入口

| 平台 | 当前可用入口 | 已证明范围 |
|---|---|---|
| macOS arm64 | 从仓库执行 `pnpm desktop`，或使用本机生成的 ad-hoc ZIP/DMG | 本机 Renderer、Fuse、ASAR、内置浏览器和包完整性烟测 |
| Windows x64 | 候选发布后使用公开 [`v0.13.0` Release](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/releases/tag/v0.13.0) 的 Setup/ZIP；发布前继续使用 [`v0.12.8`](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/releases/tag/v0.12.8) | `v0.12.8` 五项资产和第一方公网升级已通过；`v0.13.0` 必须重新完成 Tag、安装、原位升级和公网 feed 门禁；Windows 11、SmartScreen/UAC 与代码签名仍未验收 |
| Linux x64 | 当前不提供新 Release | 每周/手动构建维护；真实图形桌面验收暂不优先 |

Windows 包未签名。只有明确获准参与内部测试时才下载；不要把 SmartScreen 提示解释为已完成发布信誉或代码签名。

### Windows 日常更新开发包

开发测试不需要每次卸载稳定版。代码合入 `main` 且 CI 成功后，在 Windows 仓库目录执行：

```powershell
gh auth status
pnpm windows:canary
```

它下载最新便携 Canary，按 Git SHA 并存并使用独立 Electron user-data 启动，不触碰稳定版安装。Canary 仍会使用系统 Credential Manager 和所选工作区中的 `.localbuddy/`，因此请使用测试工作区。完整边界和固定历史 Run 的方法见 [`WINDOWS-UPDATES.md`](WINDOWS-UPDATES.md)。

## 2. 从源码启动

需要 Node.js 22、pnpm 9.15.9 和 Git：

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm check
pnpm desktop
```

不要把 API Key 写入 `.env` 后提交。`.localbuddy/` 包含目标、checkpoint、事件和产物，也不得进入版本库。

选择运行位置后，在新任务输入框旁展开“存储与隐私”：它会显示过程记录和结果文件的确切目录。macOS/Linux 新写 Run 使用当前账号私有权限；Windows 文件继承所选目录 ACL。云同步或网络目录会显示警告，但检测只是尽力识别。完整合同见 [`STORAGE-AND-PRIVACY.md`](STORAGE-AND-PRIVACY.md)。

## 2.1 第一次任务

首次打开时只跟随侧边栏“第一次使用”中的一个推荐任务：

1. 推荐点击“使用示例会议记录”。LocalBuddy 会在应用数据目录创建一份完全虚构的会议记录，不会扫描电脑、触碰 Documents 或覆盖已有工作区；也可以点击“使用我自己的会议记录”，明确选择一份 TXT、Markdown 或 DOCX 文件，原文件不会被修改；
2. 点击“连接模型”。没有 API Key 时，使用界面中的固定按钮打开 DeepSeek/OpenAI 官方平台；注册、账户要求和价格由模型服务商决定，LocalBuddy 不销售模型额度或代扣费用。取得 Key 后回到应用粘贴，并安全保存到本机；
3. 回到指引，点击“生成执行计划”。这一步会连接所选模型，但还不会处理会议记录；
4. 在“确认执行计划”中核对将读取的会议记录、要生成的 `会议纪要.docx` 和“不会修改原文件”；确认无误后点击“确认计划并开始”，不合适可以“不执行，结束任务”；
5. 第一次任务默认只显示用户能理解的任务步骤；并行耗时、审计指标和原始事件收在“查看详细过程”中。完成后点击“查看结果”，页面会直接滚动并聚焦 `会议纪要.docx` 的结构预览，也可以“用默认应用打开”；
6. 失败时先看“为什么失败”，按场景检查模型连接或资料；“能否接着运行”单独说明 checkpoint 是否可用。修正原因后再选择继续、从头开始或报告失败。

准备示例会议记录不会调用模型，也不会生成假 Run。选择自己的会议记录只登记用户明确选择的一个文件；生成并确认计划前不会读取。第一次任务完成后，可以进入完整工作台处理其他资料；侧边栏仍可随时重新打开“第一次使用”。当前版本已经验证受限 DOCX 生成、回读和修订，不据此宣称任意 Word、Excel 或 PPT 工作均已支持。

## 3. 模型设置

1. 点击侧边栏固定的“模型设置”；
2. 选择 DeepSeek 或 OpenAI，并确认状态是“已连接”或“未连接”；
3. 没有 API Key 时，点击“打开 DeepSeek/OpenAI 官方平台”，登录或注册并按官方页面创建。该固定外链由 Main 进程白名单打开，Renderer 不能传入任意网址；模型服务商可能按用量收费；
4. 在密码框输入 API Key，点击“安全保存到本机”；已有系统凭据时可“替换并保存”；
5. 成功后输入框会清空，Renderer 不会读取或回显已有凭证；
6. 如需确认认证和网络，主动点击“验证连接”。它会向当前模型服务/Base URL 请求模型列表，不会生成内容；
7. Model 和 HTTPS/loopback Base URL 位于“高级设置（第一次使用不用改）”，只影响之后的验证或任务。

凭证写入 macOS Keychain、Linux Secret Service 或 Windows Credential Manager。系统凭据可经原生确认删除。也可以在 CLI 进程环境中使用 `DEEPSEEK_API_KEY` / `OPENAI_API_KEY`；环境变量优先，应用只能显示其存在，不能替换或删除进程环境。

Linux DEB 声明 `libsecret-tools` 依赖以提供 `secret-tool`；系统仍必须运行可用的 Secret Service/桌面 Keyring。没有该会话时，应用应报告系统凭据不可用，而不是回退到明文文件。

保存本身不会联网。只有点击“验证连接”“生成执行计划”或执行任务时，才会连接界面所示模型服务。没有可用凭据时，第一次指引会直接进入模型设置，不会误启动真实任务。

## 4. 完成第一个 Research Run

1. 选择“运行位置”，它只用于保存本次任务的过程记录、恢复点和结果文件；展开“存储与隐私”可确认实际路径和同步/网络风险；
2. 点击“开始新任务”，用自己的话写明想要的结果，例如“把本次添加的会议记录整理成可编辑的 `会议纪要.docx`，列出结论、负责人、截止时间和待确认事项”；
3. 在“本次资料”中明确添加允许读取的文件或资料文件夹；不添加时，运行位置不会自动成为资料库；
4. 如果有必须遵守的限制或明确验收办法，再展开“任务要求（可选）”。不填写时，LocalBuddy 会使用“回应任务要求并形成可打开结果文件”的基础完成标准；
5. 普通任务不需要修改模型、确认方式、任务类型或并发。只有确有需要时才展开“高级设置”；
6. 点击“生成计划”后核对目标、资料范围与步骤，确认无误再点击“确认计划并开始”；
7. 执行时先看“当前进展”和任务步骤；需要操作时主界面会出现明确按钮；
8. 需要查看并行关系、模型/工具耗时或技术事件时，再展开“查看详细过程”；完成后可以查看、继续修改或开始新任务。

### 4.1 可选：给任务添加方法或连接

普通任务不需要设置这里，可以直接生成计划。只有想让任务遵循一套固定做法，或需要使用已经配置好的资料库、业务服务或本机工具时，才点击任务区的“方法与连接”：

1. “按固定方法完成”列出当前任务可用的做法，例如固定证据检查步骤或交付格式；
2. “使用其他服务或本机工具”列出已经配置好的连接；名称和说明先回答它能帮你做什么，不要求先理解技术协议；
3. 点击“添加”后，所选项目会以简短标签显示在任务区；点击标签上的 `×` 可以移除；切换运行位置时，旧位置的选择会被清空；
4. 添加连接不等于批准它改变外部内容。真正需要发送、创建、修改或删除时，LocalBuddy 会显示具体工具、参数摘要和影响，再由你逐次批准或拒绝；
5. 没有可用方法或连接不会阻塞普通任务。配置有误时，问题只在高级信息中显示，避免把维护者信息变成普通用户的必答题。

给维护者的边界：LocalBuddy 只检查当前运行位置的 `.localbuddy/skills` 和 `.localbuddy/mcp.json`，不会扫描其他文件夹、自动连接服务或自动执行发现的代码。Skill/MCP 标识、连接和认证类别、网页访问白名单都位于“高级：查看来源、网页访问和技术信息”。如果列表为空，需要由可信提供方按 [`M4-SPEC.md`](M4-SPEC.md) 创建本地配置；本版本不提供 Marketplace、远程下载或自动安装。

## 5. 使用 Coding 模式

Coding 工作区必须：

- 是 Git 仓库根目录；
- 有可解析的 `HEAD`；
- 主工作区干净；
- 已忽略 `.localbuddy/`。

Code Worker 只在 detached worktree 中修改授权路径。组合补丁通过预检后仍停在 `awaiting_approval`；必须阅读 inline diff，再决定仅应用、应用并提交或拒绝。LocalBuddy 不会把 Agent 判断当成人类批准。

Windows 当前没有受支持的本地进程隔离宿主，涉及检查命令或 stdio 进程的能力会 fail closed；不要把 Windows 包当成 Coding 全功能版本。

## 6. 中断、恢复与诊断

- 有可验证 checkpoint 时使用“恢复执行”，继续原 Run；
- 失败 Run 只在安全 checkpoint 可验证时恢复未完成 Task 链；已经完成的 Task 不会重跑；
- 已读取资料发生变化时 checkpoint 会阻止恢复；运行位置中的无关文件不会影响恢复；
- v1-v3 whole-workspace 历史 Run 必须新建 Run 并重新选择资料，不能按 v4 语义静默继续；
- 不要手动删除受保护的 worktree；在 Run 终态后使用界面的显式清理；
- 需要反馈问题时优先点击“报告问题”：应用会从当前 Run 自动生成不含 Prompt、正文、路径和原始错误的公开安全摘要/Trace；检查预览后点击一次“同意并在 GitHub 继续提交”。应用只打开预填表单，最终发布仍由用户完成。GitHub 不可用时可保存本地 Markdown；内部深度排障仍可另行导出脱敏诊断包。

已登记的有限文本 Artifact 可以在校验路径、大小和 SHA-256 后内嵌预览。“继续修改这份结果”只会把可审计引用预填到组合器，仍需用户检查并手工启动新 Run；不会自动发送 Artifact 正文。

自动化 Windows 灰度见 [`WINDOWS-GRAY.md`](WINDOWS-GRAY.md)，真人试用记录方式见 [`DOGFOOD.md`](DOGFOOD.md)。
