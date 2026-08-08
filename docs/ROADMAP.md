# LocalBuddy V2 Roadmap after M5

## 决策边界

2026-08-08，后续未实现项全部进入实施范围，但以下事项明确暂缓：

- 正式 Apple Developer ID 签名；
- Hardened Runtime 的生产 entitlements；
- Apple notarization 与公开 Gatekeeper 发布验收。

这里的“暂缓项 6”是产品待办清单中的第 6 项，不是里程碑 M6。后续仍使用 M6、M7、M8、M9 作为工程里程碑编号。

## 实施顺序

### M6 · Safe Execution + Unified Trust — completed

- 对模型可触发的本地子进程建立 OS/容器执行宿主；
- 工作区只读、隔离 worktree/Run 临时目录可写、默认断网；
- 固定环境变量、输出/时间上限、进程树取消和执行审计；
- 把内建文件工具、检查命令、MCP 与浏览器统一映射到权限类别和信任决策；
- 保留 effectful 外部调用逐次人工批准。

### M7 · Recovery + Coordination — completed

- CLI 同 Run checkpoint resume；
- 已提交 Integration 的显式 revert commit，不改写历史；
- 冲突解决 worktree、Merge Agent 建议、组合检查与人工 Gate；
- 本机跨进程、跨工作区全局容量、Provider 限流与预算协调。

### M8 · MCP OAuth 2.1 — completed locally; production service acceptance pending

- Protected Resource Metadata 与 Authorization Server Metadata 发现；
- Authorization Code + PKCE、loopback callback 和 state 校验；
- client registration、refresh、revoke、resource/audience 校验；
- 每服务器/账户凭证隔离，token 不进入配置、事件或 checkpoint。

### M9 · Distribution Protocol + Platforms + Skill Supply Chain — completed locally; target-runner acceptance pending

- 带 Ed25519 签名、哈希、版本约束和回滚保护的更新清单；
- 在没有正式 Apple 分发身份前，只做下载、校验和 staging，不自动替换 macOS 应用；
- Windows/Linux 路径、凭证、进程、锁与打包适配，加 CI 平台矩阵；
- Skill manifest、版本锁、权限声明、签名、撤销与本地受信目录；
- 在执行隔离不可用的平台上，对本地进程型扩展 fail closed。

### M10 · Dogfooding + Productization — completed locally; external gates pending

- Desktop Provider model/base URL 与系统安全凭据写入；Renderer 不持久化、回显或读取 secret；
- `strict` / `balanced` / `automation` 成为持久化 Run 合同，并由 resume/replay 复用；
- Integration Gate 只通过受限 IPC 读取登记且 SHA-256 校验通过的组合补丁；
- 可导出省略目标正文、模型内容、工具参数、凭据和绝对路径的诊断 JSON；
- macOS ad-hoc 包已重新构建并完成真实 Renderer、Fuse、ASAR、内置浏览器、ZIP 与 DMG 验收；
- 私有远端需要确认 GitHub owner，Linux/Windows 需要原生 Runner，生产 MCP OAuth 需要指定真实服务和账户。
- Windows Release 采用 Tag 驱动的原生 Runner：构建成功后发布 `Setup.exe`、便携 ZIP 与 SHA-256 清单。

## 完成口径

每个里程碑都要区分：

1. 代码和确定性测试已完成；
2. 当前 macOS 主机上的真实运行已证明；
3. 只能由目标平台、真实 OAuth 服务或发布身份才能证明的外部验收。

第 3 类条件未具备时必须标记为未验收，不用 mock 或静态配置冒充完成。
