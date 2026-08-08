import { WorkspaceProcessLockManager } from "../../src/workspace-process-lock.js";

const workspace = process.argv[2];
if (workspace === undefined) {
  throw new Error("workspace path is required");
}

await new WorkspaceProcessLockManager().acquire(workspace, "test-child");
process.stdout.write("locked\n");

setInterval(() => undefined, 60_000);
