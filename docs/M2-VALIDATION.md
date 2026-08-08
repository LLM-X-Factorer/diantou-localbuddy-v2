# M2 Desktop Validation Record

验收日期：2026-08-07<br>
Electron：43.3.0<br>
Renderer：React 19.2.8 + Vite 8.2.1<br>
历史工作区：`fixtures/m1-weekly-report/`

## 自动验证

- `pnpm typecheck`：Core/Main/Preload 与 Renderer TypeScript 均通过。
- `pnpm test`：20 项测试全部通过。
- `pnpm build`：Core、Electron Main/Preload 与生产 Renderer 构建通过。
- Renderer 产物：HTML 0.61 kB、CSS 10.63 kB、JS 199.56 kB（构建输出口径）。
- 新增桌面回归覆盖：事件投影、历史恢复、Run 启动、实时更新、取消、IPC channel 对齐。

## 真实窗口验证

首次启动窗口为空白。诊断确认 sandboxed CommonJS preload 在运行时加载 ESM contract，导致 context bridge 未建立。修正方式是让 preload 运行时只依赖 Electron，contract 仅作 TypeScript 类型来源，并增加 IPC channel 对齐测试。

第二次真实窗口通过：

- 正确恢复四个 M1 历史 Run。
- 默认展示 `m1-real-smoke-v4`。
- 展示 3 个已完成 Task：两个 Worker 和一个 Integrator。
- 展示 54 条事件、一个登记 Artifact 和 SHA-256 前缀。
- Timeline 展示 model / tool / task / artifact 事件。
- Composer 正确显示默认并发 3。

截图：`.localbuddy/ui/m2-desktop-v2.png`（本地验收资产，不进入 Git）。

- 尺寸：2880 × 1718。
- SHA-256：`7937f42e661953f35c1e69cd3f0e655cc69565e1cfbde9aa04de2d731f096083`。

## 边界结论

M2 已证明 Desktop UI 与真实 Runtime、持久事件和真实 Artifact 是同一条链，而不是静态样稿。它尚未证明跨 Run 的共享全局并发、代码修改或可发布安装包；这些能力继续保持为后续阶段。
