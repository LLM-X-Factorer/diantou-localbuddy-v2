# LocalBuddy V2 v0.9.0 Known Limitations

> 本文是 `v0.9.0 / M10` 的负面能力清单。未列为已验收的事项，不得通过宣传性措辞推导为已支持。

## Platform and distribution

- Windows Setup/ZIP 已由 `windows-2025` Runner 原生构建并回下载校验，但尚未在 Windows 真机完成安装、启动、凭证、真实 Provider Run、恢复、卸载验收；
- Windows 没有受支持的本地进程隔离宿主，检查命令和本地进程型扩展 fail closed；
- Linux DEB 已原生构建，但尚未在真实图形桌面完成安装/启动验收；
- macOS 包是 ad-hoc 签名，未启用生产 Hardened Runtime，未 notarize；
- Windows 包未做代码签名，可能出现 SmartScreen 提示；
- GitHub Release 当前只自动发布 Windows x64 资产，不自动发布 macOS/Linux；
- 更新协议只下载、验签并 staging，不会自动替换正在使用的应用。

## Product experience

- 产品以一次目标对应一个 Run 为主，不是持续聊天线程；
- 没有 Project/Workspace 首页、跨工作区统一搜索或 SQLite 投影；
- Artifact 默认调用系统应用打开，没有通用 Markdown/PDF 内嵌预览和基于产物继续编辑；
- 没有通用附件上传、PDF/DOCX 解析或语义索引/RAG；
- 计划由 Orchestrator 生成，当前没有启动前可视化编辑、运行中动态重规划或单 Task 手工重跑；
- Token 预算在运行时受控，但 Desktop 没有完整的成本/耗时/失败统计面板。

## Extensions and external services

- MCP OAuth 2.1 已完成本地协议验收，但尚未对指定第三方生产服务和真实账户验收；
- 签名 Skill 的信任、锁定和撤销已实现，但没有远程 Skill 市场或自动同步；
- Browser 只允许显式 origin，动作逐次审批；它不是通用无人值守浏览器自动化；
- `automation` 信任档始终拒绝外部副作用，不提供绕过人工 Gate 的开关。

## Recovery and data

- checkpoint 恢复的是本地消息、工具和控制器边界，不是 Provider 侧的远程进程；`model_inflight` 可能重新发起一次模型请求；
- 工作区、工具合同、Provider/扩展合同或 Coding worktree 漂移会阻断自动恢复；
- JSONL、Request、checkpoint 和 Artifact 保存在工作区 `.localbuddy/`，目前没有云备份、跨设备同步或团队权限；
- Event Store 不保存模型正文和工具参数，但 `run-request.json`、checkpoint 与 Artifact 仍可能包含私有业务内容，必须留在本机。

## Explicitly deferred

- Apple Developer ID、生产 Hardened Runtime entitlements、notarization、stapling 和公开 Gatekeeper；
- Windows 正式代码签名与发布信誉；
- 团队账号、云同步、远程 Skill 市场和公开自动更新。

后续候选与外部门禁见 [`ROADMAP.md`](ROADMAP.md)。
