#!/usr/bin/env node

import { resolve } from "node:path";

import { defaultCoordinationRoot } from "./process-shared-provider.js";
import { fetchAndStageUpdate } from "./update-manifest.js";

const options = parse(process.argv.slice(2));
const publicKeyBase64 = options.get("public-key") ?? process.env.LOCALBUDDY_UPDATE_PUBLIC_KEY_BASE64;
if (publicKeyBase64 === undefined) throw new Error("--public-key or LOCALBUDDY_UPDATE_PUBLIC_KEY_BASE64 is required");
const result = await fetchAndStageUpdate({
  manifestUrl: required(options, "manifest-url"),
  publicKeyBase64,
  currentVersion: options.get("current-version") ?? "0.9.0",
  stageRoot: resolve(options.get("stage-root") ?? defaultCoordinationRoot(), "updates"),
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

function parse(args: readonly string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (name === undefined || !name.startsWith("--") || value === undefined) throw new Error("update options must be --name value pairs");
    result.set(name.slice(2), value);
  }
  return result;
}

function required(options: Map<string, string>, name: string): string {
  const value = options.get(name);
  if (value === undefined) throw new Error(`--${name} is required`);
  return value;
}
