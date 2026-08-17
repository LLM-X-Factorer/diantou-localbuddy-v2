import { createHash } from "node:crypto";

import type { DesktopBuildIdentity } from "./build-identity.js";
import type {
  DesktopBugReportDuplicateCheck,
  DesktopBugReportRequest,
  DesktopPublicBugReportPreview,
  DesktopRunView,
} from "./desktop-contract.js";

export const PUBLIC_BUG_REPORT_DESTINATION = "github.com/LLM-X-Factorer/diantou-localbuddy-v2";
export const PUBLIC_BUG_REPORT_OWNER = "LLM-X-Factorer";
export const PUBLIC_BUG_REPORT_REPOSITORY = "diantou-localbuddy-v2";
export const PUBLIC_BUG_REPORT_URL_LIMIT = 7_500;

const ISSUE_FORM_URL = `https://github.com/${PUBLIC_BUG_REPORT_OWNER}/${PUBLIC_BUG_REPORT_REPOSITORY}/issues/new`;
const ISSUE_API_URL = `https://api.github.com/repos/${PUBLIC_BUG_REPORT_OWNER}/${PUBLIC_BUG_REPORT_REPOSITORY}/issues?state=open&labels=bug&per_page=100`;
const SIGNATURE_PREFIX = "localbuddy-signature:v1:";
const TASK_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "blocked",
  "cancelled",
  "interrupted",
] as const;

export interface PublicBugReportBuildInput {
  run: DesktopRunView;
  request: DesktopBugReportRequest;
  build: DesktopBuildIdentity;
  platform: NodeJS.Platform;
  arch: string;
}

interface SanitizedText {
  value: string;
  redactions: string[];
}

export function buildPublicBugReport(input: PublicBugReportBuildInput): Omit<DesktopPublicBugReportPreview, "duplicateCheck"> {
  const actual = sanitizePublicBugReportText(input.request.actual);
  const expected = sanitizePublicBugReportText(input.request.expected);
  const reproduction = sanitizePublicBugReportText(input.request.reproduction);
  const redactions = [...new Set([
    ...actual.redactions,
    ...expected.redactions,
    ...reproduction.redactions,
  ])].sort();
  const failureCode = classifyFailure(input.run);
  const taskCounts = Object.fromEntries(TASK_STATUSES.map((status) => [
    status,
    input.run.tasks.filter((task) => task.status === status).length,
  ]));
  const recentEventTypes = input.run.recentEvents
    .map((event) => safeEventType(event.type))
    .slice(-12);
  const signaturePayload = {
    schema: 1,
    platform: input.platform,
    arch: input.arch,
    mode: input.run.mode,
    status: input.run.status,
    failureStage: input.run.metrics.failureStage ?? "unknown",
    failureCode,
    taskCounts,
    checkpoint: input.run.checkpoint?.status ?? "none",
    integration: input.run.integration?.status ?? "none",
    modelFailures: input.run.metrics.modelFailures,
    toolFailures: input.run.metrics.toolFailures,
    artifactGateRetries: input.run.metrics.artifactGateRetries,
    recentEventTypes,
  };
  const signature = `${SIGNATURE_PREFIX}${createHash("sha256")
    .update(JSON.stringify(signaturePayload))
    .digest("hex")}`;
  const environment = [
    `LocalBuddy: v${input.build.version}`,
    `Build: ${input.build.channel} / ${safeBuildSha(input.build.sha)}${input.build.dirty ? " +dirty" : ""} / ${input.build.packaged ? "packaged" : "development"}`,
    `System: ${input.platform} / ${safeToken(input.arch, "unknown")}`,
    `Run: ${input.run.mode} / ${input.run.status} / ${input.run.runtimeOwner ?? "unknown"}`,
    `Failure: ${input.run.metrics.failureStage ?? "unknown"} / ${failureCode}`,
  ].join("\n");
  const trace = [
    signature,
    `duration_ms: ${safeCount(input.run.metrics.durationMs)}`,
    `tasks: ${TASK_STATUSES.map((status) => `${status}=${taskCounts[status] ?? 0}`).join(", ")}`,
    `model_calls: ${safeCount(input.run.metrics.modelCalls)}`,
    `total_tokens: ${safeCount(input.run.metrics.totalTokens)}`,
    `model_failures: ${safeCount(input.run.metrics.modelFailures)}`,
    `tool_failures: ${safeCount(input.run.metrics.toolFailures)}`,
    `artifact_gate_retries: ${safeCount(input.run.metrics.artifactGateRetries)}`,
    `checkpoint: ${input.run.checkpoint?.status ?? "none"} / completed=${safeCount(input.run.checkpoint?.completedTasks)} / resumable=${safeCount(input.run.checkpoint?.resumableTasks)}`,
    `artifact_review: ${input.run.artifactReview?.status ?? "none"} / findings=${safeCount(input.run.artifactReview?.findingCount)}`,
    `integration: ${input.run.integration?.status ?? "none"} / changed_paths=${safeCount(input.run.integration?.changedPaths.length)}`,
    `events: total=${safeCount(input.run.eventCount)} / recent_types=${recentEventTypes.join(" > ") || "none"}`,
  ].join("\n");
  const title = `[Bug] ${input.run.metrics.failureStage ?? "runtime"}/${failureCode} on ${input.platform} · v${input.build.version}`;
  const fields = {
    actual: actual.value,
    expected: expected.value,
    reproduction: reproduction.value,
    environment,
    trace,
  };
  const issueUrl = buildIssueFormUrl(title, fields);
  const included = [
    "你检查后的现象、预期和复现步骤",
    "LocalBuddy 版本、构建通道、操作系统和 CPU 架构",
    "受控失败分类、状态计数和最近事件类型顺序",
  ];
  const omitted = [
    "提示词、目标正文和模型输出",
    "工作区路径、资料名、工件名和文件内容",
    "Run / Task / Agent ID、原始错误和事件详情",
    "Provider 凭据、工具参数、命令、commit 和文件哈希",
  ];
  const previewMarkdown = renderPublicBugReportMarkdown(title, fields, included, omitted, redactions);
  const previewSha256 = createHash("sha256")
    .update(JSON.stringify({ title, fields, included, omitted, redactions }))
    .digest("hex");

  return {
    version: 1,
    destination: PUBLIC_BUG_REPORT_DESTINATION,
    title,
    issueUrl,
    signature,
    previewSha256,
    fields,
    previewMarkdown,
    included,
    omitted,
    redactions,
  };
}

export function sanitizePublicBugReportText(value: string): SanitizedText {
  let result = value.replace(/\r\n?/g, "\n").trim();
  const redactions = new Set<string>();
  const replace = (pattern: RegExp, replacement: string, label: string) => {
    const updated = result.replace(pattern, replacement);
    if (updated !== result) redactions.add(label);
    result = updated;
  };

  replace(/\bhttps?:\/\/[^\s/@:]+:[^\s/@]+@[^\s]+/giu, "[redacted credential URL]", "带凭据的网址");
  replace(/\b(?:sk|pk)-[a-z0-9_-]{8,}\b/giu, "[redacted secret]", "疑似 API Key");
  replace(/\bBearer\s+[a-z0-9._~+/=-]{8,}/giu, "Bearer [redacted]", "Bearer Token");
  replace(/\b(api[ _-]?key|access[ _-]?token|refresh[ _-]?token|token|secret|password|authorization)\s*[:=]\s*[^\s,;]+/giu, "$1=[redacted]", "疑似凭据字段");
  replace(/\b[A-Z]:\\Users\\[^\\\s]+(?:\\[^\s"'<>]*)?/giu, "[redacted local path]", "Windows 用户路径");
  replace(/\/(?:Users|home)\/[^/\s]+(?:\/[^\s"'<>]*)?/gu, "[redacted local path]", "本机用户路径");
  replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[redacted email]", "邮箱地址");
  replace(/@/gu, "＠", "@ 提及");
  replace(/</gu, "‹", "HTML 标记");
  replace(/>/gu, "›", "HTML 标记");
  return { value: result, redactions: [...redactions] };
}

export async function findDuplicatePublicBugReport(
  signature: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<DesktopBugReportDuplicateCheck> {
  try {
    const response = await fetcher(ISSUE_API_URL, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal,
    });
    if (!response.ok) return { status: "unavailable" };
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) return { status: "unavailable" };
    for (const item of payload) {
      if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
      const issue = item as Record<string, unknown>;
      if (issue.pull_request !== undefined || typeof issue.body !== "string" || !issue.body.includes(signature)) continue;
      if (typeof issue.html_url !== "string" || !isAllowedPublicBugReportUrl(issue.html_url, "existing")) continue;
      if (typeof issue.number !== "number" || !Number.isSafeInteger(issue.number) || issue.number < 1) continue;
      return {
        status: "found",
        issueNumber: issue.number,
        title: typeof issue.title === "string" ? issue.title.slice(0, 160) : `Issue #${issue.number}`,
        url: issue.html_url,
      };
    }
    return { status: "none" };
  } catch {
    return { status: "unavailable" };
  }
}

export function isAllowedPublicBugReportUrl(value: string, kind: "new" | "existing"): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port !== "") return false;
    if (url.username !== "" || url.password !== "" || url.hash !== "") return false;
    const prefix = `/${PUBLIC_BUG_REPORT_OWNER}/${PUBLIC_BUG_REPORT_REPOSITORY}/issues/`;
    if (kind === "existing") {
      return new RegExp(`^${escapeRegExp(prefix)}[1-9]\\d*$`, "u").test(url.pathname) && url.search === "";
    }
    return url.pathname === `${prefix}new`
      && url.searchParams.get("template") === "bug-report.yml"
      && url.searchParams.has("title")
      && url.searchParams.has("actual")
      && url.searchParams.has("reproduction");
  } catch {
    return false;
  }
}

function classifyFailure(run: DesktopRunView): string {
  const messages = [run.error, ...run.tasks.map((task) => task.error)].filter((value): value is string => value !== undefined);
  const joined = messages.join("\n");
  if (/workspace snapshot exceeded the safe checkpoint entry limit|checkpoint entry limit/iu.test(joined)) return "checkpoint_entry_limit";
  if (/exceeded\s+\d+\s+model turns|model turn(?:s)? limit|turn budget/iu.test(joined)) return "turn_budget_exceeded";
  if (/\b429\b|rate[ -]?limit/iu.test(joined)) return "provider_rate_limited";
  if (/\b401\b|unauthori[sz]ed|authentication failed|invalid api key/iu.test(joined)) return "provider_authentication";
  if (/timed?\s*out|timeout/iu.test(joined)) return "provider_timeout";
  return "unclassified";
}

function safeEventType(value: string): string {
  return /^[a-z0-9_.:-]{1,64}$/u.test(value) ? value : "unknown";
}

function safeBuildSha(value: string): string {
  return /^[a-f0-9]{7,40}$/u.test(value) ? value.slice(0, 12) : "unknown";
}

function safeToken(value: string, fallback: string): string {
  return /^[a-z0-9_.-]{1,40}$/iu.test(value) ? value : fallback;
}

function safeCount(value: number | undefined): number | "unknown" {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : "unknown";
}

function buildIssueFormUrl(title: string, fields: DesktopPublicBugReportPreview["fields"]): string {
  const url = new URL(ISSUE_FORM_URL);
  url.searchParams.set("template", "bug-report.yml");
  url.searchParams.set("title", title);
  for (const [key, value] of Object.entries(fields)) url.searchParams.set(key, value);
  const result = url.toString();
  if (result.length > PUBLIC_BUG_REPORT_URL_LIMIT) {
    throw new Error("公开报告超过 GitHub 安全预填长度，请缩短现象或复现步骤");
  }
  if (!isAllowedPublicBugReportUrl(result, "new")) throw new Error("公开报告目标地址无效");
  return result;
}

function renderPublicBugReportMarkdown(
  title: string,
  fields: DesktopPublicBugReportPreview["fields"],
  included: readonly string[],
  omitted: readonly string[],
  redactions: readonly string[],
): string {
  return [
    `# ${title}`,
    "",
    "> 以下五个字段会被预填到公开 GitHub Issue；LocalBuddy 不会自动发布。",
    "",
    "## 实际发生",
    fields.actual || "（未填写）",
    "",
    "## 预期结果",
    fields.expected || "（未填写）",
    "",
    "## 复现步骤",
    fields.reproduction || "（未填写）",
    "",
    "## 环境",
    "```text",
    fields.environment,
    "```",
    "",
    "## 公开安全轨迹",
    "```text",
    fields.trace,
    "```",
    "",
    "## 数据边界",
    "以下核对说明只保存在本机预览，不会被预填到 GitHub：",
    ...included.map((item) => `- 包含：${item}`),
    ...omitted.map((item) => `- 未包含：${item}`),
    ...(redactions.length === 0 ? ["- 自动遮盖：未触发"] : redactions.map((item) => `- 自动遮盖：${item}`)),
    "",
  ].join("\n");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
