import { lstat, readdir, realpath } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { loadMcpConfig } from "./extension-config.js";
import type {
  WorkspaceExtensionCatalog,
  WorkspaceExtensionCatalogIssue,
  WorkspaceMcpCatalogEntry,
  WorkspaceSkillCatalogEntry,
} from "./extension-catalog-contract.js";
import { SkillStore } from "./skill-store.js";

const MAX_DISCOVERED_SKILLS = 64;
const MAX_ISSUE_CHARACTERS = 500;

export async function inspectWorkspaceExtensionCatalog(
  workspaceInput: string,
  platform: NodeJS.Platform = process.platform,
): Promise<WorkspaceExtensionCatalog> {
  const workspace = await realpath(workspaceInput);
  const skillRoot = resolve(workspace, ".localbuddy", "skills");
  const mcpPath = resolve(workspace, ".localbuddy", "mcp.json");
  const issues: WorkspaceExtensionCatalogIssue[] = [];
  const skills: WorkspaceSkillCatalogEntry[] = [];
  let skillsConfigured = false;
  let mcpConfigured = false;

  try {
    const rootStat = await lstat(skillRoot);
    skillsConfigured = true;
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new Error("Skill 目录必须是工作区内的真实目录，不能使用符号链接");
    }
    const entries = (await readdir(skillRoot, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name));
    if (entries.length > MAX_DISCOVERED_SKILLS) {
      issues.push({
        kind: "skill",
        message: `Skill 目录超过 ${MAX_DISCOVERED_SKILLS} 项，只检查前 ${MAX_DISCOVERED_SKILLS} 项`,
      });
    }
    const store = await SkillStore.create(workspace);
    for (const entry of entries.slice(0, MAX_DISCOVERED_SKILLS)) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      try {
        const skill = await store.load(entry.name);
        skills.push({
          id: skill.id,
          title: skill.title,
          description: skill.description,
          appliesTo: skill.appliesTo,
          trust: skill.trust,
          ...(skill.release === undefined ? {} : { release: skill.release }),
          permissions: skill.permissions,
        });
      } catch (error) {
        issues.push({ kind: "skill", id: safeId(entry.name), message: safeIssue(error, workspace) });
      }
    }
  } catch (error) {
    if (!isMissing(error)) {
      issues.push({ kind: "skill", message: safeIssue(error, workspace) });
    }
  }

  try {
    mcpConfigured = (await lstat(mcpPath)).isFile();
  } catch (error) {
    if (!isMissing(error)) {
      issues.push({ kind: "mcp", message: safeIssue(error, workspace) });
    }
  }

  const mcpServers: WorkspaceMcpCatalogEntry[] = [];
  try {
    const config = await loadMcpConfig(workspace);
    for (const server of config.servers) {
      if (server.transport === "streamable-http") {
        mcpServers.push({
          id: server.id,
          title: server.title ?? humanizeId(server.id),
          description: server.description ?? "在任务中使用这个连接提供的资料和工具。",
          transport: server.transport,
          connectionLabel: `远程服务 · ${new URL(server.url).origin}`,
          authentication: server.oauth !== undefined
            ? "oauth"
            : server.bearerTokenEnv !== undefined
            ? "environment"
            : "none",
          readOnlyToolCount: server.readOnlyTools.length,
          networkAccess: true,
          supportedOnCurrentPlatform: true,
        });
      } else {
        mcpServers.push({
          id: server.id,
          title: server.title ?? humanizeId(server.id),
          description: server.description ?? "在任务中使用这个连接提供的资料和工具。",
          transport: "stdio",
          connectionLabel: `本地程序 · ${basename(server.command)}`,
          authentication: Object.keys(server.env).length > 0 ? "environment" : "none",
          readOnlyToolCount: server.readOnlyTools.length,
          workspaceAccess: server.workspaceAccess,
          networkAccess: server.networkAccess,
          supportedOnCurrentPlatform: platform !== "win32",
        });
      }
    }
  } catch (error) {
    issues.push({ kind: "mcp", message: safeIssue(error, workspace) });
  }

  return {
    skillsConfigured,
    mcpConfigured,
    skills,
    mcpServers,
    issues,
  };
}

function safeIssue(error: unknown, workspace: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replaceAll(workspace, ".")
    .replaceAll("\r", " ")
    .replaceAll("\n", " ")
    .slice(0, MAX_ISSUE_CHARACTERS);
}

function humanizeId(id: string): string {
  return id
    .split("-")
    .filter(Boolean)
    .map((part) => part.length === 0 ? part : `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function safeId(value: string): string | undefined {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ? value : undefined;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
