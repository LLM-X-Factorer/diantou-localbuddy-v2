# M2 Desktop Control Plane Specification

## 目标

让用户通过本地桌面界面直接操作 M1 Runtime，而不是建立第二套只用于展示的状态：

```text
React Renderer
  -> typed preload methods
  -> validated Electron IPC
  -> DesktopRunManager
  -> HeadlessWorkflow
  -> JSONL events / registered artifacts
```

## 已实现验收条件

1. 工作区历史由 JSONL 事件重建，不以 React 状态为真源。
2. 新 Runtime Event 实时投影为 Run、Task、Agent、Artifact 和 Timeline 视图。
3. 用户可选择本地工作区，设置 1-3 的单 Run 并发数并提交目标。
4. 桌面 Run 使用系统钥匙串中的 DeepSeek Key。
5. 支持 AbortSignal 取消，运行与任务最终进入 `cancelled`。
6. 只有登记在事件中的 Artifact 才出现在 UI。
7. 打开 Artifact 前在 Main Process 重新验证真实路径边界。
8. Renderer 无 Node、文件系统、Keychain 或任意 IPC 访问权。
9. Preload/Main channel 有回归测试，防止静默漂移。
10. 生产 Renderer 构建和真实 Electron 窗口截图均通过。

## 当前非目标

- 一次只允许一个活跃 Run；不是多 Run 全局共享调度。
- Artifact 当前调用系统默认应用打开，尚未内嵌 Markdown/PDF 预览。
- 尚未实现命令审批弹窗和通用 shell。
- 尚未实现代码 diff、Git worktree 和 Integrator 合并界面。
- 尚未配置自定义协议、Electron Fuses、签名、公证或安装包。

## Electron 官方安全契约

核对日期：2026-08-07。

- Context Isolation：<https://www.electronjs.org/docs/latest/tutorial/context-isolation>
- IPC：<https://www.electronjs.org/docs/latest/tutorial/ipc>
- Security Checklist：<https://www.electronjs.org/docs/latest/tutorial/security>

官方明确建议启用 context isolation 与 sandbox、关闭 Renderer Node integration，不直接暴露完整 `ipcRenderer`，并校验 IPC sender。本仓首版按这些边界实现；`file://` 到自定义协议的迁移已记录为发布阶段欠项。
