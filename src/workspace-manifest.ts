import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";

const MAX_MANIFEST_ENTRIES = 100;
const MAX_SNAPSHOT_ENTRIES = 1_000;

export interface WorkspaceSnapshot {
  manifest: readonly string[];
  sha256: string;
  complete: boolean;
  entryCount: number;
}

export async function buildWorkspaceManifest(workspaceRoot: string): Promise<string[]> {
  const entries: string[] = [];
  await collectManifestPaths(workspaceRoot, workspaceRoot, entries);
  return entries;
}

export async function buildWorkspaceSnapshot(workspaceRoot: string): Promise<WorkspaceSnapshot> {
  const entries: SnapshotEntry[] = [];
  const state = { truncated: false };
  await collectPaths(workspaceRoot, workspaceRoot, entries, state);
  const digest = createHash("sha256");
  for (const entry of entries) {
    digest.update(entry.relativePath);
    digest.update("\0");
    digest.update(entry.directory ? "directory" : "file");
    digest.update("\0");
    if (!entry.directory) {
      await hashFile(entry.absolutePath, digest);
    }
    digest.update("\0");
  }
  return {
    manifest: entries.slice(0, MAX_MANIFEST_ENTRIES).map((entry) => entry.relativePath),
    sha256: digest.digest("hex"),
    complete: !state.truncated,
    entryCount: entries.length,
  };
}

interface SnapshotEntry {
  absolutePath: string;
  relativePath: string;
  directory: boolean;
}

async function collectManifestPaths(
  directory: string,
  root: string,
  results: string[],
): Promise<void> {
  if (results.length >= MAX_MANIFEST_ENTRIES) {
    return;
  }
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    if (results.length >= MAX_MANIFEST_ENTRIES) {
      return;
    }
    if (entry.isSymbolicLink() || [".git", ".localbuddy", "node_modules"].includes(entry.name)) {
      continue;
    }
    const path = resolve(directory, entry.name);
    results.push(entry.isDirectory() ? `${relative(root, path)}/` : relative(root, path));
    if (entry.isDirectory()) {
      await collectManifestPaths(path, root, results);
    }
  }
}

async function collectPaths(
  directory: string,
  root: string,
  results: SnapshotEntry[],
  state: { truncated: boolean },
): Promise<void> {
  if (results.length >= MAX_SNAPSHOT_ENTRIES) {
    state.truncated = true;
    return;
  }
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    if (results.length >= MAX_SNAPSHOT_ENTRIES) {
      state.truncated = true;
      return;
    }
    if (entry.isSymbolicLink() || [".git", ".localbuddy", "node_modules"].includes(entry.name)) {
      continue;
    }
    const path = resolve(directory, entry.name);
    results.push({
      absolutePath: path,
      relativePath: entry.isDirectory() ? `${relative(root, path)}/` : relative(root, path),
      directory: entry.isDirectory(),
    });
    if (entry.isDirectory()) {
      await collectPaths(path, root, results, state);
    }
  }
}

async function hashFile(filePath: string, digest: ReturnType<typeof createHash>): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk: Buffer) => digest.update(chunk));
    stream.once("error", reject);
    stream.once("end", resolvePromise);
  });
}
