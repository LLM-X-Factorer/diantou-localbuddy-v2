# LocalBuddy V2 Agent Guide

This repository is an independent implementation of a local multi-agent desktop runtime.

## Source boundary

- Do not copy, vendor, cherry-pick, or translate source code from Craft Agents or Tencent WorkBuddy.
- Public product behavior and general architecture patterns may inform requirements.
- The V1 repository may be used only as a black-box behavior reference and acceptance oracle.
- Do not copy V1 implementation files, UI assets, product strings, or Git history into this repository.

## Product boundary

- Single local user; remote LLM providers are allowed.
- Multi-run and multi-agent concurrency are first-class capabilities.
- The default global task concurrency is three and must remain configurable.
- Read-only tasks may share a workspace. Concurrent write tasks require isolated workspaces; integration into the primary workspace is serialized.
- Every model or tool action must emit an auditable event.

## Engineering discipline

- Keep the domain runtime independent from Electron and React.
- Add tests for state transitions, dependency handling, capacity limits, workspace locking, cancellation, and recovery.
- Never commit provider credentials, user prompts, generated private artifacts, or local event logs.
- Use `pnpm` for dependency and script execution.
- Run `pnpm check` before handoff.
- Do not push or configure a remote unless the user explicitly asks.
