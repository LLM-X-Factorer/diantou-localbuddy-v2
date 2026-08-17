# LocalBuddy V2

LocalBuddy V2 是一个从零实现的本地多 Agent 工作台。它面向单个本地用户，通过远程 LLM API 完成规划、研究、编码、审查和产物生成；本地负责文件、权限、任务调度、状态恢复与审计。

这不是 Craft Agents 的分支，也不包含腾讯 WorkBuddy 的私有实现。仓库只参考公开产品行为、通用 Agent 架构模式，以及我们自行定义的验收契约。

> **产品判断（2026-08-17）**：仓库已按 Apache License 2.0 公开；[`v0.12.5 / Public Bug Reporting + Product Truth`](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/releases/tag/v0.12.5) 是当前公开但未签名的 Engineering Alpha Release，包含 M12.1-M12.4、stable Windows 公共更新源和用户主动公开安全问题报告。当前进入 M13 Product Truth Sprint，默认冻结功能扩张，用 Research Desk 重复运行、不同主题和非作者用户决定 `advance/pause/stop`。`v0.12.3` 仅保留失败 Tag 审计；代码签名、Windows 11 真人与 `v0.12.4 -> v0.12.5` 应用内更新继续开放。

## 一页状态

| 维度 | 当前事实 |
|---|---|
| 工作形态 | Desktop + CLI；Desktop 使用 Goal Contract 并在 Worker 前审阅计划，真实工作仍以单次 Run 为主，不是持续聊天线程 |
| Agent | Orchestrator、Research/Code Worker、Integrator、Merge Agent；DOCX 候选另经只读 Artifact Reviewer |
| 并发 | 每个计划 1-3 个 Worker；Desktop 默认最多 2 个活动 Run；全局 Task 容量默认 3 |
| Provider | DeepSeek、OpenAI；独立设置入口展示环境变量/系统凭据/未配置状态，API Key 不进入 Renderer 持久状态 |
| 本地安全 | macOS Seatbelt；Linux 固定容器镜像；Windows 本地进程型工具 fail closed |
| 代码写回 | 独立 worktree、组合预检、人工 Gate、apply/commit/revert commit |
| 恢复 | Research/Coding 同 Run checkpoint resume；失败 Run 可恢复未完成 Task 链，并保留 replay 兜底 |
| Artifact | 文本与受限 DOCX；已登记版本可预览、打开、继续修订并与直接父版本比较；DOCX 发布前经独立 Reviewer，当前只覆盖段落、项目符号和表格 |
| 扩展 | 本地/签名 Skill、MCP stdio/HTTP/OAuth、受限 Playwright Browser |
| 分发 | Windows `v0.12.5` Setup/ZIP/full nupkg/RELEASES 由 Tag 门禁发布；托管 Windows 验证 `v0.12.4 -> v0.12.5`，但签名与 Windows 11 真人 OTA 仍未验收 |
| 当前阶段 | M13 Product Truth Sprint；固定 `v0.12.5`，默认不扩功能，只修真实任务证明的阻塞并作 `advance/pause/stop` 裁决 |
| 当前主动暂缓 | Developer ID、生产 Hardened Runtime、notarization、公开 Gatekeeper |

M10.2 把首次体验从静态空状态升级为“第一次可信运行”；M10.3 继续补齐 Provider 配置闭环；M10.4 把运行位置与资料范围分离；M11.1 再将目标与执行计划变成可检查、可批准的合同。保存不会自动联网；验证连接只请求模型列表；真实 Run 必须由用户生成计划并批准后才启动 Worker。连续真实 dogfooding 仍是开放验证门。

## 文档入口

- [`docs/QUICKSTART.md`](docs/QUICKSTART.md)：内部试用者从安装、凭证到第一个 Run 的最短路径；
- [`docs/PRODUCT-DEFINITION-V2.md`](docs/PRODUCT-DEFINITION-V2.md)：LocalBuddy“可信本地工作台 + 场景产品包”的产品定义、首批候选场景和晋级门禁；
- [`docs/PRODUCT-PORTFOLIO-DECISION-2026-08-15.md`](docs/PRODUCT-PORTFOLIO-DECISION-2026-08-15.md)：Research Desk 切入口、Teaching Studio 旗舰假设与 Builder Lab 基准角色的 L0 组合裁决；
- [`docs/KNOWN-LIMITATIONS.md`](docs/KNOWN-LIMITATIONS.md)：`v0.12.5` 分发基线与仍开放门禁；
- [`docs/M11.1-SPEC.md`](docs/M11.1-SPEC.md)：Goal Contract、Plan Review、批准身份和恢复语义；
- [`docs/M11.1-VALIDATION.md`](docs/M11.1-VALIDATION.md)：M11.1 本机、原生 Windows 发布与仍开放的真人门禁；
- [`docs/M12.1-SPEC.md`](docs/M12.1-SPEC.md)：Artifact Thread、父产物身份、只读修订快照和版本 UI 的本地实现合同；
- [`docs/M12.1-VALIDATION.md`](docs/M12.1-VALIDATION.md)：M12.1 自动门禁、macOS 开发版真实界面读回和未完成边界；
- [`docs/M12.2-SPEC.md`](docs/M12.2-SPEC.md)：Artifact Thread 版本/尝试列表、有界文本 diff 与 WB-02 DOCX 边界；
- [`docs/M12.2-VALIDATION.md`](docs/M12.2-VALIDATION.md)：M12.2 自动测试、macOS 真实界面和篡改降级证据；
- [`docs/M12.3-SPEC.md`](docs/M12.3-SPEC.md)：受限 DOCX 编译、解析、安全边界和 WB-02 纵向合同；
- [`docs/M12.3-VALIDATION.md`](docs/M12.3-VALIDATION.md)：DOCX 自动门禁、Pages 逐页目视和 Electron Artifact Workbench 证据；
- [`docs/M12.4-SPEC.md`](docs/M12.4-SPEC.md)：独立 DOCX Reviewer、有界修订、事件隐私和脱敏 trace 合同；
- [`docs/M12.4-VALIDATION.md`](docs/M12.4-VALIDATION.md)：Reviewer 接受/退回/上限/恢复与 trace 专项证据；
- [`docs/M13-PRODUCT-TRUTH-SPRINT.md`](docs/M13-PRODUCT-TRUTH-SPRINT.md)：固定 `v0.12.5`、Research Desk 真实运行矩阵、非作者用户门和 `advance/pause/stop` 裁决；
- [`docs/M13-PUBLIC-BUG-REPORTING.md`](docs/M13-PUBLIC-BUG-REPORTING.md)：用户主动公开报告、隐私裁剪、预览确认、去重和本地回退合同；
- [`docs/CODEX-BENCHMARK-2026-08-14.md`](docs/CODEX-BENCHMARK-2026-08-14.md)：基于 OpenAI 官方文档的 Codex 产品/Agent 基准、LocalBuddy 差距和优先级；
- [`docs/WORKBUDDY-PRODUCT-BENCHMARK-2026-08-15.md`](docs/WORKBUDDY-PRODUCT-BENCHMARK-2026-08-15.md)：WorkBuddy 公开承诺、LocalBuddy 产品差距、六个黄金任务和统一评分合同；
- [`benchmarks/workbuddy-core/README.md`](benchmarks/workbuddy-core/README.md)：可物化的产品对标夹具、运行规则和证据要求；
- [`docs/AGENT-PRODUCT-PRINCIPLES.md`](docs/AGENT-PRODUCT-PRINCIPLES.md)：从真实故障、恢复、并发和发布中沉淀的长期 Agent 产品原则；
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)：当前 `v0.12.5` 架构事实；
- [`docs/ROADMAP.md`](docs/ROADMAP.md)：已完成里程碑、外部门禁和待确认的下一阶段；
- [`docs/RELEASE.md`](docs/RELEASE.md)：版本、Tag、CI、Release 与校验流程；
- [`docs/DOGFOOD.md`](docs/DOGFOOD.md)：真实任务试用矩阵与退出口径；
- [`docs/WINDOWS-GRAY.md`](docs/WINDOWS-GRAY.md)：Windows 自动化合成灰度、RC 和真人灰度分层；
- [`docs/WINDOWS-UPDATES.md`](docs/WINDOWS-UPDATES.md)：Windows 高频 Canary、安装升级门禁和稳定版更新源的三通道设计；
- [`docs/WINDOWS-UPDATE-VALIDATION.md`](docs/WINDOWS-UPDATE-VALIDATION.md)：`v0.12.4` 桥接、`v0.12.5` 托管升级与 Windows 11 开放门禁；
- [`docs/PUBLIC-REPOSITORY-READINESS.md`](docs/PUBLIC-REPOSITORY-READINESS.md)：公开前凭证、历史元数据、许可证、Release 和在线更新门禁；
- [`CHANGELOG.md`](CHANGELOG.md)：已发布版本的变更记录。

## 许可证

LocalBuddy V2 以 [Apache License 2.0](LICENSE) 开源；项目归属说明见 [NOTICE](NOTICE)。该许可证不授予对项目名称、商标或品牌标识的额外使用许可。

## 当前状态

**M0 并发运行时内核**已经完成：

- 一个 Run 可以包含有依赖关系的多个 Task。
- Task 可以动态分配给不同能力和容量的 Agent。
- 全局并发数与单 Agent 并发数分别受控。
- 同一共享工作区允许并发读取，但写入互斥。
- 并发写任务可以声明独立隔离区，后续由 Integrator Agent 串行整合。
- 运行与任务状态通过 append-only Event Store 留痕。

**M1 Headless Agent** 已经完成首条真实纵向链路：

- DeepSeek Chat Completions SSE 流式适配器。
- Orchestrator 使用 JSON Output 生成 1-3 个并行 Worker Task。
- Research Worker 只读取本次 Run 明确添加的文件/资料目录；运行位置不自动成为资料库，Integrator 等待依赖后写产物。
- 工具参数由本地代码解析，路径逃逸、角色越权和未知工具会被拒绝。
- API Key 优先从环境变量读取，macOS 下可存入系统钥匙串。
- 确定性比例计算会生成 `calculationId`；含无来源数字、缺失计算底稿或擅自舍入的产物无法写入。
- 真实 DeepSeek smoke 已完成，验收记录见 [`docs/M1-VALIDATION.md`](docs/M1-VALIDATION.md)。

**M2 Desktop Control Plane** 已完成首版：

- Electron Main 驱动真实 Headless Runtime，不在 Renderer 中执行模型或文件操作。
- React 工作台展示历史 Run、Agent Task Graph、实时事件、状态和登记产物。
- 从 `.localbuddy/runs/*/events.jsonl` 重建历史状态，重启应用后仍可查看。
- 支持选择运行记录位置、为 Research Run 单独添加本次资料、设置单 Run 并发数、启动和取消运行、打开登记产物。
- Preload 使用 context isolation 和 sandbox，只暴露逐项 IPC 方法。
- Electron 真实窗口已经完成构建和截图验收，记录见 [`docs/M2-VALIDATION.md`](docs/M2-VALIDATION.md)。

**M3.1 Multi-Run + Isolated Coding** 已完成：

- 进程级 `ExecutionCoordinator` 让多个 Run 共享全局执行容量与工作区读写锁；桌面默认最多同时启动 2 个 Run，全部 Run 合计最多执行 3 个 Task。
- Code Orchestrator 将目标拆成 1-3 个文件所有权不重叠的任务，每个 Code Worker 使用独立 detached Git worktree。
- Code Worker 可读取仓库、做精确文本替换、创建已授权的新文件，并运行固定枚举的检查命令；没有任意 shell 字符串入口。
- 控制器强制执行 `git diff --check`，以 binary/full-index 格式捕获补丁，登记 `.patch` Artifact，再由 Integrator 生成明确标注“未合并”的总结。
- 主工作区不会被自动修改、提交或合并；worktree 会保留给用户检查。真实 DeepSeek 双 Worker smoke 与桌面截图见 [`docs/M3-VALIDATION.md`](docs/M3-VALIDATION.md)。

**M3.2 Controlled Integration** 已完成：

- 多个 Worker patch 先在独立 integration-preview worktree 依次应用；文本冲突、空组合结果或组合测试失败都会在主工作区之前终止。
- 预检成功后持久化 `integration-proposal.json`，记录 baseline HEAD、patch 哈希、组合 patch、变更路径和检查结果。
- Agent 没有批准权。CLI 必须显式传入 `--apply`，Desktop 必须点击批准按钮并通过原生确认框。
- 批准时再次检查主工作区 clean、HEAD 未漂移、组合 patch 哈希一致，再以 Git 默认原子语义写回。
- 用户可选择保持未提交、创建一个显式 commit，或在未继续编辑时反向撤销；commit 失败会自动恢复 index 与工作区。
- 真实 DeepSeek “双 Worker → 组合测试 → 人工批准 → commit”验收见 [`docs/M3.2-VALIDATION.md`](docs/M3.2-VALIDATION.md)。

**M3.3 Safe Recovery + Worktree Lifecycle** 已完成：

- 每个 Desktop/CLI Run 在模型调用前原子持久化 `run-request.json`；Desktop Request 记录执行模式、并发数和恢复来源。
- Desktop 启动或读取历史时，把属于 Desktop 且没有终态的持久 Run 追加标记为 `interrupted`，重复读取不会重复写事件。
- 用户可以按原始请求创建全新 Run；旧 Run 只追加 `run.restarted` 链接，历史事件不改写。界面明确说明这是 replay，不是模型 turn checkpoint resume。
- Desktop 展示 Run 登记过的 Worker/preview worktree。显式清理前需要原生确认，并同时核对事件登记与 `git worktree list`。
- `awaiting_approval`、`applying`、`applied`、`recovery_required` 状态保护 worktree；成功清理只删除隔离目录，Run Request、事件和 Artifact 保留。
- 契约与验收见 [`docs/M3.3-SPEC.md`](docs/M3.3-SPEC.md) 和 [`docs/M3.3-VALIDATION.md`](docs/M3.3-VALIDATION.md)。

**M3.4 Research Checkpoint Resume** 已完成：

- Research Run 会原子保存计划、Task 消息历史、模型/工具阶段和工具执行回执；Artifact 与确定性计算登记也改为持久化注册表。
- Desktop 可在应用重启后对同一 Run ID 执行 checkpoint resume。已完成 Task 直接恢复，未完成 Task 继续使用原 Agent 与原消息前缀。
- 已完成工具结果会复用；中断中的只读/计算工具可以重试。无法确认是否已产生副作用的写入/执行工具会阻断续跑，不会盲目重复执行。
- 恢复前校验原始 Request、持久计划、Task/Agent/工具契约、明确选择的资料身份，以及本次 Run 真正读取过的文件 SHA-256。不会扫描或哈希整个运行目录；无关文件变化不阻断恢复，已读取资料被修改、移动或删除时才会阻断。旧版 whole-workspace Research checkpoint 不自动迁移，用户需新建 Run 并明确添加资料。
- M3.4 阶段本身只覆盖 Research Run；Coding Run 的独立恢复协议由 M3.5 补齐。
- 契约与验收见 [`docs/M3.4-SPEC.md`](docs/M3.4-SPEC.md) 和 [`docs/M3.4-VALIDATION.md`](docs/M3.4-VALIDATION.md)。

**M3.5 Coding Run Checkpoint Recovery** 已完成：

- Coding Run 原子保存代码计划、baseline HEAD、Task/Agent 契约、Git worktree 清单、工具回执、Worker 结果和预检进度。
- Desktop 可对异常退出的 Coding Run 使用同一 Run ID 继续；恢复前重新核对主仓库、Git 登记的隔离工作树、当前 diff、patch Artifact 与 Integration Proposal。
- Agent checkpoint 与 Coding Task 结果采用两层完成语义：只有 patch/Artifact/工作树状态完整落盘并通过复核，Scheduler 才会跳过已完成任务。
- 已完成工具回执会复用；只有 started 回执的写入/执行工具、工作树漂移或产物不一致会阻断自动恢复。
- 未完成的 integration preview 会保留并改用新编号重新预检；完整 Proposal 可复核后恢复，主工作区仍必须经过人类批准才会写回。
- `applying` 中断只在 Git 状态能精确证明结果时自动对账为 applied/committed；任何额外改动进入 `recovery_required`，不覆盖现场。
- 故障注入、真实 DeepSeek 与桌面验收见 [`docs/M3.5-SPEC.md`](docs/M3.5-SPEC.md) 和 [`docs/M3.5-VALIDATION.md`](docs/M3.5-VALIDATION.md)。

**M4 Extensions** 已完成：

- Provider 可按 Run 选择 DeepSeek 或 OpenAI；两者都支持流式文本、工具调用、JSON Output、usage 与 Keychain/环境变量凭证。
- 本地 Skill 从 `.localbuddy/skills/<id>/SKILL.md` 显式加载，校验 YAML、大小、路径、符号链接与内容哈希；Skill 不能绕过工具策略。
- MCP stdio server 从 `.localbuddy/mcp.json` 显式选择，发现与调用均进入审计；本地未声明只读的工具一律按外部副作用处理。
- Playwright Chromium 使用每 Run 独立 context 和 exact-origin 网络白名单；导航/快照与点击/填表分开授权。
- Provider 与扩展选择进入 Run Request、Desktop 历史和 checkpoint contract；扩展漂移会阻断旧 Run 续跑。
- 69 项自动测试、真实 DeepSeek + Chromium + MCP 纵向烟测及 Electron 实窗验收见 [`docs/M4-SPEC.md`](docs/M4-SPEC.md) 和 [`docs/M4-VALIDATION.md`](docs/M4-VALIDATION.md)。

**M5 Hardening + Packaging** 已完成：

- Desktop 对 effectful MCP/browser 调用逐次排队；批准只消费一次，并显示脱敏参数预览与精确参数哈希。
- MCP 新增 Streamable HTTP transport，静态 Bearer 只从环境变量注入；stdio 配置保持兼容。
- CLI 与 Desktop 使用跨进程工作区租约，避免两个 LocalBuddy 进程同时修改或对账同一工作区；同一 Desktop 内多 Run 仍可并行。
- Renderer 使用 `localbuddy://app/`、全局 sandbox 和严格 CSP；macOS ASAR 包固定 Electron 43 全部 9 项 fuse。
- Forge 生成 macOS arm64 `.app`/ZIP，原生 `hdiutil` 生成 DMG；包内含锁定版本的 Chromium headless shell。
- 79 项测试、真实 DeepSeek、多进程故障、包内浏览器、实际 fuse、签名和 Renderer 启动验收见 [`docs/M5-SPEC.md`](docs/M5-SPEC.md) 和 [`docs/M5-VALIDATION.md`](docs/M5-VALIDATION.md)。

**M6 Safe Execution + Unified Trust** 已完成：

- macOS 中模型触发的检查和 MCP stdio 进入 Seatbelt；工作区按声明只读/写、默认断网、限制输出/时间并取消进程树。
- Linux 提供只读 rootfs、cap drop、no-new-privileges、资源上限和显式 mount 的容器执行宿主；Windows 没有受支持隔离宿主时对本地进程工具 fail closed。
- 文件、计算、产物、worktree、进程、外部读取和外部副作用统一映射为七类权限，按 strict/balanced/automation 信任档执行。
- 规格见 [`docs/M6-SPEC.md`](docs/M6-SPEC.md)。

**M7 Recovery + Coordination** 已完成：

- CLI 可用 `--resume-run` 续跑同一 Run checkpoint，且不能覆盖持久化的目标、Provider、并发和扩展合同。
- 已提交 Integration 通过新的 revert commit 撤销，不改写 Git 历史；异常落盘进入 `recovery_required`。
- Integration 冲突只在 preview worktree 交给 Merge Agent 建议，控制器复核、跑组合检查后仍需人工 Gate。
- 多进程/多工作区共享全局 Task 容量、Provider 并发、最小请求间隔和每日 token 预算。
- 规格见 [`docs/M7-SPEC.md`](docs/M7-SPEC.md)。

**M8 MCP OAuth 2.1** 已完成本地可验证范围：

- 支持 Protected Resource/Authorization Server Metadata 发现、Authorization Code + PKCE S256、loopback state 校验、动态注册、refresh、revoke 和 resource 绑定。
- MCP token 按服务端点/Server/账户隔离存入操作系统凭证库，不进入配置、事件或 checkpoint。
- OAuth 只完成身份认证，不会绕过 MCP 外部副作用的逐次授权。
- 规格与真实 loopback 协议夹具见 [`docs/M8-SPEC.md`](docs/M8-SPEC.md)。

**M9 Distribution Protocol + Platforms + Skill Supply Chain** 已完成本地及原生 Runner 可验证范围：

- 更新清单使用 Ed25519 签名，artifact 校验 SHA-256、字节数、平台和版本回滚；当前只 staging，绝不自动替换 macOS 应用。
- macOS/Windows/Linux 有各自凭证库和状态目录适配；Linux/Windows 原生打包命令与 CI matrix 已定义。
- 签名 Skill 支持发布者信任、版本锁、权限声明、内容哈希和撤销；工作区本地自编 Skill 仍以显式选择的 `workspace-local` 层保留。
- 规格与验收见 [`docs/M9-SPEC.md`](docs/M9-SPEC.md) 和 [`docs/M9-VALIDATION.md`](docs/M9-VALIDATION.md)。

**M10 Dogfooding + Productization** 已完成实现、本机和原生 Runner 范围；连续 dogfooding 验证门开放：

- Desktop 增加 Provider 模型/Base URL 配置和系统凭证写入；
- 把 strict/balanced/automation 信任档从内核能力变成 Run 可选合同；
- Integration Gate 增加受限 inline diff 阅读，而不只展示路径和哈希；
- 增加脱敏诊断包导出，供内部 dogfooding 复盘；
- Run Request 升级为 v3；旧 v1/v2 Request 读取时默认迁移为 `balanced`，但不会改写历史文件；resume/replay 固定复用原信任档。
- Apache-2.0 公开仓库位于 `LLM-X-Factorer/diantou-localbuddy-v2`；Linux DEB、Windows Squirrel Setup/ZIP 和跨平台合同已由 GitHub 原生 Runner 验收。
- 连续 7-14 天的真实任务 dogfooding 尚未执行，计划与退出口径见 [`docs/DOGFOOD.md`](docs/DOGFOOD.md)。
- 真实第三方 MCP OAuth 仍以指定生产服务和账户为外部验收门。
- 规格和当前 macOS 验收见 [`docs/M10-SPEC.md`](docs/M10-SPEC.md) 与 [`docs/M10-VALIDATION.md`](docs/M10-VALIDATION.md)。

**M10.1 Local Dogfood Closure** 已完成本机闭环；连续使用门禁仍开放：

- Run 头部显示审计得出的耗时、模型调用、Provider token、失败、Artifact Gate 重试和失败阶段；
- Artifact Gate 返回可执行修正意见并限制失败写入次数；失败 Run 可从安全 checkpoint 恢复未完成 Task 链；
- 最近工作区、校验后的文本 Artifact 内嵌预览和显式“基于此产物继续”已进入 Desktop；
- MCP stdio 启动失败保留有界脱敏线索，诊断导出通过原生保存流程完成；
- macOS 安装应用已完成真实 Coding commit/reverse-commit，主工作区最终干净；
- 完整证据见 [`docs/DOGFOOD-2026-08-12.md`](docs/DOGFOOD-2026-08-12.md) 与 [`docs/M10-VALIDATION.md`](docs/M10-VALIDATION.md)。

**M10.2 First Trusted Run** 已完成本机实现与界面验收：

- 首次打开显示永久可返回的本地指引会话，没有 Provider 也能浏览；
- 不再把整个 Documents 当作隐式默认工作区；
- 工作区/Git/Provider readiness 只检查边界，Renderer 不读取凭据或业务内容；
- 教程工作区显式创建、唯一命名、私有存储且复用时不覆盖文件；
- 教程、资料研究和安全 Coding 模板只填入编辑器，必须由用户点击开始；
- 真实 Run 的规划、审批、集成、成功和失败提示由审计状态产生；
- 规格与验收见 [`docs/M10.2-SPEC.md`](docs/M10.2-SPEC.md) 和 [`docs/M10.2-VALIDATION.md`](docs/M10.2-VALIDATION.md)。

**M10.3 Provider Setup** 已完成实现、本机包、安装与界面验收：

- 侧边栏提供独立、固定的“Provider 设置”，不再把必要配置归入可选扩展；
- DeepSeek/OpenAI 分别显示 `环境变量`、`系统安全存储` 或 `未配置`，Renderer 只接收状态而不接收密钥；
- 支持保存、替换和经原生确认删除系统凭据；环境变量优先且不能由应用删除；
- 保存只验证本机安全写入；用户可显式请求 `/models` 验证认证与网络，不调用生成接口；
- Composer 就近显示 Provider 状态，缺少凭据时阻止启动并直接打开设置；
- Composer 采用紧凑的任务输入与单行工具栏，扩展配置只在用户展开时占用额外空间；
- Windows 托管 Runner 已运行版本对应的 Squirrel Setup，从实际安装目录验证无 Provider 首启并调用卸载清理；安装/更新/卸载生命周期由标准 Squirrel 处理器提前收口；
- 规格与验收见 [`docs/M10.3-SPEC.md`](docs/M10.3-SPEC.md) 和 [`docs/M10.3-VALIDATION.md`](docs/M10.3-VALIDATION.md)。

当前主动暂缓的是正式 Apple Developer ID、生产 Hardened Runtime entitlements、notarization 和公开 Gatekeeper 验收。`v0.12.5` 的 Windows Tag 门禁覆盖安装级无凭据首启、完整安装版合成灰度、从 `v0.12.4` 原地升级、profile 保留及五项分发资产校验。终端用户 Windows 11、真实 Provider 和第三方生产 MCP OAuth 仍需外部验收，不能用托管 Runner、公开 endpoint 或本地夹具冒充。

## 核心模型

```text
Run
 ├─ Task A ── Research Agent ── read:workspace
 ├─ Task B ── Research Agent ── read:workspace
 ├─ Task C ── Coding Agent   ── write:worktree-C ── patch-C
 ├─ Task D ── Integrator     ── depends on A/B/C ── write:artifact-only
 └─ Human Gate ── combined preflight ── approve ── apply / commit
```

“多 Agent”和“多任务”是两个独立维度：Agent 定义角色、指令与能力；Task 定义可调度工作、依赖关系和工作区访问方式。

## 开发

```bash
pnpm install
pnpm exec playwright install chromium
pnpm check
```

生成并验证本机 macOS arm64 内部试用包：

```bash
pnpm make:mac
pnpm verify:mac-package
```

产物保存在 `.localbuddy/forge-out/make/`。当前是 ad-hoc、未公证的内部试用包，不等于可公开分发的 Developer ID release。

目标平台原生构建命令：

```bash
pnpm make:linux
pnpm make:win
```

它们应分别在 Linux/Windows Runner 上执行；仓库不会把交叉编译配置冒充成目标平台运行验收。

推送 `v*` Tag 会在 `windows-2025` Runner 上执行生产依赖审计、完整测试、Squirrel Setup/ZIP 构建、上一稳定版原地升级和安装版合成灰度，并为 Setup、便携 ZIP、`RELEASES`、full `.nupkg` 生成 LF 格式的 `SHA256SUMS-windows.txt`。同一 Windows 作业确认 Tag 与 `package.json` 完全一致并复核清单后直接发布 Release 资产，不再通过临时 Actions Artifact 中转；预发布 Tag 自动标记 prerelease。Linux 仅在每周/手动维护工作流中构建，不进入 Tag Release。当前公开 Release 为 [`v0.12.5`](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/releases/tag/v0.12.5)，证据见 [`docs/WINDOWS-UPDATE-VALIDATION.md`](docs/WINDOWS-UPDATE-VALIDATION.md)。

## Headless 真实运行

在操作系统凭证库保存 DeepSeek Key（macOS Keychain、Linux Secret Service、Windows Credential Manager）：

```bash
pnpm credentials:set
```

指定 Provider 时分别保存凭证：

```bash
pnpm credentials:set -- --provider deepseek
pnpm credentials:set -- --provider openai
```

执行一个多 Agent 本地任务：

```bash
pnpm cli -- \
  --workspace ./fixtures/m1-weekly-report \
  --goal "读取本地材料并生成一份中文周报" \
  --trust-profile balanced \
  --concurrency 3
```

按 Run 启用本地 Skill、MCP 和受限浏览器：

```bash
pnpm cli -- \
  --provider deepseek \
  --workspace /path/to/workspace \
  --goal "读取本地材料、浏览指定页面，并调用本地 MCP 工具生成报告" \
  --skill evidence-review \
  --mcp-server local-tools \
  --browser-origin https://example.com
```

浏览器点击/填表和 MCP 副作用工具默认拒绝；CLI 仅在确认该 Run 需要时添加 `--allow-browser-actions` 或 `--allow-mcp-writes`。Desktop 中这两个选项只允许调用进入逐次审批队列，不会提前批准。stdio/Streamable HTTP 配置和安全边界见 [`docs/M4-SPEC.md`](docs/M4-SPEC.md) 与 [`docs/M5-SPEC.md`](docs/M5-SPEC.md)。

CLI 同 Run 恢复：

```bash
pnpm cli -- --workspace /path/to/workspace --resume-run run-id
```

恢复会复用原 Request 合同；只允许额外选择 `--apply`/`--commit-message` 处理已持久化的 Code Integration。OAuth MCP 配置示例与凭证边界见 [`docs/M8-SPEC.md`](docs/M8-SPEC.md)。

签名更新只下载到 staging：

```bash
pnpm update:stage -- \
  --manifest-url https://updates.example.com/localbuddy/manifest.json \
  --public-key BASE64_ED25519_SPKI
```

发布方签名工具与 Skill 包签名工具分别是 `pnpm update:sign -- ...`、`pnpm skill:sign -- ...`；私钥不得放入本仓库。

对一个干净、已经提交且忽略 `.localbuddy/` 的 Git 仓库运行代码隔离模式：

```bash
pnpm cli -- \
  --mode code \
  --workspace /path/to/clean-git-repo \
  --goal "把两个互不重叠的修改交给并行 Code Worker，运行检查并输出未合并补丁" \
  --concurrency 3
```

代码模式的输出包括每个 Worker 的 worktree 路径、补丁 Artifact、SHA-256 和总结文件。它不会自动把补丁应用到主工作区。

先生成并审阅 Integration Proposal，不写回：

```bash
pnpm cli -- --mode code --workspace /path/to/repo --goal "完成修改并运行组合测试"
```

用户明确批准后写回；只有提供 commit message 时才创建 commit：

```bash
pnpm cli -- \
  --mode code \
  --workspace /path/to/repo \
  --goal "完成修改并运行组合测试" \
  --apply \
  --commit-message "Apply approved LocalBuddy integration"
```

`--trust-profile` 可选 `strict`、`balanced`、`automation`。`strict` 会要求更多逐调用人工审批；无交互审批处理器的 CLI 会 fail closed。`automation` 允许本地受限操作自动执行，但始终拒绝外部副作用。

运行请求、事件和产物保存在工作区 `.localbuddy/runs/<run-id>/`，该目录默认不进入 Git。`run-request.json` 包含用户目标，属于本地私有运行状态，不应提交或同步到公开仓库。

启动桌面工作台：

```bash
pnpm desktop
```

Desktop 侧边栏的“Provider 设置”可查看凭据来源、安全保存/替换/删除 Key、显式验证连接，并在高级设置中填写当前 Run 的 model/base URL；Renderer 不读取既有 secret。“扩展配置”只管理 Skills、MCP 和 Browser。代码集成审批区可在写回前校验并查看组合 Diff，顶部可导出脱敏诊断包。

架构边界见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)，当前工程路线与暂缓项见 [`docs/ROADMAP.md`](docs/ROADMAP.md)。M0-M10.3 的规格和验证记录均在 [`docs/`](docs/) 下；面向内部安装包用户的入口见 [`docs/QUICKSTART.md`](docs/QUICKSTART.md)。
