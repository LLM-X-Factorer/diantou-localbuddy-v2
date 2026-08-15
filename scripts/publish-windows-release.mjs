import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const CHECKSUM_FILE = "SHA256SUMS-windows.txt";

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function runGitHub(args, { allowFailure = false, quiet = false } = {}) {
  const result = spawnSync("gh", args, {
    shell: false,
    stdio: quiet ? "ignore" : "inherit",
  });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    throw new Error(`gh ${args.slice(0, 2).join(" ")} failed with exit code ${result.status ?? "unknown"}`);
  }
  return result.status === 0;
}

export async function verifyReleaseCandidate({ assetsDirectory, packagePath, tag }) {
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
    throw new Error("package.json does not contain a release version");
  }
  const expectedTag = `v${packageJson.version}`;
  if (tag !== expectedTag) {
    throw new Error(`Tag ${tag} does not match package version ${expectedTag}`);
  }

  const checksumPath = resolve(assetsDirectory, CHECKSUM_FILE);
  const checksumText = await readFile(checksumPath, "utf8");
  if (!checksumText.endsWith("\n") || checksumText.includes("\r")) {
    throw new Error("Windows checksum manifest must use UTF-8 LF lines");
  }
  const entries = checksumText.trimEnd().split("\n").map((line) => {
    const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
    if (match === null) throw new Error("Malformed Windows checksum line");
    const [, hash, name] = match;
    if (basename(name) !== name
        || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(name)
        || name === "."
        || name === ".."
        || name === CHECKSUM_FILE) {
      throw new Error(`Unsafe Windows release asset name: ${name}`);
    }
    return { hash, name };
  });
  if (entries.length < 4 || new Set(entries.map(({ name }) => name)).size !== entries.length) {
    throw new Error("Windows checksum manifest is incomplete or contains duplicates");
  }

  const names = entries.map(({ name }) => name);
  if (names.filter((name) => name.endsWith("-Setup.exe")).length !== 1
      || names.filter((name) => name.endsWith(".zip")).length !== 1
      || names.filter((name) => name.endsWith("-full.nupkg")).length !== 1
      || names.filter((name) => name === "RELEASES").length !== 1) {
    throw new Error("Expected exactly one Setup, portable ZIP, full nupkg, and RELEASES file");
  }

  const expectedFiles = [...names, CHECKSUM_FILE].sort();
  const actualFiles = (await readdir(assetsDirectory)).sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error("Release directory contains missing, unhashed, or unexpected files");
  }

  for (const entry of entries) {
    const assetPath = resolve(assetsDirectory, entry.name);
    const metadata = await lstat(assetPath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size === 0) {
      throw new Error(`Release asset is not a non-empty regular file: ${entry.name}`);
    }
    const actualHash = await sha256(assetPath);
    if (actualHash !== entry.hash) throw new Error(`Checksum mismatch for ${entry.name}`);
  }

  return {
    packageVersion: packageJson.version,
    assetPaths: expectedFiles.map((name) => resolve(assetsDirectory, name)),
  };
}

async function main() {
  const verifyOnly = process.argv[2] === "--verify-only";
  if (process.argv.length > (verifyOnly ? 3 : 2)) throw new Error("Unexpected publish arguments");
  const tag = process.env.GITHUB_REF_NAME;
  if (typeof tag !== "string" || tag.length === 0) throw new Error("GITHUB_REF_NAME is required");
  const candidate = await verifyReleaseCandidate({
    assetsDirectory: resolve("release-assets"),
    packagePath: resolve("package.json"),
    tag,
  });
  process.stdout.write(`Verified ${candidate.assetPaths.length} Windows release files for ${tag}.\n`);
  if (verifyOnly) return;

  const repository = process.env.GITHUB_REPOSITORY;
  if (typeof repository !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("GITHUB_REPOSITORY is required");
  }
  if (!runGitHub(["release", "view", tag, "--repo", repository], { allowFailure: true, quiet: true })) {
    const createArgs = [
      "release", "create", tag, "--repo", repository,
      "--verify-tag", "--generate-notes", "--title", `LocalBuddy ${tag}`,
    ];
    if (tag.includes("-")) createArgs.push("--prerelease");
    runGitHub(createArgs);
  }
  runGitHub(["release", "upload", tag, "--repo", repository, ...candidate.assetPaths, "--clobber"]);
  process.stdout.write(`Published LocalBuddy ${candidate.packageVersion} Windows assets to GitHub Release ${tag}.\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
