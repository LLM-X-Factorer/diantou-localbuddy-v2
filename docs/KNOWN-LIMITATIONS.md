# LocalBuddy V2 0.12.2 Candidate Known Limitations

> 当前正式私有 Release 是 `v0.12.1`；本文同时覆盖源码中的 `0.12.2` Windows 更新候选。当前灰度与发布优先 Windows，macOS 保留本机回归，Linux 降为维护。未列为已验收的事项，不得通过宣传性措辞推导为已支持。

## Platform and distribution

- Windows `v0.12.1` Setup/ZIP 已通过 Tag workflow 的原生打包、安装版合成灰度和回下载校验并发布。该门禁使用 Windows Server 2025 管理员 Runner 和确定性 Mock Provider，仍不覆盖终端用户设备上的 SmartScreen、标准用户/UAC、真实 Provider 与真实网络；
- Windows 没有受支持的本地进程隔离宿主，检查命令和本地进程型扩展 fail closed；
- Linux `0.11.x` DEB 历史上已由 `ubuntu-24.04` Runner 原生构建；当前 Linux 只保留每周/手动维护，不进入 PR 或 Release 门禁，真实图形桌面与 Secret Service 验收暂不优先；
- macOS 包是 ad-hoc 签名，未启用生产 Hardened Runtime，未 notarize；
- Windows 包未做代码签名，可能出现 SmartScreen 提示；
- Tag workflow 只发布 Windows x64 Setup/ZIP；Linux 与 macOS 不自动进入 GitHub Release。Windows Release 前运行安装版合成灰度；
- `windows-2025` 是 Windows Server 2025 管理员 Runner，不能覆盖 Windows 11 的 SmartScreen、Defender、标准用户/UAC、DPI、输入法、睡眠或企业代理；
- 运行时/生产依赖高危审计当前通过；开发期 Electron Forge 打包链仍被 `extract-zip <= 2.0.1` 的上游 symlink path traversal 公告命中，公告尚无修复版本。`0.12.1` Tag 前已复查并继续在干净 Runner 上隔离打包；private Engineering Alpha 跟踪稳定上游迁移；
- 平台无关的 Ed25519 更新协议仍只下载、验签并 staging；Windows Squirrel updater 只有显式配置 feed 时才启用，当前没有生产 feed、静默安装或自动回滚；
- `pnpm windows:canary` 只隔离 Electron user-data 和构建目录，不隔离系统 Credential Manager 或工作区 `.localbuddy/`；Canary 与稳定版不应同时写同一测试工作区；
- CI 的上一稳定版原地升级使用 Windows Server 2025 一次性管理员 Runner，只能证明安装器与 profile 保留合同，不能代替 Windows 11 真人升级。

## Product experience

- 产品仍以一次目标对应一个 Run；“基于此产物继续”只显式预填一个新 Run，不是持久聊天线程；
- “指引与示例”是本地确定性导航，不是可自由问答或使用工具的 Guide Agent；
- 教程材料是合成内容，只有用户点击开始后的 Provider/Agent 执行才是真实 Run；
- 没有 Project/Workspace 首页、跨工作区统一搜索或 SQLite 投影；
- 已登记的有限文本 Artifact 可在哈希/大小复核后内嵌预览；PDF/DOCX、超限文件和通用编辑仍依赖外部应用；
- 没有通用附件上传、PDF/DOCX 解析或语义索引/RAG；
- Research 本地资料目前最多显式选择 50 个根；目录发现只搜索文件名，不做正文索引；单次搜索最多返回 50 条并检查 10,000 个目录项；单文件 UTF-8 读取上限为 200,000 bytes；
- v1-v3 whole-workspace Research Run 不会自动转换为 v4 explicit-sources checkpoint。用户必须新建 Run 并重新选择资料；
- M11.1 可以在 Worker 前查看并批准/拒绝计划，但不能直接编辑计划、带理由退回重规划或在运行中动态 steering；失败 Run 只能从安全 checkpoint 恢复未完成 Task 链，不支持任意单 Task 手工重跑；
- Desktop 的 Plan Review 发生在 Orchestrator 规划调用之后，因此即使用户拒绝计划，仍会产生一次规划模型调用；CLI/Core 非交互入口默认跳过此 Gate；
- Goal Contract 当前固定为 revision 1，没有 append-only 目标修订、资料/权限漂移 replan 或跨 Run Thread；
- Desktop 只展示单 Run 的调用、Provider token、耗时和失败投影，没有币种成本换算、跨 Run 聚合或趋势阈值。

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
