# LocalBuddy V2 Known Limitations

> 分发基线仍是私有 `v0.12.2 / Windows Canary + Safe Updates` Engineering Alpha Release；M12.1-M12.4 与公开 GitHub stable feed 属于未发布的 `0.12.3` 本地源码候选。当前灰度与发布优先 Windows，macOS 保留本机回归，Linux降为维护。未列为已验收的事项，不得通过宣传性措辞推导为已支持。

## Platform and distribution

- Windows `v0.12.2` Setup/ZIP/full nupkg/RELEASES 已通过 Tag workflow 的原生打包、安装版合成灰度、`v0.12.1 -> v0.12.2` 原地升级、profile 保留和回下载 SHA-256 校验并发布。该门禁使用 Windows Server 2025 管理员 Runner 和确定性 Mock Provider，仍不覆盖终端用户设备上的 SmartScreen、标准用户/UAC、真实 Provider 与真实网络；
- Windows 没有受支持的本地进程隔离宿主，检查命令和本地进程型扩展 fail closed；
- Linux `0.11.x` DEB 历史上已由 `ubuntu-24.04` Runner 原生构建；当前 Linux 只保留每周/手动维护，不进入 PR 或 Release 门禁，真实图形桌面与 Secret Service 验收暂不优先；
- macOS 包是 ad-hoc 签名，未启用生产 Hardened Runtime，未 notarize；
- Windows 包未做代码签名，可能出现 SmartScreen 提示；
- Tag workflow 只发布 Windows x64 Setup/ZIP；Linux 与 macOS 不自动进入 GitHub Release。Windows Release 前运行安装版合成灰度；
- `windows-2025` 是 Windows Server 2025 管理员 Runner，不能覆盖 Windows 11 的 SmartScreen、Defender、标准用户/UAC、DPI、输入法、睡眠或企业代理；
- 运行时/生产依赖高危审计当前通过；开发期 Electron Forge 打包链仍被 `extract-zip <= 2.0.1` 的上游 symlink path traversal 公告命中，公告尚无修复版本。`0.12.2` Tag 前已复查并继续在干净 Runner 上隔离打包；private Engineering Alpha 跟踪稳定上游迁移；
- 平台无关的 Ed25519 更新协议仍只下载、验签并 staging；Windows Squirrel updater 只有显式配置 feed 时才启用，当前没有生产 feed、静默安装或自动回滚；
- `pnpm windows:canary` 只隔离 Electron user-data 和构建目录，不隔离系统 Credential Manager 或工作区 `.localbuddy/`；Canary 与稳定版不应同时写同一测试工作区；
- `v0.12.2` 没有内置线上 feed，已有用户仍需手动原地安装一次 `v0.12.3` 桥接版；源码中的公开 feed 合同尚未经过 GitHub endpoint 和 Windows 11 OTA 验收；
- Windows Release 仍未完成可信代码签名；公开下载和在线更新都可能触发 SmartScreen，不能称为面向普通用户的无摩擦安装；
- CI 的上一稳定版原地升级使用 Windows Server 2025 一次性管理员 Runner，只能证明安装器与 profile 保留合同，不能代替 Windows 11 真人升级。

## Product experience

- 产品仍以一次目标对应一个 Run；本地候选已让“基于此产物继续”保存父 Artifact、Thread ID、版本和修改原因，但这只是 Research 文本 Artifact 的修订链，不是通用持久聊天线程；
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
