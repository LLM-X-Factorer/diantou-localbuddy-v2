# M7 · Recovery and Cross-Process Coordination

## Same-Run recovery

- `--resume-run <run-id>` is limited to nonterminal CLI-owned Runs.
- Goal, mode, concurrency, provider, model, and extensions are loaded from `run-request.json`; resume-time overrides are rejected.
- Resume replays the durable checkpoint contract under the original Run ID and emits explicit recovery events.

## Integration recovery

- An uncommitted applied patch can be reversed only while HEAD and the complete working-tree patch still match the approved proposal.
- A committed Integration is undone with a new Git revert commit. History is never rewritten.
- The recorded commit must descend directly from the approved baseline and its binary patch hash must match the approved combined patch.
- If the revert commit exists but proposal/event persistence fails, the repository is left intact and the proposal moves to `recovery_required` when persistence remains possible.

## Conflict resolution

- Integration first attempts deterministic indexed patch application.
- Only materialized unmerged paths are delegated to the Merge Agent inside the Integration preview worktree.
- The controller verifies resolved paths, reruns all combined checks, captures a fresh combined patch, and still requires the human approval Gate before touching the primary checkout.

## Cross-process coordination

- File leases enforce machine-wide task and Provider concurrency across LocalBuddy processes and workspaces.
- Provider ledgers enforce a configurable minimum request interval and daily token budget without storing prompts, outputs, URLs, or credentials.
- Stale leases are reclaimed by bounded age and local process liveness.
- Coordination is machine-local. It is not a distributed scheduler and the token ceiling can overshoot by the final request already in flight.

## Configuration

- `LOCALBUDDY_GLOBAL_TASK_CONCURRENCY` defaults to `3`.
- `LOCALBUDDY_GLOBAL_MODEL_CONCURRENCY` defaults to `3`.
- `LOCALBUDDY_PROVIDER_MIN_INTERVAL_MS` defaults to `0`.
- `LOCALBUDDY_DAILY_TOKEN_BUDGET` defaults to `0` (disabled).
- `LOCALBUDDY_COORDINATION_ROOT` overrides the OS-specific state directory.
- `LOCALBUDDY_SHARED_COORDINATION=0` disables process-shared coordination for deterministic local tests.
