# M10 Validation Record

Date: 2026-08-08, macOS arm64 host plus GitHub-hosted macOS, Ubuntu and Windows runners.

## 2026-08-12 macOS package erratum and local dogfood build

The historical DMG in the table below (`8b5ef81c...`) must not be installed. A real install exposed that `scripts/make-dmg.mjs` followed framework symlinks while copying the Forge app, turning relative links into absolute links to the build machine. `hdiutil verify` validated the disk image container but did not detect that the mounted app failed strict deep code-signature verification.

The copy now preserves symlinks verbatim. `pnpm verify:mac-package` now mounts the DMG, runs strict deep verification against the mounted app, and rejects absolute or escaping symlinks. The post-M10 local dogfood build is not a replacement GitHub Release:

| Artifact | Bytes | SHA-256 | Verification |
|---|---:|---|---|
| `LocalBuddy-0.9.0-arm64.dmg` | 224,276,232 | `3c5f074baa6e4d99f9cd694eac9c6c256353d245cec06685a01653b51b598f25` | branded image valid; mounted app strict-deep valid; 14 relative symlinks; fuses, packaged Chromium and Renderer verified |

That build was installed at `/Applications/LocalBuddy.app` and its installed bytes passed `codesign --verify --deep --strict`. The same working tree passed `pnpm check` with 104/104 tests after adding regressions for workspace-lock reacquisition, cross-Agent calculation idempotency, and brand-asset packaging. Full live results and remaining boundaries are recorded in [`DOGFOOD-2026-08-12.md`](DOGFOOD-2026-08-12.md).

## 2026-08-13 M10.1 local productization follow-up

The local dogfood issues were closed without changing the published `v0.9.0` release:

- native diagnostic save returns to Renderer and clears busy state;
- MCP stdio startup includes bounded, sanitized child diagnostics;
- Run projection exposes duration, calls, provider-reported tokens, failure counts, Artifact Gate retries and failure stage;
- Artifact Gate feedback is actionable and its failed-write budget is three;
- failed Runs may retry the unfinished Task chain from a validated same-Run checkpoint;
- recent workspaces, verified inline Artifact preview and explicit continuation composer flow are available;
- live UI commit and reverse-commit were proved in a disposable repository and left its primary checkout clean.

Final `pnpm check`: 109/109 tests. The source/package version was closed as `0.10.0 / M10.1 Internal Dogfood` without changing the published `v0.9.0` release. Final package evidence:

| Artifact | Bytes | SHA-256 | Verification |
|---|---:|---|---|
| `LocalBuddy-0.10.0-arm64.dmg` | 224,034,339 | `20f7b80ece11ce125b8e4332f9351e8c8fe45c6613923048bb7e37c79aa7195b` | DMG integrity; mounted app strict-deep ad-hoc signature; 14 relative symlinks; fuses; packaged browser; Renderer smoke |

The matching `0.10.0` app is installed at `/Applications/LocalBuddy.app`; installed `app.asar` SHA-256 is `7cc93066a4a942c3fedc185723d03633f1dcec76a59ff9b0abf6efa6d49848c3`, matching the verified Forge bundle. This is still an internal ad-hoc package, not a replacement public release or notarized distribution.

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
| `LocalBuddy-0.9.0-arm64.dmg` | 220,671,860 | `8b5ef81ccf0fad2f9fe7e09d62b250f58a429cb68b535114b65196ce3d6a07cd` | historical `hdiutil verify` passed; **withdrawn for the symlink defect documented above** |

Package inspection proved:

- strict deep ad-hoc signature and expected Electron 43 Fuse values;
- ASAR-only application payload;
- packaged Chromium headless shell and FFmpeg launch;
- Renderer loaded `localbuddy://app/index.html`, exposed the sandbox bridge, and rendered one root tree;
- screenshot 2880 x 1718, SHA-256 `c10ec99c09338e7ec3f5e2944f37a8c55f4b4ea9f5975f9cf5d864b860b36a97`.

## Native GitHub and Windows Release acceptance

- Private repository: [`LLM-X-Factorer/diantou-localbuddy-v2`](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2).
- [`ci` run 31252543852](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/actions/runs/31252543852) passed all five jobs: macOS 99-test baseline, Ubuntu/Windows platform contracts, Ubuntu `make:linux`, and Windows `make:win` with uploaded native artifacts.
- Annotated tag `v0.9.0` resolves to commit `38cefd8cd6045e64754dd60920bdfa3d50c2a9b7`.
- [`release` run 31252721126](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/actions/runs/31252721126) rebuilt on `windows-2025`, reran the Windows contracts, collected the outputs, and published a non-draft, non-prerelease [`LocalBuddy v0.9.0`](https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/releases/tag/v0.9.0).

| Release asset | Bytes | SHA-256 | Verification |
|---|---:|---|---|
| `LocalBuddy-Setup.exe` | 265,197,568 | `d20cb224ba9e342d679abeea8087b7ce6df60b5dcb7847e27603bfcbf64398ae` | Squirrel maker passed; downloaded bytes match Release digest and checksum file |
| `LocalBuddy-win32-x64-0.9.0.zip` | 273,478,801 | `5dbd412f83aea18d9d92841e8badbcdb9adaeb9559903d7935d40089ffce83ef` | ZIP maker passed; downloaded bytes match Release digest and checksum file |
| `SHA256SUMS-windows.txt` | 184 | `65706ca92d2465b206c6c2eaeaca8041df3c323dadfe51c2d6b749b95b1c0d84` | UTF-8 without BOM, LF line endings; Release digest matches downloaded bytes |

The published assets were downloaded back to the macOS host and `shasum -a 256 -c SHA256SUMS-windows.txt` passed. The first checksum asset used Windows CRLF; the post-publication download exposed that portability defect, so the asset was replaced with the same two checksums in LF form and the workflow on `main` was corrected to emit UTF-8 without BOM plus LF for future tags. The Windows binaries are an unsigned Engineering Alpha; native build success is not a Windows code-signing claim.

## External gates

- Continuous 7-14 day dogfooding is active but not complete. The first real macOS installation and functional matrix ran on 2026-08-12; one session is not a substitute for the continuous-use exit gate. The plan and evidence live in [`DOGFOOD.md`](DOGFOOD.md) and [`DOGFOOD-2026-08-12.md`](DOGFOOD-2026-08-12.md).
- Windows native CI proves contracts and artifact generation, not installation, launch, credential storage, a real Provider Run, recovery, or uninstall on a Windows device. That matrix is waiting for hardware.
- Linux native CI proves contracts and DEB generation, not a graphical desktop install/launch session.
- Production MCP OAuth still requires a named real service and account; local loopback protocol fixtures are not production acceptance.
- Developer ID, production Hardened Runtime, notarization and public Gatekeeper acceptance remain intentionally deferred.
