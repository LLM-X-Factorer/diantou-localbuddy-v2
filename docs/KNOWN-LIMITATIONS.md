# LocalBuddy V2 0.11.1 Known Limitations

> 本文是三平台源码候选 `0.11.1 / M10.3 Provider Setup` 的负面能力清单；其中只有 macOS 本机包完成实装验收，最新私有 GitHub Release 仍为 `v0.11.0`。未列为已验收的事项，不得通过宣传性措辞推导为已支持。

## Platform and distribution

- Windows `v0.11.0` Setup/ZIP 已发布；`0.11.1` 已在 `windows-2025` PR Runner 原生打包，并以隔离用户数据、无 Provider 凭据启动真实打包 App，截图与结构化结果均已回下载核对。该门禁不覆盖终端用户 Windows 设备上的 Setup、凭据写入、真实 Provider Run、恢复与卸载；
- Windows 没有受支持的本地进程隔离宿主，检查命令和本地进程型扩展 fail closed；
- Linux `0.11.1` DEB 已由 `ubuntu-24.04` PR Runner 原生构建，并声明 `libsecret-tools` 依赖；尚未在真实图形桌面与 Secret Service 会话完成安装、启动和凭据验收；
- macOS 包是 ad-hoc 签名，未启用生产 Hardened Runtime，未 notarize；
- Windows 包未做代码签名，可能出现 SmartScreen 提示；
- 新 Tag workflow 会同时发布 Windows x64 与 Linux x64 资产；对应构建与首次启动逻辑已由 `0.11.1` PR workflow 证明，但尚未实际创建 `v0.11.1` Tag 或 Release；macOS 仍不自动进入 GitHub Release；
- 运行时/生产依赖高危审计当前通过；开发期 Electron Forge 打包链仍被 `extract-zip <= 2.0.1` 的上游 symlink path traversal 公告命中，公告尚无修复版本。仓库没有静默忽略该项，`0.11.1` Tag 前必须复查稳定版上游或做明确风险决策；
- 更新协议只下载、验签并 staging，不会自动替换正在使用的应用。

## Product experience

- 产品仍以一次目标对应一个 Run；“基于此产物继续”只显式预填一个新 Run，不是持久聊天线程；
- “指引与示例”是本地确定性导航，不是可自由问答或使用工具的 Guide Agent；
- 教程材料是合成内容，只有用户点击开始后的 Provider/Agent 执行才是真实 Run；
- 没有 Project/Workspace 首页、跨工作区统一搜索或 SQLite 投影；
- 已登记的有限文本 Artifact 可在哈希/大小复核后内嵌预览；PDF/DOCX、超限文件和通用编辑仍依赖外部应用；
- 没有通用附件上传、PDF/DOCX 解析或语义索引/RAG；
- 计划由 Orchestrator 生成，当前没有启动前可视化编辑或运行中动态重规划；失败 Run 只能从安全 checkpoint 恢复未完成 Task 链，不支持任意单 Task 手工重跑；
- Desktop 只展示单 Run 的调用、Provider token、耗时和失败投影，没有币种成本换算、跨 Run 聚合或趋势阈值。

## Extensions and external services

- Provider “验证连接”只证明当时对 `/models` 的网络与认证响应，不证明模型生成、工具调用、配额、账单或后续稳定性；
- 自定义 Base URL 会接收用户主动发起的验证和真实 Run 凭据；界面不替用户判断第三方端点是否可信；
- 环境变量凭据优先于系统凭据，应用只能显示其存在，不能删除或修改父进程提供的环境变量；
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
