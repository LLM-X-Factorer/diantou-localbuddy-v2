# LocalBuddy V2 Release Runbook

> 当前发布级别：私有 Engineering Alpha。Git push、Tag 和 Release 都是外部状态变更，必须获得用户明确授权。

## 1. 发布真源

- 版本号：`package.json`；
- 版本历史：[`../CHANGELOG.md`](../CHANGELOG.md)；
- 里程碑状态：[`ROADMAP.md`](ROADMAP.md)；
- 证据：对应 `M*-VALIDATION.md`；
- Windows 自动发布：`.github/workflows/release.yml`；
- 安装包配置：`forge.config.cjs`。

同一动态状态只在上述 owner 文件维护；README 只提供摘要和入口。

## 2. 发布前

1. 确认目标版本和里程碑边界，不把外部门禁写成已完成；
2. 确认 `git status --short` 只有本次授权文件；
3. 运行：

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm audit --audit-level high
git diff --check
```

4. 检查仓库中没有 Provider Key、用户 Prompt、`.localbuddy/` 运行状态和私有 Artifact；
5. 更新 Changelog、Roadmap、Known Limitations 和对应 Validation；
6. 提交后确认 `main` CI 全绿。

macOS 内部包还需在 macOS arm64 主机运行：

```bash
pnpm make:mac
pnpm verify:mac-package
```

这只证明 ad-hoc 内部包，不证明公开签名和公证。

## 3. Windows Tag Release

在用户明确批准后，从已经通过 CI 的提交创建 annotated Tag：

```bash
git tag -a vX.Y.Z -m "LocalBuddy vX.Y.Z"
git push origin main
git push origin vX.Y.Z
```

`v*` Tag 会在 `windows-2025` Runner 中执行：

1. frozen install、typecheck、Core build 和平台合同；
2. `pnpm make:win`；
3. 收集 `Setup.exe` 与便携 ZIP；
4. 生成 UTF-8 without BOM、LF 行尾的 `SHA256SUMS-windows.txt`；
5. 上传 Actions artifact 和 GitHub Release assets。

当前 workflow 使用 `--clobber` 以允许故障恢复，但正常发布策略是 Tag 和二进制不可变：已经公开或交付的版本出现问题，应发布新的 patch 版本，不移动旧 Tag、不静默替换旧二进制。

## 4. 发布后验收

1. 确认 Release 不是 draft/prerelease，Tag 指向预期提交；
2. 下载全部资产到新的临时目录；
3. 用 Release 清单重新计算并验证 SHA-256；
4. 核对 GitHub asset digest、文件字节数和清单；
5. 在目标设备上执行安装、启动、凭证、真实 Provider Run、恢复和卸载矩阵；
6. 把真实结果写入 Validation 和 [`DOGFOOD.md`](DOGFOOD.md)。

第 5 步当前在 Windows 上尚未完成，不能由 Runner 构建替代。

## 5. 回滚与修复

- 自动更新当前只 staging，因此不会自动覆盖已安装应用；
- 发现错误资产时停止传播，保留证据并判断是否属于未交付的发布恢复；
- 已交付版本使用新的 patch 版本修复，不重写 Git 历史；
- 集成代码回滚使用普通 revert commit，不 amend 已推送提交；
- Release 事实变化后同步 Changelog、Known Limitations 和 Validation。

`v0.9.0` 的首次 Windows Release、CRLF 清单修复和回下载证据见 [`M10-VALIDATION.md`](M10-VALIDATION.md)。
