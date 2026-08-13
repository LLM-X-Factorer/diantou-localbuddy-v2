# LocalBuddy V2 Release Runbook

> 当前本机候选版：`0.11.1 / M10.3 Provider Setup`；当前私有发布线仍是 `v0.11.0 / M10.2 First Trusted Run Engineering Alpha`。Git push、Tag 和 Release 都是外部状态变更，必须获得用户明确授权。

## 1. 发布真源

- 版本号：`package.json`；
- 版本历史：[`../CHANGELOG.md`](../CHANGELOG.md)；
- 里程碑状态：[`ROADMAP.md`](ROADMAP.md)；
- 证据：对应 `M*-VALIDATION.md`；
- Windows-first 自动发布：`.github/workflows/release.yml`；
- Windows 合成灰度合同：[`WINDOWS-GRAY.md`](WINDOWS-GRAY.md)；
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

生产依赖审计必须通过。完整审计同时覆盖打包工具；任何告警都必须写入当前 Validation 并在 Tag 前复查，不能通过静默 ignore 伪装成全绿。`0.11.1` 当前已知开发期告警及上游状态见 [`M10.3-VALIDATION.md`](M10.3-VALIDATION.md)。

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
2. `pnpm make:win` 构建 Setup/ZIP；
3. 安装真实 Setup，并执行 [`WINDOWS-GRAY.md`](WINDOWS-GRAY.md) 定义的 Credential Manager、Mock Provider、故障、Research Run、双 Run 取消、硬退出恢复与重启矩阵；
4. 生成 UTF-8、LF 行尾的 `SHA256SUMS-windows.txt`；
5. 发布作业复核 Tag/包版本和 Windows SHA-256 后创建或更新 GitHub Release；
6. `vX.Y.Z-rc.N` 等带预发布后缀的 Tag 自动标记为 prerelease。

Windows 安装版的脱敏摘要和固定夹具截图作为 Actions artifact 上传；不上传 Run Request、事件日志、工作区或凭据内容。托管 Runner 不依赖固定 Windows 测试机，但仍不能验证 SmartScreen、Defender、标准用户/UAC、DPI、输入法和真实网络。

Linux 不再进入 Tag Release。`.github/workflows/linux-maintenance.yml` 只保留每周/手动构建，既不发布资产也不阻塞 Windows 候选。

当前 workflow 使用 `--clobber` 以允许故障恢复，但正常发布策略是 Tag 和二进制不可变：已经公开或交付的版本出现问题，应发布新的 patch 版本，不移动旧 Tag、不静默替换旧二进制。

## 4. 发布后验收

1. 确认 Release 不是 draft/prerelease，Tag 指向预期提交；
2. 下载全部资产到新的临时目录；
3. 用 Release 清单重新计算并验证 SHA-256；
4. 核对 GitHub asset digest、文件字节数和清单；
5. 在真实 Windows 11 设备执行安装、启动、凭证、真实 Provider Run、恢复和卸载矩阵；
6. 把真实结果写入 Validation 和 [`DOGFOOD.md`](DOGFOOD.md)。

第 5 步当前未完成，不能由 Windows Server 2025 Runner 替代。Linux 图形桌面当前不属于 Windows-first 发布门禁。

## 5. 回滚与修复

- 自动更新当前只 staging，因此不会自动覆盖已安装应用；
- 发现错误资产时停止传播，保留证据并判断是否属于未交付的发布恢复；
- 已交付版本使用新的 patch 版本修复，不重写 Git 历史；
- 集成代码回滚使用普通 revert commit，不 amend 已推送提交；
- Release 事实变化后同步 Changelog、Known Limitations 和 Validation。

`v0.11.0` 的原生 Windows Release 和回下载证据见 [`M10.2-VALIDATION.md`](M10.2-VALIDATION.md)；`v0.9.0` 的首次 Windows Release、CRLF 清单修复和回下载证据见 [`M10-VALIDATION.md`](M10-VALIDATION.md)。旧 Release 不回写、不替换；Linux 资产不再计划进入 `v0.11.1`。
