import { contextBridge, ipcRenderer } from "electron";

import {
  type DesktopApi,
  type DesktopRunView,
} from "../src/desktop-contract.js";

// Keep the sandboxed preload runtime dependent on Electron only. The values
// mirror DESKTOP_CHANNELS and are covered by the desktop build/smoke test.
const CHANNELS = {
  bootstrap: "localbuddy:bootstrap",
  selectWorkspace: "localbuddy:select-workspace",
  listRuns: "localbuddy:list-runs",
  startRun: "localbuddy:start-run",
  cancelRun: "localbuddy:cancel-run",
  resumeRun: "localbuddy:resume-run",
  restartRun: "localbuddy:restart-run",
  cleanupWorktrees: "localbuddy:cleanup-worktrees",
  approveIntegration: "localbuddy:approve-integration",
  revertIntegration: "localbuddy:revert-integration",
  resolveToolApproval: "localbuddy:resolve-tool-approval",
  openArtifact: "localbuddy:open-artifact",
  runUpdated: "localbuddy:run-updated",
} as const;

const api: DesktopApi = {
  bootstrap: () => ipcRenderer.invoke(CHANNELS.bootstrap),
  selectWorkspace: () => ipcRenderer.invoke(CHANNELS.selectWorkspace),
  listRuns: (workspace) => ipcRenderer.invoke(CHANNELS.listRuns, workspace),
  startRun: (request) => ipcRenderer.invoke(CHANNELS.startRun, request),
  cancelRun: (runId) => ipcRenderer.invoke(CHANNELS.cancelRun, runId),
  resumeRun: (request) => ipcRenderer.invoke(CHANNELS.resumeRun, request),
  restartRun: (request) => ipcRenderer.invoke(CHANNELS.restartRun, request),
  cleanupWorktrees: (request) => ipcRenderer.invoke(CHANNELS.cleanupWorktrees, request),
  approveIntegration: (request) => ipcRenderer.invoke(CHANNELS.approveIntegration, request),
  revertIntegration: (request) => ipcRenderer.invoke(CHANNELS.revertIntegration, request),
  resolveToolApproval: (request) => ipcRenderer.invoke(CHANNELS.resolveToolApproval, request),
  openArtifact: (workspace, absolutePath) =>
    ipcRenderer.invoke(CHANNELS.openArtifact, workspace, absolutePath),
  onRunUpdate(listener) {
    const wrapped = (_event: Electron.IpcRendererEvent, run: DesktopRunView) => listener(run);
    ipcRenderer.on(CHANNELS.runUpdated, wrapped);
    return () => ipcRenderer.removeListener(CHANNELS.runUpdated, wrapped);
  },
};

contextBridge.exposeInMainWorld("localbuddy", api);
