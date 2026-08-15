import { createHash } from "node:crypto";
import { extname, isAbsolute } from "node:path";

export interface ArtifactContinuationRequest {
  parentRunId: string;
  parentFileName: string;
  parentSha256: string;
  reason: string;
}

export interface ArtifactRevisionContract extends ArtifactContinuationRequest {
  version: 1;
  threadId: string;
  revision: number;
  sourceRelativePath: string;
}

const MAX_REASON_CHARACTERS = 4_000;
const RUN_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const THREAD_ID_PATTERN = /^thread-[a-f0-9]{24}$/;

export function normalizeArtifactContinuation(
  input: ArtifactContinuationRequest,
): ArtifactContinuationRequest {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Artifact continuation must be an object");
  }
  const parentRunId = normalizeRunId(input.parentRunId, "Artifact parent Run id");
  const parentFileName = normalizeRelativePath(input.parentFileName, "Artifact parent file name");
  if (typeof input.parentSha256 !== "string" || !SHA256_PATTERN.test(input.parentSha256)) {
    throw new Error("Artifact parent SHA-256 must be a lowercase 64-character digest");
  }
  if (typeof input.reason !== "string") {
    throw new Error("Artifact revision reason must be a string");
  }
  const reason = input.reason.trim();
  if (reason.length === 0 || reason.length > MAX_REASON_CHARACTERS) {
    throw new Error(
      `Artifact revision reason must contain between 1 and ${MAX_REASON_CHARACTERS} characters`,
    );
  }
  return {
    parentRunId,
    parentFileName,
    parentSha256: input.parentSha256,
    reason,
  };
}

export function createArtifactRevision(
  input: ArtifactContinuationRequest,
  parentRevision?: ArtifactRevisionContract,
): ArtifactRevisionContract {
  const continuation = normalizeArtifactContinuation(input);
  const parent = parentRevision === undefined
    ? undefined
    : normalizeArtifactRevision(parentRevision);
  const extension = safeArtifactExtension(continuation.parentFileName);
  return {
    version: 1,
    threadId: parent?.threadId ?? artifactThreadId(continuation),
    revision: (parent?.revision ?? 1) + 1,
    ...continuation,
    sourceRelativePath: `revision-source/parent-artifact${extension}`,
  };
}

export function normalizeArtifactRevision(
  input: ArtifactRevisionContract,
): ArtifactRevisionContract {
  const continuation = normalizeArtifactContinuation(input);
  if (input.version !== 1) {
    throw new Error("Artifact revision contract version must be 1");
  }
  if (typeof input.threadId !== "string" || !THREAD_ID_PATTERN.test(input.threadId)) {
    throw new Error("Artifact revision thread id has an invalid contract");
  }
  if (!Number.isInteger(input.revision) || input.revision < 2) {
    throw new Error("Artifact revision number must be an integer of at least 2");
  }
  const sourceRelativePath = normalizeRelativePath(
    input.sourceRelativePath,
    "Artifact revision source path",
  );
  if (!sourceRelativePath.startsWith("revision-source/")) {
    throw new Error("Artifact revision source must stay inside revision-source");
  }
  return {
    version: 1,
    threadId: input.threadId,
    revision: input.revision,
    ...continuation,
    sourceRelativePath,
  };
}

export function artifactThreadId(input: ArtifactContinuationRequest): string {
  const continuation = normalizeArtifactContinuation(input);
  const digest = createHash("sha256")
    .update(JSON.stringify({
      runId: continuation.parentRunId,
      fileName: continuation.parentFileName,
      sha256: continuation.parentSha256,
    }))
    .digest("hex");
  return `thread-${digest.slice(0, 24)}`;
}

function normalizeRunId(value: string, label: string): string {
  if (typeof value !== "string" || !RUN_ID_PATTERN.test(value)) {
    throw new Error(`${label} contains unsafe characters`);
  }
  return value;
}

function normalizeRelativePath(value: string, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0") || isAbsolute(value)) {
    throw new Error(`${label} must be a non-empty relative path`);
  }
  const normalized = value.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new Error(`${label} contains unsafe segments`);
  }
  return normalized;
}

function safeArtifactExtension(fileName: string): string {
  const extension = extname(fileName).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : ".txt";
}
