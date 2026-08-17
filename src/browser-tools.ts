import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type {
  Browser,
  BrowserContext,
  Page,
} from "playwright";

import type { ToolDefinition } from "./tool-runtime.js";
import { assertPrivateFileIfPresent, writePrivateJsonAtomic } from "./private-storage.js";

const MAX_PAGE_TEXT = 30_000;
const NAVIGATION_TIMEOUT = 30_000;
type AllowedAriaRole = "button" | "checkbox" | "combobox" | "link" | "menuitem" | "option" | "radio" | "searchbox" | "switch" | "tab" | "textbox";

export interface BrowserToolBundle {
  tools: readonly ToolDefinition[];
  toolNames: readonly string[];
  close(): Promise<void>;
}

interface BrowserState {
  version: 1;
  currentUrl?: string;
  storageState?: {
    cookies: unknown[];
    origins: unknown[];
  };
}

export class ControlledBrowserSession {
  readonly #allowedOrigins: ReadonlySet<string>;
  readonly #statePath: string;
  #browser?: Browser;
  #context?: BrowserContext;
  #page?: Page;
  #restoredState?: BrowserState;
  #operationTail: Promise<void> = Promise.resolve();

  constructor(allowedOrigins: readonly string[], statePath: string) {
    this.#allowedOrigins = new Set(allowedOrigins);
    this.#statePath = resolve(statePath);
  }

  async navigate(urlInput: string, signal?: AbortSignal): Promise<unknown> {
    return this.#exclusive(async () => {
      const url = this.#validateUrl(urlInput);
      const page = await this.#ensurePage(signal);
      const response = await page.goto(url.toString(), {
        waitUntil: "domcontentloaded",
        timeout: NAVIGATION_TIMEOUT,
      });
      this.#validateUrl(page.url());
      await this.#persist();
      return {
        url: page.url(),
        title: await page.title(),
        status: response?.status(),
        snapshot: await this.#snapshotPage(page),
      };
    });
  }

  async snapshot(signal?: AbortSignal): Promise<unknown> {
    return this.#exclusive(async () => this.#snapshotPage(await this.#ensurePage(signal)));
  }

  async #snapshotPage(page: Page): Promise<unknown> {
    this.#validateUrl(page.url());
    const [title, text, ariaSnapshot] = await Promise.all([
      page.title(),
      page.locator("body").innerText({ timeout: 10_000 }).catch(() => ""),
      page.locator("body").ariaSnapshot({ timeout: 10_000 }).catch(() => ""),
    ]);
    return {
      url: page.url(),
      title,
      text: text.slice(0, MAX_PAGE_TEXT),
      textTruncated: text.length > MAX_PAGE_TEXT,
      accessibility: ariaSnapshot.slice(0, MAX_PAGE_TEXT),
      accessibilityTruncated: ariaSnapshot.length > MAX_PAGE_TEXT,
    };
  }

  async click(role: AllowedAriaRole, name: string, signal?: AbortSignal): Promise<unknown> {
    return this.#exclusive(async () => {
      const page = await this.#ensurePage(signal);
      const locator = page.getByRole(role as Parameters<Page["getByRole"]>[0], { name, exact: true });
      const count = await locator.count();
      if (count !== 1) throw new Error(`browser_click requires exactly one matching control, found ${count}`);
      await locator.click({ timeout: 10_000 });
      this.#validateUrl(page.url());
      await this.#persist();
      return this.#snapshotPage(page);
    });
  }

  async fill(label: string, value: string, signal?: AbortSignal): Promise<unknown> {
    return this.#exclusive(async () => {
      const page = await this.#ensurePage(signal);
      const locator = page.getByLabel(label, { exact: true });
      const count = await locator.count();
      if (count !== 1) throw new Error(`browser_fill requires exactly one matching field, found ${count}`);
      await locator.fill(value, { timeout: 10_000 });
      await this.#persist();
      return { url: page.url(), label, characters: value.length };
    });
  }

  async press(key: string, signal?: AbortSignal): Promise<unknown> {
    return this.#exclusive(async () => {
      const page = await this.#ensurePage(signal);
      await page.keyboard.press(key);
      this.#validateUrl(page.url());
      await this.#persist();
      return this.#snapshotPage(page);
    });
  }

  async close(): Promise<void> {
    await this.#operationTail.catch(() => undefined);
    const context = this.#context;
    const browser = this.#browser;
    this.#page = undefined;
    this.#context = undefined;
    this.#browser = undefined;
    if (context !== undefined) await context.close().catch(() => undefined);
    if (browser !== undefined) await browser.close().catch(() => undefined);
  }

  async #exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#operationTail;
    let release: () => void = () => undefined;
    this.#operationTail = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async #ensurePage(signal?: AbortSignal): Promise<Page> {
    if (signal?.aborted === true) throw signal.reason;
    if (this.#page !== undefined && !this.#page.isClosed()) return this.#page;
    const { chromium } = await import("playwright");
    try {
      this.#browser = await chromium.launch({ headless: true });
    } catch (error) {
      throw new Error(
        "Chromium is unavailable. Run `pnpm exec playwright install chromium` before using browser tools.",
        { cause: error },
      );
    }
    this.#restoredState = await this.#loadState();
    this.#context = await this.#browser.newContext({
      acceptDownloads: false,
      serviceWorkers: "block",
      viewport: { width: 1280, height: 800 },
      ...(this.#restoredState?.storageState === undefined
        ? {}
        : { storageState: this.#restoredState.storageState as never }),
    });
    await this.#context.route("**/*", async (route) => {
      try {
        const url = new URL(route.request().url());
        if ((url.protocol === "http:" || url.protocol === "https:") && this.#allowedOrigins.has(url.origin)) {
          await route.continue();
          return;
        }
      } catch {
        // Fall through to a blocked request.
      }
      await route.abort("blockedbyclient");
    });
    this.#context.on("page", (page) => {
      if (this.#page !== undefined && page !== this.#page) void page.close();
    });
    this.#page = await this.#context.newPage();
    this.#page.on("download", (download) => void download.cancel());
    const restoredUrl = this.#restoredState?.currentUrl;
    if (restoredUrl !== undefined) {
      const url = this.#validateUrl(restoredUrl);
      await this.#page.goto(url.toString(), {
        waitUntil: "domcontentloaded",
        timeout: NAVIGATION_TIMEOUT,
      });
    }
    return this.#page;
  }

  #validateUrl(value: string): URL {
    const url = new URL(value);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || !this.#allowedOrigins.has(url.origin)) {
      throw new Error(`Browser URL is outside the Run origin allowlist: ${url.origin}`);
    }
    if (url.username.length > 0 || url.password.length > 0) {
      throw new Error("Browser URL cannot contain embedded credentials");
    }
    return url;
  }

  async #persist(): Promise<void> {
    if (this.#context === undefined || this.#page === undefined) return;
    const state: BrowserState = {
      version: 1,
      currentUrl: this.#page.url(),
      storageState: await this.#context.storageState(),
    };
    await writePrivateJsonAtomic(this.#statePath, state);
  }

  async #loadState(): Promise<BrowserState | undefined> {
    try {
      await assertPrivateFileIfPresent(this.#statePath);
      const raw = JSON.parse(await readFile(this.#statePath, "utf8")) as unknown;
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error("browser state must be an object");
      const state = raw as Partial<BrowserState>;
      if (state.version !== 1) throw new Error("browser state has an unsupported version");
      if (state.currentUrl !== undefined) this.#validateUrl(state.currentUrl);
      return state as BrowserState;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return undefined;
      throw error;
    }
  }
}

export function createBrowserTools(
  session: ControlledBrowserSession,
): BrowserToolBundle {
  const navigateTool: ToolDefinition<{ url: string }> = {
      name: "browser_navigate",
      description: "Navigate the isolated browser to an HTTP(S) URL whose origin the user explicitly allowed, then return a bounded page snapshot.",
      parameters: objectSchema({ url: { type: "string" } }, ["url"]),
      risk: "read",
      permission: "external.read",
      parse(input) {
        return { url: expectString(expectObject(input).url, "url", 4_000) };
      },
      execute(input, context) {
        return session.navigate(input.url, context.signal);
      },
    };
  const snapshotTool: ToolDefinition<Record<string, never>> = {
      name: "browser_snapshot",
      description: "Read the current isolated browser page as bounded visible text and a list of interactive controls.",
      parameters: objectSchema({}, []),
      risk: "read",
      permission: "external.read",
      parse(input) {
        expectObject(input);
        return {};
      },
      execute(_input, context) {
        return session.snapshot(context.signal);
      },
    };
  const clickTool: ToolDefinition<{ role: AllowedAriaRole; name: string }> = {
      name: "browser_click",
      description: "Click exactly one visible control by accessible role and exact accessible name. This externally effectful action requires Run-level approval.",
      parameters: objectSchema({ role: { type: "string" }, name: { type: "string" } }, ["role", "name"]),
      risk: "execute",
      permission: "external.effect",
      parse(input) {
        const record = expectObject(input);
        return {
          role: expectRole(record.role),
          name: expectString(record.name, "name", 500),
        };
      },
      execute(input, context) {
        return session.click(input.role, input.name, context.signal);
      },
    };
  const fillTool: ToolDefinition<{ label: string; value: string }> = {
      name: "browser_fill",
      description: "Fill exactly one form field by exact accessible label. This externally effectful action requires Run-level approval.",
      parameters: objectSchema({ label: { type: "string" }, value: { type: "string" } }, ["label", "value"]),
      risk: "execute",
      permission: "external.effect",
      parse(input) {
        const record = expectObject(input);
        return {
          label: expectString(record.label, "label", 500),
          value: expectString(record.value, "value", 10_000, true),
        };
      },
      execute(input, context) {
        return session.fill(input.label, input.value, context.signal);
      },
    };
  const pressTool: ToolDefinition<{ key: string }> = {
      name: "browser_press",
      description: "Press one allowlisted navigation or submission key in the isolated browser. This externally effectful action requires Run-level approval.",
      parameters: objectSchema({ key: { type: "string", enum: ["Enter", "Escape", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"] } }, ["key"]),
      risk: "execute",
      permission: "external.effect",
      parse(input) {
        const key = expectObject(input).key;
        const allowed = ["Enter", "Escape", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
        if (typeof key !== "string" || !allowed.includes(key)) throw new Error("key is not allowlisted");
        return { key };
      },
      execute(input, context) {
        return session.press(input.key, context.signal);
      },
    };
  const tools: ToolDefinition[] = [navigateTool, snapshotTool, clickTool, fillTool, pressTool];
  return {
    tools,
    toolNames: tools.map((tool) => tool.name),
    close: () => session.close(),
  };
}

function objectSchema(
  properties: Record<string, unknown>,
  required: readonly string[],
): Record<string, unknown> {
  return { type: "object", properties, required, additionalProperties: false };
}

function expectObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("browser tool input must be an object");
  return value as Record<string, unknown>;
}

function expectString(
  value: unknown,
  name: string,
  maxLength: number,
  allowEmpty = false,
): string {
  if (typeof value !== "string" || value.length > maxLength || (!allowEmpty && value.trim().length === 0)) {
    throw new Error(`${name} must be a bounded string`);
  }
  return value;
}

function expectRole(value: unknown): AllowedAriaRole {
  const roles: AllowedAriaRole[] = [
    "button", "checkbox", "combobox", "link", "menuitem", "option", "radio", "searchbox", "switch", "tab", "textbox",
  ];
  if (typeof value !== "string" || !roles.includes(value as AllowedAriaRole)) throw new Error("role is not allowlisted");
  return value as AllowedAriaRole;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
