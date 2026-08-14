export type DesktopBuildChannel = "dev" | "canary" | "beta" | "stable";

export interface DesktopBuildIdentity {
  version: string;
  channel: DesktopBuildChannel;
  sha: string;
  dirty: boolean;
  packaged: boolean;
}

export function parseDesktopBuildIdentity(
  value: unknown,
  runtimeVersion: string,
  packaged: boolean,
): DesktopBuildIdentity {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("build metadata must be an object");
  }
  const record = value as Record<string, unknown>;
  if (record.version !== runtimeVersion) {
    throw new Error("build metadata version does not match the packaged runtime");
  }
  if (record.channel !== "dev" && record.channel !== "canary"
    && record.channel !== "beta" && record.channel !== "stable") {
    throw new Error("build metadata channel is invalid");
  }
  if (typeof record.sha !== "string" || !/^[a-f0-9]{7,40}$/.test(record.sha)) {
    throw new Error("build metadata SHA is invalid");
  }
  if (typeof record.dirty !== "boolean") {
    throw new Error("build metadata dirty flag is invalid");
  }
  return {
    version: runtimeVersion,
    channel: record.channel,
    sha: record.sha,
    dirty: record.dirty,
    packaged,
  };
}

export function fallbackDesktopBuildIdentity(
  runtimeVersion: string,
  packaged: boolean,
): DesktopBuildIdentity {
  return {
    version: runtimeVersion,
    channel: packaged ? "stable" : "dev",
    sha: "unknown",
    dirty: true,
    packaged,
  };
}
