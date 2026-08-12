# Changelog

本文件记录已经发布或准备发布的产品版本。里程碑范围和证据分别以 [`docs/ROADMAP.md`](docs/ROADMAP.md) 与对应的 `docs/M*-VALIDATION.md` 为准。

## Unreleased

暂无。

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
