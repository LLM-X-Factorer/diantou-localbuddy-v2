# M6 Validation Record

Date: 2026-08-08, macOS arm64 host.

## Proven on this host

- The complete `pnpm check` suite passes as part of the final 96-test M9 baseline.
- A real Seatbelt child process read the exact workspace and system toolchain, wrote only the Run temp root, and was denied a sibling private file.
- A loopback network request was denied under the default profile.
- Timeout terminated the detached process group and emitted `execution.failed`.
- Audit events contain the safe command label and argument SHA-256, not raw arguments or their test secret.
- Coding and Integration checks route through `ExecutionHost`; MCP stdio uses the same Seatbelt launch wrapper.
- Every built-in permission has an explicit decision in strict, balanced, and automation profiles. Unknown permissions/tools deny by default.

## Not proven on this host

- Linux container behavior is implemented and statically checked, but requires a Linux host with the pinned image already present.
- Windows deliberately has no local process execution host and therefore fails closed.
- Seatbelt is a product boundary on the current macOS version, not a formal Apple security certification.
