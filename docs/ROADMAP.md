# LocalBuddy V2 Roadmap after M10.4

> **状态真源**：2026-08-14。当前私有 Release 为 `v0.11.2 / M10.4 Explicit Research Sources Engineering Alpha`。后续灰度与发布保持 Windows-first，Linux 只做每周/手动维护。阶段内证据以对应 Validation 和 [`WINDOWS-GRAY.md`](WINDOWS-GRAY.md) 为准。

## 当前里程碑

### v0.11.2 · M10.4 Explicit Research Sources — private Engineering Alpha

- Research 的运行记录位置不再自动成为模型资料库；
- 用户按 Run 明确添加文件或资料目录，Planner/Worker 只看到逻辑 source ID，不看到绝对路径或整个运行目录清单；
- 未选资料时不注册本地搜索/读取工具；选中资料目录后只在非空文件名查询时按需搜索，并使用有界结果/遍历预算；
- checkpoint 保存明确 source identity，只复核成功读取过的文件 SHA-256；无关文件和缓存不再阻断恢复；
- v1-v3 whole-workspace Research checkpoint 和 replay fail closed，不在新语义下静默继续；
- 自动门禁为 138 项，本机 136 passed、2 项 Windows-only 合同按平台跳过、0 failed；1,050 个无关文件的失败 Run resume 回归通过；
- macOS `0.11.2` DMG/ZIP 已通过版本、DMG 完整性、ad-hoc 签名、14 个相对 symlink、Fuse、ASAR、内置浏览器和 Renderer smoke；最终打包 App 的资料选择 UI 与原生文件面板已完成实际 GUI 读回；
- Windows `v0.11.2` Tag Release 已通过原生构建、安装版合成灰度、恢复/重启矩阵和资产回下载核验；Windows 11 真人灰度、真实 Provider v4 Run 和连续 dogfood 仍是独立门禁，不能由托管 Runner 或 macOS unit/package 证据替代。

规格与本机证据见 [`M3.4-SPEC.md`](M3.4-SPEC.md) 和 [`M10.4-VALIDATION.md`](M10.4-VALIDATION.md)。

### v0.11.1 · M10.3 Provider Setup — private Engineering Alpha

- Provider 成为侧边栏一级设置，不再藏在 Skills/MCP/Browser 扩展折叠区；
- DeepSeek/OpenAI 独立显示环境变量、系统安全存储或未配置状态，Renderer 不接收 secret；
- 支持安全保存、替换和经原生确认删除系统凭据；环境变量保持进程级优先级且不能从应用删除；
- 保存只验证本机写入，不自动联网；显式“验证连接”只请求 Provider 的 `/models`，不调用生成接口；
- 当前 Run 的 model/base URL 归入 Provider 高级设置，Base URL 继续限制为 HTTPS 或 loopback HTTP；
- Composer 就近显示状态，凭据缺失时阻止真实 Run 并直达配置；
- Composer 已改为紧凑的“任务输入 + 控制工具栏”，扩展只在显式展开时占用额外空间；
- 当前自动合同为 123 项，本机结果 121 passed、2 项 Windows-only 合同按平台跳过；macOS `0.11.1` DMG/ZIP 已通过版本、签名、Fuse、ASAR、浏览器、Renderer 和挂载后完整性验证，并安装到 `/Applications/LocalBuddy.app`；
- 已安装应用通过真实 GUI 验收：独立入口、来源状态、显式验证文案、未配置 Provider 启动门禁，以及 Composer 收起/扩展布局均可见；
- Windows Setup 文件名、Linux `libsecret-tools` 依赖和两个平台的 Provider 合同均由 `0.11.1` 真源约束；
- Tag Release 改为 Windows-only：必须通过生产依赖审计、全量测试、安装版合成灰度和 SHA-256 后才发布 Setup/ZIP；Linux 不再阻塞 Windows RC；
- Windows 发布作业强制通过生产依赖高危审计；开发期 Forge 打包链的上游 `extract-zip` 告警已在 Tag 前复查，当前稳定 Forge 仍无修复，本次 private Engineering Alpha 已记录接受该打包期风险；
- macOS 包已通过全新用户数据、无 Provider 凭据首次启动 smoke；[`windows-2025` PR run `31665000997`](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/actions/runs/31665000997) 还运行真实 Setup、从版本化安装目录在隔离用户数据与无 Provider 凭据条件下启动，并回下载核对截图与 JSON，最后调用 Squirrel 卸载；
- [PR #1](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/pull/1) 已以 `09c7be6` 合入 `main`；最终 PR 门禁与 `main` CI 均为绿色。[`v0.11.1` Release Gate `31675334513`](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/actions/runs/31675334513) 在固定 Tag 上完成完整 Windows 合成灰度并发布 Setup/ZIP；三个资产已回下载完成 SHA-256、字节数和 LF 清单核验。

M10.3 不改变 Provider 调用协议、Run 审计合同或外部副作用审批边界；它解决的是必要配置的可发现性、可判断性和安全生命周期。M11 仍未立项。

### v0.11.0 · M10.2 First Trusted Run — private Engineering Alpha

- 首次启动提供完全本地、永久可返回的指引会话，不依赖 Provider；
- 工作区、Git、凭据可用性和人工控制边界在真实 Run 前可见；
- 合成教程工作区只在明确点击后创建，采用唯一目录且不覆盖旧文件；
- 教程/研究/Coding 模板只预填，绝不自动读取、调用模型或启动任务；
- 真实 Run 上下文提示由审计状态驱动，不生成假 Run 或污染历史指标；
- 首次安装不再默认选择整个 Documents；切换工作区清空旧目标；
- 自动门禁为 113/113 tests；macOS `0.11.0` DMG 已完成挂载后包验证并安装到 `/Applications/LocalBuddy.app`；`main` CI 的 macOS、Linux、Windows 五项作业全部通过；
- annotated `v0.11.0` Tag 已固定在发布提交 `e09dd5c`，Windows Setup/ZIP 已由原生 workflow 发布到私有 Release，并完成回下载 SHA-256、字节数和 LF 清单核验；
- 连续 7-14 天真实使用、Windows 真机、Linux 图形桌面和生产 MCP OAuth 仍是开放门禁。

`v0.11.0` 的 Windows 原生构建与私有发布门禁已通过；Windows 真机端到端门禁仍开放。该版本没有静默替换 `v0.9.0` 资产。M11 尚未立项。

### 0.10.0 · M10.1 Internal Dogfood — completed locally; superseded by M10.2

- 首轮 macOS 安装与完整功能矩阵已完成；
- 诊断导出、MCP stdio 失败可诊断性、Run 成本/失败投影和 Artifact Gate 反馈已补齐；
- 最近工作区、校验后的文本 Artifact 内嵌预览和显式继续工作流已补齐；
- 失败 Run 可从同一安全 checkpoint 只恢复未完成 Task 链；
- Coding 的 UI commit 与 reverse commit 已在一次性仓库完成实测，主工作区最终干净；
- 自动门禁为 109/109 tests；macOS `0.10.0` DMG 已完成挂载后包验证并安装到 `/Applications/LocalBuddy.app`；
- 连续 7-14 天真实使用、Windows 真机、Linux 图形桌面和生产 MCP OAuth 仍是开放门禁。

`0.10.0` 保留为 M10.1 本机验证基线，没有创建 GitHub Release。

### v0.9.0 · M10 Engineering Alpha — released; superseded for local dogfood

- M0-M7：并发运行时、Headless/Desktop、Coding worktree、人工集成、恢复、扩展、安全执行和跨进程协调已完成代码与确定性验收；
- M8：MCP OAuth 2.1 已完成本地协议与 loopback 夹具验收，生产服务验收待外部账户；
- M9：更新清单、平台适配和签名 Skill 供应链已完成本地可证明范围；
- M10：Desktop Provider/信任设置、inline diff、脱敏诊断和内部打包已完成；
- macOS ad-hoc ZIP/DMG 已完成本机包与 Renderer 烟测；
- Linux DEB、Windows Setup/ZIP 已在 GitHub 原生 Runner 构建，Windows `v0.9.0` 已发布到私有 Release；
- 连续真实任务 dogfooding 尚未开始，状态和退出口径以 [`DOGFOOD.md`](DOGFOOD.md) 为准；
- Windows 真机安装、启动、凭证、真实 Provider Run、恢复和卸载尚未验收，等待设备。

`v0.9.0` 已冻结，不再接收新功能，也不会静默替换既有 Release 资产。

## 已完成路线

### M6 · Safe Execution + Unified Trust — completed

- macOS Seatbelt、Linux 固定容器执行宿主、默认断网、资源限制和进程树取消；
- 七类权限与 `strict` / `balanced` / `automation` 信任档；
- Windows 没有受支持执行宿主时，本地进程型工具 fail closed。

### M7 · Recovery + Coordination — completed

- CLI 同 Run checkpoint resume；
- 已提交 Integration 的 revert commit 与 preview Merge Agent；
- 跨进程、跨工作区 Task/Provider 容量、限速和预算账本。

### M8 · MCP OAuth 2.1 — completed locally; production acceptance pending

- Metadata discovery、Authorization Code + PKCE、loopback/state；
- 动态注册、refresh、revoke、resource binding；
- 每服务端点/Server/账户凭证隔离，token 不进入配置、事件或 checkpoint。

### M9 · Distribution Protocol + Platforms + Skill Supply Chain — completed locally and on native runners

- Ed25519 更新清单、哈希/版本/回滚保护和 download-to-staging；
- Windows/Linux 路径、凭证、进程、锁与打包适配；
- Skill 发布者信任、版本锁、权限、签名和撤销。

### M10 · Dogfooding + Productization — implementation complete; dogfood validation open

- Desktop Provider model/base URL 与系统凭证写入；
- 持久化 Run 信任档，resume/replay 固定复用；
- 哈希校验的 Integration inline diff；
- 省略 Prompt、目标、工具参数、凭证和绝对路径的诊断导出；
- macOS 本机包复验、Linux/Windows 原生 Runner 构建和 Windows Tag Release。

上述事实证明产品已具备 dogfooding 条件，不证明连续真实业务使用已经通过。

### M10.1 · Local Dogfood Closure — completed locally; continuous validation open

- 关闭首轮实机 dogfood 暴露的包完整性、锁竞态和跨 Agent 计算复用缺陷；
- 让失败诊断、运行指标、Artifact 重试和安全 checkpoint 恢复进入可见产品界面；
- 增加最近工作区、已校验文本 Artifact 预览和显式继续入口；
- 完成已安装应用下的 Coding commit/reverse-commit 纵向验证；
- 保持单 Run、人工 Integration Gate、外部副作用审批和本地隐私边界不变。

本里程碑的确定性与单次实机闭环已经完成；连续使用门禁仍由 [`DOGFOOD.md`](DOGFOOD.md) 管理。

### M10.2 · First Trusted Run — completed locally; continuous validation open

- 把首次体验目标从“看完教程”定义为“完成第一次可信真实 Run”；
- 指引采用本地确定性状态机，不伪装成 AI Agent，不进入普通 Run 历史；
- 能力按输入、结果和人工控制点展示，而不是要求用户先理解内部术语；
- 教程工作区、Provider readiness、模板预填和真实状态提示形成纵向闭环；
- 保持每次真实执行显式启动、每次外部副作用独立审批和每次代码写回人工 Gate。

规格与本机证据见 [`M10.2-SPEC.md`](M10.2-SPEC.md) 和 [`M10.2-VALIDATION.md`](M10.2-VALIDATION.md)。

### M10.3 · Provider Setup — private Engineering Alpha released

- Provider 从扩展概念中拆出，成为真实 Run 的显式必要前置；
- 凭据管理覆盖状态、保存、替换、删除和按需连接验证；
- 缺失状态、Composer 就近反馈与启动前拦截形成闭环；
- Composer 已收敛为紧凑输入与可换行工具栏，不再用大栅格承载少量设置；
- 连接检查是用户触发的认证/网络探针，不等价于真实生成 Run；
- 保持 Key 不进 Renderer 持久状态、不进 Run/事件/checkpoint/诊断的既有边界。
- Windows Setup/ZIP 使用 `package.json` 版本真源并进入 Windows-first 发布门禁；Linux DEB 仍声明 Secret Service CLI 依赖，但只做低频维护。
- GitHub 托管 `windows-2025` Runner 已持续化验证无 Provider 首启，并用公开 loopback 夹具覆盖 Windows Credential Manager、安装版 Research Run、双 Run 取消、硬退出恢复和重启持久化，不再依赖固定 Windows 测试机；终端用户 Windows 11、SmartScreen、标准用户/UAC、真实 Provider 与真实网络仍属于独立外部门禁。

规格与本机证据见 [`M10.3-SPEC.md`](M10.3-SPEC.md) 和 [`M10.3-VALIDATION.md`](M10.3-VALIDATION.md)。

### M10.4 · Explicit Research Sources — private Engineering Alpha released

- 运行位置与资料输入成为两个明确产品对象；
- Research 资料读取使用逻辑引用、路径约束和按需发现，不把整个目录树塞给 Planner；
- checkpoint 从“复制工作区身份”改为“复核真正使用过的证据”；
- 历史旧合同 fail closed，避免在用户不知情时改变证据语义；
- 保留所有模型和工具动作的可审计事件，不把本地隐私路径暴露给模型。

本机与 Windows-first 托管发布门禁均已完成；持续真实任务和终端 Windows 11 验证仍以 [`M10.4-VALIDATION.md`](M10.4-VALIDATION.md) 为准。

## 外部门禁与明确暂缓

以下条件没有被本地测试或 CI 替代：

1. Windows 11 真人灰度：托管 Runner 只能先关闭自动化边界，SmartScreen、Defender、UAC、DPI、输入法与真实网络仍需 3-10 名内部用户；
2. 生产 MCP OAuth：等待指定真实服务与账户；
3. 正式 Apple Developer ID、生产 Hardened Runtime entitlements、notarization 和公开 Gatekeeper：明确暂缓；
4. Windows 代码签名与 SmartScreen 信誉：公开分发前再决策；
5. Linux 图形桌面安装/启动验收：当前降为非优先，不阻塞 Windows 灰度和 Release。

## 下一阶段候选，尚未立项

M11 的正式范围必须同时由连续 dogfooding 和 [`CODEX-BENCHMARK-2026-08-14.md`](CODEX-BENCHMARK-2026-08-14.md) 的本地差距验证产生。当前 P0 候选是：

- Goal Contract：结果、约束、验证标准、资料集与 append-only 修订；
- 启动前计划审阅，以及资料/权限变化时的显式 replan Gate；
- 可检查和可 steering 的 Agent Session：阶段、预算、蒸馏结果、中断/追问/重试；
- 独立只读 Reviewer/Critic：Artifact/patch 发现、退回、接受或带理由 override；
- 基于现有 JSONL trace 的版本化 Eval 数据集和 deterministic graders。

P1 候选是 Project/Thread/Run 分层、Project 资料集合但 Run 精确选集、Coding 前后台 Handoff/可恢复清理，以及可发现的 Skills/Plugins 权限卡。PDF/DOCX 摄取、非纯文本 Artifact 预览和跨 Run 趋势可按真实需求进入相邻增量。

本地 Memory、Record-and-Replay 与 scheduled/background tasks 属于 P2。它们必须在 Goal、Review、Eval、通知/待处理入口和最小权限模型成熟后再立项；不能为了功能对标提前开放无人值守副作用。

远程 Skill 市场、云同步、团队账号、无人值守外部副作用和完全自动更新不属于已批准的 M11 范围。

## 里程碑完成口径

每个里程碑必须分别记录：

1. 代码和确定性测试；
2. 当前主机上的真实运行；
3. 目标平台原生 Runner 的合同与产物；
4. 真实设备、真实第三方服务或发布身份才能证明的外部验收。

第 4 类条件未具备时必须明确标记为未验收，不能用 mock、静态配置、CI 打包或生成了安装文件来代替。
