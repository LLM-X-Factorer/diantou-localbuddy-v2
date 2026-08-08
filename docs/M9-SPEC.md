# M9 · Distribution Protocol, Platform Adapters, and Skill Supply Chain

## 1. Signed update staging

The release manifest is UTF-8 JSON with this signed payload order:

```json
{
  "version": 1,
  "product": "com.diantou.localbuddy",
  "releaseVersion": "0.9.1",
  "minRuntimeVersion": "0.9.0",
  "publishedAt": "2026-08-08T00:00:00.000Z",
  "artifacts": [{
    "platform": "darwin",
    "arch": "arm64",
    "url": "https://updates.example.com/LocalBuddy.zip",
    "sha256": "...",
    "bytes": 123,
    "fileName": "LocalBuddy.zip"
  }],
  "signature": "BASE64_ED25519_SIGNATURE"
}
```

- The embedded/pinned public key is SPKI DER encoded as base64; the private key remains outside the repository and release host logs.
- Manifest identity, strict semantic versions, timestamp, platform/architecture, URL scheme, file name, SHA-256 and byte count are checked before staging.
- `update-state.json` records the highest release ever accepted. A lower signed version is still rejected, preventing a compromised mirror from replaying an older legitimate manifest.
- Files are written with an exclusive temporary name and atomically renamed under the OS state directory.
- The API returns `automaticInstallAllowed: false`. No code path replaces a running app, edits `/Applications`, or bypasses Gatekeeper.

Publisher command:

```bash
pnpm update:sign -- unsigned.json /secure/path/release-private.pem signed.json
```

Client command:

```bash
pnpm update:stage -- --manifest-url https://.../manifest.json --public-key BASE64_SPKI
```

## 2. Platform contract

| Surface | macOS | Linux | Windows |
|---|---|---|---|
| Provider/MCP secrets | Keychain | Secret Service (`secret-tool`) | Credential Manager |
| Runtime state | `~/Library/Application Support/LocalBuddy` | XDG state/config | `%LOCALAPPDATA%/LocalBuddy` |
| Model-triggered process isolation | Seatbelt | pinned local container image | fail closed |
| Package command | `make:mac` | `make:linux` (DEB) | `make:win` (Squirrel + ZIP) |

Linux container execution requires `LOCALBUDDY_EXECUTION_IMAGE` with an explicit tag or digest. The runtime passes `--pull=never`, read-only rootfs, `cap-drop=ALL`, `no-new-privileges`, no network by default, PID/memory/CPU limits, an unprivileged user, exact bind mounts and a bounded tmpfs. It never falls back to an unconstrained host command.

Windows deliberately keeps process-type tools disabled until an equally reviewable isolation host exists. Research, remote Provider, HTTPS MCP and non-process tools remain available.

`.github/workflows/ci.yml` separates the fully exercised macOS suite from Linux/Windows platform-neutral contract tests and native packaging. A workflow file is not proof that an unrun target package works; the first remote CI artifacts remain external acceptance.

## 3. Skill trust model

Two tiers exist:

1. `workspace-local`: an explicitly selected, user-authored `SKILL.md`. It cannot grant tools or permissions and is identified as unsigned in the extension contract.
2. `signed`: a distributable package containing `SKILL.md` and `manifest.json`.

Signed manifest:

```json
{
  "version": 1,
  "id": "evidence-review",
  "release": "1.2.3",
  "publisherKeyId": "publisher-2026",
  "skillSha256": "...",
  "permissions": ["workspace.read", "external.read"],
  "signature": "BASE64_ED25519_SIGNATURE"
}
```

Loading a signed Skill requires all of the following:

- exact `SKILL.md` content hash;
- valid Ed25519 signature from an active publisher in the OS-local trust directory;
- exact release and manifest hash in workspace `.localbuddy/skill-lock.json`;
- no matching Skill, release, manifest hash, or publisher key in `skill-revocations.json`;
- known permission names only.

Permissions are declarations for review and contract hashing. They do not grant Tool Runtime authority; the Run selection, Agent role, trust profile, MCP/browser gates, and exact tool approval remain authoritative.

Package command:

```bash
pnpm skill:sign -- /path/to/evidence-review 1.2.3 publisher-2026 /secure/private.pem workspace.read,external.read
```

The command prints the manifest hash to place in the workspace lock. Publisher private keys and generated release secrets must never be committed.

## Deferred item 6

Developer ID signing, production Hardened Runtime entitlements, Apple notarization, stapling and public Gatekeeper acceptance are intentionally not implemented. The existing ad-hoc macOS package is for internal testing only.
