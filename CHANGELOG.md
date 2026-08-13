# Changelog

本文件记录已经发布或准备发布的产品版本。里程碑范围和证据分别以 [`docs/ROADMAP.md`](docs/ROADMAP.md) 与对应的 `docs/M*-VALIDATION.md` 为准。

## Unreleased

暂无。

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
