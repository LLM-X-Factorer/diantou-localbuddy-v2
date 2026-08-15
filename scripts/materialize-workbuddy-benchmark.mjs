import { cp, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const benchmarkRoot = resolve(repositoryRoot, "benchmarks", "workbuddy-core");
const manifestPath = resolve(benchmarkRoot, "manifest.json");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function resolveInside(root, candidate, label) {
  if (typeof candidate !== "string" || candidate.length === 0 || candidate.includes("\0")) {
    throw new Error(`${label} must be a non-empty path`);
  }
  const absolute = resolve(root, candidate);
  const child = relative(root, absolute);
  if (child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) {
    throw new Error(`${label} escapes its allowed root`);
  }
  return absolute;
}

async function assertMissing(target) {
  try {
    await lstat(target);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`target already exists: ${target}`);
}

async function copyFixture(entry, targetRoot) {
  const source = resolveInside(repositoryRoot, entry.source, "fixture source");
  const target = resolveInside(targetRoot, entry.target, "fixture target");
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true, errorOnExist: true, force: false });
}

async function generateFileSet(manifestRelativePath, targetRoot) {
  const source = resolveInside(repositoryRoot, manifestRelativePath, "generated file manifest");
  const definition = JSON.parse(await readFile(source, "utf8"));
  if (!Array.isArray(definition.files) || definition.files.length !== 30) {
    throw new Error("WB-01 generated file manifest must contain exactly 30 files");
  }
  const inputRoot = resolve(targetRoot, "input");
  await mkdir(inputRoot, { recursive: false });
  const names = new Set();
  const expectedNames = new Set();
  for (const entry of definition.files) {
    if (
      !entry ||
      typeof entry.originalName !== "string" ||
      typeof entry.expectedName !== "string" ||
      typeof entry.content !== "string"
    ) {
      throw new Error("generated file entries require originalName, expectedName, and content");
    }
    const output = resolveInside(inputRoot, entry.originalName, "generated file name");
    if (
      dirname(output) !== inputRoot ||
      names.has(entry.originalName) ||
      expectedNames.has(entry.expectedName) ||
      !/^\d{4}-\d{2}-\d{2}_[^_]+_[^/\\]+\.(md|txt)$/u.test(entry.expectedName)
    ) {
      throw new Error(`generated file name must be unique and flat: ${entry.originalName}`);
    }
    names.add(entry.originalName);
    expectedNames.add(entry.expectedName);
    await writeFile(output, entry.content, { encoding: "utf8", flag: "wx" });
  }
  await cp(source, resolve(targetRoot, "expected-rename-map.json"), {
    errorOnExist: true,
    force: false,
  });
}

async function main() {
  const argumentsAfterScript = process.argv.slice(2);
  if (argumentsAfterScript[0] === "--") argumentsAfterScript.shift();
  const [caseId, targetArgument] = argumentsAfterScript;
  if (!caseId || !targetArgument) {
    fail("usage: pnpm benchmark:materialize -- <case-id> <new-target-directory>");
    return;
  }

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const benchmarkCase = manifest.cases.find((entry) => entry.id === caseId);
  if (!benchmarkCase) {
    fail(`unknown benchmark case: ${caseId}`);
    return;
  }

  const target = resolve(process.cwd(), targetArgument);
  await assertMissing(target);
  await mkdir(target, { recursive: false });

  const materialization = benchmarkCase.materialization ?? {};
  for (const entry of materialization.copy ?? []) {
    await copyFixture(entry, target);
  }
  if (materialization.generatedFileManifest) {
    await generateFileSet(materialization.generatedFileManifest, target);
  }

  await writeFile(
    resolve(target, "BENCHMARK-CASE.json"),
    `${JSON.stringify({ benchmarkId: manifest.benchmarkId, caseId, asOf: manifest.asOf }, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  process.stdout.write(`materialized ${caseId} at ${target}\n`);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
