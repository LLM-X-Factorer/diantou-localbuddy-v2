import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const runNumber = process.argv[2]?.trim();
if (runNumber === undefined || !/^\d+$/.test(runNumber)) {
  throw new Error(
    "usage: node scripts/prepare-windows-canary-version.mjs <positive-run-number> <latest-stable-version-or-tag>",
  );
}
const stableInput = process.argv[3]?.trim();
const stableMatch = stableInput?.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
if (stableMatch === undefined || stableMatch === null) {
  throw new Error("latest stable version must be an X.Y.Z version or vX.Y.Z tag");
}

const packagePath = resolve("package.json");
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
const packageMatch =
  typeof packageJson.version === "string" ? packageJson.version.match(/^(\d+)\.(\d+)\.(\d+)$/) : undefined;
if (packageMatch === undefined || packageMatch === null) {
  throw new Error("package.json must contain the next stable X.Y.Z version before a Canary build");
}

const packageVersion = packageMatch.slice(1).map(Number);
const stableVersion = stableMatch.slice(1).map(Number);
const compareVersions = (left, right) => {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return 0;
};

const canaryBase =
  compareVersions(packageVersion, stableVersion) > 0
    ? packageVersion.join(".")
    : `${stableVersion[0]}.${stableVersion[1]}.${stableVersion[2] + 1}`;
const canaryVersion = `${canaryBase}-canary.${runNumber}`;
packageJson.version = canaryVersion;
await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
process.stdout.write(`${canaryVersion}\n`);
