import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export const PRIVATE_DIRECTORY_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;

/**
 * Creates or restricts one LocalBuddy-owned directory without accepting a
 * symlink as the directory itself. Callers must start at a canonical user
 * workspace and prepare each managed path segment in order.
 */
export async function ensurePrivateDirectory(directoryInput: string): Promise<string> {
  const directory = resolve(directoryInput);
  await mkdir(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  const metadata = await lstat(directory);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`private storage path is not a regular directory: ${directory}`);
  }
  if (process.platform !== "win32") await chmod(directory, PRIVATE_DIRECTORY_MODE);
  return directory;
}

/** Prepares .localbuddy/runs/<runId> one segment at a time below a real workspace. */
export async function ensurePrivateRunRoot(workspaceInput: string, runId: string): Promise<string> {
  if (!/^[a-zA-Z0-9_-]+$/.test(runId)) throw new Error("Run id contains unsafe characters");
  const workspace = await realpath(resolve(workspaceInput));
  let current = workspace;
  for (const segment of [".localbuddy", "runs", runId]) {
    current = resolve(current, segment);
    await ensurePrivateDirectory(current);
  }
  return current;
}

/** Restricts an existing private file and rejects symlinks. */
export async function hardenPrivateFileIfPresent(filePathInput: string): Promise<boolean> {
  const present = await assertPrivateFileIfPresent(filePathInput);
  if (present && process.platform !== "win32") {
    await chmod(resolve(filePathInput), PRIVATE_FILE_MODE);
  }
  return present;
}

/** Validates an existing private file without changing metadata. */
export async function assertPrivateFileIfPresent(filePathInput: string): Promise<boolean> {
  const filePath = resolve(filePathInput);
  try {
    const metadata = await lstat(filePath);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error(`private storage path is not a regular file: ${filePath}`);
    }
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

/**
 * Restricts legacy files only after the caller has acquired the workspace
 * process lock. It visits LocalBuddy-owned Run state, never user source files,
 * and never follows symlinks.
 */
export async function hardenPrivateRunStorage(runRootInput: string): Promise<void> {
  const runRoot = await ensurePrivateDirectory(runRootInput);
  for (const fileName of [
    "run-request.json",
    "events.jsonl",
    "plan-review.json",
    "integration-proposal.json",
  ]) {
    await hardenPrivateFileIfPresent(resolve(runRoot, fileName));
  }
  for (const directoryName of ["checkpoint", "artifacts", "revision-source"]) {
    await hardenPrivateTreeIfPresent(resolve(runRoot, directoryName));
  }
}

export async function writePrivateFileAtomic(
  filePathInput: string,
  content: string | Uint8Array,
): Promise<void> {
  const filePath = resolve(filePathInput);
  await ensurePrivateDirectory(dirname(filePath));
  await hardenPrivateFileIfPresent(filePath);
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, content, { flag: "wx", mode: PRIVATE_FILE_MODE });
    await rename(temporaryPath, filePath);
    if (process.platform !== "win32") await chmod(filePath, PRIVATE_FILE_MODE);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function writePrivateJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await writePrivateFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function appendPrivateUtf8(filePathInput: string, content: string): Promise<void> {
  const filePath = resolve(filePathInput);
  await ensurePrivateDirectory(dirname(filePath));
  await hardenPrivateFileIfPresent(filePath);
  const flags = constants.O_APPEND
    | constants.O_CREAT
    | constants.O_WRONLY
    | (process.platform === "win32" ? 0 : constants.O_NOFOLLOW);
  const handle = await open(filePath, flags, PRIVATE_FILE_MODE);
  try {
    await handle.writeFile(content, { encoding: "utf8" });
    if (process.platform !== "win32") await handle.chmod(PRIVATE_FILE_MODE);
  } finally {
    await handle.close();
  }
}

async function hardenPrivateTreeIfPresent(pathInput: string): Promise<void> {
  const path = resolve(pathInput);
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }
  if (metadata.isSymbolicLink()) {
    throw new Error(`private storage path must not be a symbolic link: ${path}`);
  }
  if (metadata.isFile()) {
    if (process.platform !== "win32") await chmod(path, PRIVATE_FILE_MODE);
    return;
  }
  if (!metadata.isDirectory()) {
    throw new Error(`private storage path has an unsupported type: ${path}`);
  }
  if (process.platform !== "win32") await chmod(path, PRIVATE_DIRECTORY_MODE);
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = resolve(path, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`private storage path must not be a symbolic link: ${child}`);
    }
    if (entry.isDirectory() || entry.isFile()) await hardenPrivateTreeIfPresent(child);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
