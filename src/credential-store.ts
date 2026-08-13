import { execFile } from "node:child_process";

import {
  PlatformSecureJsonStore,
  type SecureJsonStore,
} from "./secure-json-store.js";

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
export type ProviderCredentialSource = "environment" | "system" | "none";

export interface ProviderCredentialStatus {
  available: boolean;
  source: ProviderCredentialSource;
}

export async function resolveProviderApiKey(
  providerId: CredentialProviderId,
  environment: NodeJS.ProcessEnv = process.env,
  store?: SecureJsonStore,
): Promise<string> {
  const provider = PROVIDERS[providerId];
  const environmentKey = environment[provider.environmentVariable]?.trim();
  if (environmentKey !== undefined && environmentKey.length > 0) {
    return environmentKey;
  }
  try {
    const key = await loadStoredProviderApiKey(providerId, store);
    if (key !== undefined) return key;
    throw new Error("credential entry is missing");
  } catch (error) {
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

export async function hasProviderApiKey(
  providerId: CredentialProviderId,
  environment: NodeJS.ProcessEnv = process.env,
  store?: SecureJsonStore,
): Promise<boolean> {
  return (await inspectProviderCredential(providerId, environment, store)).available;
}

export async function inspectProviderCredential(
  providerId: CredentialProviderId,
  environment: NodeJS.ProcessEnv = process.env,
  store?: SecureJsonStore,
): Promise<ProviderCredentialStatus> {
  const environmentKey = environment[PROVIDERS[providerId].environmentVariable]?.trim();
  if (environmentKey !== undefined && environmentKey.length > 0) {
    return { available: true, source: "environment" };
  }
  try {
    const key = await loadStoredProviderApiKey(providerId, store);
    return key === undefined
      ? { available: false, source: "none" }
      : { available: true, source: "system" };
  } catch {
    return { available: false, source: "none" };
  }
}

export async function storeProviderApiKey(
  providerId: CredentialProviderId,
  apiKey: string,
  store?: SecureJsonStore,
): Promise<void> {
  const normalized = apiKey.trim();
  if (normalized.length < 12) throw new Error("API key is unexpectedly short");
  await (store ?? new PlatformSecureJsonStore(PROVIDERS[providerId].keychainService))
    .save(KEYCHAIN_ACCOUNT, normalized);
}

export async function deleteProviderApiKey(
  providerId: CredentialProviderId,
  store?: SecureJsonStore,
): Promise<void> {
  await (store ?? new PlatformSecureJsonStore(PROVIDERS[providerId].keychainService))
    .delete(KEYCHAIN_ACCOUNT);
}

async function loadStoredProviderApiKey(
  providerId: CredentialProviderId,
  store?: SecureJsonStore,
): Promise<string | undefined> {
  const provider = PROVIDERS[providerId];
  const activeStore = store ?? new PlatformSecureJsonStore(provider.keychainService);
  try {
    const stored = await activeStore.load(KEYCHAIN_ACCOUNT);
    if (stored === undefined) {
      if (store === undefined && process.platform === "darwin") {
        return resolveLegacyMacKey(provider.keychainService);
      }
      return undefined;
    }
    if (typeof stored !== "string") throw new Error("credential entry has an invalid type");
    const key = stored.trim();
    if (key.length === 0) throw new Error("keychain entry is empty");
    return key;
  } catch (error) {
    if (store === undefined && process.platform === "darwin") {
      try { return await resolveLegacyMacKey(provider.keychainService); } catch { /* preserve original error */ }
    }
    throw error;
  }
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
