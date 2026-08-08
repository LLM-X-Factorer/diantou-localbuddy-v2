import type { WorkspaceRequest } from "./domain.js";

export type ReleaseWorkspaceLease = () => void;

interface ActiveLease {
  readers: Set<string>;
  writer?: string;
}

export class WorkspaceLeaseManager {
  readonly #active = new Map<string, ActiveLease>();
  readonly #taskKeys = new Map<string, string>();

  canAcquire(taskId: string, request?: WorkspaceRequest): boolean {
    if (request === undefined || request.access === "none") {
      return true;
    }

    if (this.#taskKeys.has(taskId)) {
      return false;
    }

    const lease = this.#active.get(toLeaseKey(request));
    if (lease === undefined) {
      return true;
    }
    if (request.access === "read") {
      return lease.writer === undefined;
    }
    return lease.writer === undefined && lease.readers.size === 0;
  }

  acquire(taskId: string, request?: WorkspaceRequest): ReleaseWorkspaceLease {
    if (request === undefined || request.access === "none") {
      return () => undefined;
    }
    if (!this.canAcquire(taskId, request)) {
      throw new Error(`Workspace lease is not available for task ${taskId}`);
    }

    const key = toLeaseKey(request);
    const lease = this.#active.get(key) ?? { readers: new Set<string>() };
    if (request.access === "read") {
      lease.readers.add(taskId);
    } else {
      lease.writer = taskId;
    }
    this.#active.set(key, lease);
    this.#taskKeys.set(taskId, key);

    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.#release(taskId, request.access);
    };
  }

  #release(taskId: string, access: WorkspaceRequest["access"]): void {
    const key = this.#taskKeys.get(taskId);
    if (key === undefined) {
      return;
    }
    const lease = this.#active.get(key);
    if (lease === undefined) {
      return;
    }

    if (access === "read") {
      lease.readers.delete(taskId);
    } else if (lease.writer === taskId) {
      delete lease.writer;
    }
    this.#taskKeys.delete(taskId);

    if (lease.writer === undefined && lease.readers.size === 0) {
      this.#active.delete(key);
    }
  }
}

function toLeaseKey(request: WorkspaceRequest): string {
  return request.isolationKey === undefined
    ? request.resourceId
    : `${request.resourceId}::${request.isolationKey}`;
}
