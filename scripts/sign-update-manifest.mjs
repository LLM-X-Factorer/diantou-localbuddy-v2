import { createPrivateKey, sign } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const [inputName, privateKeyName, outputName] = process.argv.slice(2);
if (inputName === undefined || privateKeyName === undefined || outputName === undefined) {
  throw new Error("Usage: node scripts/sign-update-manifest.mjs unsigned.json ed25519-private.pem signed.json");
}
const input = JSON.parse(await readFile(resolve(inputName), "utf8"));
const canonical = JSON.stringify({
  version: 1,
  product: "com.diantou.localbuddy",
  releaseVersion: input.releaseVersion,
  minRuntimeVersion: input.minRuntimeVersion,
  publishedAt: input.publishedAt,
  artifacts: input.artifacts.map((artifact) => ({
    platform: artifact.platform,
    arch: artifact.arch,
    url: artifact.url,
    sha256: artifact.sha256,
    bytes: artifact.bytes,
    fileName: artifact.fileName,
  })),
});
const privateKey = createPrivateKey(await readFile(resolve(privateKeyName)));
if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("release private key must be Ed25519");
await writeFile(resolve(outputName), `${JSON.stringify({
  ...input,
  version: 1,
  product: "com.diantou.localbuddy",
  signature: sign(null, Buffer.from(canonical), privateKey).toString("base64"),
}, null, 2)}\n`, { flag: "wx", mode: 0o600 });
