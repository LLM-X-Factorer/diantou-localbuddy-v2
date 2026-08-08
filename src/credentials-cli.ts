#!/usr/bin/env node

import {
  storeProviderApiKey,
  type CredentialProviderId,
} from "./credential-store.js";

const provider = parseProvider(process.argv.slice(2));
process.stdout.write(`Paste the ${provider === "deepseek" ? "DeepSeek" : "OpenAI"} API key and press Enter. It will be stored in the operating system credential vault: `);
process.stdin.setEncoding("utf8");
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}
let input = "";
process.stdin.on("data", (chunk: string) => {
  if (chunk === "\u0003") {
    process.stdout.write("\n");
    process.exit(130);
  }
  const newlineIndex = chunk.search(/[\r\n]/);
  input += newlineIndex < 0 ? chunk : chunk.slice(0, newlineIndex);
  if (newlineIndex < 0) {
    return;
  }
  process.stdin.setRawMode?.(false);
  process.stdin.pause();
  process.stdout.write("\n");
  storeProviderApiKey(provider, input)
    .then(() => {
      process.stdout.write("Credential stored.\n");
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
});

function parseProvider(args: readonly string[]): CredentialProviderId {
  if (args.length === 0) return "deepseek";
  if (args.length === 2 && args[0] === "--provider" && (args[1] === "deepseek" || args[1] === "openai")) {
    return args[1];
  }
  throw new Error("Usage: pnpm credentials:set -- --provider deepseek|openai");
}
