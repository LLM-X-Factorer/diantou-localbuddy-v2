import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import {
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";

const LOCK_VERSION = 1;
const INCOMPLETE_LOCK_GRACE_MS = 10_000;

interface WorkspaceLockOwner {
  version: 1;
  ownerId: string;
  pid: number;
  hostname: string;
  label: string;
  acquiredAt: string;
}

interface HeldWorkspaceLock {
  workspace: string;
  lockDirectory: string;
  owner: WorkspaceLockOwner;
  references: number;
}

const heldLocks = new Map<string, HeldWorkspaceLock>();
const pendingLocks = new Map<string, Promise<HeldWorkspaceLock>>();
const pendingReleases = new Map<string, Promise<void>>();

export class WorkspaceLockedError extends Error {
  readonly owner?: WorkspaceLockOwner;

  constructor(workspace: string, owner?: WorkspaceLockOwner) {
    super(owner === undefined
      ? `Workspace is locked by another LocalBuddy process: ${workspace}`
      : `Workspace is locked by LocalBuddy pid ${owner.pid} (${owner.label}) since ${owner.acquiredAt}`);
    this.name = "WorkspaceLockedError";
    this.owner = owner;
  }
}

export interface WorkspaceProcessLease {
  readonly workspace: string;
  readonly ownerId: string;
  release(): Promise<void>;
}

export class WorkspaceProcessLockManager {
  async acquire(workspaceInput: string, label: string): Promise<WorkspaceProcessLease> {
    const workspace = await realpath(workspaceInput);
    const normalizedLabel = normalizeLabel(label);
    await pendingReleases.get(workspace);
    let held = heldLocks.get(workspace);
    if (held === undefined) {
      let pending = pendingLocks.get(workspace);
      if (pending === undefined) {
        pending = acquireNewWorkspaceLock(workspace, normalizedLabel);
        pendingLocks.set(workspace, pending);
      }
      try {
        held = await pending;
        heldLocks.set(workspace, held);
      } finally {
        if (pendingLocks.get(workspace) === pending) pendingLocks.delete(workspace);
      }
    }
    held.references += 1;
    let released = false;
    return {
      workspace,
      ownerId: held.owner.ownerId,
      async release() {
        if (released) return;
        released = true;
        await releaseWorkspaceLock(held!);
      },
    };
  }

  async tryAcquire(
    workspaceInput: string,
    label: string,
  ): Promise<WorkspaceProcessLease | undefined> {
    try {
      return await this.acquire(workspaceInput, label);
    } catch (error) {
      if (error instanceof WorkspaceLockedError) return undefined;
      throw error;
    }
  }
}

async function acquireNewWorkspaceLock(
  workspace: string,
  label: string,
): Promise<HeldWorkspaceLock> {
  const localBuddyRoot = resolve(workspace, ".localbuddy");
  const lockDirectory = resolve(localBuddyRoot, "runtime-lock");
  await mkdir(localBuddyRoot, { recursive: true });
  const owner: WorkspaceLockOwner = {
    version: LOCK_VERSION,
    ownerId: randomUUID(),
    pid: process.pid,
    hostname: hostname(),
    label,
    acquiredAt: new Date().toISOString(),
  };
  try {
    await mkdir(lockDirectory);
  } catch (error) {
    if (!(isNodeError(error) && error.code === "EEXIST")) throw error;
    const current = await inspectExistingLock(lockDirectory);
    if (!isStaleOwner(current.owner)) {
      throw new WorkspaceLockedError(workspace, current.owner);
    }
    if (current.owner === undefined && Date.now() - current.modifiedAt < INCOMPLETE_LOCK_GRACE_MS) {
      throw new WorkspaceLockedError(workspace);
    }
    const quarantine = resolve(localBuddyRoot, `runtime-lock.stale-${randomUUID()}`);
    try {
      await rename(lockDirectory, quarantine);
    } catch (renameError) {
      if (isNodeError(renameError) && renameError.code === "ENOENT") {
        throw new WorkspaceLockedError(workspace);
      }
      throw renameError;
    }
    try {
      await mkdir(lockDirectory);
    } finally {
      await rm(quarantine, { recursive: true, force: true });
    }
  }
  try {
    await writeFile(
      resolve(lockDirectory, "owner.json"),
      `${JSON.stringify(owner, null, 2)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
  } catch (error) {
    await rm(lockDirectory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  return { workspace, lockDirectory, owner, references: 0 };
}

async function releaseWorkspaceLock(held: HeldWorkspaceLock): Promise<void> {
  held.references -= 1;
  if (held.references > 0) return;
  const current = heldLocks.get(held.workspace);
  if (current !== held) return;
  heldLocks.delete(held.workspace);
  const pendingRelease = (async () => {
    const inspected = await inspectExistingLock(held.lockDirectory);
    if (inspected.owner?.ownerId !== held.owner.ownerId) {
      throw new Error("Workspace lock ownership changed before release");
    }
    await rm(held.lockDirectory, { recursive: true });
  })();
  pendingReleases.set(held.workspace, pendingRelease);
  try {
    await pendingRelease;
  } finally {
    if (pendingReleases.get(held.workspace) === pendingRelease) {
      pendingReleases.delete(held.workspace);
    }
  }
}

async function inspectExistingLock(lockDirectory: string): Promise<{
  owner?: WorkspaceLockOwner;
  modifiedAt: number;
}> {
  const metadata = await stat(lockDirectory);
  try {
    const raw = JSON.parse(await readFile(resolve(lockDirectory, "owner.json"), "utf8")) as unknown;
    return { owner: parseOwner(raw), modifiedAt: metadata.mtimeMs };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { modifiedAt: metadata.mtimeMs };
    }
    throw error;
  }
}

function parseOwner(value: unknown): WorkspaceLockOwner {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Workspace lock owner metadata is invalid");
  }
  const owner = value as Partial<WorkspaceLockOwner>;
  if (
    owner.version !== LOCK_VERSION
    || typeof owner.ownerId !== "string"
    || !/^[a-f0-9-]{36}$/.test(owner.ownerId)
    || !Number.isInteger(owner.pid)
    || (owner.pid ?? 0) < 1
    || typeof owner.hostname !== "string"
    || typeof owner.label !== "string"
    || typeof owner.acquiredAt !== "string"
  ) {
    throw new Error("Workspace lock owner metadata has an invalid contract");
  }
  return owner as WorkspaceLockOwner;
}

function isStaleOwner(owner: WorkspaceLockOwner | undefined): boolean {
  if (owner === undefined) return true;
  if (owner.hostname !== hostname()) return false;
  try {
    process.kill(owner.pid, 0);
    return false;
  } catch (error) {
    return isNodeError(error) && error.code === "ESRCH";
  }
}

function normalizeLabel(value: string): string {
  const label = value.trim();
  if (label.length === 0 || label.length > 120 || /[\r\n\0]/.test(label)) {
    throw new Error("Workspace lock label must be a bounded single-line string");
  }
  return label;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
