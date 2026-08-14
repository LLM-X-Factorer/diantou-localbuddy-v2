import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8"));
const version = process.env.LOCALBUDDY_BUILD_VERSION?.trim() || packageJson.version;
const channel = process.env.LOCALBUDDY_BUILD_CHANNEL?.trim() || "dev";
const sha = process.env.LOCALBUDDY_BUILD_SHA?.trim() || currentGitSha();
const dirty = process.env.LOCALBUDDY_BUILD_SHA === undefined && currentGitDirty();

if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error("LocalBuddy build version is invalid");
}
if (!/^(dev|canary|beta|stable)$/.test(channel)) {
  throw new Error("LOCALBUDDY_BUILD_CHANNEL must be dev, canary, beta, or stable");
}
if (!/^[a-f0-9]{7,40}$/.test(sha)) {
  throw new Error("LocalBuddy build SHA is invalid");
}

await mkdir(resolve("dist"), { recursive: true });
await writeFile(resolve("dist", "build-metadata.json"), `${JSON.stringify({
  version,
  channel,
  sha,
  dirty,
}, null, 2)}\n`, "utf8");

function currentGitSha() {
  return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

function currentGitDirty() {
  return execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0;
}
