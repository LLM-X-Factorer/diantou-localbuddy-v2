import assert from "node:assert/strict";
import test from "node:test";

import {
  DesktopUpdateCoordinator,
  normalizeDesktopUpdateFeedUrl,
  resolveDesktopUpdateFeed,
  safeUpdateError,
  type DesktopUpdateTransport,
  type DesktopUpdateTransportEvent,
} from "../src/desktop-update.js";

const build = {
  version: "0.12.2-canary.17",
  channel: "canary" as const,
  sha: "0123456789abcdef0123456789abcdef01234567",
  dirty: false,
  packaged: true,
};

test("downloads an update but refuses to restart while a Desktop Run is active", async () => {
  const transport = new FakeUpdateTransport();
  let idle = false;
  const coordinator = new DesktopUpdateCoordinator({
    build,
    supported: true,
    feedUrl: "https://updates.example.test/canary/win32/x64/",
    transport,
    canInstall: () => idle,
    clock: () => new Date("2026-08-17T12:00:00.000Z"),
  });
  assert.equal(coordinator.current.status, "ready");
  await coordinator.checkForUpdates();
  assert.equal(transport.checks, 1);
  transport.emit({ type: "available" });
  assert.equal(coordinator.current.downloadStartedAt, "2026-08-17T12:00:00.000Z");
  transport.emit({ type: "available" });
  assert.equal(coordinator.current.downloadStartedAt, "2026-08-17T12:00:00.000Z");
  transport.emit({ type: "downloaded", releaseName: "0.12.2-canary.18" });
  assert.equal(coordinator.current.status, "downloaded");

  const blocked = await coordinator.quitAndInstall();
  assert.match(blocked.blockedReason ?? "", /Run/);
  assert.equal(transport.installs, 0);

  idle = true;
  const installing = await coordinator.quitAndInstall();
  assert.equal(installing.status, "installing");
  assert.equal(transport.installs, 1);
  coordinator.dispose();
});

test("fails closed for unsafe feeds and redacts updater URLs", () => {
  assert.throws(() => normalizeDesktopUpdateFeedUrl("http://updates.example.test/"), /HTTPS/);
  assert.throws(() => normalizeDesktopUpdateFeedUrl("https://updates.example.test/?token=secret"), /forbidden/);
  assert.equal(normalizeDesktopUpdateFeedUrl("http://127.0.0.1:48123/feed/"), "http://127.0.0.1:48123/feed/");
  assert.equal(
    safeUpdateError(new Error("GET https://updates.example.test/private?token=secret failed\n401")),
    "GET [update-url] failed 401",
  );
});

test("configures the public GitHub Release feed only for packaged stable Windows builds", () => {
  assert.equal(resolveDesktopUpdateFeed({
    build: { ...build, version: "0.12.3", channel: "stable" },
    platform: "win32",
    arch: "x64",
  }), "https://update.electronjs.org/LLM-X-Factorer/diantou-localbuddy-v2/win32-x64/0.12.3");

  assert.equal(resolveDesktopUpdateFeed({ build, platform: "win32", arch: "x64" }), undefined);
  assert.equal(resolveDesktopUpdateFeed({
    build: { ...build, version: "0.12.3", channel: "stable", packaged: false },
    platform: "win32",
    arch: "x64",
  }), undefined);
  assert.equal(resolveDesktopUpdateFeed({
    build: { ...build, version: "0.12.3", channel: "stable" },
    platform: "darwin",
    arch: "arm64",
  }), undefined);
});

test("allows an explicit safe feed override for packaged Windows acceptance builds", () => {
  assert.equal(resolveDesktopUpdateFeed({
    build,
    platform: "win32",
    arch: "x64",
    override: "http://127.0.0.1:48123/feed/",
  }), "http://127.0.0.1:48123/feed/");
});

class FakeUpdateTransport implements DesktopUpdateTransport {
  checks = 0;
  installs = 0;
  listener?: (event: DesktopUpdateTransportEvent) => void;

  configure(feedUrl: string): void {
    assert.equal(feedUrl, "https://updates.example.test/canary/win32/x64/");
  }

  async checkForUpdates(): Promise<void> {
    this.checks += 1;
  }

  quitAndInstall(): void {
    this.installs += 1;
  }

  subscribe(listener: (event: DesktopUpdateTransportEvent) => void): () => void {
    this.listener = listener;
    return () => { this.listener = undefined; };
  }

  emit(event: DesktopUpdateTransportEvent): void {
    this.listener?.(event);
  }
}
