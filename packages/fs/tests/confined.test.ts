import { execFileSync } from "node:child_process";
import { mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ConfinedEntry,
  type ConfinedReader,
  createConfinedReader,
  fs,
  FsLimitExceededError,
  FsLinkRefusedError,
  FsPathEscapeError,
} from "../src";
import { withTempDir } from "./helpers";

const posixOnly = process.platform === "win32" ? describe.skip : describe;

async function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
}

async function collect(iterable: AsyncIterable<ConfinedEntry>): Promise<ConfinedEntry[]> {
  const entries: ConfinedEntry[] = [];

  for await (const entry of iterable) {
    entries.push(entry);
  }

  return entries;
}

describe("createConfinedReader", () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  let root: string;
  let outside: string;
  let reader: ConfinedReader;

  beforeEach(async () => {
    ({ dir, cleanup } = await withTempDir());
    root = path.join(dir, "root");
    outside = path.join(dir, "outside");
    await mkdir(path.join(root, "nested", "deep"), { recursive: true });
    await mkdir(outside);
    await writeFile(path.join(root, "a.txt"), "alpha");
    await writeFile(path.join(root, "nested", "b.json"), JSON.stringify({ name: "bee" }));
    await writeFile(path.join(root, "nested", "deep", "c.txt"), "sea");
    await writeFile(path.join(outside, "secret.txt"), "top secret");
    reader = createConfinedReader(root);
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("reading inside the root", () => {
    it("reads text, bytes and JSON by root-relative path", async () => {
      expect(await reader.readText("a.txt")).toBe("alpha");
      expect((await reader.readBuffer("nested/deep/c.txt")).toString()).toBe("sea");
      expect(await reader.readJson<{ name: string }>("nested/b.json")).toEqual({ name: "bee" });
      expect(await reader.readText("nested/../a.txt")).toBe("alpha");
      expect(await reader.readText("./nested//deep/c.txt")).toBe("sea");
    });

    it("validates JSON against a Standard Schema", async () => {
      const schema = {
        "~standard": {
          version: 1 as const,
          vendor: "test",
          validate: (value: unknown) =>
            typeof value === "object" && value !== null && "name" in value
              ? { value: value as { name: string } }
              : { issues: [{ message: "name is required" }] },
        },
      };

      expect(await reader.readJson("nested/b.json", { schema })).toEqual({ name: "bee" });
      await writeFile(path.join(root, "bad.json"), "{}");
      await expect(reader.readJson("bad.json", { schema })).rejects.toThrow("name is required");
    });

    it("canonicalises the root", async () => {
      expect(reader.root).toBe(await realpath(root));
    });

    it("stats files, folders and the root", async () => {
      expect(await reader.stat("a.txt")).toMatchObject({
        path: "a.txt",
        name: "a.txt",
        type: "file",
        size: 5,
      });
      expect((await reader.stat("nested")).type).toBe("directory");
      expect(await reader.stat("")).toMatchObject({ path: "", type: "directory" });
    });

    it("reports existence; missing paths are false, hostile ones throw", async () => {
      expect(await reader.exists("a.txt")).toBe(true);
      expect(await reader.exists("missing.txt")).toBe(false);
      expect(await reader.exists("a.txt/inside-a-file")).toBe(false);
      await expect(reader.exists("../outside/secret.txt")).rejects.toBeInstanceOf(
        FsPathEscapeError,
      );
    });

    it("throws the usual errors for missing files and folders", async () => {
      await expect(reader.readText("missing.txt")).rejects.toMatchObject({ code: "ENOENT" });
      await expect(reader.readText("nested")).rejects.toMatchObject({ code: "EISDIR" });
      await expect(reader.list("a.txt")).rejects.toMatchObject({ code: "ENOTDIR" });
    });

    it("lists one folder, sorted, with root-relative paths", async () => {
      expect(await reader.list()).toEqual([
        { path: "a.txt", name: "a.txt", type: "file", depth: 1 },
        { path: "nested", name: "nested", type: "directory", depth: 1 },
      ]);
      expect((await reader.list("nested")).map((entry) => entry.path)).toEqual([
        "nested/b.json",
        "nested/deep",
      ]);
    });

    it("walks the tree depth-first, a folder before its contents", async () => {
      const entries = await collect(reader.walk());

      expect(entries.map((entry) => [entry.path, entry.type, entry.depth])).toEqual([
        ["a.txt", "file", 1],
        ["nested", "directory", 1],
        ["nested/b.json", "file", 2],
        ["nested/deep", "directory", 2],
        ["nested/deep/c.txt", "file", 3],
      ]);
      expect((await collect(reader.walk("nested/deep"))).map((entry) => entry.path)).toEqual([
        "nested/deep/c.txt",
      ]);
    });

    it("is reachable as fs.confined", async () => {
      expect(await fs.confined(root).readText("a.txt")).toBe("alpha");
    });
  });

  describe("path escapes", () => {
    it("refuses `..` that climbs above the root", async () => {
      for (const input of ["../outside/secret.txt", "nested/../../outside/secret.txt", ".."]) {
        const error = await caught(reader.readText(input));

        expect(error).toBeInstanceOf(FsPathEscapeError);
        expect(error).toMatchObject({
          type: "path-escape",
          reason: "parent-traversal",
          path: input,
        });
      }
    });

    it("refuses absolute paths, even ones inside the root", async () => {
      for (const input of [path.join(outside, "secret.txt"), path.join(root, "a.txt")]) {
        const error = await caught(reader.readText(input));

        expect(error).toBeInstanceOf(FsPathEscapeError);
        expect(error).toMatchObject({ reason: "absolute" });
      }
    });

    it("refuses escapes in every method", async () => {
      await expect(reader.stat("../outside")).rejects.toBeInstanceOf(FsPathEscapeError);
      await expect(reader.list("../outside")).rejects.toBeInstanceOf(FsPathEscapeError);
      await expect(collect(reader.walk("../outside"))).rejects.toBeInstanceOf(FsPathEscapeError);
      await expect(reader.readJson("../outside/secret.txt")).rejects.toBeInstanceOf(
        FsPathEscapeError,
      );
    });
  });

  posixOnly("links (no-follow, the default)", () => {
    it("refuses a symlink at the leaf", async () => {
      await symlink(path.join(outside, "secret.txt"), path.join(root, "leak.txt"));

      const error = await caught(reader.readText("leak.txt"));

      expect(error).toBeInstanceOf(FsLinkRefusedError);
      expect(error).toMatchObject({
        type: "link-refused",
        reason: "symlink",
        path: "leak.txt",
        linkPath: "leak.txt",
      });
    });

    it("refuses a symlink even when it points inside the root", async () => {
      await symlink(path.join(root, "a.txt"), path.join(root, "alias.txt"));

      await expect(reader.readText("alias.txt")).rejects.toBeInstanceOf(FsLinkRefusedError);
      await expect(reader.stat("alias.txt")).rejects.toBeInstanceOf(FsLinkRefusedError);
      await expect(reader.exists("alias.txt")).rejects.toBeInstanceOf(FsLinkRefusedError);
    });

    it("refuses a symlink in a middle component", async () => {
      await symlink(outside, path.join(root, "nested", "portal"));

      const error = await caught(reader.readText("nested/portal/secret.txt"));

      expect(error).toBeInstanceOf(FsLinkRefusedError);
      expect(error).toMatchObject({ reason: "symlink", linkPath: "nested/portal" });
      await expect(reader.list("nested/portal")).rejects.toBeInstanceOf(FsLinkRefusedError);
    });

    it("refuses a dangling symlink instead of reporting it missing", async () => {
      await symlink(path.join(outside, "nothing"), path.join(root, "dangling"));

      await expect(reader.exists("dangling")).rejects.toBeInstanceOf(FsLinkRefusedError);
    });

    it("lists and walks links as `symlink` without following them", async () => {
      await symlink(outside, path.join(root, "nested", "portal"));

      const entries = await collect(reader.walk());

      expect(entries.find((entry) => entry.name === "portal")).toEqual({
        path: "nested/portal",
        name: "portal",
        type: "symlink",
        depth: 2,
      });
      expect(entries.some((entry) => entry.name === "secret.txt")).toBe(false);
    });

    it("refuses a root that is itself a symlink", async () => {
      const linkedRoot = path.join(dir, "linked-root");
      await symlink(root, linkedRoot);

      expect(() => createConfinedReader(linkedRoot)).toThrow(FsLinkRefusedError);
      expect(() => createConfinedReader(linkedRoot)).toThrow(
        expect.objectContaining({ reason: "root-symlink" }),
      );

      const allowed = createConfinedReader(linkedRoot, { allowSymlinkedRoot: true });

      expect(allowed.root).toBe(await realpath(root));
      expect(await allowed.readText("a.txt")).toBe("alpha");
    });

    it("accepts a root reached through a symlinked parent folder", async () => {
      const linkedParent = path.join(dir, "linked-parent");
      await symlink(dir, linkedParent);

      const viaParent = createConfinedReader(path.join(linkedParent, "root"));

      expect(viaParent.root).toBe(await realpath(root));
      expect(await viaParent.readText("a.txt")).toBe("alpha");
    });
  });

  posixOnly("followLinks: true", () => {
    let following: ConfinedReader;

    beforeEach(() => {
      following = createConfinedReader(root, { followLinks: true });
    });

    it("follows links that stay inside the root", async () => {
      await symlink(path.join(root, "a.txt"), path.join(root, "alias.txt"));
      await symlink(path.join(root, "nested"), path.join(root, "shortcut"));

      expect(await following.readText("alias.txt")).toBe("alpha");
      expect(await following.readText("shortcut/deep/c.txt")).toBe("sea");
      expect((await following.stat("alias.txt")).type).toBe("file");
    });

    it("refuses a link whose target leaves the root", async () => {
      await symlink(path.join(outside, "secret.txt"), path.join(root, "leak.txt"));
      await symlink(outside, path.join(root, "portal"));

      for (const input of ["leak.txt", "portal/secret.txt"]) {
        const error = await caught(following.readText(input));

        expect(error).toBeInstanceOf(FsPathEscapeError);
        expect(error).toMatchObject({ reason: "link-escape" });
      }
    });

    it("walks into inside folder links once and never loops", async () => {
      await symlink(root, path.join(root, "nested", "loop"));
      await symlink(outside, path.join(root, "portal"));

      const entries = await collect(following.walk());
      const paths = entries.map((entry) => entry.path);

      expect(paths).toContain("nested/loop");
      expect(paths).toContain("portal");
      expect(paths.some((entry) => entry.includes("secret.txt"))).toBe(false);
      expect(paths.filter((entry) => entry.endsWith("c.txt"))).toEqual(["nested/deep/c.txt"]);
    });
  });

  describe("bounds", () => {
    it("refuses a file larger than maxFileBytes", async () => {
      const small = createConfinedReader(root, { maxFileBytes: 4 });
      const error = await caught(small.readText("a.txt"));

      expect(error).toBeInstanceOf(FsLimitExceededError);
      expect(error).toMatchObject({
        type: "limit-exceeded",
        limit: "maxFileBytes",
        max: 4,
        actual: 5,
        path: "a.txt",
      });
      expect(await small.readText("a.txt", { maxFileBytes: 5 })).toBe("alpha");
      expect(await createConfinedReader(root, { maxFileBytes: 5 }).readText("a.txt")).toBe("alpha");
    });

    it("caps list at maxEntries", async () => {
      const error = await caught(reader.list("", { maxEntries: 1 }));

      expect(error).toBeInstanceOf(FsLimitExceededError);
      expect(error).toMatchObject({ limit: "maxEntries", max: 1, actual: 2, path: "" });
      expect(await reader.list("", { maxEntries: 2 })).toHaveLength(2);
    });

    it("caps a whole walk at maxEntries", async () => {
      const capped = createConfinedReader(root, { maxEntries: 4 });
      const error = await caught(collect(capped.walk()));

      expect(error).toBeInstanceOf(FsLimitExceededError);
      expect(error).toMatchObject({ limit: "maxEntries", max: 4, actual: 5 });
      expect(await collect(capped.walk("", { maxEntries: 5 }))).toHaveLength(5);
    });

    it("refuses to walk deeper than maxDepth", async () => {
      const error = await caught(collect(reader.walk("", { maxDepth: 2 })));

      expect(error).toBeInstanceOf(FsLimitExceededError);
      expect(error).toMatchObject({ limit: "maxDepth", max: 2, actual: 3, path: "nested/deep" });
      expect(await collect(reader.walk("", { maxDepth: 3 }))).toHaveLength(5);
    });

    it("rejects invalid bounds", () => {
      expect(() => createConfinedReader(root, { maxFileBytes: -1 })).toThrow(TypeError);
      expect(() => createConfinedReader(root, { maxEntries: 1.5 })).toThrow(TypeError);
      expect(() => createConfinedReader(root, { maxDepth: Number.NaN })).toThrow(TypeError);
      expect(createConfinedReader(root, { maxFileBytes: Infinity }).maxFileBytes).toBe(Infinity);
    });
  });

  describe("roots", () => {
    it("refuses a missing root or a file as root", async () => {
      expect(() => createConfinedReader(path.join(dir, "missing"))).toThrow(
        expect.objectContaining({ code: "ENOENT" }),
      );
      expect(() => createConfinedReader(path.join(root, "a.txt"))).toThrow(
        expect.objectContaining({ code: "ENOTDIR" }),
      );
    });
  });

  posixOnly("special files", () => {
    it("refuses to read a FIFO", async () => {
      execFileSync("mkfifo", [path.join(root, "pipe")]);

      await expect(reader.readText("pipe")).rejects.toMatchObject({ code: "EINVAL" });
      expect((await reader.list()).find((entry) => entry.name === "pipe")?.type).toBe("other");
    });
  });
});
