import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const browserRoot = resolve(".localbuddy", "package-cache", "ms-playwright");
await mkdir(browserRoot, { recursive: true });

const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const child = spawn(
  command,
  ["exec", "playwright", "install", "--only-shell", "chromium"],
  {
    stdio: "inherit",
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browserRoot },
  },
);

const exitCode = await new Promise((resolvePromise, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (signal !== null) reject(new Error(`Playwright installation ended with ${signal}`));
    else resolvePromise(code ?? 1);
  });
});
if (exitCode !== 0) {
  throw new Error(`Playwright installation failed with exit code ${exitCode}`);
}
