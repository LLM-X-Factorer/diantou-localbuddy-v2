import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

import { assessWorkspaceStorage, type WorkspaceStorageAssessment } from "./workspace-storage.js";

export const ONBOARDING_VERSION = 1 as const;

export interface OnboardingState {
  version: typeof ONBOARDING_VERSION;
  guideSeen: boolean;
  contextHelpEnabled: boolean;
  tutorialWorkspace?: string;
}

export interface OnboardingPreferencePatch {
  guideSeen?: boolean;
  contextHelpEnabled?: boolean;
}

export interface TutorialWorkspaceResult {
  workspace: string;
  created: boolean;
  files: readonly string[];
}

export interface WorkspaceReadiness {
  selected: boolean;
  isGitRepository: boolean;
  isTutorialWorkspace: boolean;
  storage: WorkspaceStorageAssessment;
}

const DEFAULT_STATE: OnboardingState = {
  version: ONBOARDING_VERSION,
  guideSeen: false,
  contextHelpEnabled: true,
};

const TUTORIAL_VERSION = 2 as const;
const TUTORIAL_FILES = {
  "示例会议记录.txt": `这是 LocalBuddy 为第一次任务编写的完全虚构会议记录，不包含真实人员或业务信息。

会议主题：秋季客户培训准备会
会议时间：2026 年 8 月 18 日 10:00–10:45
参会人：林晓（主持）、周然、陈一、王宁

零散记录：

- 9 月客户培训先做一场 30 人以内的小范围试讲，确认内容和现场流程后再扩大。
- 周然负责在 8 月 25 日前整理课程大纲，并把需要业务团队确认的案例单独标出来。
- 陈一负责联系场地和直播支持，场地报价还没有确认，截止时间也没有定。
- 王宁建议报名表增加“最想解决的问题”，方便讲师在培训前调整案例。
- 是否录制课程没有结论，需要确认客户授权和存储位置。
- 下次碰头暂定 8 月 28 日，具体时间待确认。
`,
} as const;

const TUTORIAL_MARKER = ".localbuddy-tutorial.json";

export class OnboardingStateStore {
  readonly #filePath: string;
  #pending: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.#filePath = resolve(filePath);
  }

  async load(): Promise<OnboardingState> {
    await this.#pending;
    return this.#loadWithoutWaiting();
  }

  update(patch: OnboardingPreferencePatch): Promise<OnboardingState> {
    let result = DEFAULT_STATE;
    const operation = this.#pending.then(async () => {
      const current = await this.#loadWithoutWaiting();
      result = {
        ...current,
        ...(patch.guideSeen === undefined ? {} : { guideSeen: patch.guideSeen }),
        ...(patch.contextHelpEnabled === undefined
          ? {}
          : { contextHelpEnabled: patch.contextHelpEnabled }),
      };
      await this.#write(result);
    });
    this.#pending = operation.catch(() => undefined);
    return operation.then(() => result);
  }

  rememberTutorialWorkspace(workspace: string): Promise<OnboardingState> {
    let result = DEFAULT_STATE;
    const operation = this.#pending.then(async () => {
      const current = await this.#loadWithoutWaiting();
      result = { ...current, guideSeen: true, tutorialWorkspace: resolve(workspace) };
      await this.#write(result);
    });
    this.#pending = operation.catch(() => undefined);
    return operation.then(() => result);
  }

  async #loadWithoutWaiting(): Promise<OnboardingState> {
    try {
      return parseState(JSON.parse(await readFile(this.#filePath, "utf8")) as unknown);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return { ...DEFAULT_STATE };
      if (error instanceof SyntaxError || error instanceof InvalidOnboardingStateError) {
        return { ...DEFAULT_STATE };
      }
      throw error;
    }
  }

  async #write(value: OnboardingState): Promise<void> {
    const temporaryPath = `${this.#filePath}.${process.pid}.${randomUUID()}.tmp`;
    await mkdir(dirname(this.#filePath), { recursive: true, mode: 0o700 });
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryPath, this.#filePath);
    if (process.platform !== "win32") await chmod(this.#filePath, 0o600);
  }
}

export async function ensureTutorialWorkspace(
  tutorialRoot: string,
  rememberedWorkspace?: string,
): Promise<TutorialWorkspaceResult> {
  const root = resolve(tutorialRoot);
  await mkdir(root, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await chmod(root, 0o700);
  const canonicalRoot = await realpath(root);

  if (rememberedWorkspace !== undefined) {
    const reusable = await reusableTutorialWorkspace(canonicalRoot, rememberedWorkspace);
    if (reusable !== undefined) {
      return { workspace: reusable, created: false, files: Object.keys(TUTORIAL_FILES) };
    }
  }

  const workspace = await mkdtemp(join(canonicalRoot, "first-trusted-run-"));
  if (process.platform !== "win32") await chmod(workspace, 0o700);
  for (const [fileName, content] of Object.entries(TUTORIAL_FILES)) {
    await writeFile(join(workspace, fileName), content, { encoding: "utf8", flag: "wx", mode: 0o600 });
  }
  await writeFile(join(workspace, TUTORIAL_MARKER), `${JSON.stringify({
    version: TUTORIAL_VERSION,
    kind: "first-trusted-run",
    files: Object.keys(TUTORIAL_FILES),
  }, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return { workspace, created: true, files: Object.keys(TUTORIAL_FILES) };
}

export async function inspectWorkspaceReadiness(workspace: string): Promise<WorkspaceReadiness> {
  if (workspace.length === 0) {
    return {
      selected: false,
      isGitRepository: false,
      isTutorialWorkspace: false,
      storage: assessWorkspaceStorage(""),
    };
  }
  const canonical = await realpath(resolve(workspace));
  if (!(await stat(canonical)).isDirectory()) throw new Error("workspace must be a directory");
  const [isGitRepository, isTutorialWorkspace] = await Promise.all([
    pathExists(join(canonical, ".git")),
    validTutorialMarker(canonical),
  ]);
  return {
    selected: true,
    isGitRepository,
    isTutorialWorkspace,
    storage: assessWorkspaceStorage(canonical),
  };
}

async function reusableTutorialWorkspace(root: string, candidate: string): Promise<string | undefined> {
  try {
    const canonical = await realpath(resolve(candidate));
    if (!isInside(root, canonical) || !(await stat(canonical)).isDirectory()) return undefined;
    if (!(await validTutorialMarker(canonical))) return undefined;
    for (const fileName of Object.keys(TUTORIAL_FILES)) {
      if (!(await stat(join(canonical, fileName))).isFile()) return undefined;
    }
    return canonical;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function validTutorialMarker(workspace: string): Promise<boolean> {
  try {
    const marker = JSON.parse(await readFile(join(workspace, TUTORIAL_MARKER), "utf8")) as unknown;
    if (marker === null || typeof marker !== "object" || Array.isArray(marker)) return false;
    const record = marker as Record<string, unknown>;
    return record.version === TUTORIAL_VERSION && record.kind === "first-trusted-run";
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    if (error instanceof SyntaxError) return false;
    throw error;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function isInside(parent: string, candidate: string): boolean {
  return candidate.startsWith(`${parent}${sep}`);
}

function parseState(value: unknown): OnboardingState {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidOnboardingStateError();
  }
  const record = value as Record<string, unknown>;
  if (
    record.version !== ONBOARDING_VERSION
    || typeof record.guideSeen !== "boolean"
    || typeof record.contextHelpEnabled !== "boolean"
    || (record.tutorialWorkspace !== undefined && typeof record.tutorialWorkspace !== "string")
  ) {
    throw new InvalidOnboardingStateError();
  }
  return {
    version: ONBOARDING_VERSION,
    guideSeen: record.guideSeen,
    contextHelpEnabled: record.contextHelpEnabled,
    ...(record.tutorialWorkspace === undefined
      ? {}
      : { tutorialWorkspace: resolve(record.tutorialWorkspace) }),
  };
}

class InvalidOnboardingStateError extends Error {}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
