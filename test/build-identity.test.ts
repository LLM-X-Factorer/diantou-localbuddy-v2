import assert from "node:assert/strict";
import test from "node:test";

import {
  fallbackDesktopBuildIdentity,
  parseDesktopBuildIdentity,
} from "../src/build-identity.js";

test("parses an exact traceable packaged build identity", () => {
  assert.deepEqual(parseDesktopBuildIdentity({
    version: "0.12.2-canary.17",
    channel: "canary",
    sha: "0123456789abcdef0123456789abcdef01234567",
    dirty: false,
  }, "0.12.2-canary.17", true), {
    version: "0.12.2-canary.17",
    channel: "canary",
    sha: "0123456789abcdef0123456789abcdef01234567",
    dirty: false,
    packaged: true,
  });
});

test("rejects mismatched or untraceable build metadata", () => {
  assert.throws(
    () => parseDesktopBuildIdentity({ version: "0.12.1", channel: "stable", sha: "0123456", dirty: false }, "0.12.2", true),
    /does not match/,
  );
  assert.throws(
    () => parseDesktopBuildIdentity({ version: "0.12.2", channel: "nightly", sha: "0123456", dirty: false }, "0.12.2", true),
    /channel/,
  );
  assert.equal(fallbackDesktopBuildIdentity("0.12.2", false).channel, "dev");
  assert.equal(fallbackDesktopBuildIdentity("0.12.2", false).dirty, true);
});
