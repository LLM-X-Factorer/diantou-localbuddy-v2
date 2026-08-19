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
    goal: "读取本次明确添加的会议记录，生成可编辑的 会议纪要.docx。纪要包含会议主题、关键结论、行动项（事项、负责人、截止时间）和待确认事项。没有出现的负责人、日期或结论标记为“待确认”，不得猜测。",
    constraints: [
      "只读取本次明确添加的会议记录。",
      "不修改或覆盖原始会议记录。",
      "不得把记录中没有的信息写成事实。",
    ],
    verificationCriteria: [
      "生成并登记可编辑的 会议纪要.docx。",
      "纪要包含关键结论、行动项和待确认事项，缺失信息没有被猜测。",
    ],
  },
  "workspace-research": {
    id: "workspace-research",
    mode: "research",
    trustProfile: "balanced",
    goal: "读取本次明确添加的资料，生成一份可以打开和继续修改的结果。区分已知事实、仍待确认的问题和建议行动；不得把资料中没有的信息写成事实。",
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
