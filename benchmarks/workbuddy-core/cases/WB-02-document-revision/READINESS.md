# WB-02 LocalBuddy readiness

> 状态：`provider-stability-not-passed`，不是 `passed`。
> 日期：2026-08-15。

M12.3 已解除 WB-02 的 DOCX 机械 blocker。LocalBuddy 现在可以在明确要求 Word/DOCX 时生成受限但可编辑的 `.docx`，从已登记 Artifact 中安全抽取正文和表格，在系统应用中打开复核，并把 V1 作为只读父资料生成 V2。版本历史、父 SHA-256、结构差异和篡改拒绝都保留在同一 Artifact Thread 中。

M12.4 本地候选再加入独立 DOCX Reviewer 和 `benchmark:trace`：候选在落盘前由只读角色核对完整目标、Worker 证据和抽取正文，最多退回三次；脱敏 trace 可在清理一次性工作区前保存到外部证据目录。该能力只有确定性测试，下面四次历史 DeepSeek 运行早于 Reviewer，不能追溯改写为 Reviewer 已验收。

确定性产品 pilot 已通过完整两轮题目，而不是只调用一个文件生成函数：

- V1 包含执行摘要、四项决定、六个行动项、预算约束、三项风险和一项采购边界；
- V2 把摘要从 181 个字符压缩到 59 个字符，为六项行动保留唯一负责人和来源日期，孙至日期明确为“待确认”；
- 120,000 / 70,000 / 30,000 / 20,000 元及孙至书面确认约束没有漂移；
- “本轮修改说明”位于 V2 末尾，V1 可从版本历史恢复，V1/V2 可做 DOCX 正文与表格差异比较；
- macOS Pages 实际打开了生成文件并完成逐页目视检查，标题、中文正文、项目符号、两张表格和页码没有观察到截断或重叠；
- 在临时运行中故意篡改 V1 后，历史条目变为“校验不可用”，预览和版本比较均因大小/SHA-256 不一致而拒绝。

真实 DeepSeek 两轮运行总体为 2 次接受、1 次失败、1 次因 grader 缺陷无法定论；四条记录不可互相覆盖：

| 记录 | 结论 | V1 | V2 | 说明 |
| --- | --- | --- | --- | --- |
| 接受 pilot #1 | accepted | 10 calls / 19,861 tokens | 9 calls / 28,931 tokens | 全部自动检查通过 |
| 稳定性 #2 | failed | 14 calls / 42,073 tokens / 6 tool failures | 未启动 | V1 未生成 Artifact；旧投影没有保留顶层失败原因 |
| 稳定性 #3 | inconclusive | 11 calls / 20,296 tokens | 6 calls / 17,040 tokens | V1/V2 都成功；旧 grader 不接受带中文序号标题，V1 随临时目录清理后不能重判 |
| 诊断 #4 | accepted | 11 calls / 19,700 tokens | 6 calls / 21,312 tokens | 修正 grader 后全部检查通过；V2 摘要 100 字 |

稳定性 #3 的真实 V2 已用 macOS Pages 打开：三页、7 行 × 4 列行动项表、页码和全部正文可见，无截断、重叠或乱码；第三页只有“本轮修改说明”，留白较多，属于可用但版式仍需优化。V1/V2 自动 grader、Pages 和结构回读是不同证据，不能互相替代。

稳定性 #2 暴露了失败可观测性缺口。源码候选现已让 `write_docx_artifact` 失败计入 Artifact Gate retry / failure stage，并把首个失败 Task 的原因带到 Run 顶层和事件详情；专项回归通过。由于该失败运行的临时事件目录已经按隐私策略删除，不能事后声称已找出那 6 次工具失败的精确根因。

正式 benchmark 仍要求从全新目录连续独立通过三次、人工评分并保留脱敏 scorecard；Windows Word/LibreOffice 也未验收。因此当前只能写“真实 Provider 可以走通，但稳定性未通过”，不能写成“WB-02 已通过”或“产品能力已对标 WorkBuddy”。

本轮 DOCX 范围有意受限为段落、项目符号和表格。任意现有 Word 文档的保真编辑、图片、批注、修订痕迹、嵌入对象、宏、外部关系和复杂模板仍不支持；不在允许范围内的包会 fail closed。
