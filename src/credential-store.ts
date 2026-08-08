import { execFile } from "node:child_process";

import { PlatformSecureJsonStore } from "./secure-json-store.js";

const KEYCHAIN_ACCOUNT = "default";
const PROVIDERS = {
  deepseek: {
    environmentVariable: "DEEPSEEK_API_KEY",
    keychainService: "com.diantou.localbuddy-v2.deepseek",
    displayName: "DeepSeek",
  },
  openai: {
    environmentVariable: "OPENAI_API_KEY",
    keychainService: "com.diantou.localbuddy-v2.openai",
    displayName: "OpenAI",
  },
} as const;

export type CredentialProviderId = keyof typeof PROVIDERS;

export async function resolveProviderApiKey(
  providerId: CredentialProviderId,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const provider = PROVIDERS[providerId];
  const environmentKey = environment[provider.environmentVariable]?.trim();
  if (environmentKey !== undefined && environmentKey.length > 0) {
    return environmentKey;
  }
  try {
    const stored = await new PlatformSecureJsonStore(provider.keychainService).load(KEYCHAIN_ACCOUNT);
    if (stored === undefined && process.platform === "darwin") {
      return resolveLegacyMacKey(provider.keychainService);
    }
    if (typeof stored !== "string") throw new Error("credential entry has an invalid type");
    const key = stored.trim();
    if (key.length === 0) throw new Error("keychain entry is empty");
    return key;
  } catch (error) {
    if (process.platform === "darwin") {
      try { return await resolveLegacyMacKey(provider.keychainService); } catch { /* use bounded guidance below */ }
    }
    throw new Error(
      `${provider.displayName} credential is unavailable. Run \`pnpm credentials:set -- --provider ${providerId}\` or set ${provider.environmentVariable}.`,
      { cause: error },
    );
  }
}

export async function resolveDeepSeekApiKey(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  return resolveProviderApiKey("deepseek", environment);
}

export async function storeProviderApiKey(
  providerId: CredentialProviderId,
  apiKey: string,
): Promise<void> {
  const normalized = apiKey.trim();
  if (normalized.length < 12) throw new Error("API key is unexpectedly short");
  await new PlatformSecureJsonStore(PROVIDERS[providerId].keychainService)
    .save(KEYCHAIN_ACCOUNT, normalized);
}

async function resolveLegacyMacKey(service: string): Promise<string> {
  const { stdout } = await execute("security", [
    "find-generic-password", "-a", KEYCHAIN_ACCOUNT, "-s", service, "-w",
  ]);
  const key = stdout.trim();
  if (key.length === 0) throw new Error("keychain entry is empty");
  return key;
}

export async function storeDeepSeekApiKey(apiKey: string): Promise<void> {
  return storeProviderApiKey("deepseek", apiKey);
}

function execute(command: string, args: readonly string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: "utf8" }, (error, stdout, stderr) => {
      if (error !== null) {
        reject(new Error(`${command} failed: ${stderr.trim() || error.message}`, { cause: error }));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}
