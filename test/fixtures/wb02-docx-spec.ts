import type { DocxArtifactSpec } from "../../src/docx-artifact.js";

export const wb02ExecutiveSummary = "试点覆盖华东区24名用户，8月24日启动四周；完成权限检查和培训后方可导入真实客户数据，首周仅开放线索录入和周报导出。";

export const wb02InitialExecutiveSummary = "本项目将在华东区3个销售小组中开展为期四周的CRM内部试点，覆盖24名一线用户，计划于2026年8月24日启动。试点开始前必须完成数据权限检查和管理员培训，第一周只开放线索录入和周报导出，不开放自动外呼。预算上限为12万元，其中软件与部署7万元、培训和现场支持最多3万元、风险准备金2万元；真实客户数据导入、历史CSV字段、季度末培训时间和外呼合规仍需重点管控。";

export const wb02DocxVersionOne: DocxArtifactSpec = {
  version: 1,
  title: "CRM 内部试点会议纪要",
  subtitle: "华东区内部试点",
  metadata: [
    { label: "开始时间", value: "2026-08-24" },
    { label: "周期", value: "四周" },
    { label: "参与范围", value: "华东区 3 个销售小组，共 24 名一线用户" },
  ],
  sections: [
    {
      heading: "执行摘要",
      blocks: [{ type: "paragraph", text: wb02InitialExecutiveSummary }],
    },
    {
      heading: "已确认决定",
      blocks: [{
        type: "bullets",
        items: [
          "华东区 3 个销售小组，共 24 名一线用户",
          "内部试点开始时间为 2026-08-24，为期四周",
          "完成数据权限检查和管理员培训后才能导入真实客户数据",
          "第一周只开放线索录入和周报导出，不开放自动外呼",
        ],
      }],
    },
    {
      heading: "行动项",
      blocks: [{
        type: "table",
        columns: ["负责人", "截止日期", "交付物"],
        rows: [
          ["李闻", "2026-08-12", "冻结试点功能清单"],
          ["周宁", "2026-08-14", "完成权限检查"],
          ["周宁", "2026-08-18", "准备试点环境"],
          ["蒋菲", "2026-08-17", "确认 24 名试点用户"],
          ["蒋菲", "2026-08-21", "完成管理员培训"],
          ["孙至", "待确认", "预算发生变化时负责复核"],
        ],
      }],
    },
    {
      heading: "预算",
      blocks: [{
        type: "table",
        columns: ["项目", "金额（元）", "约束"],
        rows: [
          ["预算总额", "120000", "不得突破"],
          ["软件与部署", "70000", "专项使用"],
          ["培训与支持", "30000", "最高额度"],
          ["风险预备金", "20000", "须经孙至书面确认"],
        ],
      }],
    },
    {
      heading: "风险与边界",
      blocks: [{
        type: "bullets",
        items: [
          "历史 CSV 字段不统一，可能影响导入",
          "一线用户在季度末参与培训的时间有限",
          "自动外呼涉及额外合规审查，本期明确不启用",
          "本材料没有确认供应商报价，也没有承诺试点转正式采购",
        ],
      }],
    },
  ],
};

export const wb02DocxVersionTwo: DocxArtifactSpec = {
  ...wb02DocxVersionOne,
  revisionNote: "V2 新增不超过 120 个中文字符的执行摘要；会议决定、行动项与预算表保持可追溯。",
  sections: [
    { heading: "执行摘要", blocks: [{ type: "paragraph", text: wb02ExecutiveSummary }] },
    ...wb02DocxVersionOne.sections.slice(1),
  ],
};
