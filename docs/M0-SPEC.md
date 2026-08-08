# M0 Runtime Specification

## 目标

证明 LocalBuddy Core 能在不依赖 UI 和真实 LLM 的条件下，正确调度一个多任务、多 Agent 的执行图。

## 验收条件

1. 三个无依赖任务可以在全局并发上限为 3 时同时进入执行。
2. Integrator Task 只有在其全部依赖成功后才启动。
3. Agent 的 `maxParallelTasks` 不会被全局并发上限绕过。
4. 共享工作区中的两个读取任务可以并行。
5. 共享工作区的写任务必须等待现有读取或写入释放租约。
6. 使用不同 `isolationKey` 的写任务可以并行。
7. 失败任务的下游依赖进入 `blocked`。
8. 调度过程写入有单调序号的追加式事件。
9. 非法依赖、环形任务图或没有适配 Agent 的任务在启动前失败。

## 非目标

- 不在 M0 调用 DeepSeek。
- 不在 M0 执行真实 shell 或修改用户文件。
- 不在 M0 创建 Electron 界面。
- 不把内存调度测试包装成已经完成的产品能力。
