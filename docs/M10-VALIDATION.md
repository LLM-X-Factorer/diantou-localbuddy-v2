# M10 Validation Record

Date: 2026-08-08, macOS arm64 host.

## Deterministic baseline

- `pnpm check`: Core/Main/Preload/Renderer TypeScript passed; 99/99 tests passed.
- `pnpm audit --audit-level high`: no known vulnerabilities.
- `pnpm build`: production Renderer and Core/Main/Preload builds passed.
- Renderer output: HTML 0.65 kB, CSS 18.27 kB, JS 214.35 kB.

Regression coverage proves:

- v3 Run Requests persist the selected trust profile; v2 Requests load as `balanced` without rewriting the old file;
- `automation` denies `external.effect` even if a Run attempts to preauthorize it;
- a combined patch is readable inline only after repository/run/path/hash validation;
- a tampered combined patch is rejected before display;
- diagnostic output omits the goal body and full workspace path while retaining counts, hashes and lifecycle state;
- every Main IPC channel is mirrored by the sandboxed Preload;
- the API-key input is a transient password field and Renderer uses no web storage.

## Product surface

- Desktop accepts DeepSeek/OpenAI plus optional model and base URL.
- Main writes a newly entered API key directly to the platform credential vault and returns only `{ providerId, stored: true }`.
- Every Run selects `strict`, `balanced`, or `automation`; the profile is recorded in `run.started` and `run-request.json`.
- Integration review retrieves only the registered combined patch, verifies SHA-256, and returns at most 400,000 characters to Renderer.
- Native diagnostic export writes mode `0600` on macOS/Linux and contains no goal text, model content, tool arguments, credentials, artifact bodies, or absolute workspace path.

## Rebuilt macOS internal package

`pnpm make:mac` and `pnpm verify:mac-package` passed against the M10 source tree.

| Artifact | Bytes | SHA-256 | Verification |
|---|---:|---|---|
| `LocalBuddy-darwin-arm64-0.9.0.zip` | 219,095,502 | `2a3d5e3e633ab251a6e6e8586897aedd0fb31191292f86c95d970e15494083d4` | `unzip -t` passed |
| `LocalBuddy-0.9.0-arm64.dmg` | 220,671,860 | `8b5ef81ccf0fad2f9fe7e09d62b250f58a429cb68b535114b65196ce3d6a07cd` | `hdiutil verify` valid |

Package inspection proved:

- strict deep ad-hoc signature and expected Electron 43 Fuse values;
- ASAR-only application payload;
- packaged Chromium headless shell and FFmpeg launch;
- Renderer loaded `localbuddy://app/index.html`, exposed the sandbox bridge, and rendered one root tree;
- screenshot 2880 x 1718, SHA-256 `c10ec99c09338e7ec3f5e2944f37a8c55f4b4ea9f5975f9cf5d864b860b36a97`.

## External gates

- No remote was created because the authenticated account can create under personal owner `LLM-X-Factorer` or organization `NodEducation`, while the intended owner has not been selected.
- Linux/Windows CI is defined but cannot be called accepted until the repository exists remotely and native runners produce artifacts.
- Production MCP OAuth still requires a named real service and account; local loopback protocol fixtures are not production acceptance.
- Developer ID, production Hardened Runtime, notarization and public Gatekeeper acceptance remain intentionally deferred.
