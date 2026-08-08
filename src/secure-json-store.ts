import { execFile, spawn } from "node:child_process";

const MAX_SECRET_BYTES = 1_000_000;

export interface SecureJsonStore {
  load(account: string): Promise<unknown | undefined>;
  save(account: string, value: unknown): Promise<void>;
  delete(account: string): Promise<void>;
}

export class PlatformSecureJsonStore implements SecureJsonStore {
  readonly #service: string;

  constructor(service: string) {
    if (!/^[a-zA-Z0-9._-]{3,200}$/.test(service)) throw new Error("invalid credential service");
    this.#service = service;
  }

  async load(account: string): Promise<unknown | undefined> {
    validateAccount(account);
    try {
      const raw = process.platform === "darwin"
        ? (await execute("security", [
            "find-generic-password", "-a", account, "-s", this.#service, "-w",
          ])).stdout
        : process.platform === "linux"
          ? (await execute("secret-tool", [
              "lookup", "application", this.#service, "account", account,
            ])).stdout
          : await windowsCredentialRead(`${this.#service}:${account}`);
      if (Buffer.byteLength(raw) > MAX_SECRET_BYTES) throw new Error("credential payload is too large");
      return JSON.parse(raw) as unknown;
    } catch (error) {
      if (isMissingCredential(error)) return undefined;
      throw new Error(`secure credential read failed for ${this.#service}`, { cause: error });
    }
  }

  async save(account: string, value: unknown): Promise<void> {
    validateAccount(account);
    const raw = JSON.stringify(value);
    if (Buffer.byteLength(raw) > MAX_SECRET_BYTES) throw new Error("credential payload is too large");
    if (process.platform === "darwin") {
      await execute("security", [
        "add-generic-password", "-a", account, "-s", this.#service, "-w", raw, "-U",
      ]);
      return;
    }
    if (process.platform === "linux") {
      await spawnWithInput("secret-tool", [
        "store", "--label", "LocalBuddy credential", "application", this.#service, "account", account,
      ], raw);
      return;
    }
    await windowsCredentialWrite(`${this.#service}:${account}`, raw);
  }

  async delete(account: string): Promise<void> {
    validateAccount(account);
    try {
      if (process.platform === "darwin") {
        await execute("security", ["delete-generic-password", "-a", account, "-s", this.#service]);
      } else if (process.platform === "linux") {
        await execute("secret-tool", [
          "clear", "application", this.#service, "account", account,
        ]);
      } else {
        await windowsCredentialDelete(`${this.#service}:${account}`);
      }
    } catch (error) {
      if (!isMissingCredential(error)) throw error;
    }
  }
}

function validateAccount(account: string): void {
  if (!/^[a-zA-Z0-9._:-]{1,240}$/.test(account)) throw new Error("invalid credential account");
}

function execute(command: string, args: readonly string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: "utf8", maxBuffer: MAX_SECRET_BYTES + 1 }, (error, stdout, stderr) => {
      if (error !== null) {
        reject(new Error(`${command} failed: ${stderr.trim() || error.message}`, { cause: error }));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function spawnWithInput(command: string, args: readonly string[], input: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-20_000); });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed with exit ${String(code)}: ${stderr.trim()}`));
    });
    child.stdin.end(input);
  });
}

const WINDOWS_CREDENTIAL_SCRIPT = String.raw`
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class LBCred {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct CREDENTIAL {
    public UInt32 Flags; public UInt32 Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public UInt32 CredentialBlobSize;
    public IntPtr CredentialBlob; public UInt32 Persist; public UInt32 AttributeCount; public IntPtr Attributes;
    public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredRead(string target, uint type, int flags, out IntPtr credential);
  [DllImport("advapi32", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredWrite(ref CREDENTIAL credential, uint flags);
  [DllImport("advapi32", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredDelete(string target, uint type, int flags);
  [DllImport("advapi32", SetLastError=true)] public static extern void CredFree(IntPtr credential);
  public static string Read(string target) { IntPtr p; if(!CredRead(target,1,0,out p)) throw new System.ComponentModel.Win32Exception(); try { var c=(CREDENTIAL)Marshal.PtrToStructure(p,typeof(CREDENTIAL)); return Marshal.PtrToStringUni(c.CredentialBlob,(int)c.CredentialBlobSize/2); } finally { CredFree(p); } }
  public static void Write(string target,string value) { byte[] b=Encoding.Unicode.GetBytes(value); IntPtr p=Marshal.AllocCoTaskMem(b.Length); try { Marshal.Copy(b,0,p,b.Length); var c=new CREDENTIAL{Type=1,TargetName=target,CredentialBlobSize=(uint)b.Length,CredentialBlob=p,Persist=2,UserName="LocalBuddy"}; if(!CredWrite(ref c,0)) throw new System.ComponentModel.Win32Exception(); } finally { Marshal.FreeCoTaskMem(p); } }
  public static void Delete(string target) { if(!CredDelete(target,1,0)) throw new System.ComponentModel.Win32Exception(); }
}`;

async function windowsCredentialRead(target: string): Promise<string> {
  ensureWindows();
  return (await powershellCredential("Read", target)).trim();
}

async function windowsCredentialWrite(target: string, value: string): Promise<void> {
  ensureWindows();
  await powershellCredential("Write", target, value);
}

async function windowsCredentialDelete(target: string): Promise<void> {
  ensureWindows();
  await powershellCredential("Delete", target);
}

async function powershellCredential(operation: "Read" | "Write" | "Delete", ...values: string[]): Promise<string> {
  const encoded = values.map((value) => Buffer.from(value, "utf8").toString("base64"));
  const argumentsExpression = encoded.map((value) => `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${value}'))`).join(",");
  const script = `Add-Type -TypeDefinition @'\n${WINDOWS_CREDENTIAL_SCRIPT}\n'@; [LBCred]::${operation}(${argumentsExpression})`;
  return (await execute("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script])).stdout;
}

function ensureWindows(): void {
  if (process.platform !== "win32") throw new Error("Windows Credential Manager is unavailable");
}

function isMissingCredential(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : String(error);
  return /could not be found|not found|SecKeychainSearchCopyNext|The specified item|1168|exit 1/i.test(text);
}
