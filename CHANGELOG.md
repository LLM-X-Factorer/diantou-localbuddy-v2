# Changelog

本文件记录已经发布或准备发布的产品版本。里程碑范围和证据分别以 [`docs/ROADMAP.md`](docs/ROADMAP.md) 与对应的 `docs/M*-VALIDATION.md` 为准。

## Unreleased

### Documentation

- 将 `v0.9.0 / M10` 固定为 Engineering Alpha 里程碑；
- 同步 README、Roadmap 与 Architecture 的 M10 当前事实；
- 补充内部试用、已知限制、发布流程和 dogfooding 入口；
- 明确 Windows 原生 Runner 构建不等于 Windows 真机端到端验收。

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
