# Changelog

本文件记录已经发布或准备发布的产品版本。里程碑范围和证据分别以 [`docs/ROADMAP.md`](docs/ROADMAP.md) 与对应的 `docs/M*-VALIDATION.md` 为准。

## Unreleased

### Fixed

- Canary 版本现在会与最新稳定 Release 比较；发布后的下一次 `main` 构建自动进入下一 patch 的 prerelease 线，避免 Squirrel 把同号 `X.Y.Z-canary.*` 识别为低于已经安装的稳定 `X.Y.Z`。

## 0.12.2 — 2026-08-14

Windows Canary 与安全原地更新候选。本版本把高频开发同步、安装器升级验证和未来稳定版应用内更新拆成三条独立通道；当前没有配置生产更新源，也没有完成 Windows 11 真机升级验收。

### Added

- 新增 `pnpm windows:canary`：从最新成功的私有 `main` CI 下载便携 ZIP，按 Git SHA 并存，使用独立 Electron user-data 启动；
- 新增可审计构建身份，包内 metadata 与运行时版本必须一致，Desktop 展示 channel、version 和 short SHA；本地未提交构建明确标记 `+dirty`；
- 新增 Windows Squirrel 更新控制器和手动检查入口；下载完成后只有用户确认且 Run/Integration 空闲时才能重启安装；
- 新增 `上一稳定版 -> 当前候选版` 原地升级门禁，检查默认 profile 标记保留和更新后 UI 版本；
- Windows Release 资产增加 `RELEASES` 和 full `.nupkg`，为后续受控更新源提供原始 feed 产物。

### Security and boundaries

- Renderer 不能设置更新源；feed 只接受 HTTPS 或 loopback HTTP，并拒绝 URL 凭证、query 和 hash；
- Canary 不覆盖稳定安装，CI 升级脚本拒绝覆盖已有本机安装/用户目录；
- 生产 feed、Windows 代码签名、SmartScreen 信誉和 Windows 11 真人验收仍开放，不能把 CI 产物生成写成自动更新已经上线。

### Evidence

- `pnpm check` 共 156 项：macOS 本机 154 passed、2 项 Windows-only 跳过、0 failed；生产依赖审计无已知漏洞；
- `0.12.2` macOS App/ZIP/DMG、ad-hoc 签名、DMG 完整性、Fuse、ASAR、内置浏览器和真实 Renderer 首启通过，UI 读回可追踪构建身份；
- 首次 Windows CI `31779620641` 的全量检查和 Canary Setup 构建通过，但首启烟测在 bootstrap 前读到默认身份并停止；严格等待真实身份后，CI `31780762643` 的 macOS/Windows 全量检查、Canary 干净安装、`v0.12.1 -> 0.12.2-canary.35` 原地升级、profile 保留以及分发/feed artifacts 全部通过。动态证据见 [`docs/WINDOWS-UPDATE-VALIDATION.md`](docs/WINDOWS-UPDATE-VALIDATION.md)。
- 最终 main CI `31781915176` 与 Windows Release Gate `31781917106` 通过；稳定版合成灰度、`v0.12.1 -> v0.12.2` 原地升级和 `profilePreserved=true` 均已读回；
- `v0.12.2` 非 draft/prerelease Release 已发布 Setup、ZIP、full nupkg、`RELEASES` 和 SHA 清单；806,111,427 bytes 资产已在新临时目录回下载并全部通过清单校验，精确哈希见 [`docs/WINDOWS-UPDATE-VALIDATION.md`](docs/WINDOWS-UPDATE-VALIDATION.md)。

## 0.12.1 — 2026-08-14

M11.1 Goal Contract + Plan Review 私有 Engineering Alpha Release。`v0.12.0` Tag Gate 在 Windows 全量测试的临时目录清理阶段遇到一次 `runtime-lock` 释放竞态，停止于打包前，因此没有创建 GitHub Release 或发布资产；Tag 保留为失败审计记录，不移动、不复用。

### Added

- 新增版本化 Goal Contract：Desktop 将结果、约束和完成标准分开填写，Run Request v5 持久化结构化合同；
- 新增执行前 Plan Review：Orchestrator 先生成可审阅任务计划，Desktop 用户批准后 Worker 才启动，拒绝则保留审计记录并结束 Run；
- Plan Review 的 Goal、完整计划和 Run scope 由 SHA-256 绑定，pending/approved/rejected/cancelled 状态可跨应用重启恢复。

### Changed

- 将 GitHub Actions 升级到声明 Node 24 runtime 的当前主版本，关闭旧 Action 被 Runner 强制切换 runtime 的兼容性告警；
- CLI/Core 保持非交互执行，Desktop Main 才默认要求 Plan Review；旧只含裸 goal 的调用继续使用原执行文本，避免破坏 v1-v4 checkpoint 身份；
- Windows 安装版合成灰度新增真实 Plan Review 页面批准，并停止把没有显式添加的本地文件冒充为已读取资料。

### Fixed

- 大目录 checkpoint 恢复测试在断言终态后显式等待 Desktop manager 完全 idle，再由测试框架删除临时工作区，避免 Windows 偶发 `EPERM` 清理失败；产品锁的所有权和释放语义不变。

### Evidence

- `pnpm check`：152 项；macOS 本机 150 passed、2 项 Windows-only 合同按平台跳过、0 failed；批准、拒绝、重启恢复、批准指纹、决定审计修复和旧 checkpoint 兼容矩阵通过；
- macOS 源码 Electron 界面已实际读回 Goal Contract 三个输入区、完成标准启动门禁和 Guide 的“批准前 Worker 不启动”；本次未点击生成计划，没有真实 Provider 调用；
- macOS `0.12.1` DMG/ZIP 已通过版本、DMG 完整性、ad-hoc 签名、Fuse、ASAR、内置浏览器和无凭据首启；最终 App 还通过回环合成 Provider 的计划展示/批准、成功、双 Run 取消、checkpoint 恢复、重启历史和凭据脱敏矩阵，生产依赖审计无已知漏洞。
- main CI `31775318623` 与 Windows Release Gate `31775672269` 通过；`v0.12.1` Setup/ZIP 已发布并在新临时目录回下载通过 SHA-256 清单核验。

## 0.12.0 — not released

`v0.12.0` 只保留失败 Tag 审计：没有 GitHub Release、没有发布资产，功能最终由 `v0.12.1` 发布。

## 0.11.2 — 2026-08-14

M10.4 Explicit Research Sources 私有 Engineering Alpha Release。修复 Research 把运行目录误当资料库和恢复快照的根因；Windows-first Tag Release 已通过原生安装版合成灰度，资产已发布并完成回下载核验。

### Changed

- Research 的“运行位置”和“本次资料”拆为两个边界：运行位置只保存 `.localbuddy/runs` 与 Artifact，不再自动成为模型证据集；
- Desktop 新增按 Run 添加文件或资料目录的入口。未添加资料时不注册本地搜索/读取工具；资料目录只在 Agent 明确调用非空查询的 `search_files` 后按需搜索文件名；
- Planner 和 Worker 只接收 `source-1` 等逻辑资料引用，不接收绝对路径或运行目录清单；本地读取只允许落在明确选择的文件或资料目录内；
- Research checkpoint 保存明确资料身份，并只复核成功读取过的文件 SHA-256；运行目录中的无关文件、缓存和新增条目不再阻断恢复；
- 旧版 whole-workspace Research checkpoint fail closed，要求新建 Run 并明确添加资料，不继续旧的整目录扫描语义。

### Fixed

- 从根因上消除 `workspace snapshot exceeded the safe checkpoint entry limit`：启动、历史列表、应用重启对账和 resume 都不再扫描或哈希整个 Research 运行目录；
- 教程 Run 显式选择三份合成教程资料；切换运行位置或成功启动后清空本次资料，避免跨 Run 隐式继承；
- 修复并发 `start()` 可在容量检查与异步路径解析之间穿透全局 Run 上限的竞态；
- 被拒绝的恢复尝试写入脱敏的 `checkpoint.resume_blocked` 审计事件，不读取或记录资料正文；
- Artifact 数字闸门不再把 URL 和日期误判为未登记的派生计算。

### Security

- 将开发构建链中的 `nanoid` 约束到已修复的 `3.3.18`；生产依赖高危审计通过，完整审计只剩 Electron Forge 上游尚无修复版本的既有 `extract-zip` 告警。

### Evidence

- `pnpm check`：138 项；macOS 本机 136 passed、2 项 Windows-only 合同按平台跳过、0 failed；生产依赖高危审计通过；
- 1,050 个无关文件的失败 Research Run 可从同一 checkpoint 恢复成功；修改真正读取过的资料会阻断恢复，修改未读取资料或运行目录文件不会；
- macOS DMG：222,390,401 bytes，SHA-256 `f48c7c752a898700dab8379b4475f1ae67dc5fe2831c35f03b720678a5032488`；ZIP：221,174,198 bytes，SHA-256 `a77246a16a525685331d0e4f22703cd59f54d35c55c2a5046f765afa83a21444`；
- `pnpm verify:mac-package` 证明版本、DMG 完整性、strict-deep ad-hoc 签名、14 个相对 symlink、Fuse、ASAR、内置浏览器和 Renderer smoke；最终 `app.asar` SHA-256 为 `fcdef5c6ef210f20a4dc05181a4a232a38528b367140df4620d664bab423f194`；
- 最终打包 App 已在 macOS 实际重启，显式显示“运行位置”“本次资料”和“不扫描运行位置”，原生文件选择器可打开和取消。没有把既有 v3 whole-workspace Provider Run 冒充为 v4 explicit-sources 验收。
- 提交 `c9a7e4ab979ea7ef9760681f66e0e4a8a5962a8a` 的 [`v0.11.2` Release Gate `31767365053`](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/actions/runs/31767365053) 通过 Windows 原生构建、安装版合成灰度、恢复/重启矩阵和发布；Release 的 Setup 为 266,290,688 bytes、SHA-256 `6ac196352396069e8df4d5a25d52654c9358e7dd8617028d2f887ce990c5f77f`，ZIP 为 274,222,866 bytes、SHA-256 `241a72634e82c241d6d64bc74eb124b6ac68e247300eab2afad0a129bb3a428a`；三项资产已在新临时目录回下载，清单与 GitHub digest 一致。

## 0.11.1 — 2026-08-13

M10.3 Provider Setup 私有 Engineering Alpha。完成本机源码、测试、macOS 打包与安装验收，并将后续灰度与发布转为 Windows-first；Windows 11 真人灰度仍开放，不属于公开稳定版。

### Added

- 侧边栏一级“Provider 设置”和 DeepSeek/OpenAI 独立状态卡；
- 环境变量、系统安全存储、未配置三种凭据来源状态；
- 系统凭据替换，以及经 Electron 原生确认的删除流程；
- 用户显式触发、只请求 `/models` 的连接验证；
- Composer Provider 状态标签、缺失提示和启动前硬拦截。

### Changed

- Model 与 Base URL 移入 Provider 高级设置；“扩展配置”只保留 Skills、MCP 和 Browser；
- Bootstrap 和凭据写入 IPC 返回有界状态对象，不再只返回布尔值；
- 保存凭据不会自动联网，连接验证与真实 Run 分别需要独立用户动作。
- Windows Setup 文件名从 `package.json` 派生版本；Linux DEB 显式依赖提供 `secret-tool` 的 `libsecret-tools`；
- Windows 发布作业新增生产依赖高危审计；开发期 Electron 打包链的上游 `extract-zip` 无修复版本告警已如实登记，不做静默忽略。
- 包级首次启动 smoke 会清空 Provider 环境变量、隔离用户数据并屏蔽系统凭据命令，断言 Guide、DeepSeek/OpenAI 未配置状态以及连接/运行禁用门禁；Windows 原生构建与 Release 还必须先运行 Setup、从安装目录首启并调用 Squirrel 卸载。
- Electron Main 接入标准 Squirrel install/update/uninstall 生命周期处理，避免安装生命周期事件误开普通窗口。
- CI 调整为 Windows-first：Windows `pnpm check` 与安装级无 Provider 首启成为 PR 门禁，Linux 移至每周/手动的非阻塞维护；
- 新增 `windows-synthetic-gray` 夜间、手动和 PR label 工作流，以本地确定性 Provider 驱动真实安装版完成 Credential Manager、连接故障、Research Run、双 Run 取消、硬退出、checkpoint 恢复和重启循环；
- `v*` Tag Release 改为 Windows-only 门禁和资产发布；带预发布后缀的 Tag 自动创建 GitHub prerelease，Linux 不再阻塞 Windows RC；
- PR 不再上传约 800 MB 的完整 Forge 目录；只在 `main` 保存 Setup/ZIP，并缩短普通 CI artifact 保留期；
- Windows 全量测试先安装 Chromium；macOS-only/隔离宿主依赖用例逐项标记平台边界，同时新增 Windows 本地进程与 stdio MCP fail-closed 反向合同，并修复最近工作区测试的 Windows 路径兼容性；
- 取消测试在删除临时工作区前等待 `DesktopRunManager.waitForIdle()`，避免 Windows 在终态事件已发布但 `runtime-lock` 仍释放中时触发 `EPERM`；这不改变取消语义。

### Fixed

- macOS DMG 制作和验证脚本不再硬编码旧版本文件名，改为读取、校验 `package.json` 版本，并复核 App Bundle 版本一致。
- Composer 控制台改为紧凑的“任务输入 + 控制工具栏”：移除占高的字段标题与 16 列空栅格，Provider、信任、模式和并发只展示当前值，凭据与扩展入口使用短状态，执行按钮固定在右侧；窄窗口仅让工具项自然换行。

### Security

- Windows 合成灰度只使用 loopback Mock Provider 和固定公开夹具凭据，不读取 Actions secrets；测试前拒绝覆盖现有系统凭据，结束时删除测试项；
- 上传证据限定为脱敏 JSON 和固定夹具截图，不上传 Run Request、事件日志、工作区或凭据内容。

### Evidence

- 规格：[`docs/M10.3-SPEC.md`](docs/M10.3-SPEC.md)；
- 验收：[`docs/M10.3-VALIDATION.md`](docs/M10.3-VALIDATION.md)；
- `pnpm check`：当前 123 项；macOS 本机 121 passed、2 项 Windows-only 合同按平台跳过、0 failed；
- macOS 无 Provider 凭据包级首次启动 smoke 通过；[`windows-2025` 安装级 PR run `31665000997`](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/actions/runs/31665000997) 也已通过，Setup 退出码、安装目录 EXE、截图与 JSON artifact 均已核对；
- Windows-first 最终证据：[`ci` run `31670064596`](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/actions/runs/31670064596) 与 [`windows-synthetic-gray` run `31670064610`](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/actions/runs/31670064610) 均通过；后者覆盖 Credential Manager、完整连接故障矩阵、安装版 Research Run、双 Run 取消、硬退出恢复和 5 次额外重启；
- macOS DMG：224,991,198 bytes，SHA-256 `0a533b7d2397f40e82073697e0b026f243518c98198ef10625a6eecbffb46437`，挂载后包验证通过；
- [`v0.11.1` Release](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/releases/tag/v0.11.1)：Tag 固定在 `09c7be6`；Windows Release Gate `31675334513` 第 2 次尝试通过，Setup/ZIP 和 LF SHA-256 清单已发布并回下载核验。

## 0.11.0 — 2026-08-13

M10.2 First Trusted Run 私有 Engineering Alpha。macOS 内部包已完成本机验收；Windows 资产已由 `v0.11.0` Tag 的原生 workflow 构建、发布并回下载核验。本版本不属于公开分发。

### Added

- 永久可返回、完全本地且不调用模型的“指引与示例”会话；
- 按真实任务结果组织的教程、资料研究和安全 Coding 能力卡；
- 工作区、Git、Provider 可用性与人工控制准备检查，Renderer 只接收凭据布尔状态；
- 显式创建、唯一目录、不会覆盖旧文件的合成教程工作区；
- 三个只预填、不自动执行的有界任务模板；
- 由真实 Run/审批/集成/失败状态驱动的上下文提示。

### Changed

- 首次启动不再默认选择整个 Documents；没有明确工作区时保持未选择状态；
- 切换工作区会清空编辑器中的旧目标，避免跨工作区携带上下文；
- 指引偏好采用版本化、`0600` 私有本地状态，可关闭并永久重新打开。

### Evidence

- 规格：[`docs/M10.2-SPEC.md`](docs/M10.2-SPEC.md)；
- 验收：[`docs/M10.2-VALIDATION.md`](docs/M10.2-VALIDATION.md)；
- `pnpm check`：113/113 tests passed；
- macOS DMG：224,031,108 bytes，SHA-256 `379e8e49522c4f97cc22a436f0507675128ac395a4d994649c1b3d4924afb145`，挂载后包验证通过；
- [`main` CI](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/actions/runs/31622109045)：macOS 检查、Linux/Windows 合同与原生打包五项作业全部通过；
- [`v0.11.0` Release](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/releases/tag/v0.11.0)：Windows Setup/ZIP 和 LF SHA-256 清单已发布并回下载核验。

## 0.10.0 — 2026-08-13

M10.1 Internal Dogfood 版本。当前只完成本机源码、功能和 macOS 内部包验收；没有创建 Tag、GitHub Release 或公开分发。

### Added

- Run 级耗时、模型调用、Provider token、失败、Artifact Gate 重试和失败阶段投影；
- 最近工作区、校验后的文本 Artifact 内嵌预览，以及显式“基于此产物继续”组合器；
- 失败 Run 从同一安全 checkpoint 恢复，仅重试未完成 Task 链；
- Artifact Gate 可执行反馈与三次失败写入上限。

### Changed

- 诊断导出改用应用级原生保存流程，并保持 `0600` 文件权限；
- MCP stdio 启动失败增加有界、脱敏的子进程诊断；
- Electron 应用补齐点头品牌图标、DMG 背景和 Finder 布局。

### Fixed

- DMG 制作保留 Framework 相对符号链接，包验证新增挂载后 strict-deep 签名与不安全链接检查；
- 工作区进程锁释放/重获竞态；
- 跨 Agent 复用同一确定性计算时的错误冲突；
- 已提交 Integration 的撤销确认文案与实际 reverse commit 语义不一致。

### Evidence

- M10.1 验收：[`docs/M10-VALIDATION.md`](docs/M10-VALIDATION.md)；
- 本机实测：[`docs/DOGFOOD-2026-08-12.md`](docs/DOGFOOD-2026-08-12.md)；
- `pnpm check`：109/109 tests passed；
- macOS DMG：224,034,339 bytes，SHA-256 `20f7b80ece11ce125b8e4332f9351e8c8fe45c6613923048bb7e37c79aa7195b`，挂载后包验证通过。

## 0.9.0 — 2026-08-08

首个可安装的内部 Engineering Alpha。

### Added

- 多 Run、多 Task、多 Agent 并发运行时和 append-only 审计事件；
- Research/Coding 工作流、Git worktree 隔离、组合预检和人工集成 Gate；
- Research/Coding checkpoint resume、request replay、worktree 生命周期和精确恢复；
- DeepSeek/OpenAI Provider、本地/签名 Skills、MCP stdio/HTTP/OAuth 和受限 Browser；
- macOS Seatbelt、Linux 容器执行宿主、三档信任策略和跨进程容量/预算协调；
- Desktop Provider 凭证设置、Integration inline diff 和脱敏诊断导出；
- macOS ad-hoc ZIP/DMG、Linux DEB、Windows Squirrel Setup/ZIP 构建链；
- 私有 GitHub Release 中的 Windows Setup、便携 ZIP 和 SHA-256 清单。

### Evidence

- M10 验收：[`docs/M10-VALIDATION.md`](docs/M10-VALIDATION.md)；
- Release：[`LocalBuddy v0.9.0`](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/releases/tag/v0.9.0)；
- Tag 源提交：`38cefd8cd6045e64754dd60920bdfa3d50c2a9b7`。

### Known boundaries

- Windows 安装包未完成真机端到端验收，Windows 本地进程型工具 fail closed；
- macOS 包为 ad-hoc 签名，Windows 包未做代码签名；
- 生产第三方 MCP OAuth、公开分发签名与自动替换应用不在本版本验收范围。
