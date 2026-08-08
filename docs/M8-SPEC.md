# M8 · MCP OAuth 2.1

## Scope

Streamable HTTP MCP servers may declare `oauth`; stdio servers continue to receive credentials only through explicitly mapped environment variables. Static bearer authentication and OAuth are mutually exclusive.

```json
{
  "id": "remote-tools",
  "transport": "streamable-http",
  "url": "https://mcp.example.com/mcp",
  "oauth": {
    "accountId": "default",
    "scopes": ["mcp:read"]
  },
  "readOnlyTools": ["search"]
}
```

`clientId` may be supplied for pre-registration. A client secret is referenced only through `clientSecretEnv`; a literal secret is never accepted in the MCP file.

## Protocol contract

- The installed MCP SDK performs RFC 9728 Protected Resource Metadata and RFC 8414 Authorization Server Metadata discovery.
- Authorization Code uses a fresh PKCE verifier and requires `S256`.
- A one-shot callback listens only on `127.0.0.1` with an ephemeral port, exact path, bounded URL/code length, five-minute timeout, and exact state validation.
- Authorization and token requests carry the canonical, most-specific MCP resource URL. Cached discovery for another resource is rejected.
- Dynamic Client Registration is used only when no current pre-registered client exists. A registration tied to an old ephemeral redirect URI is not silently reused for a new authorization flow.
- Refresh is handled by the MCP SDK. Explicit revocation calls the advertised RFC 7009 endpoint for refresh and access tokens, then deletes local tokens.

## Credential isolation

- Credentials are partitioned by SHA-256 of MCP endpoint, server id, and local account id.
- macOS uses Keychain, Linux uses Secret Service through `secret-tool`, and Windows uses Credential Manager through a bounded PowerShell P/Invoke adapter.
- Tokens, refresh tokens, client secrets, authorization codes, and PKCE verifiers never enter MCP configuration, Run Request, checkpoint, extension metadata, or event JSONL.

## UI behavior

- Desktop opens only the SDK-generated, locally validated authorization URL in the system browser.
- CLI prints the validated URL to stderr and waits for the loopback callback.
- Browser approval is separate from Agent tool approval. Successful OAuth does not grant MCP write/effect permissions.
- `pnpm mcp:revoke -- --workspace /path/to/workspace --server server-id` invokes the advertised revocation endpoint for the stored account and clears its local tokens.

## Evidence boundary

The deterministic suite includes a real loopback HTTP OAuth/MCP fixture covering discovery, DCR, redirect, state, PKCE, resource on the token exchange, persisted tokens, authenticated MCP calls, and revocation. Compatibility with a third-party production authorization server remains an external acceptance item until a real server is configured.
