import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lstat, mkdir, readFile, rename, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  directoryIdentityAsync,
  DirectoryMoveError,
  fs,
  moveDirectoryNoReplaceAsync,
} from "../src/index";
import { withTempDir } from "./helpers";

const posixOnly = process.platform === "win32" ? describe.skip : describe;

async function expectMoveError(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(DirectoryMoveError);
  return error as DirectoryMoveError;
}

posixOnly("moveDirectoryNoReplaceAsync", () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  let source: string;

  beforeEach(async () => {
    ({ dir, cleanup } = await withTempDir());
    source = path.join(dir, "feature");
    await mkdir(path.join(source, "receipts"), { recursive: true });
    await writeFile(path.join(source, "receipts", "op-1.json"), '{"ok":true}');
  });

  afterEach(() => cleanup());

  it("moves the whole tree and keeps the directory's identity", async () => {
    const before = await directoryIdentityAsync(source);
    const destination = path.join(dir, "archive");

    const result = await moveDirectoryNoReplaceAsync(source, destination);

    expect(result).toEqual({
      type: "moved",
      from: source,
      to: destination,
      identity: before,
      synced: false,
    });
    expect(await directoryIdentityAsync(destination)).toEqual(before);
    expect(await readFile(path.join(destination, "receipts", "op-1.json"), "utf8")).toBe(
      '{"ok":true}',
    );
    await expect(lstat(source)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("syncs both parent directories when asked", async () => {
    await mkdir(path.join(dir, "archive"));
    const destination = path.join(dir, "archive", "feature");

    const result = await moveDirectoryNoReplaceAsync(source, destination, { syncParents: true });

    expect(result.synced).toBe(true);
  });

  it("refuses an existing EMPTY destination that an ordinary rename would replace", async () => {
    const destination = path.join(dir, "taken");
    await mkdir(destination);
    const occupant = await directoryIdentityAsync(destination);

    const error = await expectMoveError(moveDirectoryNoReplaceAsync(source, destination));

    expect(error.reason).toBe("destination-exists");
    expect(error.outcome).toBe("not-moved");
    expect(await directoryIdentityAsync(destination)).toEqual(occupant);
    expect(await readFile(path.join(source, "receipts", "op-1.json"), "utf8")).toBe('{"ok":true}');

    // Control: the ordinary rename does replace that directory.
    await rename(source, destination);
    expect(await directoryIdentityAsync(destination)).not.toEqual(occupant);
  });

  it("refuses a destination held by a file or a symlink", async () => {
    const file = path.join(dir, "file");
    await writeFile(file, "x");
    const link = path.join(dir, "link");
    await symlink(path.join(dir, "nowhere"), link);

    for (const destination of [file, link]) {
      const error = await expectMoveError(moveDirectoryNoReplaceAsync(source, destination));
      expect(error.reason).toBe("destination-exists");
      expect(error.outcome).toBe("not-moved");
    }

    expect(await readFile(file, "utf8")).toBe("x");
  });

  it("refuses a missing source, a file source and a symlinked source", async () => {
    const file = path.join(dir, "plain.txt");
    await writeFile(file, "x");
    const link = path.join(dir, "feature-link");
    await symlink(source, link);

    const missing = await expectMoveError(
      moveDirectoryNoReplaceAsync(path.join(dir, "absent"), path.join(dir, "a")),
    );
    const notDirectory = await expectMoveError(
      moveDirectoryNoReplaceAsync(file, path.join(dir, "b")),
    );
    const symlinked = await expectMoveError(moveDirectoryNoReplaceAsync(link, path.join(dir, "c")));

    expect(missing.reason).toBe("source-missing");
    expect(notDirectory.reason).toBe("source-not-directory");
    expect(symlinked.reason).toBe("source-not-directory");
    expect([missing, notDirectory, symlinked].map((error) => error.outcome)).toEqual([
      "not-moved",
      "not-moved",
      "not-moved",
    ]);
  });

  it("refuses when the source is not the expected directory", async () => {
    const expected = await directoryIdentityAsync(source);
    await rename(source, path.join(dir, "elsewhere"));
    await mkdir(source);

    const error = await expectMoveError(
      moveDirectoryNoReplaceAsync(source, path.join(dir, "archive"), { expectedSource: expected }),
    );

    expect(error.reason).toBe("source-identity-mismatch");
    await expect(lstat(path.join(dir, "archive"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses a destination inside the source, or the source itself", async () => {
    for (const destination of [source, path.join(source, "nested"), path.join(source, "..x")]) {
      const error = await expectMoveError(moveDirectoryNoReplaceAsync(source, destination));
      expect(error.reason).toBe("invalid-destination");
    }
  });

  it("accepts a sibling whose name starts with two dots", async () => {
    const destination = path.join(dir, "..archive");

    await expect(moveDirectoryNoReplaceAsync(source, destination)).resolves.toMatchObject({
      type: "moved",
    });
  });

  it("refuses when the destination parent is missing, without creating it", async () => {
    const destination = path.join(dir, "missing", "archive");

    const error = await expectMoveError(moveDirectoryNoReplaceAsync(source, destination));

    expect(error.reason).toBe("destination-parent-missing");
    await expect(lstat(path.join(dir, "missing"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("accepts a destination parent that is a symlink to a directory", async () => {
    // macOS `/tmp` → `/private/tmp`, or a deploy `current` → `releases/N`
    const real = path.join(dir, "real");
    const alias = path.join(dir, "alias");
    await mkdir(real);
    await symlink(real, alias);

    const result = await moveDirectoryNoReplaceAsync(source, path.join(alias, "archive"));

    expect(result.type).toBe("moved");
    expect(await readFile(path.join(real, "archive", "receipts", "op-1.json"), "utf8")).toBe(
      '{"ok":true}',
    );
  });

  it("is reachable as fs.dirs.moveNoReplace", async () => {
    const destination = path.join(dir, "via-facade");

    await expect(fs.dirs.moveNoReplace(source, destination)).resolves.toMatchObject({
      type: "moved",
      to: destination,
    });
  });
});

describe("moveDirectoryNoReplaceAsync on Windows", () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;

  afterEach(() => {
    Object.defineProperty(process, "platform", platform);
  });

  it("refuses explicitly instead of falling back", async () => {
    Object.defineProperty(process, "platform", { ...platform, value: "win32" });

    const error = await expectMoveError(moveDirectoryNoReplaceAsync("a", "b"));

    expect(error.reason).toBe("unsupported-platform");
    expect(error.outcome).toBe("not-moved");
  });
});
