# LocalBuddy V2 Architecture

> **状态基线**：2026-08-13，`0.11.1 / M10.3` 本机候选。最新私有 GitHub Release 仍是 `v0.11.0`。本文件描述当前架构事实；各 `M*-SPEC.md` 保留对应阶段当时的范围，不因后续实现而回写历史。

## 1. 产品判断

LocalBuddy V2 的目标不是复刻完整 Craft，而是拥有一个可审计、可恢复、可扩展的本地 Agent 控制面。它默认服务单个本地用户，但允许多个 Run、多个 Task 和多个 Agent 并行工作。

```text
Electron / CLI
      │ commands + event subscription
      ▼
LocalBuddy Core
 ├─ Run Orchestrator
 ├─ Task Graph Scheduler
 ├─ Shared Execution Coordinator
 ├─ Research + Coding Checkpoint Stores / Tool Journal
 ├─ Agent Registry / Capacity
 ├─ Process Workspace Lock / Task Lease Manager / Git Worktree Manager
 ├─ Run Request Store / Worktree Lifecycle Manager
 ├─ Provider Adapters (DeepSeek / OpenAI)
 ├─ Extension Runtime (Skills / MCP / Browser)
 ├─ Tool Runtime + Approval Policy
 ├─ Artifact Registry
 └─ Append-only Event Store
      │
      ├─ local workspace / Git worktrees
      └─ JSONL first, SQLite projection later
```

UI、模型供应商和工具都依赖 Core 的公开契约，Core 不依赖 Electron、React 或某一家模型 API。

## 2. 并发模型

### 2.1 Run 与 Task

- `Run` 是用户目标的一次完整执行。
- `Task` 是可调度、可重试、可追踪的最小工作单元。
- Task 通过有向无环图表达依赖；只有全部依赖成功后才可运行。
- 任一依赖失败、取消或阻塞时，下游 Task 进入 `blocked`，不能伪装成成功。

### 2.2 Agent

Agent 是逻辑执行角色，不等于一个永久驻留进程。它至少包含：

- system instructions；
- 模型与 Provider 配置；
- capability 集合；
- 单 Agent 最大并行任务数；
- 预算、工具与审批策略。

调度器按显式 `agentId` 或 capability 匹配任务，并优先选择当前负载最低的 Agent。

### 2.3 工作区隔离

并发控制不是只限制 Promise 数量，还必须控制副作用：

- `read + read`：同一共享工作区可并行。
- `read + write`：同一共享工作区互斥。
- `write + write`：同一共享工作区互斥。
- 两个写任务若使用不同 `isolationKey`，可以并行；产品层应把它映射为不同 Git worktree 或临时副本。
- Integrator 对主工作区的写入必须串行，并在整合前读取各任务结果和 diff。

`ExecutionCoordinator` 是进程级共享对象，而不是每个 Scheduler 的私有状态。每个活跃 Run 仍有自己的并发上限，但真正开始 Task 前还必须同时拿到：

1. 跨 Run 的全局执行槽；
2. 跨 Run 的工作区 lease。

因此两个 Run 不能各自把“并发 3”扩张成实际并发 6，同一逻辑工作区的写锁也不会因 Run 边界失效。

M5 在 Task lease 外再增加跨 OS 进程的工作区租约。CLI 整次运行、Desktop Run/恢复/回放、worktree 清理、Integration 变更与启动对账都必须先原子获取 `<workspace>/.localbuddy/runtime-lock/`。同一 Desktop 进程可重入以保留多 Run；其他 LocalBuddy PID 存活时快速失败，崩溃残留只在同主机 PID 已不存在时隔离并回收。

M7 再通过机器级协调目录补齐跨进程、跨工作区的共享 Task 容量和 Provider 配额：Task slot、Provider 并发、最小请求间隔与每日 token 账本都使用带 PID/hostname/ownerId 的文件 lease。它只持久化容量和计数，不保存 Prompt、响应、URL 或凭证。工作区读写互斥仍由各工作区的进程租约和 Run 内 `ExecutionCoordinator` 负责，二者不能互相替代。

### 2.4 Coding worktree

M3.1 的代码写入遵守以下顺序：

1. 要求主工作区已有 `HEAD`、状态干净，并忽略 `.localbuddy/`。
2. 每个 Code Worker 从同一个 HEAD 创建 detached linked worktree。
3. Planner 为各任务分配不重叠的 `ownedPaths`；工具在执行时再次验证所有权、路径逃逸和符号链接。
4. Worker 只能调用精确替换、仅新建文件和枚举式检查命令，没有任意 shell 字符串。
5. 控制器运行 `git diff --check`，捕获 binary/full-index patch 并登记 Artifact。
6. Integrator 只写运行总结；主工作区应用、合并、提交都不在 M3.1 授权范围内。

worktree 是 Git 版本与文件副作用隔离，不是 OS 安全沙箱。M6 已让模型触发的 allowlisted 检查命令在 macOS Seatbelt 或 Linux 固定容器宿主内执行，并加入默认断网、精确 mount、资源限制、进程树取消和审计；Windows 尚无受支持的本地进程隔离宿主，因此进程型工具 fail closed。即使存在执行宿主，worktree 与 OS 隔离仍是两层独立边界。

### 2.5 Controlled integration

M3.2 把“生成 patch”和“允许写回”拆成两个独立状态机：

```text
worker patches
  -> integration-preview worktree
  -> sequential apply + combined checks
  -> combined.patch + persistent proposal
  -> awaiting human approval
  -> revalidate clean HEAD + hash
  -> apply only / apply and commit
```

预检和批准之间允许经过任意时间。批准时不信任旧状态，必须重新验证 baseline HEAD、主工作区 clean 和组合 patch SHA-256。任何漂移都拒绝写回，不能自动 stash 或覆盖用户改动。

不提交模式把 patch 留在主工作区，并保存可验证的反向撤销能力；只有当前 diff 与已批准组合 patch 完全一致时才允许撤销。提交模式用 `git apply --index` 同时更新 index 和工作区，跳过仓库 hook 与 GPG 交互后创建指定 commit；commit 失败则按明确路径恢复到 HEAD。

## 3. 状态与恢复

Event Store 是运行事实的追加式记录。初期采用 JSONL，避免桌面打包阶段过早引入原生数据库依赖；需要列表、搜索和统计时，再从事件构建 SQLite 投影。

事件已经覆盖：

- run started / succeeded / failed / cancelled / interrupted / restarted；
- task queued / started / succeeded / failed / blocked / cancelled；
- model request、tool call、approval、artifact、worktree 创建和 diff 捕获。
- integration preflight、awaiting approval、human approval、apply、commit、revert、failure 和 recovery-required；
- worktree created / diff captured / removed。

模型消息正文、工具参数、API Key 与文件正文不进入事件日志。`run-request.json` 会在执行前单独持久化用户目标、模式、并发数和恢复来源，因此属于 `.localbuddy/` 下的私有状态，不可进入 Git。

M3.3 提供 request replay：Desktop 启动或读取历史时，只对 `runtimeOwner=desktop` 且最新生命周期没有终态的 Run 追加 `run.interrupted`；用户确认后，从同一 Request 创建新 Run，并在旧 Run 追加 `run.restarted`。旧事件不可修改，新 Run 也不会复用旧 Run ID。CLI 与 Desktop 的 owner 标记用于避免 Desktop 把另一个 CLI 进程的执行误判成崩溃。

M3.4 在 Research Run 上增加同一 Run ID 的 checkpoint resume。`checkpoint/manifest.json` 固定原始计划、目标哈希和工作区内容快照；每个 Task 独立原子保存消息历史、Agent/工具契约哈希、turn、阶段和工具游标；工具回执、Artifact 注册表和计算注册表分别持久化。checkpoint 文件含 Prompt、模型消息和工具结果，是仅限本机的私有运行状态，与 API Key 一样不可提交或同步。

恢复遵守以下边界：

1. `succeeded` Task 由 Scheduler 直接恢复输出，不再次占用 Agent 或调用模型；
2. `model_inflight` 从上一个已落盘消息边界重新请求，可能产生额外 LLM 成本；
3. `tool_inflight` 若已有完成回执则复用原结果，只读/计算工具的未完成回执可安全重试；
4. 写入/执行工具若只有 started 回执，无法判断副作用是否已发生，必须阻断自动续跑；
5. 原始 Request、计划、Task/Agent/工具契约或工作区内容任一漂移，均在追加 `run.resumed` 前拒绝恢复；
6. 每次恢复仍向 append-only Event Store 追加 `run.resumed`、`checkpoint.restored` 和必要的 `tool.reused`，不重写旧事件。

M3.5 将同一 Run ID 的 checkpoint resume 扩展到 Coding Run，但没有把 Research 的 Task 成功语义直接套到代码副作用。Coding checkpoint 除 Agent 消息与工具回执外，还固定代码计划、baseline HEAD、worktree 路径/登记/HEAD、patch Artifact、Worker 当前 diff、预检 attempt 与 Integration Proposal。

Coding 恢复采用两层完成语义：Agent checkpoint 的 `succeeded` 只证明模型循环已经结束；只有 Coding Task result 将 output、精确 worktree 状态和已登记 patch 一起原子落盘并重新校验成功，Scheduler 才把该 Task 视为可跳过。若 Agent 已完成但控制器尚未捕获 patch，恢复会继续控制器阶段，不会重新调用模型，也不会错误跳过产物生成。

恢复协议按以下次序验证和推进：

1. 原始 Request、Run、goal、代码计划、Task/Agent/工具契约必须一致；
2. 主仓库仍须 clean 且位于原 baseline HEAD；每个 Worker 必须仍是 Git 登记的预期 worktree，真实路径与 HEAD 均一致；
3. 已落盘 Worker result 的当前 diff、状态、patch 文件、Artifact 登记和哈希必须完全一致；
4. 已完成工具回执复用；仅有 started 回执的写入/执行工具继续按含糊副作用阻断；
5. 未完成的 preview 不删除，使用 `integration-preview-2` 等新 attempt 重新预检；完整 Proposal 则在重新验证 patch inventory、组合 patch、检查命令和主仓库状态后恢复；
6. 恢复成功仍只到 `awaiting_approval`。主工作区写回继续由 M3.2 的独立人类批准门控制。

若进程在批准写回的 `applying` 状态退出，Desktop 启动对账只接受可证明的三种现场：原 baseline 且无效果、精确等于批准 patch 的未提交 diff、或 baseline 之上的单一精确批准 commit。前两种分别投影为 failed/applied，后一种投影为 committed；出现额外路径、不同 diff、多余 commit 或损坏 Proposal 时进入 `recovery_required` 并保留现场，不自动 stash、reset 或覆盖。

Research 与 Coding checkpoint 都没有 Provider continuation token；它们恢复的是本地可证明的消息、工具与控制器边界，不是远端模型进程。M7 已把同 Run resume 暴露给 CLI：`--resume-run` 只能加载持久化 Request 合同，不能替换原目标、Provider、并发、扩展或信任档。

worktree 生命周期同样由事件投影：清理只接受已经达到 Run 终态、没有受保护 Integration 状态、同时存在于 `workspace.created` 和 Git worktree registry 的路径。删除使用 `git worktree remove --force`，因此必须由 Desktop 原生确认；成功后追加 `workspace.removed`，但保留 Request、事件和 Artifact。

重启恢复必须从事件重建状态，不能以 UI 内存为真源。

## 4. 工具与数字真实性

模型只负责提出工具调用，不能直接获得本地执行权：

1. Provider 返回 tool call。
2. Tool Registry 确认工具属于当前 Task。
3. 本地 parser 验证 JSON 参数。
4. Approval Policy 根据角色和风险级别放行或拒绝。
5. Workspace Tool 再检查真实路径和符号链接边界。
6. 执行前后只记录元数据事件，不把 Prompt、Key 或文件正文写进事件日志。

M4 的 Extension Runtime 在规划前一次性解析本 Run 的 Provider/Skills/MCP/browser 选择。它把本地 Skill 哈希、MCP 配置、实际工具 schema/风险和 browser origin 授权编译成 extension contract hash，并注入 Agent contract。扩展元数据和输出都被提示为不可信数据，不能充当新指令。

MCP 与浏览器不绕过既有 Tool Runtime：MCP 只有本地配置明确列入 `readOnlyTools` 才是 read，其余默认 execute；浏览器导航/快照是 read，点击/填表/按键是 execute。M5 Desktop 把总开关改成逐次审批资格：每个 execute 调用按精确参数哈希进入队列，用户批准只消费一次；CLI 仍保留显式 Run 级开关用于无人值守执行。审批事件不写原始参数，预览对 secret 与表单值脱敏。

MCP transport 支持本地 stdio 与 Streamable HTTP。HTTP 只接受 HTTPS 或 loopback HTTP；静态 Bearer token 通过环境变量名解析，不进入持久契约。M8 已实现 Protected Resource/Authorization Server Metadata 发现、Authorization Code + PKCE S256、loopback/state、动态注册、refresh、revoke 和 resource binding；token 按服务端点、Server 与账户隔离在操作系统凭证库。当前未完成的是指定第三方生产服务和真实账户的外部验收，不是本地 OAuth 协议代码。

安全计算工具会生成稳定的 `calculationId`。Artifact Gate 要求：

- `write_artifact` 显式提交本 Run 的全部 calculation ID；
- 正文计算行在同一行引用 `[calculationId]`；
- 引用行必须原样包含工具登记的精确值；
- 包含比例、百分比或增长率、但没有登记 ID 的文本拒绝写入。

这道闸门来自真实 smoke：模型第一次把 `46/128` 和 `39/104` 的大小关系判断反了；仅加入计算工具后，模型又出现“声称已验证但未留底稿”和擅自缩写精确值的问题。最终以“确定性计算 + 登记 ID + 产物写入验证”闭环。

## 5. 默认产品边界

- 本地单用户。
- 默认全局最多 3 个并发 Task，可配置但不能无限制。
- DeepSeek 与 OpenAI 使用同一 Provider 接口；Run Request 固定实际 Provider 选择。
- 凭证从进程环境或平台凭证库解析：macOS Keychain、Linux Secret Service、Windows Credential Manager；不进入 Run Request、checkpoint 或事件日志。
- Desktop Bootstrap 只返回每个 Provider 的 `available` 与 `source` 状态。Renderer 的密码输入是瞬时受控状态，保存后立即清空；替换与删除均由 Main 操作平台凭证库，删除必须经过原生确认。
- 保存凭证只验证本机安全写入，不触发网络。显式连接验证在 Main 中解析凭证并向经同一 HTTPS/loopback 校验的端点请求 `/models`；Renderer 只接收成功或有界错误，不接收凭证或远端响应正文。
- 内建工具包括受限文件读写、搜索、patch、确定性计算和受控检查命令；M4/M5 增加显式选择的 MCP stdio/Streamable HTTP 与浏览器工具。
- Skills 支持显式选择的工作区本地内容，以及经发布者信任、版本锁、权限声明、内容哈希和撤销校验的签名包；远程 Skill 市场、云同步和团队账号仍不在当前边界。

## 6. 桌面安全边界

Electron Renderer 只负责 UI：

- `nodeIntegration: false`；
- `contextIsolation: true`；
- `sandbox: true`；
- 使用 CSP，拒绝新窗口、外部导航和权限请求；
- Preload 不暴露 `ipcRenderer`，每个能力有独立方法；
- Main 校验 IPC sender 和输入类型；
- 打开产物前重新解析真实路径，并验证它位于当前工作区 `.localbuddy/runs/` 内。

M5 使用注册为 standard + secure 的 `localbuddy://app/` 从 ASAR 加载 Renderer，不再授予 `file://` 额外权限。CSP 禁止 Renderer 网络连接与内联脚本/样式；所有 9 个 Electron fuse 逐项固定并在安装包二进制上读取验收。

DesktopRunManager 默认允许 2 个活跃 Run，并向所有 Research/Coding Workflow 注入同一个 `ExecutionCoordinator`。用户可以分别停止当前选中的 Run；Run 内上限和全局上限分开显示。

Desktop 使用 Electron single-instance lock，避免两个桌面进程同时拥有同一套内存态；工作区进程租约进一步阻止 Desktop 与 CLI 同时拥有同一工作区的写入/对账权。M7 的机器级文件 lease 让不同 LocalBuddy 进程共享 Task 容量、Provider 并发/限速和每日 token 预算；它不允许第二个进程绕过工作区所有权。

## 7. 实施阶段

1. **M0 Runtime（已完成）**：任务图、Agent 容量、工作区锁、事件契约和确定性测试。
2. **M1 Headless Agent（已完成首条纵向闭环）**：DeepSeek 流式调用、工具循环、审批、数字闸门和 CLI。
3. **M2 Desktop（已完成首版）**：Electron 会话、任务图、实时事件、取消、历史恢复与 Artifact 打开。
4. **M3.1 Coding Workspace（已完成）**：跨 Run 协调器、Git worktree 隔离、受控修改与检查、diff Artifact、未合并总结。
5. **M3.2 Controlled Integration（已完成）**：组合冲突预检、持久化提案、人工批准、漂移复核、应用/commit/撤销与失败恢复。
6. **M3.3 Safe Recovery（已完成）**：执行前 Request 持久化、非终态中断对账、原请求新 Run 重放、worktree 清单/保护/显式清理。
7. **M3.4 Research Checkpoint Resume（已完成）**：Research 消息/工具 checkpoint、Task 恢复、工具回执复用、漂移与含糊副作用阻断。
8. **M3.5 Coding Run Checkpoint Recovery（已完成）**：代码计划/worktree/patch/预检持久化、两层完成语义、同 Run Desktop 续跑与 applying 精确对账。
9. **M4 Extensions（已完成）**：DeepSeek/OpenAI、受限浏览器、MCP stdio、本地 Skills、Run/CLI/Desktop/checkpoint 配置闭环。
10. **M5 Hardening + Packaging（已完成）**：逐调用交互批准、Streamable HTTP MCP、跨进程工作区租约、Electron custom protocol/sandbox/fuses、macOS arm64 ad-hoc package/ZIP/DMG。
11. **M6 Safe Execution + Unified Trust（已完成）**：macOS Seatbelt、Linux container host、默认断网与精确 mount、七类权限和三档信任策略。Windows 本地进程执行 fail closed。
12. **M7 Recovery + Coordination（已完成）**：CLI same-Run resume、revert commit、preview Merge Agent、跨进程 Task/Provider 容量与预算账本。
13. **M8 MCP OAuth 2.1（已完成本地协议验收）**：RFC 9728/8414 discovery、DCR、Authorization Code + PKCE、loopback/state、refresh/revoke、resource binding 和 OS 凭证隔离。
14. **M9 Distribution Protocol + Platforms + Skills（已完成本地可证明范围）**：Ed25519 更新 staging、回滚保护、Linux/Windows native build contracts、签名/锁定/撤销 Skill。正式 Developer ID、Hardened Runtime 与 notarization 按用户决策暂缓。
15. **M10 Dogfooding + Productization（已完成代码、本机与原生 Runner 范围）**：Desktop Provider/凭证设置、持久信任档、哈希校验 inline diff、脱敏诊断导出、macOS 包复验、Linux/Windows 原生构建和 Windows GitHub Release。Windows 真机端到端与生产 MCP OAuth 仍是外部门禁。
16. **M10.1 Local Dogfood Closure（已完成本机闭环）**：Run 指标投影、Artifact Gate 反馈/预算、失败 Run 安全 checkpoint 恢复、最近工作区、校验后的文本 Artifact 预览与显式继续、MCP stdio 脱敏失败诊断，以及真实 Coding commit/reverse-commit 验证。连续 7-14 天使用仍是开放门禁。
17. **M10.2 First Trusted Run（已完成本机实现与 UI 验收）**：本地确定性 Guide、私有版本化偏好、Provider 布尔 readiness、显式合成教程工作区、只预填模板和真实 Run 状态提示。Guide 不属于 Run，不调用模型，也不进入审计指标；真实执行仍复用既有 Run 合同。
18. **M10.3 Provider Setup（已完成本机闭环）**：独立 Provider 一级入口、来源状态、安全保存/替换/删除、显式 `/models` 连接探针、紧凑 Composer 状态和缺失凭据启动拦截。Skills/MCP/Browser 继续作为可选扩展单独配置；macOS 包与已安装 App 已验收，Windows/Linux 版本、依赖与同步 Tag Release 合同已准备，原生 `0.11.1` 构建仍待提交/Tag 授权。

M11 尚未立项。持久化多轮工作线程、Project/Workspace 首页、资料摄取、非纯文本产物预览和更可控的多 Agent 交互属于候选方向，必须在连续 dogfooding 后再确定范围，不能写成已承诺能力。
