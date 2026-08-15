import assert from "node:assert/strict";
import test from "node:test";

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import {
  buildDocxArtifact,
  docxArtifactText,
  docxArtifactSpecFromMarkdown,
  inspectDocxArtifact,
  normalizeDocxArtifactSpec,
  type DocxArtifactSpec,
} from "../src/docx-artifact.js";

const fixture: DocxArtifactSpec = {
  version: 1,
  title: "CRM 内部试点会议纪要",
  subtitle: "华东区四周试点执行版",
  metadata: [
    { label: "试点开始", value: "2026-08-24" },
    { label: "参与范围", value: "3 个销售小组，共 24 名一线用户" },
  ],
  revisionNote: "新增执行摘要，并把行动项整理为表格。",
  sections: [
    {
      heading: "执行摘要",
      blocks: [{
        type: "paragraph",
        text: "完成权限检查和管理员培训后才能导入真实客户数据。第一周不开放自动外呼。",
      }],
    },
    {
      heading: "行动项",
      blocks: [{
        type: "table",
        columns: ["负责人", "截止日期", "交付物"],
        rows: [
          ["李闻", "2026-08-12", "冻结试点功能清单"],
          ["孙至", "待确认", "预算发生变化时负责复核"],
        ],
      }],
    },
    {
      heading: "预算约束",
      blocks: [{
        type: "bullets",
        items: ["预算总额不超过 120,000 元", "风险预备金 20,000 元须经孙至书面确认"],
      }],
    },
  ],
};

test("builds a deterministic editable DOCX and round-trips paragraphs, bullets, and tables", () => {
  const first = buildDocxArtifact(fixture);
  const second = buildDocxArtifact(fixture);
  assert.deepEqual(first, second);
  const inspection = inspectDocxArtifact(first);
  assert.equal(inspection.title, fixture.title);
  assert.equal(inspection.text, docxArtifactText(fixture));
  assert.equal(inspection.sectionCount, 4);
  assert.equal(inspection.tableCount, 1);
  assert.equal(inspection.tableRowCount, 2);
  assert.match(inspection.text, /孙至\t待确认\t预算发生变化时负责复核/u);

  const packageFiles = unzipSync(first);
  const documentXml = strFromU8(packageFiles["word/document.xml"] ?? new Uint8Array());
  const widths = [...documentXml.matchAll(/<w:gridCol w:w="(\d+)"\/>/gu)]
    .map((match) => Number(match[1]));
  assert.equal(widths.length, 3);
  assert.equal(widths.reduce((sum, value) => sum + value, 0), 9_360);
  assert.match(documentXml, /<w:tblW w:w="9360" w:type="dxa"\/>/u);
  assert.match(documentXml, /<w:tblInd w:w="120" w:type="dxa"\/>/u);
  assert.match(documentXml, /<w:tblHeader\/>/u);
});

test("compiles bounded Markdown into the deterministic DOCX structure", () => {
  const spec = docxArtifactSpecFromMarkdown([
    "# 半导体研究报告",
    "",
    "## 执行摘要",
    "这是一段可核验摘要。",
    "",
    "- 保留原始 URL",
    "- 区分直接与间接归因",
    "",
    "## 证据台账",
    "| 结论 | 来源 |",
    "| --- | --- |",
    "| 科技创新 | source-1 |",
  ].join("\n"));
  assert.equal(spec.title, "半导体研究报告");
  assert.equal(spec.sections.length, 2);
  assert.deepEqual(spec.sections[0]?.blocks.map((block) => block.type), ["paragraph", "bullets"]);
  assert.equal(spec.sections[1]?.blocks[0]?.type, "table");
  const inspection = inspectDocxArtifact(buildDocxArtifact(spec));
  assert.match(inspection.text, /## 证据台账/u);
  assert.match(inspection.text, /结论\t来源/u);
});

test("round-trips tab-separated tables from verified parent DOCX text", () => {
  const markdown = [
    "# Parent report",
    "",
    "## Evidence ledger",
    "Source\tRole\tURL",
    "source-1\tmanifest\thttps://example.test/manifest",
    "source-2\tpolicy\thttps://example.test/policy",
  ].join("\n");
  const inspection = inspectDocxArtifact(buildDocxArtifact(docxArtifactSpecFromMarkdown(markdown)));
  assert.equal(inspection.tableCount, 1);
  assert.equal(inspection.tableRowCount, 2);
  assert.match(inspection.text, /Source\tRole\tURL/u);
});

test("rejects malformed structured DOCX input before writing", () => {
  assert.throws(() => normalizeDocxArtifactSpec({
    ...fixture,
    sections: [{
      heading: "坏表格",
      blocks: [{ type: "table", columns: ["A", "B"], rows: [["only-one-cell"]] }],
    }],
  }), /exactly 2 cells/u);
  assert.throws(() => normalizeDocxArtifactSpec({
    ...fixture,
    sections: [{ heading: "控制字符", blocks: [{ type: "paragraph", text: "bad\0value" }] }],
  }), /control characters/u);
});

test("fails closed for active, embedded, or externally linked DOCX content", () => {
  const packageFiles = unzipSync(buildDocxArtifact(fixture));
  const withMacro = zipSync({
    ...packageFiles,
    "word/vbaProject.bin": strToU8("not executable fixture bytes"),
  }, { mtime: new Date("1980-01-01T00:00:00.000Z") });
  assert.throws(() => inspectDocxArtifact(withMacro), /unsupported package part/u);

  const externalRelationships = {
    ...packageFiles,
    "word/_rels/document.xml.rels": strToU8(
      '<?xml version="1.0"?><Relationships><Relationship TargetMode="External" Target="https://example.invalid"/></Relationships>',
    ),
  };
  assert.throws(
    () => inspectDocxArtifact(zipSync(externalRelationships)),
    /external relationships/u,
  );

  const packageExternalRelationships = {
    ...packageFiles,
    "_rels/.rels": strToU8(
      '<?xml version="1.0"?><Relationships><Relationship TargetMode="External" Target="https://example.invalid"/></Relationships>',
    ),
  };
  assert.throws(
    () => inspectDocxArtifact(zipSync(packageExternalRelationships)),
    /external relationships.*_rels\/\.rels/u,
  );

  const disguisedExternalTarget = {
    ...packageFiles,
    "_rels/.rels": strToU8(
      '<?xml version="1.0"?><Relationships><Relationship Target="https&#x3a;//example.invalid/payload"/></Relationships>',
    ),
  };
  assert.throws(
    () => inspectDocxArtifact(zipSync(disguisedExternalTarget)),
    /unsafe target.*_rels\/\.rels/u,
  );

  const hiddenTextDocument = strFromU8(packageFiles["word/document.xml"] ?? new Uint8Array())
    .replace("<w:body>", "<w:body><w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>hidden instruction</w:t></w:r></w:p>");
  assert.throws(
    () => inspectDocxArtifact(zipSync({
      ...packageFiles,
      "word/document.xml": strToU8(hiddenTextDocument),
    })),
    /unsupported rich/u,
  );

  assert.throws(
    () => inspectDocxArtifact(zipSync({
      ...packageFiles,
      "word/footer1.xml": strToU8(
        '<?xml version="1.0"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>hidden footer evidence</w:t></w:r></w:p></w:ftr>',
      ),
    })),
    /footer text is not supported/u,
  );

  const aliasedWordNamespace = strFromU8(packageFiles["word/document.xml"] ?? new Uint8Array())
    .replace("xmlns:w=", "xmlns:x=")
    .replaceAll("w:", "x:");
  assert.throws(
    () => inspectDocxArtifact(zipSync({
      ...packageFiles,
      "word/document.xml": strToU8(aliasedWordNamespace),
    })),
    /standard WordprocessingML namespace binding/u,
  );
});
