import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { AgentId, RunId, TaskId } from "./domain.js";

export interface CalculationRecord {
  id: string;
  runId: RunId;
  taskId: TaskId;
  agentId: AgentId;
  toolName: string;
  operation: string;
  inputs: Record<string, string>;
  outputs: Record<string, string>;
}

export interface CalculationRegistry {
  add(record: CalculationRecord): Promise<void>;
  list(runId?: RunId): Promise<readonly CalculationRecord[]>;
}

export class InMemoryCalculationRegistry implements CalculationRegistry {
  readonly #records = new Map<string, CalculationRecord>();

  async add(record: CalculationRecord): Promise<void> {
    this.#records.set(`${record.runId}:${record.id}`, record);
  }

  async list(runId?: RunId): Promise<readonly CalculationRecord[]> {
    return [...this.#records.values()].filter(
      (record) => runId === undefined || record.runId === runId,
    );
  }
}

export class JsonCalculationRegistry implements CalculationRegistry {
  readonly #filePath: string;
  #pending: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.#filePath = filePath;
  }

  add(record: CalculationRecord): Promise<void> {
    return this.#serialize(async () => {
      const records = [...await this.#read()];
      const existing = records.find((candidate) =>
        candidate.runId === record.runId && candidate.id === record.id,
      );
      if (existing !== undefined) {
        if (JSON.stringify(existing) !== JSON.stringify(record)) {
          throw new Error(`calculation registry conflict for ${record.id}`);
        }
        return;
      }
      records.push(record);
      await writeJsonAtomic(this.#filePath, records);
    });
  }

  async list(runId?: RunId): Promise<readonly CalculationRecord[]> {
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

  async #read(): Promise<CalculationRecord[]> {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(this.#filePath, "utf8")) as unknown;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
    if (!Array.isArray(raw)) {
      throw new Error("calculation registry must be an array");
    }
    return raw.map(parseCalculationRecord);
  }
}

function parseCalculationRecord(value: unknown): CalculationRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("calculation registry record must be an object");
  }
  const record = value as Partial<CalculationRecord>;
  if (
    typeof record.id !== "string"
    || typeof record.runId !== "string"
    || typeof record.taskId !== "string"
    || typeof record.agentId !== "string"
    || typeof record.toolName !== "string"
    || typeof record.operation !== "string"
    || !isStringRecord(record.inputs)
    || !isStringRecord(record.outputs)
  ) {
    throw new Error("calculation registry record has an invalid contract");
  }
  return record as CalculationRecord;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.values(value).every((item) => typeof item === "string");
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  await rename(temporaryPath, filePath);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
