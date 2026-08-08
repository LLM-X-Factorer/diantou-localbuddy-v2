import { readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import type { RunExtensionSelection } from "./extension-contract.js";
export type { BrowserExtensionSelection, RunExtensionSelection } from "./extension-contract.js";

interface McpServerConfigBase {
  id: string;
  readOnlyTools: readonly string[];
}

export interface McpStdioServerConfig extends McpServerConfigBase {
  transport?: "stdio";
  command: string;
  args: readonly string[];
  cwd: string;
  env: Readonly<Record<string, string>>;
  workspaceAccess: "read" | "write";
  networkAccess: boolean;
}

export interface McpStreamableHttpServerConfig extends McpServerConfigBase {
  transport: "streamable-http";
  url: string;
  bearerTokenEnv?: string;
  oauth?: McpOAuthConfig;
}

export interface McpOAuthConfig {
  accountId: string;
  scopes: readonly string[];
  clientId?: string;
  clientSecretEnv?: string;
}

export type McpServerConfig = McpStdioServerConfig | McpStreamableHttpServerConfig;

export interface McpConfigFile {
  version: 1;
  servers: readonly McpServerConfig[];
}

export function normalizeRunExtensions(
  value: RunExtensionSelection | undefined,
): RunExtensionSelection {
  if (value !== undefined && (typeof value !== "object" || Array.isArray(value))) {
    throw new Error("extensions selection must be an object");
  }
  const skillIds = normalizeIds(value?.skillIds ?? [], "skillIds");
  const mcpServerIds = normalizeIds(value?.mcpServerIds ?? [], "mcpServerIds");
  const browser = value?.browser === undefined
    ? undefined
    : {
        allowedOrigins: normalizeOrigins(value.browser.allowedOrigins),
        allowActions: value.browser.allowActions === true,
      };
  if (browser !== undefined && browser.allowedOrigins.length === 0) {
    throw new Error("browser.allowedOrigins must contain at least one origin");
  }
  return {
    skillIds,
    mcpServerIds,
    allowMcpWrites: value?.allowMcpWrites === true,
    browser,
  };
}

export async function loadMcpConfig(workspaceInput: string): Promise<McpConfigFile> {
  const workspace = await realpath(workspaceInput);
  const configPath = resolve(workspace, ".localbuddy", "mcp.json");
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(configPath, "utf8")) as unknown;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { version: 1, servers: [] };
    }
    throw error;
  }
  const record = expectObject(raw, "MCP config");
  if (record.version !== 1 || !Array.isArray(record.servers) || record.servers.length > 16) {
    throw new Error("MCP config must use version 1 with at most 16 servers");
  }
  const ids = new Set<string>();
  const servers = await Promise.all(record.servers.map(async (value, index) => {
    const server = expectObject(value, `servers[${index}]`);
    const id = normalizeId(server.id, `servers[${index}].id`);
    if (ids.has(id)) throw new Error(`Duplicate MCP server id: ${id}`);
    ids.add(id);
    const readOnlyTools = server.readOnlyTools === undefined
      ? []
      : expectStringArray(server.readOnlyTools, `servers[${index}].readOnlyTools`, 128, 200);
    if (server.transport === "streamable-http") {
      const url = normalizeHttpMcpUrl(server.url, `servers[${index}].url`);
      const bearerTokenEnv = server.bearerTokenEnv === undefined
        ? undefined
        : expectEnvironmentVariableName(server.bearerTokenEnv, `servers[${index}].bearerTokenEnv`);
      const oauth = server.oauth === undefined
        ? undefined
        : normalizeMcpOAuth(server.oauth, `servers[${index}].oauth`);
      if (bearerTokenEnv !== undefined && oauth !== undefined) {
        throw new Error(`servers[${index}] cannot combine bearerTokenEnv and oauth`);
      }
      return {
        id,
        transport: "streamable-http" as const,
        url,
        bearerTokenEnv,
        oauth,
        readOnlyTools: [...new Set(readOnlyTools)],
      };
    }
    if (server.transport !== undefined && server.transport !== "stdio") {
      throw new Error(`servers[${index}].transport must be stdio or streamable-http`);
    }
    const command = expectSingleLine(server.command, `servers[${index}].command`, 2_000);
    const args = server.args === undefined
      ? []
      : expectStringArray(server.args, `servers[${index}].args`, 64, 4_000);
    const env = parseEnvironmentMap(server.env, `servers[${index}].env`);
    let cwd = workspace;
    if (server.cwd !== undefined) {
      const configured = expectSingleLine(server.cwd, `servers[${index}].cwd`, 2_000);
      const candidate = isAbsolute(configured) ? configured : resolve(workspace, configured);
      const canonical = await realpath(candidate);
      const relative = canonical === workspace ? "" : canonical.slice(workspace.length + 1);
      if (canonical !== workspace && (relative.startsWith("..") || !canonical.startsWith(`${workspace}/`))) {
        throw new Error(`MCP server cwd must stay inside workspace: ${id}`);
      }
      cwd = canonical;
    }
    const workspaceAccess = server.workspaceAccess === undefined
      ? "read"
      : expectEnum(server.workspaceAccess, `servers[${index}].workspaceAccess`, ["read", "write"]);
    const networkAccess = server.networkAccess === undefined
      ? false
      : expectBoolean(server.networkAccess, `servers[${index}].networkAccess`);
    return {
      id,
      transport: "stdio" as const,
      command,
      args,
      cwd,
      env,
      workspaceAccess,
      networkAccess,
      readOnlyTools: [...new Set(readOnlyTools)],
    };
  }));
  return { version: 1, servers };
}

function normalizeMcpOAuth(value: unknown, name: string): McpOAuthConfig {
  const oauth = expectObject(value, name);
  const accountId = oauth.accountId === undefined
    ? "default"
    : normalizeId(oauth.accountId, `${name}.accountId`);
  const scopes = oauth.scopes === undefined
    ? []
    : expectStringArray(oauth.scopes, `${name}.scopes`, 32, 200).map((scope, index) => {
        if (!/^[\x21\x23-\x5B\x5D-\x7E]+$/.test(scope)) {
          throw new Error(`${name}.scopes[${index}] is not a valid OAuth scope token`);
        }
        return scope;
      });
  const clientId = oauth.clientId === undefined
    ? undefined
    : expectSingleLine(oauth.clientId, `${name}.clientId`, 2_000);
  const clientSecretEnv = oauth.clientSecretEnv === undefined
    ? undefined
    : expectEnvironmentVariableName(oauth.clientSecretEnv, `${name}.clientSecretEnv`);
  if (clientSecretEnv !== undefined && clientId === undefined) {
    throw new Error(`${name}.clientSecretEnv requires clientId`);
  }
  return {
    accountId,
    scopes: [...new Set(scopes)],
    ...(clientId === undefined ? {} : { clientId }),
    ...(clientSecretEnv === undefined ? {} : { clientSecretEnv }),
  };
}

function normalizeHttpMcpUrl(value: unknown, name: string): string {
  const raw = expectSingleLine(value, name, 2_000);
  const url = new URL(raw);
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("Streamable HTTP MCP URLs must use HTTPS or loopback HTTP");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Streamable HTTP MCP URLs cannot contain credentials, query, or fragment");
  }
  return url.toString();
}

function expectEnvironmentVariableName(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^[A-Z_][A-Z0-9_]*$/.test(value)) {
    throw new Error(`${name} must name an environment variable`);
  }
  return value;
}

function expectBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${name} must be a boolean`);
  return value;
}

function expectEnum<const T extends string>(
  value: unknown,
  name: string,
  allowed: readonly T[],
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${name} must be one of ${allowed.join(", ")}`);
  }
  return value as T;
}

export function resolveSelectedMcpServers(
  config: McpConfigFile,
  selectedIds: readonly string[],
): readonly McpServerConfig[] {
  const byId = new Map(config.servers.map((server) => [server.id, server]));
  return selectedIds.map((id) => {
    const server = byId.get(id);
    if (server === undefined) throw new Error(`Selected MCP server is not configured: ${id}`);
    return server;
  });
}

function normalizeOrigins(values: readonly string[]): string[] {
  if (!Array.isArray(values) || values.length > 32) {
    throw new Error("browser.allowedOrigins must contain at most 32 origins");
  }
  return [...new Set(values.map((value, index) => {
    if (typeof value !== "string") throw new Error(`browser.allowedOrigins[${index}] must be a string`);
    const url = new URL(value.trim());
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
      throw new Error("browser origins must use HTTPS or loopback HTTP");
    }
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
      throw new Error(`browser origin must not include credentials, path, query, or fragment: ${value}`);
    }
    return url.origin;
  }))];
}

function normalizeIds(values: readonly string[], name: string): string[] {
  if (!Array.isArray(values) || values.length > 32) throw new Error(`${name} must contain at most 32 ids`);
  return [...new Set(values.map((value, index) => normalizeId(value, `${name}[${index}]`)))];
}

function normalizeId(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new Error(`${name} must use kebab-case`);
  }
  return value;
}

function parseEnvironmentMap(value: unknown, name: string): Record<string, string> {
  if (value === undefined) return {};
  const record = expectObject(value, name);
  const entries = Object.entries(record);
  if (entries.length > 32) throw new Error(`${name} may contain at most 32 variables`);
  return Object.fromEntries(entries.map(([target, source]) => {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(target)) throw new Error(`${name} has an invalid target variable`);
    if (typeof source !== "string" || !/^[A-Z_][A-Z0-9_]*$/.test(source)) {
      throw new Error(`${name}.${target} must name a source environment variable`);
    }
    return [target, source];
  }));
}

function expectObject(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function expectSingleLine(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength || /[\r\n\0]/.test(normalized)) {
    throw new Error(`${name} must be a bounded single-line string`);
  }
  return normalized;
}

function expectStringArray(
  value: unknown,
  name: string,
  maxItems: number,
  maxLength: number,
): string[] {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${name} is invalid`);
  return value.map((item, index) => expectSingleLine(item, `${name}[${index}]`, maxLength));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
