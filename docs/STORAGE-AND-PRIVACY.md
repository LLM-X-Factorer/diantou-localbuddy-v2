# LocalBuddy 存储与隐私合同

> 状态：随公开但未签名的 `v0.12.6 / Private Run Storage + Product Truth` Engineering Alpha 发布。

LocalBuddy 把本地数据分为三类：工作区 Run 数据、应用偏好、操作系统凭据。选择“运行位置”，等于选择该工作区的 Run 历史和 Artifact 放在哪里；这不等于授权 Agent 把整个工作区扫描成研究资料。

## 数据放在哪里

| 数据 | 位置 | 内容与生命周期 |
|---|---|---|
| Run 历史 | `<所选工作区>/.localbuddy/runs/<run-id>/` | Run Request、只追加事件、计划决定、checkpoint、Browser state 和已登记 Artifact。LocalBuddy 不自动迁移或删除旧 Run。 |
| 最终/内部 Artifact | `<所选工作区>/.localbuddy/runs/<run-id>/artifacts/` | 该 Run 登记的文本、受限 DOCX、patch 和 Integration 预览。用户从 Run 的 Artifact 列表打开经过复核的结果。 |
| Coding worktree | `<所选工作区>/.localbuddy/worktrees/` | 临时隔离 Git worktree。显式清理只删除符合条件的 worktree，保留 Run 历史和 Artifact。 |
| 应用偏好 | Electron `app.getPath("userData")` | 最近工作区、指引状态和可选教程工作区。常见默认值是 macOS 的 `~/Library/Application Support/LocalBuddy`、Windows 的 `%APPDATA%\LocalBuddy`、Linux 的 `$XDG_CONFIG_HOME/LocalBuddy` 或 `~/.config/LocalBuddy`。Canary 可使用独立 user-data 目录。 |
| 本机协调状态 | 平台状态目录 | 只保存容量 lease 和 Provider 聚合计数，不保存 Prompt、响应、URL、Artifact 或凭据正文。默认是 macOS `~/Library/Application Support/LocalBuddy/runtime`、Windows `%LOCALAPPDATA%\LocalBuddy\runtime`、Linux `$XDG_STATE_HOME/localbuddy` 或 `~/.local/state/localbuddy`。 |
| Provider 与 MCP OAuth 凭据 | 操作系统凭据库 | macOS Keychain、Windows Credential Manager 或 Linux Secret Service。凭据不写入 `.localbuddy`、应用偏好、Renderer 状态或事件日志；进程环境变量也不会被复制到本地文件。 |

诊断和公开问题报告是另外的显式导出：用户选择保存位置。公开报告是经过预览的字段白名单摘要，不是 Run 目录副本。

## 权限和完整性规则

- macOS/Linux 新建的 LocalBuddy Run 目录使用 `0700`，Run 文件使用 `0600`。LocalBuddy 在持有工作区进程锁并安全打开旧 Run 时，会原地收紧已知 Run/checkpoint/Artifact 路径的权限。
- Windows 上 Node 权限位不能构成可靠 ACL 保证，文件继承所选工作区的 Windows ACL。敏感 Run 应放在本人本机用户目录，不应放在广泛共享目录。
- Run JSON 和 Artifact 使用私有原子写；事件使用只追加的私有文件句柄。托管私有文件和目录遇到符号链接会拒绝继续，不会跟随它写到别处。
- 权限修复只覆盖 LocalBuddy 自己的 Run 状态，不枚举、改权限、移动、哈希或删除工作区其他源文件。
- checkpoint 恢复只复核该 Run 明确选择并实际读取的证据，不对所选工作区的所有文件做快照或扫描。

## 哪些敏感内容仍是明文

Run 状态是本机私有状态，不是加密存储。它可能包含用户 Goal、模型消息、工具结果、所选资料身份、生成 Artifact；启用 Browser 时，`checkpoint/browser-state.json` 还可能包含恢复该 Run 所需的 cookie 和 origin storage。

因此：

1. 不要把 `.localbuddy/` 提交进 Git；
2. 除非同步策略本来就是你的明确选择，否则不要把敏感 Run 放进云同步、网络共享或团队可读工作区；
3. 使用操作系统的登录保护和全盘加密保护本机账号；
4. 把备份/同步软件视作独立数据处理方：LocalBuddy 不能替它决定远端副本、保留期或 ACL。

Desktop 会尽力识别 OneDrive、iCloud Drive、Dropbox、Google Drive、Box、Synology Drive、显式配置的同步根和 Windows UNC 路径并提醒。这是路径启发式，不是“未报警就绝对私有”的证明。

## 当前限制与下一版合同

这个补丁刻意不搬迁既有数据、不虚构全局结果库、不加密旧 Run，也不增加自动保留/删除。那些操作可能破坏路径、恢复身份和用户预期，需要单独的迁移合同。

[Issue #17](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/issues/17) 跟踪 Storage Contract V2：受管的私有 Run store、更清楚的用户可见结果边界、保留/导出控制和可逆迁移计划。[Issue #18](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/issues/18) 是本次交付的有界权限与披露加固。
