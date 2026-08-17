import { resolve } from "node:path";
import type {
  WorkspaceStorageAssessment,
  WorkspaceStorageRisk,
} from "./workspace-storage-contract.js";

export type { WorkspaceStorageAssessment, WorkspaceStorageRisk } from "./workspace-storage-contract.js";

export function assessWorkspaceStorage(
  workspace: string,
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): WorkspaceStorageAssessment {
  if (workspace.length === 0) {
    return {
      runStoreRoot: "",
      artifactLocation: "",
      credentialLocation: "system_vault",
      risk: "local_workspace",
      warnings: [],
    };
  }
  const warnings = new Set<WorkspaceStorageRisk>();
  if (isRecognizedCloudPath(workspace, environment)) warnings.add("cloud_sync");
  if (platform === "win32" && /^(?:\\\\|\/\/)/.test(workspace)) {
    warnings.add("network_workspace");
  }
  const runStoreRoot = resolve(workspace, ".localbuddy", "runs");
  return {
    runStoreRoot,
    artifactLocation: resolve(runStoreRoot, "<run-id>", "artifacts"),
    credentialLocation: "system_vault",
    risk: warnings.size === 0 ? "local_workspace" : "review_required",
    warnings: [...warnings],
  };
}

function isRecognizedCloudPath(workspace: string, environment: NodeJS.ProcessEnv): boolean {
  const normalized = normalizePath(workspace);
  if ([
    "/onedrive/",
    "/dropbox/",
    "/google drive/",
    "/googledrive/",
    "/library/cloudstorage/",
    "/library/mobile documents/",
    "/box/",
    "/synologydrive/",
  ].some((marker) => `${normalized}/`.includes(marker))) {
    return true;
  }
  const configuredRoots = [
    environment.OneDrive,
    environment.OneDriveCommercial,
    environment.OneDriveConsumer,
    environment.DROPBOX_PATH,
    environment.GOOGLE_DRIVE_PATH,
    environment.LOCALBUDDY_SYNC_ROOTS,
  ].flatMap((value) => value?.split(/[;\n]/u) ?? []);
  return configuredRoots.some((root) => {
    const candidate = normalizePath(root);
    return candidate.length > 0 && (normalized === candidate || normalized.startsWith(`${candidate}/`));
  });
}

function normalizePath(value: string): string {
  return value.trim().replaceAll("\\", "/").replace(/\/+$/u, "").toLowerCase();
}
