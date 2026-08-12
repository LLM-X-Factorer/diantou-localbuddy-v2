import { createHash, randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, parse as parsePath, resolve } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolResultSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

import type { McpServerConfig } from "./extension-config.js";
import { prepareContainerLaunch, prepareSeatbeltLaunch } from "./execution-host.js";
import {
  LocalMcpOAuthProvider,
  type OAuthRedirectHandler,
} from "./mcp-oauth.js";
import type { SecureJsonStore } from "./secure-json-store.js";
import type { ToolDefinition, ToolRisk } from "./tool-runtime.js";

const MAX_MCP_TOOLS = 128;
const MAX_MCP_TOOL_SCHEMA_BYTES = 64_000;
const MAX_MCP_TOTAL_SCHEMA_BYTES = 500_000;
const MAX_MCP_ARGUMENT_BYTES = 100_000;
const MAX_MCP_TEXT = 80_000;
const MAX_MCP_STRUCTURED_CONTENT_BYTES = 200_000;
const MAX_MCP_STDERR_BYTES = 4_096;
const MAX_MCP_DIAGNOSTIC_CHARACTERS = 1_200;

interface PreparedTransport {
  transport: Transport;
  oauth?: LocalMcpOAuthProvider;
  childDiagnostics?: () => string | undefined;
}

interface ConnectedServer {
  config: McpServerConfig;
  client: Client;
  transport: Transport;
  oauth?: LocalMcpOAuthProvider;
}

export interface McpConnectOptions {
  oauthRedirectHandler?: OAuthRedirectHandler;
  oauthStore?: SecureJsonStore;
  signal?: AbortSignal;
}

export interface McpBridgeResult {
  tools: readonly ToolDefinition[];
  toolNames: readonly string[];
  serverIds: readonly string[];
  close(): Promise<void>;
}

export async function connectMcpServers(
  configs: readonly McpServerConfig[],
  environment: NodeJS.ProcessEnv = process.env,
  options: McpConnectOptions = {},
): Promise<McpBridgeResult> {
  const connected: ConnectedServer[] = [];
  const definitions: ToolDefinition[] = [];
  const names = new Set<string>();
  let schemaBytes = 0;
  try {
    for (const config of configs) {
      const prepared = await createTransport(config, environment, options);
      let transport = prepared.transport;
      let client = createClient();
      try {
        await client.connect(transport, { timeout: 10_000 });
      } catch (error) {
        if (!(error instanceof UnauthorizedError)
          || prepared.oauth === undefined
          || !(transport instanceof StreamableHTTPClientTransport)
          || config.transport !== "streamable-http") {
          await transport.close().catch(() => undefined);
          await prepared.oauth?.close().catch(() => undefined);
          throw mcpConnectionFailure(config.id, error, prepared.childDiagnostics?.());
        }
        try {
          const code = await prepared.oauth.waitForAuthorizationCode(options.signal);
          await transport.finishAuth(code);
          await transport.close().catch(() => undefined);
          transport = createHttpTransport(config, prepared.oauth, environment);
          client = createClient();
          await client.connect(transport, { timeout: 10_000 });
        } catch (authError) {
          await transport.close().catch(() => undefined);
          await prepared.oauth.close().catch(() => undefined);
          throw mcpConnectionFailure(config.id, authError, prepared.childDiagnostics?.());
        }
      }
      connected.push({ config, client, transport, oauth: prepared.oauth });
      let cursor: string | undefined;
      do {
        const response = await client.listTools(
          cursor === undefined ? undefined : { cursor },
          { timeout: 10_000 },
        );
        for (const tool of response.tools) {
          if (definitions.length >= MAX_MCP_TOOLS) {
            throw new Error(`MCP tool count exceeds ${MAX_MCP_TOOLS}`);
          }
          const serializedSchemaBytes = Buffer.byteLength(JSON.stringify(tool.inputSchema));
          if (serializedSchemaBytes > MAX_MCP_TOOL_SCHEMA_BYTES) {
            throw new Error(`MCP tool schema exceeds ${MAX_MCP_TOOL_SCHEMA_BYTES} bytes: ${config.id}/${tool.name}`);
          }
          schemaBytes += serializedSchemaBytes;
          if (schemaBytes > MAX_MCP_TOTAL_SCHEMA_BYTES) {
            throw new Error(`MCP aggregate tool schemas exceed ${MAX_MCP_TOTAL_SCHEMA_BYTES} bytes`);
          }
          const exposedName = exposeToolName(config.id, tool.name);
          if (names.has(exposedName)) throw new Error(`MCP tool name collision: ${exposedName}`);
          names.add(exposedName);
          definitions.push(createToolDefinition({
            server: config,
            client,
            exposedName,
            remoteName: tool.name,
            description: tool.description?.slice(0, 4_000),
            inputSchema: tool.inputSchema,
          }));
        }
        cursor = response.nextCursor;
      } while (cursor !== undefined);
    }
    return {
      tools: definitions,
      toolNames: definitions.map((tool) => tool.name),
      serverIds: configs.map((config) => config.id),
      async close() {
        await closeConnected(connected);
      },
    };
  } catch (error) {
    await closeConnected(connected);
    throw error;
  }
}

async function createTransport(
  config: McpServerConfig,
  environment: NodeJS.ProcessEnv,
  options: McpConnectOptions,
): Promise<PreparedTransport> {
  if (config.transport === "streamable-http") {
    const oauth = config.oauth === undefined
      ? undefined
      : await LocalMcpOAuthProvider.create({
          server: config,
          environment,
          store: options.oauthStore,
          redirectHandler: options.oauthRedirectHandler ?? ((url) => {
            process.stderr.write(`Open this MCP authorization URL in your browser:\n${url.toString()}\n`);
          }),
        });
    return { transport: createHttpTransport(config, oauth, environment), oauth };
  }
  if (process.platform === "win32") {
    throw new Error(
      `MCP stdio server ${config.id} is disabled because no supported Windows isolation host is configured`,
    );
  }
  const cwd = config.cwd;
  const environmentValues = buildServerEnvironment(config, environment);
  const explicitRoots = await explicitArgumentRoots(config.args);
  const commonLaunch = {
    command: config.command,
    args: config.args,
    cwd,
    readRoots: [cwd, ...explicitRoots],
    writableRoots: config.workspaceAccess === "write" ? [cwd] : [],
    temporaryRoot: resolve(cwd, ".localbuddy", "mcp-runtime", config.id),
    network: config.networkAccess ? "allow" as const : "deny" as const,
    environment: environmentValues,
  };
  const launch = process.platform === "darwin"
    ? await prepareSeatbeltLaunch(commonLaunch)
    : await prepareContainerLaunch({
        ...commonLaunch,
        image: requireContainerImage(environment, config.id),
        containerExecutable: environment.LOCALBUDDY_CONTAINER_EXECUTABLE,
        containerName: `localbuddy-mcp-${randomUUID()}`,
      });
  const transport = new StdioClientTransport({
    command: launch.command,
    args: launch.args,
    cwd: launch.cwd,
    env: launch.environment as Record<string, string>,
    stderr: "pipe",
    maxBufferSize: 2 * 1024 * 1024,
  });
  let childStderr = Buffer.alloc(0);
  transport.stderr?.on("data", (chunk: Buffer | string) => {
    const next = Buffer.concat([
      childStderr,
      typeof chunk === "string" ? Buffer.from(chunk) : chunk,
    ]);
    childStderr = next.subarray(Math.max(0, next.length - MAX_MCP_STDERR_BYTES));
  });
  return {
    transport,
    childDiagnostics: () => sanitizeChildDiagnostics(childStderr),
  };
}

function mcpConnectionFailure(serverId: string, error: unknown, childDiagnostics?: string): Error {
  const reason = sanitizeDiagnosticText(error instanceof Error ? error.message : String(error));
  const detail = childDiagnostics === undefined ? "" : ` Child stderr: ${childDiagnostics}`;
  return new Error(`MCP server ${serverId} failed to connect: ${reason}.${detail}`, { cause: error });
}

function sanitizeChildDiagnostics(stderr: Buffer): string | undefined {
  if (stderr.length === 0) return undefined;
  const digest = createHash("sha256").update(stderr).digest("hex").slice(0, 12);
  const text = sanitizeDiagnosticText(stderr.toString("utf8"));
  return `${text || "child process exited without readable text"} [stderr sha256:${digest}]`;
}

function sanitizeDiagnosticText(value: string): string {
  return value
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/\b((?:api[_-]?key|token|secret|password|authorization))\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/\bsk-[a-zA-Z0-9_-]{8,}\b/g, "[redacted-key]")
    .replace(/\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]+@/g, (match) => {
      const scheme = match.slice(0, match.indexOf(":"));
      return `${scheme}://[redacted]@`;
    })
    .replace(/(?:[A-Za-z]:\\|\/)(?:[^\s:'"<>|]+[\\/])+[^\s:'"<>|]*/g, "[path]")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, MAX_MCP_DIAGNOSTIC_CHARACTERS);
}

function requireContainerImage(environment: NodeJS.ProcessEnv, serverId: string): string {
  const image = environment.LOCALBUDDY_EXECUTION_IMAGE;
  if (image === undefined || image.length === 0) {
    throw new Error(`MCP stdio server ${serverId} requires LOCALBUDDY_EXECUTION_IMAGE on Linux`);
  }
  return image;
}

function createHttpTransport(
  config: Extract<McpServerConfig, { transport: "streamable-http" }>,
  oauth: LocalMcpOAuthProvider | undefined,
  environment: NodeJS.ProcessEnv,
): StreamableHTTPClientTransport {
  const token = config.bearerTokenEnv === undefined
    ? undefined
    : environment[config.bearerTokenEnv];
  if (config.bearerTokenEnv !== undefined && (token === undefined || token.length === 0)) {
    throw new Error(`MCP server ${config.id} requires environment variable ${config.bearerTokenEnv}`);
  }
  return new StreamableHTTPClientTransport(new URL(config.url), {
    authProvider: oauth,
    requestInit: token === undefined
      ? undefined
      : { headers: { authorization: `Bearer ${token}` } },
    reconnectionOptions: {
      initialReconnectionDelay: 500,
      maxReconnectionDelay: 5_000,
      reconnectionDelayGrowFactor: 2,
      maxRetries: 2,
    },
  });
}

function createClient(): Client {
  return new Client(
    { name: "localbuddy-v2", version: "0.11.0" },
    { capabilities: {} },
  );
}

async function explicitArgumentRoots(args: readonly string[]): Promise<string[]> {
  const roots = new Set<string>();
  for (const value of args) {
    if (!isAbsolute(value)) continue;
    try {
      roots.add(await realpath(value));
      const packageRoot = await nearestPackageRoot(value);
      if (packageRoot !== undefined) roots.add(packageRoot);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") continue;
      throw error;
    }
  }
  return [...roots];
}

async function nearestPackageRoot(input: string): Promise<string | undefined> {
  let current = dirname(await realpath(input));
  const filesystemRoot = parsePath(current).root;
  while (true) {
    try {
      await realpath(resolve(current, "package.json"));
      return current;
    } catch (error) {
      if (!(isNodeError(error) && error.code === "ENOENT")) throw error;
    }
    if (current === filesystemRoot) return undefined;
    current = dirname(current);
  }
}

function createToolDefinition(input: {
  server: McpServerConfig;
  client: Client;
  exposedName: string;
  remoteName: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}): ToolDefinition<Record<string, unknown>> {
  const risk: ToolRisk = input.server.readOnlyTools.includes(input.remoteName) ? "read" : "execute";
  return {
    name: input.exposedName,
    description: [
      `MCP server ${input.server.id}, remote tool ${input.remoteName}.`,
      input.description ?? "No remote description was provided.",
      risk === "read"
        ? "Local configuration declares this tool read-only."
        : "This tool is treated as externally effectful unless the Run explicitly allows MCP writes.",
    ].join(" "),
    parameters: input.inputSchema,
    risk,
    permission: risk === "read" ? "external.read" : "external.effect",
    parse(value) {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("MCP tool arguments must be an object");
      }
      if (Buffer.byteLength(JSON.stringify(value)) > MAX_MCP_ARGUMENT_BYTES) {
        throw new Error(`MCP tool arguments exceed ${MAX_MCP_ARGUMENT_BYTES} bytes`);
      }
      return value as Record<string, unknown>;
    },
    async execute(value, context) {
      const result = await input.client.callTool(
        { name: input.remoteName, arguments: value },
        CallToolResultSchema,
        { signal: context.signal, timeout: 60_000, maxTotalTimeout: 120_000 },
      );
      if (!("content" in result) || !Array.isArray(result.content)) {
        throw new Error("MCP task-augmented tool results are not supported by this runtime");
      }
      const standardResult = result as CallToolResult;
      const output = normalizeMcpOutput(standardResult);
      if (standardResult.isError === true) {
        throw new Error(`MCP ${input.server.id}/${input.remoteName} failed: ${output.text ?? "remote error"}`);
      }
      const structuredContent = normalizeStructuredContent(standardResult.structuredContent);
      return {
        serverId: input.server.id,
        toolName: input.remoteName,
        content: output.content,
        ...(structuredContent === undefined ? {} : { structuredContent }),
      };
    },
  };
}

function normalizeStructuredContent(value: unknown): unknown {
  if (value === undefined) return undefined;
  const bytes = Buffer.byteLength(JSON.stringify(value));
  return bytes <= MAX_MCP_STRUCTURED_CONTENT_BYTES
    ? value
    : { omitted: true, bytes, reason: "structured MCP output exceeded the local bound" };
}

function normalizeMcpOutput(result: CallToolResult): {
  content: unknown[];
  text?: string;
} {
  let remaining = MAX_MCP_TEXT;
  const textParts: string[] = [];
  const content = result.content.map((item) => {
    if (item.type === "text") {
      const text = item.text.slice(0, Math.max(0, remaining));
      remaining -= text.length;
      textParts.push(text);
      return { type: "text", text, truncated: text.length !== item.text.length };
    }
    if (item.type === "image" || item.type === "audio") {
      return {
        type: item.type,
        mimeType: item.mimeType,
        bytes: Buffer.byteLength(item.data, "base64"),
        dataOmitted: true,
      };
    }
    if (item.type === "resource") {
      const resource = item.resource;
      if ("text" in resource) {
        const text = resource.text.slice(0, Math.max(0, remaining));
        remaining -= text.length;
        textParts.push(text);
        return {
          type: "resource",
          uri: resource.uri,
          mimeType: resource.mimeType,
          text,
          truncated: text.length !== resource.text.length,
        };
      }
      return {
        type: "resource",
        uri: resource.uri,
        mimeType: resource.mimeType,
        bytes: Buffer.byteLength(resource.blob, "base64"),
        blobOmitted: true,
      };
    }
    return { type: "unsupported", omitted: true };
  });
  return { content, text: textParts.join("\n").slice(0, MAX_MCP_TEXT) || undefined };
}

function buildServerEnvironment(
  config: Extract<McpServerConfig, { transport?: "stdio" }>,
  environment: NodeJS.ProcessEnv,
): Record<string, string> {
  const result = getDefaultEnvironment();
  for (const [target, source] of Object.entries(config.env)) {
    const value = environment[source];
    if (value === undefined) throw new Error(`MCP server ${config.id} requires environment variable ${source}`);
    result[target] = value;
  }
  return result;
}

function exposeToolName(serverId: string, remoteName: string): string {
  const normalized = remoteName.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "tool";
  const digest = createHash("sha256").update(remoteName).digest("hex").slice(0, 8);
  const prefix = `mcp_${serverId}_`;
  const available = 64 - prefix.length - digest.length - 1;
  if (available < 1) throw new Error(`MCP server id is too long for provider tool names: ${serverId}`);
  return `${prefix}${normalized.slice(0, available)}_${digest}`;
}

async function closeConnected(servers: readonly ConnectedServer[]): Promise<void> {
  const failures: unknown[] = [];
  for (const server of servers.toReversed()) {
    try {
      await server.client.close();
    } catch (error) {
      failures.push(error);
      try {
        await server.transport.close();
      } catch (transportError) {
        failures.push(transportError);
      }
    }
    try {
      await server.oauth?.close();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, "Failed to close one or more MCP servers");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
