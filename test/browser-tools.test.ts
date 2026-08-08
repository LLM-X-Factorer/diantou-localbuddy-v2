import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ControlledBrowserSession, createBrowserTools } from "../src/browser-tools.js";

test("uses an isolated allowlisted browser, performs explicit actions, and restores state", async (context) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><html><head><title>M4 Browser Fixture</title></head><body>
      <h1>Grounded browser evidence</h1>
      <button type="button" onclick="document.querySelector('#status').textContent='clicked safely'">Reveal evidence</button>
      <p id="status">waiting</p>
    </body></html>`);
  });
  await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  context.after(() => new Promise<void>((resolvePromise) => server.close(() => resolvePromise())));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("test server has no TCP address");
  const origin = `http://127.0.0.1:${address.port}`;
  const directory = await mkdtemp(join(tmpdir(), "localbuddy-browser-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const statePath = join(directory, "browser-state.json");
  const session = new ControlledBrowserSession([origin], statePath);
  const bundle = createBrowserTools(session);
  try {
    const navigation = await session.navigate(origin);
    assert.match(JSON.stringify(navigation), /Grounded browser evidence/);
    const clicked = await session.click("button", "Reveal evidence");
    assert.match(JSON.stringify(clicked), /clicked safely/);
    await assert.rejects(session.navigate("https://example.com"), /outside the Run origin allowlist/);
    assert.equal(bundle.tools.find((tool) => tool.name === "browser_navigate")?.risk, "read");
    assert.equal(bundle.tools.find((tool) => tool.name === "browser_click")?.risk, "execute");
    assert.equal(JSON.parse(await readFile(statePath, "utf8")).currentUrl, `${origin}/`);
  } finally {
    await bundle.close();
  }

  const restored = new ControlledBrowserSession([origin], statePath);
  try {
    assert.match(JSON.stringify(await restored.snapshot()), /Grounded browser evidence/);
  } finally {
    await restored.close();
  }
});
