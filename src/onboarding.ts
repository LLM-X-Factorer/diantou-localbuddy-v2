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

const TUTORIAL_FILES = {
  "project-brief.md": `# Aurora pilot brief

Aurora is a fictional internal knowledge assistant preparing for a small pilot.

- The pilot audience is the customer-success team.
- The team wants answers grounded in approved internal notes.
- The launch decision has not been made.
`,
  "customer-notes.md": `# Fictional customer notes

- Interview Alpha: people lose time checking which document is current.
- Interview Beta: people want every answer to name its source file.
- Interview Gamma: people want uncertain claims marked as unknown rather than guessed.
`,
  "delivery-constraints.md": `# Fictional delivery constraints

- The first pilot must stay read-only.
- External side effects require a human decision.
- The review should identify facts, open questions, and next actions.
- No budget or success-rate target has been approved.
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
    version: ONBOARDING_VERSION,
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
    return record.version === ONBOARDING_VERSION && record.kind === "first-trusted-run";
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
