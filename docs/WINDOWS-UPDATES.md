# Windows 开发更新与安装升级

> 状态：当前已发布基线是公开但未签名的 `v0.12.7` Engineering Alpha，仓库已采用 Apache License 2.0。`v0.12.4` 桥接版已让 packaged stable Windows 构建内置公开 GitHub Release 更新源；托管门禁持续验证上一稳定版原地升级、五项资产和公开 endpoint。`v0.12.3` 只有失败 Tag，没有 Release 或资产。代码签名和 Windows 11 上 `v0.12.6 -> v0.12.7` 的真人 OTA 仍是独立门禁。

## 一句话方案

Windows 开发者日常不需要反复卸载。代码推到 `main` 且 CI 通过后，在 Windows 仓库目录运行：

```powershell
pnpm windows:canary
```

脚本会用已登录的 GitHub CLI 下载最新成功构建的便携 ZIP，解压到按 Git SHA 隔离的目录，保留旧构建并启动新版本。它不会改动稳定版安装目录。

## 三条通道为什么必须分开

| 通道 | 解决的问题 | 做法 | 不能证明 |
|---|---|---|---|
| Canary 快速同步 | 今天的代码在 Windows 上能不能快速打开和试用 | 下载 CI 便携 ZIP，按 SHA 并存，使用独立 user-data | Setup 安装、卸载和原地升级 |
| 安装/升级门禁 | 新用户安装和老用户升级会不会坏 | CI 先做干净安装，再做 `上一稳定版 -> 当前候选版` 原地升级并检查用户数据 | Windows 11、SmartScreen、UAC 和真实网络 |
| 稳定版应用内更新 | 已安装用户能否在应用内检查并安全重启升级 | 公开 GitHub Release + Electron 官方 feed + 手动检查 + 下载完成后人工确认重启 | 未签名包的 SmartScreen 信誉，也不能替代 Windows 11 真人验收 |

如果每次只重装，我们只能证明“新装还能开”，反而会漏掉用户真正关心的旧数据、旧配置和升级路径。反过来，只跑 Canary 也会漏掉安装器问题。

## Canary 日常使用

前置条件：Windows x64、Node.js 22、pnpm 9.15.9、GitHub CLI 已登录且能读取仓库 Actions。

```powershell
gh auth status
pnpm windows:canary
```

默认状态位于：

- 构建：`%LOCALAPPDATA%\LocalBuddy-Canary\builds\<git-sha>`；
- 当前指针：`%LOCALAPPDATA%\LocalBuddy-Canary\current.json`；
- Chromium/Electron user-data：`%APPDATA%\LocalBuddy-Canary`。

需要复现某一次 CI 构建时：

```powershell
pwsh -NoLogo -NoProfile -File scripts/sync-windows-canary.ps1 -RunId 123456789
```

只下载、不启动：

```powershell
pwsh -NoLogo -NoProfile -File scripts/sync-windows-canary.ps1 -NoLaunch
```

Canary 的 UI 会显示 `channel + version + short SHA`，用于确认“我实际打开的是哪一包”。本地工作区含未提交修改时会额外显示 `+dirty`，不能把它冒充为精确提交构建。CI 为每次 `main` 构建生成唯一的 `X.Y.Z-canary.<run-number>` 版本，避免 Squirrel 把不同提交当成同一个版本。Canary 版本还必须高于最新稳定版：若仓库版本已经等于最新 Release，例如 `0.12.2`，发布后的下一包会自动进入 `0.12.3-canary.*`，不会尝试用较低的 `0.12.2-canary.*` 覆盖 `0.12.2`。

### 隔离边界

独立 `user-data` 隔离的是 Electron 界面状态，不代表整个 LocalBuddy 数据世界都隔离：

- Provider 凭证仍使用操作系统 Credential Manager；
- 工作区中的 `.localbuddy/` 仍属于所选工作区；
- 因此 Canary 应使用测试工作区，不要把同一工作区同时交给稳定版和 Canary 写入。

脚本不自动删除旧构建。需要清理时先退出所有 Canary，再根据 `current.json` 和 SHA 明确选择旧目录；不要对整个 `LocalBuddy-Canary` 根目录做递归清理。

## CI 的真实升级门禁

`main` 的 Windows 安装作业会执行两条独立链路：

1. 安装当前候选 Setup，在没有 Provider 凭证的隔离 user-data 中启动并读取 UI；
2. 下载最新稳定 Release 的 Setup，安装并使用默认用户数据目录启动；写入非敏感测试标记；再用当前候选的本地 Squirrel feed 原地升级，确认新版本 UI 启动且标记仍存在。

第二条链路只在一次性托管 Runner 上运行，脚本会拒绝覆盖已有 LocalBuddy 安装或用户目录，并只清理本次测试创建的路径。Tag Release 也必须重复 `上一稳定版 -> 目标稳定版` 的升级验证。

## 稳定版在线更新

`0.12.4` 不再要求普通用户设置环境变量。packaged、stable、Windows 构建会由 Main 固定使用以下只读服务地址，并带上运行中的版本和架构：

```text
https://update.electronjs.org/LLM-X-Factorer/diantou-localbuddy-v2/win32-x64/<current-version>
```

该服务从公开 GitHub Releases 解析下一稳定版；Renderer 仍不能修改更新源。Canary、beta、开发包和非 Windows 包默认不接稳定 feed。`LOCALBUDDY_UPDATE_FEED_URL` 只保留给打包验收时的显式 HTTPS/loopback 夹具，不作为用户配置或私有仓库鉴权方案。

`v0.12.2` 本身没有内置更新地址，因此已有用户必须对 `v0.12.4` 做最后一次手动原地安装；不需要先卸载。托管门禁持续验证 `v0.12.4 -> v0.12.5`、`v0.12.5 -> v0.12.6` 和 `v0.12.6 -> v0.12.7`，但只有在真实 Windows 11 上完成线上检查、下载、重启、版本读回和 profile 保留后，才可以宣称以后无需回仓库下载。

## 应用内更新的安全规则

Windows 安装包已经接入 Electron/Squirrel 更新控制器。`0.12.4` 起，正式 stable 包默认使用构建内置的公开 GitHub 更新源；其余 channel 默认关闭。验收覆盖使用的显式 feed 必须是 HTTPS，开发夹具可使用 loopback HTTP；URL 中禁止用户名、密码、query 和 hash，避免把 token 留在日志或进程参数中。

更新规则：

- 用户手动点击检查，不在后台擅自发起；
- Squirrel 可在应用仍打开时下载；
- 原生 Electron/Squirrel transport 不提供字节级进度。界面显示真实下载阶段、已等待时间和不确定进度动画，不伪造百分比；固定的 `releases/latest` 官方页为慢速/异常网络提供手动覆盖安装兜底；
- 下载完成后必须由用户确认重启；
- 有 Agent Run 正在启动/运行，或 Integration 正在写入主工作区时，拒绝退出安装；
- Renderer 不能设置 feed，也不能绕过 Main 的空闲检查；
- 当前没有静默安装、强制更新或自动回滚。

Release workflow 从 `0.12.2` 起发布 Setup、便携 ZIP、`RELEASES`、full NuGet package 和 SHA-256 清单。`0.12.4` 起，验收通过的 Windows 作业直接把这些长期分发资产上传到 GitHub Release，不再用受配额约束的临时 Actions Artifact 中转；脱敏截图/摘要仍是尽力保存的短期证据，不阻断已通过完整验证的正式资产发布。公开仓库的 Tag Release 还会从上一稳定版本请求 Electron feed，解析 JSON 并精确核对新版本 Setup 下载地址；full nupkg 与 `RELEASES` 由发布资产合同另行保证。`v0.12.4` 首次发布的旧冒烟把 full nupkg 错当作 JSON 响应且只等待五分钟，因而在 endpoint 刷新前约 42 秒标红；修复后的后续发布最多等待十分钟。代码签名和真实 Windows 11 OTA 仍是独立门禁，不能因为线上 endpoint 返回成功就写成“生产自动更新已验收”。

## 验收记录

当前代码与目标平台证据见 [`WINDOWS-UPDATE-VALIDATION.md`](WINDOWS-UPDATE-VALIDATION.md)。Windows 合成 Provider/恢复灰度仍见 [`WINDOWS-GRAY.md`](WINDOWS-GRAY.md)。
