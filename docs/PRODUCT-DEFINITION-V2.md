# LocalBuddy Product Definition v2

> 状态：2026-08-16 已接受的 L0 产品方向；当前由 [`M13 Product Truth Sprint`](M13-PRODUCT-TRUTH-SPRINT.md) 验证，不构成 closed pilot、商业化或产品成立结论。
> 边界：本文不把未发布源码、官方宣传、单次 Provider 成功或单一 DOCX 案例写成已验证产品能力。

## 1. 为什么需要重新定义

LocalBuddy 已经具备较重的多 Agent Runtime、安全、恢复、审计、Skills/MCP 和 Artifact 基础，但真实用户不会购买这些内部组件。用户需要的是：在一个明确场景里交代资料和目标，得到可检查、可修改、可继续使用的结果。

WB-02 验证了会议资料到 DOCX 再到修订版的一条纵向链路。它是重要探针，不是 LocalBuddy 的完整产品定义。只围绕 WB-02 继续开发，会把产品收缩成“安全的 DOCX 工作流”；反过来，只追逐外部产品的导航、专家数量或功能表，又会把产品扩张成没有主线的 WorkBuddy 复刻。

WorkBuddy 的公开产品结构提供了另一条观察：通用任务、专家/专家团、Skills、连接器、项目、自动化、远程助理和垂直创作入口，共享一套 Agent 能力，但分别面向不同的用户场景和生命周期。它们首先是官方产品主张，只有黑盒实跑后才是观察事实：

- [WorkBuddy 简介](https://www.workbuddy.cn/docs/workbuddy/Overview)
- [新建任务栏](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Task-Bar)
- [专家与专家团](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Expert-Center)
- [结果查看](https://www.workbuddy.cn/docs/workbuddy/Results)
- [自动化](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Automation-Guide)
- [远程助理](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Assistant)
- [更新日志](https://www.workbuddy.cn/docs/workbuddy/Changelog)

## 2. 产品定义

> **LocalBuddy 是一个本地优先、可审计、可恢复的个人 Agent 工作台；它通过可验证的场景产品包，把通用 Agent 能力变成不同用户可以直接完成的工作。**

它不是：

- 一个只完成单次 Prompt 的聊天工具；
- 一个只生成 DOCX 的办公工具；
- 一个用专家名称包装 Prompt 的角色市场；
- 一个按 WorkBuddy 功能表逐项复制的通用办公平台；
- 一个已经得到企业协作、公开增长或商业化验证的产品。

当前仍坚持单个本地用户、远程 LLM Provider、显式资料范围、可见权限、可恢复执行和全动作审计。场景产品可以让这些底层能力更易用，但不能绕过它们。

## 3. 五层产品结构

| 层级 | 责任 | LocalBuddy 当前判断 |
|---|---|---|
| Core Runtime | Provider、模型/工具事件、并发、隔离、审批、恢复、Artifact Gate | 已有较强基础；只按真实失败补齐，不再独立驱动路线 |
| Project Continuity | Project、Thread、Run、Source Set、Artifact、版本与待处理决定 | 已有局部对象；必须服务跨轮场景，不为对象完整性而建设 |
| Scenario Product | 为一类用户任务定义角色、方法、资料、工具、产物、Review 和 Eval | 下一阶段的主要产品对象 |
| Delivery Surface | 文档、表格、演示、网页、代码、系统应用中的预览、编辑和交付 | 按入选场景拉动，不按格式列表平铺开发 |
| Trigger and Channel | 定时、后台、远程助理、消息通知、团队协作 | 暂缓；等待身份、通知、幂等、副作用与真实需求成立 |

Core 是公共底座，Scenario Product 是用户购买和复用的工作方式，Artifact 是可验收结果。三者不能互相替代。

## 4. 场景产品合同

每个场景产品必须同时定义以下内容，缺一项就只能叫实验或能力，不得进入产品目录：

1. **目标用户**：谁反复遇到这个问题，谁对结果负责；
2. **Recurring Job**：不是一句演示 Prompt，而是可重复发生的完整工作；
3. **Goal Contract**：结果、约束、验收标准和停止条件；
4. **Source Contract**：需要哪些资料，哪些资料默认不可读取；
5. **Method**：必须执行的专业步骤、证据纪律和决策点；
6. **Agent Shape**：通用 Agent、单专家或专家团，以及选择理由；
7. **Capabilities**：允许的 Skill、MCP、Browser、本地工具和外部服务；
8. **Artifact Contract**：文件、应用或状态交付物及其可打开、可检查标准；
9. **Revision and Review**：怎样继续修改、由谁审查、怎样接受、退回或覆盖；
10. **Eval Contract**：固定夹具、真实任务、失败条件、时间/成本和安全指标。

对象边界固定为：

- Skill 是可执行能力；
- Expert 是角色、方法和可用能力的组合；
- Expert Team 是有依赖图、分工和整合责任的协作合同；
- Scenario Product 是面向用户的完整 Job、界面、Artifact 和验收闭环。

任务可以并行不等于应该使用专家团。只有工作能被拆成相对独立的判断、存在明确合并合同，并且质量收益可以覆盖调用与协调成本时，才使用多 Agent。

## 5. 第一批候选场景产品

产品组合排序已在 [`PRODUCT-PORTFOLIO-DECISION-2026-08-15.md`](PRODUCT-PORTFOLIO-DECISION-2026-08-15.md) 裁决：Research Desk 是当前 L0 切入口，Teaching Studio 是需要教师证据的教育旗舰假设，Builder Lab 只保留为跨场景基准与开发教学资产。三者不再平级立项。

### 5.1 Research Desk · 政策与产业研究工作台

目标 Job：用户提供研究范围和已有资料，系统补充受控公开资料，区分事实、推断、冲突和未知，交付带引用的研究报告，并支持围绕同一证据集继续修订和生成汇报材料。

首个真实案例采用“半导体政策与规划研究”，但验收对象是研究闭环，不是某个固定人物、地区或 DOCX 模板。

主要拉动：Source Set、网页研究、引用、冲突证据、DOCX/PPTX、Reviewer、Artifact Thread。

### 5.2 Teaching Studio · 教学交付工作台

目标 Job：教师或课程研发者提供教学目标、对象和资料，系统形成可讲授的课程结构、课件、教师讲稿、练习与修订版，并在真实授课前完成教师走查。

主要拉动：项目资料、教学方法包、PPTX/讲稿/练习、多产物一致性、版本修订和真人试讲证据。

### 5.3 Builder Lab · 本地应用构建与修复工作台

目标 Job：用户提供需求、代码和可选截图，系统在隔离环境中修改、运行、预览、检查并根据反馈继续修复，最后通过人工 Integration Gate 写回。

主要拉动：Coding worktree、浏览器预览、代码 diff、测试、Reviewer、失败恢复和二次修改。WB-05 是首个固定基准，但不代表完整场景。

文件整理、表格分析、文档/PPT、浏览器和连接器先作为跨场景能力，不单独包装成产品。只有真实用户表现出独立、重复且可收费或可教学的 Job 后，才升级为新的场景产品。

## 6. 产品组合门禁

任何候选场景按以下顺序晋级：

```text
命名用户与重复 Job
  -> 场景合同与固定夹具
    -> 确定性工具/安全验证
      -> 同版本真实 Provider 重复运行
        -> 目标应用打开与人工 scorecard
          -> 多个真实任务/用户 dogfood
            -> 决定扩展、收缩或停止
```

最小证据要求：

- 固定输入、Prompt、Artifact 和硬失败条件；
- 同一发布候选默认运行三次，逐次展示结果和中位表现；
- 至少一个目标应用中的真实打开、运行或编辑证据；
- 至少两个用户或三个彼此独立的真实任务，不用单一作者反复调 Prompt 代替；
- 记录时间、Provider/model、token/费用、人工干预、Reviewer 结论和安全事件；
- 一次演示成功、单元测试数量或生成文件存在，都不能单独触发场景扩张。

如果场景失败，先判断失败来自产品、Provider/环境、grader，还是 Job 本身没有真实价值。技术通过但用户不复用，同样不能晋级。

## 7. 与现有基准和里程碑的关系

- WB-01 至 WB-06 继续作为公共能力和用户结果基准，不再被解释为六个产品；
- WB-02 是 Research/Office 产物链的验证探针，不能单独接管产品路线；
- WB-05 是 Builder Lab 的首个探针；
- Teaching Studio 需要新增一组来源到课件、教师讲稿和试讲的场景基准；
- M12.1-M12.4 已随公开但未签名的 `v0.12.4` Engineering Alpha 发布，但工程发布不自动构成任何场景产品通过；
- Issue #2 只继续承载跨场景 Core 控制面与 trace Eval，不再作为所有产品功能的总篮子。

## 8. 近期决策顺序

1. 冻结新的通用 Runtime 概念，先执行 Research Desk truth sprint；
2. 同步完成 Teaching Studio 的教师 Job 发现，但不提前开发 PPTX；
3. 用 Builder Lab/WB-05 检查共用底座泛化，不创建独立产品面；
4. 内部 FDE 需求由独立私有下游盘点，先分诊“不应 Agent 化 / 只需辅助 / 值得试点”，并优先用现有 Release 做影子运行；公开仓不保存内部 Workflow Card 或私有证据；
5. 为通过方向门的场景建立机器可读、可检查的 Scenario Product Contract；
6. 只有被两个以上场景共同拉动的能力，才升级为 Core 优先级；
7. 自动化、远程助理、Memory、企业协作和市场分发保持独立决策门，不因外部产品已提供就自动进入路线图。

## 9. Issue 治理

方向型 Issue 必须写清：用户 Job、产品结果、非目标、证据门、依赖和停止条件。实现型 Issue 必须链接一个已批准的方向型 Issue。

当前治理结构：

- Core：现有 [Issue #2](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/issues/2)；
- Product Portfolio：[Issue #3 · Product Definition v2](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/issues/3)；
- Product Contract：[Issue #4 · Scenario Product Contract v1](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/issues/4)；
- Product Evidence：[Issue #5 · Cross-scenario Product Truth Program](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/issues/5)；
- Internal Workflow Discovery：由独立私有下游治理；只有经过脱敏、泛化且有独立证据的通用能力需求才进入本公开仓；
- Scenario Pilot：在 Portfolio Issue 通过选择后再分别创建，避免提前把候选场景变成功能承诺。
