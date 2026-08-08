import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { DESKTOP_CHANNELS } from "../src/desktop-contract.js";

test("keeps sandbox preload channel names aligned with the main contract", async () => {
  const preloadSource = await readFile("desktop/preload.cts", "utf8");
  for (const channel of Object.values(DESKTOP_CHANNELS)) {
    assert.ok(preloadSource.includes(`\"${channel}\"`), `preload is missing ${channel}`);
  }
});

