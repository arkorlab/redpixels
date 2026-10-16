import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  GMAIL_SCOPE,
  email,
  object,
  operationName,
  string,
  type CredentialStore,
  type DraftOperation,
  type GmailCredential,
} from "./contracts.mts";

export function gmailHome(env = process.env): string {
  if (env.REDPIXELS_GMAIL_HOME) return resolve(env.REDPIXELS_GMAIL_HOME);
  const base =
    process.platform === "win32"
      ? env.LOCALAPPDATA || join(homedir(), "AppData", "Local")
      : process.platform === "darwin"
        ? join(homedir(), "Library", "Application Support")
        : env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  return join(base, "redpixels", "gmail");
}
function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}
export async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("Gmail state directory must be a real directory");
  if (process.platform !== "win32" && info.mode & 0o077)
    throw new Error("Gmail state directory must have mode 0700");
  if (process.getuid && info.uid !== process.getuid())
    throw new Error("Gmail state directory must belong to the current OS user");
}
export async function readPrivateJson(path: string): Promise<unknown> {
  // O_NOFOLLOW prevents accidentally reading through a credential-file symlink.
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 1024 * 1024)
      throw new Error("Invalid private JSON file");
    if (process.platform !== "win32" && info.mode & 0o077)
      throw new Error(
        "Private JSON file must have mode 0600; run chmod 600 on it",
      );
    if (process.getuid && info.uid !== process.getuid())
      throw new Error("Private JSON file must belong to the current OS user");
    try {
      return JSON.parse(await handle.readFile("utf8")) as unknown;
    } catch {
      throw new Error("Invalid private JSON file");
    }
  } finally {
    await handle.close();
  }
}
export async function writePrivateJson(
  path: string,
  value: unknown,
): Promise<void> {
  await privateDirectory(dirname(path));
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
export function credential(value: unknown): GmailCredential {
  const data = object(value);
  if (
    data.version !== 1 ||
    !Array.isArray(data.scopes) ||
    !data.scopes.every((scope) => typeof scope === "string") ||
    !data.scopes.includes(GMAIL_SCOPE)
  )
    throw new Error("Unsupported Gmail credential; run auth login again");
  return {
    version: 1,
    email: email(data.email),
    clientId: string(data.clientId, "OAuth client ID"),
    clientSecret: string(data.clientSecret, "OAuth client secret"),
    refreshToken: string(data.refreshToken, "refresh token"),
    scopes: data.scopes as string[],
  };
}
export class FileCredentialStore implements CredentialStore {
  readonly path: string;
  constructor(home: string) {
    this.path = join(home, "credentials.json");
  }
  async read(): Promise<GmailCredential | null> {
    try {
      return credential(await readPrivateJson(this.path));
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
  }
  async write(value: GmailCredential): Promise<void> {
    await writePrivateJson(this.path, value);
  }
  async remove(): Promise<void> {
    await unlink(this.path).catch((error: unknown) => {
      if (!missing(error)) throw error;
    });
  }
}
export class KeychainCredentialStore implements CredentialStore {
  readonly account: string;
  constructor(home: string) {
    this.account = createHash("sha256").update(resolve(home)).digest("hex");
  }
  private async entry() {
    try {
      const { Entry } = await import("@napi-rs/keyring");
      return new Entry("redpixels.gmail", this.account, {
        linux: { store: "secret-service" },
      });
    } catch {
      throw new Error(
        "OS keychain unavailable; use REDPIXELS_GMAIL_TOKEN_STORE=file explicitly for a protected, unencrypted local file",
      );
    }
  }
  async read(): Promise<GmailCredential | null> {
    const entry = await this.entry();
    let raw: string | null;
    try {
      raw = entry.getPassword();
    } catch {
      throw new Error(
        "Cannot read OS keychain; unlock it or explicitly select the file token store",
      );
    }
    if (raw === null) return null;
    try {
      return credential(JSON.parse(raw));
    } catch {
      throw new Error(
        "Invalid Gmail credential in OS keychain; run auth login again",
      );
    }
  }
  async write(value: GmailCredential): Promise<void> {
    const entry = await this.entry();
    try {
      entry.setPassword(JSON.stringify(value));
    } catch {
      throw new Error(
        "Cannot write OS keychain; no plaintext fallback was used",
      );
    }
  }
  async remove(): Promise<void> {
    const entry = await this.entry();
    try {
      if (entry.getPassword() !== null) entry.deletePassword();
    } catch {
      throw new Error("Cannot remove Gmail credential from OS keychain");
    }
  }
}
export class OperationStore {
  readonly home: string;
  constructor(home: string) {
    this.home = home;
  }
  private path(operation: string): string {
    operationName(operation);
    return join(this.home, "operations", `${operation}.json`);
  }
  async read(operation: string): Promise<DraftOperation | null> {
    try {
      const data = object(await readPrivateJson(this.path(operation)));
      if (
        data.version !== 1 ||
        data.operation !== operation ||
        typeof data.fingerprint !== "string" ||
        typeof data.state !== "string" ||
        typeof data.trackingId !== "string" ||
        typeof data.pixelUrl !== "string" ||
        typeof data.pixelHtml !== "string" ||
        typeof data.trackerOrigin !== "string" ||
        typeof data.account !== "string" ||
        typeof data.armed !== "boolean" ||
        ![
          "registered",
          "creating",
          "created",
          "verified",
          "verification_failed",
          "ambiguous",
        ].includes(data.state) ||
        typeof data.createdAt !== "string" ||
        (data.draftId !== undefined && typeof data.draftId !== "string") ||
        (data.gmailMessageId !== undefined &&
          typeof data.gmailMessageId !== "string") ||
        (data.verifiedAt !== undefined &&
          typeof data.verifiedAt !== "string") ||
        (data.state === "verified" &&
          (!data.draftId || !data.gmailMessageId || !data.verifiedAt))
      )
        throw new Error("Invalid draft operation state");
      return data as unknown as DraftOperation;
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
  }
  async write(value: DraftOperation): Promise<void> {
    await writePrivateJson(this.path(value.operation), value);
  }
  async lock<T>(operation: string, run: () => Promise<T>): Promise<T> {
    const lock = `${this.path(operation)}.lock`;
    await privateDirectory(this.home);
    await privateDirectory(dirname(lock));
    let handle;
    try {
      handle = await open(lock, "wx", 0o600);
    } catch {
      throw new Error(
        `Operation ${operation} is locked; inspect its journal before removing a stale lock`,
      );
    }
    try {
      return await run();
    } finally {
      await handle.close();
      await unlink(lock);
    }
  }
}
