# LocalBuddy V2 Dogfood Plan

> 状态：`active`。当前源码版本为 `0.11.0 / M10.2 First Trusted Run`。macOS arm64 首轮实机功能矩阵、M10.1 产品化闭环和 M10.2 本地指引/教程预填 UI 验收均已完成，详见 [`DOGFOOD-2026-08-12.md`](DOGFOOD-2026-08-12.md) 与 [`M10.2-VALIDATION.md`](M10.2-VALIDATION.md)；教程的真实 Provider Run、连续 7-14 天使用和 Windows 真机阶段仍是开放门禁。本文记录真实使用计划和结果，不把单元测试、静态 Guide 或 CI 产物重复计作 dogfooding。

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
| 本地资料研究 | 多 Worker 引用真实文件，Integrator 生成登记 Artifact |
| 两个并发 Run | 全局容量不超限，两个 Run 可分别取消和恢复 |
| Coding 双 Worker | owned paths 不重叠，主工作区在批准前不变 |
| Integration Gate | inline diff 哈希有效，批准、commit/revert 路径可证明 |
| 中断恢复 | Research/Coding checkpoint 不重复有副作用工具 |
| Extensions | Skill/MCP/Browser 按 Run 显式启用，外部副作用逐次审批 |
| 诊断导出 | 不含目标正文、模型内容、工具参数、凭证和绝对路径 |

建议连续运行 7-14 天后再决定 M11，而不是以单次成功结束。

## 阶段 B · Windows 真机

设备到位后按顺序执行：

1. 下载 Setup/ZIP 并核对 SHA-256；
2. 安装、首次启动、退出、再次启动和卸载；
3. Windows Credential Manager 写入并读取 DeepSeek/OpenAI 凭证；
4. 真实 Research Run、两个活动 Run、取消和 checkpoint resume；
5. Artifact 打开和诊断导出；
6. 验证本地进程型工具明确 fail closed，不发生无隔离降级；
7. 记录 SmartScreen、路径、中文文件名、长路径和杀进程恢复表现。

Windows 执行宿主不在本阶段临时补做；先用真机证据确定 WSL2、容器或 Windows 原生隔离方案的产品边界。

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
