import type { DesktopBuildIdentity } from "./build-identity.js";

export type DesktopUpdateStatus =
  | "disabled"
  | "ready"
  | "checking"
  | "available"
  | "not_available"
  | "downloaded"
  | "installing"
  | "error";

export interface DesktopUpdateView {
  supported: boolean;
  configured: boolean;
  status: DesktopUpdateStatus;
  build: DesktopBuildIdentity;
  releaseName?: string;
  downloadStartedAt?: string;
  blockedReason?: string;
  error?: string;
}

export type DesktopUpdateTransportEvent =
  | { type: "available"; releaseName?: string }
  | { type: "not_available" }
  | { type: "downloaded"; releaseName?: string }
  | { type: "error"; error: unknown };

export interface DesktopUpdateTransport {
  configure(feedUrl: string): void;
  checkForUpdates(): Promise<void>;
  quitAndInstall(): void;
  subscribe(listener: (event: DesktopUpdateTransportEvent) => void): () => void;
}

const PUBLIC_GITHUB_REPOSITORY = "LLM-X-Factorer/diantou-localbuddy-v2";
const PUBLIC_UPDATE_SERVICE = "https://update.electronjs.org";

export function resolveDesktopUpdateFeed(input: {
  build: DesktopBuildIdentity;
  platform: string;
  arch: string;
  override?: string;
}): string | undefined {
  if (!input.build.packaged || input.platform !== "win32") return undefined;
  if (input.override !== undefined) return input.override;
  if (input.build.channel !== "stable") return undefined;
  if (input.arch !== "x64" && input.arch !== "arm64") throw new Error("Windows update architecture is unsupported");
  return `${PUBLIC_UPDATE_SERVICE}/${PUBLIC_GITHUB_REPOSITORY}/${input.platform}-${input.arch}/${input.build.version}`;
}

export class DesktopUpdateCoordinator {
  readonly #transport: DesktopUpdateTransport | undefined;
  readonly #canInstall: () => boolean | Promise<boolean>;
  readonly #onChange: (view: DesktopUpdateView) => void;
  readonly #clock: () => Date;
  readonly #unsubscribe: (() => void) | undefined;
  #view: DesktopUpdateView;

  constructor(input: {
    build: DesktopBuildIdentity;
    supported: boolean;
    feedUrl?: string;
    transport?: DesktopUpdateTransport;
    canInstall: () => boolean | Promise<boolean>;
    onChange?: (view: DesktopUpdateView) => void;
    clock?: () => Date;
  }) {
    this.#transport = input.transport;
    this.#canInstall = input.canInstall;
    this.#onChange = input.onChange ?? (() => undefined);
    this.#clock = input.clock ?? (() => new Date());
    this.#view = {
      supported: input.supported,
      configured: false,
      status: "disabled",
      build: input.build,
    };
    if (!input.supported || input.transport === undefined || input.feedUrl === undefined) return;
    try {
      const feedUrl = normalizeDesktopUpdateFeedUrl(input.feedUrl);
      this.#unsubscribe = input.transport.subscribe((event) => this.#handle(event));
      input.transport.configure(feedUrl);
      this.#view = { ...this.#view, configured: true, status: "ready" };
    } catch (error) {
      this.#view = { ...this.#view, status: "error", error: safeUpdateError(error) };
    }
  }

  get current(): DesktopUpdateView {
    return { ...this.#view, build: { ...this.#view.build } };
  }

  async checkForUpdates(): Promise<DesktopUpdateView> {
    if (!this.#view.supported || !this.#view.configured || this.#transport === undefined) {
      throw new Error("Windows update feed is not configured for this build");
    }
    if (this.#view.status === "checking" || this.#view.status === "available") return this.current;
    if (this.#view.status === "downloaded" || this.#view.status === "installing") return this.current;
    this.#set({
      status: "checking",
      downloadStartedAt: undefined,
      error: undefined,
      blockedReason: undefined,
    });
    try {
      await this.#transport.checkForUpdates();
    } catch (error) {
      this.#set({ status: "error", error: safeUpdateError(error) });
    }
    return this.current;
  }

  async quitAndInstall(): Promise<DesktopUpdateView> {
    if (this.#view.status !== "downloaded" || this.#transport === undefined) {
      throw new Error("No verified Windows update is ready to install");
    }
    if (!await this.#canInstall()) {
      this.#set({ blockedReason: "仍有 Desktop Run 正在执行，请先结束或取消任务。" });
      return this.current;
    }
    this.#set({ status: "installing", blockedReason: undefined, error: undefined });
    this.#transport.quitAndInstall();
    return this.current;
  }

  dispose(): void {
    this.#unsubscribe?.();
  }

  #handle(event: DesktopUpdateTransportEvent): void {
    switch (event.type) {
      case "available":
        this.#set({
          status: "available",
          releaseName: event.releaseName,
          downloadStartedAt: this.#view.downloadStartedAt ?? this.#clock().toISOString(),
          error: undefined,
        });
        break;
      case "not_available":
        this.#set({
          status: "not_available",
          releaseName: undefined,
          downloadStartedAt: undefined,
          error: undefined,
        });
        break;
      case "downloaded":
        this.#set({ status: "downloaded", releaseName: event.releaseName, error: undefined });
        break;
      case "error":
        this.#set({ status: "error", error: safeUpdateError(event.error) });
        break;
    }
  }

  #set(patch: Partial<DesktopUpdateView>): void {
    this.#view = { ...this.#view, ...patch };
    this.#onChange(this.current);
  }
}

export function normalizeDesktopUpdateFeedUrl(value: string): string {
  const url = new URL(value);
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("Windows update feed must use HTTPS or loopback HTTP");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Windows update feed URL contains forbidden credentials or parameters");
  }
  return url.toString();
}

export function safeUpdateError(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value);
  return message
    .replace(/https?:\/\/[^\s)]+/giu, "[update-url]")
    .replace(/[\r\n\t]+/gu, " ")
    .slice(0, 300);
}
