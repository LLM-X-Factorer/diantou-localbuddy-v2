import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { hostname, homedir } from "node:os";
import { dirname, resolve } from "node:path";

import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelStreamOptions,
} from "./provider.js";

const STATE_VERSION = 1;
const POLL_INTERVAL_MS = 50;
const INCOMPLETE_GRACE_MS = 10_000;

interface LeaseOwner {
  version: 1;
  ownerId: string;
  pid: number;
  hostname: string;
  acquiredAt: string;
}

interface UsageLedger {
  version: 1;
  date: string;
  requestCount: number;
  totalTokens: number;
  unknownUsageCount: number;
  lastRequestAt?: string;
}

interface FileLease {
  directory: string;
  owner: LeaseOwner;
  release(): Promise<void>;
}

export interface ProcessSharedProviderOptions {
  provider: ModelProvider;
  providerId: string;
  stateRoot?: string;
  maxConcurrentRequests?: number;
  minimumIntervalMs?: number;
  dailyTokenBudget?: number;
}

export class ProcessSharedCapacity {
  readonly #slotsRoot: string;
  readonly #limit: number;

  constructor(options: {
    namespace: string;
    stateRoot?: string;
    limit?: number;
  }) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(options.namespace)) {
      throw new Error("shared capacity namespace must use kebab-case");
    }
    this.#slotsRoot = resolve(
      options.stateRoot ?? defaultCoordinationRoot(),
      "capacity",
      options.namespace,
      "slots",
    );
    this.#limit = boundedInteger(options.limit ?? 3, 1, 32, "shared task capacity");
  }

  async acquire(signal?: AbortSignal): Promise<() => Promise<void>> {
    const lease = await acquireSlot(this.#slotsRoot, this.#limit, signal);
    return () => lease.release();
  }
}

/**
 * Coordinates model API concurrency and usage across LocalBuddy processes and
 * workspaces on the same machine. It stores counters only, never prompts,
 * responses, URLs, credentials, or request bodies.
 */
export class ProcessSharedProvider implements ModelProvider {
  readonly #provider: ModelProvider;
  readonly #providerRoot: string;
  readonly #maxConcurrentRequests: number;
  readonly #minimumIntervalMs: number;
  readonly #dailyTokenBudget: number;

  constructor(options: ProcessSharedProviderOptions) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(options.providerId)) {
      throw new Error("shared Provider id must use kebab-case");
    }
    this.#provider = options.provider;
    this.#providerRoot = resolve(
      options.stateRoot ?? defaultCoordinationRoot(),
      "providers",
      options.providerId,
    );
    this.#maxConcurrentRequests = boundedInteger(
      options.maxConcurrentRequests ?? 3,
      1,
      32,
      "shared Provider concurrency",
    );
    this.#minimumIntervalMs = boundedInteger(
      options.minimumIntervalMs ?? 0,
      0,
      60_000,
      "Provider minimum interval",
    );
    this.#dailyTokenBudget = boundedInteger(
      options.dailyTokenBudget ?? 0,
      0,
      1_000_000_000,
      "daily token budget",
    );
  }

  async complete(
    request: ModelRequest,
    options: ModelStreamOptions = {},
  ): Promise<ModelResponse> {
    const slot = await acquireSlot(
      resolve(this.#providerRoot, "slots"),
      this.#maxConcurrentRequests,
      options.signal,
    );
    try {
      await this.#beforeRequest(options.signal);
      const response = await this.#provider.complete(request, options);
      await this.#recordUsage(response);
      return response;
    } finally {
      await slot.release();
    }
  }

  async #beforeRequest(signal?: AbortSignal): Promise<void> {
    while (true) {
      const mutex = await acquireNamedLease(resolve(this.#providerRoot, "ledger-lock"), signal);
      let waitMs = 0;
      try {
        const ledger = await readLedger(resolve(this.#providerRoot, "usage.json"));
        if (this.#dailyTokenBudget > 0 && ledger.totalTokens >= this.#dailyTokenBudget) {
          throw new Error(
            `daily Provider token budget is exhausted (${ledger.totalTokens}/${this.#dailyTokenBudget})`,
          );
        }
        const lastRequestAt = ledger.lastRequestAt === undefined
          ? undefined
          : Date.parse(ledger.lastRequestAt);
        waitMs = lastRequestAt === undefined
          ? 0
          : Math.max(0, this.#minimumIntervalMs - (Date.now() - lastRequestAt));
        if (waitMs === 0) {
          await saveLedger(resolve(this.#providerRoot, "usage.json"), {
            ...ledger,
            requestCount: ledger.requestCount + 1,
            lastRequestAt: new Date().toISOString(),
          });
          return;
        }
      } finally {
        await mutex.release();
      }
      await abortableDelay(waitMs, signal);
    }
  }

  async #recordUsage(response: ModelResponse): Promise<void> {
    const mutex = await acquireNamedLease(resolve(this.#providerRoot, "ledger-lock"));
    try {
      const ledger = await readLedger(resolve(this.#providerRoot, "usage.json"));
      const totalTokens = response.usage?.totalTokens;
      await saveLedger(resolve(this.#providerRoot, "usage.json"), {
        ...ledger,
        totalTokens: ledger.totalTokens + (totalTokens ?? 0),
        unknownUsageCount: ledger.unknownUsageCount + (totalTokens === undefined ? 1 : 0),
      });
    } finally {
      await mutex.release();
    }
  }
}

export function defaultCoordinationRoot(): string {
  if (process.platform === "darwin") {
    return resolve(homedir(), "Library", "Application Support", "LocalBuddy", "runtime");
  }
  if (process.platform === "win32") {
    return resolve(process.env.LOCALAPPDATA ?? homedir(), "LocalBuddy", "runtime");
  }
  return resolve(process.env.XDG_STATE_HOME ?? resolve(homedir(), ".local", "state"), "localbuddy");
}

async function acquireSlot(
  slotsRoot: string,
  count: number,
  signal?: AbortSignal,
): Promise<FileLease> {
  await mkdir(slotsRoot, { recursive: true });
  while (true) {
    if (signal?.aborted === true) throw new Error("Provider capacity wait was cancelled");
    for (let index = 0; index < count; index += 1) {
      const lease = await tryAcquireNamedLease(resolve(slotsRoot, `slot-${index}`));
      if (lease !== undefined) return lease;
    }
    await abortableDelay(POLL_INTERVAL_MS, signal);
  }
}

async function acquireNamedLease(directory: string, signal?: AbortSignal): Promise<FileLease> {
  while (true) {
    if (signal?.aborted === true) throw new Error("shared Provider coordination was cancelled");
    const lease = await tryAcquireNamedLease(directory);
    if (lease !== undefined) return lease;
    await abortableDelay(POLL_INTERVAL_MS, signal);
  }
}

async function tryAcquireNamedLease(directory: string): Promise<FileLease | undefined> {
  await mkdir(dirname(directory), { recursive: true });
  const owner: LeaseOwner = {
    version: STATE_VERSION,
    ownerId: randomUUID(),
    pid: process.pid,
    hostname: hostname(),
    acquiredAt: new Date().toISOString(),
  };
  try {
    await mkdir(directory);
  } catch (error) {
    if (!(isNodeError(error) && error.code === "EEXIST")) throw error;
    const existing = await inspectLease(directory);
    if (!isStale(existing.owner)) return undefined;
    if (existing.owner === undefined && Date.now() - existing.modifiedAt < INCOMPLETE_GRACE_MS) {
      return undefined;
    }
    const quarantine = `${directory}.stale-${randomUUID()}`;
    try {
      await rename(directory, quarantine);
    } catch (renameError) {
      if (isNodeError(renameError) && renameError.code === "ENOENT") return undefined;
      throw renameError;
    }
    try {
      await mkdir(directory);
    } finally {
      await rm(quarantine, { recursive: true, force: true });
    }
  }
  try {
    await writeFile(resolve(directory, "owner.json"), `${JSON.stringify(owner)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  let released = false;
  return {
    directory,
    owner,
    async release() {
      if (released) return;
      released = true;
      const existing = await inspectLease(directory);
      if (existing.owner?.ownerId !== owner.ownerId) {
        throw new Error("shared Provider lease ownership changed before release");
      }
      await rm(directory, { recursive: true });
    },
  };
}

async function inspectLease(directory: string): Promise<{ owner?: LeaseOwner; modifiedAt: number }> {
  const metadata = await stat(directory);
  try {
    const raw = JSON.parse(await readFile(resolve(directory, "owner.json"), "utf8")) as unknown;
    return { owner: parseOwner(raw), modifiedAt: metadata.mtimeMs };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return { modifiedAt: metadata.mtimeMs };
    throw error;
  }
}

function parseOwner(value: unknown): LeaseOwner {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("shared Provider lease owner is invalid");
  }
  const owner = value as Partial<LeaseOwner>;
  if (
    owner.version !== STATE_VERSION
    || typeof owner.ownerId !== "string"
    || !/^[a-f0-9-]{36}$/.test(owner.ownerId)
    || !Number.isInteger(owner.pid)
    || (owner.pid ?? 0) < 1
    || typeof owner.hostname !== "string"
    || typeof owner.acquiredAt !== "string"
  ) {
    throw new Error("shared Provider lease owner contract is invalid");
  }
  return owner as LeaseOwner;
}

function isStale(owner: LeaseOwner | undefined): boolean {
  if (owner === undefined) return true;
  if (owner.hostname !== hostname()) return false;
  try {
    process.kill(owner.pid, 0);
    return false;
  } catch (error) {
    return isNodeError(error) && error.code === "ESRCH";
  }
}

async function readLedger(path: string): Promise<UsageLedger> {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as Partial<UsageLedger>;
    if (
      raw.version !== STATE_VERSION
      || typeof raw.date !== "string"
      || !Number.isInteger(raw.requestCount)
      || (raw.requestCount ?? -1) < 0
      || !Number.isInteger(raw.totalTokens)
      || (raw.totalTokens ?? -1) < 0
      || !Number.isInteger(raw.unknownUsageCount)
      || (raw.unknownUsageCount ?? -1) < 0
      || (raw.lastRequestAt !== undefined && Number.isNaN(Date.parse(raw.lastRequestAt)))
    ) {
      throw new Error("shared Provider usage ledger is invalid");
    }
    if (raw.date !== today) return emptyLedger(today);
    return raw as UsageLedger;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return emptyLedger(today);
    throw error;
  }
}

async function saveLedger(path: string, ledger: UsageLedger): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(ledger, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  await rename(temporaryPath, path);
}

function emptyLedger(date: string): UsageLedger {
  return {
    version: STATE_VERSION,
    date,
    requestCount: 0,
    totalTokens: 0,
    unknownUsageCount: 0,
  };
}

function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (milliseconds <= 0 || signal?.aborted === true) return Promise.resolve();
  return new Promise((resolvePromise) => {
    const timer = setTimeout(finish, milliseconds);
    const abortListener = () => finish();
    function finish() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abortListener);
      resolvePromise();
    }
    signal?.addEventListener("abort", abortListener, { once: true });
  });
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
