# LocalBuddy Product Portfolio Decision · 2026-08-15

> 状态：L0 产品发现决策；不批准新功能实现、公开发布、商业化或企业产品。  
> 依赖：公司级 D027、[`PRODUCT-DEFINITION-V2.md`](PRODUCT-DEFINITION-V2.md)、GitHub [Issue #3](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/issues/3)。

## 1. 本轮裁决

三个候选场景不再平级推进：

| 场景 | 组合角色 | 当前裁决 | 资源含义 |
|---|---|---|---|
| Research Desk | 当前切入口 | 进入 L0 场景合同与产品事实验证 | 先复用现有 Research、Source、Artifact、Reviewer 和 Browser 能力，不先开发新格式 |
| Teaching Studio | 教育旗舰假设 | 进入用户/教学发现，不进入实现 | 先证明教师 Job、可讲授产物和走查流程，再决定是否拉动 PPTX 与多产物能力 |
| Builder Lab | 跨场景基准与开发教学资产 | 保留 WB-05 与真实 Coding dogfood，不作为首个对外产品 | 用来验证 Core 泛化、代码安全和可视修复，不扩张为通用 Codex 竞品 |

这不是三个产品同时立项。当前只选择一个切入口、一个长期旗舰假设和一个能力基准。

## 2. 为什么这样排序

### 2.1 公司边界

公司级 D027 已把 LocalBuddy 定义为“教育旗舰 + 产品发现探针”，当前处于 L0 内部 dogfood，不是新增业务线或通用 WorkBuddy clone。LocalBuddy 的本体是把模糊且会改变文件、代码或环境的任务，转化为可理解、可控制、可恢复、可验证的结果。

因此，产品组合必须同时满足两点：

- 能在现有内核上快速产生真实用户结果；
- 能反哺课程、评测、真实 Issue 和可教责任链。

### 2.2 当前仓库证据

已经有证据支持：

- Grounded Research、明确 Source Set、Artifact、恢复和受限 Browser 已在安装应用与确定性测试中走通；
- 受限 DOCX、Artifact Revision 和 Reviewer 已形成未发布的 M12.1-M12.4 纵向候选；
- Coding worktree、预检、人工 Integration、commit/revert 和恢复已有真实 GUI/dogfood 与自动测试；
- 原始 whole-workspace snapshot 故障暴露了真实研究任务的产品边界问题，并已按显式资料和按需读取修复。

尚无证据支持：

- 教师能用 LocalBuddy 独立完成一套可讲授课件并通过真实走查；
- 非作者用户会持续复用 Research Desk、Teaching Studio 或 Builder Lab；
- PPTX、XLSX、复杂 DOCX、自动化、远程助理或 Memory 是当前用户的首要阻塞；
- 三个候选都值得成为独立产品入口。

## 3. Research Desk · 当前切入口

### 3.1 目标用户与重复 Job

首批用户不是泛化的“所有研究者”，而是点头内部负责行业、政策、课程和产品判断的研究者/产品负责人，以及愿意明确资料范围和验收标准的个人专业用户。

重复 Job：

> 在已有本地资料和受控公开来源上，形成可核查的事实、冲突、推断和未知清单，交付一份可继续修改的研究报告，并能从同一证据集生成下一版或汇报材料。

半导体政策与规划研究作为第一个真实任务形状，但不能把具体人物、地区、Prompt 或私有产物固化进公开夹具。

### 3.2 为什么需要 Agent

普通聊天或固定模板可以写一段总结，但无法稳定承担：

- 在明确 Source Set 中按需发现并读取多份资料；
- 从公开来源补证并区分来源等级；
- 识别不同时间、机构或文本之间的冲突；
- 把 Research Worker 的证据交给 Integrator，并在发布前独立 Review；
- 保存 Artifact 身份、引用、版本和二次修改关系；
- 在中断和失败后复用已经完成的可确认工作。

### 3.3 必须交付

- evidence ledger：事实、来源、日期、冲突、推断和未知；
- cited report：带可检查引用和不确定性标记的报告；
- revision：围绕同一证据集和父 Artifact 的修改版；
- decision brief：面向汇报的短版结论；第一阶段可为文本，不因产品想象提前要求 PPTX。

### 3.4 进入实现前的门禁

- 用当前 M12.4 候选完成同一固定研究合同的三次真实 Provider 运行；
- 逐次记录来源覆盖、引用可达、冲突处理、Reviewer、干预、时间和 token；
- 在系统应用中打开并人工核查报告与修订版；
- 再增加两个不同主题的独立真实研究任务，证明不是半导体 Prompt 特调；
- 至少第二位用户能够在没有作者代操作的情况下完成一次任务。

未通过前，只允许修复被真实运行证明的阻塞，不允许为了“研究产品完整”预建 PPTX、RAG、Memory 或自动化。

## 4. Teaching Studio · 教育旗舰假设

### 4.1 目标用户与重复 Job

首批用户是点头教师和课程研发者。重复 Job 不是“生成一份 PPT”，而是：

> 根据教学目标、学员起点和受控资料，形成能被教师讲授的课程结构、课件、教师讲稿、练习和修订版，并在试讲后把反馈回写到同一课程 Artifact Thread。

### 4.2 为什么需要 Agent

它需要跨多个互相约束的产物保持一致，追踪教学目标、概念顺序、练习与教师反馈，并在修改时保留版本和取舍。单纯模板或一次生成不能证明“可教”。

### 4.3 当前缺口

公司方向与真实课程生产证明这是高价值假设，但当前 LocalBuddy 仓没有以下产品证据：

- 教师在 LocalBuddy 中完成的真实课程包；
- 课件、讲稿和练习之间的一致性检查；
- 教师口头走查、试讲和二次修改记录；
- PPTX 在目标应用中的真实视觉验收。

### 4.4 发现门禁

在创建实现 Issue 前，先完成：

- 选择一位课程 Owner 和一个即将真实使用的教学单元；
- 记录教师现有生产流程、最费时间步骤和不能交给 Agent 的判断；
- 用现有文本/DOCX 能力模拟课程包，不新增 PPTX；
- 由另一位教师做一次口头走查，记录必须修改的地方；
- 判断 Agent 是否减少总工时，而不是把写作时间转成修稿和排错。

只有这些证据成立，Teaching Studio 才从旗舰假设升级为场景 Pilot。

## 5. Builder Lab · 基准与教学资产

### 5.1 目标用户与重复 Job

当前用户是点头内部工程团队、开发课程教师和通过独立能力门的贡献者。重复 Job 是在一个有边界的本地仓库中完成修改、测试、预览、审查、批准写回和恢复。

### 5.2 当前价值

- 验证 LocalBuddy Core 不是只适用于 Research/DOCX；
- 为开发课程提供隔离、测试、恢复和 Review 的真实故障样本；
- 通过 WB-05 检查从代码修改到可视结果和二次修复的产品闭环。

### 5.3 为什么暂不产品化

- 当前没有证据证明外部用户会选择 LocalBuddy 而不是成熟 Coding Agent；
- Coding 能力较强主要证明 Runtime 和教学价值，不自动证明独立产品差异化；
- 将其扩张为通用编程产品会显著增加终端、沙箱、语言、依赖和支持范围。

因此只运行固定基准与内部 dogfood；除非出现重复外部需求，不创建 Builder Lab 独立产品界面或公开承诺。

## 6. 资源顺序

接下来三个决策周期按以下顺序执行：

1. **Research Desk truth sprint**：只做真实任务、trace、人工评分和阻塞分类；
2. **Teaching Studio discovery**：只做教师访谈、现有流程复盘、文本课程包和口头走查；
3. **Builder Lab generalization check**：运行 WB-05 两轮修复，验证 Core 泛化，不扩展产品面。

如果第 1 步失败，先修真实执行链；不进入新格式。第 1 步技术通过但无人复用，则暂停 Research Desk，把资源转回教学发现。第 2 步证明教师价值后，才决定是否开发 PPTX 和多产物一致性。第 3 步只影响 Core 泛化判断，不改变旗舰排序。

## 7. Issue 管控动作

- [Issue #3](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/issues/3) 保持开放，记录本组合决策和真实用户门禁；
- [Issue #4](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/issues/4) 先定义 Scenario Product Contract，不做 UI 市场；
- [Issue #5](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/issues/5) 管理 Research、Teaching、Builder 三条证据轨；
- 不创建场景实现 Issue，直到对应进入门满足；
- [Issue #2](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/issues/2) 只接受被两个以上场景共同需要，或被真实失败证明的 Core 工作。

## 8. 本轮仍未回答

- 第一位 Research Desk 非作者用户是谁；
- Teaching Studio 的课程 Owner 和真实教学单元是什么；
- 首个教育必胜任务与首个公众必胜任务是否相同；
- 哪个场景能产生重复使用，而不只是一次漂亮交付；
- 当前切入口通过后是否值得进入封闭用户试点。

这些问题是 Issue #3 的剩余决策门，不能由本文替用户和业务事实作答。

