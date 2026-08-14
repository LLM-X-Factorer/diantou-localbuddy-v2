# LocalBuddy V2 Dogfood Plan

> 状态：`active`。当前源码版本为 `v0.11.2 / M10.4 Explicit Research Sources` 候选。macOS arm64 的新资料选择 UI、原生文件选择器和包完整性已完成本机验收；大目录 deterministic resume 已通过。v4 explicit-sources 的真实 Provider Run、最终已安装应用恢复、Windows Tag 自动合成灰度、连续 7-14 天使用和 Windows 11 真人灰度仍是独立门禁。Windows 自动化边界见 [`WINDOWS-GRAY.md`](WINDOWS-GRAY.md)。本文不把单元测试、旧 v3 Run、静态 Guide、CI 产物或 workflow 配置重复计作新合同的真人 dogfooding。

## 目标

回答四个问题：

1. 单个用户能否连续使用，而不是只跑通一次 Demo；
2. 多 Run、多 Agent、审批和恢复是否在真实任务中减少工作，而不是增加摩擦；
3. 失败后能否通过事件、checkpoint 和诊断包定位，不丢失或误写主工作区；
4. Provider 成本、执行时间和人工介入是否可接受。

## 阶段 A · macOS 连续使用

至少覆盖以下任务类型，每类保留一个成功样本和一个主动故障/取消样本：

| 场景 | 核心验收 |
|---|---|
| 本地资料研究 | 运行位置不被扫描；只搜索/读取明确添加的资料，多 Worker 引用逻辑 source path，Integrator 生成登记 Artifact |
| 两个并发 Run | 全局容量不超限，两个 Run 可分别取消和恢复 |
| Coding 双 Worker | owned paths 不重叠，主工作区在批准前不变 |
| Integration Gate | inline diff 哈希有效，批准、commit/revert 路径可证明 |
| 中断恢复 | Research/Coding checkpoint 不重复有副作用工具 |
| Extensions | Skill/MCP/Browser 按 Run 显式启用，外部副作用逐次审批 |
| 诊断导出 | 不含目标正文、模型内容、工具参数、凭证和绝对路径 |

建议连续运行 7-14 天后再决定 M11，而不是以单次成功结束。

## 阶段 B1 · Windows 托管合成灰度

自动化范围、触发方式和证据边界以 [`WINDOWS-GRAY.md`](WINDOWS-GRAY.md) 为准。它持续验证真实 Setup、安装版 App、Credential Manager、loopback Mock Provider、故障矩阵、Research Run、两个活动 Run、取消、硬退出恢复和重启持久化。

当前基线为提交 `d686cd6`：[`windows-synthetic-gray` run `31670064610`](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/actions/runs/31670064610) 已完成完整故障矩阵和 5 次额外重启，脱敏摘要 9 项检查全部通过；配套 [`ci` run `31670064596`](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/actions/runs/31670064596) 的 Windows 合同、macOS 回归和 Setup 无凭据首启也全部通过。

该阶段不使用真实 Provider Key，不产生模型费用，也不能证明 Windows 11 消费者桌面环境。

## 阶段 B2 · Windows 11 真人灰度

设备到位后按顺序执行：

1. 下载 Setup/ZIP 并核对 SHA-256；
2. 安装、首次启动、退出、再次启动和卸载；
3. Windows Credential Manager 写入并读取 DeepSeek/OpenAI 凭证；
4. 真实 Research Run、两个活动 Run、取消和 checkpoint resume；
5. Artifact 打开和诊断导出；
6. 验证本地进程型工具明确 fail closed，不发生无隔离降级；
7. 记录 SmartScreen、路径、中文文件名、长路径和杀进程恢复表现。

Windows 执行宿主不在本阶段临时补做；先用真机证据确定 WSL2、容器或 Windows 原生隔离方案的产品边界。

## 阶段 C · Linux 图形桌面（当前非优先）

1. 从同一版本 Release 下载 DEB 并核对 `SHA256SUMS-linux.txt`；
2. 在受支持的 Debian/Ubuntu 图形桌面安装、启动、退出和卸载；
3. 确认 DEB 安装了 `libsecret-tools`，并在可用 Secret Service 会话中保存、读取和删除测试凭据；
4. 完成 Research Run、取消与 checkpoint resume；
5. 使用固定容器镜像验证默认断网、只读 rootfs、精确 mount 与进程树取消；
6. 记录 Wayland/X11、桌面 Keyring、中文路径和默认外部应用打开 Artifact 的表现。

## 单次记录模板

```markdown
### YYYY-MM-DD · 场景名

- 环境：OS / LocalBuddy version / commit / Provider / model
- 工作区类型：资料 / Git 仓库 / 其他
- 目标摘要：不粘贴敏感 Prompt
- Run/Task/Agent 数：
- 结果：成功 / 部分成功 / 失败 / 主动取消
- 耗时与 token：
- 人工审批次数：
- 是否恢复：否 / resume / replay
- 产物与主工作区是否符合预期：
- 诊断包：本地路径或内部 Issue，不提交私有内容
- 问题与下一步：
```

## 退出口径

M11 立项前至少满足：

- 没有凭证、Prompt 或私有 Artifact 泄漏；
- Coding 未经批准不修改主工作区，批准后的 diff/commit 可核对；
- 中断、取消、恢复和 replay 的结果符合各自语义；
- 所有失败都有明确状态和可导出的脱敏诊断，不伪装成成功；
- 真实任务数据足以判断下一阶段优先解决交互、资料摄取、Windows 执行宿主或 Provider 可靠性中的哪一项。

量化成功率、平均成本和时长目标在首轮样本形成后设定，当前不凭空填写阈值。
