import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import { connectMcpServers } from "../src/mcp-client.js";
import { LocalMcpOAuthProvider } from "../src/mcp-oauth.js";
import type { SecureJsonStore } from "../src/secure-json-store.js";

class MemorySecureStore implements SecureJsonStore {
  readonly values = new Map<string, unknown>();
  async load(account: string): Promise<unknown | undefined> { return structuredClone(this.values.get(account)); }
  async save(account: string, value: unknown): Promise<void> { this.values.set(account, structuredClone(value)); }
  async delete(account: string): Promise<void> { this.values.delete(account); }
}

test("OAuth provider enforces state, PKCE, resource binding, secure persistence, and revocation", async (context) => {
  const store = new MemorySecureStore();
  let redirected: URL | undefined;
  const revocations: URLSearchParams[] = [];
  const server = createServer(async (request, response) => {
    if (request.url === "/revoke" && request.method === "POST") {
      const body = await readBody(request);
      revocations.push(new URLSearchParams(body));
      response.writeHead(200).end();
      return;
    }
    response.writeHead(404).end();
  });
  await listen(server);
  context.after(() => close(server));
  const origin = serverOrigin(server);
  const provider = await LocalMcpOAuthProvider.create({
    server: {
      id: "fixture",
      transport: "streamable-http",
      url: `${origin}/mcp`,
      oauth: { accountId: "alice", scopes: ["mcp:read"], clientId: "client-1" },
      readOnlyTools: [],
    },
    store,
    redirectHandler(url) { redirected = url; },
  });
  context.after(() => provider.close());
  await provider.saveCodeVerifier("a".repeat(43));
  await provider.saveTokens({ access_token: "access", refresh_token: "refresh", token_type: "Bearer" });
  await provider.saveDiscoveryState({
    authorizationServerUrl: origin,
    resourceMetadata: { resource: `${origin}/mcp`, authorization_servers: [origin] },
    authorizationServerMetadata: {
      issuer: origin,
      authorization_endpoint: `${origin}/authorize`,
      token_endpoint: `${origin}/token`,
      revocation_endpoint: `${origin}/revoke`,
      response_types_supported: ["code"],
      code_challenge_methods_supported: ["S256"],
    },
  });
  const authorization = new URL(`${origin}/authorize`);
  authorization.searchParams.set("redirect_uri", provider.redirectUrl.toString());
  authorization.searchParams.set("state", provider.state());
  authorization.searchParams.set("resource", `${origin}/mcp`);
  authorization.searchParams.set("code_challenge_method", "S256");
  authorization.searchParams.set("code_challenge", "b".repeat(43));
  await provider.redirectToAuthorization(authorization);
  assert.equal(redirected?.toString(), authorization.toString());
  const callback = new URL(provider.redirectUrl);
  callback.searchParams.set("code", "code-1");
  callback.searchParams.set("state", provider.state());
  assert.equal((await fetch(callback)).status, 200);
  assert.equal(await provider.waitForAuthorizationCode(), "code-1");
  await provider.revoke();
  assert.deepEqual(revocations.map((value) => value.get("token_type_hint")), ["refresh_token", "access_token"]);
  assert.equal(await provider.tokens(), undefined);
  assert.ok(store.values.size === 1);
});

test("connectMcpServers completes discovered OAuth Authorization Code plus PKCE flow", async (context) => {
  const store = new MemorySecureStore();
  let origin = "";
  let resource = "";
  let codeChallenge = "";
  let tokenRequests = 0;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", origin);
    if (url.pathname === "/.well-known/oauth-protected-resource/mcp") {
      json(response, 200, { resource, authorization_servers: [origin], scopes_supported: ["mcp:read"] });
      return;
    }
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      json(response, 200, {
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`,
        revocation_endpoint: `${origin}/revoke`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        token_endpoint_auth_methods_supported: ["none"],
        code_challenge_methods_supported: ["S256"],
      });
      return;
    }
    if (url.pathname === "/register" && request.method === "POST") {
      const metadata = JSON.parse(await readBody(request)) as { redirect_uris: string[] };
      json(response, 201, { ...metadata, client_id: "dynamic-client" });
      return;
    }
    if (url.pathname === "/authorize") {
      assert.equal(url.searchParams.get("resource"), resource);
      assert.equal(url.searchParams.get("code_challenge_method"), "S256");
      codeChallenge = url.searchParams.get("code_challenge") ?? "";
      const callback = new URL(url.searchParams.get("redirect_uri") ?? "");
      callback.searchParams.set("code", "authorization-code");
      callback.searchParams.set("state", url.searchParams.get("state") ?? "");
      response.writeHead(302, { location: callback.toString() }).end();
      return;
    }
    if (url.pathname === "/token" && request.method === "POST") {
      tokenRequests += 1;
      const body = new URLSearchParams(await readBody(request));
      assert.equal(body.get("resource"), resource);
      assert.equal(body.get("client_id"), "dynamic-client");
      assert.equal(
        createHash("sha256").update(body.get("code_verifier") ?? "").digest("base64url"),
        codeChallenge,
      );
      json(response, 200, { access_token: "oauth-access", refresh_token: "oauth-refresh", token_type: "Bearer" });
      return;
    }
    if (url.pathname === "/mcp") {
      if (request.headers.authorization !== "Bearer oauth-access") {
        response.writeHead(401, {
          "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
        }).end("unauthorized");
        return;
      }
      const mcp = new McpServer({ name: "oauth-mcp", version: "1.0.0" });
      mcp.registerTool("oauth-echo", {
        description: "OAuth fixture",
        inputSchema: { text: z.string() },
      }, async ({ text }) => ({ content: [{ type: "text", text: `oauth:${text}` }] }));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await mcp.connect(transport);
      response.on("close", () => { void transport.close(); void mcp.close(); });
      await transport.handleRequest(request, response);
      return;
    }
    response.writeHead(404).end();
  });
  await listen(server);
  context.after(() => close(server));
  origin = serverOrigin(server);
  resource = `${origin}/mcp`;

  const bridge = await connectMcpServers([{
    id: "oauth-remote",
    transport: "streamable-http",
    url: resource,
    oauth: { accountId: "default", scopes: ["mcp:read"] },
    readOnlyTools: ["oauth-echo"],
  }], process.env, {
    oauthStore: store,
    async oauthRedirectHandler(url) {
      const response = await fetch(url);
      await response.body?.cancel();
      assert.equal(response.status, 200);
    },
  });
  try {
    assert.equal(tokenRequests, 1);
    const echo = bridge.tools[0];
    const result = await echo?.execute(echo.parse({ text: "verified" }), {
      runId: "run-oauth",
      taskId: "task-oauth",
      agent: { id: "worker", role: "worker", instructions: "test", capabilities: ["worker"], maxParallelTasks: 1 },
    });
    assert.match(JSON.stringify(result), /oauth:verified/);
    assert.doesNotMatch(JSON.stringify([...store.values.values()]), /authorization-code/);
  } finally {
    await bridge.close();
  }
});

async function readBody(request: import("node:http").IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function json(response: import("node:http").ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
}

function listen(server: import("node:http").Server): Promise<void> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function close(server: import("node:http").Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
}

function serverOrigin(server: import("node:http").Server): string {
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("server address unavailable");
  return `http://127.0.0.1:${address.port}`;
}
