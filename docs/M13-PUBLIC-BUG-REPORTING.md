# M13 Public Bug Reporting

> 状态：`v0.12.5 released; one-consent v2 candidate tracked by Issue #23`，2026-08-17。已发布反馈链仍有效；真实用户指出三段必填叙述造成不必要摩擦，v2 候选改为自动安全 Trace 和一次明确同意。Windows 11 真人与代码签名仍开放。

## 为什么现在做

M13 的目标不是增加更多 Agent 能力，而是让真实用户的失败能被准确归因。只要求用户导出诊断包、再去仓库手工描述，会让反馈在“找文件、判断能否公开、定位模板、重新输入环境”之间流失；但静默上传原始 trace 又会破坏 LocalBuddy 的本地与隐私边界。

因此本切片只建立一条窄反馈链：

```text
选择一个 Run → 自动生成公开安全摘要与 Trace
→ 本机检查公开 Issue 是否同签名 → 用户检查并以一个按钮明确同意
→ 系统浏览器打开预填 Issue Form
```

应用不会点击 GitHub 的 `Submit new issue`。真正发布仍由用户在浏览器完成。

## 公开报告允许包含什么

- LocalBuddy 根据 Run mode/status、失败阶段和受控失败码生成的问题摘要；
- LocalBuddy 版本、构建通道、公开源码 SHA、是否 packaged；
- OS、CPU 架构、Run mode/status/runtime owner；
- 受控失败阶段与失败码，不包含原始错误；
- Task 状态计数、模型/工具失败计数、checkpoint、Artifact Review 与 integration 状态计数；
- 最近十二个事件的类型顺序和稳定去重签名。

## 永远不进入公开报告的内容

- Prompt、Goal Contract、计划、模型消息和工具参数；
- 工作区名/路径、显式资料、工件文件名/正文/哈希；
- Run、Task、Agent、审批与 Artifact Thread ID；
- 原始错误、事件 detail、检查命令、patch/commit/revert SHA；
- Provider 名称、model/base URL、Skills/MCP/Browser 配置和所有凭据。

v2 不再接收自由文本，也不会先读取原始内容再尝试遮盖；公开摘要只从结构化允许字段生成。人工预览仍保留，用于确认自动分类和公开范围符合用户预期。

## 同意与防漂移合同

1. Renderer 不直接访问 GitHub；Main 进程只读取公开 Issue 列表并在本机匹配签名，不发送报告内容，也不带 Authorization；同一签名短时复用内存结果，避免预览与打开各消耗一次匿名请求；
2. 所有将被预填的公开字段和本机数据边界说明必须先显示；“同意并在 GitHub 继续提交”按钮本身就是唯一一次应用内公开确认，不再叠加复选框；
3. Main 进程重新生成报告，并核对预览 SHA-256。Run 状态在预览后变化时 fail closed，要求重新预览；
4. 外部 URL 必须是 `https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/issues/new` 或同仓库的数字 Issue 路径；拒绝 HTTP、凭据 URL、其他 host/repo、查询参数化的已有 Issue 和 fragment；
5. GitHub 不可用时仍可把同一公开安全报告以 `0600` Markdown 保存到本机。去重不可用不阻止用户在浏览器手工提交。

## 去重不是遥测

签名只由平台/架构、Run mode/status、失败阶段/受控失败码、Task 状态计数、checkpoint/integration 状态、失败计数和事件类型序列组成；版本、时间、Token 总量、用户文字和任何 ID 都不参与。应用以无鉴权 GET 读取最多 100 个公开 `bug` Issue，并在本机搜索签名。

当前没有后台上报、自动 Issue 创建、GitHub OAuth、服务端收集、崩溃遥测、设备 ID 或用户画像。

## 验收门禁

- 确定性测试证明敏感 Run 字段不会被读取到预览或 URL，报告请求不再接受用户叙述字段；
- 自动生成的摘要和 Trace 低于保守的 7,500 字符预填 URL 上限；
- 重复 Issue、GitHub 离线/限流、恶意外链、预览后状态变化和本地保存均有测试；
- `pnpm check`、Renderer/Core build 和生产依赖高危审计通过；
- Electron 开发构建目视检查自动预览、隐私边界和单一同意动作；
- 发布前在真实公开 Issue Form 做一次不提交或使用专用测试 Issue 的端到端检查；没有用户授权不得创建测试 Issue；
- Windows Release 候选仍需在真实 Windows 11 上确认默认浏览器打开、缩放、中文输入和应用内更新链。

随 `v0.12.5` 发布只证明反馈链可用，不等于已经获得真实用户反馈或完成产品成立验证。
