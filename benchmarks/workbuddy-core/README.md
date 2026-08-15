# WorkBuddy Core Product Benchmark

这套基准比较 LocalBuddy 与 WorkBuddy 在六类真实办公任务上的用户结果。它只使用合成资料和公开产品行为，不包含或推断 WorkBuddy 源码。

## 运行前

1. 使用 `pnpm benchmark:materialize -- <case-id> <new-target-directory>` 创建一次性工作区。目标目录必须不存在，脚本不会覆盖旧目录。
2. 打开 [`manifest.json`](manifest.json)，把对应案例的 `turns` 原样提交给被测产品；只替换工作区路径。
3. 记录产品版本、模型、开始/结束时间、token/费用（能取得时）、每次人工干预和错误。
4. 把结果复制到独立的证据目录。不要提交凭据、真实业务内容、绝对路径或原始事件日志。
5. 按 [`SCORECARD-TEMPLATE.md`](SCORECARD-TEMPLATE.md) 评分；触发 hard gate 时整题失败。

示例：

```bash
pnpm benchmark:materialize -- WB-01 /tmp/localbuddy-wb01-20260815
```

LocalBuddy Run 结束后、删除一次性工作区前，先把脱敏 trace 写到工作区之外的新文件：

```bash
pnpm benchmark:trace -- WB-02 /tmp/localbuddy-wb02-20260815 <run-id> /tmp/localbuddy-evidence/wb02-run-1.json
```

该文件只保留状态、计数、失败工具名、Reviewer verdict、Artifact 元数据和哈希；不保留 Goal、模型正文、工具参数、错误正文、Artifact 正文、凭据、工作区名称或绝对路径。命令拒绝覆盖旧文件，也拒绝把 trace 写回待清理工作区，包括通过符号链接绕回工作区的目标。

## 公平性规则

- 每个产品从同一夹具的新副本开始；失败后重跑也必须新建目录。
- 不替某个产品修改任务难度、验收条件或输入数据。
- 允许产品自己选择 Agent 数量和内部步骤，但人工提示必须记录。
- WB-01 的第二轮确认、WB-02 的第二轮修订、WB-05 的验收修复和 WB-06 的中断/恢复都属于题目，不得省略。
- 正式比较每个案例运行三次；协议试跑可以只跑一次，但只能标为 `pilot`。
- WorkBuddy 未安装、无账号或无法调用时记 `not_run`，不能记 0 分或假定通过。

## 证据最小集

每次运行至少保留：

- `run-metadata.md`：产品、版本、模型、案例、运行日期和环境；
- 输入目录哈希或文件清单；
- 最终产物及打开/预览截图；
- 关键计划、确认、失败、恢复和二次修改截图；
- 完整 scorecard；
- 若失败，保留原始错误文字和失败发生在哪一步。

这些运行证据默认不进 Git。只有确认脱敏的汇总才能写回 `docs/`。

## 当前状态

- 六个案例的合同和合成输入已版本化；
- WB-03 复用 `fixtures/m1-weekly-report/metrics.csv` 与 `source-notes.md`；
- WorkBuddy 黑盒客户端当前不在本机，因此尚无 observed 结果；
- 本目录证明“测试协议已建立”，不证明任何产品已经通过。
