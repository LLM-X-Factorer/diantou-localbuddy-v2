import { writeFile, mkdir, readFile, realpath } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  session,
  shell,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
} from "electron";

import { normalizeRunExtensions, type RunExtensionSelection } from "../src/extension-config.js";
import { normalizeProviderSelection, type ProviderSelection } from "../src/provider-config.js";
import { createConfiguredProvider } from "../src/provider-factory.js";
import { ProcessSharedCapacity } from "../src/process-shared-provider.js";
import {
  DESKTOP_CHANNELS,
  type ApproveDesktopIntegrationRequest,
  type DesktopRunActionRequest,
  type RevertDesktopIntegrationRequest,
  type ResolveDesktopToolApprovalRequest,
  type StartDesktopRunRequest,
} from "../src/desktop-contract.js";
import { DesktopRunManager } from "../src/desktop-run-manager.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const rendererRoot = resolve(currentDirectory, "..", "renderer");
const preloadPath = resolve(currentDirectory, "preload.cjs");
const rendererUrl = "localbuddy://app/index.html";

protocol.registerSchemesAsPrivileged([{
  scheme: "localbuddy",
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: false,
    stream: true,
    codeCache: true,
  },
}]);
app.enableSandbox();
if (app.isPackaged && process.env.PLAYWRIGHT_BROWSERS_PATH === undefined) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = join(process.resourcesPath, "ms-playwright");
}

let mainWindow: BrowserWindow | null = null;
const runManager = new DesktopRunManager({
  createProvider(selection) {
    return createConfiguredProvider(selection);
  },
  oauthRedirectHandler(url) {
    return shell.openExternal(url.toString());
  },
  processTaskCapacity: process.env.LOCALBUDDY_SHARED_COORDINATION === "0"
    ? undefined
    : new ProcessSharedCapacity({
        namespace: "tasks",
        stateRoot: process.env.LOCALBUDDY_COORDINATION_ROOT,
        limit: desktopEnvironmentInteger("LOCALBUDDY_GLOBAL_TASK_CONCURRENCY", 3),
      }),
});

function desktopEnvironmentInteger(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a non-negative integer`);
  return Number.parseInt(value, 10);
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: "#f5f3ee",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());
  mainWindow.webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
    process.stderr.write(`Renderer load failed (${code}) ${description}; url=${url}; main=${isMainFrame}\n`);
  });
  mainWindow.webContents.on("preload-error", (_event, preload, error) => {
    process.stderr.write(`Renderer preload failed: ${preload}; ${error.message}\n`);
  });
  mainWindow.webContents.on("console-message", (details) => {
    if (details.level === "error" || details.level === "warning") {
      process.stderr.write(`Renderer ${details.level}: ${details.message}\n`);
    }
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== rendererUrl) {
      event.preventDefault();
    }
  });
  await mainWindow.loadURL(rendererUrl);
  await captureSmokeScreenshotIfRequested(mainWindow);
}

function registerRendererProtocol(): void {
  protocol.handle("localbuddy", async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== "app" || url.username.length > 0 || url.password.length > 0) {
      return new Response("Not found", { status: 404 });
    }
    let relativePath: string;
    try {
      relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    if (relativePath.includes("\0")) {
      return new Response("Bad request", { status: 400 });
    }
    const filePath = resolve(rendererRoot, relativePath);
    if (filePath !== rendererRoot && !filePath.startsWith(`${rendererRoot}${sep}`)) {
      return new Response("Forbidden", { status: 403 });
    }
    try {
      const body = await readFile(filePath);
      return new Response(new Uint8Array(body), {
        headers: {
          "Content-Type": rendererContentType(filePath),
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      if (isNodeError(error) && (error.code === "ENOENT" || error.code === "EISDIR")) {
        return new Response("Not found", { status: 404 });
      }
      throw error;
    }
  });
}

function rendererContentType(filePath: string): string {
  switch (extname(filePath)) {
    case ".html": return "text/html; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".svg": return "image/svg+xml";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    case ".woff2": return "font/woff2";
    default: return "application/octet-stream";
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle(DESKTOP_CHANNELS.bootstrap, async (event) => {
    assertTrustedSender(event);
    const workspace = resolve(
      process.env.LOCALBUDDY_DEFAULT_WORKSPACE ?? app.getPath("documents"),
    );
    return { workspace, runs: await runManager.list(workspace) };
  });

  ipcMain.handle(DESKTOP_CHANNELS.selectWorkspace, async (event) => {
    assertTrustedSender(event);
    const options: OpenDialogOptions = {
      title: "选择 LocalBuddy 工作区",
      properties: ["openDirectory", "createDirectory"],
    };
    const result = mainWindow === null
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(mainWindow, options);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle(DESKTOP_CHANNELS.listRuns, async (event, workspace: unknown) => {
    assertTrustedSender(event);
    return runManager.list(expectString(workspace, "workspace"));
  });

  ipcMain.handle(DESKTOP_CHANNELS.startRun, async (event, request: unknown) => {
    assertTrustedSender(event);
    return runManager.start(parseStartRequest(request));
  });

  ipcMain.handle(DESKTOP_CHANNELS.cancelRun, async (event, runId: unknown) => {
    assertTrustedSender(event);
    runManager.cancel(expectString(runId, "runId"));
  });

  ipcMain.handle(DESKTOP_CHANNELS.restartRun, async (event, request: unknown) => {
    assertTrustedSender(event);
    return runManager.restartRun(parseRunActionRequest(request));
  });

  ipcMain.handle(DESKTOP_CHANNELS.resumeRun, async (event, request: unknown) => {
    assertTrustedSender(event);
    return runManager.resumeRun(parseRunActionRequest(request));
  });

  ipcMain.handle(DESKTOP_CHANNELS.cleanupWorktrees, async (event, request: unknown) => {
    assertTrustedSender(event);
    const parsed = parseRunActionRequest(request);
    const options: Electron.MessageBoxOptions = {
      type: "warning",
      title: "清理 LocalBuddy 隔离工作树",
      message: "确认删除这个 Run 保留的 detached worktree 吗？",
      detail: "未提交的隔离区改动会被删除；补丁产物、Run Request 和事件日志会继续保留。受保护的集成状态不会执行清理。",
      buttons: ["取消", "确认清理"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    };
    const confirmation = mainWindow === null
      ? await dialog.showMessageBox(options)
      : await dialog.showMessageBox(mainWindow, options);
    if (confirmation.response !== 1) {
      return null;
    }
    return runManager.cleanupWorktrees(parsed);
  });

  ipcMain.handle(DESKTOP_CHANNELS.approveIntegration, async (event, request: unknown) => {
    assertTrustedSender(event);
    const parsed = parseApproveIntegrationRequest(request);
    const confirmation = mainWindow === null
      ? await dialog.showMessageBox(integrationApprovalDialog(parsed))
      : await dialog.showMessageBox(mainWindow, integrationApprovalDialog(parsed));
    if (confirmation.response !== 1) {
      return null;
    }
    return runManager.approveIntegration(parsed);
  });

  ipcMain.handle(DESKTOP_CHANNELS.revertIntegration, async (event, request: unknown) => {
    assertTrustedSender(event);
    const parsed = parseRevertIntegrationRequest(request);
    const options: Electron.MessageBoxOptions = {
      type: "warning",
      title: "撤销 LocalBuddy 集成",
      message: "确认反向撤销这次未提交的集成吗？",
      detail: "只有当主工作区仍与已批准补丁完全一致时才会执行。",
      buttons: ["取消", "确认撤销"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    };
    const confirmation = mainWindow === null
      ? await dialog.showMessageBox(options)
      : await dialog.showMessageBox(mainWindow, options);
    if (confirmation.response !== 1) {
      return null;
    }
    return runManager.revertIntegration(parsed);
  });

  ipcMain.handle(DESKTOP_CHANNELS.resolveToolApproval, async (event, request: unknown) => {
    assertTrustedSender(event);
    return runManager.resolveToolApproval(parseResolveToolApprovalRequest(request));
  });

  ipcMain.handle(
    DESKTOP_CHANNELS.openArtifact,
    async (event, workspaceValue: unknown, pathValue: unknown) => {
      assertTrustedSender(event);
      const workspace = await realpath(expectString(workspaceValue, "workspace"));
      const artifactPath = await realpath(expectString(pathValue, "absolutePath"));
      const allowedRoot = resolve(workspace, ".localbuddy", "runs");
      if (!artifactPath.startsWith(`${allowedRoot}${sep}`)) {
        throw new Error("Artifact path is outside this workspace's LocalBuddy run directory");
      }
      const message = await shell.openPath(artifactPath);
      if (message.length > 0) {
        throw new Error(message);
      }
    },
  );

  runManager.subscribe((run) => {
    if (mainWindow !== null && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(DESKTOP_CHANNELS.runUpdated, run);
    }
  });
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const senderUrl = event.senderFrame?.url;
  if (senderUrl !== rendererUrl) {
    throw new Error("Rejected IPC call from an untrusted frame");
  }
}

function parseStartRequest(value: unknown): StartDesktopRunRequest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("start request must be an object");
  }
  const record = value as Record<string, unknown>;
  return {
    workspace: expectString(record.workspace, "workspace"),
    goal: expectString(record.goal, "goal"),
    concurrency: expectNumber(record.concurrency, "concurrency"),
    mode: expectMode(record.mode),
    provider: parseProviderSelection(record.provider),
    extensions: parseRunExtensions(record.extensions),
  };
}

function parseProviderSelection(value: unknown): ProviderSelection | undefined {
  if (value === undefined) return undefined;
  const record = expectRecord(value, "provider");
  return normalizeProviderSelection({
    id: expectString(record.id, "provider.id") as ProviderSelection["id"],
    model: expectOptionalString(record.model, "provider.model"),
    baseUrl: expectOptionalString(record.baseUrl, "provider.baseUrl"),
  });
}

function parseRunExtensions(value: unknown): RunExtensionSelection | undefined {
  if (value === undefined) return undefined;
  const record = expectRecord(value, "extensions");
  let browser: RunExtensionSelection["browser"];
  if (record.browser !== undefined) {
    const browserRecord = expectRecord(record.browser, "extensions.browser");
    browser = {
      allowedOrigins: expectStringArray(browserRecord.allowedOrigins, "extensions.browser.allowedOrigins"),
      allowActions: expectOptionalBoolean(browserRecord.allowActions, "extensions.browser.allowActions"),
    };
  }
  return normalizeRunExtensions({
    skillIds: expectOptionalStringArray(record.skillIds, "extensions.skillIds"),
    mcpServerIds: expectOptionalStringArray(record.mcpServerIds, "extensions.mcpServerIds"),
    allowMcpWrites: expectOptionalBoolean(record.allowMcpWrites, "extensions.allowMcpWrites"),
    browser,
  });
}

function parseApproveIntegrationRequest(value: unknown): ApproveDesktopIntegrationRequest {
  const record = expectRecord(value, "integration approval request");
  const commitMessage = record.commitMessage;
  if (commitMessage !== undefined && typeof commitMessage !== "string") {
    throw new Error("commitMessage must be a string");
  }
  return {
    workspace: expectString(record.workspace, "workspace"),
    runId: expectString(record.runId, "runId"),
    commitMessage,
  };
}

function parseRevertIntegrationRequest(value: unknown): RevertDesktopIntegrationRequest {
  const record = expectRecord(value, "integration revert request");
  return {
    workspace: expectString(record.workspace, "workspace"),
    runId: expectString(record.runId, "runId"),
  };
}

function parseResolveToolApprovalRequest(value: unknown): ResolveDesktopToolApprovalRequest {
  const record = expectRecord(value, "tool approval request");
  const decision = expectString(record.decision, "decision");
  if (decision !== "approve" && decision !== "deny") {
    throw new Error("decision must be approve or deny");
  }
  return {
    workspace: expectString(record.workspace, "workspace"),
    runId: expectString(record.runId, "runId"),
    approvalId: expectString(record.approvalId, "approvalId"),
    decision,
  };
}

function parseRunActionRequest(value: unknown): DesktopRunActionRequest {
  const record = expectRecord(value, "Run action request");
  return {
    workspace: expectString(record.workspace, "workspace"),
    runId: expectString(record.runId, "runId"),
  };
}

function integrationApprovalDialog(
  request: ApproveDesktopIntegrationRequest,
): Electron.MessageBoxOptions {
  const willCommit = request.commitMessage !== undefined;
  return {
    type: "warning",
    title: "批准 LocalBuddy 集成",
    message: willCommit ? "确认应用补丁并创建 Git commit 吗？" : "确认把补丁写入主工作区吗？",
    detail: willCommit
      ? "系统会再次核对 HEAD、clean 状态和补丁哈希，然后应用并提交。"
      : "系统会再次核对 HEAD、clean 状态和补丁哈希；应用后改动保持未提交，可在未继续编辑时撤销。",
    buttons: ["取消", willCommit ? "批准并提交" : "批准写回"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
}

function expectRecord(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function expectMode(value: unknown): StartDesktopRunRequest["mode"] {
  if (value === undefined || value === "research" || value === "code") {
    return value;
  }
  throw new Error("mode must be research or code");
}

function expectString(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string`);
  }
  return value;
}

function expectNumber(value: unknown, name: string): number {
  if (typeof value !== "number") {
    throw new Error(`${name} must be a number`);
  }
  return value;
}

function expectOptionalString(value: unknown, name: string): string | undefined {
  return value === undefined ? undefined : expectString(value, name);
}

function expectStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${name} must be an array of strings`);
  }
  return value as string[];
}

function expectOptionalStringArray(value: unknown, name: string): string[] | undefined {
  return value === undefined ? undefined : expectStringArray(value, name);
}

function expectOptionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value !== undefined && typeof value !== "boolean") throw new Error(`${name} must be a boolean`);
  return value;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function captureSmokeScreenshotIfRequested(window: BrowserWindow): Promise<void> {
  const target = process.env.LOCALBUDDY_SCREENSHOT_PATH;
  if (target === undefined) {
    return;
  }
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
  const diagnostics = await window.webContents.executeJavaScript(`({
    url: location.href,
    title: document.title,
    bodyCharacters: document.body?.innerText?.length ?? -1,
    api: typeof globalThis.localbuddy,
    rootChildren: document.getElementById("root")?.childElementCount ?? -1
  })`);
  const image = await window.webContents.capturePage();
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, image.toPNG());
  await writeFile(`${target}.json`, `${JSON.stringify(diagnostics, null, 2)}\n`, "utf8");
  app.quit();
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow !== null) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    registerRendererProtocol();
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false);
    });
    registerIpcHandlers();
    await createWindow();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
