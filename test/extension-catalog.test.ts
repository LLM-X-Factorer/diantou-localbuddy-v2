import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { inspectWorkspaceExtensionCatalog } from "../src/extension-catalog.js";

test("discovers only bounded workspace Skills and MCP metadata without returning instructions or secrets", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-extension-catalog-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  const skillRoot = join(workspace, ".localbuddy", "skills", "evidence-review");
  await mkdir(skillRoot, { recursive: true });
  await writeFile(join(skillRoot, "SKILL.md"), [
    "---",
    "version: 1",
    "id: evidence-review",
    "title: Evidence Review",
    "description: Check claims against explicit sources.",
    "appliesTo: research",
    "---",
    "PRIVATE_INSTRUCTION_SENTINEL must never enter the Desktop catalog.",
    "",
  ].join("\n"), "utf8");
  await writeFile(join(workspace, ".localbuddy", "mcp.json"), `${JSON.stringify({
    version: 1,
    servers: [
      {
        id: "local-tools",
        title: "Local workspace tools",
        description: "Search an explicitly configured local index.",
        command: process.execPath,
        args: ["server.js"],
        cwd: ".",
        env: { TOKEN: "PRIVATE_MCP_TOKEN" },
        readOnlyTools: ["search"],
        workspaceAccess: "read",
      },
      {
        id: "remote-tools",
        title: "Research library",
        description: "Look up sources in the connected research library.",
        transport: "streamable-http",
        url: "https://mcp.example.com/tools",
        oauth: { scopes: ["mcp:read"] },
        readOnlyTools: ["lookup", "fetch"],
      },
    ],
  })}\n`, "utf8");
  await writeFile(join(workspace, "unrelated-large-file.txt"), "x".repeat(1_000_000), "utf8");

  const catalog = await inspectWorkspaceExtensionCatalog(workspace, "darwin");
  assert.equal(catalog.skillsConfigured, true);
  assert.equal(catalog.mcpConfigured, true);
  assert.deepEqual(catalog.skills, [{
    id: "evidence-review",
    title: "Evidence Review",
    description: "Check claims against explicit sources.",
    appliesTo: "research",
    trust: "workspace-local",
    permissions: [],
  }]);
  assert.deepEqual(catalog.mcpServers.map((server) => ({
    id: server.id,
    title: server.title,
    description: server.description,
    transport: server.transport,
    authentication: server.authentication,
    networkAccess: server.networkAccess,
    supported: server.supportedOnCurrentPlatform,
  })), [
    {
      id: "local-tools",
      title: "Local workspace tools",
      description: "Search an explicitly configured local index.",
      transport: "stdio",
      authentication: "environment",
      networkAccess: false,
      supported: true,
    },
    {
      id: "remote-tools",
      title: "Research library",
      description: "Look up sources in the connected research library.",
      transport: "streamable-http",
      authentication: "oauth",
      networkAccess: true,
      supported: true,
    },
  ]);
  const serialized = JSON.stringify(catalog);
  assert.doesNotMatch(serialized, /PRIVATE_INSTRUCTION_SENTINEL|PRIVATE_MCP_TOKEN/);
  assert.equal(serialized.includes(workspace), false);
  assert.deepEqual(catalog.issues, []);
});

test("reports invalid extension entries without hiding valid Skills and marks Windows stdio unavailable", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-extension-catalog-invalid-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  const skillBase = join(workspace, ".localbuddy", "skills");
  await mkdir(join(skillBase, "valid-skill"), { recursive: true });
  await mkdir(join(skillBase, "Bad Skill"), { recursive: true });
  await writeFile(join(skillBase, "valid-skill", "SKILL.md"), [
    "---",
    "version: 1",
    "id: valid-skill",
    "title: Valid Skill",
    "description: A valid catalog entry.",
    "appliesTo: both",
    "---",
    "Use the normal LocalBuddy safety policy.",
  ].join("\n"), "utf8");
  await writeFile(join(skillBase, "Bad Skill", "SKILL.md"), "invalid", "utf8");
  await writeFile(join(workspace, ".localbuddy", "mcp.json"), `${JSON.stringify({
    version: 1,
    servers: [{ id: "local-tools", command: process.execPath }],
  })}\n`, "utf8");

  const catalog = await inspectWorkspaceExtensionCatalog(workspace, "win32");
  assert.deepEqual(catalog.skills.map((skill) => skill.id), ["valid-skill"]);
  assert.ok(catalog.issues.some((issue) => issue.kind === "skill" && /kebab-case/.test(issue.message)));
  assert.equal(catalog.mcpServers[0]?.supportedOnCurrentPlatform, false);
  assert.equal(catalog.mcpServers[0]?.title, "Local Tools");
  assert.equal(catalog.mcpServers[0]?.description, "在任务中使用这个连接提供的资料和工具。");
});
