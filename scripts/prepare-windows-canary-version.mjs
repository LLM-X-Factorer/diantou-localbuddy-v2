import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const runNumber = process.argv[2]?.trim();
if (runNumber === undefined || !/^\d+$/.test(runNumber)) {
  throw new Error("usage: node scripts/prepare-windows-canary-version.mjs <positive-run-number>");
}

const packagePath = resolve("package.json");
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
if (typeof packageJson.version !== "string" || !/^\d+\.\d+\.\d+$/.test(packageJson.version)) {
  throw new Error("package.json must contain the next stable X.Y.Z version before a Canary build");
}
const canaryVersion = `${packageJson.version}-canary.${runNumber}`;
packageJson.version = canaryVersion;
await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
process.stdout.write(`${canaryVersion}\n`);
