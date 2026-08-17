import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parse } from "yaml";

test("public bug Issue Form has required evidence fields and an explicit privacy gate", async () => {
  const source = await readFile(".github/ISSUE_TEMPLATE/bug-report.yml", "utf8");
  const form = parse(source) as {
    labels?: unknown[];
    body?: Array<{
      type?: string;
      id?: string;
      attributes?: { value?: string; options?: Array<{ label?: string; required?: boolean }> };
      validations?: { required?: boolean };
    }>;
  };
  assert.ok(form.labels?.includes("bug"));
  const ids = new Set(form.body?.map((item) => item.id).filter((id): id is string => id !== undefined));
  for (const id of ["actual", "expected", "reproduction", "environment", "trace", "privacy"]) {
    assert.ok(ids.has(id), `Issue Form is missing ${id}`);
  }
  assert.equal(form.body?.find((item) => item.id === "actual")?.validations?.required, true);
  assert.equal(form.body?.find((item) => item.id === "reproduction")?.validations?.required, true);
  assert.equal(form.body?.find((item) => item.id === "trace")?.validations?.required, true);
  const privacy = form.body?.find((item) => item.id === "privacy");
  assert.equal(privacy?.type, "checkboxes");
  assert.equal(privacy?.attributes?.options?.[0]?.required, true);
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
  assert.match(renderer, /我已检查上面所有将被预填的公开字段/);
  assert.match(renderer, /你还需要登录 GitHub、再次检查并亲自点击 Submit new issue/);
  assert.match(renderer, /不会把这份报告发送给 GitHub/);
  assert.match(publicReport, /hostname !== "github\.com"/);
  assert.match(publicReport, /url\.username !== "" \|\| url\.password !== ""/);
  assert.doesNotMatch(publicReport, /Authorization:/);
});
