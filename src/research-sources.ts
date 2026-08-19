import { createHash } from "node:crypto";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";

const MAX_RESEARCH_SOURCES = 50;
const MAX_SEARCH_RESULTS = 50;
const MAX_SEARCHED_ENTRIES = 10_000;
const SKIPPED_DIRECTORIES = new Set([".git", ".localbuddy", ".localbuddy-internal", "node_modules"]);

export interface ResearchSource {
  id: string;
  path: string;
  name: string;
  kind: "file" | "directory";
}

export interface ResolvedResearchSourcePath {
  source: ResearchSource;
  path: string;
  reference: string;
}

export async function resolveResearchSources(
  sourcePaths: readonly string[] = [],
): Promise<readonly ResearchSource[]> {
  if (sourcePaths.length > MAX_RESEARCH_SOURCES) {
    throw new Error(`at most ${MAX_RESEARCH_SOURCES} research sources may be selected`);
  }
  const uniquePaths: Array<{ path: string; kind: "file" | "directory" }> = [];
  const seen = new Set<string>();
  for (const sourcePath of sourcePaths) {
    if (typeof sourcePath !== "string" || sourcePath.trim().length === 0) {
      throw new Error("research source paths must be non-empty strings");
    }
    const canonical = await realpath(resolve(sourcePath));
    const metadata = await stat(canonical);
    if (!metadata.isFile() && !metadata.isDirectory()) {
      throw new Error(`research source must be a regular file or directory: ${sourcePath}`);
    }
    if (!seen.has(canonical)) {
      seen.add(canonical);
      uniquePaths.push({
        path: canonical,
        kind: metadata.isDirectory() ? "directory" : "file",
      });
    }
  }
  return uniquePaths.map(({ path, kind }, index) => ({
    id: `source-${index + 1}`,
    path,
    name: basename(path),
    kind,
  }));
}

export async function canonicalResearchSourcePaths(
  sourcePaths: readonly string[] = [],
): Promise<readonly string[]> {
  return (await resolveResearchSources(sourcePaths)).map((source) => source.path);
}

export async function researchSourceCatalog(
  sourcePaths: readonly string[] = [],
): Promise<readonly ResearchSource[]> {
  return resolveResearchSources(sourcePaths);
}

export function researchSourceSummary(sources: readonly ResearchSource[]): readonly string[] {
  if (sources.length === 0) {
    return ["No local research sources were selected. The project directory is not available as evidence."];
  }
  return sources.map((source) =>
    `${source.id}: ${source.name} (${source.kind}; use this source id with the local source tools)`,
  );
}

export async function resolveResearchSourceReference(
  sources: readonly ResearchSource[],
  reference: string,
): Promise<ResolvedResearchSourcePath> {
  if (typeof reference !== "string" || reference.trim().length === 0 || isAbsolute(reference)) {
    throw new Error("source path must be a non-empty logical path such as source-1 or source-1/file.md");
  }
  const normalized = reference.replaceAll("\\", "/");
  const [sourceId, ...segments] = normalized.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new Error("source path contains unsafe segments");
  }
  const source = sources.find((candidate) => candidate.id === sourceId);
  if (source === undefined) throw new Error(`unknown research source: ${sourceId}`);
  if (source.kind === "file") {
    if (segments.length > 0) throw new Error(`${source.id} is a selected file, not a directory`);
    return { source, path: source.path, reference: source.id };
  }
  if (segments.length === 0) throw new Error(`${source.id} is a directory; select a file below it`);
  const lexical = resolve(source.path, ...segments);
  assertInside(source.path, lexical);
  const canonical = await realpath(lexical);
  assertInside(source.path, canonical);
  const metadata = await stat(canonical);
  if (!metadata.isFile()) throw new Error("source path must resolve to a regular file");
  return {
    source,
    path: canonical,
    reference: `${source.id}/${relative(source.path, canonical).replaceAll(sep, "/")}`,
  };
}

export async function searchResearchSources(
  sources: readonly ResearchSource[],
  query: string,
): Promise<{ entries: readonly string[]; scanned: number; truncated: boolean }> {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0 || normalizedQuery.length > 200) {
    throw new Error("query must contain between 1 and 200 characters");
  }
  const entries: string[] = [];
  let scanned = 0;
  let truncated = false;

  for (const source of sources) {
    if (entries.length >= MAX_SEARCH_RESULTS || scanned >= MAX_SEARCHED_ENTRIES) {
      truncated = true;
      break;
    }
    if (source.kind === "file") {
      scanned += 1;
      if (source.name.toLowerCase().includes(normalizedQuery)) entries.push(source.id);
      continue;
    }
    const result = await searchDirectory(source, source.path, normalizedQuery, entries, scanned);
    scanned = result.scanned;
    truncated ||= result.truncated;
  }
  return { entries, scanned, truncated };
}

export async function hashResearchSourceReference(
  sources: readonly ResearchSource[],
  reference: string,
): Promise<{ path: string; sha256: string; bytes: number }> {
  const resolved = await resolveResearchSourceReference(sources, reference);
  const content = await readFile(resolved.path);
  return {
    path: resolved.reference,
    sha256: createHash("sha256").update(content).digest("hex"),
    bytes: content.length,
  };
}

async function searchDirectory(
  source: ResearchSource,
  directory: string,
  query: string,
  results: string[],
  initialScanned: number,
): Promise<{ scanned: number; truncated: boolean }> {
  let scanned = initialScanned;
  let truncated = false;
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    if (results.length >= MAX_SEARCH_RESULTS || scanned >= MAX_SEARCHED_ENTRIES) {
      truncated = true;
      break;
    }
    scanned += 1;
    if (entry.isSymbolicLink() || (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name))) {
      continue;
    }
    const path = resolve(directory, entry.name);
    assertInside(source.path, path);
    if (entry.isFile() && entry.name.toLowerCase().includes(query)) {
      results.push(`${source.id}/${relative(source.path, path).replaceAll(sep, "/")}`);
    }
    if (entry.isDirectory()) {
      const child = await searchDirectory(source, path, query, results, scanned);
      scanned = child.scanned;
      truncated ||= child.truncated;
    }
  }
  return { scanned, truncated };
}

function assertInside(root: string, target: string): void {
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error("source path escapes the selected source");
  }
}
