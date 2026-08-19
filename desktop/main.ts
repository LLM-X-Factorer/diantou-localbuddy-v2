import { chmodSync, mkdirSync } from "node:fs";
import { chmod, writeFile, mkdir, readFile, realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
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

const requireForSquirrel = createRequire(import.meta.url);
if (requireForSquirrel("electron-squirrel-startup") === true) {
  app.quit();
}

import { normalizeRunExtensions, type RunExtensionSelection } from "../src/extension-config.js";
import { inspectWorkspaceExtensionCatalog } from "../src/extension-catalog.js";
import { normalizeProviderSelection, type ProviderSelection } from "../src/provider-config.js";
import { createConfiguredProvider } from "../src/provider-factory.js";
import { verifyProviderConnection as probeProviderConnection } from "../src/provider-connection.js";
import { ProcessSharedCapacity } from "../src/process-shared-provider.js";
import {
  DESKTOP_CHANNELS,
  type ApproveDesktopIntegrationRequest,
  type DesktopArtifactActionRequest,
  type DesktopBugReportDuplicateCheck,
  type DesktopBugReportRequest,
  type DesktopPublicBugReportPreview,
  type DesktopRunActionRequest,
  type OpenDesktopBugReportRequest,
  type RevertDesktopIntegrationRequest,
  type ResolveDesktopPlanReviewRequest,
  type ResolveDesktopToolApprovalRequest,
  type StartDesktopRunRequest,
  type UpdateDesktopOnboardingRequest,
} from "../src/desktop-contract.js";
import { DesktopRunManager } from "../src/desktop-run-manager.js";
import { RecentWorkspaceStore } from "../src/recent-workspaces.js";
import {
  deleteProviderApiKey,
  inspectProviderCredential,
  storeProviderApiKey,
  type CredentialProviderId,
} from "../src/credential-store.js";
import {
  ensureTutorialWorkspace,
  inspectWorkspaceReadiness,
  OnboardingStateStore,
} from "../src/onboarding.js";
import { normalizeTrustProfile } from "../src/tool-runtime.js";
import {
  fallbackDesktopBuildIdentity,
  parseDesktopBuildIdentity,
  type DesktopBuildIdentity,
} from "../src/build-identity.js";
import { DesktopUpdateCoordinator, resolveDesktopUpdateFeed } from "../src/desktop-update.js";
import {
  buildPublicBugReport,
  findDuplicatePublicBugReport,
  isAllowedPublicBugReportUrl,
} from "../src/public-bug-report.js";
import { electronDesktopUpdateTransport } from "./update-controller.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const rendererRoot = resolve(currentDirectory, "..", "renderer");
const preloadPath = resolve(currentDirectory, "preload.cjs");
const rendererUrl = "localbuddy://app/index.html";
const bugReportDuplicateCache = new Map<string, {
  checkedAt: number;
  result: DesktopBugReportDuplicateCheck;
}>();

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
app.setName("LocalBuddy");
if (!process.argv.some((argument) => argument.startsWith("--user-data-dir="))) {
  const productUserData = resolve(app.getPath("appData"), "LocalBuddy");
  mkdirSync(productUserData, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") chmodSync(productUserData, 0o700);
  app.setPath("userData", productUserData);
}
if (app.isPackaged && process.env.PLAYWRIGHT_BROWSERS_PATH === undefined) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = join(process.resourcesPath, "ms-playwright");
}

let mainWindow: BrowserWindow | null = null;
let recentWorkspaceStore: RecentWorkspaceStore | undefined;
let onboardingStateStore: OnboardingStateStore | undefined;
let buildIdentity: DesktopBuildIdentity = fallbackDesktopBuildIdentity(app.getVersion(), app.isPackaged);
let updateCoordinator: DesktopUpdateCoordinator | undefined;
const runManager = new DesktopRunManager({
  requirePlanReview: true,
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

async function initializeBuildAndUpdates(): Promise<void> {
  try {
    const raw = JSON.parse(await readFile(resolve(currentDirectory, "..", "build-metadata.json"), "utf8")) as unknown;
    buildIdentity = parseDesktopBuildIdentity(raw, app.getVersion(), app.isPackaged);
  } catch {
    buildIdentity = fallbackDesktopBuildIdentity(app.getVersion(), app.isPackaged);
  }
  const supported = process.platform === "win32" && app.isPackaged;
  const feedUrl = resolveDesktopUpdateFeed({
    build: buildIdentity,
    platform: process.platform,
    arch: process.arch,
    override: process.env.LOCALBUDDY_UPDATE_FEED_URL?.trim() || undefined,
  });
  updateCoordinator = new DesktopUpdateCoordinator({
    build: buildIdentity,
    supported,
    feedUrl,
    transport: supported ? electronDesktopUpdateTransport() : undefined,
    canInstall: () => runManager.isIdle(),
    onChange(update) {
      if (mainWindow !== null && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(DESKTOP_CHANNELS.updateUpdated, update);
      }
    },
  });
}

function getUpdateCoordinator(): DesktopUpdateCoordinator {
  if (updateCoordinator === undefined) throw new Error("Desktop update controller is not initialized");
  return updateCoordinator;
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
    const recentWorkspaces = await loadExistingRecentWorkspaces();
    const requestedWorkspace = process.env.LOCALBUDDY_DEFAULT_WORKSPACE ?? recentWorkspaces[0];
    const workspace = requestedWorkspace === undefined
      ? ""
      : await realpath(resolve(requestedWorkspace));
    if (process.env.LOCALBUDDY_DEFAULT_WORKSPACE !== undefined) {
      await getRecentWorkspaceStore().remember(workspace);
    }
    const [onboarding, deepseekCredential, openaiCredential, workspaceReadiness] = await Promise.all([
      getOnboardingStateStore().load(),
      inspectProviderCredential("deepseek"),
      inspectProviderCredential("openai"),
      inspectWorkspaceReadiness(workspace),
    ]);
    return {
      workspace,
      runs: workspace.length === 0 ? [] : await runManager.list(workspace),
      recentWorkspaces: promoteRecentWorkspace(recentWorkspaces, workspace),
      providerAvailability: { deepseek: deepseekCredential, openai: openaiCredential },
      workspaceReadiness,
      onboarding,
      update: getUpdateCoordinator().current,
    };
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
    if (result.canceled || result.filePaths[0] === undefined) return null;
    const workspace = await realpath(result.filePaths[0]);
    await getRecentWorkspaceStore().remember(workspace);
    return workspace;
  });

  ipcMain.handle(DESKTOP_CHANNELS.selectResearchSources, async (event, kind: unknown) => {
    assertTrustedSender(event);
    if (kind !== "files" && kind !== "folders") {
      throw new Error("research source kind must be files or folders");
    }
    const options: OpenDialogOptions = {
      title: kind === "files" ? "选择本次研究要读取的文件" : "选择本次研究要查找的资料文件夹",
      properties: kind === "files"
        ? ["openFile", "multiSelections"]
        : ["openDirectory", "multiSelections"],
    };
    const result = mainWindow === null
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(mainWindow, options);
    if (result.canceled) return [];
    return Promise.all(result.filePaths.map((path) => realpath(path)));
  });

  ipcMain.handle(DESKTOP_CHANNELS.inspectWorkspace, async (event, workspace: unknown) => {
    assertTrustedSender(event);
    return inspectWorkspaceReadiness(expectString(workspace, "workspace"));
  });

  ipcMain.handle(DESKTOP_CHANNELS.inspectWorkspaceExtensions, async (event, workspace: unknown) => {
    assertTrustedSender(event);
    return inspectWorkspaceExtensionCatalog(expectString(workspace, "workspace"));
  });

  ipcMain.handle(DESKTOP_CHANNELS.createTutorialWorkspace, async (event) => {
    assertTrustedSender(event);
    const current = await getOnboardingStateStore().load();
    const tutorial = await ensureTutorialWorkspace(
      resolve(app.getPath("userData"), "tutorial-workspaces"),
      current.tutorialWorkspace,
    );
    const workspace = await realpath(tutorial.workspace);
    const onboarding = await getOnboardingStateStore().rememberTutorialWorkspace(workspace);
    await getRecentWorkspaceStore().remember(workspace);
    const recentWorkspaces = await loadExistingRecentWorkspaces();
    return {
      workspace,
      files: tutorial.files,
      runs: await runManager.list(workspace),
      recentWorkspaces: promoteRecentWorkspace(recentWorkspaces, workspace),
      readiness: await inspectWorkspaceReadiness(workspace),
      onboarding,
      created: tutorial.created,
    };
  });

  ipcMain.handle(DESKTOP_CHANNELS.updateOnboarding, async (event, request: unknown) => {
    assertTrustedSender(event);
    return getOnboardingStateStore().update(parseUpdateOnboardingRequest(request));
  });

  ipcMain.handle(DESKTOP_CHANNELS.storeProviderCredential, async (event, request: unknown) => {
    assertTrustedSender(event);
    const parsed = parseProviderCredentialRequest(request);
    await storeProviderApiKey(parsed.providerId, parsed.apiKey);
    return {
      providerId: parsed.providerId,
      stored: true as const,
      status: await inspectProviderCredential(parsed.providerId),
    };
  });

  ipcMain.handle(DESKTOP_CHANNELS.deleteProviderCredential, async (event, request: unknown) => {
    assertTrustedSender(event);
    const providerId = parseProviderIdRequest(request);
    const label = providerId === "deepseek" ? "DeepSeek" : "OpenAI";
    const options = {
      type: "warning" as const,
      title: `删除 ${label} 凭据`,
      message: `确认从系统安全存储中删除 ${label} API Key 吗？`,
      detail: "删除后，LocalBuddy 将无法使用这个 Provider，除非环境变量仍然提供凭据或你重新保存。密钥内容不会被读取或显示。",
      buttons: ["取消", "删除凭据"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    };
    const result = mainWindow === null
      ? await dialog.showMessageBox(options)
      : await dialog.showMessageBox(mainWindow, options);
    if (result.response !== 1) {
      return {
        providerId,
        deleted: false,
        status: await inspectProviderCredential(providerId),
      };
    }
    await deleteProviderApiKey(providerId);
    return {
      providerId,
      deleted: true,
      status: await inspectProviderCredential(providerId),
    };
  });

  ipcMain.handle(DESKTOP_CHANNELS.verifyProviderConnection, async (event, request: unknown) => {
    assertTrustedSender(event);
    const record = expectRecord(request, "provider connection request");
    const providerId = parseProviderIdRequest(record);
    return probeProviderConnection({
      id: providerId,
      baseUrl: expectOptionalString(record.baseUrl, "baseUrl"),
    });
  });

  ipcMain.handle(DESKTOP_CHANNELS.openProviderSetup, async (event, request: unknown) => {
    assertTrustedSender(event);
    const providerId = parseProviderIdRequest(request);
    const target = providerId === "deepseek"
      ? "https://platform.deepseek.com/api_keys"
      : "https://platform.openai.com/api-keys";
    await shell.openExternal(target);
  });

  ipcMain.handle(DESKTOP_CHANNELS.checkForUpdates, async (event) => {
    assertTrustedSender(event);
    return getUpdateCoordinator().checkForUpdates();
  });

  ipcMain.handle(DESKTOP_CHANNELS.quitAndInstallUpdate, async (event) => {
    assertTrustedSender(event);
    const coordinator = getUpdateCoordinator();
    if (!runManager.isIdle()) return coordinator.quitAndInstall();
    const options: Electron.MessageBoxOptions = {
      type: "info",
      title: "重启并更新 LocalBuddy",
      message: "确认关闭 LocalBuddy 并安装已经下载的新版本吗？",
      detail: "当前没有正在执行的 Desktop Run。应用会退出，由 Squirrel 完成版本切换，然后重新启动。",
      buttons: ["稍后", "重启并更新"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    };
    const confirmation = mainWindow === null
      ? await dialog.showMessageBox(options)
      : await dialog.showMessageBox(mainWindow, options);
    return confirmation.response === 1 ? coordinator.quitAndInstall() : coordinator.current;
  });

  ipcMain.handle(DESKTOP_CHANNELS.openLatestRelease, async (event) => {
    assertTrustedSender(event);
    await shell.openExternal("https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/releases/latest");
  });

  ipcMain.handle(DESKTOP_CHANNELS.listRuns, async (event, workspace: unknown) => {
    assertTrustedSender(event);
    const canonical = await realpath(expectString(workspace, "workspace"));
    await getRecentWorkspaceStore().remember(canonical);
    return runManager.list(canonical);
  });

  ipcMain.handle(DESKTOP_CHANNELS.startRun, async (event, request: unknown) => {
    assertTrustedSender(event);
    const parsed = parseStartRequest(request);
    await getRecentWorkspaceStore().remember(await realpath(parsed.workspace));
    return runManager.start(parsed);
  });

  ipcMain.handle(DESKTOP_CHANNELS.cancelRun, async (event, runId: unknown) => {
    assertTrustedSender(event);
    await runManager.cancel(expectString(runId, "runId"));
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
    const current = (await runManager.list(parsed.workspace)).find((run) => run.runId === parsed.runId);
    if (current === undefined) throw new Error(`Run history does not exist: ${parsed.runId}`);
    const options = integrationRevertDialog(current.integration?.status === "committed");
    const confirmation = mainWindow === null
      ? await dialog.showMessageBox(options)
      : await dialog.showMessageBox(mainWindow, options);
    if (confirmation.response !== 1) {
      return null;
    }
    return runManager.revertIntegration(parsed);
  });

  ipcMain.handle(DESKTOP_CHANNELS.loadIntegrationDiff, async (event, request: unknown) => {
    assertTrustedSender(event);
    return runManager.loadIntegrationDiff(parseRunActionRequest(request));
  });

  ipcMain.handle(DESKTOP_CHANNELS.loadArtifactPreview, async (event, request: unknown) => {
    assertTrustedSender(event);
    return runManager.loadArtifactPreview(parseArtifactActionRequest(request));
  });

  ipcMain.handle(DESKTOP_CHANNELS.loadArtifactThread, async (event, request: unknown) => {
    assertTrustedSender(event);
    return runManager.loadArtifactThread(parseArtifactActionRequest(request));
  });

  ipcMain.handle(DESKTOP_CHANNELS.loadArtifactRevisionDiff, async (event, request: unknown) => {
    assertTrustedSender(event);
    return runManager.loadArtifactRevisionDiff(parseArtifactActionRequest(request));
  });

  ipcMain.handle(DESKTOP_CHANNELS.exportDiagnostics, async (event, request: unknown) => {
    assertTrustedSender(event);
    const parsed = parseRunActionRequest(request);
    const dossier = await runManager.buildDiagnostics(parsed, app.getVersion());
    const options: Electron.SaveDialogOptions = {
      title: "导出脱敏诊断包",
      defaultPath: resolve(app.getPath("documents"), `localbuddy-${parsed.runId}-diagnostics.json`),
      filters: [{ name: "JSON", extensions: ["json"] }],
      properties: ["createDirectory", "showOverwriteConfirmation"],
    };
    // Keep this dialog app-level. A parented sheet can outlive its renderer IPC
    // promise on macOS after the save completes, leaving the button stuck busy.
    const result = await dialog.showSaveDialog(options);
    if (result.canceled || result.filePath === undefined) return null;
    await writeFile(result.filePath, `${JSON.stringify(dossier, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    if (process.platform !== "win32") await chmod(result.filePath, 0o600);
    return result.filePath;
  });

  ipcMain.handle(DESKTOP_CHANNELS.prepareBugReport, async (event, request: unknown) => {
    assertTrustedSender(event);
    return preparePublicBugReport(parseBugReportRequest(request));
  });

  ipcMain.handle(DESKTOP_CHANNELS.saveBugReport, async (event, request: unknown) => {
    assertTrustedSender(event);
    const report = await buildPublicBugReportForRequest(parseBugReportRequest(request));
    const shortSignature = report.signature.slice(-64, -52);
    const options: Electron.SaveDialogOptions = {
      title: "保存公开安全问题报告",
      defaultPath: resolve(app.getPath("documents"), `localbuddy-public-bug-${shortSignature}.md`),
      filters: [{ name: "Markdown", extensions: ["md"] }],
      properties: ["createDirectory", "showOverwriteConfirmation"],
    };
    const result = await dialog.showSaveDialog(options);
    if (result.canceled || result.filePath === undefined) return null;
    await writeFile(result.filePath, report.previewMarkdown, { encoding: "utf8", mode: 0o600 });
    if (process.platform !== "win32") await chmod(result.filePath, 0o600);
    return result.filePath;
  });

  ipcMain.handle(DESKTOP_CHANNELS.openBugReport, async (event, request: unknown) => {
    assertTrustedSender(event);
    const parsed = parseOpenBugReportRequest(request);
    const report = await preparePublicBugReport(parsed);
    if (report.previewSha256 !== parsed.confirmedPreviewSha256) {
      throw new Error("运行状态或报告内容在预览后发生变化，请重新生成并检查公开预览");
    }
    const duplicateUrl = report.duplicateCheck.status === "found"
      ? report.duplicateCheck.url
      : undefined;
    const target = duplicateUrl ?? report.issueUrl;
    const kind = duplicateUrl === undefined ? "new" : "existing";
    if (!isAllowedPublicBugReportUrl(target, kind)) {
      throw new Error("GitHub 问题报告目标地址未通过安全校验");
    }
    await shell.openExternal(target);
    return {
      status: duplicateUrl === undefined ? "new-issue-opened" : "duplicate-opened",
      url: target,
      signature: report.signature,
    };
  });

  ipcMain.handle(DESKTOP_CHANNELS.resolveToolApproval, async (event, request: unknown) => {
    assertTrustedSender(event);
    return runManager.resolveToolApproval(parseResolveToolApprovalRequest(request));
  });

  ipcMain.handle(DESKTOP_CHANNELS.resolvePlanReview, async (event, request: unknown) => {
    assertTrustedSender(event);
    return runManager.resolvePlanReview(parseResolvePlanReviewRequest(request));
  });

  ipcMain.handle(
    DESKTOP_CHANNELS.openArtifact,
    async (event, request: unknown) => {
      assertTrustedSender(event);
      const artifactPath = await runManager.resolveArtifactPath(parseArtifactActionRequest(request));
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

async function buildPublicBugReportForRequest(request: DesktopBugReportRequest) {
  const runs = await runManager.list(request.workspace);
  const run = runs.find((candidate) => candidate.runId === request.runId);
  if (run === undefined) throw new Error("找不到要报告的 LocalBuddy Run");
  return buildPublicBugReport({
    run,
    build: buildIdentity,
    platform: process.platform,
    arch: process.arch,
  });
}

async function preparePublicBugReport(
  request: DesktopBugReportRequest,
): Promise<DesktopPublicBugReportPreview> {
  const report = await buildPublicBugReportForRequest(request);
  const cached = bugReportDuplicateCache.get(report.signature);
  let duplicateCheck: DesktopBugReportDuplicateCheck;
  if (cached !== undefined && Date.now() - cached.checkedAt < 60_000) {
    duplicateCheck = cached.result;
  } else {
    duplicateCheck = await findDuplicatePublicBugReport(
      report.signature,
      fetch,
      AbortSignal.timeout(4_000),
    );
    bugReportDuplicateCache.set(report.signature, { checkedAt: Date.now(), result: duplicateCheck });
    if (bugReportDuplicateCache.size > 64) {
      const oldest = bugReportDuplicateCache.keys().next().value as string | undefined;
      if (oldest !== undefined) bugReportDuplicateCache.delete(oldest);
    }
  }
  return { ...report, duplicateCheck };
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
    goalConstraints: expectOptionalStringArray(record.goalConstraints, "goalConstraints"),
    verificationCriteria: expectOptionalStringArray(
      record.verificationCriteria,
      "verificationCriteria",
    ),
    concurrency: expectNumber(record.concurrency, "concurrency"),
    mode: expectMode(record.mode),
    sourcePaths: record.sourcePaths === undefined
      ? []
      : expectStringArray(record.sourcePaths, "sourcePaths"),
    provider: parseProviderSelection(record.provider),
    trustProfile: normalizeTrustProfile(record.trustProfile),
    extensions: parseRunExtensions(record.extensions),
    artifactContinuation: parseArtifactContinuation(record.artifactContinuation),
  };
}

function parseArtifactContinuation(
  value: unknown,
): StartDesktopRunRequest["artifactContinuation"] {
  if (value === undefined) return undefined;
  const record = expectRecord(value, "artifactContinuation");
  return {
    parentRunId: expectString(record.parentRunId, "artifactContinuation.parentRunId"),
    parentFileName: expectString(record.parentFileName, "artifactContinuation.parentFileName"),
    parentSha256: expectString(record.parentSha256, "artifactContinuation.parentSha256"),
    reason: expectString(record.reason, "artifactContinuation.reason"),
  };
}

function parseProviderCredentialRequest(value: unknown): {
  providerId: CredentialProviderId;
  apiKey: string;
} {
  const record = expectRecord(value, "provider credential request");
  const providerId = expectString(record.providerId, "providerId");
  if (providerId !== "deepseek" && providerId !== "openai") {
    throw new Error("providerId must be deepseek or openai");
  }
  return {
    providerId,
    apiKey: expectString(record.apiKey, "apiKey"),
  };
}

function parseProviderIdRequest(value: unknown): CredentialProviderId {
  const record = expectRecord(value, "provider request");
  const providerId = expectString(record.providerId, "providerId");
  if (providerId !== "deepseek" && providerId !== "openai") {
    throw new Error("providerId must be deepseek or openai");
  }
  return providerId;
}

function parseUpdateOnboardingRequest(value: unknown): UpdateDesktopOnboardingRequest {
  const record = expectRecord(value, "onboarding update request");
  return {
    guideSeen: expectOptionalBoolean(record.guideSeen, "guideSeen"),
    contextHelpEnabled: expectOptionalBoolean(
      record.contextHelpEnabled,
      "contextHelpEnabled",
    ),
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
  const mcpServerIds = expectOptionalStringArray(record.mcpServerIds, "extensions.mcpServerIds");
  expectOptionalBoolean(record.allowMcpWrites, "extensions.allowMcpWrites");
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
    mcpServerIds,
    // Desktop connections may propose effectful actions, but every exact call still enters
    // InteractiveToolApprovalBroker. Avoid a second, misleading pre-authorization toggle.
    allowMcpWrites: (mcpServerIds?.length ?? 0) > 0,
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

function parseResolvePlanReviewRequest(value: unknown): ResolveDesktopPlanReviewRequest {
  const record = expectRecord(value, "Plan Review request");
  const decision = expectString(record.decision, "decision");
  if (decision !== "approve" && decision !== "reject") {
    throw new Error("Plan Review decision must be approve or reject");
  }
  return {
    workspace: expectString(record.workspace, "workspace"),
    runId: expectString(record.runId, "runId"),
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

function parseBugReportRequest(value: unknown): DesktopBugReportRequest {
  const record = expectRecord(value, "bug report request");
  return {
    workspace: expectString(record.workspace, "workspace"),
    runId: expectString(record.runId, "runId"),
  };
}

function parseOpenBugReportRequest(value: unknown): OpenDesktopBugReportRequest {
  const record = expectRecord(value, "public bug report request");
  if (record.confirmedPublicSubmission !== true) {
    throw new Error("必须先检查公开预览并明确确认");
  }
  return {
    ...parseBugReportRequest(record),
    confirmedPublicSubmission: true,
    confirmedPreviewSha256: expectSha256(record.confirmedPreviewSha256, "confirmedPreviewSha256"),
  };
}

function parseArtifactActionRequest(value: unknown): DesktopArtifactActionRequest {
  const record = expectRecord(value, "artifact action request");
  return {
    workspace: expectString(record.workspace, "workspace"),
    runId: expectString(record.runId, "runId"),
    fileName: expectString(record.fileName, "fileName"),
  };
}

function getRecentWorkspaceStore(): RecentWorkspaceStore {
  recentWorkspaceStore ??= new RecentWorkspaceStore(
    resolve(app.getPath("userData"), "recent-workspaces.json"),
  );
  return recentWorkspaceStore;
}

function getOnboardingStateStore(): OnboardingStateStore {
  onboardingStateStore ??= new OnboardingStateStore(
    resolve(app.getPath("userData"), "onboarding.json"),
  );
  return onboardingStateStore;
}

async function loadExistingRecentWorkspaces(): Promise<string[]> {
  const result: string[] = [];
  for (const candidate of await getRecentWorkspaceStore().list()) {
    try {
      const canonical = await realpath(candidate);
      if ((await stat(canonical)).isDirectory() && !result.includes(canonical)) result.push(canonical);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") continue;
      throw error;
    }
  }
  return result;
}

function promoteRecentWorkspace(current: readonly string[], workspace: string): string[] {
  if (workspace.length === 0) return current.slice(0, 5);
  return [workspace, ...current.filter((candidate) => candidate !== workspace)].slice(0, 5);
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

function integrationRevertDialog(committed: boolean): Electron.MessageBoxOptions {
  return {
    type: "warning",
    title: "撤销 LocalBuddy 集成",
    message: committed
      ? "确认创建一个反向 Git commit 吗？"
      : "确认撤销这次尚未提交的集成吗？",
    detail: committed
      ? "原提交会保留在历史中；系统会重新校验仓库状态，再创建一个反向提交。"
      : "只有当主工作区仍与已批准补丁完全一致时才会执行。",
    buttons: ["取消", committed ? "创建反向提交" : "确认撤销"],
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

function expectSha256(value: unknown, name: string): string {
  const result = expectString(value, name);
  if (!/^[a-f0-9]{64}$/u.test(result)) throw new Error(`${name} must be a SHA-256 digest`);
  return result;
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
  const requestedView = process.env.LOCALBUDDY_SMOKE_VIEW ?? "provider";
  const diagnostics = await window.webContents.executeJavaScript(`(async () => {
    const requestedView = ${JSON.stringify(requestedView)};
    const waitFor = async (selector, ready = () => true) => {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const element = document.querySelector(selector);
        if (element !== null && ready(element)) return element;
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
      }
      throw new Error('Timed out waiting for ' + selector);
    };
    const buildIdentity = await waitFor('.build-identity', (element) => !element.innerText.includes('unknown'));
    if (requestedView === 'bug-report') {
      if (document.querySelector('.guide-state') !== null) {
        const enterWorkbench = [...document.querySelectorAll('.guide-header-actions button')]
          .find((element) => element.innerText.includes('进入工作台'));
        enterWorkbench?.click();
      }
      const reportButton = await waitFor('.header-actions button', () =>
        [...document.querySelectorAll('.header-actions button')].some((element) => element.innerText.includes('报告问题'))
      );
      const targetButton = [...document.querySelectorAll('.header-actions button')]
        .find((element) => element.innerText.includes('报告问题'));
      targetButton.click();
      const dialog = await waitFor('.bug-report-dialog');
      const preview = await waitFor('.bug-report-preview');
      preview.scrollIntoView({ block: 'center' });
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
      const openButton = dialog.querySelector('.bug-report-open');
      return {
        url: location.href,
        title: document.title,
        requestedView,
        buildIdentity: buildIdentity.innerText.trim(),
        dialogVisible: dialog !== null,
        publicWarningVisible: dialog.innerText.includes('GitHub Issue 是公开内容'),
        previewVisible: preview !== null,
        previewHasSignature: preview.innerText.includes('localbuddy-signature:v1:'),
        rawWorkspaceAbsent: !preview.innerText.includes('/Users/'),
        noRequiredNarrativeFields: dialog.querySelectorAll('.bug-report-fields textarea').length === 0,
        singleConsentActionVisible: openButton?.innerText.includes('同意并') ?? false,
        consentActionEnabled: !(openButton?.disabled ?? true),
        duplicateStatus: dialog.querySelector('.duplicate-status')?.innerText.trim() ?? ''
      };
    }
    if (requestedView === 'extensions') {
      if (document.querySelector('.guide-state') !== null) {
        const enterWorkbench = [...document.querySelectorAll('.guide-header-actions button')]
          .find((element) => element.innerText.includes('进入完整工作台'));
        enterWorkbench?.click();
      }
      await waitFor('.composer');
      const toggle = await waitFor('.extensions-toggle');
      toggle.click();
      const dialog = await waitFor('.capability-picker-dialog');
      const methodSection = await waitFor('[aria-labelledby="method-picker-heading"]');
      const connectionSection = await waitFor('[aria-labelledby="connection-picker-heading"]');
      const methodButton = await waitFor('[aria-labelledby="method-picker-heading"] .capability-choice > button');
      const connectionButton = await waitFor('[aria-labelledby="connection-picker-heading"] .capability-choice > button');
      const initiallySelected = dialog.querySelectorAll('.capability-choice > button[aria-pressed="true"]').length;
      const primaryCopyBeforeAdvanced = methodSection.innerText + '\\n' + connectionSection.innerText;
      const technicalDetails = dialog.querySelector('.capability-technical-details');
      const technicalHiddenByDefault = !dialog.innerText.includes('.localbuddy/mcp.json')
        && !dialog.innerText.includes('MCP');
      methodButton.click();
      connectionButton.click();
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
      const selectedAfterClick = dialog.querySelectorAll('.capability-choice > button[aria-pressed="true"]').length;
      technicalDetails.open = true;
      const technicalBoundaryVisible = technicalDetails.innerText.includes('不会扫描其他文件夹')
        && technicalDetails.innerText.includes('不会自动连接')
        && technicalDetails.innerText.includes('MCP');
      dialog.querySelector('.capability-done')?.click();
      const selectedCapabilities = await waitFor('.selected-capabilities');
      toggle.click();
      await waitFor('.capability-picker-dialog');
      return {
        url: location.href,
        title: document.title,
        requestedView,
        buildIdentity: buildIdentity.innerText.trim(),
        dialogVisible: true,
        methodHeading: methodSection.querySelector('h3')?.innerText.trim() ?? '',
        connectionHeading: connectionSection.querySelector('h3')?.innerText.trim() ?? '',
        methodCount: methodSection.querySelectorAll('.capability-choice').length,
        connectionCount: connectionSection.querySelectorAll('.capability-choice').length,
        initiallySelected,
        selectedAfterClick,
        technicalHiddenByDefault,
        technicalBoundaryVisible,
        primaryCopyUsesOutcomes: primaryCopyBeforeAdvanced.includes('证据检查')
          && primaryCopyBeforeAdvanced.includes('研究资料库')
          && !primaryCopyBeforeAdvanced.includes('evidence-review')
          && !primaryCopyBeforeAdvanced.includes('research-tools')
          && !primaryCopyBeforeAdvanced.includes('MCP'),
        justInTimeApprovalVisible: dialog.innerText.includes('实际执行前单独询问你'),
        selectedChipsVisible: selectedCapabilities.innerText.includes('证据检查')
          && selectedCapabilities.innerText.includes('研究资料库'),
        extensionToggleText: toggle.innerText.trim()
      };
    }
    const providerEntry = await waitFor('.provider-entry');
    const firstTaskAction = await waitFor('.first-task-primary');
    const planReviewGuideVisible = document.body?.innerText?.includes('确认前不会处理资料') ?? false;
    const dataBoundaryVisible = document.body?.innerText?.includes('不会自动扫描电脑')
      && document.body?.innerText?.includes('1 份虚构会议记录')
      && document.body?.innerText?.includes('原文件不会被修改');
    providerEntry.click();
    const providerDialog = await waitFor('.provider-settings-dialog');
    const providerChoices = [...providerDialog.querySelectorAll('.provider-choice-grid button')]
      .map((element) => element.innerText.trim());
    const providerSummary = providerDialog.querySelector('.provider-credential-summary')?.innerText.trim() ?? '';
    const providerSetupHelp = providerDialog.querySelector('.provider-getting-started')?.innerText.trim() ?? '';
    const providerSetupAction = providerDialog.querySelector('.provider-getting-started button')?.innerText.trim() ?? '';
    const verifyDisabled = providerDialog.querySelector('.verify-provider-button')?.disabled ?? null;
    providerDialog.querySelector('[aria-label="关闭模型设置"]')?.click();
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    return {
      url: location.href,
      title: document.title,
      bodyCharacters: document.body?.innerText?.length ?? -1,
      api: typeof globalThis.localbuddy,
      rootChildren: document.getElementById('root')?.childElementCount ?? -1,
      guideVisible: document.querySelector('.guide-state') !== null,
      goalContractVisible: document.querySelector('.goal-contract-heading') !== null,
      goalFieldCount: document.querySelectorAll('.goal-outcome-field textarea, .goal-contract-grid textarea').length,
      planReviewGuideVisible,
      dataBoundaryVisible,
      advancedWorkbenchHidden: document.querySelector('.composer') === null,
      firstTaskActionText: firstTaskAction.innerText.trim(),
      ownMeetingRecordActionVisible: [...document.querySelectorAll('.first-task-secondary')]
        .some((element) => element.innerText.includes('使用我自己的会议记录')),
      startButtonText: firstTaskAction.innerText.trim(),
      buildIdentity: buildIdentity.innerText.trim(),
      providerEntry: providerEntry.innerText.trim(),
      providerDialogVisible: true,
      providerChoices,
      providerSummary,
      providerSetupHelp,
      providerSetupAction,
      verifyDisabled,
      startDisabled: !firstTaskAction.innerText.includes('生成执行计划')
    };
  })()`);
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
    await initializeBuildAndUpdates();
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

  app.on("before-quit", () => updateCoordinator?.dispose());
}
