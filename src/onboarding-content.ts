import type { DesktopRunMode, DesktopTrustProfile } from "./desktop-contract.js";

export type GuideTemplateId = "tutorial-research" | "workspace-research" | "safe-code";

export interface GuideTemplate {
  id: GuideTemplateId;
  mode: DesktopRunMode;
  trustProfile: DesktopTrustProfile;
  goal: string;
}

export const GUIDE_TEMPLATES: Readonly<Record<GuideTemplateId, GuideTemplate>> = {
  "tutorial-research": {
    id: "tutorial-research",
    mode: "research",
    trustProfile: "balanced",
    goal: "阅读当前教程工作区中的三份材料，生成 first-run-brief.md。报告必须包含：三条标注来源文件名的事实、两个仍待验证的问题、三项按优先级排序的下一步行动。不得补写材料中不存在的数据；无法确认之处明确标记为未知。",
  },
  "workspace-research": {
    id: "workspace-research",
    mode: "research",
    trustProfile: "balanced",
    goal: "阅读当前工作区中的相关资料，生成一份有文件名来源的简报。区分已知事实、仍待验证的问题和建议行动；不得把材料中没有的信息写成事实。",
  },
  "safe-code": {
    id: "safe-code",
    mode: "code",
    trustProfile: "balanced",
    goal: "检查当前 Git 仓库的 README.md，在不修改其他文件的前提下补充或改进“本地开发”说明。只在隔离 worktree 中修改，运行允许的检查并生成可审阅 Diff；等待我明确批准后再写回主工作区。",
  },
};
