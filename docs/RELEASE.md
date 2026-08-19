# LocalBuddy V2 Release Runbook

> 当前发布目标：`v0.13.0 / User-first Workflows Engineering Alpha`；当前公开但未签名的 Release 仍为 `v0.12.8 / First-party Windows Update Feed`。本次版本文档、Git push、annotated Tag 和 Windows-first Release 已由唯一当前用户明确授权；只有门禁与发布后回读完成后才能把目标写成已发布。

## 1. 发布真源

- 版本号：`package.json`；
- 版本历史：[`../CHANGELOG.md`](../CHANGELOG.md)；
- 里程碑状态：[`ROADMAP.md`](ROADMAP.md)；
- 证据：对应 `M*-VALIDATION.md`；
- Windows-first 自动发布：`.github/workflows/release.yml`；
- Windows 合成灰度合同：[`WINDOWS-GRAY.md`](WINDOWS-GRAY.md)；
- Windows Canary、安装升级与应用内更新合同：[`WINDOWS-UPDATES.md`](WINDOWS-UPDATES.md)；
- 仓库公开、许可证、历史元数据与线上 updater 门禁：[`PUBLIC-REPOSITORY-READINESS.md`](PUBLIC-REPOSITORY-READINESS.md)；
- 安装包配置：`forge.config.cjs`。

同一动态状态只在上述 owner 文件维护；README 只提供摘要和入口。

## 2. 发布前

1. 确认目标版本和里程碑边界，不把外部门禁写成已完成；
2. 确认 `git status --short` 只有本次授权文件；
3. 运行：

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm audit --prod --audit-level high
pnpm audit --audit-level high
git diff --check
```

生产依赖审计必须通过。完整审计同时覆盖打包工具；任何告警都必须写入当前 Validation 并在 Tag 前复查，不能通过静默 ignore 伪装成全绿。当前发布证据与边界见 [`WINDOWS-UPDATE-VALIDATION.md`](WINDOWS-UPDATE-VALIDATION.md) 和 [`KNOWN-LIMITATIONS.md`](KNOWN-LIMITATIONS.md)。

4. 检查仓库中没有 Provider Key、用户 Prompt、`.localbuddy/` 运行状态和私有 Artifact；
5. 更新 Changelog、Roadmap、Known Limitations 和对应 Validation；
6. 提交后确认 `main` CI 全绿。

macOS 内部包还需在 macOS arm64 主机运行：

```bash
pnpm make:mac
pnpm verify:mac-package
```

这只证明 ad-hoc 内部包，不证明公开签名和公证。

## 3. Windows-first Tag Release

在用户明确批准后，从已经通过 CI 的提交创建 annotated Tag：

```bash
git tag -a vX.Y.Z -m "LocalBuddy vX.Y.Z"
git push origin main
git push origin vX.Y.Z
```

`v*` Tag 必须与 `package.json` 的 `vX.Y.Z` 完全一致，并启动 Windows 原生发布门禁：

1. frozen install、生产依赖高危审计和完整 `pnpm check`；
2. `pnpm make:win` 构建 Setup、便携 ZIP、`RELEASES` 和 full `.nupkg`；
3. 下载上一稳定版 Setup，通过本地 Squirrel feed 原地升级到目标版本，并确认默认 profile 数据与新版本 UI；
4. 安装真实目标 Setup，并执行 [`WINDOWS-GRAY.md`](WINDOWS-GRAY.md) 定义的 Credential Manager、Mock Provider、故障、Research Run、双 Run 取消、硬退出恢复与重启矩阵；
5. 为 Setup、便携 ZIP、`RELEASES` 和 full `.nupkg` 生成 UTF-8、LF 行尾的 `SHA256SUMS-windows.txt`；
6. 同一 Windows 作业复核 Tag/包版本和 Windows SHA-256 后直接创建或更新 GitHub Release，不通过临时 Actions Artifact 中转正式二进制；
7. `vX.Y.Z-rc.N` 等带预发布后缀的 Tag 自动标记为 prerelease。

从 `v0.12.8` 起，稳定 Windows x64 包把 `https://github.com/<owner>/<repo>/releases/latest/download` 作为内置只读 feed。公开 Tag Release 的独立 `online-update-smoke` 作业会在 Windows Runner 安装上一稳定版，通过公网 `RELEASES` 和 full nupkg 完成原地升级，再读回目标 UI 与 profile 标记；Setup、ZIP、full nupkg、`RELEASES` 和清单仍由 Windows 发布作业分别复核。不能把带鉴权的 Release API、单次 curl 或本地 feed 冒充普通用户可用的更新链路。

`v0.12.2` 没有内置 feed，因此首次启用在线更新必须发布一个需要手动原地安装的桥接版本。桥接后的下一稳定版才是线上 OTA 真正验收目标；只验证 endpoint 或 CI 本地 feed 不等于用户升级成功。

Windows 安装版的脱敏摘要和固定夹具截图会尽力作为短期 Actions Artifact 上传；临时存储配额不足时保留日志中的验证结果，但不允许绕过构建、灰度、原地升级、校验和或正式 Release 上传。Run Request、事件日志、工作区和凭据内容始终不上传。托管 Runner 不依赖固定 Windows 测试机，但仍不能验证 SmartScreen、Defender、标准用户/UAC、DPI、输入法和真实网络。

Linux 不再进入 Tag Release。`.github/workflows/linux-maintenance.yml` 只保留每周/手动构建，既不发布资产也不阻塞 Windows 候选。

当前 workflow 使用 `--clobber` 以允许故障恢复，但正常发布策略是 Tag 和二进制不可变：已经公开或交付的版本出现问题，应发布新的 patch 版本，不移动旧 Tag、不静默替换旧二进制。

## 4. 发布后验收

1. 确认 Release 不是 draft/prerelease，Tag 指向预期提交；
2. 下载全部资产到新的临时目录；
3. 用 Release 清单重新计算并验证 SHA-256；
4. 核对 GitHub asset digest、文件字节数和清单；
5. 在真实 Windows 11 设备执行安装、从上一稳定版升级、启动、凭证、真实 Provider Run、忙碌时更新阻断、恢复和卸载矩阵；
6. 若仓库已公开，从上一稳定版通过第一方 GitHub Release feed 完成 `Update.exe` 下载、安装、目标 UI 和 profile 读回；随后仍在真实 Windows 11 安装版完成应用内检查、下载、重启和版本读回；
7. 把真实结果写入 Validation 和 [`DOGFOOD.md`](DOGFOOD.md)。

发布后的下一次 `main` CI 会读取最新稳定 Tag。若 `package.json` 仍等于该稳定版，Canary 自动使用下一个 patch 的预发布版本，例如 `v0.12.2` 之后生成 `0.12.3-canary.*`；这样文档提交也不会因为 Squirrel 拒绝稳定版降级为同号 prerelease 而失败。

第 5 步当前未完成，不能由 Windows Server 2025 Runner 替代。Linux 图形桌面当前不属于 Windows-first 发布门禁。

## 5. 回滚与修复

- 平台无关的 Ed25519 更新协议仍只 staging；`v0.12.8` 起的 stable Windows x64 包内置第一方 GitHub Release feed，其余 channel 默认关闭，当前没有强制更新；
- 发现错误资产时停止传播，保留证据并判断是否属于未交付的发布恢复；
- 已交付版本使用新的 patch 版本修复，不重写 Git 历史；
- 集成代码回滚使用普通 revert commit，不 amend 已推送提交；
- Release 事实变化后同步 Changelog、Known Limitations 和 Validation。

`v0.12.4` 的桥接发布、`v0.12.5-v0.13.0` 的本地原地升级、Release 资产、第三方 endpoint 失败和第一方公网 feed 证据见 [`WINDOWS-UPDATE-VALIDATION.md`](WINDOWS-UPDATE-VALIDATION.md)；旧 Release 不回写、不替换；Linux 资产不进入 Windows-first Tag Release。
