# Changelog

本文件记录已经发布或准备发布的产品版本。里程碑范围和证据分别以 [`docs/ROADMAP.md`](docs/ROADMAP.md) 与对应的 `docs/M*-VALIDATION.md` 为准。

## Unreleased

## 0.12.7 — 2026-08-17

公开但未签名的 Real-user Update + One-consent Reporting Engineering Alpha。本版本直接修复唯一当前用户在 `v0.12.4` 更新和问题反馈中遇到的摩擦：更新过程不再像静默卡死，公开问题报告不再要求用户重复填写系统已经掌握的信息。

### Changed

- 问题报告不再要求用户重复填写现象、预期和复现步骤：点击“报告问题”后，LocalBuddy 直接从所选 Run 的受控投影生成公开安全问题摘要、环境和 Trace；用户检查预览后以一个明确按钮同意打开 GitHub，应用仍不保存 Token、不自动发布，也不读取 Prompt、正文、路径或原始错误。

### Fixed

- Windows 更新从“发现更新”到“下载完成”期间显示诚实的后台下载动画和已等待时间，并提供固定官方下载页兜底；Electron/Squirrel 当前不提供字节进度，因此界面不伪造百分比，也不重复触发下载。

### Pre-release evidence

- 实现提交 `def45c18d72eb1ec697b039a14db6c36b0d3aeb9` 经 [PR #24](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/pull/24) 合入 `a165750571594fd2247b2db857217fb5c2a7bded`；Issues #22/#23 已关闭；
- macOS 本机 `pnpm check` 共 219 项：217 passed、2 项 Windows-only 跳过、0 failed；`pnpm build`、生产依赖审计和一次不含真实用户数据的 Electron 问题报告 UI smoke 通过，预览无绝对工作区路径且只剩一个公开同意动作；`v0.12.7` App/ZIP/DMG、DMG 完整性、ad-hoc 签名、14 个相对 symlink、Fuse、内置 Browser 和隔离无凭据首启通过；
- 合并后的 `main` CI [`32036190030`](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/actions/runs/32036190030) 全绿；Windows Server 2025 构建并安装 `0.12.7-canary.67`，从 `v0.12.6` 原地升级后读回 `profilePreserved=true`；
- 唯一当前用户明确批准在单用户 Engineering Alpha 阶段直接发布，不再等待额外真实用户。正式 Tag、stable 安装版合成灰度、五项资产和公开 updater endpoint 仍必须由固定 Tag 的 Release workflow 验证；Windows 11 真人 OTA、代码签名和真实网络仍未验收。

## 0.12.6 — 2026-08-17

公开但未签名的 Private Run Storage + Product Truth Engineering Alpha。本版本不增加任务能力；它在真实用户灰度前收紧 Run 私有数据权限、解释三个平台的实际存储边界，并保持 M13 产品事实验证路线不变。

### Added

- Desktop 在 Goal Contract 下方新增默认收起的“存储与隐私”说明，显示当前 Run 记录、Artifact 和系统凭据的真实边界；识别常见云同步目录与 Windows UNC 路径时明确警告，不把“本地路径”误报成“仅本机可见”。

### Security

- macOS/Linux 新建 Run 目录和文件分别限制为 `0700`/`0600`；Run Request、事件、checkpoint、Artifact、Browser state、Coding worktree 和 Integration 状态统一走私有写入层，并拒绝托管树中的符号链接；
- 旧 Run 只在持有工作区进程锁时对已知 LocalBuddy 状态做有界权限修复，不扫描、移动、修改或删除工作区源文件。Windows 保持继承所选目录 ACL 的事实口径，不伪造 POSIX 权限保证。

### Fixed

- macOS 包验证改用独立临时 user-data 和空凭据命令路径，不再读取开发者日常 profile/系统凭据，也不再因本机已经看过 Guide 而误报安装包失败；包级烟测同时展开并回读新的存储说明。

### Documentation

- 新增 [`docs/STORAGE-AND-PRIVACY.md`](docs/STORAGE-AND-PRIVACY.md)，记录三个操作系统上的 Run、Artifact、偏好、协调状态与系统凭据位置，以及明文 checkpoint/browser cookie、同步目录和当前无自动迁移/删除的限制。

### Evidence

- 实现提交 `29dc11c7dbdcd9f5147d19003f7030ba42b71417` 经 [PR #19](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/pull/19) 合入 `70cbfda4dbba4bd15257bc02805fee4d0e69a197`；PR CI `32023121563` 的 macOS、Windows 全量和 Windows 安装/原地升级作业通过；
- macOS 本机 `pnpm check` 为 220 项：218 passed、2 项 Windows-only 跳过、0 failed；源码构建、ad-hoc App/ZIP/DMG、DMG 完整性、14 个相对 symlink、Fuse、内置 Browser、隔离无凭据首启和存储说明展开读回通过；
- annotated Tag `v0.12.6` 解引用到合并提交 `7b78db16d6d73543dc93f69cfce123c2f044cf0a`；非 draft、非 prerelease Release 已发布五项 Windows 资产；
- 固定 Tag 的 Release workflow [`32024271769`](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/actions/runs/32024271769) 全绿：Windows 作业通过生产依赖审计、220 项合同、stable 安装版合成灰度、`v0.12.5 -> v0.12.6` 原地升级和 `profilePreserved=true`，独立公开更新源作业返回 HTTP 200；
- 五项资产已重新下载到新临时目录并匹配 SHA-256 清单及 GitHub digest；从 `0.12.5` 请求无鉴权 updater endpoint 返回 `LocalBuddy v0.12.6` 和精确 Setup URL。Windows 11 真人 OTA、真实 Provider 和代码签名仍未验收。

## 0.12.5 — 2026-08-17

公开但未签名的 Public Bug Reporting + Product Truth Engineering Alpha。本版本把真实用户失败进入公开 Issue 的路径缩短为“本机生成公开安全预览 → 用户明确确认 → 浏览器最终提交”，同时保持 M13 默认冻结通用功能扩张。

### Added

- 新增用户主动发起的公开安全问题报告候选：先遮盖常见凭据、用户路径、邮箱和 `@` 提及，只输出版本/平台、受控失败分类、状态计数和最近事件类型；用户必须检查完整预览并明确确认，应用才会打开固定 LocalBuddy GitHub Issue Form；
- 新增无鉴权的公开 Issue 去重签名、本地 Markdown 回退和预览内容 SHA-256 防漂移校验。应用不自动发布、不上传原始诊断包、不保存 GitHub Token，也不把去重检查冒充遥测。

### Changed

- 开发阶段转入 M13 Product Truth Sprint：固定 `v0.12.5` 为产品事实基线，默认冻结通用功能扩张，以 Research Desk 同合同三跑、两个独立主题、非作者用户和目标应用结果作 `advance/pause/stop` 裁决；
- Dogfood、Quickstart、M12 规格/验证和产品方向文档先统一回读 `v0.12.4` 已发布事实，再把固定产品事实基线推进到 `v0.12.5`，并以文档合同测试避免当前 Release 与候选期口径再次漂移。

### Evidence

- annotated Tag `v0.12.5` 解引用到合并提交 `e50ba87474e437fb2778cab7b3873fb073d7c6f7`；非 draft、非 prerelease Release 已发布 Setup、ZIP、full nupkg、`RELEASES` 和 SHA-256 清单；
- Release workflow `32017121369` 的 Windows 作业通过生产依赖审计、214 项合同、安装版合成灰度、`v0.12.4 -> v0.12.5` 原地升级和 `profilePreserved=true`；独立公开更新源作业首次请求即返回 HTTP 200；
- 五项 Release 资产已独立下载到新临时目录，四项分发文件全部匹配清单，清单自身及每个 GitHub asset digest 也一致；从 `0.12.4` 请求无鉴权 updater endpoint 返回 `LocalBuddy v0.12.5` 和精确 Setup URL；
- 公开 Issue Form 已从 `main` 回读；合成测试 Issue #14 经标题、正文、`bug` 标签和状态回读后关闭保留审计。Windows 11 真人 OTA、真实 Provider 和代码签名仍未验收。

## 0.12.4 — 2026-08-15

公开但未签名的 Product Truth + Public Update Bridge Engineering Alpha。现有 `v0.12.2` 用户仍需手动原地安装一次本版本；真正的应用内更新验收目标是 `v0.12.4 -> 后续稳定版`。

### Added

- 项目采用 Apache License 2.0，仓库加入官方完整许可证文本、`NOTICE` 归属说明和 SPDX 包元数据；
- Packaged stable Windows builds now derive a fixed `update.electronjs.org` feed from the public GitHub repository, while Canary/beta/dev and non-Windows builds remain disconnected from the stable channel by default.
- Tag Releases on a public repository now wait for the Electron update service to resolve the new full Squirrel package from the previous stable version.

- 新增 WorkBuddy 产品能力基准 v1：把公开承诺拆成批量文件、文档修订、表格分析、证据研究、网页修复和中断恢复六个黄金任务，统一 100 分评分、硬失败条件与证据等级；
- 新增只使用合成资料的版本化夹具和 `pnpm benchmark:materialize` 安全物化命令。目标目录必须不存在，脚本不会覆盖既有测试现场；当前只证明基准协议可执行，不代表 WorkBuddy 黑盒或 LocalBuddy 六题已经通过。
- 新增 M12.1 Artifact Revision 第一切片：Run Request v6 保存父 Artifact、Thread、版本和修改原因；Main 进程在 Provider 调用前复核父产物并复制为新 Run 的只读 Research Source 快照；Desktop 展示版本关系和上一版入口；
- “基于此产物继续”不再把截断后的预览正文拼进 Goal。父 Artifact 被移动、删除或篡改时 fail closed，旧 v1-v5 Run Request 继续按原语义读取且不改写。
- 修订任务从头 replay 时重新复核原父 Artifact、创建新 Run 私有快照并保持 Thread/版本身份；Composer 不再预填一个可误提交的修改目标，并清除遗留资料选择，用户写明实际修改要求后才能生成计划。
- 新增 M12.2 Artifact Thread Workbench：按 Thread 展示 V1/V2、失败/replay 和同版分支尝试；每个历史 Artifact 独立复核，漂移版本保留记录但禁用打开；
- 新增本机有界文本 diff：复核直接父版本后显示增删行和双边行号，限制 bytes、行数、LCS 计算量与渲染行数；缺失 V3 父合同或父 SHA 漂移时 fail closed；
- 为 WB-02 增加逐项来源事实真源和 readiness 门禁；M12.3 已解除 DOCX 机械 blocker。真实 DeepSeek 当前记录 2 次接受、1 次失败和 1 次 grader 缺陷导致的无结论运行，状态为 `provider-stability-not-passed`，不把诊断重跑冒充三次稳定通过。
- 新增受限 DOCX Artifact 纵向切片：Integrator 只提交有界 Markdown 正文，由本地编译器解析标题、段落、项目符号和表格，确定性生成 OOXML、回读正文并经 Artifact Gate 登记；不让模型直接拼嵌套结构、ZIP、XML 或伪装扩展名。
- 显式选择的 DOCX 可作为 Research Source 读取；压缩包条目数、压缩/展开大小和正文长度均有上限，宏、外部关系、嵌入对象、图片、批注、修订痕迹和复杂富内容 fail closed。
- Desktop 增加 DOCX 结构预览、章节/段落/表格统计、系统打开入口和直接父版本正文/表格差异；每次预览、打开、修订和比较都重新复核 Registry、bytes 与 SHA-256。
- 新增 WB-02 两轮确定性产品 pilot：V1/V2 都满足来源事实，V2 摘要 59 字、六项行动含负责人/日期或“待确认”、“本轮修改说明”位于文末，V1 保持可恢复。
- 新增 M12.4 独立 DOCX Reviewer：在文件写入/登记前，以只读 `artifact-reviewer` 比较完整 Goal Contract、Worker 证据和候选 DOCX 抽取文本；退回意见进入 Integrator 私有 checkpoint，最多三次，未通过候选不发布；
- Artifact Revision 新增父版本保留门槛：已验证父正文和结构直接提供给 Integrator/Reviewer，模型审核前确定性拦截正文或段落大幅缩水，以及章节、表格和表格行丢失；
- 新增 `pnpm benchmark:trace`：把 Run 状态、调用/失败计数、失败工具名、Reviewer verdict 和 Artifact 元数据脱敏导出到一次性工作区之外；拒绝覆盖旧文件或把 trace 写回待清理工作区。
- Research 长资料新增单文件有界 `search_source_text`；每个 Worker 的 Prompt 可见资料与 Runtime 可读资料按计划共同收窄，不再让 Agent 看见全局 Source Set 后反复尝试越界读取；
- Goal Contract 可显式收起为结果、约束、验收和资料数量摘要，保留完整提交值的同时减少 Composer 占高。

### Fixed

- Desktop 的成功、失败和取消终态现在只在工作区运行锁释放、活动 Run 注销后通知订阅者；恢复、重放和 Plan Review 测试也显式等待 manager 完全 idle，避免 Windows 在测试清理临时目录时偶发 `EPERM`；
- 正式 Windows Release 改为在原生 Windows 验收与 SHA-256 复核后直接上传 GitHub Release，不再把约 800 MB 的 Setup/ZIP/nupkg 先存入临时 Actions Artifact 再跨作业下载；脱敏安装证据上传为尽力保存，配额问题不能跳过功能门禁，也不再阻断已验证正式资产的发布；
- Integrator 现在必须至少有一次最终 Artifact 写入通过才能成功结束，不能在写入/Reviewer 失败后只返回“完成”绕过后置条件；同 Run 恢复继续沿用已经消耗的三次 Artifact Gate 预算；
- DOCX 写入失败现在与文本写入一样计入 Artifact Gate retry 和失败阶段，最近事件显示截断后的具体工具反馈；Research/Coding Run 失败会把首个失败 Task 的原因投影到顶层，不再只显示无原因的 `failed`；
- WB-02 实跑 grader 的章节匹配允许“一、执行摘要”“五、风险”等带序号标题，避免把内容齐全的文档误判为缺章节；历史无结论运行不因修正评分器而被事后改写为通过；
- Artifact revision 的输出文件名/格式现在由已验证父 Artifact 约束；第二轮只说“继续修改同一份文件”或 Planner 省略/误写 `integration.fileName` 时，不再悄悄降级成 Markdown或在控制器接管前失败；
- Integrator 每轮都会重新收到完整 Overall Goal Contract；revision 还会收到“保留未被明确要求修改的父内容”合同，减少 Planner/Worker 摘要交接时遗漏验收条件；
- Canary 版本现在会与最新稳定 Release 比较；发布后的下一次 `main` 构建自动进入下一 patch 的 prerelease 线，避免 Squirrel 把同号 `X.Y.Z-canary.*` 识别为低于已经安装的稳定 `X.Y.Z`。
- 修复 CI `31784118614` 已在 Windows Server 2025 实测 `v0.12.2 -> 0.12.3-canary.39` 原地升级且 `profilePreserved=true`，同时通过 157 项 Windows/macOS 合同、干净安装和两类 Canary artifact 上传。
- 用户主动从安全 checkpoint 继续时，未完成 Agent 获得新的有界 8-turn 窗口，已成功 Task 不重跑；工具参数格式失败与 Reviewer 语义退回分开计数，避免恢复后立即用尽旧预算；
- Orchestrator 输出允许一次有界 JSON 修复，并在 Plan Review 前检查所有已选 source ID 是否得到“使用或说明排除”；Integrator/Reviewer 的真实 Research 上下文上限恢复为 8,000 output tokens；
- 数字 Artifact Gate 不再把逻辑资料编号列表（如 `source-2/3/4`）、URL、斜杠日期和政策原文百分数误判为派生计算；
- Reviewer 明确候选 DOCX 在内存中完成结构编译、接受后才原子发布的语义，不再因为目标文件尚未落盘而误退回。
- `search_source_text` 现在可对单个受限 DOCX 做本地安全抽取后的有界正文检索；DOCX 父稿中的 tab-separated 表格也可由本地 Markdown 编译器直接还原，消除二进制搜索和制表符控制字符误报；
- 修复窄 Artifact Revision 被独立 Reviewer 接受却静默删掉大部分父稿的缺陷；保留 finding 使用同一三次有界修订预算，失败候选仍不落盘。

### Evidence

- annotated Tag `v0.12.4` 解引用到 `b9f1082772e43c13bde3fe0651ec41412bd1a1db`；非 draft、非 prerelease Release 已发布 Setup、ZIP、full nupkg、`RELEASES` 和 SHA-256 清单；
- Windows 发布作业完成生产依赖审计、204 项合同、稳定安装版合成灰度、`v0.12.2 -> v0.12.4` 原地升级和 `profilePreserved=true`；全部资产已回下载并通过清单核验；
- 发布流水线的后置线上冒烟因旧断言错误地在 JSON 中查找 full nupkg、且五分钟缓存窗口短约 42 秒而标红；公开 endpoint 随后返回 HTTP 200 和精确的 `v0.12.4` Setup 地址。该失败不改写，后续版本改为解析 JSON 并最多等待十分钟；
- Windows 11 真机、代码签名和 `v0.12.4 -> 后续稳定版` 应用内更新仍未验收。

## 0.12.3 — not released

`v0.12.3` annotated Tag 固定指向 `3fbcbf3abb1e45aac4fd9ac80cd7df24d1d68b14`。Release Gate `31878639876` 在 Windows `pnpm check` 阶段暴露终态测试与 `runtime-lock` 清理的时序竞态，停止于打包前；没有创建 GitHub Release，也没有发布资产。Tag 保留为失败审计记录，不移动、不复用；修复和 Public Update Bridge 转入 `v0.12.4`。

## 0.12.2 — 2026-08-14

Windows Canary 与安全原地更新候选。本版本把高频开发同步、安装器升级验证和未来稳定版应用内更新拆成三条独立通道；当前没有配置生产更新源，也没有完成 Windows 11 真机升级验收。

### Added

- 新增 `pnpm windows:canary`：从最新成功的私有 `main` CI 下载便携 ZIP，按 Git SHA 并存，使用独立 Electron user-data 启动；
- 新增可审计构建身份，包内 metadata 与运行时版本必须一致，Desktop 展示 channel、version 和 short SHA；本地未提交构建明确标记 `+dirty`；
- 新增 Windows Squirrel 更新控制器和手动检查入口；下载完成后只有用户确认且 Run/Integration 空闲时才能重启安装；
- 新增 `上一稳定版 -> 当前候选版` 原地升级门禁，检查默认 profile 标记保留和更新后 UI 版本；
- Windows Release 资产增加 `RELEASES` 和 full `.nupkg`，为后续受控更新源提供原始 feed 产物。

### Security and boundaries

- Renderer 不能设置更新源；feed 只接受 HTTPS 或 loopback HTTP，并拒绝 URL 凭证、query 和 hash；
- Canary 不覆盖稳定安装，CI 升级脚本拒绝覆盖已有本机安装/用户目录；
- 生产 feed、Windows 代码签名、SmartScreen 信誉和 Windows 11 真人验收仍开放，不能把 CI 产物生成写成自动更新已经上线。

### Evidence

- `pnpm check` 共 156 项：macOS 本机 154 passed、2 项 Windows-only 跳过、0 failed；生产依赖审计无已知漏洞；
- `0.12.2` macOS App/ZIP/DMG、ad-hoc 签名、DMG 完整性、Fuse、ASAR、内置浏览器和真实 Renderer 首启通过，UI 读回可追踪构建身份；
- 首次 Windows CI `31779620641` 的全量检查和 Canary Setup 构建通过，但首启烟测在 bootstrap 前读到默认身份并停止；严格等待真实身份后，CI `31780762643` 的 macOS/Windows 全量检查、Canary 干净安装、`v0.12.1 -> 0.12.2-canary.35` 原地升级、profile 保留以及分发/feed artifacts 全部通过。动态证据见 [`docs/WINDOWS-UPDATE-VALIDATION.md`](docs/WINDOWS-UPDATE-VALIDATION.md)。
- 最终 main CI `31781915176` 与 Windows Release Gate `31781917106` 通过；稳定版合成灰度、`v0.12.1 -> v0.12.2` 原地升级和 `profilePreserved=true` 均已读回；
- `v0.12.2` 非 draft/prerelease Release 已发布 Setup、ZIP、full nupkg、`RELEASES` 和 SHA 清单；806,111,427 bytes 资产已在新临时目录回下载并全部通过清单校验，精确哈希见 [`docs/WINDOWS-UPDATE-VALIDATION.md`](docs/WINDOWS-UPDATE-VALIDATION.md)。

## 0.12.1 — 2026-08-14

M11.1 Goal Contract + Plan Review 私有 Engineering Alpha Release。`v0.12.0` Tag Gate 在 Windows 全量测试的临时目录清理阶段遇到一次 `runtime-lock` 释放竞态，停止于打包前，因此没有创建 GitHub Release 或发布资产；Tag 保留为失败审计记录，不移动、不复用。

### Added

- 新增版本化 Goal Contract：Desktop 将结果、约束和完成标准分开填写，Run Request v5 持久化结构化合同；
- 新增执行前 Plan Review：Orchestrator 先生成可审阅任务计划，Desktop 用户批准后 Worker 才启动，拒绝则保留审计记录并结束 Run；
- Plan Review 的 Goal、完整计划和 Run scope 由 SHA-256 绑定，pending/approved/rejected/cancelled 状态可跨应用重启恢复。

### Changed

- 将 GitHub Actions 升级到声明 Node 24 runtime 的当前主版本，关闭旧 Action 被 Runner 强制切换 runtime 的兼容性告警；
- CLI/Core 保持非交互执行，Desktop Main 才默认要求 Plan Review；旧只含裸 goal 的调用继续使用原执行文本，避免破坏 v1-v4 checkpoint 身份；
- Windows 安装版合成灰度新增真实 Plan Review 页面批准，并停止把没有显式添加的本地文件冒充为已读取资料。

### Fixed

- 大目录 checkpoint 恢复测试在断言终态后显式等待 Desktop manager 完全 idle，再由测试框架删除临时工作区，避免 Windows 偶发 `EPERM` 清理失败；产品锁的所有权和释放语义不变。

### Evidence

- `pnpm check`：152 项；macOS 本机 150 passed、2 项 Windows-only 合同按平台跳过、0 failed；批准、拒绝、重启恢复、批准指纹、决定审计修复和旧 checkpoint 兼容矩阵通过；
- macOS 源码 Electron 界面已实际读回 Goal Contract 三个输入区、完成标准启动门禁和 Guide 的“批准前 Worker 不启动”；本次未点击生成计划，没有真实 Provider 调用；
- macOS `0.12.1` DMG/ZIP 已通过版本、DMG 完整性、ad-hoc 签名、Fuse、ASAR、内置浏览器和无凭据首启；最终 App 还通过回环合成 Provider 的计划展示/批准、成功、双 Run 取消、checkpoint 恢复、重启历史和凭据脱敏矩阵，生产依赖审计无已知漏洞。
- main CI `31775318623` 与 Windows Release Gate `31775672269` 通过；`v0.12.1` Setup/ZIP 已发布并在新临时目录回下载通过 SHA-256 清单核验。

## 0.12.0 — not released

`v0.12.0` 只保留失败 Tag 审计：没有 GitHub Release、没有发布资产，功能最终由 `v0.12.1` 发布。

## 0.11.2 — 2026-08-14

M10.4 Explicit Research Sources 私有 Engineering Alpha Release。修复 Research 把运行目录误当资料库和恢复快照的根因；Windows-first Tag Release 已通过原生安装版合成灰度，资产已发布并完成回下载核验。

### Changed

- Research 的“运行位置”和“本次资料”拆为两个边界：运行位置只保存 `.localbuddy/runs` 与 Artifact，不再自动成为模型证据集；
- Desktop 新增按 Run 添加文件或资料目录的入口。未添加资料时不注册本地搜索/读取工具；资料目录只在 Agent 明确调用非空查询的 `search_files` 后按需搜索文件名；
- Planner 和 Worker 只接收 `source-1` 等逻辑资料引用，不接收绝对路径或运行目录清单；本地读取只允许落在明确选择的文件或资料目录内；
- Research checkpoint 保存明确资料身份，并只复核成功读取过的文件 SHA-256；运行目录中的无关文件、缓存和新增条目不再阻断恢复；
- 旧版 whole-workspace Research checkpoint fail closed，要求新建 Run 并明确添加资料，不继续旧的整目录扫描语义。

### Fixed

- 从根因上消除 `workspace snapshot exceeded the safe checkpoint entry limit`：启动、历史列表、应用重启对账和 resume 都不再扫描或哈希整个 Research 运行目录；
- 教程 Run 显式选择三份合成教程资料；切换运行位置或成功启动后清空本次资料，避免跨 Run 隐式继承；
- 修复并发 `start()` 可在容量检查与异步路径解析之间穿透全局 Run 上限的竞态；
- 被拒绝的恢复尝试写入脱敏的 `checkpoint.resume_blocked` 审计事件，不读取或记录资料正文；
- Artifact 数字闸门不再把 URL 和日期误判为未登记的派生计算。

### Security

- 将开发构建链中的 `nanoid` 约束到已修复的 `3.3.18`；生产依赖高危审计通过，完整审计只剩 Electron Forge 上游尚无修复版本的既有 `extract-zip` 告警。

### Evidence

- `pnpm check`：138 项；macOS 本机 136 passed、2 项 Windows-only 合同按平台跳过、0 failed；生产依赖高危审计通过；
- 1,050 个无关文件的失败 Research Run 可从同一 checkpoint 恢复成功；修改真正读取过的资料会阻断恢复，修改未读取资料或运行目录文件不会；
- macOS DMG：222,390,401 bytes，SHA-256 `f48c7c752a898700dab8379b4475f1ae67dc5fe2831c35f03b720678a5032488`；ZIP：221,174,198 bytes，SHA-256 `a77246a16a525685331d0e4f22703cd59f54d35c55c2a5046f765afa83a21444`；
- `pnpm verify:mac-package` 证明版本、DMG 完整性、strict-deep ad-hoc 签名、14 个相对 symlink、Fuse、ASAR、内置浏览器和 Renderer smoke；最终 `app.asar` SHA-256 为 `fcdef5c6ef210f20a4dc05181a4a232a38528b367140df4620d664bab423f194`；
- 最终打包 App 已在 macOS 实际重启，显式显示“运行位置”“本次资料”和“不扫描运行位置”，原生文件选择器可打开和取消。没有把既有 v3 whole-workspace Provider Run 冒充为 v4 explicit-sources 验收。
- 提交 `c9a7e4ab979ea7ef9760681f66e0e4a8a5962a8a` 的 [`v0.11.2` Release Gate `31767365053`](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/actions/runs/31767365053) 通过 Windows 原生构建、安装版合成灰度、恢复/重启矩阵和发布；Release 的 Setup 为 266,290,688 bytes、SHA-256 `6ac196352396069e8df4d5a25d52654c9358e7dd8617028d2f887ce990c5f77f`，ZIP 为 274,222,866 bytes、SHA-256 `241a72634e82c241d6d64bc74eb124b6ac68e247300eab2afad0a129bb3a428a`；三项资产已在新临时目录回下载，清单与 GitHub digest 一致。

## 0.11.1 — 2026-08-13

M10.3 Provider Setup 私有 Engineering Alpha。完成本机源码、测试、macOS 打包与安装验收，并将后续灰度与发布转为 Windows-first；Windows 11 真人灰度仍开放，不属于公开稳定版。

### Added

- 侧边栏一级“Provider 设置”和 DeepSeek/OpenAI 独立状态卡；
- 环境变量、系统安全存储、未配置三种凭据来源状态；
- 系统凭据替换，以及经 Electron 原生确认的删除流程；
- 用户显式触发、只请求 `/models` 的连接验证；
- Composer Provider 状态标签、缺失提示和启动前硬拦截。

### Changed

- Model 与 Base URL 移入 Provider 高级设置；“扩展配置”只保留 Skills、MCP 和 Browser；
- Bootstrap 和凭据写入 IPC 返回有界状态对象，不再只返回布尔值；
- 保存凭据不会自动联网，连接验证与真实 Run 分别需要独立用户动作。
- Windows Setup 文件名从 `package.json` 派生版本；Linux DEB 显式依赖提供 `secret-tool` 的 `libsecret-tools`；
- Windows 发布作业新增生产依赖高危审计；开发期 Electron 打包链的上游 `extract-zip` 无修复版本告警已如实登记，不做静默忽略。
- 包级首次启动 smoke 会清空 Provider 环境变量、隔离用户数据并屏蔽系统凭据命令，断言 Guide、DeepSeek/OpenAI 未配置状态以及连接/运行禁用门禁；Windows 原生构建与 Release 还必须先运行 Setup、从安装目录首启并调用 Squirrel 卸载。
- Electron Main 接入标准 Squirrel install/update/uninstall 生命周期处理，避免安装生命周期事件误开普通窗口。
- CI 调整为 Windows-first：Windows `pnpm check` 与安装级无 Provider 首启成为 PR 门禁，Linux 移至每周/手动的非阻塞维护；
- 新增 `windows-synthetic-gray` 夜间、手动和 PR label 工作流，以本地确定性 Provider 驱动真实安装版完成 Credential Manager、连接故障、Research Run、双 Run 取消、硬退出、checkpoint 恢复和重启循环；
- `v*` Tag Release 改为 Windows-only 门禁和资产发布；带预发布后缀的 Tag 自动创建 GitHub prerelease，Linux 不再阻塞 Windows RC；
- PR 不再上传约 800 MB 的完整 Forge 目录；只在 `main` 保存 Setup/ZIP，并缩短普通 CI artifact 保留期；
- Windows 全量测试先安装 Chromium；macOS-only/隔离宿主依赖用例逐项标记平台边界，同时新增 Windows 本地进程与 stdio MCP fail-closed 反向合同，并修复最近工作区测试的 Windows 路径兼容性；
- 取消测试在删除临时工作区前等待 `DesktopRunManager.waitForIdle()`，避免 Windows 在终态事件已发布但 `runtime-lock` 仍释放中时触发 `EPERM`；这不改变取消语义。

### Fixed

- macOS DMG 制作和验证脚本不再硬编码旧版本文件名，改为读取、校验 `package.json` 版本，并复核 App Bundle 版本一致。
- Composer 控制台改为紧凑的“任务输入 + 控制工具栏”：移除占高的字段标题与 16 列空栅格，Provider、信任、模式和并发只展示当前值，凭据与扩展入口使用短状态，执行按钮固定在右侧；窄窗口仅让工具项自然换行。

### Security

- Windows 合成灰度只使用 loopback Mock Provider 和固定公开夹具凭据，不读取 Actions secrets；测试前拒绝覆盖现有系统凭据，结束时删除测试项；
- 上传证据限定为脱敏 JSON 和固定夹具截图，不上传 Run Request、事件日志、工作区或凭据内容。

### Evidence

- 规格：[`docs/M10.3-SPEC.md`](docs/M10.3-SPEC.md)；
- 验收：[`docs/M10.3-VALIDATION.md`](docs/M10.3-VALIDATION.md)；
- `pnpm check`：当前 123 项；macOS 本机 121 passed、2 项 Windows-only 合同按平台跳过、0 failed；
- macOS 无 Provider 凭据包级首次启动 smoke 通过；[`windows-2025` 安装级 PR run `31665000997`](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/actions/runs/31665000997) 也已通过，Setup 退出码、安装目录 EXE、截图与 JSON artifact 均已核对；
- Windows-first 最终证据：[`ci` run `31670064596`](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/actions/runs/31670064596) 与 [`windows-synthetic-gray` run `31670064610`](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/actions/runs/31670064610) 均通过；后者覆盖 Credential Manager、完整连接故障矩阵、安装版 Research Run、双 Run 取消、硬退出恢复和 5 次额外重启；
- macOS DMG：224,991,198 bytes，SHA-256 `0a533b7d2397f40e82073697e0b026f243518c98198ef10625a6eecbffb46437`，挂载后包验证通过；
- [`v0.11.1` Release](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/releases/tag/v0.11.1)：Tag 固定在 `09c7be6`；Windows Release Gate `31675334513` 第 2 次尝试通过，Setup/ZIP 和 LF SHA-256 清单已发布并回下载核验。

## 0.11.0 — 2026-08-13

M10.2 First Trusted Run 私有 Engineering Alpha。macOS 内部包已完成本机验收；Windows 资产已由 `v0.11.0` Tag 的原生 workflow 构建、发布并回下载核验。本版本不属于公开分发。

### Added

- 永久可返回、完全本地且不调用模型的“指引与示例”会话；
- 按真实任务结果组织的教程、资料研究和安全 Coding 能力卡；
- 工作区、Git、Provider 可用性与人工控制准备检查，Renderer 只接收凭据布尔状态；
- 显式创建、唯一目录、不会覆盖旧文件的合成教程工作区；
- 三个只预填、不自动执行的有界任务模板；
- 由真实 Run/审批/集成/失败状态驱动的上下文提示。

### Changed

- 首次启动不再默认选择整个 Documents；没有明确工作区时保持未选择状态；
- 切换工作区会清空编辑器中的旧目标，避免跨工作区携带上下文；
- 指引偏好采用版本化、`0600` 私有本地状态，可关闭并永久重新打开。

### Evidence

- 规格：[`docs/M10.2-SPEC.md`](docs/M10.2-SPEC.md)；
- 验收：[`docs/M10.2-VALIDATION.md`](docs/M10.2-VALIDATION.md)；
- `pnpm check`：113/113 tests passed；
- macOS DMG：224,031,108 bytes，SHA-256 `379e8e49522c4f97cc22a436f0507675128ac395a4d994649c1b3d4924afb145`，挂载后包验证通过；
- [`main` CI](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/actions/runs/31622109045)：macOS 检查、Linux/Windows 合同与原生打包五项作业全部通过；
- [`v0.11.0` Release](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/releases/tag/v0.11.0)：Windows Setup/ZIP 和 LF SHA-256 清单已发布并回下载核验。

## 0.10.0 — 2026-08-13

M10.1 Internal Dogfood 版本。当前只完成本机源码、功能和 macOS 内部包验收；没有创建 Tag、GitHub Release 或公开分发。

### Added

- Run 级耗时、模型调用、Provider token、失败、Artifact Gate 重试和失败阶段投影；
- 最近工作区、校验后的文本 Artifact 内嵌预览，以及显式“基于此产物继续”组合器；
- 失败 Run 从同一安全 checkpoint 恢复，仅重试未完成 Task 链；
- Artifact Gate 可执行反馈与三次失败写入上限。

### Changed

- 诊断导出改用应用级原生保存流程，并保持 `0600` 文件权限；
- MCP stdio 启动失败增加有界、脱敏的子进程诊断；
- Electron 应用补齐点头品牌图标、DMG 背景和 Finder 布局。

### Fixed

- DMG 制作保留 Framework 相对符号链接，包验证新增挂载后 strict-deep 签名与不安全链接检查；
- 工作区进程锁释放/重获竞态；
- 跨 Agent 复用同一确定性计算时的错误冲突；
- 已提交 Integration 的撤销确认文案与实际 reverse commit 语义不一致。

### Evidence

- M10.1 验收：[`docs/M10-VALIDATION.md`](docs/M10-VALIDATION.md)；
- 本机实测：[`docs/DOGFOOD-2026-08-12.md`](docs/DOGFOOD-2026-08-12.md)；
- `pnpm check`：109/109 tests passed；
- macOS DMG：224,034,339 bytes，SHA-256 `20f7b80ece11ce125b8e4332f9351e8c8fe45c6613923048bb7e37c79aa7195b`，挂载后包验证通过。

## 0.9.0 — 2026-08-08

首个可安装的内部 Engineering Alpha。

### Added

- 多 Run、多 Task、多 Agent 并发运行时和 append-only 审计事件；
- Research/Coding 工作流、Git worktree 隔离、组合预检和人工集成 Gate；
- Research/Coding checkpoint resume、request replay、worktree 生命周期和精确恢复；
- DeepSeek/OpenAI Provider、本地/签名 Skills、MCP stdio/HTTP/OAuth 和受限 Browser；
- macOS Seatbelt、Linux 容器执行宿主、三档信任策略和跨进程容量/预算协调；
- Desktop Provider 凭证设置、Integration inline diff 和脱敏诊断导出；
- macOS ad-hoc ZIP/DMG、Linux DEB、Windows Squirrel Setup/ZIP 构建链；
- 私有 GitHub Release 中的 Windows Setup、便携 ZIP 和 SHA-256 清单。

### Evidence

- M10 验收：[`docs/M10-VALIDATION.md`](docs/M10-VALIDATION.md)；
- Release：[`LocalBuddy v0.9.0`](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/releases/tag/v0.9.0)；
- Tag 源提交：`38cefd8cd6045e64754dd60920bdfa3d50c2a9b7`。

### Known boundaries

- Windows 安装包未完成真机端到端验收，Windows 本地进程型工具 fail closed；
- macOS 包为 ad-hoc 签名，Windows 包未做代码签名；
- 生产第三方 MCP OAuth、公开分发签名与自动替换应用不在本版本验收范围。
