import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parse } from "yaml";

test("public bug Issue Form accepts an automatic problem summary and safe trace", async () => {
  const source = await readFile(".github/ISSUE_TEMPLATE/bug-report.yml", "utf8");
  const form = parse(source) as {
    labels?: unknown[];
    body?: Array<{
      type?: string;
      id?: string;
      attributes?: { value?: string };
      validations?: { required?: boolean };
    }>;
  };
  assert.ok(form.labels?.includes("bug"));
  const ids = new Set(form.body?.map((item) => item.id).filter((id): id is string => id !== undefined));
  for (const id of ["problem", "environment", "trace"]) {
    assert.ok(ids.has(id), `Issue Form is missing ${id}`);
  }
  assert.equal(form.body?.find((item) => item.id === "problem")?.validations?.required, true);
  assert.equal(form.body?.find((item) => item.id === "trace")?.validations?.required, true);
  assert.equal(ids.has("actual"), false);
  assert.equal(ids.has("expected"), false);
  assert.equal(ids.has("reproduction"), false);
  assert.equal(ids.has("privacy"), false);
  assert.match(source, /This report is public/);
  assert.match(source, /Do not paste prompts, source documents/);
});

test("desktop public report requires preview consent and validates the exact GitHub destination", async () => {
  const [main, renderer, publicReport] = await Promise.all([
    readFile("desktop/main.ts", "utf8"),
    readFile("desktop/renderer/src/App.tsx", "utf8"),
    readFile("src/public-bug-report.ts", "utf8"),
  ]);
  assert.match(main, /confirmedPublicSubmission !== true/);
  assert.match(main, /report\.previewSha256 !== parsed\.confirmedPreviewSha256/);
  assert.match(main, /isAllowedPublicBugReportUrl\(target, kind\)/);
  assert.match(main, /AbortSignal\.timeout\(4_000\)/);
  assert.match(renderer, /GitHub Issue 是公开内容/);
  assert.match(renderer, /同意并在 GitHub 继续提交/);
  assert.match(renderer, /自动生成公开安全 Trace/);
  assert.doesNotMatch(renderer, /实际发生了什么|你原本期待什么|怎样复现/);
  assert.match(renderer, /LocalBuddy 不保存 GitHub Token，也不会替你点击最终提交/);
  assert.match(publicReport, /hostname !== "github\.com"/);
  assert.match(publicReport, /url\.username !== "" \|\| url\.password !== ""/);
  assert.doesNotMatch(publicReport, /Authorization:/);
});
