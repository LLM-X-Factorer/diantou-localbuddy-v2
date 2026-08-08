# M3.1 Multi-Run + Isolated Coding Validation Record

验收日期：2026-08-08<br>
Git：2.53.0<br>
Provider：DeepSeek API<br>
真实 Smoke Run：`m3-real-code-smoke-v1`

## 自动验证

- `pnpm check`：TypeScript 与 27 项测试全部通过。
- `pnpm build`：Core、Electron Main/Preload 与 Renderer 生产构建通过。
- Renderer 产物：HTML 0.61 kB、CSS 10.76 kB、JS 200.27 kB（构建输出口径）。
- 调度回归覆盖跨 Run 总容量、跨 Run 同工作区写锁、协调器等待与释放。
- DesktopRunManager 回归覆盖 2 个 Run 同时活跃、第三个 Run 被拒绝、分别取消。
- Coding 回归覆盖 clean HEAD、detached worktree、主工作区不变、路径逃逸、符号链接、ownedPaths、命令审批、`git diff --check`、patch Artifact 与未合并总结。

## 真实 DeepSeek 双 Worker Smoke

临时 Git fixture：`/tmp/localbuddy-m3-real-smoke.LovXuY`。初始 HEAD 为 `b623807a94a18dd88fae593eeb26fd21f35b210f`，`.localbuddy/` 已忽略。

目标明确要求两个独立修改：

1. `update-greet` 只修改 `src/greet.js`；
2. `update-usage-doc` 只修改 `docs/usage.md`。

Orchestrator 生成两个可并行 Worker 和一个串行 Integrator。三个 Task 全部成功。两个 Worker 分别调用读取、精确替换和 `git_diff_check`，事件日志记录 11 次模型请求/完成、7 次工具请求/批准/完成、2 次 worktree 创建和 2 次 diff 捕获。

产物：

- `patches/update-greet.patch`：273 bytes，SHA-256 `90979e69ae39bcb44dd823ff978afa1621ffac4d2a2274c16db08d987287f4ef`；
- `patches/update-usage-doc.patch`：310 bytes，SHA-256 `56b0b441443ba393cba6662d8abbdc79a89bd52e97caa240c62c190f89cdb3b9`；
- `coding-summary.md`：1685 bytes，SHA-256 `a07b18ff5fff952d7924de46015b3b7fe3391d76d4148c0ca86f8590d9c22c72`。

主工作区验收：

- `git status --short --branch` 仍为 `## main`；
- `git diff --exit-code -- src/greet.js docs/usage.md` 返回成功；
- 主工作区仍返回原始 `"hello"`，两个 worktree 分别持有目标代码与文档修改；
- event log 与整个 `.localbuddy` smoke 目录未检出 `sk-...` 形式的凭证。

这条链证明了“真实模型规划 → 两个真实并行 Code Worker → 隔离修改 → 检查 → patch 登记 → 未合并总结”，没有把模型口头完成当成代码完成。

## 真实桌面验证

Electron 从同一真实 Run 的 JSONL 事件恢复状态，正确展示：

- 两个 `code-worker` 与一个 `integrator`；
- 62 条事件；
- 两个 DIFF Artifact 和一个 Markdown 总结；
- 研究/代码隔离模式选择、Run 局部并发、全局容量与活跃 Run 计数。

截图：`.localbuddy/ui/m3-desktop.png`（本地验收资产，不进入 Git）。

- 尺寸：2880 × 1718；
- SHA-256：`bbd9a47e3bd88bada6286f076d8731d34ba14a6d7f0362bc51fdd27996b0c2d3`。

## 安全边界与剩余风险

- API Key 仍从 macOS Keychain 或显式环境变量读取，不进入仓库与事件日志；鉴于 Key 曾在会话中明文出现，仍建议用户后续轮换。
- M3.1 不执行自动 apply、merge、commit 或 push；worktree 保留可检查。
- 代码模式拒绝脏主工作区，避免把未提交本地状态误当成 Worker 基线。
- `run_check` 没有任意 shell 参数，但 `pnpm test` 等命令会执行项目自带脚本；当前没有 OS 级隔离，不能用于不可信仓库。
- Patch 之间尚未做冲突预检和组合测试，因此 M3.2 之前不能自动写回主工作区。
