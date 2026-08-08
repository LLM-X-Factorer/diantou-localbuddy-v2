# M3.1 Multi-Run + Isolated Coding Specification

## 1. 目标

M3.1 要证明两件事可以同时成立：

- 多个 Run、多个 Agent 和多个 Task 可以真实并发，但共享一个全局容量与工作区锁真源；
- Code Worker 可以真实修改和验证代码，但副作用只发生在独立 Git worktree，主工作区不被自动覆盖。

这不是自动合并里程碑。补丁写回主工作区属于 M3.2，必须增加冲突预检与人工批准。

## 2. 跨 Run 执行契约

- `ExecutionCoordinator` 默认总容量为 3，所有 Scheduler 共用。
- 单 Run 的 `globalConcurrency` 实际是该 Run 的局部上限，不能突破共享总容量。
- Task 使用 `<runId>:<taskId>` 作为协调器唯一键。
- 同一 `resourceId + isolationKey` 的读写规则跨 Run 生效。
- Scheduler 本地没有运行任务、但被其他 Run 占用容量或 lease 时，等待协调器版本变化，不能误报 deadlock。
- 桌面默认最多同时保留 2 个活跃 Run；第三个启动请求被明确拒绝。

## 3. Coding Planner 契约

- 计划包含 1-3 个独立 Coding Task。
- 每个 Task 必须声明非空 `ownedPaths`。
- 文件路径可以精确到文件；目录所有权以 `/` 结尾。
- 不允许 `.git`、`.localbuddy`、绝对路径、父级逃逸或跨任务重叠所有权。
- 每个 Worker 从同一个已提交 HEAD 创建 detached worktree。

## 4. 工具契约

Code Worker 只获得：

- `list_files` / `read_file`：读取隔离 worktree；
- `replace_text`：在已有 UTF-8 文件中替换唯一一次精确文本；
- `create_file`：只创建新文件，不覆盖已有文件；
- `run_check`：执行 `git_diff_check`、`git_status`、`pnpm_test`、`pnpm_typecheck` 或 `node_test` 中的一个。

所有写路径必须同时通过 worktree 根路径约束、符号链接检查与 `ownedPaths` 检查。命令通过 `execFile` 运行固定程序和参数，不接受 shell 字符串；子进程环境不传递 API Key、SSH Agent 或任意用户环境变量。

项目测试会执行仓库代码，因此 worktree 隔离不等于进程沙箱。这个剩余风险必须在产品和验证文档中显式保留。

## 5. Patch 与 Artifact 契约

- Worker 返回结果后，控制器强制运行 `git diff --check`。
- 新文件先以 intent-to-add 进入 worktree index，使未跟踪内容进入 patch；不会产生 commit。
- Patch 使用 `--binary --full-index --no-ext-diff --no-textconv` 捕获。
- 空 patch 使 Task 失败，不能把“模型说完成了”当成代码修改成功。
- 每个 patch 保存到 `artifacts/patches/<task-id>.patch`，登记 bytes 与 SHA-256。
- Integrator 依赖全部 Worker 成功，只能写 Artifact 总结，并必须明确 `mergedIntoPrimary: false`。
- worktree 默认保留，供人工打开、复查和后续 M3.2 使用。

## 6. 桌面契约

- Composer 可选择 `研究` 或 `代码隔离`。
- 最多 2 个活跃 Run；启动新 Run 不要求先停止第一个。
- 停止操作只作用于当前选中的活跃 Run。
- UI 显示 Run 局部并发、全局容量、活跃 Run 数、DIFF Artifact 和 worktree 事件。

## 7. 非目标

- 不自动 `git apply`、merge、commit 或 push。
- 不对脏工作区猜测基线或自动 stash。
- 不解决不同 patch 之间的语义/文本冲突。
- 不实现容器、VM、网络隔离或恶意代码防护。
- 不恢复中断前的模型对话。

## 8. 设计依据

- Git 官方说明 detached worktree 适合不打扰当前开发的实验性修改：<https://git-scm.com/docs/git-worktree>
- Git 官方说明 `--binary` 生成可被 `git apply` 使用的 binary diff，`--no-ext-diff` 禁止外部 diff 驱动：<https://git-scm.com/docs/git-diff>
- Git 官方说明 intent-to-add 可让尚未加入内容的新文件出现在 unstaged diff：<https://git-scm.com/docs/git-add>
