import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { registerLogSecret } from "@warlock.js/logger";
import { constants, type Stats } from "node:fs";
import { lstat, mkdir, open, rename, unlink, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { SecretStoreError } from "./errors";
import type { SecretBackend } from "./types";

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** One authenticated file per secret: concurrent writes to different keys cannot clobber each other. */
export class FileSecretBackend implements SecretBackend {
  public readonly type = "file";
  public constructor(
    private readonly directory: string,
    private readonly encryptionKey: () => string | undefined,
  ) {}

  private key(namespace: string): Buffer {
    const secret = this.encryptionKey();
    if (typeof secret !== "string" || !/^[a-f\d]{64}$/i.test(secret)) {
      throw new SecretStoreError("KEY_REQUIRED");
    }
    registerLogSecret(secret, ["encryptionKey"]);
    // Core's encrypt/decrypt helpers use global config directly. Derive a
    // separate AES-256-GCM key without changing that global config.
    // https://nodejs.org/docs/latest-v22.x/api/crypto.html#cryptohkdfsyncdigest-ikm-salt-info-keylen
    return Buffer.from(
      hkdfSync("sha256", Buffer.from(secret, "hex"), namespace, "warlock:secrets:v1", 32),
    );
  }

  private validateOwner(stats: Stats, directory: boolean): void {
    if (
      (directory ? !stats.isDirectory() : !stats.isFile() || stats.nlink !== 1) ||
      (process.getuid && stats.uid !== process.getuid())
    ) {
      throw new SecretStoreError("UNSAFE_FILE");
    }
  }

  private async folder(namespace: string, create: boolean): Promise<string | undefined> {
    // Node's Windows modes cannot enforce owner-only ACLs. Fail closed there.
    // https://nodejs.org/docs/latest-v22.x/api/fs.html#file-modes
    const root = path.resolve(this.directory);
    const folder = path.join(root, digest(namespace));
    for (const directory of [root, folder]) {
      if (!create) {
        try {
          await lstat(directory);
        } catch (error) {
          if (isMissing(error)) return undefined;
          throw error;
        }
      }
      if (process.platform === "win32") throw new SecretStoreError("UNSAFE_FILE");
      if (create) await mkdir(directory, { recursive: true, mode: 0o700 });
      this.validateOwner(await lstat(directory), true);
      const handle = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        this.validateOwner(await handle.stat(), true);
        await handle.chmod(0o700);
        if (((await handle.stat()).mode & 0o777) !== 0o700) {
          throw new SecretStoreError("UNSAFE_FILE");
        }
      } finally {
        await handle.close();
      }
    }
    return folder;
  }

  private async location(
    namespace: string,
    name: string,
    create: boolean,
  ): Promise<string | undefined> {
    const folder = await this.folder(namespace, create);
    return folder ? path.join(folder, `${digest(name)}.secret`) : undefined;
  }

  private aad(namespace: string, name: string): Buffer {
    return Buffer.from(JSON.stringify(["warlock:secrets:v1", namespace, name]));
  }

  private async safe<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof SecretStoreError) throw error;
      if (error instanceof Error && "code" in error && error.code === "ELOOP") {
        throw new SecretStoreError("UNSAFE_FILE");
      }
      throw new SecretStoreError("UNAVAILABLE");
    }
  }

  public async get(namespace: string, name: string): Promise<string | undefined> {
    return this.safe(async () => {
      const file = await this.location(namespace, name, false);
      if (!file) return undefined;
      let handle: FileHandle;
      try {
        handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      } catch (error) {
        if (isMissing(error)) return undefined;
        throw error;
      }
      let payload: Buffer;
      try {
        this.validateOwner(await handle.stat(), false);
        await handle.chmod(0o600);
        if (((await handle.stat()).mode & 0o777) !== 0o600) {
          throw new SecretStoreError("UNSAFE_FILE");
        }
        payload = await handle.readFile();
      } finally {
        await handle.close();
      }
      const key = this.key(namespace);
      try {
        // v1 (one byte), 12-byte IV, 16-byte tag, then ciphertext (possibly empty).
        if (payload.length < 29 || payload[0] !== 1) throw new Error();
        const decipher = createDecipheriv("aes-256-gcm", key, payload.subarray(1, 13));
        decipher.setAAD(this.aad(namespace, name));
        decipher.setAuthTag(payload.subarray(13, 29));
        return Buffer.concat([decipher.update(payload.subarray(29)), decipher.final()]).toString(
          "utf8",
        );
      } catch {
        throw new SecretStoreError("CORRUPT_FILE");
      }
    });
  }

  public async set(namespace: string, name: string, value: string): Promise<void> {
    return this.safe(async () => {
      const key = this.key(namespace);
      const file = await this.location(namespace, name, true);
      if (!file) throw new SecretStoreError("UNAVAILABLE");
      try {
        this.validateOwner(await lstat(file), false);
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(this.aad(namespace, name));
      const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      const payload = Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), encrypted]);
      const temporary = `${file}.${randomBytes(16).toString("hex")}.tmp`;
      const handle = await open(temporary, "wx", 0o600);
      try {
        try {
          await handle.chmod(0o600);
          this.validateOwner(await handle.stat(), false);
          if (((await handle.stat()).mode & 0o777) !== 0o600) {
            throw new SecretStoreError("UNSAFE_FILE");
          }
          await handle.writeFile(payload);
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(temporary, file);
      } finally {
        await unlink(temporary).catch((error: unknown) => {
          if (!isMissing(error)) throw error;
        });
      }
    });
  }

  public async remove(namespace: string, name: string): Promise<boolean> {
    return this.safe(async () => {
      const file = await this.location(namespace, name, false);
      if (!file) return false;
      try {
        this.validateOwner(await lstat(file), false);
        await unlink(file);
        return true;
      } catch (error) {
        if (isMissing(error)) return false;
        throw error;
      }
    });
  }
}
