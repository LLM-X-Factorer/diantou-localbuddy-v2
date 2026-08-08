# M1 Validation Record

验收日期：2026-08-07<br>
真实 Provider：DeepSeek API<br>
工作区：`fixtures/m1-weekly-report/`<br>
最终 Run：`m1-real-smoke-v4`

## 最终结果

- Orchestrator 生成 `extract-metrics` 与 `extract-notes` 两个独立任务。
- 两个任务分别由 `worker-1`、`worker-2` 完成。
- Integrator 等待两个依赖成功后运行。
- 运行状态：`succeeded`。
- Event sequence：1-54，共 54 条。
- 完成工具：`list_files`、3 次 `read_file`、`compare_ratios`、`write_artifact`。
- Artifact Gate 拒绝过一次不满足精确引用要求的写入；Integrator 根据工具错误修正后成功。
- 最终产物：`.localbuddy/runs/m1-real-smoke-v4/artifacts/report.md`。
- SHA-256：`680bda858eaeb7665c2a11e01f2165c5f6dea263537877adb8a0871c2d7f8785`。
- 仓库敏感模式扫描：未发现 API Key。

## 失败演进

### Smoke v1：模型心算给出反向结论

模型声称本周合格线索率 `46/128` 高于上周 `39/104`。数字纪律脚本的精确结果证明结论相反。

### Smoke v2：计算正确但没有数字来源绑定

加入确定性工具后方向修正，但报告声称“全部比例均经验证”，正文数字没有逐条绑定计算记录，还从比值继续自行推导增长率。

### Smoke v3：有 calculation ID，但擅自缩写精确值

报告已经引用计算 ID，但把工具值 `0.173076923076` 缩写为 `0.173076923`。这推动 Artifact Gate 增加“同一行原样包含登记值”的要求。

### Smoke v4：通过

最终报告只保留一项确有必要的比例比较，并在同一行保留：

- `46/128`
- `39/104`
- `leftDecimal = 0.359375`
- `rightDecimal = 0.375`
- `[calc-15b97b5c7c95]`

## 计算底稿

### 底稿-01：本周合格线索率

命令：

```bash
echo '{"op":"ratio","numerator":"46","denominator":"128"}' | python3 /Users/liu/.agents/skills/numeric-discipline/scripts/numeric_ops.py --needs-ops
```

输出：

```json
{"result_decimal": "0.359375", "dp_id": "dp_computed_0a3d571e", "rule_id": "T4-ratio", "op": "ratio"}
```

取数来源：`fixtures/m1-weekly-report/metrics.csv` 中本周合格线索 46、本周新增线索 128。<br>
正文引用处：失败演进 Smoke v1 与最终报告比例比较。

### 底稿-02：上周合格线索率

命令：

```bash
echo '{"op":"ratio","numerator":"39","denominator":"104"}' | python3 /Users/liu/.agents/skills/numeric-discipline/scripts/numeric_ops.py --needs-ops
```

输出：

```json
{"result_decimal": "0.375", "dp_id": "dp_computed_c8ebee26", "rule_id": "T4-ratio", "op": "ratio"}
```

取数来源：`fixtures/m1-weekly-report/metrics.csv` 中上周合格线索 39、上周新增线索 104。<br>
正文引用处：失败演进 Smoke v1 与最终报告比例比较。

## 结论

M1 证明的不是“模型会写周报”，而是：本地 Runtime 能让多个 Agent 并发读取材料、执行受控工具、暴露一次真实数值错误，并通过确定性计算和产物闸门阻止同类错误再次无声进入交付物。
