# LocalBuddy V2 Roadmap after M10

> **状态真源**：2026-08-09。`v0.9.0 / M10` 已冻结为 Engineering Alpha；本文件只记录跨里程碑状态和后续决策，阶段内证据以对应 `M*-VALIDATION.md` 为准。

## 当前里程碑

### v0.9.0 · M10 Engineering Alpha — released; dogfood validation open

- M0-M7：并发运行时、Headless/Desktop、Coding worktree、人工集成、恢复、扩展、安全执行和跨进程协调已完成代码与确定性验收；
- M8：MCP OAuth 2.1 已完成本地协议与 loopback 夹具验收，生产服务验收待外部账户；
- M9：更新清单、平台适配和签名 Skill 供应链已完成本地可证明范围；
- M10：Desktop Provider/信任设置、inline diff、脱敏诊断和内部打包已完成；
- macOS ad-hoc ZIP/DMG 已完成本机包与 Renderer 烟测；
- Linux DEB、Windows Setup/ZIP 已在 GitHub 原生 Runner 构建，Windows `v0.9.0` 已发布到私有 Release；
- 连续真实任务 dogfooding 尚未开始，状态和退出口径以 [`DOGFOOD.md`](DOGFOOD.md) 为准；
- Windows 真机安装、启动、凭证、真实 Provider Run、恢复和卸载尚未验收，等待设备。

`v0.9.0` 不再接收新功能。必要缺陷修复进入 `v0.9.x`；新产品能力进入后续里程碑。

## 已完成路线

### M6 · Safe Execution + Unified Trust — completed

- macOS Seatbelt、Linux 固定容器执行宿主、默认断网、资源限制和进程树取消；
- 七类权限与 `strict` / `balanced` / `automation` 信任档；
- Windows 没有受支持执行宿主时，本地进程型工具 fail closed。

### M7 · Recovery + Coordination — completed

- CLI 同 Run checkpoint resume；
- 已提交 Integration 的 revert commit 与 preview Merge Agent；
- 跨进程、跨工作区 Task/Provider 容量、限速和预算账本。

### M8 · MCP OAuth 2.1 — completed locally; production acceptance pending

- Metadata discovery、Authorization Code + PKCE、loopback/state；
- 动态注册、refresh、revoke、resource binding；
- 每服务端点/Server/账户凭证隔离，token 不进入配置、事件或 checkpoint。

### M9 · Distribution Protocol + Platforms + Skill Supply Chain — completed locally and on native runners

- Ed25519 更新清单、哈希/版本/回滚保护和 download-to-staging；
- Windows/Linux 路径、凭证、进程、锁与打包适配；
- Skill 发布者信任、版本锁、权限、签名和撤销。

### M10 · Dogfooding + Productization — implementation complete; dogfood validation open

- Desktop Provider model/base URL 与系统凭证写入；
- 持久化 Run 信任档，resume/replay 固定复用；
- 哈希校验的 Integration inline diff；
- 省略 Prompt、目标、工具参数、凭证和绝对路径的诊断导出；
- macOS 本机包复验、Linux/Windows 原生 Runner 构建和 Windows Tag Release。

上述事实证明产品已具备 dogfooding 条件，不证明连续真实业务使用已经通过。

## 外部门禁与明确暂缓

以下条件没有被本地测试或 CI 替代：

1. Windows 真机端到端验收：等待可用 Windows 设备；
2. 生产 MCP OAuth：等待指定真实服务与账户；
3. 正式 Apple Developer ID、生产 Hardened Runtime entitlements、notarization 和公开 Gatekeeper：明确暂缓；
4. Windows 代码签名与 SmartScreen 信誉：公开分发前再决策；
5. Linux 图形桌面安装/启动验收：原生 Runner 当前只证明合同和产物构建。

## 下一阶段候选，尚未立项

M11 的正式范围必须从真实 dogfooding 结果产生。当前候选是：

- 基于既有 Run/Artifact 的追问与迭代，同时保持每次执行可审计；
- Project/Workspace 首页、跨工作区历史和待审批入口；
- Markdown/TXT/PDF/DOCX 等资料摄取与显式上下文选择；
- 内嵌 Artifact/Diff 预览和“基于此产物继续”；
- 计划审阅、局部 Task 重试、重新规划和 Reviewer/Critic；
- Run/Agent token、耗时、重试和失败原因面板；
- Windows 执行宿主方案，仅在真机边界和威胁模型明确后实施。

远程 Skill 市场、云同步、团队账号、无人值守外部副作用和完全自动更新不属于已批准的 M11 范围。

## 里程碑完成口径

每个里程碑必须分别记录：

1. 代码和确定性测试；
2. 当前主机上的真实运行；
3. 目标平台原生 Runner 的合同与产物；
4. 真实设备、真实第三方服务或发布身份才能证明的外部验收。

第 4 类条件未具备时必须明确标记为未验收，不能用 mock、静态配置、CI 打包或生成了安装文件来代替。
