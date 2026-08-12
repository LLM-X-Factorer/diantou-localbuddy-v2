import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  WorkspaceLockedError,
  WorkspaceProcessLockManager,
} from "../src/workspace-process-lock.js";

test("workspace leases are reentrant in one process and removed after the final release", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-process-lock-"));
  try {
    const manager = new WorkspaceProcessLockManager();
    const first = await manager.acquire(workspace, "first-run");
    const second = await manager.acquire(workspace, "second-run");
    assert.equal(first.ownerId, second.ownerId);

    const ownerPath = join(workspace, ".localbuddy", "runtime-lock", "owner.json");
    const owner = JSON.parse(await readFile(ownerPath, "utf8")) as { pid: number; label: string };
    assert.equal(owner.pid, process.pid);
    assert.equal(owner.label, "first-run");

    await first.release();
    await access(ownerPath);
    await second.release();
    await assert.rejects(access(ownerPath), { code: "ENOENT" });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("waits for final lock cleanup before reacquiring the same workspace", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-process-lock-reacquire-"));
  const lockPath = join(workspace, ".localbuddy", "runtime-lock");
  try {
    const manager = new WorkspaceProcessLockManager();
    let lease = await manager.acquire(workspace, "initial");
    for (let index = 0; index < 20; index += 1) {
      const releasing = lease.release();
      const acquiring = manager.acquire(workspace, `reacquire-${index}`);
      [, lease] = await Promise.all([releasing, acquiring]);
      await access(lockPath);
    }
    await lease.release();
    await assert.rejects(access(lockPath), { code: "ENOENT" });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("a live foreign process blocks the workspace and its dead lock is reclaimed", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-process-lock-child-"));
  let child: ChildProcess | undefined;
  try {
    child = spawn(
      process.execPath,
      [resolve("dist/test/fixtures/workspace-lock-holder.js"), workspace],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    await waitForLine(child, "locked");

    await assert.rejects(
      new WorkspaceProcessLockManager().acquire(workspace, "blocked-parent"),
      (error: unknown) => error instanceof WorkspaceLockedError
        && error.owner?.pid === child?.pid
        && error.owner?.label === "test-child",
    );

    child.kill("SIGKILL");
    await waitForExit(child);
    child = undefined;

    const recovered = await new WorkspaceProcessLockManager().acquire(workspace, "recovered-parent");
    await recovered.release();
    await assert.rejects(access(join(workspace, ".localbuddy", "runtime-lock")), { code: "ENOENT" });
  } finally {
    if (child !== undefined && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await waitForExit(child);
    }
    await rm(workspace, { recursive: true, force: true });
  }
});

async function waitForLine(child: ChildProcess, expected: string): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const timeout = setTimeout(() => reject(new Error("lock holder did not become ready")), 5_000);
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.split(/\r?\n/).includes(expected)) {
        clearTimeout(timeout);
        resolvePromise();
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      reject(new Error(`lock holder exited before ready: ${code ?? signal}; ${output}`));
    });
  });
}

async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolvePromise) => child.once("exit", () => resolvePromise()));
}
