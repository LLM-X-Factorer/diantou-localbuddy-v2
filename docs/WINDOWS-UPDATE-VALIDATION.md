# Windows Update Validation

> 候选版本：`0.12.2`。本文只记录已经发生的证据；当前正式私有 Release 仍是 `v0.12.1`。

## 已实现合同

- `main` 成功构建上传按 Git SHA 可追踪的 Windows Canary Setup/ZIP 和独立 Squirrel feed artifact；
- Windows 快速同步脚本使用已认证 GitHub CLI，只接受成功 workflow，可固定 Run ID，并把便携包按 SHA 并存；
- 包内 `build-metadata.json` 与 Electron `app.getVersion()` 必须一致，UI 展示 channel、version 和 short SHA；
- Windows 安装版 updater 默认关闭，只有可信 feed 显式配置后才可检查；
- 更新下载完成后，活动 Run、启动中的 Run 或正在执行的 Integration 都会阻止退出安装；
- Windows CI 与 Tag Release 均定义上一稳定 Setup 到当前目标版本的原地升级、默认 profile 标记保留和新 UI 启动检查；
- Release 资产合同扩展为 Setup、便携 ZIP、`RELEASES`、full `.nupkg` 和 LF SHA-256 清单。

## 当前证据

| 层级 | 状态 | 证据边界 |
|---|---|---|
| TypeScript/静态合同 | 通过 | `pnpm check` 共 156 项：154 passed、2 项 Windows-only 跳过、0 failed；覆盖构建身份、更新状态机、不安全 feed、忙碌重启阻断和 workflow/PowerShell 合同 |
| macOS 本机开发构建 | 通过 | `pnpm build` 通过；`0.12.2` App/ZIP/DMG、ad-hoc 签名、DMG 完整性、Fuse、ASAR、内置浏览器和真实 Renderer 首启通过。首次回归还发现本地脏工作区只显示旧 HEAD 的歧义，现已改为显式 `+dirty`；不能运行 Windows Squirrel |
| Windows Server 2025 原生 CI | 首次失败，修复后待复验 | CI `31779620641` 的 Windows 全量检查和 Canary Setup 构建通过；首启烟测在 bootstrap 完成前读到默认构建身份并停止，原地升级未执行 |
| Windows 11 真机 | 未验收 | Canary 同步、稳定安装升级、Credential Manager、SmartScreen/UAC、真实 Provider |
| 生产更新源 | 未配置 | 没有可宣称上线的应用内自动更新服务 |

生产依赖审计未发现已知漏洞。完整开发依赖审计仍命中 Electron Forge 打包链中的 `extract-zip <= 2.0.1` symlink path traversal 公告；上游没有已修复版本。当前继续只在干净受控 Runner 打包，并保留该已知 Engineering Alpha 风险，不做静默 ignore。

首次 `main` CI `31779620641` 保留为失败证据：macOS 与 Windows 全量检查通过，Windows Setup 完成构建；干净首启烟测在较慢的 Windows bootstrap 返回前读取到 Renderer 默认 `unknown` 构建身份，严格断言因此停止。烟测现改为等待 bootstrap 返回的非 `unknown` 身份，不放宽真实性断言，等待下一次 Windows CI 复验。

## Windows 11 手工验收清单

1. 保留已安装 `v0.12.1`，用测试 Provider 和测试工作区创建可识别但不敏感的本地状态；
2. 运行 `pnpm windows:canary`，确认稳定版未被卸载，Canary 显示正确 channel/version/SHA；
3. 连续同步两次不同 SHA，确认两包并存、`current.json` 指向最新、旧包仍可回开；
4. 使用候选 Setup/feed 从 `v0.12.1` 原地升级，确认最近工作区、运行历史和系统凭据状态符合预期；
5. 在一个 Run 运行时准备更新，确认应用拒绝重启；结束 Run 后再次确认并升级；
6. 记录 Windows 版本、标准用户/管理员、SmartScreen、Defender、DPI、输入法、代理、安装/升级/卸载结果；
7. 导出脱敏证据，不上传 Prompt、API Key、工作区正文或 `.localbuddy/` 私有运行状态。

完成上述真机清单前，`0.12.2` 只能称为 Windows 更新候选，不称为 Windows 11 已验收或生产自动更新。
