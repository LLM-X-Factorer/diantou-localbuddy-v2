# LocalBuddy V2 Roadmap

> **状态真源**：2026-08-16。仓库已按 Apache License 2.0 公开；当前 Release 为公开但未签名的 `v0.12.4 / Product Truth + Public Update Bridge` Engineering Alpha，包含 M12.1-M12.4 产品能力和 stable Windows 公共 GitHub feed。当前开发阶段转入 `M13 Product Truth Sprint`：默认冻结功能扩张，以 Research Desk 的重复真实任务、非作者用户和目标应用证据决定 `advance/pause/stop`。代码签名、Windows 11 真人和 `v0.12.4 -> 后续稳定版` 应用内更新仍开放。

## 当前里程碑

### M13 · Product Truth Sprint — active

- `v0.12.4` 作为固定产品事实基线，不边验证边增加通用功能；
- Research Desk 使用同一合同三跑、两个不同主题和至少一次非作者独立运行；
- Teaching Studio 只做 Owner/真实教学单元发现、现有能力模拟和教师口头走查；Builder Lab 只跑 WB-05 泛化检查；
- 只修安全/数据完整性问题、真实任务阻塞、两个场景共同需要的 Core 合同，以及证据/grader 真源问题；
- 验收合同与退出裁决见 [`M13-PRODUCT-TRUTH-SPRINT.md`](M13-PRODUCT-TRUTH-SPRINT.md)。

### v0.12.4 · Product Truth + Public Update Bridge — public unsigned Engineering Alpha

- stable Windows 包固定接入 Electron 官方公开 GitHub Release feed，不再要求普通用户设置环境变量；
- Canary、beta、dev、非 Windows 和 unpackaged 构建不接稳定 feed；安全的显式 feed 仍只用于安装验收；
- Tag workflow 已发布并回下载核验五项 Windows 资产；公开 updater endpoint 已返回精确的 `v0.12.4` Setup 地址；`v0.12.2` 用户仍需手动原地安装一次 `v0.12.4` 桥接版；
- 仓库历史与发布提交凭证扫描通过，Apache-2.0、历史作者邮箱/本机路径接受和公开可见性已关闭；Windows 代码签名仍开放；
- 发布流水线的后置线上冒烟因检查错把 full nupkg 当作 JSON 响应、且缓存等待少 42 秒而标红；Release 本身有效，后续 workflow 已改为精确核对 Setup JSON 并等待十分钟；
- 只有真实 Windows 11 从桥接版升级到后续稳定版并保留 profile 后，才进入真实用户连跑。

### v0.12.2 · Windows Canary + Safe Updates — public unsigned Engineering Alpha

- 日常 Windows 开发改用按成功 CI、Git SHA 和唯一 Canary 版本同步的便携包，不覆盖稳定版，也不要求每次卸载重装；
- `main` 与 Tag Release 分别验证干净安装和 `上一稳定版 -> 当前目标版` 原地升级，profile 保留与新 UI 版本都必须读回；
- Desktop 加入可配置 Squirrel updater，但默认关闭；用户手动检查，下载后需确认，Run 启动/执行和 Integration 写回期间禁止退出安装；
- Release 已从 Setup/ZIP 扩展为同时发布 `RELEASES` 和 full `.nupkg`；生产 feed、代码签名与 Windows 11 真人升级尚未完成。

设计与开放证据见 [`WINDOWS-UPDATES.md`](WINDOWS-UPDATES.md) 和 [`WINDOWS-UPDATE-VALIDATION.md`](WINDOWS-UPDATE-VALIDATION.md)。该增量是交付/测试闭环，不改变 M11 Agent Session、Reviewer 或 Eval 的产品优先级。

## 历史里程碑

### v0.12.3 · failed Tag, not released

- annotated Tag 固定指向 `3fbcbf3abb1e45aac4fd9ac80cd7df24d1d68b14`，不移动、不复用；
- Release Gate `31878639876` 在 `pnpm check` 阶段因测试收到终态后过早删除 Windows `runtime-lock` 临时目录而失败，停止于打包和发布前；
- 没有创建 GitHub Release 或发布任何资产；终态事件与运行锁清理的契约修复转入 `v0.12.4`。

### v0.12.1 · M11.1 Goal Contract + Plan Review — private Engineering Alpha

- Desktop 将自由文本目标拆为 outcome、constraints 和 verification criteria，并以 Run Request v5 持久化；
- Orchestrator 计划生成后进入 `awaiting_plan_approval`，页面显示 Goal、范围、Worker 任务、owned paths、整合产物和检查命令；
- 批准前 Research/Coding Worker 均不启动，Coding worktree 不创建；拒绝计划会结束 Run；
- Goal、计划和 Run scope 由审批指纹绑定；pending 与 approved 状态可跨应用重启和 same-Run resume；
- CLI/Core 保持非交互兼容，旧单段 goal 和 v1-v4 checkpoint 身份不变；
- 本机 `pnpm check` 为 152 项：150 passed、2 项 Windows-only 合同按平台跳过、0 failed；macOS 源码 UI 与最终 App 合成灰度均已实际读回；
- macOS `0.12.1` DMG/ZIP、包完整性、无凭据首启和最终 App 回环合成灰度已通过；Windows 原生 CI、安装版灰度、Tag Release 和资产回下载也已通过。

规格与本机证据见 [`M11.1-SPEC.md`](M11.1-SPEC.md) 和 [`M11.1-VALIDATION.md`](M11.1-VALIDATION.md)。本增量不包含计划编辑、Goal revision 2+、steering、独立 Reviewer 或完整 Eval 系统。

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

## 产品能力基准与下一阶段

[`WORKBUDDY-PRODUCT-BENCHMARK-2026-08-15.md`](WORKBUDDY-PRODUCT-BENCHMARK-2026-08-15.md) 把外部公开承诺转成六个固定真实任务、统一评分、硬失败条件和可物化合成夹具。WB-02 真实 DeepSeek 当前有 2 次接受、1 次失败和 1 次因 grader 缺陷无法定论，尚未达到三次连续稳定通过；WorkBuddy 黑盒和 LocalBuddy 其余五题正式实跑也未完成，因此不能宣称已经达到产品能力对标。

[`PRODUCT-DEFINITION-V2.md`](PRODUCT-DEFINITION-V2.md) 进一步把下一阶段定义为“可信本地工作台 + 可验证场景产品包”。六个黄金任务继续验证公共能力和用户结果，但不再被解释为六个产品；WB-02 也只是 Artifact/Research 链路的一条探针，不能单独接管产品路线。当前首批候选为 Research Desk、Teaching Studio 和 Builder Lab，必须先通过命名用户、重复 Job、场景合同、真实 Provider、目标应用和多任务/用户 dogfood 门禁，再决定实现扩张。

[`PRODUCT-PORTFOLIO-DECISION-2026-08-15.md`](PRODUCT-PORTFOLIO-DECISION-2026-08-15.md) 已把三个候选从平级清单改为有资源顺序的 L0 组合：Research Desk 是当前切入口，Teaching Studio 是教育旗舰假设并先做教师发现，Builder Lab 只承担跨场景基准与开发教学资产。当前不创建三个并行产品实现项目。

M11.1 已完成 Goal Contract revision 1 和 approve/reject Plan Review。M12.4 再完成独立 DOCX Reviewer 与脱敏 trace 的第一条纵向切片；Goal revision 2+、可 steering 的 Agent Session、跨 Artifact Reviewer 和可直接执行的 trace graders 仍然重要，但不再单独构成下一阶段的用户价值叙事。它们要服务于可见的办公结果和连续修改闭环。

### M12.1 · Artifact Workbench + Threaded Revision — first slice implemented locally

第一切片已把“基于此产物继续”升级为显式 Artifact Revision：Run Request v6 保存父身份、Thread、版本和修改原因；父文件在 Provider 调用前复核并复制为新 Run 的只读 Research Source 快照；Desktop 显示版本关系和上一版入口。父产物篡改会 fail closed，失败修订 replay 会重新复核父产物并保持版本身份，旧 Run Request 继续兼容读取。规格与本机证据见 [`M12.1-SPEC.md`](M12.1-SPEC.md) 和 [`M12.1-VALIDATION.md`](M12.1-VALIDATION.md)。

### M12.2 · Artifact Thread History + Verified Text Diff — second slice implemented locally

第二切片已按 Thread 汇总 V1、后续 revision、失败/replay 和同版分支尝试；历史 Artifact 逐个复核，漂移项保留但标为不可用。当前文本 Artifact 可与直接父版本做有界本机 diff，V3 缺父合同、Thread 冲突或父 SHA 漂移都会 fail closed。规格与证据见 [`M12.2-SPEC.md`](M12.2-SPEC.md) 和 [`M12.2-VALIDATION.md`](M12.2-VALIDATION.md)。

### M12.3 · Bounded DOCX Artifact + WB-02 pilot — third slice implemented locally

第三切片把 `.docx` 从文件名承诺变成受限但完整的产品链路：模型提交有界 Markdown 内容，本地编译器解析为段落/项目符号/表格结构，再确定性生成并回读 OOXML；明确选择的 DOCX 可作为资料，Desktop 可做结构预览、系统打开、版本历史和直接父版本正文/表格差异。宏、外链、嵌入内容和复杂富文档 fail closed。WB-02 两轮确定性 pilot与 macOS Pages 逐页目视已通过；真实 DeepSeek 为 2 次接受、1 次失败、1 次无结论，readiness 为 `provider-stability-not-passed`。三次连续正式评分和跨平台 Word/LibreOffice 仍未通过。规格与证据见 [`M12.3-SPEC.md`](M12.3-SPEC.md) 和 [`M12.3-VALIDATION.md`](M12.3-VALIDATION.md)。

### M12.4 · Independent DOCX Reviewer + Retained Benchmark Trace — fourth slice implemented locally

第四切片在 DOCX 原子写入前增加独立只读 Reviewer，比较完整 Goal Contract、Worker 证据和候选文件抽取正文；退回后 Integrator 在同一私有 checkpoint 内最多修订三次，未通过候选不发布，无成功写入也不能用纯文本收尾。Artifact Revision 进一步把已验证父正文和结构直接交给 Integrator/Reviewer，并在模型审核前确定性检查正文、段落、章节、表格和表格行保留，阻止窄修改静默删稿。Desktop 投影审核状态和退回次数。`pnpm benchmark:trace` 可在清理一次性工作区前，把不含 Goal/模型/工具参数/正文/绝对路径的诊断摘要以新文件保留到工作区之外。

2026-08-15 用 8 份明确资料完成一条真实 DeepSeek/macOS Research Desk 首版与窄修订。首版 21 次模型调用、389,277 provider-reported tokens，但人工发现两处来源范围错误；第一次修订虽被 Reviewer 接受，却把 8,443 字符父稿缩成 1,381 字符并丢掉 A/B/C 主体，由此补上父版本直接上下文和本地保留门槛。最终 V5 为 12,002 bytes、8,428 字符、99 个段落、6 章、1 个 8 行表格、7/7 正确深链接；12 次模型调用、132,995 tokens，先经两次本地保留退回再由语义 Reviewer 接受，并被 Pages 打开。路线判断是“单条修订闭环已通过，首轮效率与连续稳定性仍开放”。它不更新 WB-02 三次连续稳定性结论，也不替代打包 App、Windows Word 或真实用户验收。规格与证据见 [`M12.4-SPEC.md`](M12.4-SPEC.md) 和 [`M12.4-VALIDATION.md`](M12.4-VALIDATION.md)。

尚未完成的 Artifact Workbench P0 是：

- 完整分支图、版本合并、任意两版比较，以及覆盖文本/代码/超长文档和人工 disposition 的通用语义 Reviewer；
- HTML/代码专用渲染与 diff；当前只支持已有文本预览扩展；
- XLSX/PPTX 的真实生成、打开、抽取、版式/公式检查和二次修改；DOCX 仍需真实 Provider、跨平台和复杂文档能力；
- 把 Goal revision、验收标准变化和 Artifact revision 更明确地联合展示；
- 确定性 grader 直接运行黄金任务的打开、公式、引用、网页行为和恢复检查。

WB-02 已证明“真实 Provider 可以走通”，但没有证明“连续稳定走通”。完整纵向验收仍以 WB-02、WB-03、WB-05 为准；零散接受运行和单机 Pages 目视不能替代三次连续正式评分、跨平台验收或竞品黑盒结果。

### 相邻增量

- P0 产品组合：由 [Issue #3](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/issues/3) 确认 Research Desk、Teaching Studio、Builder Lab 的用户、重复 Job、场景合同、非目标和晋级/停止条件；
- P0 场景合同：由 [Issue #4](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/issues/4) 把 Expert、Expert Team、Skill、Source、Artifact、Review 和 Eval 组成可检查、可发现的 Scenario Product Contract；
- P0 产品证据：由 [Issue #5](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/issues/5) 管理跨场景真实 Provider、目标应用和用户 dogfood，避免用 WB-02 或单一作者调试代替产品结论；
- P0 控制面：Goal revision 2+、资料/权限变化 replan、人工理由化退回/override、运行中追问/中断/重试、跨 Artifact 只读 Reviewer；
- P1 Office Skills：富文档、工作簿和演示文稿的生成、预览、检查与修订；
- P1 可发现能力：面向任务展示专家/Skills/MCP 的能力、来源、权限和选择理由，而不是只给工程配置；
- P1 项目组织：Project/Thread/Run 分层、Project 资料集合但 Run 精确选集、Coding Handoff 与可恢复清理；
- P2 本地 Memory、Record-and-Replay、scheduled/background tasks。

自动化必须等 Goal、Review、通知/待处理入口、幂等回执和最小权限模型成熟后再立项。远程 Skill 市场、云同步、团队账号、无人值守外部副作用和完全自动更新不属于当前批准范围。

下一阶段不允许从上述“相邻增量”直接挑组件开发。新增实现 Issue 必须链接已批准的场景方向 Issue，说明它服务的用户 Job 和产品证据门；只有被两个以上入选场景共同拉动的能力，才可提升为独立 Core 优先级。

## 里程碑完成口径

每个里程碑必须分别记录：

1. 代码和确定性测试；
2. 当前主机上的真实运行；
3. 目标平台原生 Runner 的合同与产物；
4. 真实设备、真实第三方服务或发布身份才能证明的外部验收。

第 4 类条件未具备时必须明确标记为未验收，不能用 mock、静态配置、CI 打包或生成了安装文件来代替。
