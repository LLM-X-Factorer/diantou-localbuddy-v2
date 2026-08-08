# M7 Validation Record

Date: 2026-08-08.

## Automated evidence

- CLI `--resume-run` loaded the original CLI-owned Request, kept the same Run ID, entered checkpoint inspection, and rejected goal/mode/provider/concurrency/extension overrides.
- Research and Coding recovery fault-injection tests still pass, including a child process killed after a durable checkpoint.
- An approved committed Integration was reverted by a new commit. The new HEAD parent was the original Integration commit, the primary checkout was clean, and history was not rewritten.
- A two-patch conflict materialized only in the Integration preview worktree. The Merge Agent saw only unmerged paths; controller checks and the human approval Gate remained mandatory.
- Independent schedulers shared one file-leased Task slot. Independent Provider wrappers shared concurrency and a daily usage ledger.
- Stale process leases, workspace locks, ambiguous apply states, and unexpected changed paths all retain fail-closed coverage.

## Known limit

The daily token budget is a local soft ceiling: the last already-running request can finish above the threshold. It is not distributed across machines.
