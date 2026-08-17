import { createHash } from "node:crypto";
import {
  lstat,
  readFile,
  readdir,
  realpath,
  stat,
} from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path";

import type { ArtifactRegistry } from "./artifacts.js";
import {
  ArtifactReviewRevisionError,
  type ArtifactReviewCandidate,
  type ArtifactReviewGate,
} from "./artifact-reviewer.js";
import type { CalculationRegistry } from "./calculations.js";
import {
  buildDocxArtifact,
  DOCX_MEDIA_TYPE,
  docxArtifactText,
  docxArtifactSpecFromMarkdown,
  inspectDocxArtifact,
  normalizeDocxArtifactSpec,
  type DocxArtifactSpec,
} from "./docx-artifact.js";
import type { EventStore } from "./event-store.js";
import { ensurePrivateDirectory, writePrivateFileAtomic } from "./private-storage.js";
import {
  researchSourceCatalog,
  resolveResearchSourceReference,
  searchResearchSources,
  type ResearchSource,
} from "./research-sources.js";
import type { ToolDefinition } from "./tool-runtime.js";

const MAX_READ_BYTES = 200_000;
const MAX_DIRECT_SOURCE_READ_BYTES = 50_000;
const MAX_DIRECT_SOURCE_PREVIEW_CHARACTERS = 12_000;
const MAX_DOCX_READ_BYTES = 5_000_000;
const MAX_LIST_ENTRIES = 200;
const MAX_SOURCE_TEXT_SEARCH_BYTES = 1_000_000;
const MAX_SOURCE_TEXT_QUERIES = 8;
const MAX_SOURCE_TEXT_MATCHES = 20;
const MAX_SOURCE_TEXT_CONTEXT_LINES = 3;
const MAX_SOURCE_TEXT_EXCERPT_CHARS = 1_200;
const SKIPPED_DIRECTORIES = new Set([".git", ".localbuddy", "node_modules"]);

export interface WorkspaceToolsOptions {
  workspaceRoot?: string;
  sourcePaths?: readonly string[];
  sourceIdsByTask?: ReadonlyMap<string, ReadonlySet<string>>;
  artifactRoot: string;
  artifactRegistry: ArtifactRegistry;
  calculationRegistry: CalculationRegistry;
  eventStore: EventStore;
  artifactReviewer?: ArtifactReviewGate;
}

export async function createWorkspaceTools(
  options: WorkspaceToolsOptions,
): Promise<readonly ToolDefinition[]> {
  const sources = options.sourcePaths === undefined
    ? undefined
    : await researchSourceCatalog(options.sourcePaths);
  const workspaceRoot = options.sourcePaths === undefined
    ? await realpath(requiredWorkspaceRoot(options.workspaceRoot))
    : undefined;
  await ensurePrivateDirectory(options.artifactRoot);
  const artifactRoot = await realpath(options.artifactRoot);

  return [
    ...(sources === undefined ? [
      createListFilesTool(workspaceRoot as string),
      createLegacyReadFileTool(workspaceRoot as string),
    ] : sources.length === 0 ? [] : [
      createSearchFilesTool(sources, options.sourceIdsByTask),
      createSearchSourceTextTool(sources, options.sourceIdsByTask),
      createReadFileTool(sources, options.sourceIdsByTask),
    ]),
    createWriteArtifactTool(
      artifactRoot,
      options.artifactRegistry,
      options.calculationRegistry,
      options.eventStore,
      options.artifactReviewer,
    ),
    createWriteDocxArtifactTool(
      artifactRoot,
      options.artifactRegistry,
      options.calculationRegistry,
      options.eventStore,
      options.artifactReviewer,
    ),
  ];
}

function createListFilesTool(workspaceRoot: string): ToolDefinition<{ path: string }> {
  return {
    name: "list_files",
    description: "List files inside the local coding workspace. Paths must stay inside the workspace.",
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
      if (!(await stat(start)).isDirectory()) throw new Error("list_files path must be a directory");
      const results: string[] = [];
      await walk(start, workspaceRoot, results);
      return { entries: results, truncated: results.length >= MAX_LIST_ENTRIES };
    },
  };
}

function createLegacyReadFileTool(workspaceRoot: string): ToolDefinition<{ path: string }> {
  return {
    name: "read_file",
    description: "Read a UTF-8 text file inside the local coding workspace.",
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
      if (!metadata.isFile()) throw new Error("read_file path must be a regular file");
      const content = await readFile(filePath);
      if (extname(filePath).toLowerCase() === ".docx") {
        if (metadata.size > MAX_DOCX_READ_BYTES) {
          throw new Error(`DOCX file exceeds ${MAX_DOCX_READ_BYTES} byte read limit`);
        }
        return documentReadResult(relative(workspaceRoot, filePath), content);
      }
      if (metadata.size > MAX_READ_BYTES) throw new Error(`file exceeds ${MAX_READ_BYTES} byte read limit`);
      return { path: relative(workspaceRoot, filePath), content: content.toString("utf8") };
    },
  };
}

function createSearchFilesTool(
  sources: readonly ResearchSource[],
  sourceIdsByTask?: ReadonlyMap<string, ReadonlySet<string>>,
): ToolDefinition<{ query: string }> {
  return {
    name: "search_files",
    description: [
      "Search file names only inside the local files or folders explicitly selected for this Run.",
      "This is on-demand discovery, not an automatic project-directory scan.",
      "Returned paths use logical source ids such as source-1/report.md.",
    ].join(" "),
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Non-empty case-insensitive filename substring" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    risk: "read",
    permission: "workspace.read",
    parse(input) {
      const record = expectObject(input);
      return { query: expectString(record.query, "query") };
    },
    async execute(input, context) {
      return searchResearchSources(
        researchSourcesForTask(sources, sourceIdsByTask, context.taskId),
        input.query,
      );
    },
  };
}

function createReadFileTool(
  sources: readonly ResearchSource[],
  sourceIdsByTask?: ReadonlyMap<string, ReadonlySet<string>>,
): ToolDefinition<{ path: string }> {
  return {
    name: "read_file",
    description: [
      "Read a UTF-8 text file or extract a supported DOCX from the local sources explicitly selected for this Run.",
      "Use a logical path returned by search_files, or a selected file id such as source-1.",
      "Large text sources return only a bounded preview plus evidence metadata; use search_source_text for targeted excerpts instead of calling read_file again.",
    ].join(" "),
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
    async execute(input, context) {
      const resolved = await resolveResearchSourceReference(
        researchSourcesForTask(sources, sourceIdsByTask, context.taskId),
        input.path,
      );
      const content = await readFile(resolved.path);
      if (extname(resolved.path).toLowerCase() === ".docx") {
        if (content.length > MAX_DOCX_READ_BYTES) {
          throw new Error(`DOCX file exceeds ${MAX_DOCX_READ_BYTES} byte read limit`);
        }
        return {
          ...documentReadResult(resolved.reference, content),
          sha256: createHash("sha256").update(content).digest("hex"),
          bytes: content.length,
        };
      }
      if (content.length > MAX_READ_BYTES) {
        throw new Error(`file exceeds ${MAX_READ_BYTES} byte read limit`);
      }
      const text = content.toString("utf8");
      if (content.length > MAX_DIRECT_SOURCE_READ_BYTES) {
        return {
          path: resolved.reference,
          sha256: createHash("sha256").update(content).digest("hex"),
          bytes: content.length,
          content: text.slice(0, MAX_DIRECT_SOURCE_PREVIEW_CHARACTERS),
          truncated: true,
          guidance: "This is a large source preview. Do not call read_file on it again; use search_source_text with targeted terms to retrieve bounded relevant excerpts.",
        };
      }
      return {
        path: resolved.reference,
        sha256: createHash("sha256").update(content).digest("hex"),
        bytes: content.length,
        content: text,
      };
    },
  };
}

function createSearchSourceTextTool(
  sources: readonly ResearchSource[],
  sourceIdsByTask?: ReadonlyMap<string, ReadonlySet<string>>,
): ToolDefinition<{
  path: string;
  queries: string[];
  contextLines: number;
  maxMatches: number;
}> {
  return {
    name: "search_source_text",
    description: [
      "Search bounded excerpts inside one explicit local source file without loading the whole file into the model context.",
      "First choose one logical file path: a selected file id such as source-1, or a path returned by search_files.",
      "Use this for long text or DOCX policy documents; it never searches the run location or an entire selected directory implicitly.",
      "The result includes SHA-256 evidence metadata so checkpoint recovery can detect source changes.",
    ].join(" "),
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Logical source file path" },
        queries: {
          type: "array",
          items: { type: "string" },
          description: `1-${MAX_SOURCE_TEXT_QUERIES} literal case-insensitive terms; a line matching any term is returned`,
        },
        contextLines: {
          type: "integer",
          minimum: 0,
          maximum: MAX_SOURCE_TEXT_CONTEXT_LINES,
          description: "Optional surrounding lines per match; default 1",
        },
        maxMatches: {
          type: "integer",
          minimum: 1,
          maximum: MAX_SOURCE_TEXT_MATCHES,
          description: "Optional maximum matching lines; default 12",
        },
      },
      required: ["path", "queries"],
      additionalProperties: false,
    },
    risk: "read",
    permission: "workspace.read",
    parse(input) {
      const record = expectObject(input);
      if (
        !Array.isArray(record.queries)
        || record.queries.length < 1
        || record.queries.length > MAX_SOURCE_TEXT_QUERIES
        || !record.queries.every((query) =>
          typeof query === "string" && query.trim().length >= 1 && query.trim().length <= 200)
      ) {
        throw new Error(
          `queries must contain 1-${MAX_SOURCE_TEXT_QUERIES} strings of 1-200 characters`,
        );
      }
      return {
        path: expectString(record.path, "path"),
        queries: [...new Set(record.queries.map((query) => query.trim()))],
        contextLines: optionalBoundedInteger(
          record.contextLines,
          "contextLines",
          0,
          MAX_SOURCE_TEXT_CONTEXT_LINES,
          1,
        ),
        maxMatches: optionalBoundedInteger(
          record.maxMatches,
          "maxMatches",
          1,
          MAX_SOURCE_TEXT_MATCHES,
          12,
        ),
      };
    },
    async execute(input, context) {
      const resolved = await resolveResearchSourceReference(
        researchSourcesForTask(sources, sourceIdsByTask, context.taskId),
        input.path,
      );
      const content = await readFile(resolved.path);
      const isDocx = extname(resolved.path).toLowerCase() === ".docx";
      const maximumBytes = isDocx ? MAX_DOCX_READ_BYTES : MAX_SOURCE_TEXT_SEARCH_BYTES;
      if (content.length > maximumBytes) {
        throw new Error(
          `source file exceeds ${maximumBytes} byte text-search limit`,
        );
      }
      if (!isDocx && content.includes(0)) {
        throw new Error("search_source_text supports UTF-8 text files only");
      }
      const text = isDocx ? inspectDocxArtifact(content).text : content.toString("utf8");
      const lines = text.split(/\r?\n/u);
      const normalizedQueries = input.queries.map((query) => query.toLocaleLowerCase());
      const matches: Array<{
        line: number;
        startLine: number;
        endLine: number;
        queries: string[];
        excerpt: string;
      }> = [];
      let totalMatches = 0;
      for (let index = 0; index < lines.length; index += 1) {
        const normalizedLine = lines[index]!.toLocaleLowerCase();
        const matchedQueries = input.queries.filter((_, queryIndex) =>
          normalizedLine.includes(normalizedQueries[queryIndex]!));
        if (matchedQueries.length === 0) continue;
        totalMatches += 1;
        if (matches.length >= input.maxMatches) continue;
        const startIndex = Math.max(0, index - input.contextLines);
        const endIndex = Math.min(lines.length - 1, index + input.contextLines);
        const excerpt = lines
          .slice(startIndex, endIndex + 1)
          .map((line, excerptIndex) => `${startIndex + excerptIndex + 1}: ${line}`)
          .join("\n")
          .slice(0, MAX_SOURCE_TEXT_EXCERPT_CHARS);
        matches.push({
          line: index + 1,
          startLine: startIndex + 1,
          endLine: endIndex + 1,
          queries: matchedQueries,
          excerpt,
        });
      }
      return {
        path: resolved.reference,
        sha256: createHash("sha256").update(content).digest("hex"),
        bytes: content.length,
        lineCount: lines.length,
        queries: input.queries,
        matches,
        totalMatches,
        truncated: totalMatches > matches.length,
      };
    },
  };
}

function createWriteDocxArtifactTool(
  artifactRoot: string,
  registry: ArtifactRegistry,
  calculationRegistry: CalculationRegistry,
  eventStore: EventStore,
  artifactReviewer?: ArtifactReviewGate,
): ToolDefinition<{
  fileName: string;
  document: DocxArtifactSpec;
  calculationIds: string[];
}> {
  return {
    name: "write_docx_artifact",
    description: [
      "Create one editable Word DOCX artifact from bounded Markdown content.",
      "Use one # title, ## section headings, normal paragraphs, - bullets, and optional pipe tables. Local code compiles and round-trips the DOCX; do not construct nested document JSON or OOXML.",
      "This first slice intentionally excludes images, comments, tracked changes, macros, and embedded objects.",
    ].join(" "),
    parameters: {
      type: "object",
      properties: {
        fileName: { type: "string", description: "Simple output filename ending in .docx" },
        content: {
          type: "string",
          description: "Complete bounded Markdown content beginning with one # title and using ## sections",
        },
        calculationIds: {
          type: "array",
          items: { type: "string" },
          description: "All registered calculation IDs used by this document; use [] when there are none",
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
      if (basename(fileName) !== fileName || !/^[\p{L}\p{N}._-]+\.docx$/iu.test(fileName)) {
        throw new Error("DOCX fileName must be a simple .docx filename");
      }
      if (!Array.isArray(record.calculationIds)
        || !record.calculationIds.every((item) => typeof item === "string")) {
        throw new Error("calculationIds must be an array of strings");
      }
      return {
        fileName,
        document: typeof record.content === "string"
          ? docxArtifactSpecFromMarkdown(record.content)
          : normalizeDocxArtifactSpec(record.document),
        calculationIds: record.calculationIds,
      };
    },
    async execute(input, context) {
      const plainText = docxArtifactText(input.document);
      await validateCalculationLedger(
        plainText,
        input.calculationIds,
        await calculationRegistry.list(context.runId),
      );
      const content = buildDocxArtifact(input.document);
      const inspection = inspectDocxArtifact(content);
      const digest = createHash("sha256").update(content).digest("hex");
      await requireArtifactReview(artifactReviewer, {
        fileName: input.fileName,
        mediaType: DOCX_MEDIA_TYPE,
        text: inspection.text,
        bytes: content.length,
        sha256: digest,
        structure: {
          paragraphCount: inspection.paragraphCount,
          sectionCount: inspection.sectionCount,
          tableCount: inspection.tableCount,
          tableRowCount: inspection.tableRowCount,
        },
      }, context);
      const outputPath = resolve(artifactRoot, input.fileName);
      assertInside(artifactRoot, outputPath);
      try {
        if ((await lstat(outputPath)).isSymbolicLink()) {
          throw new Error("refusing to overwrite a symbolic link");
        }
      } catch (error) {
        if (!(isNodeError(error) && error.code === "ENOENT")) throw error;
      }
      await writePrivateFileAtomic(outputPath, content);
      await registry.add({
        runId: context.runId,
        taskId: context.taskId,
        agentId: context.agent.id,
        relativePath: input.fileName,
        absolutePath: outputPath,
        mediaType: DOCX_MEDIA_TYPE,
        bytes: content.length,
        sha256: digest,
      });
      await eventStore.append({
        type: "artifact.created",
        runId: context.runId,
        taskId: context.taskId,
        agentId: context.agent.id,
        data: {
          fileName: input.fileName,
          mediaType: DOCX_MEDIA_TYPE,
          bytes: content.length,
          sha256: digest,
          paragraphCount: inspection.paragraphCount,
          tableCount: inspection.tableCount,
        },
      });
      return {
        fileName: input.fileName,
        bytes: content.length,
        sha256: digest,
        paragraphCount: inspection.paragraphCount,
        tableCount: inspection.tableCount,
        tableRowCount: inspection.tableRowCount,
      };
    },
  };
}

function createWriteArtifactTool(
  artifactRoot: string,
  registry: ArtifactRegistry,
  calculationRegistry: CalculationRegistry,
  eventStore: EventStore,
  artifactReviewer?: ArtifactReviewGate,
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
      const digest = createHash("sha256").update(input.content).digest("hex");
      await requireArtifactReview(artifactReviewer, {
        fileName: input.fileName,
        mediaType: mediaTypeFor(input.fileName),
        text: input.content,
        bytes: Buffer.byteLength(input.content),
        sha256: digest,
      }, context);
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

      await writePrivateFileAtomic(outputPath, input.content);

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

async function requireArtifactReview(
  reviewer: ArtifactReviewGate | undefined,
  candidate: ArtifactReviewCandidate,
  context: Parameters<ArtifactReviewGate["review"]>[1],
): Promise<void> {
  if (reviewer === undefined) return;
  const decision = await reviewer.review(candidate, context);
  if (decision.verdict === "revise") {
    throw new ArtifactReviewRevisionError(decision);
  }
}

async function validateCalculationLedger(
  content: string,
  suppliedIds: readonly string[],
  calculations: Awaited<ReturnType<CalculationRegistry["list"]>>,
): Promise<void> {
  const registeredIds = new Set(calculations.map((calculation) => calculation.id));
  const supplied = new Set(suppliedIds);
  const unknown = [...supplied].filter((id) => !registeredIds.has(id));
  if (unknown.length > 0) {
    throw new Error(
      [
        "Artifact Gate rejected the write because calculationIds contain entries absent from the local ledger.",
        `Unknown IDs: ${unknown.join(", ") || "none"}.`,
        `Registered IDs: ${[...registeredIds].join(", ") || "none"}.`,
        "Pass only registered IDs actually used by this Artifact, and cite each as [calculationId] on its evidence line.",
      ].join(" "),
    );
  }
  const citedIds = new Set([...supplied].filter((id) => content.includes(`[${id}]`)));
  for (const id of citedIds) {
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
        `Artifact Gate rejected the write: citation [${id}] must include exact values `
        + `${exactValues.join(" and ")} on the same line. Correct that line, then retry write_artifact.`,
      );
    }
  }

  const suspiciousLines = content.split("\n").filter(hasUnregisteredDerivedCalculation);
  for (const line of suspiciousLines) {
    if (![...citedIds].some((id) => line.includes(`[${id}]`))) {
      throw new Error(
        "Artifact Gate rejected the write: a derived numeric calculation lacks a registered calculation ID. "
        + `Claim: ${line.slice(0, 120)}. Run a deterministic calculation tool, preserve its calculationId, `
        + "cite [calculationId] on this line, then retry write_artifact.",
      );
    }
  }
}

function hasUnregisteredDerivedCalculation(line: string): boolean {
  const withoutUrls = line.replace(
    /(?:https?:\/\/|www\.|[a-z0-9.-]+\.[a-z]{2,}\/)[^\s<>)\]}]+/giu,
    "",
  );
  const withoutSlashDates = withoutUrls.replace(
    /\b(?:19|20)\d{2}\s*\/\s*(?:0?[1-9]|1[0-2])(?:\s*\/\s*(?:0?[1-9]|[12]\d|3[01]))?\b/gu,
    "",
  );
  const withoutSourceIdLists = withoutSlashDates.replace(
    /\bsource-\d+(?:\s*\/\s*(?:source-)?\d+)+\b/giu,
    "",
  );
  const withoutNumberedSourceReferences = withoutSourceIdLists.replace(
    /\b0?\d+\s*\/\s*0?\d+\s*号(?:资料|文件|来源)/gu,
    "",
  );
  return /(?:\d+\s*\/\s*\d+|≈|(?:转化率|增长率).*(?:高于|低于|微降|上升|下降))/u
    .test(withoutNumberedSourceReferences);
}

async function walk(directory: string, root: string, results: string[]): Promise<void> {
  if (results.length >= MAX_LIST_ENTRIES) return;
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    if (results.length >= MAX_LIST_ENTRIES) return;
    if (entry.isSymbolicLink() || (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name))) continue;
    const absolutePath = resolve(directory, entry.name);
    assertInside(root, absolutePath);
    const relativePath = relative(root, absolutePath);
    results.push(entry.isDirectory() ? `${relativePath}/` : relativePath);
    if (entry.isDirectory()) await walk(absolutePath, root, results);
  }
}

async function resolveExistingPath(root: string, requestedPath: string): Promise<string> {
  if (isAbsolute(requestedPath)) throw new Error("absolute paths are not allowed");
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

function requiredWorkspaceRoot(value: string | undefined): string {
  if (value === undefined) throw new Error("workspaceRoot is required for coding workspace tools");
  return value;
}

function researchSourcesForTask(
  sources: readonly ResearchSource[],
  sourceIdsByTask: ReadonlyMap<string, ReadonlySet<string>> | undefined,
  taskId: string,
): readonly ResearchSource[] {
  const assigned = sourceIdsByTask?.get(taskId);
  if (assigned === undefined) return sources;
  return sources.filter((source) => assigned.has(source.id));
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

function optionalBoundedInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${field} must be an integer between ${minimum} and ${maximum}`);
  }
  return value as number;
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

function documentReadResult(path: string, content: Uint8Array) {
  const inspection = inspectDocxArtifact(content);
  return {
    path,
    format: "docx" as const,
    content: inspection.text,
    document: {
      title: inspection.title,
      paragraphs: inspection.paragraphCount,
      sections: inspection.sectionCount,
      tables: inspection.tableCount,
      tableRows: inspection.tableRowCount,
    },
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
