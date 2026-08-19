import { lstat, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";

const MAX_MANIFEST_ENTRIES = 100;
const SKIPPED_DIRECTORIES = new Set([".git", ".localbuddy", ".localbuddy-internal", "node_modules"]);

// Coding planning receives a small path-name hint. Research does not call this:
// its local evidence comes only from explicitly selected Run sources.
export async function buildWorkspaceManifest(workspaceRoot: string): Promise<string[]> {
  const entries: string[] = [];
  await collectManifestPaths(workspaceRoot, workspaceRoot, entries);
  return entries;
}

async function collectManifestPaths(
  directory: string,
  root: string,
  results: string[],
): Promise<void> {
  if (results.length >= MAX_MANIFEST_ENTRIES) return;
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    if (results.length >= MAX_MANIFEST_ENTRIES) return;
    if (entry.isSymbolicLink() || SKIPPED_DIRECTORIES.has(entry.name)) continue;
    if (!entry.isDirectory() && !entry.isFile()) continue;
    const path = resolve(directory, entry.name);
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) continue;
    results.push(metadata.isDirectory() ? `${relative(root, path)}/` : relative(root, path));
    if (metadata.isDirectory()) await collectManifestPaths(path, root, results);
  }
}
