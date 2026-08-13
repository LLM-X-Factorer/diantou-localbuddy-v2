# Windows-first Gray Test Plan

> 状态真源：Windows 是当前优先灰度平台。GitHub `windows-2025` 是自动化合成灰度环境；真实 Windows 11 设备仍是最终用户灰度环境。两者不得互相替代。

## 1. 四层门禁

| 层级 | 触发 | 阻塞范围 | 验证内容 |
|---|---|---|---|
| Windows PR Gate | 每次 PR / `main` push | 合并 | Windows 全量 `pnpm check`；真实 Setup 构建、静默安装、无 Provider 首启、截图/JSON、卸载 |
| Windows Synthetic Gray | 每晚、手动、PR 加 `windows-gray` label | 候选发布 | 安装版 Credential Manager、本地 Mock Provider、连接故障、真实 Research Run、两个活动 Run、取消、硬退出、checkpoint 恢复、重启持久化、循环启动 |
| Windows RC Gate | `v*` Tag | GitHub Release | 生产依赖审计、全量检查、安装版合成灰度、Setup/ZIP SHA-256；带 `-` 的 Tag 自动标记 prerelease |
| Windows Human Gray | 私有 RC，真实 Windows 11 | 扩大灰度/稳定版判断 | SmartScreen、Defender、标准用户/UAC、DPI、中文输入法、睡眠恢复、代理和真实网络 |

Linux 不进入 PR 与 Tag Release 门禁。`.github/workflows/linux-maintenance.yml` 只做每周或手动的非发布构建维护，失败不阻塞 Windows 灰度。

## 2. 合成灰度的真实边界

`.github/workflows/windows-gray.yml` 在全新的 GitHub `windows-2025` VM 中执行：

1. `pnpm check` 覆盖状态转换、依赖、并发容量、工作区锁、取消和 checkpoint 恢复；
2. `pnpm audit --prod --audit-level high` 阻断高危生产依赖；
3. `pnpm make:win` 构建版本对应的 Squirrel Setup/ZIP；
4. 静默安装 Setup，并且只启动 `%LOCALAPPDATA%\LocalBuddy\app-<version>\LocalBuddy.exe`；
5. 先证明无 Provider 配置时 Guide 正常、真实 Run 被禁用；
6. 将公开夹具凭据写入 Windows Credential Manager，再启动 loopback-only OpenAI-compatible Mock Provider；
7. 显式验证 `/models`，并覆盖 401、429、500、断流和超时；
8. 从安装版运行确定性 Research 工作流，读取中文/空格路径中的本地夹具并登记 Artifact；
9. 同时启动两个 Run，分别取消并确认没有残留活动状态；
10. 在已有安全 checkpoint 时强制终止 App，重启后确认 Run 为 `interrupted`，再从同一 Run 恢复成功；
11. 重启若干轮，确认 Run 历史与系统凭据状态持续可见；
12. 检查 Run Request 与事件日志不含夹具凭据，删除 Credential Manager 项，卸载 App。

Mock Provider 只监听 `127.0.0.1`，使用固定公开夹具值，不读取仓库或 Actions secrets，不产生模型费用。上传证据仅包含脱敏摘要和固定夹具界面截图，不上传工作区、事件日志、Run Request 或凭据内容。

## 3. 触发方式

- PR 快速门禁：自动运行 `.github/workflows/ci.yml`；
- PR 深度合成灰度：给 PR 添加 `windows-gray` label；
- 夜间合成灰度：每天自动运行，默认故障矩阵和 5 轮额外重启；
- 手动合成灰度：Actions 中运行 `windows-synthetic-gray`，可选择故障矩阵和 0-20 轮重启；
- Release：推送与 `package.json` 完全匹配的 `v*` Tag，自动执行 Windows Release Gate。

## 4. 证据与隐私

合成灰度 artifact 保留：

- `windows-gray-summary.json`：平台、检查结果和请求计数，不含绝对路径；
- `installed-run-succeeded.png`：固定本地夹具成功状态；
- `restart-history-and-cancel.png`：恢复、并发取消和历史持久化状态。

禁止上传 Provider Key、用户 Prompt、私有 Artifact、事件日志、Run Request、系统凭据导出或真实用户目录。失败时若上述三项未生成，Actions 日志只允许保留有界进程错误；新增调试证据必须先验证脱敏边界。

## 5. 真实 Windows 11 灰度

合成灰度全绿后发布私有 `vX.Y.Z-rc.N`。首轮 3-10 名内部用户至少覆盖：

- Windows 11 标准用户与管理员用户；
- SmartScreen/Defender 默认策略；
- 中文用户名、中文/空格工作区和常见缩放率；
- 家庭网络、企业代理或 VPN；
- 安装、首次启动、Provider 配置、真实 Research Run、两个活动 Run、取消、恢复、重启和卸载。

反馈通过脱敏诊断包和 Issue 模板收集；不默认启用遥测。Windows Server 2025 Runner 的通过不能写成 Windows 11 真人灰度通过。
