import assert from "node:assert/strict";
import test from "node:test";

import {
  DesktopUpdateCoordinator,
  normalizeDesktopUpdateFeedUrl,
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
  });
  assert.equal(coordinator.current.status, "ready");
  await coordinator.checkForUpdates();
  assert.equal(transport.checks, 1);
  transport.emit({ type: "available" });
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
