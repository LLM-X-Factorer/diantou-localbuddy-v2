import { resolveProviderApiKey } from "./credential-store.js";
import {
  normalizeProviderSelection,
  type ProviderId,
  type ProviderSelection,
} from "./provider-config.js";

const DEFAULT_BASE_URLS: Record<ProviderId, string> = {
  deepseek: "https://api.deepseek.com",
  openai: "https://api.openai.com/v1",
};

export interface ProviderConnectionResult {
  providerId: ProviderId;
  verified: true;
}

export async function verifyProviderConnection(
  input: ProviderSelection,
  environment: NodeJS.ProcessEnv = process.env,
  fetchImplementation: typeof fetch = globalThis.fetch,
  timeoutMs = 10_000,
): Promise<ProviderConnectionResult> {
  const selection = normalizeProviderSelection(input);
  const apiKey = await resolveProviderApiKey(selection.id, environment);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const label = selection.id === "deepseek" ? "DeepSeek" : "OpenAI";
  try {
    const response = await fetchImplementation(
      `${selection.baseUrl ?? DEFAULT_BASE_URLS[selection.id]}/models`,
      {
        method: "GET",
        headers: { authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      },
    );
    const status = response.status;
    try {
      await response.body?.cancel();
    } catch {
      // Connection verification never consumes or reports the provider body.
    }
    if (!response.ok) {
      throw new Error(`${label} connection check failed (HTTP ${status})`);
    }
    return { providerId: selection.id, verified: true };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`${label} connection check failed`)) {
      throw error;
    }
    if (controller.signal.aborted) {
      throw new Error(`${label} connection check timed out`);
    }
    throw new Error(`${label} connection check failed: network request failed`);
  } finally {
    clearTimeout(timeout);
  }
}
