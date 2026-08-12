import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const DEFAULT_LIMIT = 5;

export class RecentWorkspaceStore {
  readonly #filePath: string;
  readonly #limit: number;
  #pending: Promise<void> = Promise.resolve();

  constructor(filePath: string, limit = DEFAULT_LIMIT) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
      throw new Error("recent workspace limit must be between 1 and 20");
    }
    this.#filePath = filePath;
    this.#limit = limit;
  }

  async list(): Promise<readonly string[]> {
    await this.#pending;
    try {
      const value = JSON.parse(await readFile(this.#filePath, "utf8")) as unknown;
      if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
        throw new Error("recent workspace store must be an array of paths");
      }
      return [...new Set(value.map((item) => resolve(item)))].slice(0, this.#limit);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return [];
      throw error;
    }
  }

  remember(workspace: string): Promise<void> {
    const canonical = resolve(workspace);
    const operation = this.#pending.then(async () => {
      const current = await this.#listWithoutWaiting();
      await this.#write([canonical, ...current.filter((item) => item !== canonical)].slice(0, this.#limit));
    });
    this.#pending = operation.catch(() => undefined);
    return operation;
  }

  async #listWithoutWaiting(): Promise<string[]> {
    try {
      const value = JSON.parse(await readFile(this.#filePath, "utf8")) as unknown;
      if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
        throw new Error("recent workspace store must be an array of paths");
      }
      return [...new Set(value.map((item) => resolve(item)))].slice(0, this.#limit);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return [];
      throw error;
    }
  }

  async #write(value: readonly string[]): Promise<void> {
    const temporaryPath = `${this.#filePath}.${process.pid}.${randomUUID()}.tmp`;
    await mkdir(dirname(this.#filePath), { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryPath, this.#filePath);
    if (process.platform !== "win32") await chmod(this.#filePath, 0o600);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
