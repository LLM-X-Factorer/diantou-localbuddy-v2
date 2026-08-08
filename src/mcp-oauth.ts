import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";

import type {
  OAuthClientProvider,
  OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { OAuthTokensSchema } from "@modelcontextprotocol/sdk/shared/auth.js";

import type { McpOAuthConfig, McpStreamableHttpServerConfig } from "./extension-config.js";
import { PlatformSecureJsonStore, type SecureJsonStore } from "./secure-json-store.js";

const KEYCHAIN_SERVICE = "com.diantou.localbuddy-v2.mcp-oauth";
const CALLBACK_TIMEOUT_MS = 5 * 60_000;
const MAX_CALLBACK_URL = 8_192;

interface OAuthSecretRecord {
  version: 1;
  tokens?: OAuthTokens;
  clientInformation?: OAuthClientInformationMixed;
  verifier?: string;
  discovery?: OAuthDiscoveryState;
}

export type OAuthRedirectHandler = (url: URL) => void | Promise<void>;

export interface McpOAuthProviderOptions {
  server: McpStreamableHttpServerConfig;
  environment?: NodeJS.ProcessEnv;
  store?: SecureJsonStore;
  redirectHandler: OAuthRedirectHandler;
  callbackTimeoutMs?: number;
}

export class LocalMcpOAuthProvider implements OAuthClientProvider {
  readonly #serverUrl: URL;
  readonly #config: McpOAuthConfig;
  readonly #store: SecureJsonStore;
  readonly #account: string;
  readonly #redirectHandler: OAuthRedirectHandler;
  readonly #state = randomBytes(32).toString("base64url");
  readonly #callbackTimeoutMs: number;
  readonly #staticClientInformation?: OAuthClientInformationMixed;
  readonly #callback: LoopbackCallback;
  #mutation = Promise.resolve();

  private constructor(input: McpOAuthProviderOptions, callback: LoopbackCallback) {
    if (input.server.oauth === undefined) throw new Error("MCP OAuth configuration is missing");
    this.#serverUrl = canonicalResourceUrl(input.server.url);
    this.#config = input.server.oauth;
    this.#store = input.store ?? new PlatformSecureJsonStore(KEYCHAIN_SERVICE);
    this.#account = createHash("sha256")
      .update(`${this.#serverUrl.toString()}\0${input.server.id}\0${this.#config.accountId}`)
      .digest("hex");
    this.#redirectHandler = input.redirectHandler;
    this.#callbackTimeoutMs = input.callbackTimeoutMs ?? CALLBACK_TIMEOUT_MS;
    this.#callback = callback;
    if (this.#config.clientId !== undefined) {
      const secretName = this.#config.clientSecretEnv;
      const secret = secretName === undefined ? undefined : input.environment?.[secretName];
      if (secretName !== undefined && (secret === undefined || secret.length === 0)) {
        throw new Error(`MCP OAuth requires environment variable ${secretName}`);
      }
      this.#staticClientInformation = {
        client_id: this.#config.clientId,
        ...(secret === undefined ? {} : { client_secret: secret }),
      };
    }
  }

  static async create(input: McpOAuthProviderOptions): Promise<LocalMcpOAuthProvider> {
    const callback = await LoopbackCallback.create(input.callbackTimeoutMs ?? CALLBACK_TIMEOUT_MS);
    return new LocalMcpOAuthProvider(input, callback);
  }

  get redirectUrl(): URL {
    return this.#callback.url;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.redirectUrl.toString()],
      token_endpoint_auth_method: this.#staticClientInformation?.client_secret === undefined
        ? "none"
        : "client_secret_basic",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: "LocalBuddy V2",
      software_id: "com.diantou.localbuddy-v2",
      software_version: "0.9.0",
      ...(this.#config.scopes.length === 0 ? {} : { scope: this.#config.scopes.join(" ") }),
    };
  }

  state(): string {
    return this.#state;
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    if (this.#staticClientInformation !== undefined) return this.#staticClientInformation;
    const persisted = (await this.#record()).clientInformation;
    if (persisted === undefined) return undefined;
    if ("redirect_uris" in persisted && !persisted.redirect_uris.includes(this.redirectUrl.toString())) {
      return undefined;
    }
    return persisted;
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed): Promise<void> {
    if (this.#staticClientInformation !== undefined) return;
    await this.#update((record) => ({ ...record, clientInformation }));
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return (await this.#record()).tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    const validated = OAuthTokensSchema.parse(tokens);
    await this.#update((record) => ({ ...record, tokens: validated }));
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    validateExternalUrl(authorizationUrl);
    const redirectUri = authorizationUrl.searchParams.get("redirect_uri");
    const state = authorizationUrl.searchParams.get("state");
    const resource = authorizationUrl.searchParams.get("resource");
    if (redirectUri !== this.redirectUrl.toString()) throw new Error("OAuth redirect_uri mismatch");
    if (state !== this.#state) throw new Error("OAuth state mismatch before browser redirect");
    if (authorizationUrl.searchParams.get("code_challenge_method") !== "S256") {
      throw new Error("MCP OAuth requires PKCE S256");
    }
    if ((authorizationUrl.searchParams.get("code_challenge")?.length ?? 0) < 43) {
      throw new Error("MCP OAuth PKCE challenge is missing or too short");
    }
    if (resource === null || canonicalResourceUrl(resource).toString() !== this.#serverUrl.toString()) {
      throw new Error("OAuth resource indicator does not match the selected MCP server");
    }
    await this.#redirectHandler(new URL(authorizationUrl.toString()));
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)) throw new Error("invalid PKCE verifier");
    await this.#update((record) => ({ ...record, verifier: codeVerifier }));
  }

  async codeVerifier(): Promise<string> {
    const verifier = (await this.#record()).verifier;
    if (verifier === undefined) throw new Error("MCP OAuth PKCE verifier is unavailable");
    return verifier;
  }

  async validateResourceURL(serverUrl: string | URL, resource?: string): Promise<URL> {
    const requestedServer = canonicalResourceUrl(serverUrl);
    if (requestedServer.toString() !== this.#serverUrl.toString()) {
      throw new Error("MCP OAuth server identity changed");
    }
    const selected = canonicalResourceUrl(resource ?? requestedServer);
    if (selected.toString() !== this.#serverUrl.toString()) {
      throw new Error("MCP OAuth resource metadata targets a different resource");
    }
    return selected;
  }

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): Promise<void> {
    if (scope === "all") {
      await this.#store.delete(this.#account);
      return;
    }
    await this.#update((record) => {
      const next = { ...record };
      if (scope === "client") delete next.clientInformation;
      if (scope === "tokens") delete next.tokens;
      if (scope === "verifier") delete next.verifier;
      if (scope === "discovery") delete next.discovery;
      return next;
    });
  }

  async saveDiscoveryState(discovery: OAuthDiscoveryState): Promise<void> {
    validateDiscovery(discovery, this.#serverUrl);
    await this.#update((record) => ({ ...record, discovery }));
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    const discovery = (await this.#record()).discovery;
    if (discovery !== undefined) validateDiscovery(discovery, this.#serverUrl);
    return discovery;
  }

  waitForAuthorizationCode(signal?: AbortSignal): Promise<string> {
    return this.#callback.waitForCode(this.#state, this.#callbackTimeoutMs, signal);
  }

  async revoke(fetchFn: typeof fetch = fetch): Promise<void> {
    const record = await this.#record();
    const serverMetadata = record.discovery?.authorizationServerMetadata;
    const endpoint = serverMetadata !== undefined
      && "revocation_endpoint" in serverMetadata
      && typeof serverMetadata.revocation_endpoint === "string"
      ? serverMetadata.revocation_endpoint
      : undefined;
    if (record.tokens === undefined) return;
    if (endpoint === undefined) throw new Error("authorization server does not advertise token revocation");
    validateExternalUrl(new URL(endpoint));
    const client = this.#staticClientInformation ?? record.clientInformation;
    if (client === undefined) throw new Error("OAuth client information is unavailable for revocation");
    const tokens = [
      [record.tokens.refresh_token, "refresh_token"],
      [record.tokens.access_token, "access_token"],
    ] as const;
    for (const [token, hint] of tokens) {
      if (token === undefined) continue;
      const body = new URLSearchParams({ token, token_type_hint: hint });
      const headers = new Headers({ "content-type": "application/x-www-form-urlencoded" });
      if (client.client_secret !== undefined) {
        headers.set("authorization", `Basic ${Buffer.from(`${client.client_id}:${client.client_secret}`).toString("base64")}`);
      } else {
        body.set("client_id", client.client_id);
      }
      const response = await fetchFn(endpoint, { method: "POST", headers, body });
      await response.body?.cancel();
      if (!response.ok) throw new Error(`OAuth token revocation failed with HTTP ${response.status}`);
    }
    await this.invalidateCredentials("tokens");
  }

  async close(): Promise<void> {
    await this.#callback.close();
  }

  async #record(): Promise<OAuthSecretRecord> {
    const value = await this.#store.load(this.#account);
    return validateRecord(value);
  }

  async #update(mutate: (record: OAuthSecretRecord) => OAuthSecretRecord): Promise<void> {
    const operation = this.#mutation.then(async () => {
      const next = mutate(await this.#record());
      await this.#store.save(this.#account, next);
    });
    this.#mutation = operation.catch(() => undefined);
    await operation;
  }
}

class LoopbackCallback {
  readonly url: URL;
  readonly #server: Server;
  #settled = false;
  #code?: string;
  #state?: string;
  #error?: Error;
  #waiters: Array<() => void> = [];

  private constructor(server: Server, port: number) {
    this.#server = server;
    this.url = new URL(`http://127.0.0.1:${port}/oauth/callback`);
    server.on("request", (request, response) => {
      if ((request.url?.length ?? 0) > MAX_CALLBACK_URL) {
        response.writeHead(414).end("Request too large");
        return;
      }
      const incoming = new URL(request.url ?? "/", this.url);
      if (request.method !== "GET" || incoming.pathname !== this.url.pathname) {
        response.writeHead(404).end("Not found");
        return;
      }
      if (this.#settled) {
        response.writeHead(409).end("Authorization callback already received");
        return;
      }
      this.#settled = true;
      const error = incoming.searchParams.get("error");
      const code = incoming.searchParams.get("code");
      this.#state = incoming.searchParams.get("state") ?? undefined;
      if (error !== null) {
        this.#error = new Error(`OAuth authorization failed: ${error.slice(0, 200)}`);
      } else if (code === null || code.length < 1 || code.length > 4_096) {
        this.#error = new Error("OAuth callback is missing a bounded authorization code");
      } else {
        this.#code = code;
      }
      response.writeHead(this.#error === undefined ? 200 : 400, {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      }).end(this.#error === undefined ? "LocalBuddy authorization completed. You may close this window." : "LocalBuddy authorization failed.");
      for (const wake of this.#waiters.splice(0)) wake();
    });
  }

  static async create(timeoutMs: number): Promise<LoopbackCallback> {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > CALLBACK_TIMEOUT_MS) {
      throw new Error("OAuth callback timeout is out of bounds");
    }
    const server = createServer();
    server.unref();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("OAuth callback address unavailable");
    return new LoopbackCallback(server, address.port);
  }

  async waitForCode(expectedState: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
    if (!this.#settled) {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timeout);
          signal?.removeEventListener("abort", onAbort);
          const index = this.#waiters.indexOf(wake);
          if (index >= 0) this.#waiters.splice(index, 1);
        };
        const wake = () => { cleanup(); resolve(); };
        const timeout = setTimeout(() => { cleanup(); reject(new Error("OAuth callback timed out")); }, timeoutMs);
        timeout.unref();
        const onAbort = () => { cleanup(); reject(new Error("OAuth callback was cancelled")); };
        signal?.addEventListener("abort", onAbort, { once: true });
        this.#waiters.push(wake);
      });
    }
    if (this.#state !== expectedState) throw new Error("OAuth callback state mismatch");
    if (this.#error !== undefined) throw this.#error;
    if (this.#code === undefined) throw new Error("OAuth callback code is unavailable");
    return this.#code;
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.#server.close((error) => error === undefined ? resolve() : reject(error));
    });
  }
}

function canonicalResourceUrl(input: string | URL): URL {
  const url = new URL(input);
  validateExternalUrl(url);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("OAuth resource URL cannot contain credentials, query, or fragment");
  }
  return url;
}

function validateExternalUrl(url: URL): void {
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("OAuth endpoints must use HTTPS or loopback HTTP");
  }
  if (url.username || url.password) throw new Error("OAuth endpoint cannot contain URL credentials");
}

function validateDiscovery(discovery: OAuthDiscoveryState, serverUrl: URL): void {
  validateExternalUrl(new URL(discovery.authorizationServerUrl));
  if (discovery.resourceMetadata?.resource !== undefined) {
    if (canonicalResourceUrl(discovery.resourceMetadata.resource).toString() !== serverUrl.toString()) {
      throw new Error("cached OAuth discovery belongs to another MCP resource");
    }
  }
  const metadata = discovery.authorizationServerMetadata;
  if (metadata !== undefined) {
    validateExternalUrl(new URL(metadata.issuer));
    validateExternalUrl(new URL(metadata.authorization_endpoint));
    validateExternalUrl(new URL(metadata.token_endpoint));
    if (metadata.registration_endpoint !== undefined) validateExternalUrl(new URL(metadata.registration_endpoint));
    if ("revocation_endpoint" in metadata && typeof metadata.revocation_endpoint === "string") {
      validateExternalUrl(new URL(metadata.revocation_endpoint));
    }
    if (metadata.code_challenge_methods_supported !== undefined
      && !metadata.code_challenge_methods_supported.includes("S256")) {
      throw new Error("authorization server does not advertise PKCE S256");
    }
  }
}

function validateRecord(value: unknown): OAuthSecretRecord {
  if (value === undefined) return { version: 1 };
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("stored MCP OAuth credential is invalid");
  }
  const record = value as OAuthSecretRecord;
  if (record.version !== 1) throw new Error("stored MCP OAuth credential version is unsupported");
  if (record.tokens !== undefined) OAuthTokensSchema.parse(record.tokens);
  if (record.verifier !== undefined && !/^[A-Za-z0-9._~-]{43,128}$/.test(record.verifier)) {
    throw new Error("stored MCP OAuth verifier is invalid");
  }
  return record;
}
