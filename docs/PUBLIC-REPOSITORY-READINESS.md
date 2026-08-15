# Public Repository Readiness

Date: 2026-08-15.

## Decision boundary

Making the repository public is an external publication action. It exposes the complete reachable Git history, commit authors, branches that are pushed, Issues, Pull Requests, Actions metadata, Release notes, and Release assets. It does not merely make the latest source tree downloadable.

The online updater implementation assumes the repository and its stable GitHub Releases are public. Changing visibility does not by itself make the project open source: a license must be selected and committed before the project is described or promoted as open source.

## Completed audit

- `gitleaks 8.30.1 git --redact=100` scanned all 42 reachable commits and reported zero secret findings;
- a separate redacted directory scan covered current tracked and untracked source, Desktop, scripts, docs, tests, benchmarks, fixtures, workflows and root metadata, with zero findings;
- no semiconductor research prompt, generated report, Provider credential, local event log or `.localbuddy/` runtime directory is present in the candidate source surface;
- `.env` and `.localbuddy/` remain ignored; `.env.example` contains empty credential placeholders only;
- the published Windows packages are built with ASAR and explicit packaging ignores for repository docs, tests, fixtures, scripts and `.localbuddy/` state.

## Known public metadata

These are not credentials, but they will become public if the existing repository is opened:

- existing commits use the author identity already recorded in Git history;
- historical validation documents contain a small number of macOS home-directory paths and GitHub-hosted Windows Runner paths;
- Issues `#2` through `#5`, merged PR `#1`, Actions history and Releases `v0.9.0` through `v0.12.2` will become visible;
- old Release assets are unsigned Engineering Alpha binaries and may trigger Windows SmartScreen.

The current candidate does not rewrite published Git history or move historical Tags merely to hide low-sensitivity path metadata. Any history rewrite would invalidate existing commit and Release evidence and requires a separate explicit decision.

## Gates before changing visibility

- [ ] Choose and commit a license, or explicitly decide to publish source as all-rights-reserved and not use the open-source-only Electron update service;
- [ ] Accept the existing commit author identity and low-sensitivity historical paths as public metadata;
- [ ] Confirm Issues, PR, Actions history and old Release notes/assets are suitable for public access;
- [ ] Merge the updater bridge on the intended immutable commit;
- [ ] Change repository visibility only after the preceding gates are closed;
- [ ] Publish the bridge Release and read back Tag, assets, checksums and the public update endpoint;
- [ ] Complete a real Windows 11 online upgrade from the bridge version to a later stable version;
- [ ] Add trusted Windows code signing before describing installation as suitable for ordinary public users.

## Release and updater sequence

1. Existing `v0.12.2` users perform one final manual in-place install of the bridge Release; uninstall is not required.
2. The bridge stable build derives its feed from `https://update.electronjs.org/LLM-X-Factorer/diantou-localbuddy-v2/win32-<arch>/<current-version>`.
3. A later stable Tag publishes Setup, ZIP, `RELEASES`, full nupkg and checksums.
4. The post-release workflow asks the public update service for an update from the prior stable version and requires the new full package to appear.
5. A real Windows 11 device checks, downloads, waits for Run/Integration idle, restarts, installs and reads back the new version while preserving a non-sensitive profile marker.

Until step 5 is complete, LocalBuddy may say that the public updater is implemented or that the endpoint is reachable; it must not say that no-reinstall online updates are production-verified.
