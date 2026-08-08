# M9 Validation Record

Date: 2026-08-08, macOS arm64 host.

## Final deterministic baseline

- `pnpm install --frozen-lockfile`: passed.
- `pnpm audit --audit-level high`: no known vulnerabilities.
- `pnpm check`: TypeScript Core/Main/Preload/Renderer checks and 96/96 tests passed.
- Signed update fixture: Ed25519 verification, artifact byte/hash verification, atomic staging, tamper rejection and signed rollback rejection passed.
- Signed Skill fixture: content hash, active publisher, Ed25519 signature, exact lock and permissions passed; a matching revocation was rejected.
- Static platform contract test confirms macOS/Linux/Windows CI entries, DEB/Squirrel makers, Linux isolation flags, and the Windows fail-closed boundary.
- Repository source scan found no API-key-shaped secret.

## Real DeepSeek vertical smoke

Run `m9-real-deepseek` executed in a disposable workspace using the API key resolved from the OS credential store:

- three Tasks: two parallel readers plus one Integrator;
- status: all succeeded;
- 83 append-only events;
- 12 model requests and 12 completions;
- 15 tool requests/approvals, with two invalid attempts rejected and recovered;
- one `report.md`, 2,893 bytes, SHA-256 `d945a9190a779bf6d1e6fa297d97fd00ab71ee9fa4145661d3ee96b887c4ab2e`;
- seven deterministic ratio calculation IDs were cited;
- channel-level ROI remained explicitly unknown and no ROI value was invented.

The temporary smoke workspace contained no API-key-shaped value and was moved to Trash after evidence capture.

## macOS 0.9.0 internal package

`pnpm make:mac` and `pnpm verify:mac-package` passed.

| Artifact | Bytes | SHA-256 | Verification |
|---|---:|---|---|
| `LocalBuddy-darwin-arm64-0.9.0.zip` | 219,092,469 | `93227b06134a8b8c53a1cd80be0aa2122b80b611f8fc12387302e447237427ad` | `unzip -t` passed |
| `LocalBuddy-0.9.0-arm64.dmg` | 220,390,585 | `d0c454d6adc1e7dfa0b0e0eb3e3dbdbd97017d357eab02724221545fa87ec913` | `hdiutil verify` valid |

Package inspection proved:

- strict deep ad-hoc code signature;
- all configured Electron 43 fuses at expected values;
- ASAR-only application payload;
- packaged Chromium headless shell and FFmpeg launch successfully;
- real app Renderer loaded `localbuddy://app/index.html`, exposed only the sandbox bridge, and rendered one root tree.

The signature flags are explicitly `adhoc`, with no Team Identifier. This is an internal test package only.

## Target-platform and external limits

- Linux DEB and Windows Squirrel/ZIP configuration plus CI jobs exist, but those target runners have not run in this local session. Their first native artifacts remain unverified.
- Linux Secret Service, Windows Credential Manager and Linux container execution are implemented but not runtime-tested from macOS.
- Update staging was proven against a local signed HTTP fixture; no production update origin or release key was supplied.
- Formal Apple Developer ID, production Hardened Runtime, notarization, stapling and public Gatekeeper acceptance are intentionally deferred as item 6.
