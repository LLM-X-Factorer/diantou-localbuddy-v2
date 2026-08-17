import { readFile } from "node:fs/promises";

import type { AgentId, RunId, TaskId } from "./domain.js";
import { assertPrivateFileIfPresent, writePrivateJsonAtomic } from "./private-storage.js";

export interface ArtifactRecord {
  runId: RunId;
  taskId: TaskId;
  agentId: AgentId;
  relativePath: string;
  absolutePath: string;
  mediaType: string;
  bytes: number;
  sha256: string;
}

export interface ArtifactRegistry {
  add(record: ArtifactRecord): Promise<void>;
  list(runId?: RunId): Promise<readonly ArtifactRecord[]>;
}

export class InMemoryArtifactRegistry implements ArtifactRegistry {
  readonly #records: ArtifactRecord[] = [];

  async add(record: ArtifactRecord): Promise<void> {
    this.#records.push(record);
  }

  async list(runId?: RunId): Promise<readonly ArtifactRecord[]> {
    return this.#records.filter((record) => runId === undefined || record.runId === runId);
  }
}

export class JsonArtifactRegistry implements ArtifactRegistry {
  readonly #filePath: string;
  #pending: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.#filePath = filePath;
  }

  add(record: ArtifactRecord): Promise<void> {
    return this.#serialize(async () => {
      const records = [...await this.#read()];
      const existing = records.find((candidate) =>
        candidate.runId === record.runId && candidate.absolutePath === record.absolutePath,
      );
      if (existing !== undefined) {
        if (existing.sha256 !== record.sha256 || existing.bytes !== record.bytes) {
          throw new Error(`artifact registry conflict for ${record.absolutePath}`);
        }
        return;
      }
      records.push(record);
      await writeJsonAtomic(this.#filePath, records);
    });
  }

  async list(runId?: RunId): Promise<readonly ArtifactRecord[]> {
    await this.#pending;
    return (await this.#read()).filter(
      (record) => runId === undefined || record.runId === runId,
    );
  }

  #serialize(operation: () => Promise<void>): Promise<void> {
    const result = this.#pending.then(operation);
    this.#pending = result.catch(() => undefined);
    return result;
  }

  async #read(): Promise<ArtifactRecord[]> {
    let raw: unknown;
    try {
      await assertPrivateFileIfPresent(this.#filePath);
      raw = JSON.parse(await readFile(this.#filePath, "utf8")) as unknown;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
    if (!Array.isArray(raw)) {
      throw new Error("artifact registry must be an array");
    }
    return raw.map(parseArtifactRecord);
  }
}

function parseArtifactRecord(value: unknown): ArtifactRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("artifact registry record must be an object");
  }
  const record = value as Partial<ArtifactRecord>;
  if (
    typeof record.runId !== "string"
    || typeof record.taskId !== "string"
    || typeof record.agentId !== "string"
    || typeof record.relativePath !== "string"
    || typeof record.absolutePath !== "string"
    || typeof record.mediaType !== "string"
    || typeof record.bytes !== "number"
    || typeof record.sha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(record.sha256)
  ) {
    throw new Error("artifact registry record has an invalid contract");
  }
  return record as ArtifactRecord;
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await writePrivateJsonAtomic(filePath, value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
