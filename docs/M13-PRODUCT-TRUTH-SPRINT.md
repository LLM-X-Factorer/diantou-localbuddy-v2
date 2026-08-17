# M13 Product Truth Sprint

> 状态：`active`，2026-08-16。
> 固定基线：公开但未签名的 `v0.12.7 / Real-user Update + One-consent Reporting` Engineering Alpha。
> 决策目标：判断 Research Desk 应该 `advance`、`pause` 还是 `stop`；本里程碑不是新一轮功能开发。

## 1. 第一性问题

M0-M12 已经证明 LocalBuddy 可以在单机上规划、并发执行、约束资料和权限、恢复失败、审查并生成版本化 Artifact。M13 不再用新增组件或测试数量回答产品问题，只回答：

> 一位不是产品作者的目标用户，能否在可接受的时间、成本和人工介入下，重复完成一个真实 Job，并交付可打开、可核查、可修改的结果？

如果答案不成立，继续增加格式、Agent 或入口不会自动让产品成立。

## 2. 冻结规则

M13 期间默认冻结通用功能面。只有以下改动可以进入实现：

- 会造成凭据、Prompt、用户资料或主工作区泄漏/损坏的安全与数据完整性问题；
- truth sprint 中可稳定复现、直接阻断用户完成任务的问题；
- 至少两个已接受场景共同需要的 Core 合同；
- 修复 grader、trace 或文档真源，使已经发生的结果能被准确分类。

用户主动、公开安全、可预览的问题报告属于最后一类：它缩短真实失败进入可归因 Issue 的路径，不增加任务能力。合同与隐私边界见 [`M13-PUBLIC-BUG-REPORTING.md`](M13-PUBLIC-BUG-REPORTING.md)。

Run 私有权限与真实存储位置披露同样属于安全/数据完整性修复：它不增加任务能力，不扫描资料，不迁移或删除旧 Run。当前合同见 [`STORAGE-AND-PRIVACY.md`](STORAGE-AND-PRIVACY.md)，更大的 Storage Contract V2 继续受真实场景门约束。

PPTX、XLSX、RAG、Memory、自动化、远程助理、Marketplace、Hosted Credits 和团队协作不因“产品看起来应该有”而进入 M13。

## 3. Research Desk 主验证轨

### 3.1 开始前必须固定

- 一位非作者试用者，以不含个人信息的 `participant-*` 标识记录；
- 一份人类可读的 `research-desk-v1` Scenario Product Contract；机器可读持久化仍由 Issue #4 管理；
- 固定的 Goal、Source、Artifact、Review、停止条件和硬失败；
- Provider、模型和 `v0.12.7` 安装包身份；
- 经过正反例校准的人工 scorecard 与确定性 grader。

未命名真实试用者前，可以准备合同和合成夹具，但不能把作者自测写成非作者验收。

### 3.2 最小运行矩阵

| 轨次 | 目的 | 最小要求 |
|---|---|---|
| RD-FIXED × 3 | 判断同一合同的稳定性 | 同一 Release、Provider/model、输入和评分合同独立运行三次，逐次披露并报告中位表现 |
| RD-TOPIC-B/C | 排除半导体 Prompt 特调 | 两个不同主题的独立真实任务，复用同一产品合同而不是重写产品规则 |
| RD-NONAUTHOR | 判断产品是否可独立使用 | 非作者用户自行添加资料、填写 Goal、审阅计划、处理一次修订并打开最终 Artifact |

非作者任务可以与 RD-TOPIC-B/C 之一重合，但必须单独记录操作者和作者介入。

### 3.3 每次必须记录

- Release、commit、OS、Provider/model；
- 输入资料类型和数量，只记录脱敏身份，不提交业务正文；
- Task/Agent 数、耗时、provider-reported tokens 和可得费用；
- 人工批准、退回、重试、resume/replay 和作者代操作次数；
- 来源覆盖、引用可达、冲突/推断/未知区分；
- Reviewer verdict、Artifact Gate、目标应用打开和修订结果；
- 产品失败、Provider/环境失败、grader 失败或 `inconclusive`；
- 是否愿意在相同 Job 上再次使用，以及理由。

## 4. 硬失败与决策

以下任一项是单次硬失败：

- 读取未明确选择的本地资料，或泄漏凭据、Prompt、正文、绝对路径和私有事件；
- 把不可达/不存在来源写成已核验事实，或无法区分事实、推断和未知；
- Reviewer/Artifact Gate 失败后仍把产物显示为已接受；
- resume/replay 重复不确定副作用，或修改未经批准的主工作区；
- 最终 Artifact 无法在目标应用打开、核查或继续修改；
- 需要产品作者接管关键步骤，却记录为用户独立完成。

最终裁决：

- `advance`：固定三跑无安全/数据硬失败；两个独立主题均形成可用产物；非作者用户可独立完成并愿意再次使用；时间、成本和干预完整可见；
- `pause`：技术链可完成，但用户没有重复 Job、总工时没有下降，或作者介入仍过高；保留证据，不用新功能掩盖；
- `stop`：重复出现不可接受的安全/正确性硬失败，或目标用户确认该 Job 不值得由此产品承担。

没有足够样本时状态为 `inconclusive`，不得用一次漂亮交付替代裁决。

## 5. 两条并行发现轨

### Teaching Studio discovery

- 命名一位课程 Owner 和一个即将真实使用的教学单元；
- 记录原流程、最耗时步骤和不能交给 Agent 的判断；
- 只用现有文本/DOCX 模拟课程结构、教师讲稿和练习，不先开发 PPTX；
- 由另一位教师口头走查并形成一次修订；
- 只有总工时下降且产物可教，才创建场景实现 Issue。

### Builder Lab generalization

- 只运行 WB-05 的隔离修改、预览、二次修复和人工写回；
- 用它验证 Core 能否跨 Research/Coding 泛化，不创建独立产品入口；
- 外部重复需求出现前，不把 LocalBuddy 定位成通用 Coding Agent 竞品。

## 6. Windows 分发轨

Issue #7 并行管理，不用托管 Runner 代替真机：

1. Windows 11 从 `v0.12.2` 手动原地安装 `v0.12.4`，不卸载旧版；
2. 在 Windows 11 上完成 `v0.12.6 -> v0.12.7` 应用内检查、下载、忙碌 Run 阻断、重启安装和 profile/版本读回；
3. 在面向普通公众分发前选择可信代码签名方案。

Windows 11 门禁没有完成时，只能称公开 Engineering Alpha 和更新桥接版。

## 7. 证据保存与隐私

- 原始 Prompt、资料、Artifact、凭据、checkpoint 和事件日志只留在获准的本机位置；
- 仓库只保存合成夹具、脱敏 trace、聚合评分和不含身份的结论；
- 每次运行都必须保留失败，不得在修复 grader 后追溯改写历史结果；
- 代码测试、安装包 GUI、真实 Provider、目标应用和非作者接受分别记证据，不互相替代。

## 8. 里程碑完成条件

- Issue #4 提供可读、版本化且可验证的 `research-desk-v1` 合同；
- Issue #5 保存完整运行矩阵、逐次结果、scorecard 和最终裁决；
- Issue #3 命名非作者 Research 用户、Teaching Owner/教学单元，并记录 Research Desk 的 `advance/pause/stop`；
- Issue #2 只接收被真实失败或两个场景共同拉动的 Core 工作；
- Issue #7 继续独立记录 Windows 11、真实 OTA 和签名，不阻塞 macOS 上的 Research 产品事实，但阻塞普通 Windows 用户发布声明；
- Roadmap、Dogfood、Issues、Release 和仓库状态不再互相矛盾。

完成这些条件前，不创建“功能齐全”的 M14，也不把公开下载量当成产品采用。
