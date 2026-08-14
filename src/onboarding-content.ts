import type { DesktopRunMode, DesktopTrustProfile } from "./desktop-contract.js";

export type GuideTemplateId = "tutorial-research" | "workspace-research" | "safe-code";

export interface GuideTemplate {
  id: GuideTemplateId;
  mode: DesktopRunMode;
  trustProfile: DesktopTrustProfile;
  goal: string;
  constraints: readonly string[];
  verificationCriteria: readonly string[];
}

export const GUIDE_TEMPLATES: Readonly<Record<GuideTemplateId, GuideTemplate>> = {
  "tutorial-research": {
    id: "tutorial-research",
    mode: "research",
    trustProfile: "balanced",
    goal: "阅读当前教程工作区中的三份材料，生成 first-run-brief.md。报告必须包含：三条标注来源文件名的事实、两个仍待验证的问题、三项按优先级排序的下一步行动。不得补写材料中不存在的数据；无法确认之处明确标记为未知。",
    constraints: [
      "只读取本次明确添加的三份教程资料。",
      "不得把材料中没有的信息写成事实。",
    ],
    verificationCriteria: [
      "生成并登记 first-run-brief.md。",
      "报告包含三条来源事实、两个待验证问题和三项排序后的行动。",
    ],
  },
  "workspace-research": {
    id: "workspace-research",
    mode: "research",
    trustProfile: "balanced",
    goal: "阅读当前工作区中的相关资料，生成一份有文件名来源的简报。区分已知事实、仍待验证的问题和建议行动；不得把材料中没有的信息写成事实。",
    constraints: ["只使用本次明确添加的资料和启用的扩展。"],
    verificationCriteria: ["生成一份登记的 Markdown 简报，并标注来源文件名和证据缺口。"],
  },
  "safe-code": {
    id: "safe-code",
    mode: "code",
    trustProfile: "balanced",
    goal: "检查当前 Git 仓库的 README.md，在不修改其他文件的前提下补充或改进“本地开发”说明。只在隔离 worktree 中修改，运行允许的检查并生成可审阅 Diff；等待我明确批准后再写回主工作区。",
    constraints: ["只允许修改 README.md。", "主工作区在人工批准前保持不变。"],
    verificationCriteria: ["生成可审阅 Diff。", "git_diff_check 通过并报告其余检查结果。"],
  },
};
