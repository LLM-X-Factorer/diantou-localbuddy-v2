# LocalBuddy V2 Release Runbook

> 当前私有 Release：`v0.12.2 / Windows Canary + Safe Updates Engineering Alpha`，并继续包含 M11.1 Goal Contract + Plan Review。Git push、Tag 和 Release 都是外部状态变更，必须获得用户明确授权。

## 1. 发布真源

- 版本号：`package.json`；
- 版本历史：[`../CHANGELOG.md`](../CHANGELOG.md)；
- 里程碑状态：[`ROADMAP.md`](ROADMAP.md)；
- 证据：对应 `M*-VALIDATION.md`；
- Windows-first 自动发布：`.github/workflows/release.yml`；
- Windows 合成灰度合同：[`WINDOWS-GRAY.md`](WINDOWS-GRAY.md)；
- Windows Canary、安装升级与应用内更新合同：[`WINDOWS-UPDATES.md`](WINDOWS-UPDATES.md)；
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
6. 发布作业复核 Tag/包版本和 Windows SHA-256 后创建或更新 GitHub Release；
7. `vX.Y.Z-rc.N` 等带预发布后缀的 Tag 自动标记为 prerelease。

Windows 安装版的脱敏摘要和固定夹具截图作为 Actions artifact 上传；不上传 Run Request、事件日志、工作区或凭据内容。托管 Runner 不依赖固定 Windows 测试机，但仍不能验证 SmartScreen、Defender、标准用户/UAC、DPI、输入法和真实网络。

Linux 不再进入 Tag Release。`.github/workflows/linux-maintenance.yml` 只保留每周/手动构建，既不发布资产也不阻塞 Windows 候选。

当前 workflow 使用 `--clobber` 以允许故障恢复，但正常发布策略是 Tag 和二进制不可变：已经公开或交付的版本出现问题，应发布新的 patch 版本，不移动旧 Tag、不静默替换旧二进制。

## 4. 发布后验收

1. 确认 Release 不是 draft/prerelease，Tag 指向预期提交；
2. 下载全部资产到新的临时目录；
3. 用 Release 清单重新计算并验证 SHA-256；
4. 核对 GitHub asset digest、文件字节数和清单；
5. 在真实 Windows 11 设备执行安装、从上一稳定版升级、启动、凭证、真实 Provider Run、忙碌时更新阻断、恢复和卸载矩阵；
6. 把真实结果写入 Validation 和 [`DOGFOOD.md`](DOGFOOD.md)。

发布后的下一次 `main` CI 会读取最新稳定 Tag。若 `package.json` 仍等于该稳定版，Canary 自动使用下一个 patch 的预发布版本，例如 `v0.12.2` 之后生成 `0.12.3-canary.*`；这样文档提交也不会因为 Squirrel 拒绝稳定版降级为同号 prerelease 而失败。

第 5 步当前未完成，不能由 Windows Server 2025 Runner 替代。Linux 图形桌面当前不属于 Windows-first 发布门禁。

## 5. 回滚与修复

- 平台无关的 Ed25519 更新协议仍只 staging；Windows Squirrel updater 在没有显式 feed 时保持关闭，当前没有生产更新源或强制更新；
- 发现错误资产时停止传播，保留证据并判断是否属于未交付的发布恢复；
- 已交付版本使用新的 patch 版本修复，不重写 Git 历史；
- 集成代码回滚使用普通 revert commit，不 amend 已推送提交；
- Release 事实变化后同步 Changelog、Known Limitations 和 Validation。

`v0.12.2` 的发布、原地升级和回下载证据见 [`WINDOWS-UPDATE-VALIDATION.md`](WINDOWS-UPDATE-VALIDATION.md)；`v0.12.1` 的 Goal Contract Release 见 [`M11.1-VALIDATION.md`](M11.1-VALIDATION.md)。旧 Release 不回写、不替换；Linux 资产不进入 `v0.12.2`。
