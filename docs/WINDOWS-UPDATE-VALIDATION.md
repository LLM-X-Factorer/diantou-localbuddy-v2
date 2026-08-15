# Windows Update Validation

> 当前已发布版本：私有 `v0.12.2 / Windows Canary + Safe Updates` Engineering Alpha。未发布 `0.12.3` 候选已接入公开 GitHub Release feed 合同；仓库公开、桥接 Release、Windows 11 线上 OTA 与代码签名仍是开放门禁。

## 0.12.3 在线更新候选

- packaged stable Windows 根据运行时版本和架构固定生成 `update.electronjs.org/LLM-X-Factorer/diantou-localbuddy-v2/...` feed；Canary、beta、dev、非 Windows 和未打包构建不接稳定 feed；
- 显式 `LOCALBUDDY_UPDATE_FEED_URL` 继续只用于安全的 HTTPS/loopback 验收夹具，仍由 Coordinator 统一验证并在错误时 fail closed；
- Tag workflow 在公开仓库中发布资产后，以上一稳定版本请求线上 feed，最多等待五分钟并要求新 full nupkg 可见；私有仓库明确跳过该线上检查；
- `v0.12.2` 没有内置 feed，必须先手动原地安装一次桥接版；本地合同不能替代 `v0.12.3 -> 后续稳定版` 的真实 Windows 11 OTA。

当前候选在 macOS 本机通过 `pnpm check`：203 项中 201 passed、2 项 Windows-only 跳过、0 failed；`pnpm build` 通过，Renderer 为 18 modules、44.90 kB CSS、255.93 kB JS；`pnpm audit --prod --audit-level high` 未发现已知漏洞，`git diff --check` 通过。`gitleaks 8.30.1` 对 42 个历史提交及当前 tracked/untracked 候选分别做全量脱敏扫描，均为 0 finding。以上只证明源码、合同、构建和公开前凭证审计，不证明 Release、线上 endpoint 或真机升级。

## 已实现合同

- `main` 成功构建上传按 Git SHA 可追踪的 Windows Canary Setup/ZIP 和独立 Squirrel feed artifact；
- Windows 快速同步脚本使用已认证 GitHub CLI，只接受成功 workflow，可固定 Run ID，并把便携包按 SHA 并存；
- 包内 `build-metadata.json` 与 Electron `app.getVersion()` 必须一致，UI 展示 channel、version 和 short SHA；
- Windows 安装版 updater 在 stable 正式包内使用固定公开 feed，其余 channel 默认关闭；验收可显式提供受限 feed；
- 更新下载完成后，活动 Run、启动中的 Run 或正在执行的 Integration 都会阻止退出安装；
- Windows CI 与 Tag Release 均定义上一稳定 Setup 到当前目标版本的原地升级、默认 profile 标记保留和新 UI 启动检查；
- Release 资产合同扩展为 Setup、便携 ZIP、`RELEASES`、full `.nupkg` 和 LF SHA-256 清单。

## 当前证据

| 层级 | 状态 | 证据边界 |
|---|---|---|
| TypeScript/静态合同 | 通过 | `pnpm check` 共 157 项：155 passed、2 项 Windows-only 跳过、0 failed；覆盖构建身份、Canary 高于最新稳定版、更新状态机、不安全 feed、忙碌重启阻断和 workflow/PowerShell 合同 |
| macOS 本机开发构建 | 通过 | `pnpm build` 通过；`0.12.2` App/ZIP/DMG、ad-hoc 签名、DMG 完整性、Fuse、ASAR、内置浏览器和真实 Renderer 首启通过。首次回归还发现本地脏工作区只显示旧 HEAD 的歧义，现已改为显式 `+dirty`；不能运行 Windows Squirrel |
| Windows Server 2025 原生 CI | 通过 | CI `31784118614`：macOS/Windows 157 项合同、`0.12.3-canary.39` Setup/ZIP、干净安装首启、`v0.12.2 -> 0.12.3-canary.39` 原地升级、profile 保留和两类 Canary artifact 全部通过 |
| Windows Tag Release | 通过 | Gate `31781917106`：生产依赖审计、156 项合同、安装版合成灰度、`v0.12.1 -> v0.12.2` 原地升级/profile 保留、五项 Release 资产和发布作业全部通过 |
| Windows 11 真机 | 未验收 | Canary 同步、稳定安装升级、Credential Manager、SmartScreen/UAC、真实 Provider |
| 生产更新源 | 候选已接线、未上线 | `0.12.3` 源码已生成公开 GitHub feed；仓库仍私有，尚无桥接 Release、线上读回或真机 OTA |

生产依赖审计未发现已知漏洞。完整开发依赖审计仍命中 Electron Forge 打包链中的 `extract-zip <= 2.0.1` symlink path traversal 公告；上游没有已修复版本。当前继续只在干净受控 Runner 打包，并保留该已知 Engineering Alpha 风险，不做静默 ignore。

首次 `main` CI `31779620641` 保留为失败证据：macOS 与 Windows 全量检查通过，Windows Setup 完成构建；干净首启烟测在较慢的 Windows bootstrap 返回前读取到 Renderer 默认 `unknown` 构建身份，严格断言因此停止。烟测随后改为等待 bootstrap 返回的非 `unknown` 身份，没有放宽真实性断言。

发布后的文档提交 CI `31783524153` 也保留为失败证据：全量 Windows/macOS 合同、Canary 构建和干净安装均通过，但流水线把已经发布的 `0.12.2` 生成成 `0.12.2-canary.38`，Squirrel 正确拒绝把稳定版降级为同号 prerelease。修复不是跳过升级门禁，而是让 CI 读取最新稳定 Tag：仓库版本不高于稳定版时，Canary 自动进入下一 patch 线，并新增 `0.12.2 + v0.12.2 -> 0.12.3-canary.38` 回归合同。

修复 CI `31784118614` 已完成发布后场景复验：干净安装与 UI 启动通过，`LocalBuddy-0.12.2-Setup.exe -> app-0.12.3-canary39` 原地升级通过，脱敏升级摘要记录 `targetVersion=0.12.3-canary.39`、`profilePreserved=true`，随后分发包和 Squirrel feed artifact 均上传成功。

修复后的 `main` CI `31780762643` 已复验完整链路：干净安装 UI 读回 `CANARY / v0.12.2-canary.35 / 5251353f`；随后从 `LocalBuddy-0.12.1-Setup.exe` 安装的稳定版通过本地 Squirrel feed 升级，新版本 UI 再次读回同一身份，非敏感 profile 标记保留。GitHub 保存了 120,114-byte 干净首启证据、244,068-byte 升级证据、540,102,786-byte Canary 分发 artifact 和 265,242,749-byte feed artifact。

## v0.12.2 Release 读回

- annotated Tag `v0.12.2` 解引用到 `7c1ce1f18ed1e9a838444ef04e08e17dfb123f95`；Release 非 draft、非 prerelease；
- Release Gate `31781917106` 的合成灰度覆盖 Credential Manager、故障矩阵、真实安装版 Research Run、Plan Review、双 Run 取消、checkpoint 恢复、重启历史和凭据脱敏；
- 升级摘要明确记录 `LocalBuddy-0.12.1-Setup.exe -> app-0.12.2`、`profilePreserved=true`，更新后 UI 读回 `STABLE / v0.12.2 / 7c1ce1f1`；
- 五项 Release 资产已下载到新的临时目录，`shasum -a 256 -c SHA256SUMS-windows.txt` 全部通过：

| 资产 | Bytes | SHA-256 |
|---|---:|---|
| `LocalBuddy-0.12.2-Setup.exe` | 266,301,440 | `1e0289ba5b56a0a2e61a60d523ababaf8703bfa48895d9d05424143a1612ae3b` |
| `LocalBuddy-win32-x64-0.12.2.zip` | 274,231,953 | `92c736fc26d9363fe54545c58912102ee6e870f6cd051194331d3a76348654df` |
| `LocalBuddy-0.12.2-full.nupkg` | 265,577,590 | `65ff2b654ba2726ca0dc502a4d65200b1e93617b0bacc54727de5ea254952699` |
| `RELEASES` | 82 | `1f4fac7d5c11d9c22be2b09bf9ff720df296b02abf4e22a9838f5bd76e4fa9a9` |
| `SHA256SUMS-windows.txt` | 362 | `85142e7dd5cb0771becf0f92039d98b467fe28548515ff8b9e3fc28c53f4b358` |

## Windows 11 手工验收清单

1. 保留已安装 `v0.12.1`，用测试 Provider 和测试工作区创建可识别但不敏感的本地状态；
2. 运行 `pnpm windows:canary`，确认稳定版未被卸载，Canary 显示正确 channel/version/SHA；
3. 连续同步两次不同 SHA，确认两包并存、`current.json` 指向最新、旧包仍可回开；
4. 使用后续候选 Setup/feed 从当前稳定版原地升级，确认最近工作区、运行历史和系统凭据状态符合预期；
5. 在一个 Run 运行时准备更新，确认应用拒绝重启；结束 Run 后再次确认并升级；
6. 记录 Windows 版本、标准用户/管理员、SmartScreen、Defender、DPI、输入法、代理、安装/升级/卸载结果；
7. 导出脱敏证据，不上传 Prompt、API Key、工作区正文或 `.localbuddy/` 私有运行状态。

完成上述真机清单前，`v0.12.2` 只能称为私有 Engineering Alpha，不称为 Windows 11 已验收或生产自动更新。
