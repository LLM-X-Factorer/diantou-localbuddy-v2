# LocalBuddy V2 Known Limitations

> 当前公开版本是未签名的 `v0.13.1 / User-first Workflows` Engineering Alpha。`v0.13.0` 标签在安装版门禁中停止，没有 Release 或正式资产。`v0.13.1` 新增用户优先首次任务、工作状态投影和“方法与连接”目录，但没有改变真实 Provider、非作者用户、Windows 11、代码签名和 Office 格式真值边界。当前灰度与发布优先 Windows，macOS 保留本机回归，Linux 降为维护。未列为已验收的事项，不得通过宣传性措辞推导为已支持。

## Platform and distribution

- `v0.13.1` Tag workflow 已完成原生打包、安装版合成灰度、`v0.12.8 -> v0.13.1` 本地升级、profile 保留、五项资产和第一方公网升级；独立回下载 SHA-256 与 GitHub digest 一致。该门禁使用 Windows Server 2025 管理员 Runner，不能替代 Windows 11；
- `v0.12.4-v0.12.7` 内置的第三方公共更新服务在 `v0.12.7` 发布后连续十分钟返回 HTTP 404。旧版本无法由服务器改址，现有用户需要不卸载地手动覆盖安装 `v0.12.8` 一次；托管 Runner 已证明 `v0.12.8` 可发现和安装 `v0.13.1`，真实 Windows 11 仍待复验；
- 原生 Electron/Squirrel updater 不提供字节级下载事件；`v0.12.8` 只显示真实阶段、已等待时间和不确定进度动画，并提供固定官方下载页兜底，不宣称百分比、速度或剩余时间；
- Windows 没有受支持的本地进程隔离宿主，检查命令和本地进程型扩展 fail closed；
- Linux `0.11.x` DEB 历史上已由 `ubuntu-24.04` Runner 原生构建；当前 Linux 只保留每周/手动维护，不进入 PR 或 Release 门禁，真实图形桌面与 Secret Service 验收暂不优先；
- macOS 包是 ad-hoc 签名，未启用生产 Hardened Runtime，未 notarize；
- Windows 包未做代码签名，可能出现 SmartScreen 提示；
- Tag workflow 只发布 Windows x64 Setup/ZIP；Linux 与 macOS 不自动进入 GitHub Release。Windows Release 前运行安装版合成灰度；
- `windows-2025` 是 Windows Server 2025 管理员 Runner，不能覆盖 Windows 11 的 SmartScreen、Defender、标准用户/UAC、DPI、输入法、睡眠或企业代理；
- 运行时/生产依赖高危审计当前通过；开发期 Electron Forge 打包链仍被 `extract-zip <= 2.0.1` 的上游 symlink path traversal 公告命中，公告尚无修复版本。`0.13.1` 已在干净 Runner 上复查和隔离打包；公开 Engineering Alpha 继续跟踪稳定上游迁移；
- 平台无关的 Ed25519 更新协议仍只下载、验签并 staging；`v0.12.4` stable Windows Squirrel updater 已内置公开 feed，但仍没有静默安装、强制更新或自动回滚；
- `pnpm windows:canary` 只隔离 Electron user-data 和构建目录，不隔离系统 Credential Manager 或工作区 `.localbuddy/`；Canary 与稳定版不应同时写同一测试工作区；
- `v0.12.2` 没有内置线上 feed；`v0.12.4-v0.12.7` 依赖不稳定的第三方 feed。已有用户需要手动原地安装 `v0.12.8` 以切换到第一方 feed；不需要先卸载，托管发布门禁和 Windows 11 真人 OTA 仍分别验收；

## Storage and privacy

- Run Request、事件、checkpoint、Browser state 和 Artifact 保存在用户所选工作区的 `.localbuddy/runs/<run-id>/`，不是集中式加密数据库；Browser state 可包含 cookie/origin storage，Run checkpoint 可包含 Prompt、模型消息和工具结果；
- macOS/Linux 新写 Run 使用 `0700` 目录和 `0600` 文件；旧 Run 仅在获得工作区锁时修复已知状态树。Windows 继承父目录 ACL，当前不会替用户重写 ACL；
- 云同步/网络目录警告是已知路径启发式，不能识别所有同步、备份或企业策略。把 Run 放入 OneDrive/iCloud/Dropbox/共享盘可能使私有过程数据离开本机；
- 当前没有 Run 自动过期、自动删除、集中迁移或端到端加密。LocalBuddy 不会在升级时擅自移动或删除旧 Run；Storage Contract V2 由 [Issue #17](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/issues/17) 跟踪；
- 路径、权限、敏感字段和操作建议的完整真源见 [`STORAGE-AND-PRIVACY.md`](STORAGE-AND-PRIVACY.md)。
- Windows Release 仍未完成可信代码签名；公开下载和在线更新都可能触发 SmartScreen，不能称为面向普通用户的无摩擦安装；
- CI 的上一稳定版原地升级使用 Windows Server 2025 一次性管理员 Runner，只能证明安装器与 profile 保留合同，不能代替 Windows 11 真人升级。

## Product experience

- `v0.13.1` 首次任务只证明“单份 TXT/Markdown/DOCX 会议记录 → 受限可编辑 DOCX 纪要”这一纵向路径；合成新手和 loopback Provider 不能替代真实非技术用户或真实 DeepSeek/OpenAI。它不代表任意 Word、Excel、PPT 办公工作已经支持；
- “方法与连接”只读取工作区中两个固定位置的元数据，不自动安装、下载、连接或运行 Skill/MCP。真实第三方 MCP、OAuth 账户、远程 Marketplace 和普通用户如何获得扩展仍未完成产品验收；

- 公开问题报告不是后台遥测或自动上传：用户必须查看自动生成的安全预览，以“同意并在 GitHub 继续提交”明确确认，再在浏览器中登录 GitHub 并最终提交；不愿公开时可保存本地 Markdown；
- 报告只从结构化允许字段生成，不接收自由叙述，也不附带原始诊断、Prompt、Artifact、工具参数、Provider 配置、本机绝对路径或原始错误；自动分类仍可能不够具体，因此界面要求用户提交前复核；
- 产品仍以一次目标对应一个 Run；已发布的“基于此产物继续”会保存父 Artifact、Thread ID、版本和修改原因，但这只是 Research Artifact 的修订链，不是通用持久聊天线程；
- “指引与示例”是本地确定性导航，不是可自由问答或使用工具的 Guide Agent；
- 教程材料是合成内容，只有用户点击开始后的 Provider/Agent 执行才是真实 Run；
- 没有 Project/Workspace 首页、跨工作区统一搜索或 SQLite 投影；
- 已登记的文本和受限 DOCX Artifact 可在哈希/大小复核后预览；DOCX 内嵌的是正文/表格结构，不是分页渲染，视觉版式仍通过系统 Word/Pages/LibreOffice 打开检查；
- DOCX 只支持版本化段落、项目符号和表格生成/读取/修订；不支持任意 Word 文档保真编辑、图片、批注、修订痕迹、嵌入对象、宏、外部关系或复杂模板。PDF 解析、语义索引/RAG、XLSX 和 PPTX 尚未支持；
- 独立语义 Reviewer 当前只保护 Research DOCX，候选正文和修订父正文各上限 80,000 字符、Worker 结果合计上限 40,000 字符；Markdown/JSON/TXT、Coding patch、人工 override、分块长文 Review 和跨模型合判尚未支持；
- Artifact Revision 当前按“保守修改父稿”处理：长父稿至少保留 50% 正文和 80% 段落，章节、表格和表格行不得减少。还没有用户可选的 replace 模式；确需大幅删减或完全改写时应新建 Artifact；
- 一条 8 份明确资料的真实 DeepSeek Research Desk 首版与窄修订已在 macOS 开发应用完成。最终 V5 为 12,002 bytes、8,428 字符、99 个段落、6 章、1 个 8 行表格和 7/7 正确原始 URL，并由 Pages 接受打开；运行使用 12 次模型调用、132,995 provider-reported tokens，仍经历两次父版本保留退回和一次 80-block 编译上限。它证明该纵向案例可达，不证明三次连续首轮通过、打包版本质量或通用复杂 Word 修订；
- Research 本地资料目前最多显式选择 50 个根；目录发现只搜索文件名，不做持久正文索引；单次搜索最多返回 50 条并检查 10,000 个目录项；单文件 UTF-8 读取上限为 200,000 bytes。受限 DOCX 可单文件读取或有界正文搜索，但仍受安全解包、5 MB 压缩包和 120,000 字符正文上限；
- v1-v3 whole-workspace Research Run 不会自动转换为 v4 explicit-sources checkpoint。用户必须新建 Run 并重新选择资料；
- M11.1 可以在 Worker 前查看并批准/拒绝计划，但不能直接编辑计划、带理由退回重规划或在运行中动态 steering；失败 Run 只能从安全 checkpoint 恢复未完成 Task 链，不支持任意单 Task 手工重跑；
- Desktop 的 Plan Review 发生在 Orchestrator 规划调用之后，因此即使用户拒绝计划，仍会产生一次规划模型调用；CLI/Core 非交互入口默认跳过此 Gate；
- Goal Contract 当前固定为 revision 1，没有 append-only 目标修订、资料/权限漂移 replan 或通用跨 Run Thread；Artifact Revision 不能替代 Goal revision；
- Desktop 只展示单 Run 的调用、Provider token、耗时和失败投影，没有币种成本换算、跨 Run 聚合或趋势阈值。
- WorkBuddy 产品能力基准目前完成六题协议、合成夹具和 WB-02 确定性 pilot。真实 DeepSeek 两轮实跑当前为 2 次接受、1 次失败、1 次因 grader 缺陷无法定论，尚未形成三次连续稳定通过；这些运行早于独立 Reviewer，不能事后改写为 Reviewer 通过。WorkBuddy 客户端黑盒与 LocalBuddy 六题正式实跑也未完成，不能据此宣称产品能力已对标。LocalBuddy 仍缺少 XLSX/PPTX、完整分支图、通用 DOCX 保真编辑和跨 Artifact Reviewer；

## Extensions and external services

- Provider “验证连接”只证明当时对 `/models` 的网络与认证响应，不证明模型生成、工具调用、配额、账单或后续稳定性；
- 自定义 Base URL 会接收用户主动发起的验证和真实 Run 凭据；界面不替用户判断第三方端点是否可信；
- 环境变量凭据优先于系统凭据，应用只能显示其存在，不能删除或修改父进程提供的环境变量；
- MCP OAuth 2.1 已完成本地协议验收，但尚未对指定第三方生产服务和真实账户验收；
- 签名 Skill 的信任、锁定和撤销已实现，但没有远程 Skill 市场或自动同步；
- Browser 只允许显式 origin，动作逐次审批；它不是通用无人值守浏览器自动化；
- `automation` 信任档始终拒绝外部副作用，不提供绕过人工 Gate 的开关。

## Recovery and data

- checkpoint 恢复的是本地消息、工具和控制器边界，不是 Provider 侧的远程进程；`model_inflight` 可能重新发起一次模型请求；
- 工作区、工具合同、Provider/扩展合同或 Coding worktree 漂移会阻断自动恢复；
- JSONL、Request、checkpoint 和 Artifact 保存在工作区 `.localbuddy/`，目前没有云备份、跨设备同步或团队权限；
- Event Store 不保存模型正文和工具参数，但 `run-request.json`、checkpoint 与 Artifact 仍可能包含私有业务内容，必须留在本机。

## Explicitly deferred

- Apple Developer ID、生产 Hardened Runtime entitlements、notarization、stapling 和公开 Gatekeeper；
- Windows 正式代码签名与发布信誉；
- 团队账号、云同步、远程 Skill 市场、生产更新源和公开自动更新。

后续候选与外部门禁见 [`ROADMAP.md`](ROADMAP.md)。
