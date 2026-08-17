# Windows Update Validation

> 当前已发布版本：公开但未签名的 `v0.12.5 / Public Bug Reporting + Product Truth` Engineering Alpha。`v0.12.3` 只有失败 Tag，没有 Release 或资产。托管发布门禁覆盖 `v0.12.4 -> v0.12.5`，但 Windows 11 上同一路径的真实线上 OTA 与代码签名仍是开放门禁。

## 0.12.5 Public Bug Reporting + Product Truth

本版本新增用户主动触发的公开安全问题报告：Main 只接收结构化失败投影，公共报告模块按字段白名单生成脱敏预览和稳定签名；Renderer 必须先展示预览并取得明确同意，之后只能保存同一份本地 Markdown 或打开预填 GitHub Issue 页面。报告不附带原始诊断、Prompt、Artifact、工具参数、Provider 配置、绝对路径或完整本机标识。

实现提交 `71c2ecbf9e1e488f7d5e750e6c50991d9e64f0ea` 经 [PR #13](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/pull/13) 合入 `f63b0e7d6c636771bc64739d834248971fd7a09d`。PR CI `32015093298` 的 macOS 回归、Windows 全量合同和 Windows 干净安装首启通过；PR 条件没有执行上一稳定版升级，因此不能把该 PR 写成 `v0.12.4 -> v0.12.5` 已通过。macOS 本机在合并前通过 `pnpm check`：214 项中 212 passed、2 项 Windows-only 跳过、0 failed；`pnpm build` 和生产依赖高危审计通过。真实 Electron 开发窗口已读回警告、脱敏预览、稳定签名、默认未同意和禁用的 GitHub 按钮，预览中没有测试输入的 `/Users/` 绝对路径。

`v0.12.5` 发布分支再次完成 frozen install、`pnpm check`（214 项中 212 passed、2 项 Windows-only 跳过、0 failed）、`pnpm build`、生产依赖审计和 `git diff --check`。`pnpm audit --prod --audit-level high` 返回无已知漏洞；完整 `pnpm audit --audit-level high` 仍只命中 Electron Forge 7.11.2 经 `@electron/packager` 引入的 `extract-zip 2.0.1` symlink path traversal 公告 `GHSA-jmr9-qjv8-65gv`，报告的 patched versions 为 `<0.0.0`。该开发期打包风险继续只在干净受控 Runner 中承担，不进入运行时依赖，也不通过 ignore 伪装为全绿。

主分支 `.github/ISSUE_TEMPLATE/bug-report.yml` 已通过公开 Contents API 回读；无鉴权预填 Issue URL 返回 HTTP 200 登录页并完整保留 `return_to`。合成 Issue [#14](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/issues/14) 只含虚构数据、`bug` 标签和测试签名，创建后完成标题、正文、标签和状态回读，并于 2026-08-17 关闭保留审计。以上证明公开提交入口可达，不等于真实用户已经提交反馈。

固定 Release Tag 还必须在 Windows Server 2025 完成生产依赖审计、全量合同、安装版合成灰度、`v0.12.4 -> v0.12.5` 原地升级/profile 保留、五项资产发布/回下载和公开 updater endpoint 精确 URL 回读。实际 workflow、Tag 提交、资产字节数和 SHA-256 在发布后追加到本文；任何失败保留为不可改写的发布证据。

## 0.12.4 公开更新桥接版

- packaged stable Windows 根据运行时版本和架构固定生成 `update.electronjs.org/LLM-X-Factorer/diantou-localbuddy-v2/...` feed；Canary、beta、dev、非 Windows 和未打包构建不接稳定 feed；
- 显式 `LOCALBUDDY_UPDATE_FEED_URL` 继续只用于安全的 HTTPS/loopback 验收夹具，仍由 Coordinator 统一验证并在错误时 fail closed；
- Tag workflow 在公开仓库中发布资产后，以上一稳定版本请求线上 feed；后续发布会最多等待十分钟、解析 JSON 并精确核对新版本 Setup 地址，full nupkg 与 `RELEASES` 由发布资产合同单独保证；
- `v0.12.2` 没有内置 feed，必须先手动原地安装一次桥接版；本地合同不能替代 `v0.12.4 -> 后续稳定版` 的真实 Windows 11 OTA。

发布提交在 macOS 本机通过 `pnpm check`：204 项中 202 passed、2 项 Windows-only 跳过、0 failed；`pnpm build`、`pnpm audit --prod --audit-level high` 和 `git diff --check` 通过。终态/运行锁恢复与 Plan Review 文件在完整测试基础上连续 10 轮通过，触发发布失败的单项恢复案例另连续 25 轮通过。以上本机证据证明源码、合同、构建和时序回归；Release 与 endpoint 另以线上回读为准，仍不证明真机升级。

PR #6 首轮 Windows 全量测试暴露一条只接受 LF 的源码合同；Windows checkout 的 CRLF 导致该断言失败，产品逻辑未失败。断言改为同时接受 LF/CRLF 后，本机 203 项复验通过。第二轮 Windows 构建和干净安装通过，但上传临时首启证据时命中 GitHub Actions artifact quota；44 个已结束作业中大于 10 MiB、可由固定提交重建的旧临时包已按明确 ID 删除，共 21,056,090,408 bytes。PR 不再重复上传安装证据，push/main 和 Tag Gate 仍保留脱敏证据尝试。

合并提交 `c158fd2fa02efe473b10d0905d3ac2202be7dad8` 的 `main` CI `31877363554` 在 Windows Server 2025 完成干净安装，并把 `LocalBuddy-0.12.2-Setup.exe` 原地升级到 `0.12.3-canary.45`；日志读回 `profilePreserved=true`。作业随后仅在上传两份临时 Actions Artifact 时因配额停止，Canary 分发/Feed 上传未执行，因此整条 CI 必须保留为红色外部存储失败，不能写成全绿。两份上一轮、可由固定提交重建的 Canary/Feed Artifact（ID `9213130027`、`9213135624`）随后删除约 805 MB；正式 Release、Tag、源码和校验和未删除，API 读回剩余 48 项约 7.1 MB，但 GitHub 需要 6-12 小时重算配额。

这次失败暴露正式发布不应依赖临时 Artifact 配额。`0.12.4` 把 Setup、ZIP、full nupkg、`RELEASES` 和清单保留在同一 Windows Runner，完成 Tag/版本与 SHA-256 复核后直接上传 GitHub Release；脱敏截图和摘要仍尽力上传，但配额失败不会绕过或替代功能门禁，也不会再阻断已验证正式资产。

合并提交 `3fbcbf3abb1e45aac4fd9ac80cd7df24d1d68b14` 的 `main` CI `31878390204` 全绿：Windows/macOS 全量合同、干净安装和 `v0.12.2 -> 0.12.3-canary.47` 原地升级均通过，UI 读回 `CANARY v0.12.3-canary.47 · 3fbcbf3a`，升级摘要为 `profilePreserved=true`。随后固定在同一提交的 `v0.12.3` Release Gate `31878639876` 在 Windows `pnpm check` 中暴露测试生命周期竞态：测试收到 `run.succeeded` 后立即删除临时工作区，而 `runtime-lock` 仍在异步释放，触发 `EPERM`。流水线停止于打包前，没有创建 Release 或资产；Tag 不移动、不复用。`0.12.4` 将终态通知收紧为锁已释放且 Run 已注销，并让同类测试显式等待 manager idle。

修复合并提交 `b9f1082772e43c13bde3fe0651ec41412bd1a1db` 的 `main` CI `31879482738` 全绿：macOS 与 Windows 全量合同通过，Windows 干净安装和 `v0.12.2 -> 0.12.4-canary.49` 原地升级通过，UI 读回 `CANARY v0.12.4-canary.49 · b9f10827`，升级摘要为 `profilePreserved=true`。

固定在同一提交的 `v0.12.4` Release workflow `31879716752` 中，Windows 发布作业 `95000490148` 通过生产依赖审计、204 项合同、stable 构建、安装版确定性 Provider 灰度、`v0.12.2 -> v0.12.4` 原地升级和五项资产复核，并直接创建 GitHub Release。独立 `online-update-smoke` 作业 `95001024268` 仍以旧合同在服务 JSON 中寻找 full nupkg，且五分钟缓存窗口比实际刷新少约 42 秒，因此整体 workflow 保留红色。随后对公开地址的无鉴权请求返回 HTTP 200、名称 `LocalBuddy v0.12.4` 和精确 Setup URL。该错误检查不会通过重跑、移动 Tag 或替换资产抹掉；后续 workflow 改为解析 JSON、核对 Setup URL 并等待十分钟。

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
| TypeScript/静态合同 | 通过 | `pnpm check` 共 204 项：202 passed、2 项 Windows-only 跳过、0 failed；覆盖构建身份、Canary 高于最新稳定版、更新状态机、不安全 feed、忙碌重启阻断、终态后运行锁清理和 workflow/PowerShell 合同 |
| macOS 本机开发构建 | 通过 | `pnpm build` 通过；`0.12.2` App/ZIP/DMG、ad-hoc 签名、DMG 完整性、Fuse、ASAR、内置浏览器和真实 Renderer 首启通过。首次回归还发现本地脏工作区只显示旧 HEAD 的歧义，现已改为显式 `+dirty`；不能运行 Windows Squirrel |
| Windows Server 2025 原生 CI | 通过 | CI `31879482738`：macOS/Windows 204 项合同、`0.12.4-canary.49` Setup/ZIP、干净安装首启、`v0.12.2 -> 0.12.4-canary.49` 原地升级和 `profilePreserved=true` 全部通过 |
| Windows Tag Release | 资产发布通过；后置冒烟合同失败 | workflow `31879716752` 的 Windows 作业通过 204 项合同、stable 灰度、`v0.12.2 -> v0.12.4` 升级和五项资产发布；独立线上作业因错误期待 full nupkg JSON 且等待窗口短 42 秒而失败，失败记录保留 |
| Windows 11 真机 | 未验收 | Canary 同步、稳定安装升级、Credential Manager、SmartScreen/UAC、真实 Provider |
| 生产更新源 | 桥接版与公开 endpoint 已上线，真机 OTA 未验收 | `v0.12.4` 已公开；从 `0.12.2` 请求 endpoint 返回 HTTP 200 和精确 Setup URL。尚无 `v0.12.4 -> 后续稳定版` 的 Windows 11 检查、下载、重启和 profile 保留证据 |

生产依赖审计未发现已知漏洞。完整开发依赖审计仍命中 Electron Forge 打包链中的 `extract-zip <= 2.0.1` symlink path traversal 公告；上游没有已修复版本。当前继续只在干净受控 Runner 打包，并保留该已知 Engineering Alpha 风险，不做静默 ignore。

首次 `main` CI `31779620641` 保留为失败证据：macOS 与 Windows 全量检查通过，Windows Setup 完成构建；干净首启烟测在较慢的 Windows bootstrap 返回前读取到 Renderer 默认 `unknown` 构建身份，严格断言因此停止。烟测随后改为等待 bootstrap 返回的非 `unknown` 身份，没有放宽真实性断言。

发布后的文档提交 CI `31783524153` 也保留为失败证据：全量 Windows/macOS 合同、Canary 构建和干净安装均通过，但流水线把已经发布的 `0.12.2` 生成成 `0.12.2-canary.38`，Squirrel 正确拒绝把稳定版降级为同号 prerelease。修复不是跳过升级门禁，而是让 CI 读取最新稳定 Tag：仓库版本不高于稳定版时，Canary 自动进入下一 patch 线，并新增 `0.12.2 + v0.12.2 -> 0.12.3-canary.38` 回归合同。

修复 CI `31784118614` 已完成发布后场景复验：干净安装与 UI 启动通过，`LocalBuddy-0.12.2-Setup.exe -> app-0.12.3-canary39` 原地升级通过，脱敏升级摘要记录 `targetVersion=0.12.3-canary.39`、`profilePreserved=true`，随后分发包和 Squirrel feed artifact 均上传成功。

修复后的 `main` CI `31780762643` 已复验完整链路：干净安装 UI 读回 `CANARY / v0.12.2-canary.35 / 5251353f`；随后从 `LocalBuddy-0.12.1-Setup.exe` 安装的稳定版通过本地 Squirrel feed 升级，新版本 UI 再次读回同一身份，非敏感 profile 标记保留。GitHub 保存了 120,114-byte 干净首启证据、244,068-byte 升级证据、540,102,786-byte Canary 分发 artifact 和 265,242,749-byte feed artifact。

## v0.12.4 Release 读回

- annotated Tag `v0.12.4` 解引用到 `b9f1082772e43c13bde3fe0651ec41412bd1a1db`；Release 于 2026-08-15 发布，非 draft、非 prerelease；
- Windows 发布作业完成生产依赖审计、stable 安装版合成灰度、`v0.12.2 -> v0.12.4` 升级和 `profilePreserved=true`；
- 五项 Release 资产已下载到新的临时目录，清单中的四项文件全部通过 `shasum -a 256 -c SHA256SUMS-windows.txt`；清单自身哈希也与 GitHub digest 一致：

| 资产 | Bytes | SHA-256 |
|---|---:|---|
| `LocalBuddy-0.12.4-Setup.exe` | 266,484,224 | `665d4674997e70d69fa8a3be39aa46266e97501ea65e7621f078a435188eda34` |
| `LocalBuddy-win32-x64-0.12.4.zip` | 274,423,175 | `b964204fc02bd8ebe31aab657af63bcc53fc9254829f3d23c739ed15502821e4` |
| `LocalBuddy-0.12.4-full.nupkg` | 265,761,246 | `c9f6dd4647ddcea9b560f1796def59e814381311085fdf802c7f33f11bcb84b6` |
| `RELEASES` | 82 | `8be21cb002cb03a2b415da405d5ed90e4251a3af50f53e7f7e6cb4cbba7c51ba` |
| `SHA256SUMS-windows.txt` | 362 | `57cf6a12c64b969373dc04e930d65e97d10a85d2faabeda1cf5cadca3275f1d7` |

公开 endpoint `https://update.electronjs.org/LLM-X-Factorer/diantou-localbuddy-v2/win32-x64/0.12.2` 已无鉴权返回 HTTP 200，并把 `url` 指向 `LocalBuddy-0.12.4-Setup.exe`。这只证明服务端可发现桥接版本；`v0.12.2` 自身没有内置 feed，且没有 Windows 11 从 `v0.12.4` 升级到后续稳定版的真实证据。

## v0.12.2 Release 历史读回

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

完成上述真机清单前，`v0.12.5` 只能称为公开但未签名的 Engineering Alpha，不称为 Windows 11 已验收或生产自动更新。
