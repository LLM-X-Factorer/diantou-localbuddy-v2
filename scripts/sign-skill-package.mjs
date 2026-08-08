import { createHash, createPrivateKey, sign } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const [directoryName, release, publisherKeyId, privateKeyName, permissionsCsv = ""] = process.argv.slice(2);
if (directoryName === undefined || release === undefined || publisherKeyId === undefined || privateKeyName === undefined) {
  throw new Error("Usage: node scripts/sign-skill-package.mjs skill-dir 1.2.3 publisher-key private.pem workspace.read,external.read");
}
if (!/^\d+\.\d+\.\d+$/.test(release)) throw new Error("release must be x.y.z");
const directory = resolve(directoryName);
const content = await readFile(resolve(directory, "SKILL.md"));
const id = directory.split(/[\\/]/).at(-1);
if (id === undefined || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error("Skill directory name must be its kebab-case id");
const permissions = [...new Set(permissionsCsv.split(",").map((value) => value.trim()).filter(Boolean))];
const allowedPermissions = new Set([
  "workspace.read", "deterministic.compute", "artifact.write", "worktree.write",
  "process.execute", "external.read", "external.effect",
]);
if (permissions.some((permission) => !allowedPermissions.has(permission))) {
  throw new Error("permissions contain an unknown LocalBuddy permission");
}
const unsigned = {
  version: 1,
  id,
  release,
  publisherKeyId,
  skillSha256: createHash("sha256").update(content).digest("hex"),
  permissions,
};
const privateKey = createPrivateKey(await readFile(resolve(privateKeyName)));
if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("publisher private key must be Ed25519");
const manifestRaw = `${JSON.stringify({
  ...unsigned,
  signature: sign(null, Buffer.from(JSON.stringify(unsigned)), privateKey).toString("base64"),
}, null, 2)}\n`;
await writeFile(resolve(directory, "manifest.json"), manifestRaw, { flag: "wx", mode: 0o600 });
process.stdout.write(`${JSON.stringify({
  id,
  release,
  manifestSha256: createHash("sha256").update(manifestRaw).digest("hex"),
}, null, 2)}\n`);
