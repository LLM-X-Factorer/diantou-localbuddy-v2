export type ProviderId = "deepseek" | "openai";

export interface ProviderSelection {
  id: ProviderId;
  model?: string;
  baseUrl?: string;
}

export function normalizeProviderSelection(
  selection: ProviderSelection | undefined,
): ProviderSelection {
  if (selection !== undefined && (typeof selection !== "object" || Array.isArray(selection))) {
    throw new Error("provider selection must be an object");
  }
  const normalized: ProviderSelection = {
    id: selection?.id ?? "deepseek",
    model: normalizeOptionalString(selection?.model, "provider model", 200),
    baseUrl: normalizeBaseUrl(selection?.baseUrl),
  };
  if (normalized.id !== "deepseek" && normalized.id !== "openai") {
    throw new Error(`Unsupported provider: ${String(normalized.id)}`);
  }
  return normalized;
}

function normalizeBaseUrl(value: string | undefined): string | undefined {
  const normalized = normalizeOptionalString(value, "provider baseUrl", 2_000);
  if (normalized === undefined) {
    return undefined;
  }
  const url = new URL(normalized);
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("provider baseUrl must use HTTPS or loopback HTTP");
  }
  if (url.username.length > 0 || url.password.length > 0 || url.search.length > 0 || url.hash.length > 0) {
    throw new Error("provider baseUrl cannot contain credentials, query, or fragment");
  }
  return url.toString().replace(/\/$/, "");
}

function normalizeOptionalString(
  value: string | undefined,
  name: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength || /[\r\n]/.test(normalized)) {
    throw new Error(`${name} must contain between 1 and ${maxLength} single-line characters`);
  }
  return normalized;
}
