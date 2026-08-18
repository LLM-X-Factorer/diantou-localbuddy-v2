# Public Repository Readiness

Publication audit completed: 2026-08-15. Release truth refreshed: 2026-08-18.

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
- public Issues and PRs, Actions history, historical Releases `v0.9.0` through `v0.12.2`, the failed `v0.12.3` Tag, bridge Release `v0.12.4` and current Releases through `v0.12.7` are visible;
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
- [x] Publish `v0.12.6`, verify `v0.12.5 -> v0.12.6` with profile preservation, independently download/check five assets and confirm the unauthenticated public updater response;
- [x] Publish `v0.12.7`; retain the third-party updater HTTP 404 failure instead of moving the Tag or replacing assets;
- [x] Verify the first-party GitHub Release feed with Windows Squirrel `Update.exe`, full nupkg download, target UI and profile preservation before tagging `v0.12.8`;
- [x] Publish `v0.12.8`, verify `v0.12.7 -> v0.12.8` through the first-party feed and independently read back five assets/checksums;
- [ ] Complete a real Windows 11 online upgrade from the bridge version to a later stable version;
- [ ] Add trusted Windows code signing before describing installation as suitable for ordinary public users.

## Release and updater sequence

`v0.12.3` stopped in the Windows test gate before packaging, so its immutable Tag is retained as failure evidence and no Release/assets exist. The bridge shipped as public unsigned Engineering Alpha `v0.12.4`.

1. Existing `v0.12.2` users perform one final manual in-place install of the `v0.12.4` bridge Release; uninstall is not required.
2. Builds through `v0.12.7` derive their feed from `update.electronjs.org`. That service returned HTTP 404 throughout the `v0.12.7` post-release gate; `v0.12.8` switches packaged stable Windows x64 builds to `https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/releases/latest/download`.
3. Each stable Tag from `v0.12.5` publishes Setup, ZIP, `RELEASES`, full nupkg and checksums.
4. The post-release workflow installs the prior stable Setup on Windows and uses Squirrel `Update.exe` against the first-party GitHub Release feed. It must install the new version, launch its UI and preserve a non-sensitive profile marker. The Release publisher separately requires Setup, ZIP, `RELEASES`, full nupkg and checksums.
5. A real Windows 11 device checks, downloads, waits for Run/Integration idle, restarts, installs and reads back the new version while preserving a non-sensitive profile marker.

Until step 5 is complete, LocalBuddy may say that the public updater is implemented or that the endpoint is reachable; it must not say that no-reinstall online updates are production-verified.

Manual workflow `32120336697` completed the first-party hosted gate before the `v0.12.8` Tag: Windows Server 2025 installed `v0.12.6`, fetched `RELEASES` plus the 265,770,685-byte `v0.12.7` full nupkg from the public static feed, upgraded, launched the target UI and preserved the profile marker. Check, download and install took 2.559, 9.49 and 17.05 seconds. This proves the unauthenticated feed contract, but it does not replace the `v0.12.8` fixed-Tag gate or Windows 11 step 5.

The fixed `v0.12.8` workflow `32122329408` is fully green. Its Windows release job passed the production dependency audit, 219 contracts, installed-app gray, `v0.12.7 -> v0.12.8` local in-place upgrade and direct publication of five verified assets. The independent online job then installed `v0.12.7`, downloaded the 265,770,518-byte `v0.12.8` full nupkg from the first-party feed, upgraded to `app-0.12.8`, launched the target UI and preserved the profile marker. All five assets were downloaded into a fresh directory and matched both the checksum manifest and GitHub digests. Real Windows 11 step 5 and code signing remain open.

The `v0.12.4` Windows release job passed and the five assets were downloaded into a fresh directory and matched their SHA-256 manifest. Its separate online smoke kept the overall workflow red because the old validator searched the service JSON for a full nupkg filename and stopped after five minutes. The unauthenticated endpoint returned HTTP 200 with the exact `v0.12.4` Setup URL 42 seconds later. That failed audit is retained.

The corrected `v0.12.5` workflow `32017121369` is fully green. Its Windows Server 2025 job passed production dependency audit, 214 contracts, installed-app gray, `v0.12.4 -> v0.12.5` in-place upgrade with `profilePreserved=true`, and direct publication of five verified assets. All five assets were independently downloaded into a fresh directory and matched the manifest and GitHub digests. The separate unauthenticated updater smoke returned HTTP 200 with the exact `v0.12.5` Setup URL on its first attempt. This closes the hosted release path, but not the real Windows 11 step 5 above.

The `v0.12.6` workflow `32024271769` is also fully green. Its Windows Server 2025 job passed production dependency audit, 220 contracts, installed-app gray, `v0.12.5 -> v0.12.6` in-place upgrade with `profilePreserved=true`, and direct publication of five verified assets. All five assets were independently downloaded into a fresh directory and matched the manifest and GitHub digests. The unauthenticated endpoint returned HTTP 200 with the exact `v0.12.6` Setup URL. This confirms the release process is repeatable, while the real Windows 11 step 5 and code signing remain open.
