import {
  resolveProviderApiKey,
} from "./credential-store.js";
import { DeepSeekProvider } from "./deepseek-provider.js";
import { OpenAIProvider } from "./openai-provider.js";
import type { ModelProvider } from "./provider.js";
import { ProcessSharedProvider } from "./process-shared-provider.js";
import {
  normalizeProviderSelection,
  type ProviderSelection,
} from "./provider-config.js";

export async function createConfiguredProvider(
  input: ProviderSelection | undefined,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ModelProvider> {
  const selection = normalizeProviderSelection(input);
  const resolved = normalizeProviderSelection({
    ...selection,
    model: selection.model ?? (selection.id === "openai" ? environment.OPENAI_MODEL : environment.DEEPSEEK_MODEL),
    baseUrl: selection.baseUrl ?? (selection.id === "openai" ? environment.OPENAI_BASE_URL : environment.DEEPSEEK_BASE_URL),
  });
  const apiKey = await resolveProviderApiKey(resolved.id, environment);
  let provider: ModelProvider;
  if (resolved.id === "openai") {
    provider = new OpenAIProvider({
      apiKey,
      model: resolved.model,
      baseUrl: resolved.baseUrl,
    });
  } else {
    provider = new DeepSeekProvider({
      apiKey,
      model: resolved.model,
      baseUrl: resolved.baseUrl,
    });
  }
  if (environment !== process.env || environment.LOCALBUDDY_SHARED_COORDINATION === "0") {
    return provider;
  }
  return new ProcessSharedProvider({
    provider,
    providerId: resolved.id,
    stateRoot: environment.LOCALBUDDY_COORDINATION_ROOT,
    maxConcurrentRequests: parseIntegerEnvironment(
      environment.LOCALBUDDY_GLOBAL_MODEL_CONCURRENCY,
      3,
      "LOCALBUDDY_GLOBAL_MODEL_CONCURRENCY",
    ),
    minimumIntervalMs: parseIntegerEnvironment(
      environment.LOCALBUDDY_PROVIDER_MIN_INTERVAL_MS,
      0,
      "LOCALBUDDY_PROVIDER_MIN_INTERVAL_MS",
    ),
    dailyTokenBudget: parseIntegerEnvironment(
      environment.LOCALBUDDY_DAILY_TOKEN_BUDGET,
      0,
      "LOCALBUDDY_DAILY_TOKEN_BUDGET",
    ),
  });
}

function parseIntegerEnvironment(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a non-negative integer`);
  return Number.parseInt(value, 10);
}
