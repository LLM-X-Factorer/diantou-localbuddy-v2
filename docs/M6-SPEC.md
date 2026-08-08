# M6 Safe Execution + Unified Trust Specification

## 1. 目标

M6 先收紧“模型能够触发本地执行”的边界，再扩展 Agent 类型。M5 的 Git worktree、工具白名单、BrowserContext 和工作区进程锁提供了逻辑隔离，但不能约束一个被调用的本地程序读取用户文件、访问网络或遗留子进程。

M6 要求：

- 本地检查命令必须通过 `ExecutionHost`，不能直接由 Agent 工具 `execFile`；
- macOS 使用 Seatbelt profile；Linux/Windows 走显式容器适配或 fail closed；
- 默认断网；只读根和可写根分开；Run 临时目录承载 HOME/TMP；
- 命令和参数不经 shell；环境变量采用白名单；
- timeout/取消终止整个进程组，stdout/stderr 有硬上限；
- 执行开始、成功、失败均写入 append-only 审计事件，事件只保存参数哈希；
- MCP stdio server 必须经过同类执行包装，无法隔离时拒绝启动；
- 受控浏览器继续使用 Chromium 自身进程 sandbox、独立 BrowserContext 和 exact-origin 拦截；它不等价于通用本地命令宿主。

## 2. 执行模式

### 2.1 macOS Seatbelt

Seatbelt profile 使用 default-deny：

- 允许创建子进程和读取必要的系统/toolchain 路径；
- 允许读取显式 workspace、worktree 和 Git metadata；
- 只允许写入隔离 worktree 与 Run 临时目录；
- 默认不授予 network 权限；
- 不把用户 HOME、钥匙串或任意环境变量加入允许列表。

`sandbox-exec` 是 macOS 本地可用但长期稳定性有限的接口，因此启动时必须做能力探测；探测失败不得静默降级为裸进程。

### 2.2 Container

容器适配使用显式 image，固定：只读根文件系统、`--network none`、drop all capabilities、no-new-privileges、PID/内存/CPU 上限、只读 workspace mount 和单独可写 mount。镜像拉取不是 Run 的隐式行为；本地不存在所选镜像时 fail closed。

### 2.3 Unsupported

没有可证明执行边界的平台只允许纯文件/计算工具。stdio MCP 和本地检查命令必须拒绝，而不是回退到宿主机裸执行。

## 3. 统一信任分类

工具除了 `read/compute/write/execute` 风险，还映射到以下权限：

- `workspace.read`
- `deterministic.compute`
- `artifact.write`
- `worktree.write`
- `process.execute`
- `external.read`
- `external.effect`

默认 balanced policy：

- workspace read、deterministic compute 自动允许；
- artifact write 只允许 Integrator 且只能写登记产物目录；
- worktree write 只允许 Code Worker 且只能写 owned paths；
- process execute 只有固定命令且强制隔离后允许；
- external read 需要用户在 Run Request 中显式选择 server/origin；
- external effect 在 Desktop 每次询问，CLI 必须有显式 Run 级 grant；
- 未分类工具默认拒绝。

批准策略不能扩大工具自身的路径、网络、角色和隔离约束。批准代表“允许尝试这次受约束调用”，不代表成功，也不代表未来调用获批。

## 4. 不在 M6 冒充完成的内容

- Seatbelt 不是跨平台容器；
- BrowserContext 不是恶意浏览器二进制的完整安全证明；
- 固定命令隔离不等于允许任意 shell；
- M6 不包含 MCP OAuth、跨工作区全局协调、正式 Apple 分发或自动更新。
