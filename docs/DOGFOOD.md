# LocalBuddy V2 Dogfood Plan

> 状态：`active`。固定产品事实基线为公开但未签名的 `v0.12.7 / Real-user Update + One-consent Reporting` Engineering Alpha；当前仍在 [`M13 Product Truth Sprint`](M13-PRODUCT-TRUTH-SPRINT.md)。M12.1-M12.4、私有 Run 存储、可见更新等待状态和自动公开安全 Trace 已经完成；真实 Provider 重复运行、非作者用户、连续使用、Windows 11 真人和 `v0.12.6 -> v0.12.7` OTA 仍是独立门禁。本文不把单元测试、静态 Guide、CI 产物或合成 Provider 重复计作真人 dogfooding。

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
| 本地资料研究 | 运行位置不被扫描；只搜索/读取明确添加的资料；计划需在 Worker 前由用户核对批准；Integrator 生成登记 Artifact |
| 两个并发 Run | 全局容量不超限，两个 Run 可分别取消和恢复 |
| Coding 双 Worker | owned paths 不重叠，主工作区在批准前不变 |
| Integration Gate | inline diff 哈希有效，批准、commit/revert 路径可证明 |
| 中断恢复 | Research/Coding checkpoint 不重复有副作用工具 |
| Extensions | Skill/MCP/Browser 按 Run 显式启用，外部副作用逐次审批 |
| 诊断导出 | 不含目标正文、模型内容、工具参数、凭证和绝对路径 |
| 公开问题报告 | LocalBuddy 自动生成公开安全摘要/Trace；用户先看预览并以一个按钮明确同意，GitHub 最终提交或本地保存仍由用户决定，不自动上传原始诊断 |

连续使用必须围绕同一个可重复 Job 记录；M13 先完成 Research Desk 固定三跑、两个不同主题和非作者运行，再根据真实频率决定是否需要延长为 7-14 天观察，而不是以单次成功结束。

## 阶段 B1 · Windows 托管合成灰度

自动化范围、触发方式和证据边界以 [`WINDOWS-GRAY.md`](WINDOWS-GRAY.md) 为准。它持续验证真实 Setup、安装版 App、Credential Manager、loopback Mock Provider、故障矩阵、Research Run、两个活动 Run、取消、硬退出恢复和重启持久化。

历史合成灰度提交 `d686cd6` 的 [`windows-synthetic-gray` run `31670064610`](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/actions/runs/31670064610) 已完成完整故障矩阵和 5 次额外重启，脱敏摘要 9 项检查全部通过；配套 [`ci` run `31670064596`](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/actions/runs/31670064596) 的 Windows 合同、macOS 回归和 Setup 无凭据首启也全部通过。

当前固定 Release 目标为 `v0.12.7`。实现 PR #24 已合入 `a165750571594fd2247b2db857217fb5c2a7bded`；合并后的 [`main` CI `32036190030`](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/actions/runs/32036190030) 通过 macOS/Windows 合同、Windows 干净安装和 `v0.12.6 -> 0.12.7-canary.67` 原地升级，升级摘要为 `profilePreserved=true`。固定 Tag、stable 灰度、正式资产和公开 endpoint 仍以 Release workflow 的结果补录。以上自动化仍不等于 Windows 11 真人、真实 Provider dogfood 或 M13 产品成立证据。

该阶段不使用真实 Provider Key，不产生模型费用，也不能证明 Windows 11 消费者桌面环境。

## 阶段 B2 · Windows 11 真人灰度

设备到位后按顺序执行：

1. 安装 `v0.12.6` 并保留一个非敏感 profile 标记，核对版本与来源；
2. 在应用内发现、下载并原地升级到 `v0.12.7`，不先卸载旧版；
3. Windows Credential Manager 写入并读取 DeepSeek/OpenAI 凭证；
4. 真实 Research Run、两个活动 Run、取消和 checkpoint resume；
5. Artifact 打开和诊断导出；
6. 验证本地进程型工具明确 fail closed，不发生无隔离降级；
7. 完成忙碌 Run 重启阻断、安装后版本/profile 读回；
8. 记录 SmartScreen、路径、中文文件名、长路径和杀进程恢复表现。

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

## M13 退出口径

Research Desk 进入 closed pilot 前至少满足：

- 没有凭证、Prompt 或私有 Artifact 泄漏；
- Coding 未经批准不修改主工作区，批准后的 diff/commit 可核对；
- 中断、取消、恢复和 replay 的结果符合各自语义；
- 所有失败都有明确状态和可导出的脱敏诊断，不伪装成成功；
- 同一 `v0.12.7` 合同完成三次逐次披露的真实 Provider 运行，并记录中位表现；
- 两个不同主题完成可打开、可核查、可修订的 Artifact，排除半导体 Prompt 特调；
- 至少一位非作者用户独立完成一次，并记录作者介入和再次使用意愿；
- 真实任务数据足以作出 `advance/pause/stop`，并判断下一阶段优先解决交互、资料摄取、Windows 执行宿主或 Provider 可靠性中的哪一项。

完整矩阵、硬失败和裁决规则以 [`M13-PRODUCT-TRUTH-SPRINT.md`](M13-PRODUCT-TRUTH-SPRINT.md) 为准。量化成功率、平均成本和时长目标在首轮样本形成后设定，当前不凭空填写阈值。
