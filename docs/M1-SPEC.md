# M1 Headless Agent Specification

## 目标

在没有 Electron UI 的条件下，让一个本地目标真实经过：

```text
DeepSeek Orchestrator
  -> validated task plan
  -> parallel Workers
  -> local read/compute tools
  -> Integrator
  -> validated registered artifact
```

## 已实现验收条件

1. Provider 通过 SSE 读取文本、工具调用分片、finish reason 和 usage。
2. Orchestrator 使用 JSON Output 生成最多三个独立 Worker Task；非法 JSON、重复 ID 和非法文件名拒绝。
3. Worker 只能使用显式授权的读取与计算工具。
4. Integrator 是 M1 唯一允许调用 `write_artifact` 的角色。
5. 本地路径必须在 canonical workspace 内；绝对路径、`..` 逃逸和符号链接逃逸拒绝。
6. 工具调用产生 requested / approved / completed 或 denied / failed 事件，事件不保存参数和文件正文。
7. 比例比较使用 BigInt 分数约分与交叉相乘，不使用浮点数或模型心算。
8. 每次确定性计算生成 `calculationId`。
9. Artifact Gate 拒绝未登记数字、缺失 ID、未知 ID，以及没有原样引用精确值的计算行。
10. DeepSeek API Key 不进入仓库和事件日志；macOS 默认支持 Keychain。

## 当前非目标

- 不允许任意 shell。
- 不修改用户代码文件，只能写本 Run 的 artifact 目录。
- 不在 M1 自动创建或合并 Git worktree。
- 不实现网页搜索、浏览器、MCP 和 Skills。
- JSONL 已持久化事件，但尚未从中恢复中断的模型消息与 Tool Loop。

## 官方 API 契约

核对日期：2026-08-07。

- DeepSeek Chat Completion：<https://api-docs.deepseek.com/api/create-chat-completion>
- DeepSeek Tool Calls：<https://api-docs.deepseek.com/guides/tool_calls/>

实现采用官方的 `/chat/completions`、SSE `data:` 分片、JSON Output 和 function tool calls。官方也明确提示模型生成的 tool arguments 可能不是有效 JSON，因此参数验证必须由本地 Runtime 完成。

