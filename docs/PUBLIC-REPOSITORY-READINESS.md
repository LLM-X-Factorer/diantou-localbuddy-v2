# Public Repository Readiness

Publication audit completed: 2026-08-15. Release truth refreshed: 2026-08-17.

## Decision boundary

Making the repository public was an external publication action. The repository is now public, including the complete reachable Git history, commit authors, pushed branches, Issues, Pull Requests, Actions metadata, Release notes, and Release assets; this did not merely make the latest source tree downloadable.

The online updater implementation assumes the repository and its stable GitHub Releases are public. LocalBuddy is licensed under Apache License 2.0; the visibility change and license decision remain separately recorded actions.

## Completed audit

- `gitleaks 8.30.1 git --redact=100` scanned all 42 reachable commits and reported zero secret findings;
- a separate redacted directory scan covered current tracked and untracked source, Desktop, scripts, docs, tests, benchmarks, fixtures, workflows and root metadata, with zero findings;
- no semiconductor research prompt, generated report, Provider credential, local event log or `.localbuddy/` runtime directory was present in the publication source surface;
- `.env` and `.localbuddy/` remain ignored; `.env.example` contains empty credential placeholders only;
- the published Windows packages are built with ASAR and explicit packaging ignores for repository docs, tests, fixtures, scripts and `.localbuddy/` state.

## Known public metadata

These are not credentials, but they became public with the existing repository:

- existing commits use the author identity already recorded in Git history;
- historical validation documents contain a small number of macOS home-directory paths and GitHub-hosted Windows Runner paths;
- public Issues and PRs, Actions history, historical Releases `v0.9.0` through `v0.12.2`, the failed `v0.12.3` Tag, bridge Release `v0.12.4` and current Release `v0.12.5` are visible;
- old Release assets are unsigned Engineering Alpha binaries and may trigger Windows SmartScreen.

The publication did not rewrite Git history or move historical Tags merely to hide low-sensitivity path metadata. Any future history rewrite would invalidate existing commit and Release evidence and requires a separate explicit decision.

## Publication gates and remaining distribution gates

- [x] Choose and commit Apache License 2.0 in `LICENSE`, with project attribution in `NOTICE` and SPDX metadata in `package.json`;
- [x] Accept the existing commit author identity and low-sensitivity historical paths as public metadata;
- [x] Confirm Issues, PR, Actions history and old Release notes/assets are suitable for public access;
- [x] Merge the updater bridge on immutable merge commit `c158fd2fa02efe473b10d0905d3ac2202be7dad8`;
- [x] Change repository visibility after the preceding gates are closed, then verify unauthenticated API access and GitHub's `Apache-2.0` detection;
- [x] Publish `v0.12.4` as the bridge Release and read back its immutable Tag, five assets, checksums and public update endpoint;
- [x] Publish `v0.12.5`, verify `v0.12.4 -> v0.12.5` on Windows Server 2025, read back five assets/checksums and confirm the unauthenticated public updater response;
- [ ] Complete a real Windows 11 online upgrade from the bridge version to a later stable version;
- [ ] Add trusted Windows code signing before describing installation as suitable for ordinary public users.

## Release and updater sequence

`v0.12.3` stopped in the Windows test gate before packaging, so its immutable Tag is retained as failure evidence and no Release/assets exist. The bridge shipped as public unsigned Engineering Alpha `v0.12.4`.

1. Existing `v0.12.2` users perform one final manual in-place install of the `v0.12.4` bridge Release; uninstall is not required.
2. The bridge stable build derives its feed from `https://update.electronjs.org/LLM-X-Factorer/diantou-localbuddy-v2/win32-<arch>/<current-version>`.
3. The `v0.12.5` stable Tag publishes Setup, ZIP, `RELEASES`, full nupkg and checksums.
4. The post-release workflow asks the public update service for an update from the prior stable version, parses its JSON and requires the exact new Setup URL. The Release publisher separately requires Setup, ZIP, `RELEASES`, full nupkg and checksums.
5. A real Windows 11 device checks, downloads, waits for Run/Integration idle, restarts, installs and reads back the new version while preserving a non-sensitive profile marker.

Until step 5 is complete, LocalBuddy may say that the public updater is implemented or that the endpoint is reachable; it must not say that no-reinstall online updates are production-verified.

The `v0.12.4` Windows release job passed and the five assets were downloaded into a fresh directory and matched their SHA-256 manifest. Its separate online smoke kept the overall workflow red because the old validator searched the service JSON for a full nupkg filename and stopped after five minutes. The unauthenticated endpoint returned HTTP 200 with the exact `v0.12.4` Setup URL 42 seconds later. That failed audit is retained.

The corrected `v0.12.5` workflow `32017121369` is fully green. Its Windows Server 2025 job passed production dependency audit, 214 contracts, installed-app gray, `v0.12.4 -> v0.12.5` in-place upgrade with `profilePreserved=true`, and direct publication of five verified assets. All five assets were independently downloaded into a fresh directory and matched the manifest and GitHub digests. The separate unauthenticated updater smoke returned HTTP 200 with the exact `v0.12.5` Setup URL on its first attempt. This closes the hosted release path, but not the real Windows 11 step 5 above.
