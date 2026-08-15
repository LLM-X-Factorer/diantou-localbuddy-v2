import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { DesktopRunManager } from "../dist/src/desktop-run-manager.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function outside(root, candidate) {
  const child = relative(root, candidate);
  return child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child);
}

async function assertMissing(path) {
  try {
    await lstat(path);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`target already exists: ${path}`);
}

async function canonicalizeMissingPath(path) {
  let ancestor = dirname(path);
  const suffix = [basename(path)];
  while (true) {
    try {
      return resolve(await realpath(ancestor), ...suffix);
    } catch (error) {
      if (!(error && typeof error === "object" && error.code === "ENOENT")) throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      suffix.unshift(basename(ancestor));
      ancestor = parent;
    }
  }
}

async function main() {
  const argumentsAfterScript = process.argv.slice(2);
  if (argumentsAfterScript[0] === "--") argumentsAfterScript.shift();
  const [caseId, workspaceArgument, runId, targetArgument] = argumentsAfterScript;
  if (!caseId || !workspaceArgument || !runId || !targetArgument) {
    fail("usage: pnpm benchmark:trace -- <case-id> <workspace> <run-id> <new-target-json>");
    return;
  }

  const [manifest, packageJson] = await Promise.all([
    readFile(resolve(repositoryRoot, "benchmarks", "workbuddy-core", "manifest.json"), "utf8")
      .then((value) => JSON.parse(value)),
    readFile(resolve(repositoryRoot, "package.json"), "utf8").then((value) => JSON.parse(value)),
  ]);
  if (!manifest.cases.some((entry) => entry.id === caseId)) {
    throw new Error(`unknown benchmark case: ${caseId}`);
  }
  const requestedWorkspace = resolve(process.cwd(), workspaceArgument);
  const workspace = await realpath(requestedWorkspace);
  const requestedTarget = resolve(process.cwd(), targetArgument);
  const target = await canonicalizeMissingPath(requestedTarget);
  if (
    !outside(requestedWorkspace, requestedTarget)
    || !outside(workspace, target)
  ) {
    throw new Error("trace target must be outside the disposable benchmark workspace");
  }
  await assertMissing(target);

  const manager = new DesktopRunManager({
    async createProvider() {
      throw new Error("benchmark trace export never creates a Provider");
    },
  });
  const diagnostics = await manager.buildDiagnostics(
    { workspace, runId },
    String(packageJson.version),
  );
  if (diagnostics.workspace && typeof diagnostics.workspace === "object") {
    diagnostics.workspace = { ...diagnostics.workspace, name: "omitted" };
  }
  const trace = {
    schemaVersion: 1,
    benchmarkId: manifest.benchmarkId,
    benchmarkAsOf: manifest.asOf,
    caseId,
    retention: "sanitized-summary-outside-disposable-workspace",
    diagnostics,
  };
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(trace, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  process.stdout.write(`wrote sanitized ${caseId} trace to ${target}\n`);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
