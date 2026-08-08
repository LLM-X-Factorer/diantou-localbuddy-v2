# M8 Validation Record

Date: 2026-08-08.

## Local protocol fixture

The suite starts real loopback HTTP endpoints and exercises:

1. MCP returns `401` with Protected Resource Metadata.
2. The client discovers RFC 9728 resource metadata and RFC 8414 authorization metadata.
3. Dynamic Client Registration returns a client scoped to the ephemeral redirect URI.
4. The authorization request carries exact state, PKCE `S256`, and the canonical MCP resource.
5. The one-shot `127.0.0.1` callback validates state and returns the bounded authorization code.
6. The token endpoint verifies the PKCE verifier and `resource` before issuing access/refresh tokens.
7. The reconnected Streamable HTTP client discovers and calls an authenticated MCP tool.
8. The revocation fixture receives refresh and access tokens at the advertised endpoint, after which the secure store no longer returns tokens.

Additional tests reject mixed static Bearer/OAuth configuration, invalid scopes, mismatched resources, unsafe URLs, invalid PKCE, untrusted state, and malformed secure records.

No token, authorization code, verifier, client secret, or test secret appears in Run events or checkpoints.

## External acceptance

No third-party production OAuth service/account was supplied. Provider-specific login UI, consent policy, DCR policy and token lifetime behavior remain unclaimed until a real service is configured.
