import { execFile } from "node:child_process";
import { cp, mkdir, readFile, rm, symlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const packageMetadata = JSON.parse(await readFile(resolve("package.json"), "utf8"));
const packageVersion = packageMetadata.version;
if (typeof packageVersion !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageVersion)) {
  throw new Error("package.json contains an invalid package version");
}
const appPath = resolve(".localbuddy", "forge-out", "LocalBuddy-darwin-arm64", "LocalBuddy.app");
const stagingRoot = resolve(".localbuddy", "dmg-stage");
const outputPath = resolve(
  ".localbuddy",
  "forge-out",
  "make",
  `LocalBuddy-${packageVersion}-arm64.dmg`,
);

await rm(stagingRoot, { recursive: true, force: true });
await mkdir(stagingRoot, { recursive: true });
await cp(appPath, resolve(stagingRoot, "LocalBuddy.app"), {
  recursive: true,
  verbatimSymlinks: true,
});
await symlink("/Applications", resolve(stagingRoot, "Applications"));
await mkdir(dirname(outputPath), { recursive: true });
await execFileAsync("hdiutil", [
  "create",
  "-volname", "LocalBuddy",
  "-srcfolder", stagingRoot,
  "-ov",
  "-format", "ULFO",
  outputPath,
]);
await rm(stagingRoot, { recursive: true, force: true });
process.stdout.write(`${outputPath}\n`);
