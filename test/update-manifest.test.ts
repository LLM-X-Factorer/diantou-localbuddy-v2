import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  canonicalManifest,
  fetchAndStageUpdate,
  parseAndVerifyUpdateManifest,
  type SignedUpdateManifest,
} from "../src/update-manifest.js";

test("verifies an Ed25519 update manifest, stages exact bytes, and blocks rollback", async (context) => {
  const stageRoot = await mkdtemp(join(tmpdir(), "localbuddy-update-"));
  context.after(async () => rm(stageRoot, { recursive: true, force: true }));
  const artifactBytes = Buffer.from("verified-update-artifact");
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  let manifestRaw = "";
  const server = createServer((request, response) => {
    if (request.url === "/manifest.json") {
      response.writeHead(200, { "content-type": "application/json" }).end(manifestRaw);
      return;
    }
    if (request.url === "/LocalBuddy.zip") {
      response.writeHead(200, { "content-type": "application/zip" }).end(artifactBytes);
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("server address unavailable");
  const origin = `http://127.0.0.1:${address.port}`;
  const unsigned = {
    version: 1 as const,
    product: "com.diantou.localbuddy" as const,
    releaseVersion: "0.9.1",
    minRuntimeVersion: "0.9.0",
    publishedAt: "2026-08-08T00:00:00.000Z",
    artifacts: [{
      platform: "darwin" as const,
      arch: "arm64" as const,
      url: `${origin}/LocalBuddy.zip`,
      sha256: createHash("sha256").update(artifactBytes).digest("hex"),
      bytes: artifactBytes.length,
      fileName: "LocalBuddy.zip",
    }],
  };
  const manifest: SignedUpdateManifest = {
    ...unsigned,
    signature: sign(null, Buffer.from(canonicalManifest(unsigned)), privateKey).toString("base64"),
  };
  manifestRaw = `${JSON.stringify(manifest)}\n`;
  const publicKeyBase64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  assert.equal(parseAndVerifyUpdateManifest(manifestRaw, publicKeyBase64).releaseVersion, "0.9.1");
  assert.throws(
    () => parseAndVerifyUpdateManifest(manifestRaw.replace("0.9.1", "0.9.2"), publicKeyBase64),
    /signature/,
  );

  const staged = await fetchAndStageUpdate({
    manifestUrl: `${origin}/manifest.json`,
    publicKeyBase64,
    currentVersion: "0.9.0",
    stageRoot,
    platform: "darwin",
    arch: "arm64",
  });
  assert.deepEqual(await readFile(staged.artifactPath), artifactBytes);
  assert.equal(staged.automaticInstallAllowed, false);

  const older = { ...unsigned, releaseVersion: "0.9.0", minRuntimeVersion: "0.8.0" };
  manifestRaw = JSON.stringify({
    ...older,
    signature: sign(null, Buffer.from(canonicalManifest(older)), privateKey).toString("base64"),
  });
  await assert.rejects(fetchAndStageUpdate({
    manifestUrl: `${origin}/manifest.json`,
    publicKeyBase64,
    currentVersion: "0.8.9",
    stageRoot,
    platform: "darwin",
    arch: "arm64",
  }), /rollback/);
});
