import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileSecretBackend } from "./file-backend";

let root: string;
const appKey = "b".repeat(64);
const namespace = "sample-installation";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const directory = () => path.join(root, "private");
const folder = (scope = namespace) => path.join(directory(), hash(scope));
const location = (name = "vendor-key", scope = namespace) =>
  path.join(folder(scope), `${hash(name)}.secret`);
const backend = (key = appKey) => new FileSecretBackend(directory(), () => key);

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "warlock-secret-files-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("encrypted file secrets", () => {
  it("creates storage lazily with owner-only modes and no plaintext on disk", async () => {
    const files = backend();
    expect(await files.get(namespace, "vendor-key")).toBeUndefined();
    expect(existsSync(directory())).toBe(false);
    await files.set(namespace, "vendor-key", "private-file-credential");
    expect((await lstat(directory())).mode & 0o777).toBe(0o700);
    expect((await lstat(folder())).mode & 0o777).toBe(0o700);
    expect((await lstat(location())).mode & 0o777).toBe(0o600);
    expect((await readFile(location())).includes(Buffer.from("private-file-credential"))).toBe(
      false,
    );
    expect(await backend().get(namespace, "vendor-key")).toBe("private-file-credential");
    expect(await files.remove(namespace, "vendor-key")).toBe(true);
    expect(await files.remove(namespace, "vendor-key")).toBe(false);
  });

  it("uses fresh IVs and preserves empty strings", async () => {
    const files = backend();
    await files.set(namespace, "vendor-key", "");
    const first = await readFile(location());
    await files.set(namespace, "vendor-key", "");
    expect(await files.get(namespace, "vendor-key")).toBe("");
    expect(await readFile(location())).not.toEqual(first);
  });

  it("reads the app key lazily and refuses missing/malformed keys without plaintext writes", async () => {
    let key: string | undefined;
    const files = new FileSecretBackend(directory(), () => key);
    await expect(files.set(namespace, "vendor-key", "private-credential")).rejects.toMatchObject({
      code: "KEY_REQUIRED",
    });
    expect(existsSync(directory())).toBe(false);
    key = "g".repeat(64);
    await expect(files.set(namespace, "vendor-key", "private-credential")).rejects.toMatchObject({
      code: "KEY_REQUIRED",
    });
    key = appKey;
    await files.set(namespace, "vendor-key", "private-credential");
    expect(await files.get(namespace, "vendor-key")).toBe("private-credential");
  });

  it("authenticates ciphertext and binds it to the namespace and secret name", async () => {
    const files = backend();
    await files.set(namespace, "vendor-key", "authenticated-credential");
    await expect(backend("c".repeat(64)).get(namespace, "vendor-key")).rejects.toMatchObject({
      code: "CORRUPT_FILE",
    });
    await copyFile(location(), location("other-key"));
    await expect(files.get(namespace, "other-key")).rejects.toMatchObject({ code: "CORRUPT_FILE" });
    await files.set("other-installation", "vendor-key", "other-credential");
    await copyFile(location(), location("vendor-key", "other-installation"));
    await expect(files.get("other-installation", "vendor-key")).rejects.toMatchObject({
      code: "CORRUPT_FILE",
    });
    const payload = await readFile(location());
    payload[payload.length - 1] = (payload[payload.length - 1] ?? 0) ^ 1;
    await writeFile(location(), payload);
    await expect(files.get(namespace, "vendor-key")).rejects.toMatchObject({
      code: "CORRUPT_FILE",
    });
  });

  it("rejects truncated/unknown payload formats", async () => {
    const files = backend();
    await files.set(namespace, "vendor-key", "format-credential");
    await writeFile(location(), Buffer.alloc(2));
    await expect(files.get(namespace, "vendor-key")).rejects.toMatchObject({
      code: "CORRUPT_FILE",
    });
  });

  it("repairs permissive modes on owned existing directories and regular files", async () => {
    const files = backend();
    await files.set(namespace, "vendor-key", "mode-credential");
    await chmod(directory(), 0o755);
    await chmod(folder(), 0o755);
    await chmod(location(), 0o644);
    expect(await files.get(namespace, "vendor-key")).toBe("mode-credential");
    expect((await lstat(directory())).mode & 0o777).toBe(0o700);
    expect((await lstat(folder())).mode & 0o777).toBe(0o700);
    expect((await lstat(location())).mode & 0o777).toBe(0o600);
  });

  it("rejects symlink directories and files and refuses multiply linked files", async () => {
    const files = backend();
    const outside = path.join(root, "outside");
    await mkdir(outside);
    await symlink(outside, directory());
    await expect(files.set(namespace, "vendor-key", "unwritten-credential")).rejects.toMatchObject({
      code: "UNSAFE_FILE",
    });
    await rm(directory());
    await files.set(namespace, "vendor-key", "original-credential");
    const outsideFile = path.join(outside, "credential");
    await writeFile(outsideFile, "must-remain-unchanged");
    await rm(location());
    await symlink(outsideFile, location());
    await expect(files.get(namespace, "vendor-key")).rejects.toMatchObject({ code: "UNSAFE_FILE" });
    await expect(files.remove(namespace, "vendor-key")).rejects.toMatchObject({
      code: "UNSAFE_FILE",
    });
    expect(await readFile(outsideFile, "utf8")).toBe("must-remain-unchanged");
    await rm(location());
    await link(outsideFile, location());
    await expect(files.get(namespace, "vendor-key")).rejects.toMatchObject({ code: "UNSAFE_FILE" });
  });

  it("keeps parallel writes to different keys and leaves no temporary files", async () => {
    const first = backend();
    const second = backend();
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        (index % 2 ? first : second).set(namespace, `key-${index}`, `parallel-credential-${index}`),
      ),
    );
    for (let index = 0; index < 12; index++) {
      expect(await first.get(namespace, `key-${index}`)).toBe(`parallel-credential-${index}`);
    }
    expect((await readdir(folder())).every((name) => name.endsWith(".secret"))).toBe(true);
  });
});

it.runIf(process.platform === "win32")(
  "fails closed when owner-only file ACLs cannot be enforced",
  async () => {
    await expect(
      backend().set(namespace, "vendor-key", "unwritten-credential"),
    ).rejects.toMatchObject({ code: "UNSAFE_FILE" });
  },
);
