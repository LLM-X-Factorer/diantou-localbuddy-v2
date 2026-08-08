import { createHash, createPublicKey, randomUUID, verify } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024 * 1024;

export interface UpdateArtifact {
  platform: "darwin" | "win32" | "linux";
  arch: "arm64" | "x64";
  url: string;
  sha256: string;
  bytes: number;
  fileName: string;
}

export interface SignedUpdateManifest {
  version: 1;
  product: "com.diantou.localbuddy";
  releaseVersion: string;
  minRuntimeVersion: string;
  publishedAt: string;
  artifacts: readonly UpdateArtifact[];
  signature: string;
}

export interface StagedUpdate {
  releaseVersion: string;
  artifactPath: string;
  artifactSha256: string;
  manifestSha256: string;
  automaticInstallAllowed: false;
}

export async function fetchAndStageUpdate(input: {
  manifestUrl: string;
  publicKeyBase64: string;
  currentVersion: string;
  stageRoot: string;
  platform?: NodeJS.Platform;
  arch?: string;
  fetchFn?: typeof fetch;
}): Promise<StagedUpdate> {
  const fetchFn = input.fetchFn ?? fetch;
  const manifestUrl = validatedDownloadUrl(input.manifestUrl);
  const response = await fetchFn(manifestUrl, { headers: { accept: "application/json" } });
  validateResponseUrl(response);
  if (!response.ok) throw new Error(`update manifest download failed with HTTP ${response.status}`);
  const raw = await readBoundedResponse(response, MAX_MANIFEST_BYTES);
  const manifest = parseAndVerifyUpdateManifest(raw, input.publicKeyBase64);
  assertSemver(input.currentVersion, "current runtime version");
  if (compareSemver(input.currentVersion, manifest.minRuntimeVersion) < 0) {
    throw new Error(`update requires LocalBuddy ${manifest.minRuntimeVersion} or newer`);
  }
  if (compareSemver(manifest.releaseVersion, input.currentVersion) <= 0) {
    throw new Error(`manifest ${manifest.releaseVersion} is not newer than ${input.currentVersion}`);
  }
  const platform = normalizePlatform(input.platform ?? process.platform);
  const arch = normalizeArch(input.arch ?? process.arch);
  const artifact = manifest.artifacts.find((candidate) => candidate.platform === platform && candidate.arch === arch);
  if (artifact === undefined) throw new Error(`manifest has no artifact for ${platform}/${arch}`);

  const stageRoot = resolve(input.stageRoot);
  await mkdir(stageRoot, { recursive: true, mode: 0o700 });
  const statePath = resolve(stageRoot, "update-state.json");
  const state = await loadUpdateState(statePath);
  if (state.highestSeenVersion !== undefined
    && compareSemver(manifest.releaseVersion, state.highestSeenVersion) < 0) {
    throw new Error(`rollback manifest rejected: ${manifest.releaseVersion} < ${state.highestSeenVersion}`);
  }
  const artifactResponse = await fetchFn(validatedDownloadUrl(artifact.url));
  validateResponseUrl(artifactResponse);
  if (!artifactResponse.ok) throw new Error(`update artifact download failed with HTTP ${artifactResponse.status}`);
  const bytes = await readBoundedResponse(artifactResponse, Math.min(MAX_ARTIFACT_BYTES, artifact.bytes));
  if (bytes.length !== artifact.bytes) {
    throw new Error(`update artifact size mismatch: expected ${artifact.bytes}, got ${bytes.length}`);
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== artifact.sha256) throw new Error("update artifact SHA-256 mismatch");
  const destinationRoot = resolve(stageRoot, "staged", manifest.releaseVersion, `${platform}-${arch}`);
  await mkdir(destinationRoot, { recursive: true, mode: 0o700 });
  const artifactPath = resolve(destinationRoot, artifact.fileName);
  if (basename(artifactPath) !== artifact.fileName) throw new Error("unsafe update artifact file name");
  const temporary = `${artifactPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
  await rename(temporary, artifactPath);
  const manifestSha256 = createHash("sha256").update(raw).digest("hex");
  await atomicJson(statePath, {
    version: 1,
    highestSeenVersion: maxVersion(state.highestSeenVersion, manifest.releaseVersion),
    stagedVersion: manifest.releaseVersion,
    stagedArtifactSha256: digest,
    stagedManifestSha256: manifestSha256,
    stagedAt: new Date().toISOString(),
  });
  return {
    releaseVersion: manifest.releaseVersion,
    artifactPath,
    artifactSha256: digest,
    manifestSha256,
    automaticInstallAllowed: false,
  };
}

export function parseAndVerifyUpdateManifest(
  raw: Uint8Array | string,
  publicKeyBase64: string,
): SignedUpdateManifest {
  const bytes = typeof raw === "string" ? Buffer.from(raw) : Buffer.from(raw);
  if (bytes.length > MAX_MANIFEST_BYTES) throw new Error("update manifest is too large");
  const value = JSON.parse(bytes.toString("utf8")) as unknown;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("update manifest must be an object");
  }
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || record.product !== "com.diantou.localbuddy") {
    throw new Error("unsupported update manifest identity");
  }
  const releaseVersion = assertSemver(record.releaseVersion, "releaseVersion");
  const minRuntimeVersion = assertSemver(record.minRuntimeVersion, "minRuntimeVersion");
  const publishedAt = boundedString(record.publishedAt, "publishedAt", 100);
  if (Number.isNaN(Date.parse(publishedAt))) throw new Error("publishedAt must be an ISO timestamp");
  if (!Array.isArray(record.artifacts) || record.artifacts.length < 1 || record.artifacts.length > 12) {
    throw new Error("update manifest artifacts are invalid");
  }
  const artifacts = record.artifacts.map(parseArtifact);
  const targets = new Set(artifacts.map((artifact) => `${artifact.platform}/${artifact.arch}`));
  if (targets.size !== artifacts.length) throw new Error("update manifest contains duplicate targets");
  const signature = boundedString(record.signature, "signature", 500);
  const manifest: SignedUpdateManifest = {
    version: 1,
    product: "com.diantou.localbuddy",
    releaseVersion,
    minRuntimeVersion,
    publishedAt,
    artifacts,
    signature,
  };
  const key = createPublicKey({
    key: Buffer.from(publicKeyBase64, "base64"),
    format: "der",
    type: "spki",
  });
  if (key.asymmetricKeyType !== "ed25519") throw new Error("update key must be Ed25519");
  if (!verify(null, Buffer.from(canonicalManifest(manifest)), key, Buffer.from(signature, "base64"))) {
    throw new Error("update manifest signature is invalid");
  }
  return manifest;
}

export function canonicalManifest(manifest: Omit<SignedUpdateManifest, "signature"> | SignedUpdateManifest): string {
  return JSON.stringify({
    version: 1,
    product: "com.diantou.localbuddy",
    releaseVersion: manifest.releaseVersion,
    minRuntimeVersion: manifest.minRuntimeVersion,
    publishedAt: manifest.publishedAt,
    artifacts: manifest.artifacts.map((artifact) => ({
      platform: artifact.platform,
      arch: artifact.arch,
      url: artifact.url,
      sha256: artifact.sha256,
      bytes: artifact.bytes,
      fileName: artifact.fileName,
    })),
  });
}

function parseArtifact(value: unknown): UpdateArtifact {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid update artifact");
  const record = value as Record<string, unknown>;
  const platform = normalizePlatform(record.platform);
  const arch = normalizeArch(record.arch);
  const url = validatedDownloadUrl(boundedString(record.url, "artifact.url", 4_000)).toString();
  const sha256 = boundedString(record.sha256, "artifact.sha256", 64);
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error("artifact.sha256 is invalid");
  if (!Number.isInteger(record.bytes) || Number(record.bytes) < 1 || Number(record.bytes) > MAX_ARTIFACT_BYTES) {
    throw new Error("artifact.bytes is invalid");
  }
  const fileName = boundedString(record.fileName, "artifact.fileName", 240);
  if (basename(fileName) !== fileName || fileName === "." || fileName === "..") {
    throw new Error("artifact.fileName is unsafe");
  }
  return { platform, arch, url, sha256, bytes: Number(record.bytes), fileName };
}

function validatedDownloadUrl(value: string | URL): URL {
  const url = new URL(value);
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("update URLs must use HTTPS or loopback HTTP");
  }
  if (url.username || url.password || url.hash) throw new Error("update URL contains forbidden components");
  return url;
}

function validateResponseUrl(response: Response): void {
  if (response.url.length > 0) validatedDownloadUrl(response.url);
}

async function readBoundedResponse(response: Response, limit: number): Promise<Buffer> {
  if (response.body === null) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk);
    total += buffer.length;
    if (total > limit) {
      await response.body.cancel().catch(() => undefined);
      throw new Error(`download exceeds ${limit} bytes`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

interface UpdateState {
  version: 1;
  highestSeenVersion?: string;
}

async function loadUpdateState(path: string): Promise<UpdateState> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as UpdateState;
    if (value.version !== 1 || (value.highestSeenVersion !== undefined
      && !/^\d+\.\d+\.\d+$/.test(value.highestSeenVersion))) {
      throw new Error("invalid update state");
    }
    return value;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return { version: 1 };
    throw error;
  }
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  await rename(temporary, path);
}

function assertSemver(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^\d+\.\d+\.\d+$/.test(value)) throw new Error(`${name} must be x.y.z`);
  return value;
}

function compareSemver(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

function maxVersion(current: string | undefined, candidate: string): string {
  return current === undefined || compareSemver(candidate, current) > 0 ? candidate : current;
}

function normalizePlatform(value: unknown): UpdateArtifact["platform"] {
  if (value !== "darwin" && value !== "win32" && value !== "linux") throw new Error("unsupported update platform");
  return value;
}

function normalizeArch(value: unknown): UpdateArtifact["arch"] {
  if (value !== "arm64" && value !== "x64") throw new Error("unsupported update architecture");
  return value;
}

function boundedString(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > max || /[\r\n\0]/.test(value)) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
