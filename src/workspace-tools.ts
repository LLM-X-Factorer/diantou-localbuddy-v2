import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";

import type { ArtifactRegistry } from "./artifacts.js";
import type { CalculationRegistry } from "./calculations.js";
import type { EventStore } from "./event-store.js";
import type { ToolDefinition } from "./tool-runtime.js";

const MAX_READ_BYTES = 200_000;
const MAX_LIST_ENTRIES = 200;
const SKIPPED_DIRECTORIES = new Set([".git", ".localbuddy", "node_modules"]);

export interface WorkspaceToolsOptions {
  workspaceRoot: string;
  artifactRoot: string;
  artifactRegistry: ArtifactRegistry;
  calculationRegistry: CalculationRegistry;
  eventStore: EventStore;
}

export async function createWorkspaceTools(
  options: WorkspaceToolsOptions,
): Promise<readonly ToolDefinition[]> {
  const workspaceRoot = await realpath(options.workspaceRoot);
  await mkdir(options.artifactRoot, { recursive: true });
  const artifactRoot = await realpath(options.artifactRoot);

  return [
    createListFilesTool(workspaceRoot),
    createReadFileTool(workspaceRoot),
    createWriteArtifactTool(
      artifactRoot,
      options.artifactRegistry,
      options.calculationRegistry,
      options.eventStore,
    ),
  ];
}

function createListFilesTool(workspaceRoot: string): ToolDefinition<{ path: string }> {
  return {
    name: "list_files",
    description: "List files inside the local workspace. Paths must stay inside the workspace.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Relative directory path; use . for root" } },
      required: ["path"],
      additionalProperties: false,
    },
    risk: "read",
    permission: "workspace.read",
    parse(input) {
      const record = expectObject(input);
      return { path: expectString(record.path, "path") };
    },
    async execute(input) {
      const start = await resolveExistingPath(workspaceRoot, input.path);
      const metadata = await stat(start);
      if (!metadata.isDirectory()) {
        throw new Error("list_files path must be a directory");
      }
      const results: string[] = [];
      await walk(start, workspaceRoot, results);
      return { entries: results, truncated: results.length >= MAX_LIST_ENTRIES };
    },
  };
}

function createReadFileTool(workspaceRoot: string): ToolDefinition<{ path: string }> {
  return {
    name: "read_file",
    description: "Read a UTF-8 text file inside the local workspace.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Relative file path" } },
      required: ["path"],
      additionalProperties: false,
    },
    risk: "read",
    permission: "workspace.read",
    parse(input) {
      const record = expectObject(input);
      return { path: expectString(record.path, "path") };
    },
    async execute(input) {
      const filePath = await resolveExistingPath(workspaceRoot, input.path);
      const metadata = await stat(filePath);
      if (!metadata.isFile()) {
        throw new Error("read_file path must be a regular file");
      }
      if (metadata.size > MAX_READ_BYTES) {
        throw new Error(`file exceeds ${MAX_READ_BYTES} byte read limit`);
      }
      return { path: relative(workspaceRoot, filePath), content: await readFile(filePath, "utf8") };
    },
  };
}

function createWriteArtifactTool(
  artifactRoot: string,
  registry: ArtifactRegistry,
  calculationRegistry: CalculationRegistry,
  eventStore: EventStore,
): ToolDefinition<{ fileName: string; content: string; calculationIds: string[] }> {
  return {
    name: "write_artifact",
    description: "Write a final Markdown, JSON, or text artifact into this run's artifact directory.",
    parameters: {
      type: "object",
      properties: {
        fileName: { type: "string", description: "Simple output filename such as report.md" },
        content: { type: "string", description: "Complete artifact content" },
        calculationIds: {
          type: "array",
          items: { type: "string" },
          description: "All registered calculation IDs used by this artifact; use [] when there are no calculations",
        },
      },
      required: ["fileName", "content", "calculationIds"],
      additionalProperties: false,
    },
    risk: "write",
    permission: "artifact.write",
    parse(input) {
      const record = expectObject(input);
      const fileName = expectString(record.fileName, "fileName");
      const content = expectString(record.content, "content");
      if (!Array.isArray(record.calculationIds) || !record.calculationIds.every((item) => typeof item === "string")) {
        throw new Error("calculationIds must be an array of strings");
      }
      if (basename(fileName) !== fileName || !/^[\p{L}\p{N}._-]+$/u.test(fileName)) {
        throw new Error("fileName must be a simple filename");
      }
      if (!new Set([".md", ".json", ".txt"]).has(extname(fileName).toLowerCase())) {
        throw new Error("artifact extension must be .md, .json, or .txt");
      }
      return { fileName, content, calculationIds: record.calculationIds };
    },
    async execute(input, context) {
      await validateCalculationLedger(
        input.content,
        input.calculationIds,
        await calculationRegistry.list(context.runId),
      );
      const outputPath = resolve(artifactRoot, input.fileName);
      assertInside(artifactRoot, outputPath);
      try {
        if ((await lstat(outputPath)).isSymbolicLink()) {
          throw new Error("refusing to overwrite a symbolic link");
        }
      } catch (error) {
        if (!(isNodeError(error) && error.code === "ENOENT")) {
          throw error;
        }
      }

      const temporaryPath = resolve(
        dirname(outputPath),
        `.${input.fileName}.${process.pid}.${randomUUID()}.tmp`,
      );
      await writeFile(temporaryPath, input.content, { encoding: "utf8", flag: "wx" });
      await rename(temporaryPath, outputPath);

      const digest = createHash("sha256").update(input.content).digest("hex");
      await registry.add({
        runId: context.runId,
        taskId: context.taskId,
        agentId: context.agent.id,
        relativePath: input.fileName,
        absolutePath: outputPath,
        mediaType: mediaTypeFor(input.fileName),
        bytes: Buffer.byteLength(input.content),
        sha256: digest,
      });
      await eventStore.append({
        type: "artifact.created",
        runId: context.runId,
        taskId: context.taskId,
        agentId: context.agent.id,
        data: {
          fileName: input.fileName,
          bytes: Buffer.byteLength(input.content),
          sha256: digest,
        },
      });
      return { fileName: input.fileName, bytes: Buffer.byteLength(input.content), sha256: digest };
    },
  };
}

async function validateCalculationLedger(
  content: string,
  suppliedIds: readonly string[],
  calculations: Awaited<ReturnType<CalculationRegistry["list"]>>,
): Promise<void> {
  const expectedIds = new Set(calculations.map((calculation) => calculation.id));
  const supplied = new Set(suppliedIds);
  const missing = [...expectedIds].filter((id) => !supplied.has(id));
  const unknown = [...supplied].filter((id) => !expectedIds.has(id));
  if (missing.length > 0 || unknown.length > 0) {
    throw new Error(
      `calculation ledger mismatch; missing=[${missing.join(",")}], unknown=[${unknown.join(",")}]`,
    );
  }
  for (const id of expectedIds) {
    if (!content.includes(`[${id}]`)) {
      throw new Error(`artifact must cite calculation record [${id}]`);
    }
    const calculation = calculations.find((candidate) => candidate.id === id);
    if (calculation === undefined) {
      throw new Error(`calculation record disappeared during validation: ${id}`);
    }
    const exactValues = [
      calculation.outputs.leftDecimal,
      calculation.outputs.rightDecimal,
    ].filter((value): value is string => value !== undefined);
    const hasExactDetailLine = content
      .split("\n")
      .some((line) => line.includes(`[${id}]`) && exactValues.every((value) => line.includes(value)));
    if (!hasExactDetailLine) {
      throw new Error(
        `artifact citation [${id}] must include exact values ${exactValues.join(" and ")} on the same line`,
      );
    }
  }

  const suspiciousLines = content.split("\n").filter((line) =>
    /(?:\d+\s*\/\s*\d+|%|≈|(?:转化率|增长率).*(?:高于|低于|微降|上升|下降))/u.test(line),
  );
  for (const line of suspiciousLines) {
    if (![...expectedIds].some((id) => line.includes(`[${id}]`))) {
      throw new Error(`numeric claim lacks a registered calculation id: ${line.slice(0, 120)}`);
    }
  }
}

async function walk(directory: string, root: string, results: string[]): Promise<void> {
  if (results.length >= MAX_LIST_ENTRIES) {
    return;
  }
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    if (results.length >= MAX_LIST_ENTRIES) {
      return;
    }
    if (entry.isSymbolicLink() || (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name))) {
      continue;
    }
    const absolutePath = resolve(directory, entry.name);
    assertInside(root, absolutePath);
    const relativePath = relative(root, absolutePath);
    results.push(entry.isDirectory() ? `${relativePath}/` : relativePath);
    if (entry.isDirectory()) {
      await walk(absolutePath, root, results);
    }
  }
}

async function resolveExistingPath(root: string, requestedPath: string): Promise<string> {
  if (isAbsolute(requestedPath)) {
    throw new Error("absolute paths are not allowed");
  }
  const lexicalPath = resolve(root, requestedPath);
  assertInside(root, lexicalPath);
  const canonicalPath = await realpath(lexicalPath);
  assertInside(root, canonicalPath);
  return canonicalPath;
}

function assertInside(root: string, target: string): void {
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error("path escapes the allowed root");
  }
}

function expectObject(input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("tool input must be an object");
  }
  return input as Record<string, unknown>;
}

function expectString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }
  return value;
}

function mediaTypeFor(fileName: string): string {
  if (fileName.endsWith(".md")) {
    return "text/markdown";
  }
  if (fileName.endsWith(".json")) {
    return "application/json";
  }
  return "text/plain";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
