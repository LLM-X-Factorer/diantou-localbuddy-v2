import { execFile } from "node:child_process";
import { cp, mkdir, rm, symlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const appPath = resolve(".localbuddy", "forge-out", "LocalBuddy-darwin-arm64", "LocalBuddy.app");
const stagingRoot = resolve(".localbuddy", "dmg-stage");
const outputPath = resolve(
  ".localbuddy",
  "forge-out",
  "make",
  "LocalBuddy-0.9.0-arm64.dmg",
);

await rm(stagingRoot, { recursive: true, force: true });
await mkdir(stagingRoot, { recursive: true });
await cp(appPath, resolve(stagingRoot, "LocalBuddy.app"), { recursive: true });
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
