export type WorkspaceStorageRisk = "cloud_sync" | "network_workspace";

export interface WorkspaceStorageAssessment {
  runStoreRoot: string;
  artifactLocation: string;
  credentialLocation: "system_vault";
  risk: "local_workspace" | "review_required";
  warnings: readonly WorkspaceStorageRisk[];
}
