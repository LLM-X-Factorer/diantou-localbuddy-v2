import type { WorkspaceRequest } from "./domain.js";
import { WorkspaceLeaseManager } from "./workspace-leases.js";

export type ReleaseExecutionSlot = () => void;

/**
 * Process-local capacity and workspace-lock owner shared by every active Run.
 * A task must acquire both resources atomically before it can execute.
 */
export class ExecutionCoordinator {
  readonly #globalConcurrency: number;
  readonly #workspaceLeases = new WorkspaceLeaseManager();
  readonly #waiters = new Set<() => void>();
  #activeCount = 0;
  #version = 0;

  constructor(globalConcurrency = 3) {
    if (!Number.isInteger(globalConcurrency) || globalConcurrency < 1) {
      throw new Error("globalConcurrency must be a positive integer");
    }
    this.#globalConcurrency = globalConcurrency;
  }

  get activeCount(): number {
    return this.#activeCount;
  }

  get globalConcurrency(): number {
    return this.#globalConcurrency;
  }

  get version(): number {
    return this.#version;
  }

  canAcquire(taskKey: string, workspace?: WorkspaceRequest): boolean {
    return this.#activeCount < this.#globalConcurrency
      && this.#workspaceLeases.canAcquire(taskKey, workspace);
  }

  acquire(taskKey: string, workspace?: WorkspaceRequest): ReleaseExecutionSlot {
    if (!this.canAcquire(taskKey, workspace)) {
      throw new Error(`Execution slot is not available for task ${taskKey}`);
    }

    const releaseWorkspace = this.#workspaceLeases.acquire(taskKey, workspace);
    this.#activeCount += 1;
    this.#notifyChange();

    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      releaseWorkspace();
      this.#activeCount -= 1;
      this.#notifyChange();
    };
  }

  waitForChange(afterVersion: number, signal?: AbortSignal): Promise<void> {
    if (this.#version !== afterVersion || signal?.aborted === true) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const finish = () => {
        this.#waiters.delete(finish);
        signal?.removeEventListener("abort", finish);
        resolve();
      };
      this.#waiters.add(finish);
      signal?.addEventListener("abort", finish, { once: true });
      if (this.#version !== afterVersion) {
        finish();
      }
    });
  }

  #notifyChange(): void {
    this.#version += 1;
    const waiters = [...this.#waiters];
    this.#waiters.clear();
    for (const waiter of waiters) {
      waiter();
    }
  }
}
