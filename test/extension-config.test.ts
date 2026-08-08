import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  loadMcpConfig,
  normalizeRunExtensions,
  resolveSelectedMcpServers,
} from "../src/extension-config.js";
import { canonicalSkillManifest, compileSkillInstructions, SkillStore } from "../src/skill-store.js";

test("loads selected local skills and compiles mode-scoped instructions", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-skills-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  const skillRoot = join(workspace, ".localbuddy", "skills", "browser-evidence");
  await mkdir(skillRoot, { recursive: true });
  await writeFile(join(skillRoot, "SKILL.md"), [
    "---",
    "version: 1",
    "id: browser-evidence",
    "title: Browser Evidence",
    "description: Collect bounded evidence from an allowed origin.",
    "appliesTo: research",
    "allowedTools:",
    "  - browser_navigate",
    "---",
    "Always quote the exact page title and URL from the browser result.",
    "",
  ].join("\n"), "utf8");

  const store = await SkillStore.create(workspace);
  const [skill] = await store.loadSelected(["browser-evidence"]);
  assert.equal(skill?.id, "browser-evidence");
  assert.equal(skill?.sha256.length, 64);
  assert.match(compileSkillInstructions([skill!], "research"), /exact page title/);
  assert.equal(compileSkillInstructions([skill!], "code"), "");
});

test("rejects symlinked Skill files", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-skill-link-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  const directory = join(workspace, ".localbuddy", "skills", "linked-skill");
  await mkdir(directory, { recursive: true });
  const outside = join(workspace, "outside.md");
  await writeFile(outside, "---\nversion: 1\nid: linked-skill\ntitle: x\ndescription: x\n---\nx\n", "utf8");
  await symlink(outside, join(directory, "SKILL.md"));
  await assert.rejects((await SkillStore.create(workspace)).load("linked-skill"), /real file/);
});

test("verifies signed, locked, trusted, and non-revoked Skill packages", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-signed-skill-"));
  const trustRoot = join(workspace, "trust");
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  const directory = join(workspace, ".localbuddy", "skills", "signed-review");
  await mkdir(directory, { recursive: true });
  await mkdir(trustRoot, { recursive: true });
  const content = "---\nversion: 1\nid: signed-review\ntitle: Signed Review\ndescription: Verified package\nappliesTo: both\n---\nUse only declared tools.\n";
  await writeFile(join(directory, "SKILL.md"), content, "utf8");
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const unsigned = {
    version: 1 as const,
    id: "signed-review",
    release: "1.2.3",
    publisherKeyId: "fixture-publisher",
    skillSha256: createHash("sha256").update(content).digest("hex"),
    permissions: ["workspace.read"] as const,
  };
  const manifest = {
    ...unsigned,
    signature: sign(null, Buffer.from(canonicalSkillManifest(unsigned)), privateKey).toString("base64"),
  };
  const manifestRaw = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(join(directory, "manifest.json"), manifestRaw, "utf8");
  await writeFile(join(trustRoot, "skill-publishers.json"), `${JSON.stringify({
    version: 1,
    publishers: [{
      keyId: "fixture-publisher",
      status: "active",
      publicKeyBase64: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    }],
  })}\n`, "utf8");
  await writeFile(join(workspace, ".localbuddy", "skill-lock.json"), `${JSON.stringify({
    version: 1,
    skills: {
      "signed-review": {
        release: "1.2.3",
        manifestSha256: createHash("sha256").update(manifestRaw).digest("hex"),
      },
    },
  })}\n`, "utf8");
  const skill = await (await SkillStore.create(workspace, { trustRoot })).load("signed-review");
  assert.equal(skill.trust, "signed");
  assert.equal(skill.release, "1.2.3");
  assert.deepEqual(skill.permissions, ["workspace.read"]);

  await writeFile(join(trustRoot, "skill-revocations.json"), `${JSON.stringify({
    version: 1,
    revoked: [{ id: "signed-review", release: "1.2.3" }],
  })}\n`, "utf8");
  await assert.rejects(
    (await SkillStore.create(workspace, { trustRoot })).load("signed-review"),
    /revoked/,
  );
});

test("validates MCP config selection and browser origin policy", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-mcp-config-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  await mkdir(join(workspace, ".localbuddy"), { recursive: true });
  await writeFile(join(workspace, ".localbuddy", "mcp.json"), `${JSON.stringify({
    version: 1,
    servers: [{
      id: "local-tools",
      command: process.execPath,
      args: ["server.js"],
      cwd: ".",
      env: { TOKEN: "LOCALBUDDY_TEST_TOKEN" },
      readOnlyTools: ["echo"],
    }],
  })}\n`, "utf8");
  const config = await loadMcpConfig(workspace);
  const [selected] = resolveSelectedMcpServers(config, ["local-tools"]);
  assert.notEqual(selected?.transport, "streamable-http");
  if (selected?.transport === "streamable-http") throw new Error("expected stdio config");
  assert.equal(selected?.cwd, await realpath(workspace));
  assert.deepEqual(selected?.readOnlyTools, ["echo"]);
  assert.throws(() => resolveSelectedMcpServers(config, ["missing"]), /not configured/);
  assert.deepEqual(normalizeRunExtensions({
    browser: { allowedOrigins: ["https://example.com", "https://example.com"] },
  }).browser?.allowedOrigins, ["https://example.com"]);
  assert.throws(() => normalizeRunExtensions({
    browser: { allowedOrigins: ["http://example.com"] },
  }), /HTTPS or loopback/);
});

test("accepts HTTPS and loopback Streamable HTTP MCP endpoints without literal credentials", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-http-mcp-config-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  await mkdir(join(workspace, ".localbuddy"), { recursive: true });
  await writeFile(join(workspace, ".localbuddy", "mcp.json"), `${JSON.stringify({
    version: 1,
    servers: [{
      id: "remote-tools",
      transport: "streamable-http",
      url: "http://127.0.0.1:43123/mcp",
      bearerTokenEnv: "LOCALBUDDY_MCP_TOKEN",
      readOnlyTools: ["echo"],
    }],
  })}\n`, "utf8");

  const [server] = (await loadMcpConfig(workspace)).servers;
  assert.equal(server?.transport, "streamable-http");
  if (server?.transport !== "streamable-http") throw new Error("expected HTTP config");
  assert.equal(server.url, "http://127.0.0.1:43123/mcp");
  assert.equal(server.bearerTokenEnv, "LOCALBUDDY_MCP_TOKEN");

  await writeFile(join(workspace, ".localbuddy", "mcp.json"), `${JSON.stringify({
    version: 1,
    servers: [{
      id: "unsafe",
      transport: "streamable-http",
      url: "http://example.com/mcp?token=literal",
    }],
  })}\n`, "utf8");
  await assert.rejects(loadMcpConfig(workspace), /HTTPS or loopback HTTP/);
});

test("normalizes OAuth MCP accounts and rejects mixed bearer authentication", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-oauth-config-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  await mkdir(join(workspace, ".localbuddy"), { recursive: true });
  const configPath = join(workspace, ".localbuddy", "mcp.json");
  await writeFile(configPath, `${JSON.stringify({
    version: 1,
    servers: [{
      id: "oauth-tools",
      transport: "streamable-http",
      url: "http://127.0.0.1:43123/mcp",
      oauth: { scopes: ["mcp:read", "mcp:read"] },
      readOnlyTools: [],
    }],
  })}\n`, "utf8");
  const [server] = (await loadMcpConfig(workspace)).servers;
  assert.equal(server?.transport, "streamable-http");
  if (server?.transport !== "streamable-http") throw new Error("expected HTTP config");
  assert.deepEqual(server.oauth, { accountId: "default", scopes: ["mcp:read"] });

  await writeFile(configPath, `${JSON.stringify({
    version: 1,
    servers: [{
      id: "mixed",
      transport: "streamable-http",
      url: "http://127.0.0.1:43123/mcp",
      bearerTokenEnv: "TOKEN",
      oauth: {},
    }],
  })}\n`, "utf8");
  await assert.rejects(loadMcpConfig(workspace), /cannot combine/);
});
