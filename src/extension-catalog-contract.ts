export type WorkspaceSkillMode = "research" | "code" | "both";

export type WorkspaceSkillPermission =
  | "workspace.read"
  | "deterministic.compute"
  | "artifact.write"
  | "worktree.write"
  | "process.execute"
  | "external.read"
  | "external.effect";

export interface WorkspaceSkillCatalogEntry {
  id: string;
  title: string;
  description: string;
  appliesTo: WorkspaceSkillMode;
  trust: "workspace-local" | "signed";
  release?: string;
  permissions: readonly WorkspaceSkillPermission[];
}

export interface WorkspaceMcpCatalogEntry {
  id: string;
  title: string;
  description: string;
  transport: "stdio" | "streamable-http";
  connectionLabel: string;
  authentication: "none" | "environment" | "oauth";
  readOnlyToolCount: number;
  workspaceAccess?: "read" | "write";
  networkAccess: boolean;
  supportedOnCurrentPlatform: boolean;
}

export interface WorkspaceExtensionCatalogIssue {
  kind: "skill" | "mcp";
  id?: string;
  message: string;
}

export interface WorkspaceExtensionCatalog {
  skillsConfigured: boolean;
  mcpConfigured: boolean;
  skills: readonly WorkspaceSkillCatalogEntry[];
  mcpServers: readonly WorkspaceMcpCatalogEntry[];
  issues: readonly WorkspaceExtensionCatalogIssue[];
}
