# M5 Hardening + Packaging Validation Record

验收日期：2026-08-08<br>
宿主：macOS arm64<br>
Node：25.8.2（项目契约为 22+）<br>
Electron：43.3.0<br>
真实 Provider：DeepSeek API（`deepseek-v4-flash`）

## 自动验证

- `pnpm check`：Core/Main/Preload/Renderer TypeScript 检查与 79 项测试全部通过。
- 逐次审批覆盖精确调用排队、一次性批准、拒绝、Run 取消、事件留痕、参数 SHA-256，以及 credential/browser field 脱敏。
- Desktop 纵向测试证明真实 MCP stdio 副作用调用会暂停，UI projection 可见 pending request，批准后才产生 MCP 调用和成功事件。
- MCP Streamable HTTP 使用官方 SDK 的 client/server transport 做真实 loopback 请求，验证工具发现、调用和 Bearer header 注入；配置拒绝非 HTTPS 的公网 URL和字面凭证。
- 跨进程锁使用真实子进程覆盖“活 PID 阻塞”和“SIGKILL 后 stale lock 回收”；进程内双 lease 证明多 Run 重入与最终引用释放。
- Electron 静态安全契约覆盖 custom protocol、sandbox、context isolation、CSP、导航/webview 拦截、ASAR 与全部 9 个 fuse 配置。
- `pnpm audit --prod` 与完整 `pnpm audit`：均无已知漏洞。Forge 的传递 `tar/tmp` 被项目级覆盖到修复版本；旧 DMG maker 被原生 `hdiutil` 替换。

## 真实 DeepSeek M5 烟测

Key 从 macOS Keychain 解析，没有写入环境示例、Run Request、event 或仓库文件。Run `m5-real-deepseek` 使用并发 2：

- Planner 生成两个可并行只读 Worker 与一个依赖二者的 Integrator；
- 3 个 Task 全部 `succeeded`；
- 47 个 append-only event；
- `model.requested/model.completed` 各 9 个；
- `tool.requested/tool.approved/tool.completed` 各 5 个；
- 生成 1 个登记 Artifact，SHA-256 为 `cdbd2c5194ff30de013e40e63e0735749052c8ff412b0664eab2d8a8fe1798ee`。

首次空工作区 smoke 中，两个 Worker 都拒绝在没有本地证据时臆造产品价值；这证明证据边界正常，但不作为 M5 内容正确性验收。最终 smoke 改为读取本仓 M5 规格后再生成摘要，结果记录在本文件下方的最终审计中。

最终 grounded smoke 为 Run `m5-real-grounded`：两个只读 Worker 分别读取 `docs/M5-SPEC.md` 中的审批与租约章节，Integrator 只依据该文档整合。3 个 Task 全部成功，事件总数 42，模型请求/完成各 8 次，工具请求/批准/完成各 4 次；Artifact SHA-256 为 `508260d4f51a1f456456c0091d862c760509e766d0ff9a650205cc10b106164f`。结果准确保留“最小权限、脱敏、跨进程互斥、单进程多 Run 重入”四项边界。

## macOS package 验收

执行：

```bash
pnpm make:mac
pnpm verify:mac-package
```

成品 `.app` 验证：

- `codesign --verify --deep --strict`：通过；签名类型明确为 ad-hoc；
- 实际 fuse wire：RunAsNode off、cookie encryption on、NODE_OPTIONS off、inspect off、ASAR integrity on、only-ASAR on、browser snapshot off、file privileges off、Wasm trap handlers on；
- 包内 `ms-playwright` 包含 `chromium_headless_shell-1234` 与 `ffmpeg-1011`；真实启动该 Chromium 并访问 loopback 页面成功；
- 实际启动 `.app` 后 URL 为 `localbuddy://app/index.html`，Preload API 为 object，React root 有 1 个子节点，并从 JSONL 投影最终真实 Run 的 42 个事件；
- 包内 screenshot：2880 × 1718，299,601 bytes，SHA-256 `a070280d42b374d88efab48a545486773bd26e1742f2a1994658a6207bd23ecf`。

分发文件：

| 文件 | bytes | SHA-256 | 验证 |
|---|---:|---|---|
| `LocalBuddy-darwin-arm64-0.5.0.zip` | 219,057,749 | `4f670658ce17dc3de86ec9bee52c7c6771fdd574d9e84720242eb9eafa905654` | `unzip -t` 通过 |
| `LocalBuddy-0.5.0-arm64.dmg` | 220,347,899 | `6b91d3bc29a99f2471b1da1fe2aab9647bc36937437f4e28823087bb9bbc7ab5` | `hdiutil verify` 通过 |

这些二进制位于被忽略的 `.localbuddy/forge-out/make/`，不进入 Git。

## 明确边界与残余风险

- Desktop 是逐调用人工批准；CLI 仍是显式 Run 级开关，不具备交互队列。
- HTTP MCP 只支持无认证或静态 Bearer 环境变量；没有实现 OAuth 2.1 discovery、PKCE、registration、refresh/revocation 或 audience 校验。
- 工作区锁解决 Desktop/CLI 跨进程同时写同一工作区，不共享跨进程 Task 容量，也不约束其他非 LocalBuddy 程序。
- MCP stdio、MCP HTTP 远端与项目检查命令都可能执行不可信逻辑；M5 没有容器、seccomp、seatbelt 或网络 namespace。
- Playwright exact-origin allowlist 不是 OS 网络沙箱。
- macOS 包是 arm64、ad-hoc、未 notarize；Hardened Runtime 与公开分发必须在真实 Developer ID/CI 发布链中重新启用并验收。
- 没有自动更新、更新签名、Windows/Linux package 或恶意安装包输入测试。
